-- ============================================================
-- FIX: CMMS Company Reporting System - Role-Based Access Control
-- ============================================================
-- This fixes the RLS policies to allow:
-- - ADMIN: view all company reports
-- - FINANCE: view all company reports  
-- - COORDINATOR/SUPERVISOR: view departmental reports + their own
-- - REGULAR USERS (member): view their own reports only
-- ============================================================

-- Drop existing functions first (required when changing return types)
DROP FUNCTION IF EXISTS public.fn_get_company_reports(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.fn_get_company_reports_filtered(UUID, UUID, VARCHAR, VARCHAR) CASCADE;
DROP FUNCTION IF EXISTS public.fn_get_department_reports(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.fn_export_report(UUID) CASCADE;

-- Drop and recreate the SELECT policy with proper role-based access
DROP POLICY IF EXISTS "cmms_company_reports_select_policy" ON public.cmms_company_reports;
CREATE POLICY "cmms_company_reports_select_policy" ON public.cmms_company_reports
FOR SELECT USING (
  auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.cmms_users cu
    JOIN auth.users au ON LOWER(cu.email) = LOWER(au.email)
    WHERE au.id = auth.uid()
      AND cu.cmms_company_id = cmms_company_reports.cmms_company_id
      AND cu.is_active = TRUE
      AND (
        -- Admin and Finance: see all reports
        LOWER(COALESCE(cu.role, 'member')) IN ('admin', 'finance')
        
        -- Coordinator and Supervisor: see reports from their department or their own
        OR (
          LOWER(COALESCE(cu.role, 'member')) IN ('coordinator', 'supervisor')
          AND (
            cmms_company_reports.department_id = cu.department_id
            OR cmms_company_reports.reporter_cmms_user_id = cu.id
          )
        )
        
        -- Regular members: see only their own reports
        OR (
          LOWER(COALESCE(cu.role, 'member')) = 'member'
          AND cmms_company_reports.reporter_cmms_user_id = cu.id
        )
      )
  )
);

-- ============================================================
-- Updated RPC Function with Role-Based Access
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_get_company_reports(p_company_id UUID)
RETURNS TABLE (
  id UUID,
  cmms_company_id UUID,
  department_id UUID,
  report_title TEXT,
  report_category VARCHAR,
  severity VARCHAR,
  report_body TEXT,
  reporter_cmms_user_id UUID,
  reporter_name VARCHAR,
  reporter_email VARCHAR,
  reporter_role VARCHAR,
  status VARCHAR,
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
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
  v_user_role TEXT;
  v_user_department_id UUID;
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

  -- Get user role and department
  SELECT COALESCE(cu.role, 'member'), cu.department_id
  INTO v_user_role, v_user_department_id
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this CMMS company';
  END IF;

  -- Return appropriate reports based on role
  RETURN QUERY
  SELECT r.id, r.cmms_company_id, r.department_id, r.report_title, 
         r.report_category, r.severity, r.report_body, r.reporter_cmms_user_id,
         r.reporter_name, r.reporter_email, r.reporter_role, r.status,
         r.resolution_notes, r.resolved_at, r.created_at, r.updated_at
  FROM public.cmms_company_reports r
  WHERE r.cmms_company_id = p_company_id
    AND (
      -- Admin and Finance: see all reports
      LOWER(v_user_role) IN ('admin', 'finance')
      
      -- Coordinator and Supervisor: see departmental and own reports
      OR (
        LOWER(v_user_role) IN ('coordinator', 'supervisor')
        AND (
          r.department_id = v_user_department_id
          OR r.reporter_cmms_user_id = (
            SELECT cu.id FROM public.cmms_users cu
            WHERE cu.cmms_company_id = p_company_id
              AND LOWER(cu.email) = LOWER(v_auth_email)
              AND cu.is_active = TRUE
            LIMIT 1
          )
        )
      )
      
      -- Regular members: see only their own reports
      OR (
        LOWER(v_user_role) = 'member'
        AND r.reporter_cmms_user_id = (
          SELECT cu.id FROM public.cmms_users cu
          WHERE cu.cmms_company_id = p_company_id
            AND LOWER(cu.email) = LOWER(v_auth_email)
            AND cu.is_active = TRUE
          LIMIT 1
        )
      )
    )
  ORDER BY r.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_company_reports TO authenticated;

-- ============================================================
-- New RPC: Get Reports with Filters (Admin/Finance friendly)
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_get_company_reports_filtered(
  p_company_id UUID,
  p_department_id UUID DEFAULT NULL,
  p_status VARCHAR DEFAULT NULL,
  p_category VARCHAR DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  cmms_company_id UUID,
  department_id UUID,
  report_title TEXT,
  report_category VARCHAR,
  severity VARCHAR,
  report_body TEXT,
  reporter_cmms_user_id UUID,
  reporter_name VARCHAR,
  reporter_email VARCHAR,
  reporter_role VARCHAR,
  status VARCHAR,
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
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
  v_user_role TEXT;
  v_user_id UUID;
  v_user_department_id UUID;
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

  -- Get user info
  SELECT cu.id, COALESCE(cu.role, 'member'), cu.department_id
  INTO v_user_id, v_user_role, v_user_department_id
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this CMMS company';
  END IF;

  -- Return filtered reports based on role
  RETURN QUERY
  SELECT r.id, r.cmms_company_id, r.department_id, r.report_title, 
         r.report_category, r.severity, r.report_body, r.reporter_cmms_user_id,
         r.reporter_name, r.reporter_email, r.reporter_role, r.status,
         r.resolution_notes, r.resolved_at, r.created_at, r.updated_at
  FROM public.cmms_company_reports r
  WHERE r.cmms_company_id = p_company_id
    -- Apply filters
    AND (p_status IS NULL OR r.status = p_status)
    AND (p_category IS NULL OR r.report_category = p_category)
    -- Filter by department if Admin/Finance specifies it, otherwise use user's department
    AND (
      CASE
        WHEN LOWER(v_user_role) IN ('admin', 'finance') THEN
          (p_department_id IS NULL OR r.department_id = p_department_id)
        WHEN LOWER(v_user_role) IN ('coordinator', 'supervisor') THEN
          (
            (p_department_id IS NULL AND r.department_id = v_user_department_id)
            OR (p_department_id IS NOT NULL AND r.department_id = p_department_id)
            OR r.reporter_cmms_user_id = v_user_id
          )
        ELSE
          r.reporter_cmms_user_id = v_user_id
      END
    )
  ORDER BY r.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_company_reports_filtered TO authenticated;

-- ============================================================
-- New RPC: Get Reports by Department (for coordinators/supervisors)
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_get_department_reports(
  p_company_id UUID,
  p_department_id UUID
)
RETURNS TABLE (
  id UUID,
  cmms_company_id UUID,
  department_id UUID,
  report_title TEXT,
  report_category VARCHAR,
  severity VARCHAR,
  report_body TEXT,
  reporter_cmms_user_id UUID,
  reporter_name VARCHAR,
  reporter_email VARCHAR,
  reporter_role VARCHAR,
  status VARCHAR,
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
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
  v_user_role TEXT;
  v_user_department_id UUID;
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

  -- Get user role and department
  SELECT COALESCE(cu.role, 'member'), cu.department_id
  INTO v_user_role, v_user_department_id
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this CMMS company';
  END IF;

  -- Check authorization
  IF LOWER(v_user_role) NOT IN ('admin', 'finance', 'coordinator', 'supervisor') THEN
    RAISE EXCEPTION 'Only admin, finance, coordinator, or supervisor can view department reports';
  END IF;

  -- If not admin/finance, can only view own department
  IF LOWER(v_user_role) IN ('coordinator', 'supervisor') AND p_department_id != v_user_department_id THEN
    RAISE EXCEPTION 'You can only view reports from your own department';
  END IF;

  -- Return department reports
  RETURN QUERY
  SELECT r.id, r.cmms_company_id, r.department_id, r.report_title, 
         r.report_category, r.severity, r.report_body, r.reporter_cmms_user_id,
         r.reporter_name, r.reporter_email, r.reporter_role, r.status,
         r.resolution_notes, r.resolved_at, r.created_at, r.updated_at
  FROM public.cmms_company_reports r
  WHERE r.cmms_company_id = p_company_id
    AND r.department_id = p_department_id
  ORDER BY r.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_department_reports TO authenticated;

-- ============================================================
-- New RPC: Export Report as Text/PDF-friendly format
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_export_report(p_report_id UUID)
RETURNS TABLE (
  id UUID,
  title TEXT,
  category VARCHAR,
  severity VARCHAR,
  reporter_name VARCHAR,
  reporter_email VARCHAR,
  reporter_role VARCHAR,
  status VARCHAR,
  department_name VARCHAR,
  body TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
  v_user_company_id UUID;
  v_report_company_id UUID;
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

  -- Get user's company
  SELECT cu.cmms_company_id
  INTO v_user_company_id
  FROM public.cmms_users cu
  WHERE LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  -- Get report's company
  SELECT cr.cmms_company_id
  INTO v_report_company_id
  FROM public.cmms_company_reports cr
  WHERE cr.id = p_report_id;

  -- Verify same company
  IF v_user_company_id != v_report_company_id THEN
    RAISE EXCEPTION 'Access denied: Report not in your company';
  END IF;

  -- Return report data for export
  RETURN QUERY
  SELECT 
    r.id,
    r.report_title,
    r.report_category,
    r.severity,
    r.reporter_name,
    r.reporter_email,
    r.reporter_role,
    r.status,
    COALESCE(d.department_name, 'General'),
    r.report_body,
    r.created_at,
    r.updated_at,
    r.resolved_at,
    r.resolution_notes
  FROM public.cmms_company_reports r
  LEFT JOIN public.cmms_departments d ON r.department_id = d.id
  WHERE r.id = p_report_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_export_report TO authenticated;

SELECT 'CMMS Reports RLS Policies Fixed!' AS status;
