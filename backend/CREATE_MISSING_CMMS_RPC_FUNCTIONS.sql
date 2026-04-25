-- ============================================================
-- CREATE MISSING CMMS RPC FUNCTIONS
-- ============================================================
-- These are the RPC functions referenced in cmmsService.js
-- that need to exist for the frontend to work properly
-- ============================================================

-- ============================================================
-- RPC: Get Departments by Company
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_get_departments_by_company(p_company_id UUID)
RETURNS TABLE (
  id UUID,
  cmms_company_id UUID,
  department_name VARCHAR,
  description TEXT,
  location TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email
    FROM auth.users
    WHERE id = v_auth_uid;
  END IF;

  -- Verify user is part of this company
  IF NOT EXISTS (
    SELECT 1 FROM public.cmms_users cu
    WHERE cu.cmms_company_id = p_company_id
      AND LOWER(cu.email) = LOWER(v_auth_email)
      AND cu.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'You are not a member of this CMMS company';
  END IF;

  -- Return all departments for the company
  RETURN QUERY
  SELECT d.id, d.cmms_company_id, d.department_name, d.description, 
         d.location, d.is_active, d.created_at, d.updated_at
  FROM public.cmms_departments d
  WHERE d.cmms_company_id = p_company_id
  ORDER BY d.department_name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_departments_by_company TO authenticated;

-- ============================================================
-- RPC: Update CMMS Department
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_update_cmms_department(
  p_department_id UUID,
  p_department_name VARCHAR DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_location TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
)
RETURNS TABLE (
  status VARCHAR,
  message TEXT,
  id UUID,
  cmms_company_id UUID,
  department_name VARCHAR,
  description TEXT,
  location TEXT,
  is_active BOOLEAN,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
  v_company_id UUID;
  v_user_role TEXT;
  v_updated_rows INT;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email
    FROM auth.users
    WHERE id = v_auth_uid;
  END IF;

  -- Get the company and verify access
  SELECT d.cmms_company_id INTO v_company_id
  FROM public.cmms_departments d
  WHERE d.id = p_department_id;

  IF v_company_id IS NULL THEN
    RETURN QUERY SELECT 'ERROR'::VARCHAR, 'Department not found'::TEXT, NULL::UUID, NULL::UUID, 
                        NULL::VARCHAR, NULL::TEXT, NULL::TEXT, NULL::BOOLEAN, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- Check user role in company
  SELECT COALESCE(cu.role, 'member') INTO v_user_role
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = v_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE;

  IF v_user_role IS NULL THEN
    RETURN QUERY SELECT 'ERROR'::VARCHAR, 'Access denied: Not a member of this company'::TEXT, 
                        NULL::UUID, NULL::UUID, NULL::VARCHAR, NULL::TEXT, NULL::TEXT, NULL::BOOLEAN, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF LOWER(v_user_role) NOT IN ('admin', 'coordinator', 'supervisor') THEN
    RETURN QUERY SELECT 'ERROR'::VARCHAR, 'Access denied: Insufficient permissions'::TEXT, 
                        NULL::UUID, NULL::UUID, NULL::VARCHAR, NULL::TEXT, NULL::TEXT, NULL::BOOLEAN, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- Update the department
  UPDATE public.cmms_departments
  SET
    department_name = COALESCE(p_department_name, department_name),
    description = COALESCE(p_description, description),
    location = COALESCE(p_location, location),
    is_active = COALESCE(p_is_active, is_active),
    updated_at = NOW()
  WHERE id = p_department_id;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 0 THEN
    RETURN QUERY SELECT 'ERROR'::VARCHAR, 'Failed to update department'::TEXT, 
                        NULL::UUID, NULL::UUID, NULL::VARCHAR, NULL::TEXT, NULL::TEXT, NULL::BOOLEAN, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- Return updated department
  RETURN QUERY
  SELECT 'SUCCESS'::VARCHAR, 'Department updated successfully'::TEXT, d.id, d.cmms_company_id, 
         d.department_name, d.description, d.location, d.is_active, d.updated_at
  FROM public.cmms_departments d
  WHERE d.id = p_department_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_update_cmms_department TO authenticated;

-- ============================================================
-- RPC: Create CMMS Department
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_create_cmms_department(
  p_company_id UUID,
  p_department_name VARCHAR,
  p_description TEXT DEFAULT NULL,
  p_location TEXT DEFAULT NULL
)
RETURNS TABLE (
  status VARCHAR,
  message TEXT,
  id UUID,
  cmms_company_id UUID,
  department_name VARCHAR,
  description TEXT,
  location TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
  v_user_role TEXT;
  v_new_department_id UUID;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email
    FROM auth.users
    WHERE id = v_auth_uid;
  END IF;

  -- Check user role in company
  SELECT COALESCE(cu.role, 'member') INTO v_user_role
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE;

  IF v_user_role IS NULL THEN
    RETURN QUERY SELECT 'ERROR'::VARCHAR, 'Access denied: Not a member of this company'::TEXT, 
                        NULL::UUID, NULL::UUID, NULL::VARCHAR, NULL::TEXT, NULL::TEXT, NULL::BOOLEAN, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF LOWER(v_user_role) NOT IN ('admin', 'coordinator', 'supervisor') THEN
    RETURN QUERY SELECT 'ERROR'::VARCHAR, 'Access denied: Only admin, coordinator, or supervisor can create departments'::TEXT, 
                        NULL::UUID, NULL::UUID, NULL::VARCHAR, NULL::TEXT, NULL::TEXT, NULL::BOOLEAN, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- Create the department
  INSERT INTO public.cmms_departments (cmms_company_id, department_name, description, location, is_active)
  VALUES (p_company_id, p_department_name, p_description, p_location, TRUE)
  RETURNING id INTO v_new_department_id;

  -- Return created department
  RETURN QUERY
  SELECT 'SUCCESS'::VARCHAR, 'Department created successfully'::TEXT, d.id, d.cmms_company_id, 
         d.department_name, d.description, d.location, d.is_active, d.created_at
  FROM public.cmms_departments d
  WHERE d.id = v_new_department_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_create_cmms_department TO authenticated;

-- ============================================================
-- RPC: Delete CMMS Department
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_delete_cmms_department(p_department_id UUID)
RETURNS TABLE (
  status VARCHAR,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
  v_company_id UUID;
  v_user_role TEXT;
  v_deleted_rows INT;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email
    FROM auth.users
    WHERE id = v_auth_uid;
  END IF;

  -- Get the company and verify access
  SELECT d.cmms_company_id INTO v_company_id
  FROM public.cmms_departments d
  WHERE d.id = p_department_id;

  IF v_company_id IS NULL THEN
    RETURN QUERY SELECT 'ERROR'::VARCHAR, 'Department not found'::TEXT;
    RETURN;
  END IF;

  -- Check user role in company
  SELECT COALESCE(cu.role, 'member') INTO v_user_role
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = v_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE;

  IF LOWER(v_user_role) NOT IN ('admin') THEN
    RETURN QUERY SELECT 'ERROR'::VARCHAR, 'Access denied: Only admin can delete departments'::TEXT;
    RETURN;
  END IF;

  -- Delete the department
  DELETE FROM public.cmms_departments
  WHERE id = p_department_id;

  GET DIAGNOSTICS v_deleted_rows = ROW_COUNT;

  IF v_deleted_rows = 0 THEN
    RETURN QUERY SELECT 'ERROR'::VARCHAR, 'Failed to delete department'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'SUCCESS'::VARCHAR, 'Department deleted successfully'::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_delete_cmms_department TO authenticated;

SELECT 'All missing CMMS RPC functions created!' AS status;
