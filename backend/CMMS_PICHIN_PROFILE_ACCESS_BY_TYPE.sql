-- Give every authorized Pichin business profile its own CMMS tenant.
-- Run after CMMS_COMPLETE_SCHEMA.sql, CMMS_CREATOR_AND_RLS_SETUP.sql,
-- CMMS_ASSET_INVENTORY_FOUNDATION.sql, and the Pichin business-profile tables.

ALTER TABLE IF EXISTS public.cmms_company_profiles
  ADD COLUMN IF NOT EXISTS pichin_business_profile_id UUID
    REFERENCES public.business_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS owner_email TEXT,
  ADD COLUMN IF NOT EXISTS pichin_business_type TEXT,
  ADD COLUMN IF NOT EXISTS architecture JSONB NOT NULL DEFAULT '{}'::JSONB;

-- The old schema made email unique, which prevents one user from having
-- multiple CMMS tenants for multiple Pichin businesses.
DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  SELECT c.conname INTO v_constraint
  FROM pg_constraint c
  WHERE c.conrelid = 'public.cmms_company_profiles'::regclass
    AND c.contype = 'u'
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = c.conrelid AND a.attname = 'email'
        AND a.attnum = ANY(c.conkey)
    )
    AND (SELECT COUNT(*) FROM unnest(c.conkey)) = 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.cmms_company_profiles DROP CONSTRAINT %I', v_constraint);
  END IF;
END $$;

-- A single Pichin owner may own multiple businesses, so the creator user
-- cannot be globally unique across CMMS companies.
DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  SELECT c.conname INTO v_constraint
  FROM pg_constraint c
  WHERE c.conrelid = 'public.cmms_company_creators'::regclass
    AND c.contype = 'u'
    AND (SELECT COUNT(*) FROM unnest(c.conkey)) = 1
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = c.conrelid AND a.attname = 'creator_user_id'
        AND a.attnum = ANY(c.conkey)
    );

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.cmms_company_creators DROP CONSTRAINT %I', v_constraint);
  END IF;
END $$;

-- The same authenticated person needs a separate cmms_users record in each
-- tenant. Older CMMS schemas made email globally unique, which silently keeps
-- a multi-business owner attached to only the first business.
DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  SELECT c.conname INTO v_constraint
  FROM pg_constraint c
  WHERE c.conrelid = 'public.cmms_users'::regclass
    AND c.contype = 'u'
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = c.conrelid AND a.attname = 'email'
        AND a.attnum = ANY(c.conkey)
    )
    AND (SELECT COUNT(*) FROM unnest(c.conkey)) = 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.cmms_users DROP CONSTRAINT %I', v_constraint);
  END IF;
END $$;

-- Some historical deployments used a unique *index* rather than a UNIQUE
-- constraint for cmms_users.email. The block above can only remove
-- constraints, so remove any remaining single-column unique email indexes
-- before creating the company-scoped index below.
DO $$
DECLARE
  v_index RECORD;
BEGIN
  FOR v_index IN
    SELECT indexrelid::regclass AS index_name
      FROM pg_index i
     WHERE i.indrelid = 'public.cmms_users'::regclass
       AND i.indisunique
       AND NOT i.indisprimary
       AND (SELECT COUNT(*) FROM unnest(i.indkey::smallint[])) = 1
       AND EXISTS (
         SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = i.indrelid
            AND a.attname = 'email'
            AND a.attnum = ANY(i.indkey::smallint[])
       )
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %s', v_index.index_name);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_cmms_company_email_lookup
  ON public.cmms_company_profiles(lower(email));
CREATE INDEX IF NOT EXISTS idx_cmms_company_one_per_pichin_profile
  ON public.cmms_company_profiles(pichin_business_profile_id)
  WHERE pichin_business_profile_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmms_users_one_email_per_company
  ON public.cmms_users(cmms_company_id, lower(email));

-- The base CMMS schema also made role_name globally unique. That prevents the
-- required business_admin role from being created for a second CMMS tenant.
DO $$
DECLARE
  v_constraint TEXT;
  v_index RECORD;
BEGIN
  SELECT c.conname INTO v_constraint
  FROM pg_constraint c
  WHERE c.conrelid = 'public.cmms_roles'::regclass
    AND c.contype = 'u'
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = c.conrelid AND a.attname = 'role_name'
        AND a.attnum = ANY(c.conkey)
    )
    AND (SELECT COUNT(*) FROM unnest(c.conkey)) = 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.cmms_roles DROP CONSTRAINT %I', v_constraint);
  END IF;

  FOR v_index IN
    SELECT indexrelid::regclass AS index_name
      FROM pg_index i
     WHERE i.indrelid = 'public.cmms_roles'::regclass
       AND i.indisunique
       AND NOT i.indisprimary
       AND (SELECT COUNT(*) FROM unnest(i.indkey::smallint[])) = 1
       AND EXISTS (
         SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = i.indrelid
            AND a.attname = 'role_name'
            AND a.attnum = ANY(i.indkey::smallint[])
       )
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %s', v_index.index_name);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cmms_roles_one_name_per_company
  ON public.cmms_roles(cmms_company_id, lower(role_name));

CREATE OR REPLACE FUNCTION public.cmms_business_type_architecture(p_business_type TEXT)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(coalesce(p_business_type, '')) IN ('factory', 'manufacturing', 'industrial') THEN
      jsonb_build_object('industry', 'Manufacturing', 'departments', jsonb_build_array('Production', 'Maintenance', 'Quality Assurance', 'Operations', 'Warehouse'))
    WHEN lower(coalesce(p_business_type, '')) IN ('wholesale', 'hardware', 'supermarket', 'retail', 'shop', 'supplier') THEN
      jsonb_build_object('industry', 'Retail', 'departments', jsonb_build_array('Store Operations', 'Purchasing', 'Warehouse', 'Sales', 'Maintenance'))
    WHEN lower(coalesce(p_business_type, '')) IN ('school', 'education', 'college', 'university') THEN
      jsonb_build_object('industry', 'Education', 'departments', jsonb_build_array('Administration', 'Teaching', 'Students', 'Admissions', 'Examinations', 'Facilities', 'Transport', 'Procurement', 'Finance', 'Human Resources'))
    WHEN lower(coalesce(p_business_type, '')) IN ('transport', 'transportation', 'logistics', 'fleet', 'delivery') THEN
      jsonb_build_object('industry', 'Transportation', 'departments', jsonb_build_array('Fleet Management', 'Operations', 'Maintenance', 'Logistics'))
    WHEN lower(coalesce(p_business_type, '')) IN ('pharmacy', 'healthcare', 'clinic', 'hospital') THEN
      jsonb_build_object('industry', 'Healthcare', 'departments', jsonb_build_array('Operations', 'Maintenance', 'Facilities', 'Administration'))
    WHEN lower(coalesce(p_business_type, '')) IN ('hotel', 'hospitality', 'restaurant', 'restaurant_cafe', 'cafe') THEN
      jsonb_build_object('industry', 'Hospitality', 'departments', jsonb_build_array('Operations', 'Inventory', 'Facilities', 'Maintenance', 'Food Safety'))
    WHEN lower(coalesce(p_business_type, '')) IN ('farm', 'agriculture', 'agribusiness') THEN
      jsonb_build_object('industry', 'Food_Processing', 'departments', jsonb_build_array('Production', 'Equipment Maintenance', 'Stores', 'Logistics', 'Safety'))
    ELSE
      jsonb_build_object('industry', 'Construction', 'departments', jsonb_build_array('Operations', 'Maintenance', 'Inventory', 'Administration'))
  END;
$$;

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
GRANT EXECUTE ON FUNCTION public.cmms_business_type_architecture(TEXT) TO authenticated;

-- Keep an existing CMMS tenant synchronized when the business owner changes
-- the selected business type in Manage Business.
CREATE OR REPLACE FUNCTION public.sync_cmms_business_profile_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_architecture JSONB;
BEGIN
  v_architecture := public.cmms_business_type_architecture(
    lower(coalesce(NULLIF(NEW.metadata ->> 'category_key', ''), NEW.business_type, 'other'))
  );

  UPDATE public.cmms_company_profiles
     SET pichin_business_type = lower(coalesce(NULLIF(NEW.metadata ->> 'category_key', ''), NEW.business_type, 'other')),
         industry = (v_architecture ->> 'industry')::cmms_industry_type,
         architecture = v_architecture,
         updated_at = now()
   WHERE pichin_business_profile_id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_cmms_business_profile_type_trigger ON public.business_profiles;
CREATE TRIGGER sync_cmms_business_profile_type_trigger
AFTER UPDATE OF business_type, metadata ON public.business_profiles
FOR EACH ROW
WHEN (OLD.business_type IS DISTINCT FROM NEW.business_type OR OLD.metadata IS DISTINCT FROM NEW.metadata)
EXECUTE FUNCTION public.sync_cmms_business_profile_type();

REVOKE ALL ON FUNCTION public.sync_cmms_business_profile_type() FROM PUBLIC;

-- Backfill missing module rows for existing active business profiles from the
-- selected category template. This is intentionally INSERT-only: if an admin
-- explicitly disabled a module on a profile, this repair will not turn it back
-- on.
INSERT INTO public.business_profile_modules (business_profile_id, module_key, enabled)
SELECT bp.id, modules.key, modules.value::BOOLEAN
  FROM public.business_profiles bp
  JOIN public.business_category_templates bct
    ON bct.is_active
   AND bct.category_key = lower(coalesce(
     NULLIF(bp.metadata ->> 'category_key', ''),
     NULLIF(bp.business_type, ''),
     'other'
   ))
  CROSS JOIN LATERAL jsonb_each_text(bct.default_modules) AS modules
 WHERE COALESCE(bp.status, 'active') = 'active'
ON CONFLICT (business_profile_id, module_key) DO NOTHING;

-- These CMMS capabilities are platform-wide: every active Pichin business
-- receives them regardless of its category. Category templates still control
-- specialist modules such as factory production, BOM, WIP locks, and quality.
INSERT INTO public.business_profile_modules (business_profile_id, module_key, enabled)
SELECT bp.id, universal_modules.module_key, TRUE
  FROM public.business_profiles bp
 CROSS JOIN (VALUES
   ('requisitions'::TEXT),
   ('payroll'::TEXT),
   ('transport'::TEXT),
   ('tasks'::TEXT)
 ) AS universal_modules(module_key)
 WHERE COALESCE(bp.status, 'active') = 'active'
ON CONFLICT (business_profile_id, module_key) DO UPDATE
  SET enabled = TRUE,
      updated_at = now();

-- Direct requisition writes must identify CMMS membership by the signed-in
-- user's email. cmms_users.id is a tenant-local ID, not auth.uid(), so the
-- legacy auth.uid() comparison rejected valid users in every Pichin tenant.
DO $$
BEGIN
  IF to_regclass('public.cmms_requisitions') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS pichin_cmms_requisition_member_access ON public.cmms_requisitions';
    EXECUTE $policy$
      CREATE POLICY pichin_cmms_requisition_member_access
      ON public.cmms_requisitions FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.cmms_users cu
          WHERE cu.cmms_company_id = cmms_requisitions.cmms_company_id
            AND cu.is_active = TRUE
            AND lower(cu.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.cmms_users cu
          WHERE cu.cmms_company_id = cmms_requisitions.cmms_company_id
            AND cu.is_active = TRUE
            AND lower(cu.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
      )
    $policy$;
  END IF;

  IF to_regclass('public.cmms_requisition_items') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS pichin_cmms_requisition_items_member_access ON public.cmms_requisition_items';
    EXECUTE $policy$
      CREATE POLICY pichin_cmms_requisition_items_member_access
      ON public.cmms_requisition_items FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.cmms_requisitions requisition
          JOIN public.cmms_users cu ON cu.cmms_company_id = requisition.cmms_company_id
          WHERE requisition.id = cmms_requisition_items.requisition_id
            AND cu.is_active = TRUE
            AND lower(cu.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.cmms_requisitions requisition
          JOIN public.cmms_users cu ON cu.cmms_company_id = requisition.cmms_company_id
          WHERE requisition.id = cmms_requisition_items.requisition_id
            AND cu.is_active = TRUE
            AND lower(cu.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
      )
    $policy$;
  END IF;
END;
$$;

-- Repair existing imported CMMS system roles so module tabs follow the linked
-- business profile's explicit module rows. This removes leaked School Fees
-- access from non-school profiles without touching administrator-created
-- custom roles.
WITH module_access AS (
  SELECT
    business_profile_id,
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
  GROUP BY business_profile_id
)
UPDATE public.cmms_roles role
   SET tool_access = COALESCE(role.tool_access, '{}'::jsonb) || jsonb_build_object(
     'inventory', COALESCE(ma.inventory, false),
     'payroll', COALESCE(ma.payroll, false) AND role.role_name IN ('business_admin', 'finance_approver', 'payroll_officer', 'bursar'),
     'fees', COALESCE(ma.fees, false) AND role.role_name IN ('business_admin', 'head_teacher', 'department_head', 'registrar', 'teacher', 'student', 'bursar'),
     'production', COALESCE(ma.production, false) AND role.role_name IN ('business_admin', 'production_manager', 'storeman', 'technician'),
     'quality', COALESCE(ma.quality, false) AND role.role_name IN ('business_admin', 'quality_manager', 'production_manager'),
     'clinical', COALESCE(ma.clinical, false) AND role.role_name IN ('business_admin', 'clinical_manager'),
     'pharmacy', COALESCE(ma.pharmacy, false) AND role.role_name IN ('business_admin', 'pharmacist', 'inventory_receiver'),
     'transport', COALESCE(ma.transport, false) AND role.role_name IN ('business_admin', 'transport_coordinator', 'fulfilment_manager'),
     'requisitions', COALESCE(ma.requisitions, false),
     'approvals', COALESCE(ma.approvals, ma.requisitions, false) AND role.role_name IN ('business_admin', 'department_head', 'finance_approver', 'head_teacher', 'bursar', 'project_manager'),
     'reports', COALESCE(ma.reports, false),
     'tasks', COALESCE(ma.tasks, false) AND role.role_name IN ('business_admin', 'department_head', 'facility_manager', 'production_manager', 'project_manager', 'site_manager', 'technician', 'storeman')
   ),
       updated_at = now()
  FROM public.cmms_company_profiles company
  LEFT JOIN module_access ma
    ON ma.business_profile_id = company.pichin_business_profile_id
 WHERE role.cmms_company_id = company.id
   AND company.pichin_business_profile_id IS NOT NULL
   AND role.is_system_role = true;

-- Do not make the browser depend on cmms_users_with_roles RLS/view versions.
-- This returns all Pichin business CMMS tenants for the signed-in user.
CREATE OR REPLACE FUNCTION public.cmms_get_my_pichin_business_access()
RETURNS TABLE (
  cmms_user_id UUID,
  cmms_company_id UUID,
  company_name TEXT,
  email TEXT,
  business_profile_id UUID,
  business_type TEXT,
  industry TEXT,
  architecture JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_business_id UUID;
  v_company public.cmms_company_profiles;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User is not authenticated';
  END IF;

  FOR v_business_id IN
    SELECT bp.id
    FROM public.business_profiles bp
    WHERE lower(coalesce(bp.status, 'active')) NOT IN ('inactive', 'suspended', 'rejected', 'deleted')
      AND (
        bp.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.business_co_owners co
          WHERE co.business_profile_id = bp.id
            AND (co.user_id = auth.uid() OR lower(co.owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
            AND lower(coalesce(co.status, 'active')) IN ('active', 'approved', 'verified')
            AND (co.ownership_share > 0 OR lower(coalesce(co.role, '')) IN ('owner', 'co-owner', 'shareholder', 'ceo', 'administrator'))
        )
      )
  LOOP
    SELECT public.cmms_ensure_pichin_business_access(v_business_id) INTO v_company;

    RETURN QUERY
    SELECT cu.id, v_company.id, v_company.company_name::TEXT, cu.email::TEXT,
           v_business_id, v_company.pichin_business_type,
           v_company.industry::TEXT, v_company.architecture
    FROM public.cmms_users cu
    WHERE cu.cmms_company_id = v_company.id
      AND lower(cu.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      AND cu.is_active = TRUE;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_get_my_pichin_business_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_get_my_pichin_business_access() TO authenticated;
