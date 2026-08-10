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

CREATE INDEX IF NOT EXISTS idx_cmms_company_email_lookup
  ON public.cmms_company_profiles(lower(email));
CREATE INDEX IF NOT EXISTS idx_cmms_company_one_per_pichin_profile
  ON public.cmms_company_profiles(pichin_business_profile_id)
  WHERE pichin_business_profile_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.cmms_business_type_architecture(p_business_type TEXT)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(coalesce(p_business_type, '')) IN ('factory', 'manufacturing', 'industrial') THEN
      jsonb_build_object('industry', 'Manufacturing', 'departments', jsonb_build_array('Production', 'Maintenance', 'Quality Assurance', 'Operations', 'Warehouse'))
    WHEN lower(coalesce(p_business_type, '')) IN ('wholesale', 'hardware', 'supermarket', 'retail', 'shop') THEN
      jsonb_build_object('industry', 'Retail', 'departments', jsonb_build_array('Store Operations', 'Purchasing', 'Warehouse', 'Sales', 'Maintenance'))
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
  WHERE bp.id = p_business_profile_id AND bp.status = 'active'
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

  v_business_type := lower(coalesce(v_profile.business_type, 'other'));
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

  SELECT id INTO v_admin_role_id FROM public.cmms_roles
  WHERE lower(role_name) IN ('admin', 'administrator', 'cmms_admin')
  ORDER BY permission_level DESC NULLS LAST LIMIT 1;

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

  RETURN v_company;
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_ensure_pichin_business_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_ensure_pichin_business_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_business_type_architecture(TEXT) TO authenticated;

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
    WHERE bp.status = 'active'
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
