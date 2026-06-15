-- ============================================================
-- CMMS Company Reporting System
-- Purpose: Shared report board where any CMMS company member can write reports
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_company_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  department_id UUID NULL REFERENCES public.cmms_departments(id) ON DELETE SET NULL,

  report_title TEXT NOT NULL,
  report_category VARCHAR(60) NOT NULL DEFAULT 'general',
  severity VARCHAR(20) NOT NULL DEFAULT 'medium',
  report_body TEXT NOT NULL,

  reporter_cmms_user_id UUID NULL REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  reporter_name VARCHAR(255),
  reporter_email VARCHAR(255),
  reporter_role VARCHAR(100),

  status VARCHAR(30) NOT NULL DEFAULT 'open',
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cmms_company_reports_severity_chk CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT cmms_company_reports_status_chk CHECK (status IN ('open', 'in_review', 'resolved', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_cmms_company_reports_company ON public.cmms_company_reports(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_cmms_company_reports_created_at ON public.cmms_company_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cmms_company_reports_status ON public.cmms_company_reports(status);
CREATE INDEX IF NOT EXISTS idx_cmms_company_reports_category ON public.cmms_company_reports(report_category);

ALTER TABLE public.cmms_company_reports ENABLE ROW LEVEL SECURITY;

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
      AND LOWER(COALESCE(cu.role, 'member')) IN ('admin', 'coordinator', 'supervisor', 'finance')
  )
);

DROP POLICY IF EXISTS "cmms_company_reports_insert_policy" ON public.cmms_company_reports;
CREATE POLICY "cmms_company_reports_insert_policy" ON public.cmms_company_reports
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

DROP POLICY IF EXISTS "cmms_company_reports_update_policy" ON public.cmms_company_reports;
CREATE POLICY "cmms_company_reports_update_policy" ON public.cmms_company_reports
FOR UPDATE USING (
  auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.cmms_users cu
    JOIN auth.users au ON LOWER(cu.email) = LOWER(au.email)
    WHERE au.id = auth.uid()
      AND cu.cmms_company_id = cmms_company_reports.cmms_company_id
      AND cu.is_active = TRUE
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

CREATE OR REPLACE FUNCTION public.fn_get_company_reports(p_company_id UUID)
RETURNS SETOF public.cmms_company_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cmms_users cu
    JOIN auth.users au ON LOWER(cu.email) = LOWER(au.email)
    WHERE au.id = v_auth_uid
      AND cu.cmms_company_id = p_company_id
      AND cu.is_active = TRUE
      AND LOWER(COALESCE(cu.role, 'member')) IN ('admin', 'coordinator', 'supervisor', 'finance')
  ) THEN
    RAISE EXCEPTION 'Your role is not allowed to view company reports';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.cmms_company_reports
  WHERE cmms_company_id = p_company_id
  ORDER BY created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_company_reports TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_create_company_report(
  p_company_id UUID,
  p_report_title TEXT,
  p_report_category VARCHAR DEFAULT 'general',
  p_severity VARCHAR DEFAULT 'medium',
  p_report_body TEXT DEFAULT '',
  p_department_id UUID DEFAULT NULL,
  p_reporter_name VARCHAR DEFAULT NULL,
  p_reporter_email VARCHAR DEFAULT NULL,
  p_reporter_role VARCHAR DEFAULT NULL
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

  SELECT cu.id, COALESCE(cu.role, 'member')
  INTO v_cmms_user_id, v_cmms_role
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_cmms_user_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this CMMS company';
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
    status,
    created_at,
    updated_at
  ) VALUES (
    p_company_id,
    p_department_id,
    COALESCE(NULLIF(TRIM(COALESCE(p_report_title, '')), ''), 'Company Report'),
    COALESCE(NULLIF(TRIM(COALESCE(p_report_category, '')), ''), 'general'),
    CASE
      WHEN LOWER(COALESCE(p_severity, 'medium')) IN ('low', 'medium', 'high', 'critical') THEN LOWER(COALESCE(p_severity, 'medium'))
      ELSE 'medium'
    END,
    COALESCE(NULLIF(TRIM(COALESCE(p_report_body, '')), ''), 'No details provided'),
    v_cmms_user_id,
    COALESCE(NULLIF(TRIM(COALESCE(p_reporter_name, '')), ''), 'CMMS Member'),
    COALESCE(NULLIF(TRIM(COALESCE(p_reporter_email, '')), ''), v_auth_email),
    COALESCE(NULLIF(TRIM(COALESCE(p_reporter_role, '')), ''), v_cmms_role),
    'open',
    NOW(),
    NOW()
  )
  RETURNING * INTO v_report;

  RETURN v_report;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_create_company_report TO authenticated;

SELECT 'CMMS company reporting system ready' AS status;
