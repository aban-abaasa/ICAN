-- ============================================================
-- CMMS Written-Reports Export Sharing — pick specific reports
-- ============================================================
-- CMMS_REPORT_EXPORT_SHARING.sql's share links could only be scoped by
-- department_filter / reporter_filter ("everyone in Maintenance", "everyone
-- named Jane") -- an admin who wants to share just three specific incident
-- reports out of fifty had no way to do that without also sharing
-- everything else in that department/employee's name.
--
-- This adds a third, more precise scope: an explicit list of report ids.
-- When set, it is a hard filter ANDed on top of whatever department/
-- reporter filter is also stored (which default to 'all' = no restriction,
-- so picking specific reports and leaving the filters at "all" is the
-- normal case) -- composes rather than replacing, so the same table/
-- functions keep working for the existing department/employee-scoped
-- shares untouched.
--
-- Run after: CMMS_REPORT_EXPORT_SHARING.sql,
-- CMMS_REPORT_MULTI_FILE_ATTACHMENTS.sql (for `attachments` in the payload).
-- Safe to run more than once.
-- ============================================================

ALTER TABLE public.cmms_report_export_shares
  ADD COLUMN IF NOT EXISTS report_ids UUID[];

-- ============================================================
-- 1. fn_create_report_export_share -- new trailing p_report_ids param.
-- CREATE OR REPLACE can add a new parameter as long as it's appended at
-- the end with a default value (per Postgres docs), so no DROP is needed
-- here -- unlike adding an OUTPUT column, this doesn't change the
-- function's identity for existing callers that omit it.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_create_report_export_share(
  p_company_id UUID,
  p_department_filter TEXT DEFAULT 'all',
  p_reporter_filter TEXT DEFAULT 'all',
  p_visibility VARCHAR DEFAULT 'public',
  p_password TEXT DEFAULT NULL,
  p_allowed_emails TEXT[] DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_report_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  token TEXT,
  visibility VARCHAR,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_auth_email TEXT;
  v_cmms_user_id UUID;
  v_cmms_role TEXT;
  v_token TEXT;
  v_password_hash TEXT;
  v_allowed_emails TEXT[];
  v_report_ids UUID[];
  v_new_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_visibility NOT IN ('public', 'password', 'restricted') THEN
    RAISE EXCEPTION 'Invalid visibility mode';
  END IF;

  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email FROM auth.users WHERE id = auth.uid();
  END IF;

  SELECT cu.id, LOWER(COALESCE(cu.role, 'member'))
  INTO v_cmms_user_id, v_cmms_role
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_cmms_user_id IS NULL OR v_cmms_role != 'admin' THEN
    RAISE EXCEPTION 'Only a company admin can share written reports';
  END IF;

  IF p_visibility = 'password' THEN
    IF p_password IS NULL OR LENGTH(p_password) < 4 THEN
      RAISE EXCEPTION 'Password must be at least 4 characters';
    END IF;
    v_password_hash := crypt(p_password, gen_salt('bf'));
  END IF;

  IF p_visibility = 'restricted' THEN
    IF p_allowed_emails IS NULL OR array_length(p_allowed_emails, 1) IS NULL THEN
      RAISE EXCEPTION 'Provide at least one email address';
    END IF;
    SELECT array_agg(DISTINCT LOWER(TRIM(email_addr)))
    INTO v_allowed_emails
    FROM unnest(p_allowed_emails) AS email_addr
    WHERE TRIM(email_addr) != '';
  END IF;

  -- Only ever store report ids that (a) were actually provided and (b)
  -- genuinely belong to this company -- silently dropping any id from
  -- another company rather than erroring, since a stale/tampered id here
  -- should just be excluded, not block sharing the rest of the selection.
  IF p_report_ids IS NOT NULL AND array_length(p_report_ids, 1) > 0 THEN
    SELECT array_agg(DISTINCT ccr.id) INTO v_report_ids
    FROM public.cmms_company_reports ccr
    WHERE ccr.id = ANY(p_report_ids) AND ccr.cmms_company_id = p_company_id;

    IF v_report_ids IS NULL OR array_length(v_report_ids, 1) IS NULL THEN
      RAISE EXCEPTION 'None of the selected reports could be found in this company';
    END IF;
  END IF;

  v_token := encode(gen_random_bytes(24), 'hex');

  INSERT INTO public.cmms_report_export_shares (
    cmms_company_id, created_by_cmms_user_id, department_filter, reporter_filter,
    token, visibility, password_hash, allowed_emails, expires_at, report_ids
  ) VALUES (
    p_company_id, v_cmms_user_id, COALESCE(NULLIF(TRIM(p_department_filter), ''), 'all'), COALESCE(NULLIF(TRIM(p_reporter_filter), ''), 'all'),
    v_token, p_visibility, v_password_hash, v_allowed_emails, p_expires_at, v_report_ids
  )
  RETURNING cmms_report_export_shares.id INTO v_new_id;

  RETURN QUERY
  SELECT s.id, s.token, s.visibility, s.expires_at, s.created_at
  FROM public.cmms_report_export_shares s
  WHERE s.id = v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_create_report_export_share(UUID, TEXT, TEXT, VARCHAR, TEXT, TEXT[], TIMESTAMPTZ, UUID[]) TO authenticated;

-- ============================================================
-- 2. fn_list_report_export_shares -- also return report_ids so the admin
-- panel can label a hand-picked share ("3 selected reports") instead of
-- always describing it as a department/employee scope.
-- CREATE OR REPLACE cannot add a new OUTPUT column, so drop first (same
-- reason CMMS_PAYROLL_EMPLOYEE_DOCUMENTS.sql dropped get_company_employee_documents).
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_list_report_export_shares(UUID);
CREATE OR REPLACE FUNCTION public.fn_list_report_export_shares(p_company_id UUID)
RETURNS TABLE (
  id UUID,
  token TEXT,
  visibility VARCHAR,
  department_filter TEXT,
  reporter_filter TEXT,
  report_ids UUID[],
  allowed_emails TEXT[],
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  view_count INT,
  failed_attempts INT,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_email TEXT;
  v_cmms_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email FROM auth.users WHERE id = auth.uid();
  END IF;

  SELECT LOWER(COALESCE(cu.role, 'member')) INTO v_cmms_role
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_cmms_role != 'admin' THEN
    RAISE EXCEPTION 'Only a company admin can view these share links';
  END IF;

  RETURN QUERY
  SELECT s.id, s.token, s.visibility, s.department_filter, s.reporter_filter, s.report_ids, s.allowed_emails,
         s.expires_at, s.revoked_at, s.view_count, s.failed_attempts, s.locked_until, s.created_at
  FROM public.cmms_report_export_shares s
  WHERE s.cmms_company_id = p_company_id
  ORDER BY s.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_list_report_export_shares(UUID) TO authenticated;

-- ============================================================
-- 3. _fn_export_share_payload -- report_ids, when set, hard-filters which
-- reports are included, and the scope_label describes the pick instead of
-- (or alongside) the department/employee label. Same RETURNS TABLE shape
-- as before, so no DROP needed.
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

  IF v_share.report_ids IS NOT NULL THEN
    NULL; -- scope_label below handles this case directly; no lookup needed.
  ELSIF v_share.reporter_filter != 'all' THEN
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
      WHEN v_share.report_ids IS NOT NULL THEN
        array_length(v_share.report_ids, 1)::TEXT || ' selected report' || (CASE WHEN array_length(v_share.report_ids, 1) = 1 THEN '' ELSE 's' END)
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
    AND (v_share.report_ids IS NULL OR ccr.id = ANY(v_share.report_ids))
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

SELECT 'CMMS report export share — pick specific reports installed.' AS status;
