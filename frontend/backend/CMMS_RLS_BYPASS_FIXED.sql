-- ================================================================
-- CMMS: FIX EXISTING FUNCTIONS - Add SET row_security = OFF
-- ================================================================
-- These functions already exist but need RLS bypass added
-- We'll re-create them with the correct settings

-- Step 1: Drop all existing CMMS functions
DROP FUNCTION IF EXISTS public.fn_create_cmms_department(uuid, character varying, text, character varying) CASCADE;
DROP FUNCTION IF EXISTS public.fn_update_cmms_department(uuid, character varying, text, character varying, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.fn_delete_cmms_department(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.fn_create_cmms_company(character varying, character varying, character varying, character varying, character varying) CASCADE;
DROP FUNCTION IF EXISTS public.fn_update_cmms_company(uuid, character varying, character varying, character varying, character varying, character varying) CASCADE;
DROP FUNCTION IF EXISTS public.fn_get_cmms_company(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.fn_create_cmms_company_with_departments(character varying, character varying, character varying, character varying, character varying, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.fn_get_departments_by_company(uuid) CASCADE;

-- Step 2: Re-create functions with SET row_security = OFF

-- Function 1: Create Department
CREATE FUNCTION public.fn_create_cmms_department(
  p_company_id uuid,
  p_department_name character varying,
  p_description text,
  p_location character varying
)
RETURNS TABLE(department_id uuid, status character varying, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET row_security = OFF
AS $$
DECLARE
  v_dept_id uuid;
  v_user_id uuid;
BEGIN
  SELECT auth.uid() INTO v_user_id;
  
  INSERT INTO public.cmms_departments (cmms_company_id, department_name, description, location, created_by)
  VALUES (p_company_id, p_department_name, p_description, p_location, v_user_id)
  RETURNING id INTO v_dept_id;
  
  RETURN QUERY SELECT v_dept_id, 'SUCCESS'::character varying, 'Department created successfully'::text;
EXCEPTION 
  WHEN unique_violation THEN
    RETURN QUERY SELECT NULL::uuid, 'ERROR'::character varying, 'Department name already exists in this company'::text;
  WHEN OTHERS THEN
    RETURN QUERY SELECT NULL::uuid, 'ERROR'::character varying, SQLERRM::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_create_cmms_department(uuid, character varying, text, character varying) TO authenticated;

-- Function 2: Update Department
CREATE FUNCTION public.fn_update_cmms_department(
  p_department_id uuid,
  p_department_name character varying,
  p_description text,
  p_location character varying,
  p_is_active boolean
)
RETURNS TABLE(status character varying, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET row_security = OFF
AS $$
BEGIN
  UPDATE public.cmms_departments
  SET
    department_name = COALESCE(p_department_name, department_name),
    description = COALESCE(p_description, description),
    location = COALESCE(p_location, location),
    is_active = COALESCE(p_is_active, is_active),
    updated_at = NOW()
  WHERE id = p_department_id;
  
  IF FOUND THEN
    RETURN QUERY SELECT 'SUCCESS'::character varying, 'Department updated successfully'::text;
  ELSE
    RETURN QUERY SELECT 'ERROR'::character varying, 'Department not found'::text;
  END IF;
EXCEPTION 
  WHEN unique_violation THEN
    RETURN QUERY SELECT 'ERROR'::character varying, 'Department name already exists in this company'::text;
  WHEN OTHERS THEN
    RETURN QUERY SELECT 'ERROR'::character varying, SQLERRM::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_update_cmms_department(uuid, character varying, text, character varying, boolean) TO authenticated;

-- Function 3: Delete Department
CREATE FUNCTION public.fn_delete_cmms_department(p_department_id uuid)
RETURNS TABLE(status character varying, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET row_security = OFF
AS $$
BEGIN
  UPDATE public.cmms_departments SET is_active = FALSE, updated_at = NOW() WHERE id = p_department_id;
  
  IF FOUND THEN
    UPDATE public.cmms_inventory_items SET is_active = FALSE, updated_at = NOW() WHERE department_id = p_department_id;
    RETURN QUERY SELECT 'SUCCESS'::character varying, 'Department deleted successfully'::text;
  ELSE
    RETURN QUERY SELECT 'ERROR'::character varying, 'Department not found'::text;
  END IF;
EXCEPTION 
  WHEN OTHERS THEN
    RETURN QUERY SELECT 'ERROR'::character varying, SQLERRM::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_delete_cmms_department(uuid) TO authenticated;

-- Function 4: Create Company
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
SET row_security = OFF
AS $$
DECLARE
  v_company_id uuid;
  v_user_id uuid;
BEGIN
  SELECT auth.uid() INTO v_user_id;
  
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

GRANT EXECUTE ON FUNCTION public.fn_create_cmms_company(character varying, character varying, character varying, character varying, character varying) TO authenticated;

-- Function 5: Update Company
CREATE FUNCTION public.fn_update_cmms_company(
  p_company_id uuid,
  p_company_name character varying,
  p_company_registration character varying,
  p_location character varying,
  p_email character varying,
  p_phone character varying
)
RETURNS TABLE(status character varying, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET row_security = OFF
AS $$
BEGIN
  UPDATE public.cmms_company_profiles
  SET
    company_name = COALESCE(p_company_name, company_name),
    company_registration = COALESCE(p_company_registration, company_registration),
    location = COALESCE(p_location, location),
    email = COALESCE(p_email, email),
    phone = COALESCE(p_phone, phone),
    updated_at = NOW()
  WHERE id = p_company_id;
  
  IF FOUND THEN
    RETURN QUERY SELECT 'SUCCESS'::character varying, 'Company updated successfully'::text;
  ELSE
    RETURN QUERY SELECT 'ERROR'::character varying, 'Company not found'::text;
  END IF;
EXCEPTION 
  WHEN unique_violation THEN
    RETURN QUERY SELECT 'ERROR'::character varying, 'Company email already exists'::text;
  WHEN OTHERS THEN
    RETURN QUERY SELECT 'ERROR'::character varying, SQLERRM::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_update_cmms_company(uuid, character varying, character varying, character varying, character varying, character varying) TO authenticated;

-- Function 6: Get Company
CREATE FUNCTION public.fn_get_cmms_company(p_company_id uuid)
RETURNS TABLE(id uuid, company_name character varying, company_registration character varying, location character varying, email character varying, phone character varying, website character varying, is_active boolean, created_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET row_security = OFF
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cp.id,
    cp.company_name,
    cp.company_registration,
    cp.location,
    cp.email,
    cp.phone,
    cp.website,
    cp.is_active,
    cp.created_at
  FROM public.cmms_company_profiles cp
  WHERE cp.id = p_company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_cmms_company(uuid) TO authenticated;

-- Function 7: Create Company with Departments (Atomic)
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
SET row_security = OFF
AS $$
DECLARE
  v_company_id uuid;
  v_user_id uuid;
  v_dept_count integer := 0;
  v_dept_item jsonb;
BEGIN
  SELECT auth.uid() INTO v_user_id;
  
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

GRANT EXECUTE ON FUNCTION public.fn_create_cmms_company_with_departments(character varying, character varying, character varying, character varying, character varying, jsonb) TO authenticated;

-- Function 8: Get Departments by Company
CREATE FUNCTION public.fn_get_departments_by_company(p_company_id uuid)
RETURNS TABLE(id uuid, company_id uuid, department_name character varying, description text, location character varying, is_active boolean, created_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET row_security = OFF
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cd.id,
    cd.cmms_company_id,
    cd.department_name,
    cd.description,
    cd.location,
    cd.is_active,
    cd.created_at
  FROM public.cmms_departments cd
  WHERE cd.cmms_company_id = p_company_id
  AND cd.is_active = TRUE
  ORDER BY cd.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_departments_by_company(uuid) TO authenticated;

-- ================================================================
-- VERIFICATION
-- ================================================================
SELECT 'CMMS functions created with RLS bypass!' as status;

SELECT 
  routine_name,
  routine_definition LIKE '%SET row_security = OFF%' as has_rls_bypass
FROM information_schema.routines
WHERE routine_name LIKE 'fn_create_cmms_%'
   OR routine_name LIKE 'fn_update_cmms_%'
   OR routine_name LIKE 'fn_delete_cmms_%'
   OR routine_name LIKE 'fn_get_cmms_%'
   OR routine_name LIKE 'fn_get_departments%'
AND routine_schema = 'public'
ORDER BY routine_name;
