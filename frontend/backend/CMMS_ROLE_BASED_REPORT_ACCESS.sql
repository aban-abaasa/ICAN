-- ============================================================
-- CMMS Role-Based Report Access Control System
-- Purpose: Implement role-based access control for reports
-- - Regular Users: Can only see their own submitted reports
-- - Supervisors/Coordinators: Can see their department reports
-- - Admins: Can see all reports
-- ============================================================

-- ============================================================
-- 1. ADD NEW COLUMNS TO TRACK DEPARTMENT & ACCESS LEVELS
-- ============================================================

-- Add column to track if user is the report submitter
ALTER TABLE public.cmms_company_reports 
ADD COLUMN IF NOT EXISTS is_personal_view BOOLEAN DEFAULT false;

-- Add column to track departmental access level
ALTER TABLE public.cmms_company_reports 
ADD COLUMN IF NOT EXISTS visibility_level VARCHAR(20) DEFAULT 'department' 
CHECK (visibility_level IN ('personal', 'department', 'company', 'public'));

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_cmms_reports_visibility 
ON public.cmms_company_reports(visibility_level, department_id, reporter_cmms_user_id);

-- ============================================================
-- 2. ROLE-BASED SELECT POLICIES - READ ACCESS
-- ============================================================

-- POLICY 1: Personal Reports (User sees only their own reports)
DROP POLICY IF EXISTS "cmms_reports_personal_read" ON public.cmms_company_reports;
CREATE POLICY "cmms_reports_personal_read" ON public.cmms_company_reports
FOR SELECT USING (
  auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.cmms_users cu
    JOIN auth.users au ON LOWER(cu.email) = LOWER(au.email)
    WHERE au.id = auth.uid()
      AND cu.cmms_company_id = cmms_company_reports.cmms_company_id
      AND cu.is_active = TRUE
  )
  -- User can see:
  -- 1. Their own reports
  AND (
    -- Own reports
    reporter_cmms_user_id = (
      SELECT cu.id FROM public.cmms_users cu
      JOIN auth.users au ON LOWER(cu.email) = LOWER(au.email)
      WHERE au.id = auth.uid()
        AND cu.cmms_company_id = cmms_company_reports.cmms_company_id
        AND cu.is_active = TRUE
      LIMIT 1
    )
    -- OR department reports if supervisor/coordinator/admin
    OR (
      LOWER(COALESCE(
        (SELECT LOWER(cu.role) FROM public.cmms_users cu
         JOIN auth.users au ON LOWER(cu.email) = LOWER(au.email)
         WHERE au.id = auth.uid()
           AND cu.cmms_company_id = cmms_company_reports.cmms_company_id
           AND cu.is_active = TRUE
         LIMIT 1), 'member'
      )) IN ('admin', 'coordinator', 'supervisor')
      AND department_id = (
        SELECT cu.department_id FROM public.cmms_users cu
        JOIN auth.users au ON LOWER(cu.email) = LOWER(au.email)
        WHERE au.id = auth.uid()
          AND cu.cmms_company_id = cmms_company_reports.cmms_company_id
          AND cu.is_active = TRUE
        LIMIT 1
      )
    )
    -- OR admin can see all
    OR LOWER(COALESCE(
      (SELECT LOWER(cu.role) FROM public.cmms_users cu
       JOIN auth.users au ON LOWER(cu.email) = LOWER(au.email)
       WHERE au.id = auth.uid()
         AND cu.cmms_company_id = cmms_company_reports.cmms_company_id
         AND cu.is_active = TRUE
       LIMIT 1), 'member'
    )) = 'admin'
  )
);

-- ============================================================
-- 3. INSERT POLICIES - CREATE REPORTS
-- ============================================================

DROP POLICY IF EXISTS "cmms_reports_insert" ON public.cmms_company_reports;
CREATE POLICY "cmms_reports_insert" ON public.cmms_company_reports
FOR INSERT WITH CHECK (
  auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.cmms_users cu
    JOIN auth.users au ON LOWER(cu.email) = LOWER(au.email)
    WHERE au.id = auth.uid()
      AND cu.cmms_company_id = cmms_company_reports.cmms_company_id
      AND cu.is_active = TRUE
  )
);

-- ============================================================
-- 4. UPDATE POLICIES - EDIT REPORTS (Only by reporter or admin)
-- ============================================================

DROP POLICY IF EXISTS "cmms_reports_update" ON public.cmms_company_reports;
CREATE POLICY "cmms_reports_update" ON public.cmms_company_reports
FOR UPDATE USING (
  auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.cmms_users cu
    JOIN auth.users cu2 ON LOWER(cu.email) = LOWER(cu2.email)
    WHERE cu2.id = (
      SELECT au.id FROM auth.users au
      WHERE au.id = auth.uid()
    )
      AND cu.cmms_company_id = cmms_company_reports.cmms_company_id
      AND cu.is_active = TRUE
  )
  -- Only reporter or admin can update
  AND (
    reporter_cmms_user_id = (
      SELECT cu.id FROM public.cmms_users cu
      JOIN auth.users au ON LOWER(cu.email) = LOWER(au.email)
      WHERE au.id = auth.uid()
        AND cu.cmms_company_id = cmms_company_reports.cmms_company_id
        AND cu.is_active = TRUE
      LIMIT 1
    )
    OR LOWER(COALESCE(
      (SELECT LOWER(cu.role) FROM public.cmms_users cu
       JOIN auth.users au ON LOWER(cu.email) = LOWER(au.email)
       WHERE au.id = auth.uid()
         AND cu.cmms_company_id = cmms_company_reports.cmms_company_id
         AND cu.is_active = TRUE
       LIMIT 1), 'member'
    )) = 'admin'
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.cmms_users cu
    JOIN auth.users au ON LOWER(cu.email) = LOWER(au.email)
    WHERE au.id = auth.uid()
      AND cu.cmms_company_id = cmms_company_reports.cmms_company_id
      AND cu.is_active = TRUE
  )
);

-- ============================================================
-- 5. DELETE POLICIES - REMOVE REPORTS (Only by reporter or admin)
-- ============================================================

DROP POLICY IF EXISTS "cmms_reports_delete" ON public.cmms_company_reports;
CREATE POLICY "cmms_reports_delete" ON public.cmms_company_reports
FOR DELETE USING (
  auth.uid() IS NOT NULL
  -- Only reporter or admin can delete
  AND (
    reporter_cmms_user_id = (
      SELECT cu.id FROM public.cmms_users cu
      JOIN auth.users au ON LOWER(cu.email) = LOWER(au.email)
      WHERE au.id = auth.uid()
        AND cu.cmms_company_id = cmms_company_reports.cmms_company_id
        AND cu.is_active = TRUE
      LIMIT 1
    )
    OR LOWER(COALESCE(
      (SELECT LOWER(cu.role) FROM public.cmms_users cu
       JOIN auth.users au ON LOWER(cu.email) = LOWER(au.email)
       WHERE au.id = auth.uid()
         AND cu.cmms_company_id = cmms_company_reports.cmms_company_id
         AND cu.is_active = TRUE
       LIMIT 1), 'member'
    )) = 'admin'
  )
);

-- ============================================================
-- 6. FUNCTION: Get Reports Based on User Role
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_get_filtered_reports(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_get_filtered_reports(p_company_id UUID)
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

  -- Get current user details
  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email
    FROM auth.users
    WHERE id = v_auth_uid;
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

  -- Return reports based on user role
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
      -- ADMIN: See all reports
      v_cmms_role = 'admin'
      -- COORDINATOR/SUPERVISOR: See their department reports
      OR (v_cmms_role IN ('coordinator', 'supervisor')
        AND ccr.department_id = v_department_id)
      -- EVERYONE: See their own reports
      OR ccr.reporter_cmms_user_id = v_cmms_user_id
    )
  ORDER BY ccr.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_filtered_reports TO authenticated;

-- ============================================================
-- 7. FUNCTION: Create Report with Visibility Level
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_create_filtered_report(UUID, TEXT, VARCHAR, VARCHAR, TEXT, UUID, VARCHAR) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_create_filtered_report(
  p_company_id UUID,
  p_report_title TEXT,
  p_report_category VARCHAR DEFAULT 'general',
  p_severity VARCHAR DEFAULT 'medium',
  p_report_body TEXT DEFAULT '',
  p_department_id UUID DEFAULT NULL,
  p_visibility_level VARCHAR DEFAULT 'department'
)
RETURNS public.cmms_company_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
  v_cmms_user_id UUID;
  v_cmms_role TEXT;
  v_department_id UUID;
  v_report public.cmms_company_reports;
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

  -- Use user's department if not specified
  IF p_department_id IS NULL THEN
    p_department_id := v_department_id;
  END IF;

  -- Ensure department belongs to company
  IF p_department_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cmms_departments
      WHERE id = p_department_id
        AND cmms_company_id = p_company_id
    ) THEN
      RAISE EXCEPTION 'Department does not belong to this company';
    END IF;
  END IF;

  -- Set visibility based on role if admin can override
  -- Coordinators/Supervisors can only set department visibility
  -- Regular members can only set personal visibility
  IF v_cmms_role NOT IN ('admin', 'coordinator', 'supervisor') THEN
    p_visibility_level := 'personal';
  ELSIF v_cmms_role NOT IN ('admin') AND p_visibility_level = 'company' THEN
    p_visibility_level := 'department';
  END IF;

  INSERT INTO public.cmms_company_reports (
    cmms_company_id,
    department_id,
    report_title,
    report_category,
    severity,
    report_body,
    reporter_cmms_user_id,
    reporter_name,
    reporter_email,
    reporter_role,
    visibility_level,
    status,
    created_at,
    updated_at
  ) VALUES (
    p_company_id,
    p_department_id,
    COALESCE(NULLIF(TRIM(COALESCE(p_report_title, '')), ''), 'Company Report'),
    COALESCE(NULLIF(TRIM(COALESCE(p_report_category, '')), ''), 'general'),
    CASE
      WHEN LOWER(COALESCE(p_severity, 'medium')) IN ('low', 'medium', 'high', 'critical')
      THEN LOWER(COALESCE(p_severity, 'medium'))
      ELSE 'medium'
    END,
    COALESCE(NULLIF(TRIM(COALESCE(p_report_body, '')), ''), 'No details provided'),
    v_cmms_user_id,
    (SELECT name FROM public.cmms_users WHERE id = v_cmms_user_id),
    v_auth_email,
    v_cmms_role,
    p_visibility_level,
    'open',
    NOW(),
    NOW()
  )
  RETURNING * INTO v_report;

  RETURN v_report;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_create_filtered_report TO authenticated;

-- ============================================================
-- 8. FUNCTION: Check Report Access (Helper)
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_check_report_access(UUID, UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_check_report_access(
  p_report_id UUID,
  p_company_id UUID
)
RETURNS TABLE (
  has_access BOOLEAN,
  can_edit BOOLEAN,
  can_delete BOOLEAN,
  access_level VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
  v_cmms_user_id UUID;
  v_cmms_role TEXT;
  v_department_id UUID;
  v_report_department_id UUID;
  v_report_creator_id UUID;
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

  SELECT cu.id, LOWER(COALESCE(cu.role, 'member')), cu.department_id
  INTO v_cmms_user_id, v_cmms_role, v_department_id
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_cmms_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, FALSE, FALSE, 'no_access'::VARCHAR;
    RETURN;
  END IF;

  -- Get report details
  SELECT department_id, reporter_cmms_user_id
  INTO v_report_department_id, v_report_creator_id
  FROM public.cmms_company_reports
  WHERE id = p_report_id AND cmms_company_id = p_company_id;

  IF v_report_creator_id IS NULL THEN
    RETURN QUERY SELECT FALSE, FALSE, FALSE, 'report_not_found'::VARCHAR;
    RETURN;
  END IF;

  -- Determine access and edit rights
  RETURN QUERY
  SELECT
    CASE
      WHEN v_cmms_role = 'admin' THEN TRUE
      WHEN v_cmms_role IN ('coordinator', 'supervisor') 
        AND v_report_department_id = v_department_id THEN TRUE
      WHEN v_report_creator_id = v_cmms_user_id THEN TRUE
      ELSE FALSE
    END AS has_access,
    CASE
      WHEN v_cmms_role = 'admin' THEN TRUE
      WHEN v_report_creator_id = v_cmms_user_id THEN TRUE
      ELSE FALSE
    END AS can_edit,
    CASE
      WHEN v_cmms_role = 'admin' THEN TRUE
      WHEN v_report_creator_id = v_cmms_user_id THEN TRUE
      ELSE FALSE
    END AS can_delete,
    CASE
      WHEN v_cmms_role = 'admin' THEN 'admin_full_access'::VARCHAR
      WHEN v_cmms_role IN ('coordinator', 'supervisor') 
        AND v_report_department_id = v_department_id THEN 'department_access'::VARCHAR
      WHEN v_report_creator_id = v_cmms_user_id THEN 'personal_access'::VARCHAR
      ELSE 'no_access'::VARCHAR
    END::VARCHAR AS access_level;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_check_report_access TO authenticated;

-- ============================================================
-- 9. FUNCTION: Get Department Report Summary (For Supervisors)
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_get_department_report_stats(UUID, UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_get_department_report_stats(
  p_company_id UUID,
  p_department_id UUID
)
RETURNS TABLE (
  total_reports BIGINT,
  open_reports BIGINT,
  critical_reports BIGINT,
  high_severity BIGINT,
  average_resolution_time INTERVAL
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    SELECT email INTO v_auth_email
    FROM auth.users
    WHERE id = v_auth_uid;
  END IF;

  SELECT cu.id, LOWER(COALESCE(cu.role, 'member')), cu.department_id
  INTO v_cmms_user_id, v_cmms_role, v_department_id
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  -- Only admins and department supervisors can see stats
  IF v_cmms_user_id IS NULL OR (
    v_cmms_role NOT IN ('admin', 'coordinator', 'supervisor')
    OR (v_cmms_role IN ('coordinator', 'supervisor') AND p_department_id != v_department_id)
  ) THEN
    RAISE EXCEPTION 'You do not have permission to view department stats';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*) AS total_reports,
    COUNT(*) FILTER (WHERE status = 'open') AS open_reports,
    COUNT(*) FILTER (WHERE severity = 'critical') AS critical_reports,
    COUNT(*) FILTER (WHERE severity = 'high') AS high_severity,
    AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))::INTERVAL) AS average_resolution_time
  FROM public.cmms_company_reports
  WHERE cmms_company_id = p_company_id
    AND department_id = p_department_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_department_report_stats TO authenticated;

-- ============================================================
-- 10. DEPLOYMENT VERIFICATION
-- ============================================================

SELECT 'CMMS Role-Based Report Access Control System Deployed Successfully' AS status;
