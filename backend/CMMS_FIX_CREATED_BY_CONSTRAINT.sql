-- ================================================================
-- FIX: Remove/Fix created_by foreign key constraint if it exists
-- ================================================================

-- First, try to drop the constraint if it exists
ALTER TABLE public.cmms_departments
DROP CONSTRAINT IF EXISTS cmms_departments_created_by_fkey CASCADE;

ALTER TABLE public.cmms_company_profiles
DROP CONSTRAINT IF EXISTS cmms_company_profiles_created_by_fkey CASCADE;

-- Ensure created_by columns allow NULL
-- (They are already nullable, but this ensures consistency)
-- No need to alter - they're already nullable in the schema

-- ================================================================
-- Redeploy fn_create_cmms_department with NULL handling
-- ================================================================

DROP FUNCTION IF EXISTS public.fn_create_cmms_department(uuid, character varying, text, character varying) CASCADE;

CREATE FUNCTION public.fn_create_cmms_department(
  p_company_id uuid,
  p_department_name character varying,
  p_description text,
  p_location character varying
)
RETURNS TABLE(department_id uuid, status character varying, message text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_dept_id uuid;
  v_user_id uuid;
BEGIN
  -- Attempt to get current user ID (may be NULL)
  v_user_id := auth.uid();
  
  -- Validate company exists
  IF NOT EXISTS(SELECT 1 FROM public.cmms_company_profiles WHERE id = p_company_id) THEN
    RETURN QUERY SELECT NULL::uuid, 'ERROR'::character varying, 'Company does not exist'::text;
    RETURN;
  END IF;
  
  -- Insert department with user_id (NULL is acceptable)
  INSERT INTO public.cmms_departments (
    cmms_company_id, 
    department_name, 
    description, 
    location, 
    created_by
  )
  VALUES (p_company_id, p_department_name, p_description, p_location, v_user_id)
  RETURNING id INTO v_dept_id;
  
  RETURN QUERY SELECT v_dept_id, 'SUCCESS'::character varying, 'Department created successfully'::text;
  
EXCEPTION 
  WHEN unique_violation THEN
    RETURN QUERY SELECT NULL::uuid, 'ERROR'::character varying, 'Department name already exists in this company'::text;
  WHEN foreign_key_violation THEN
    RETURN QUERY SELECT NULL::uuid, 'ERROR'::character varying, 'Invalid company ID'::text;
  WHEN OTHERS THEN
    RETURN QUERY SELECT NULL::uuid, 'ERROR'::character varying, SQLERRM::text;
END;
$$;

ALTER FUNCTION public.fn_create_cmms_department(uuid, character varying, text, character varying) 
  SET row_security = OFF;

GRANT EXECUTE ON FUNCTION public.fn_create_cmms_department(uuid, character varying, text, character varying) TO authenticated;

-- ================================================================
-- Redeploy fn_create_cmms_company with NULL handling
-- ================================================================

DROP FUNCTION IF EXISTS public.fn_create_cmms_company(character varying, character varying, character varying, character varying, character varying) CASCADE;

CREATE FUNCTION public.fn_create_cmms_company(
  p_company_name character varying,
  p_company_registration character varying,
  p_location character varying,
  p_email character varying,
  p_phone character varying
)
RETURNS TABLE(company_id uuid, status character varying, message text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_company_id uuid;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  
  INSERT INTO public.cmms_company_profiles (
    company_name, company_registration, location, email, phone, created_by
  )
  VALUES (p_company_name, p_company_registration, p_location, p_email, p_phone, v_user_id)
  RETURNING id INTO v_company_id;
  
  RETURN QUERY SELECT v_company_id, 'SUCCESS'::character varying, 'Company created successfully'::text;
EXCEPTION 
  WHEN unique_violation THEN
    RETURN QUERY SELECT NULL::uuid, 'ERROR'::character varying, 'Company email already exists'::text;
  WHEN OTHERS THEN
    RETURN QUERY SELECT NULL::uuid, 'ERROR'::character varying, SQLERRM::text;
END;
$$;

ALTER FUNCTION public.fn_create_cmms_company(character varying, character varying, character varying, character varying, character varying) 
  SET row_security = OFF;

GRANT EXECUTE ON FUNCTION public.fn_create_cmms_company(character varying, character varying, character varying, character varying, character varying) TO authenticated;

-- ================================================================
-- Redeploy fn_create_cmms_company_with_departments
-- ================================================================

DROP FUNCTION IF EXISTS public.fn_create_cmms_company_with_departments(character varying, character varying, character varying, character varying, character varying, jsonb) CASCADE;

CREATE FUNCTION public.fn_create_cmms_company_with_departments(
  p_company_name character varying,
  p_company_registration character varying,
  p_location character varying,
  p_email character varying,
  p_phone character varying,
  p_departments jsonb DEFAULT NULL
)
RETURNS TABLE(company_id uuid, departments_created integer, status character varying, message text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_company_id uuid;
  v_user_id uuid;
  v_dept_count integer := 0;
  v_dept_item jsonb;
BEGIN
  v_user_id := auth.uid();
  
  INSERT INTO public.cmms_company_profiles (
    company_name, company_registration, location, email, phone, created_by
  )
  VALUES (p_company_name, p_company_registration, p_location, p_email, p_phone, v_user_id)
  RETURNING id INTO v_company_id;
  
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
  
  RETURN QUERY SELECT v_company_id, v_dept_count, 'SUCCESS'::character varying, 
    ('Company created with ' || v_dept_count || ' department(s)')::text;
EXCEPTION 
  WHEN unique_violation THEN
    RETURN QUERY SELECT NULL::uuid, 0, 'ERROR'::character varying, 'Company email already exists'::text;
  WHEN OTHERS THEN
    RETURN QUERY SELECT NULL::uuid, 0, 'ERROR'::character varying, SQLERRM::text;
END;
$$;

ALTER FUNCTION public.fn_create_cmms_company_with_departments(character varying, character varying, character varying, character varying, character varying, jsonb) 
  SET row_security = OFF;

GRANT EXECUTE ON FUNCTION public.fn_create_cmms_company_with_departments(character varying, character varying, character varying, character varying, character varying, jsonb) TO authenticated;

-- ================================================================
-- VERIFICATION
-- ================================================================

SELECT 'Created-by constraints fixed and functions redeployed!' as status;
