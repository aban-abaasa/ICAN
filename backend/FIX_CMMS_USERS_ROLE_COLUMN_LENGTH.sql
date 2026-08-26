-- ================================================================
-- FIX: cmms_users.role too narrow for role names it actually stores
-- ================================================================
-- "Add User" (CMSSModule.jsx handleAddUser) inserts the company's role
-- definition name straight into cmms_users.role. Role names live in
-- cmms_role_definitions.role_name / cmms_roles.role_name, both
-- VARCHAR(100), but cmms_users.role was only VARCHAR(50) (see
-- CMMS_COMPLETE_SCHEMA.sql). Any company with a custom role name over
-- 50 characters gets:
--   "Error adding user to database: value too long for type
--    character varying(50)"
-- Local testing only ever used short default role names (Admin,
-- Technician, ...), so this never surfaced there — it's not an
-- environment difference, both point at the same Supabase project.
--
-- Widen to VARCHAR(100) to match the role-name source columns.
--
-- Postgres refuses a plain ALTER COLUMN TYPE while ANYTHING reads
-- cmms_users.role directly: views (v_department_staff), RLS policies
-- (e.g. audit_log_view_by_role on cmms_audit_log), and column-scoped
-- triggers (cmms_user_pichin_authority_sync, an "UPDATE OF role"
-- trigger) have all turned up blocking it. This repo has years of
-- overlapping/superseded CMMS_*.sql files defining these, so the file
-- tree can't tell us the full live set. Instead of fixing blockers
-- one at a time, this discovers every view, policy, and trigger (on
-- any table) that currently depends on cmms_users.role, captures each
-- one's exact definition, drops them, widens the column, then replays
-- everything verbatim so nothing changes except the width — every
-- policy stays exactly as permissive/restrictive as it was.
--
-- Run once in the Supabase SQL Editor.
-- ================================================================

DO $$
DECLARE
  v_view record;
  v_policy record;
  v_trigger record;
  v_grantee text;
  v_roles_clause text;
  v_cmd_keyword text;
  v_sql text;
BEGIN
  -- ---------- capture views ----------
  CREATE TEMP TABLE _dep_views (
    view_oid oid PRIMARY KEY,
    view_name text NOT NULL,
    def text NOT NULL,
    relopts text
  ) ON COMMIT DROP;

  CREATE TEMP TABLE _dep_view_grants (
    view_oid oid,
    grantee text
  ) ON COMMIT DROP;

  INSERT INTO _dep_views (view_oid, view_name, def, relopts)
  SELECT DISTINCT
    c.oid,
    format('%I.%I', n.nspname, c.relname),
    pg_get_viewdef(c.oid, true),
    array_to_string(c.reloptions, ', ')
  FROM pg_depend d
  JOIN pg_rewrite r ON r.oid = d.objid
  JOIN pg_class c ON c.oid = r.ev_class
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
  WHERE d.refobjid = 'public.cmms_users'::regclass
    AND a.attname = 'role'
    AND c.relkind = 'v';

  INSERT INTO _dep_view_grants (view_oid, grantee)
  SELECT dv.view_oid, g.grantee
  FROM _dep_views dv
  JOIN information_schema.role_table_grants g
    ON g.table_schema = split_part(dv.view_name, '.', 1)
   AND g.table_name = split_part(dv.view_name, '.', 2)
   AND g.privilege_type = 'SELECT';

  -- ---------- capture RLS policies (on any table) ----------
  CREATE TEMP TABLE _dep_policies (
    policy_oid oid PRIMARY KEY,
    table_name text NOT NULL,
    policy_name text NOT NULL,
    permissive boolean NOT NULL,
    cmd "char" NOT NULL,
    roles text[] NOT NULL,
    using_expr text,
    check_expr text
  ) ON COMMIT DROP;

  INSERT INTO _dep_policies (policy_oid, table_name, policy_name, permissive, cmd, roles, using_expr, check_expr)
  SELECT DISTINCT
    p.oid,
    format('%I.%I', n.nspname, c.relname),
    p.polname,
    p.polpermissive,
    p.polcmd,
    ARRAY(
      SELECT CASE WHEN rid = 0 THEN 'PUBLIC' ELSE rr.rolname END
      FROM unnest(p.polroles) AS rid
      LEFT JOIN pg_roles rr ON rr.oid = rid
    ),
    pg_get_expr(p.polqual, p.polrelid),
    pg_get_expr(p.polwithcheck, p.polrelid)
  FROM pg_depend d
  JOIN pg_policy p ON p.oid = d.objid AND d.classid = 'pg_policy'::regclass
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
  WHERE d.refobjid = 'public.cmms_users'::regclass
    AND a.attname = 'role'
    AND d.refclassid = 'pg_class'::regclass;

  -- ---------- capture column-scoped triggers (on any table) ----------
  CREATE TEMP TABLE _dep_triggers (
    trigger_oid oid PRIMARY KEY,
    table_name text NOT NULL,
    trigger_name text NOT NULL,
    def text NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _dep_triggers (trigger_oid, table_name, trigger_name, def)
  SELECT DISTINCT
    t.oid,
    format('%I.%I', n.nspname, c.relname),
    t.tgname,
    pg_get_triggerdef(t.oid, true)
  FROM pg_depend d
  JOIN pg_trigger t ON t.oid = d.objid AND d.classid = 'pg_trigger'::regclass
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
  WHERE d.refobjid = 'public.cmms_users'::regclass
    AND a.attname = 'role'
    AND d.refclassid = 'pg_class'::regclass
    AND NOT t.tgisinternal;

  -- ---------- drop blockers ----------
  FOR v_view IN SELECT * FROM _dep_views LOOP
    EXECUTE format('DROP VIEW %s', v_view.view_name);
  END LOOP;

  FOR v_policy IN SELECT * FROM _dep_policies LOOP
    EXECUTE format('DROP POLICY %I ON %s', v_policy.policy_name, v_policy.table_name);
  END LOOP;

  FOR v_trigger IN SELECT * FROM _dep_triggers LOOP
    EXECUTE format('DROP TRIGGER %I ON %s', v_trigger.trigger_name, v_trigger.table_name);
  END LOOP;

  -- ---------- the actual fix ----------
  ALTER TABLE public.cmms_users
    ALTER COLUMN role TYPE VARCHAR(100);

  -- ---------- replay views ----------
  FOR v_view IN SELECT * FROM _dep_views LOOP
    EXECUTE format('CREATE VIEW %s AS %s', v_view.view_name, v_view.def);

    IF v_view.relopts IS NOT NULL AND v_view.relopts <> '' THEN
      EXECUTE format('ALTER VIEW %s SET (%s)', v_view.view_name, v_view.relopts);
    END IF;

    FOR v_grantee IN SELECT DISTINCT grantee FROM _dep_view_grants WHERE view_oid = v_view.view_oid LOOP
      IF v_grantee = 'PUBLIC' THEN
        EXECUTE format('GRANT SELECT ON %s TO PUBLIC', v_view.view_name);
      ELSE
        EXECUTE format('GRANT SELECT ON %s TO %I', v_view.view_name, v_grantee);
      END IF;
    END LOOP;
  END LOOP;

  -- ---------- replay policies ----------
  FOR v_policy IN SELECT * FROM _dep_policies LOOP
    v_cmd_keyword := CASE v_policy.cmd
      WHEN 'r' THEN 'SELECT'
      WHEN 'a' THEN 'INSERT'
      WHEN 'w' THEN 'UPDATE'
      WHEN 'd' THEN 'DELETE'
      ELSE 'ALL'
    END;

    SELECT string_agg(CASE WHEN rname = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(rname) END, ', ')
    INTO v_roles_clause
    FROM unnest(v_policy.roles) AS rname;

    v_sql := format(
      'CREATE POLICY %I ON %s AS %s FOR %s TO %s',
      v_policy.policy_name,
      v_policy.table_name,
      CASE WHEN v_policy.permissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
      v_cmd_keyword,
      v_roles_clause
    );

    IF v_policy.using_expr IS NOT NULL THEN
      v_sql := v_sql || format(' USING (%s)', v_policy.using_expr);
    END IF;

    IF v_policy.check_expr IS NOT NULL THEN
      v_sql := v_sql || format(' WITH CHECK (%s)', v_policy.check_expr);
    END IF;

    EXECUTE v_sql;
  END LOOP;

  -- ---------- replay triggers ----------
  FOR v_trigger IN SELECT * FROM _dep_triggers LOOP
    -- pg_get_triggerdef already returns a full, valid CREATE TRIGGER statement.
    EXECUTE v_trigger.def;
  END LOOP;
END $$;

SELECT 'cmms_users.role widened to VARCHAR(100); dependent views + policies + triggers restored' AS status;
