-- ============================================================
-- CMMS FIX: Add SET row_security = OFF to all admin functions
-- ============================================================
-- Issue: Admin functions need to bypass RLS to perform operations
-- Solution: Add SET row_security = OFF to function definitions

-- ============================================================
-- DROP EXISTING FUNCTIONS (Required if return types changed)
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_create_cmms_department(UUID, VARCHAR, TEXT, VARCHAR) CASCADE;
DROP FUNCTION IF EXISTS public.fn_update_cmms_department(UUID, VARCHAR, TEXT, VARCHAR, BOOLEAN) CASCADE;
DROP FUNCTION IF EXISTS public.fn_delete_cmms_department(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.fn_create_cmms_company(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) CASCADE;
DROP FUNCTION IF EXISTS public.fn_update_cmms_company(UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) CASCADE;
DROP FUNCTION IF EXISTS public.fn_get_cmms_company(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.fn_create_cmms_company_with_departments(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB) CASCADE;
DROP FUNCTION IF EXISTS public.fn_get_departments_by_company(UUID) CASCADE;

-- ============================================================
-- 1. FIX: CREATE DEPARTMENT FUNCTION
-- ============================================================

CREATE FUNCTION public.fn_create_cmms_department(
  p_company_id UUID,
  p_department_name VARCHAR,
  p_description TEXT,
  p_location VARCHAR
)
RETURNS TABLE(
  department_id UUID,
  status VARCHAR,
  message TEXT
) AS $$
DECLARE
  v_dept_id UUID;
  v_user_id UUID;
BEGIN
  SELECT auth.uid() INTO v_user_id;
  
  INSERT INTO public.cmms_departments (cmms_company_id, department_name, description, location, created_by)
  VALUES (p_company_id, p_department_name, p_description, p_location, v_user_id)
  RETURNING id INTO v_dept_id;
  
  RETURN QUERY SELECT v_dept_id, 'SUCCESS'::VARCHAR, 'Department created successfully'::TEXT;
EXCEPTION 
  WHEN unique_violation THEN
    RETURN QUERY SELECT NULL::UUID, 'ERROR'::VARCHAR, 'Department name already exists in this company'::TEXT;
  WHEN OTHERS THEN
    RETURN QUERY SELECT NULL::UUID, 'ERROR'::VARCHAR, SQLERRM::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET row_security = OFF;

GRANT EXECUTE ON FUNCTION public.fn_create_cmms_department(UUID, VARCHAR, TEXT, VARCHAR) TO authenticated;

-- ============================================================
-- 2. FIX: UPDATE DEPARTMENT FUNCTION
-- ============================================================

CREATE FUNCTION public.fn_update_cmms_department(
  p_department_id UUID,
  p_department_name VARCHAR,
  p_description TEXT,
  p_location VARCHAR,
  p_is_active BOOLEAN
)
RETURNS TABLE(
  status VARCHAR,
  message TEXT
) AS $$
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
    RETURN QUERY SELECT 'SUCCESS'::VARCHAR, 'Department updated successfully'::TEXT;
  ELSE
    RETURN QUERY SELECT 'ERROR'::VARCHAR, 'Department not found'::TEXT;
  END IF;
EXCEPTION 
  WHEN unique_violation THEN
    RETURN QUERY SELECT 'ERROR'::VARCHAR, 'Department name already exists in this company'::TEXT;
  WHEN OTHERS THEN
    RETURN QUERY SELECT 'ERROR'::VARCHAR, SQLERRM::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET row_security = OFF;

GRANT EXECUTE ON FUNCTION public.fn_update_cmms_department(UUID, VARCHAR, TEXT, VARCHAR, BOOLEAN) TO authenticated;

-- ============================================================
-- 3. FIX: DELETE DEPARTMENT FUNCTION (Soft Delete)
-- ============================================================

CREATE FUNCTION public.fn_delete_cmms_department(
  p_department_id UUID
)
RETURNS TABLE(
  status VARCHAR,
  message TEXT
) AS $$
BEGIN
  UPDATE public.cmms_departments SET is_active = FALSE, updated_at = NOW() WHERE id = p_department_id;
  
  IF FOUND THEN
    UPDATE public.cmms_inventory_items SET is_active = FALSE, updated_at = NOW() WHERE department_id = p_department_id;
    RETURN QUERY SELECT 'SUCCESS'::VARCHAR, 'Department deleted successfully'::TEXT;
  ELSE
    RETURN QUERY SELECT 'ERROR'::VARCHAR, 'Department not found'::TEXT;
  END IF;
EXCEPTION 
  WHEN OTHERS THEN
    RETURN QUERY SELECT 'ERROR'::VARCHAR, SQLERRM::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET row_security = OFF;

GRANT EXECUTE ON FUNCTION public.fn_delete_cmms_department(UUID) TO authenticated;

-- ============================================================
-- 4. FIX: CREATE COMPANY FUNCTION
-- ============================================================

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
BEGIN
  SELECT auth.uid() INTO v_user_id;
  
  INSERT INTO public.cmms_company_profiles (
    company_name, company_registration, location, email, phone, created_by
  )
  VALUES (p_company_name, p_company_registration, p_location, p_email, p_phone, v_user_id)
  RETURNING id INTO v_company_id;
  
  RETURN QUERY SELECT v_company_id, 'SUCCESS'::VARCHAR, 'Company created successfully'::TEXT;
EXCEPTION 
  WHEN unique_violation THEN
    RETURN QUERY SELECT NULL::UUID, 'ERROR'::VARCHAR, 'Company email already exists'::TEXT;
  WHEN OTHERS THEN
    RETURN QUERY SELECT NULL::UUID, 'ERROR'::VARCHAR, SQLERRM::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET row_security = OFF;

GRANT EXECUTE ON FUNCTION public.fn_create_cmms_company(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) TO authenticated;

-- ============================================================
-- 4B. FIX: UPDATE COMPANY FUNCTION
-- ============================================================

CREATE FUNCTION public.fn_update_cmms_company(
  p_company_id UUID,
  p_company_name VARCHAR,
  p_company_registration VARCHAR,
  p_location VARCHAR,
  p_email VARCHAR,
  p_phone VARCHAR
)
RETURNS TABLE(
  status VARCHAR,
  message TEXT
) AS $$
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
    RETURN QUERY SELECT 'SUCCESS'::VARCHAR, 'Company updated successfully'::TEXT;
  ELSE
    RETURN QUERY SELECT 'ERROR'::VARCHAR, 'Company not found'::TEXT;
  END IF;
EXCEPTION 
  WHEN unique_violation THEN
    RETURN QUERY SELECT 'ERROR'::VARCHAR, 'Company email already exists'::TEXT;
  WHEN OTHERS THEN
    RETURN QUERY SELECT 'ERROR'::VARCHAR, SQLERRM::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET row_security = OFF;

GRANT EXECUTE ON FUNCTION public.fn_update_cmms_company(UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) TO authenticated;

-- ============================================================
-- 4C. FIX: GET COMPANY BY ID FUNCTION
-- ============================================================

CREATE FUNCTION public.fn_get_cmms_company(
  p_company_id UUID
)
RETURNS TABLE(
  id UUID,
  company_name VARCHAR,
  company_registration VARCHAR,
  location VARCHAR,
  email VARCHAR,
  phone VARCHAR,
  website VARCHAR,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ
) AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET row_security = OFF;

GRANT EXECUTE ON FUNCTION public.fn_get_cmms_company(UUID) TO authenticated;

-- ============================================================
-- 5. FIX: CREATE COMPANY WITH DEPARTMENTS (ATOMIC TRANSACTION)
-- ============================================================

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
  v_dept_count INTEGER := 0;
  v_dept_item JSONB;
BEGIN
  SELECT auth.uid() INTO v_user_id;
  
  -- CREATE COMPANY
  INSERT INTO public.cmms_company_profiles (
    company_name, company_registration, location, email, phone, created_by
  )
  VALUES (p_company_name, p_company_registration, p_location, p_email, p_phone, v_user_id)
  RETURNING id INTO v_company_id;
  
  -- CREATE DEPARTMENTS IF PROVIDED
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
  WHEN unique_violation THEN
    RETURN QUERY SELECT NULL::UUID, 0, 'ERROR'::VARCHAR, 'Company email already exists'::TEXT;
  WHEN OTHERS THEN
    RETURN QUERY SELECT NULL::UUID, 0, 'ERROR'::VARCHAR, SQLERRM::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET row_security = OFF;

GRANT EXECUTE ON FUNCTION public.fn_create_cmms_company_with_departments(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB) TO authenticated;

-- ============================================================
-- 6. FIX: GET DEPARTMENTS BY COMPANY (READ WITH RLS BYPASS)
-- ============================================================

CREATE FUNCTION public.fn_get_departments_by_company(
  p_company_id UUID
)
RETURNS TABLE(
  id UUID,
  company_id UUID,
  department_name VARCHAR,
  description TEXT,
  location VARCHAR,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ
) AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET row_security = OFF;

GRANT EXECUTE ON FUNCTION public.fn_get_departments_by_company(UUID) TO authenticated;

-- ============================================================
-- 7. VERIFICATION
-- ============================================================

SELECT 'All functions updated with SET row_security = OFF' as status;

SELECT 
  routine_name,
  routine_definition LIKE '%SET row_security = OFF%' as has_rls_bypass
FROM information_schema.routines
WHERE routine_name LIKE 'fn_%'
AND routine_schema = 'public'
AND routine_type = 'FUNCTION'
ORDER BY routine_name;
