-- ============================================================
-- CMMS Written Report — multi-file attachments + share parity
-- ============================================================
-- CMMS_REPORT_PHOTO_ATTACHMENT.sql gave every report exactly ONE photo
-- (photo_url/photo_path columns). This adds a real many-files-per-report
-- attachment list (any file type, not just images) on top of that -- the
-- single photo columns are left untouched for backward compatibility.
--
-- Files go through the SAME Cloudflare R2 presigned-URL flow already used
-- for the report photo (folder 'cmms-reports', see uploadReportPhoto in
-- CMSSModule.jsx and backend/routes/storageRoutes.js) -- no new backend
-- route/function and no new R2 folder.
--
-- ACCESS CONTROL mirrors fn_get_filtered_reports exactly (same three
-- tiers, since an attachment is just part of the report it belongs to):
--   - Admin: attach/remove on any report in the company
--   - Coordinator/Supervisor: attach/remove on reports in their department
--   - Everyone else: attach/remove only on their OWN report
-- Viewing an attachment requires no separate check: fn_get_filtered_reports
-- (extended below to also return `attachments`) only ever returns a row
-- for reports the caller can already see, exactly like photo_url today --
-- so an attachment never reaches someone unauthorized to see the report.
--
-- SHARING: the "Share Written Reports" link (CMMS_REPORT_EXPORT_SHARING.sql
-- / ShareExportModal.jsx) already embeds each report's photo_url in the
-- JSONB payload every anonymous viewer RPC returns. _fn_export_share_payload
-- is redefined below to also embed `attachments` per report -- since the
-- three anonymous RPCs (fn_get_report_export_share_access,
-- fn_verify_report_export_share_password, fn_verify_report_export_share_otp)
-- all just forward that same JSONB blob, they automatically gain attachment
-- sharing with zero changes of their own.
--
-- Run after: CMMS_REPORT_PHOTO_ATTACHMENT.sql (fn_get_filtered_reports),
-- CMMS_REPORT_EXPORT_SHARING.sql (_fn_export_share_payload).
-- Safe to run more than once.
-- ============================================================

-- ============================================================
-- 1. TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_report_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.cmms_company_reports(id) ON DELETE CASCADE,
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  uploaded_by_cmms_user_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,

  -- Real file, via R2 (r2://<key> marker) -- same convention as
  -- cmms_company_reports.photo_url/photo_path.
  file_url TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT,
  file_size_bytes BIGINT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cmms_report_attachments_report ON public.cmms_report_attachments(report_id);
CREATE INDEX IF NOT EXISTS idx_cmms_report_attachments_company ON public.cmms_report_attachments(cmms_company_id);

-- No client-facing RLS policy -- exactly like cmms_report_shares etc.:
-- every access goes through the SECURITY DEFINER functions below (which
-- run as the table owner), never a direct table select from the frontend.
ALTER TABLE public.cmms_report_attachments ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. ADD -- admin, own-department coordinator/supervisor, or the report's
--    own author.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_add_report_attachment(
  p_report_id UUID,
  p_file_url TEXT,
  p_file_path TEXT,
  p_file_name TEXT DEFAULT NULL,
  p_mime_type TEXT DEFAULT NULL,
  p_file_size_bytes BIGINT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_email TEXT;
  v_cmms_user_id UUID;
  v_cmms_role TEXT;
  v_department_id UUID;
  v_report public.cmms_company_reports;
  v_attachment_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NULLIF(TRIM(COALESCE(p_file_url, '')), '') IS NULL OR NULLIF(TRIM(COALESCE(p_file_path, '')), '') IS NULL THEN
    RAISE EXCEPTION 'The file did not upload correctly -- please try again';
  END IF;

  SELECT * INTO v_report FROM public.cmms_company_reports WHERE id = p_report_id;
  IF v_report.id IS NULL THEN
    RAISE EXCEPTION 'Report not found';
  END IF;

  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email FROM auth.users WHERE id = auth.uid();
  END IF;

  SELECT cu.id, LOWER(COALESCE(cu.role, 'member')), cu.department_id
  INTO v_cmms_user_id, v_cmms_role, v_department_id
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = v_report.cmms_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_cmms_user_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this CMMS company';
  END IF;

  IF NOT (
    v_cmms_role = 'admin'
    OR (v_cmms_role IN ('coordinator', 'supervisor') AND v_report.department_id = v_department_id)
    OR v_report.reporter_cmms_user_id = v_cmms_user_id
  ) THEN
    RAISE EXCEPTION 'You do not have permission to attach files to this report';
  END IF;

  INSERT INTO public.cmms_report_attachments (
    report_id, cmms_company_id, uploaded_by_cmms_user_id,
    file_url, file_path, file_name, mime_type, file_size_bytes
  ) VALUES (
    p_report_id, v_report.cmms_company_id, v_cmms_user_id,
    TRIM(p_file_url), TRIM(p_file_path), NULLIF(TRIM(COALESCE(p_file_name, '')), ''),
    NULLIF(TRIM(COALESCE(p_mime_type, '')), ''), p_file_size_bytes
  )
  RETURNING id INTO v_attachment_id;

  RETURN v_attachment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_add_report_attachment(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT) TO authenticated;

-- ============================================================
-- 3. REMOVE -- the uploader themself, or a company admin.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_delete_report_attachment(p_attachment_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attachment public.cmms_report_attachments;
  v_auth_email TEXT;
  v_cmms_user_id UUID;
  v_cmms_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_attachment FROM public.cmms_report_attachments WHERE id = p_attachment_id;
  IF v_attachment.id IS NULL THEN
    RAISE EXCEPTION 'Attachment not found';
  END IF;

  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email FROM auth.users WHERE id = auth.uid();
  END IF;

  SELECT cu.id, LOWER(COALESCE(cu.role, 'member'))
  INTO v_cmms_user_id, v_cmms_role
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = v_attachment.cmms_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_cmms_user_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this CMMS company';
  END IF;

  IF v_cmms_role != 'admin' AND v_attachment.uploaded_by_cmms_user_id IS DISTINCT FROM v_cmms_user_id THEN
    RAISE EXCEPTION 'You do not have permission to remove this attachment';
  END IF;

  DELETE FROM public.cmms_report_attachments WHERE id = p_attachment_id;
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_delete_report_attachment(UUID) TO authenticated;

-- ============================================================
-- 4. fn_get_filtered_reports -- also return each report's attachment list.
-- CREATE OR REPLACE cannot add a new OUT column to an existing function,
-- so the old signature must be dropped first (same reason
-- CMMS_ATTENDANCE_MANUAL_DAYS_ADJUSTMENT.sql / CMMS_EMPLOYEE_WELFARE_SYSTEM.sql
-- dropped fn_get_filtered_reports / get_attendance_summary before adding a
-- column).
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
  photo_url TEXT,
  photo_path TEXT,
  attachments JSONB,
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

  RETURN QUERY
  SELECT
    ccr.id::UUID,
    ccr.report_title::TEXT,
    ccr.report_category::VARCHAR,
    ccr.severity::VARCHAR,
    ccr.report_body::TEXT,
    ccr.status::VARCHAR,
    ccr.reporter_name::VARCHAR,
    ccr.reporter_email::VARCHAR,
    ccr.reporter_role::VARCHAR,
    ccr.department_id::UUID,
    ccr.visibility_level::VARCHAR,
    ccr.photo_url::TEXT,
    ccr.photo_path::TEXT,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
       'id', a.id, 'file_url', a.file_url, 'file_name', a.file_name,
       'mime_type', a.mime_type, 'file_size_bytes', a.file_size_bytes,
       'created_at', a.created_at
     ) ORDER BY a.created_at), '[]'::jsonb)
     FROM public.cmms_report_attachments a WHERE a.report_id = ccr.id)::JSONB,
    ccr.created_at::TIMESTAMPTZ,
    ccr.updated_at::TIMESTAMPTZ,
    (ccr.reporter_cmms_user_id = v_cmms_user_id)::BOOLEAN AS is_own_report,
    (CASE
      WHEN v_cmms_role = 'admin' THEN 'admin_full_access'
      WHEN v_cmms_role IN ('coordinator', 'supervisor') AND ccr.department_id = v_department_id THEN 'department_access'
      WHEN ccr.reporter_cmms_user_id = v_cmms_user_id THEN 'personal_access'
      ELSE 'no_access'
    END)::VARCHAR AS access_level
  FROM public.cmms_company_reports ccr
  WHERE ccr.cmms_company_id = p_company_id
    AND (
      v_cmms_role = 'admin'
      OR (v_cmms_role IN ('coordinator', 'supervisor')
        AND ccr.department_id = v_department_id)
      OR ccr.reporter_cmms_user_id = v_cmms_user_id
    )
  ORDER BY ccr.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_filtered_reports(UUID) TO authenticated;

-- ============================================================
-- 5. _fn_export_share_payload -- also embed `attachments` per report, so
-- the public "Share Written Reports" link carries them too. Same
-- RETURNS TABLE shape as before (reports stays JSONB), so no DROP needed
-- and the three anonymous RPCs in CMMS_REPORT_EXPORT_SHARING.sql that call
-- this need no changes at all.
-- ============================================================

CREATE OR REPLACE FUNCTION public._fn_export_share_payload(p_share_id UUID)
RETURNS TABLE (
  company_name VARCHAR,
  scope_label TEXT,
  report_count INT,
  reports JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_share record;
  v_dept_name TEXT;
  v_reporter_name TEXT;
BEGIN
  SELECT * INTO v_share FROM public.cmms_report_export_shares WHERE id = p_share_id;

  IF v_share.reporter_filter != 'all' THEN
    SELECT COALESCE(ccr.reporter_name, ccr.reporter_email) INTO v_reporter_name
    FROM public.cmms_company_reports ccr
    WHERE ccr.cmms_company_id = v_share.cmms_company_id
      AND LOWER(COALESCE(NULLIF(TRIM(ccr.reporter_email), ''), NULLIF(TRIM(ccr.reporter_name), ''), 'unknown')) = LOWER(v_share.reporter_filter)
    LIMIT 1;
  ELSIF v_share.department_filter NOT IN ('all', 'unassigned') THEN
    SELECT cd.department_name INTO v_dept_name
    FROM public.cmms_departments cd
    WHERE cd.id::TEXT = v_share.department_filter;
  END IF;

  RETURN QUERY
  SELECT
    cp.company_name,
    CASE
      WHEN v_share.reporter_filter != 'all' THEN 'Employee: ' || COALESCE(v_reporter_name, 'Selected employee')
      WHEN v_share.department_filter = 'unassigned' THEN 'Department: Unassigned / No Department'
      WHEN v_share.department_filter = 'all' THEN 'All Departments'
      ELSE 'Department: ' || COALESCE(v_dept_name, 'Selected department')
    END,
    COUNT(ccr.id)::INT,
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', ccr.id,
      'report_title', ccr.report_title,
      'report_category', ccr.report_category,
      'severity', ccr.severity,
      'report_body', ccr.report_body,
      'status', ccr.status,
      'reporter_name', ccr.reporter_name,
      'reporter_role', ccr.reporter_role,
      'department_id', ccr.department_id,
      'department_name', cd.department_name,
      'photo_url', ccr.photo_url,
      'attachments', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'file_url', a.file_url, 'file_name', a.file_name, 'mime_type', a.mime_type
        ) ORDER BY a.created_at), '[]'::jsonb)
        FROM public.cmms_report_attachments a WHERE a.report_id = ccr.id
      ),
      'created_at', ccr.created_at
    ) ORDER BY ccr.created_at DESC) FILTER (WHERE ccr.id IS NOT NULL), '[]'::jsonb)
  FROM public.cmms_company_profiles cp
  LEFT JOIN public.cmms_company_reports ccr
    ON ccr.cmms_company_id = cp.id
    AND (
      v_share.department_filter = 'all'
      OR (v_share.department_filter = 'unassigned' AND ccr.department_id IS NULL)
      OR ccr.department_id::TEXT = v_share.department_filter
    )
    AND (
      v_share.reporter_filter = 'all'
      OR LOWER(COALESCE(NULLIF(TRIM(ccr.reporter_email), ''), NULLIF(TRIM(ccr.reporter_name), ''), 'unknown')) = LOWER(v_share.reporter_filter)
    )
  LEFT JOIN public.cmms_departments cd ON cd.id = ccr.department_id
  WHERE cp.id = v_share.cmms_company_id
  GROUP BY cp.company_name;
END;
$$;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS report multi-file attachments installed.' AS status;
