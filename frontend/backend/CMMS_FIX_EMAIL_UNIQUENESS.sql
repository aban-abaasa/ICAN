-- ============================================================
-- CMMS FIX: Allow any user to create a company profile
-- regardless of email or company_registration reuse,
-- and auto-enroll the creator as admin in cmms_users.
-- ============================================================
-- Run this in Supabase SQL Editor.

-- Step 1: Drop UNIQUE constraint on email
ALTER TABLE IF EXISTS public.cmms_company_profiles
  DROP CONSTRAINT IF EXISTS cmms_company_profiles_email_key;

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
  WHERE c.conrelid = 'public.cmms_company_profiles'::regclass
    AND c.contype = 'u'
    AND a.attname = 'email';
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.cmms_company_profiles DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint_name);
    RAISE NOTICE 'Dropped unique constraint % on cmms_company_profiles.email', v_constraint_name;
  END IF;
END $$;

-- Step 2: Drop UNIQUE constraint on company_registration
ALTER TABLE IF EXISTS public.cmms_company_profiles
  DROP CONSTRAINT IF EXISTS cmms_company_profiles_company_registration_key;

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
  WHERE c.conrelid = 'public.cmms_company_profiles'::regclass
    AND c.contype = 'u'
    AND a.attname = 'company_registration';
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.cmms_company_profiles DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint_name);
    RAISE NOTICE 'Dropped unique constraint % on cmms_company_profiles.company_registration', v_constraint_name;
  END IF;
END $$;

-- Step 3: Recreate fn_create_cmms_company_with_departments.
-- Changes vs original:
--   • No unique_violation handler (constraints removed above).
--   • Creator is auto-inserted into cmms_users as 'admin' with is_creator=TRUE
--     so all membership-gated RPCs and RLS policies work immediately.
DROP FUNCTION IF EXISTS public.fn_create_cmms_company_with_departments(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB) CASCADE;

CREATE FUNCTION public.fn_create_cmms_company_with_departments(
  p_company_name VARCHAR,
  p_company_registration VARCHAR,
  p_location VARCHAR,
  p_email VARCHAR,
  p_phone VARCHAR,
  p_departments JSONB DEFAULT NULL
)
RETURNS TABLE(
  company_id UUID,
  departments_created INTEGER,
  status VARCHAR,
  message TEXT
) AS $$
DECLARE
  v_company_id UUID;
  v_user_id UUID;
  v_user_email TEXT;
  v_user_name TEXT;
  v_dept_count INTEGER := 0;
  v_dept_item JSONB;
BEGIN
  v_user_id := auth.uid();

  -- Resolve creator email and display name from auth
  SELECT
    COALESCE(NULLIF(TRIM(au.email), ''), p_email),
    COALESCE(
      NULLIF(TRIM(au.raw_user_meta_data->>'full_name'), ''),
      NULLIF(TRIM(au.raw_user_meta_data->>'name'), ''),
      SPLIT_PART(au.email, '@', 1),
      'Admin'
    )
  INTO v_user_email, v_user_name
  FROM auth.users au
  WHERE au.id = v_user_id;

  -- Create the company
  INSERT INTO public.cmms_company_profiles (
    company_name, company_registration, location, email, phone, created_by
  )
  VALUES (p_company_name, p_company_registration, p_location, p_email, p_phone, v_user_id)
  RETURNING id INTO v_company_id;

  -- Auto-enroll creator as admin so all membership checks pass immediately
  INSERT INTO public.cmms_users (
    cmms_company_id, user_name, email, phone, role, is_active, is_creator
  )
  VALUES (
    v_company_id,
    v_user_name,
    v_user_email,
    p_phone,
    'admin',
    TRUE,
    TRUE
  )
  ON CONFLICT (cmms_company_id, email) DO UPDATE
    SET role = 'admin', is_active = TRUE, is_creator = TRUE, updated_at = NOW();

  -- Create departments if provided
  IF p_departments IS NOT NULL AND jsonb_array_length(p_departments) > 0 THEN
    FOR v_dept_item IN SELECT * FROM jsonb_array_elements(p_departments)
    LOOP
      INSERT INTO public.cmms_departments (
        cmms_company_id, department_name, description, location, created_by
      )
      VALUES (
        v_company_id,
        v_dept_item->>'department_name',
        v_dept_item->>'description',
        COALESCE(v_dept_item->>'location', ''),
        v_user_id
      );
      v_dept_count := v_dept_count + 1;
    END LOOP;
  END IF;

  RETURN QUERY SELECT v_company_id, v_dept_count, 'SUCCESS'::VARCHAR,
    'Company created with ' || v_dept_count || ' department(s)'::TEXT;
EXCEPTION
  WHEN OTHERS THEN
    RETURN QUERY SELECT NULL::UUID, 0, 'ERROR'::VARCHAR, SQLERRM::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET row_security = OFF;

GRANT EXECUTE ON FUNCTION public.fn_create_cmms_company_with_departments(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB) TO authenticated;

-- Step 4: Recreate fn_create_cmms_company (single-company variant) with same creator auto-enroll
DROP FUNCTION IF EXISTS public.fn_create_cmms_company(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) CASCADE;

CREATE FUNCTION public.fn_create_cmms_company(
  p_company_name VARCHAR,
  p_company_registration VARCHAR,
  p_location VARCHAR,
  p_email VARCHAR,
  p_phone VARCHAR
)
RETURNS TABLE(
  company_id UUID,
  status VARCHAR,
  message TEXT
) AS $$
DECLARE
  v_company_id UUID;
  v_user_id UUID;
  v_user_email TEXT;
  v_user_name TEXT;
BEGIN
  v_user_id := auth.uid();

  SELECT
    COALESCE(NULLIF(TRIM(au.email), ''), p_email),
    COALESCE(
      NULLIF(TRIM(au.raw_user_meta_data->>'full_name'), ''),
      NULLIF(TRIM(au.raw_user_meta_data->>'name'), ''),
      SPLIT_PART(au.email, '@', 1),
      'Admin'
    )
  INTO v_user_email, v_user_name
  FROM auth.users au
  WHERE au.id = v_user_id;

  INSERT INTO public.cmms_company_profiles (
    company_name, company_registration, location, email, phone, created_by
  )
  VALUES (p_company_name, p_company_registration, p_location, p_email, p_phone, v_user_id)
  RETURNING id INTO v_company_id;

  INSERT INTO public.cmms_users (
    cmms_company_id, user_name, email, phone, role, is_active, is_creator
  )
  VALUES (v_company_id, v_user_name, v_user_email, p_phone, 'admin', TRUE, TRUE)
  ON CONFLICT (cmms_company_id, email) DO UPDATE
    SET role = 'admin', is_active = TRUE, is_creator = TRUE, updated_at = NOW();

  RETURN QUERY SELECT v_company_id, 'SUCCESS'::VARCHAR, 'Company created successfully'::TEXT;
EXCEPTION
  WHEN OTHERS THEN
    RETURN QUERY SELECT NULL::UUID, 'ERROR'::VARCHAR, SQLERRM::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET row_security = OFF;

GRANT EXECUTE ON FUNCTION public.fn_create_cmms_company(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) TO authenticated;

-- Step 5: Fix fn_get_company_reports to allow any active member (not just specific roles).
-- Must DROP first — CREATE OR REPLACE cannot modify SET options on an existing function.
DROP FUNCTION IF EXISTS public.fn_get_company_reports(UUID) CASCADE;

CREATE FUNCTION public.fn_get_company_reports(p_company_id UUID)
RETURNS SETOF public.cmms_company_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = OFF
AS $$
DECLARE
  v_auth_uid UUID;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Allow any active member of the company (creator gets 'admin' role automatically)
  IF NOT EXISTS (
    SELECT 1
    FROM public.cmms_users cu
    JOIN auth.users au ON LOWER(cu.email) = LOWER(au.email)
    WHERE au.id = v_auth_uid
      AND cu.cmms_company_id = p_company_id
      AND cu.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'You are not a member of this CMMS company';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.cmms_company_reports
  WHERE cmms_company_id = p_company_id
  ORDER BY created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_company_reports TO authenticated;

-- Step 6: Fix fn_get_filtered_reports — column 15 (access_level) was declared VARCHAR
-- but the CASE expression returns TEXT. Cast it explicitly.
DROP FUNCTION IF EXISTS public.fn_get_filtered_reports(UUID) CASCADE;

CREATE FUNCTION public.fn_get_filtered_reports(p_company_id UUID)
RETURNS TABLE (
  id UUID,
  report_title TEXT,
  report_category VARCHAR,
  severity VARCHAR,
  report_body TEXT,
  status VARCHAR,
  reporter_name VARCHAR,
  reporter_email VARCHAR,
  reporter_role VARCHAR,
  department_id UUID,
  visibility_level VARCHAR,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  is_own_report BOOLEAN,
  access_level VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = OFF
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
  v_cmms_user_id UUID;
  v_cmms_role TEXT;
  v_department_id UUID;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email FROM auth.users WHERE id = v_auth_uid;
  END IF;

  SELECT cu.id, LOWER(COALESCE(cu.role, 'member')), cu.department_id
  INTO v_cmms_user_id, v_cmms_role, v_department_id
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_cmms_user_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this CMMS company';
  END IF;

  RETURN QUERY
  SELECT
    ccr.id,
    ccr.report_title,
    ccr.report_category,
    ccr.severity,
    ccr.report_body,
    ccr.status,
    ccr.reporter_name,
    ccr.reporter_email,
    ccr.reporter_role,
    ccr.department_id,
    ccr.visibility_level,
    ccr.created_at,
    ccr.updated_at,
    (ccr.reporter_cmms_user_id = v_cmms_user_id)::BOOLEAN AS is_own_report,
    CASE
      WHEN v_cmms_role = 'admin' THEN 'admin_full_access'
      WHEN v_cmms_role IN ('coordinator', 'supervisor') AND ccr.department_id = v_department_id THEN 'department_access'
      WHEN ccr.reporter_cmms_user_id = v_cmms_user_id THEN 'personal_access'
      ELSE 'no_access'
    END::VARCHAR AS access_level
  FROM public.cmms_company_reports ccr
  WHERE ccr.cmms_company_id = p_company_id
    AND (
      v_cmms_role = 'admin'
      OR (v_cmms_role IN ('coordinator', 'supervisor') AND ccr.department_id = v_department_id)
      OR ccr.reporter_cmms_user_id = v_cmms_user_id
    )
  ORDER BY ccr.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_filtered_reports TO authenticated;

SELECT 'CMMS fix applied: unique constraints removed, creator auto-enrolled as admin, report access opened to all members, fn_get_filtered_reports type fixed' AS status;
