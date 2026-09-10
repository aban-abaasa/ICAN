-- Fix: "Applications" tab (and anything else that opens the CMMS module)
-- intermittently fails with:
--   cmms_get_my_pichin_business_access -> 400 Bad Request
--   cmms_ensure_pichin_business_access -> 409 Conflict
--
-- Root cause: cmms_ensure_pichin_business_access() does a classic
-- check-then-insert ("SELECT ... WHERE pichin_business_profile_id = ...,
-- if not found INSERT") with no locking. CMSSModule.jsx's onboarding effect
-- can call this RPC more than once for the same business_profile_id in quick
-- succession (React effect re-run, multiple open tabs, the fallback path
-- that re-provisions every manageable business on each login) -- when two
-- calls race, both see "no company yet" and both INSERT, and the second
-- INSERT collides with the UNIQUE company_registration ('PICHIN-<id>') /
-- the one-row-per-profile index, which Postgres reports as a unique
-- violation (23505) -- PostgREST maps that to HTTP 409.
--
-- cmms_get_my_pichin_business_access() calls cmms_ensure_pichin_business_access()
-- internally for every business the user can manage, so the same race can
-- surface there too -- PostgREST maps that failure to HTTP 400 because it
-- reaches the caller as an unhandled exception inside the outer function.
--
-- Fix: take a per-business-profile advisory lock at the top of
-- cmms_ensure_pichin_business_access(), before the existence check. Any
-- concurrent call for the *same* business profile now queues up and, once
-- unblocked, sees the row the first call already committed -- so it takes
-- the UPDATE branch instead of racing another INSERT. Calls for *different*
-- business profiles are unaffected (different lock key).
--
-- This is a straight superset of CMMS_PICHIN_PROFILE_ACCESS_BY_TYPE.sql's
-- cmms_ensure_pichin_business_access() -- only the advisory-lock line is
-- new. Safe to run more than once.
--
-- If 400s persist after this fix, they're most likely the unrelated
-- industry-enum issue -- also run CMMS_FIX_INDUSTRY_DEFAULT_STEP1_ADD_ENUM_VALUE.sql
-- and CMMS_FIX_INDUSTRY_DEFAULT_STEP2_FIX_FUNCTION_AND_BACKFILL.sql (as two
-- separate commits, per that pair's own instructions) if they haven't been
-- applied to this database yet.

CREATE OR REPLACE FUNCTION public.cmms_ensure_pichin_business_access(
  p_business_profile_id UUID
)
RETURNS public.cmms_company_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_profile public.business_profiles;
  v_company public.cmms_company_profiles;
  v_architecture JSONB;
  v_business_type TEXT;
  v_email TEXT := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_cmms_user_id UUID;
  v_admin_role_id UUID;
  v_department TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User is not authenticated';
  END IF;

  -- Serialize concurrent provisioning of the same Pichin business profile
  -- (released automatically at the end of this transaction) so two racing
  -- calls can't both decide "no CMMS company yet" and both INSERT one,
  -- which previously tripped the unique company_registration constraint
  -- and surfaced to the browser as a 409/400.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_business_profile_id::text, 0));

  SELECT * INTO v_profile
  FROM public.business_profiles bp
  WHERE bp.id = p_business_profile_id
    AND lower(coalesce(bp.status, 'active')) NOT IN ('inactive', 'suspended', 'rejected', 'deleted')
    AND (
      bp.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.business_co_owners co
        WHERE co.business_profile_id = bp.id
          AND (co.user_id = auth.uid() OR lower(co.owner_email) = v_email)
          AND lower(coalesce(co.status, 'active')) IN ('active', 'approved', 'verified')
          AND (co.ownership_share > 0 OR lower(coalesce(co.role, '')) IN ('owner', 'co-owner', 'shareholder', 'ceo', 'administrator'))
      )
    );

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'You are not an administrator of this Pichin business profile';
  END IF;

  -- The selected company category is stored as metadata.category_key by the
  -- Pichin business profile flow. business_type can be a legal structure such
  -- as "Sole Proprietorship", so never use it as the first authority for CMMS
  -- module access.
  v_business_type := lower(coalesce(NULLIF(v_profile.metadata ->> 'category_key', ''), v_profile.business_type, 'other'));
  v_architecture := public.cmms_business_type_architecture(v_business_type);

  SELECT * INTO v_company
  FROM public.cmms_company_profiles
  WHERE pichin_business_profile_id = p_business_profile_id
  LIMIT 1;

  IF v_company.id IS NULL THEN
    INSERT INTO public.cmms_company_profiles (
      company_name, company_registration, email, created_by, owner_email,
      pichin_business_profile_id, pichin_business_type, industry, architecture
    ) VALUES (
      v_profile.business_name,
      'PICHIN-' || replace(p_business_profile_id::TEXT, '-', ''),
      coalesce(NULLIF(v_email, ''), 'business-' || p_business_profile_id || '@cmms.local'),
      auth.uid(), v_email, p_business_profile_id, v_business_type,
      (v_architecture ->> 'industry')::cmms_industry_type, v_architecture
    ) RETURNING * INTO v_company;
  ELSE
    UPDATE public.cmms_company_profiles
    SET company_name = coalesce(v_profile.business_name, company_name),
        pichin_business_type = v_business_type,
        industry = (v_architecture ->> 'industry')::cmms_industry_type,
        architecture = v_architecture,
        is_active = TRUE,
        updated_at = now()
    WHERE id = v_company.id
    RETURNING * INTO v_company;
  END IF;

  SELECT id INTO v_cmms_user_id
  FROM public.cmms_users
  WHERE cmms_company_id = v_company.id AND lower(email) = v_email
  LIMIT 1;

  IF v_cmms_user_id IS NULL THEN
    INSERT INTO public.cmms_users (cmms_company_id, email, user_name, role, is_active, is_creator)
    VALUES (v_company.id, v_email, coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', split_part(v_email, '@', 1)), 'admin', TRUE, TRUE)
    RETURNING id INTO v_cmms_user_id;
  ELSE
    UPDATE public.cmms_users SET is_active = TRUE, is_creator = TRUE, role = 'admin', updated_at = now()
    WHERE id = v_cmms_user_id;
  END IF;

  -- Some CMMS installations define created_by_user_id as a foreign key to
  -- cmms_users, so populate it only after the CMMS user exists.
  UPDATE public.cmms_company_profiles
  SET created_by_user_id = v_cmms_user_id,
      owner_email = NULLIF(v_email, '')
  WHERE id = v_company.id;
  SELECT * INTO v_company FROM public.cmms_company_profiles WHERE id = v_company.id;

  -- Each Pichin business receives its own administrator role. Never attach a
  -- user in company A to a same-named global or company B role: a single owner
  -- can run multiple businesses with separate CMMS administration.
  INSERT INTO public.cmms_roles
    (cmms_company_id, role_name, display_name, description,
     permission_level, tool_access, is_system_role, is_active, created_by)
  SELECT v_company.id,
         'business_admin',
         'Business Administrator',
         'Full administrator access for this Pichin business CMMS tenant',
         100,
         jsonb_build_object(
           'company', true, 'departments', true, 'users', true,
           'inventory', true, 'payroll', true, 'transport', true,
           'requisitions', true, 'approvals', true, 'reports', true,
           'tasks', true
         ),
         true, true, v_cmms_user_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.cmms_roles
    WHERE cmms_company_id = v_company.id
      AND lower(role_name) = 'business_admin'
  );

  SELECT id INTO v_admin_role_id
  FROM public.cmms_roles
  WHERE cmms_company_id = v_company.id
    AND lower(role_name) IN ('business_admin', 'admin', 'administrator', 'cmms_admin')
    AND is_active = TRUE
  ORDER BY CASE WHEN lower(role_name) = 'business_admin' THEN 0 ELSE 1 END,
           permission_level DESC NULLS LAST
  LIMIT 1;

  -- Retire the legacy global-admin assignment for this user in this tenant.
  -- The new company-local business_admin role is the only administrator role
  -- presented for this business, keeping two owned businesses independent.
  UPDATE public.cmms_user_roles assignment
     SET is_active = FALSE
    FROM public.cmms_roles legacy_role
   WHERE assignment.cmms_company_id = v_company.id
     AND assignment.cmms_user_id = v_cmms_user_id
     AND assignment.cmms_role_id = legacy_role.id
     AND legacy_role.cmms_company_id IS NULL
     AND lower(legacy_role.role_name) IN ('admin', 'administrator', 'cmms_admin');

  IF v_admin_role_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cmms_user_roles
    WHERE cmms_company_id = v_company.id AND cmms_user_id = v_cmms_user_id AND cmms_role_id = v_admin_role_id
  ) THEN
    INSERT INTO public.cmms_user_roles (cmms_company_id, cmms_user_id, cmms_role_id, assigned_by, is_active)
    VALUES (v_company.id, v_cmms_user_id, v_admin_role_id, v_cmms_user_id, TRUE);
  END IF;

  IF to_regclass('public.cmms_company_creators') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.cmms_company_creators WHERE cmms_company_id = v_company.id
    ) THEN
      UPDATE public.cmms_company_creators
      SET creator_user_id = v_cmms_user_id, creator_email = v_email
      WHERE cmms_company_id = v_company.id;
    ELSE
      INSERT INTO public.cmms_company_creators (cmms_company_id, creator_user_id, creator_email)
      VALUES (v_company.id, v_cmms_user_id, v_email);
    END IF;
  END IF;

  FOREACH v_department IN ARRAY ARRAY(SELECT jsonb_array_elements_text(v_architecture -> 'departments')) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.cmms_departments
      WHERE cmms_company_id = v_company.id AND department_name = v_department
    ) THEN
      INSERT INTO public.cmms_departments (cmms_company_id, department_name, description, created_by)
      VALUES (v_company.id, v_department, 'Default department for ' || v_business_type || ' operations', auth.uid());
    END IF;
  END LOOP;

  -- Import the Pichin business template into customizable CMMS roles. These
  -- rows are inserted only when missing, so a CMMS administrator can freely
  -- customize access without the next synchronization overwriting it.
  IF to_regclass('public.business_roles') IS NOT NULL
     AND to_regclass('public.business_profile_modules') IS NOT NULL
     AND to_regclass('public.cmms_roles') IS NOT NULL THEN
    EXECUTE $roles$
      WITH module_access AS (
        SELECT
          bool_or(module_key IN ('inventory', 'assets', 'cmms_assets') AND enabled) AS inventory,
          TRUE AS payroll,
          bool_or(module_key IN ('fees', 'school_fees') AND enabled) AS fees,
          bool_or(module_key IN ('production', 'bom', 'wip_locks') AND enabled) AS production,
          bool_or(module_key = 'quality' AND enabled) AS quality,
          bool_or(module_key = 'clinical' AND enabled) AS clinical,
          bool_or(module_key = 'pharmacy' AND enabled) AS pharmacy,
          TRUE AS transport,
          TRUE AS requisitions,
          bool_or(module_key = 'approvals' AND enabled) AS approvals,
          bool_or(module_key IN ('reports', 'report_cards') AND enabled) AS reports,
          TRUE AS tasks
        FROM public.business_profile_modules
        WHERE business_profile_id = $2
      )
      INSERT INTO public.cmms_roles
        (cmms_company_id, role_name, display_name, description,
         permission_level, tool_access, is_system_role, is_active, created_by)
      SELECT $1,
             br.role_key,
             br.display_name,
             'Imported from the selected Pichin business profile',
             CASE WHEN br.role_key = 'business_admin' THEN 100 ELSE 50 END,
             jsonb_build_object(
               'company', true,
               'departments', br.role_key IN ('business_admin', 'department_head', 'facility_manager', 'production_manager', 'warehouse_manager'),
               'users', br.role_key = 'business_admin',
               'inventory', COALESCE(ma.inventory, false),
               'payroll', COALESCE(ma.payroll, false) AND br.role_key IN ('business_admin', 'finance_approver', 'payroll_officer', 'bursar'),
               'fees', COALESCE(ma.fees, false) AND br.role_key IN ('business_admin', 'head_teacher', 'department_head', 'registrar', 'teacher', 'student', 'bursar'),
               'production', COALESCE(ma.production, false) AND br.role_key IN ('business_admin', 'production_manager', 'storeman', 'technician'),
               'quality', COALESCE(ma.quality, false) AND br.role_key IN ('business_admin', 'quality_manager', 'production_manager'),
               'clinical', COALESCE(ma.clinical, false) AND br.role_key IN ('business_admin', 'clinical_manager'),
               'pharmacy', COALESCE(ma.pharmacy, false) AND br.role_key IN ('business_admin', 'pharmacist', 'inventory_receiver'),
               'transport', COALESCE(ma.transport, false) AND br.role_key IN ('business_admin', 'transport_coordinator', 'fulfilment_manager'),
               'requisitions', COALESCE(ma.requisitions, false),
               'approvals', COALESCE(ma.approvals, ma.requisitions, false) AND br.role_key IN ('business_admin', 'department_head', 'finance_approver', 'head_teacher', 'bursar', 'project_manager'),
               'reports', COALESCE(ma.reports, false),
               'tasks', COALESCE(ma.tasks, false) AND br.role_key IN ('business_admin', 'department_head', 'facility_manager', 'production_manager', 'project_manager', 'site_manager', 'technician', 'storeman')
             ),
             true, true, $3
        FROM public.business_roles br
        CROSS JOIN module_access ma
       WHERE br.business_profile_id = $2
         AND br.is_active = true
         AND NOT EXISTS (
           SELECT 1 FROM public.cmms_roles existing
            WHERE existing.cmms_company_id = $1
              AND existing.role_name = br.role_key
         )
    $roles$ USING v_company.id, p_business_profile_id, v_cmms_user_id;
  END IF;

  RETURN v_company;
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_ensure_pichin_business_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_ensure_pichin_business_access(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'cmms_ensure_pichin_business_access is now race-safe (per-business-profile advisory lock)' AS status;
