-- ============================================================
-- CMMS Written-Reports Export Sharing
-- Purpose: The "Export Reports" panel in CMSSModule.jsx already lets an
-- admin scope "Written Reports" by department (reportDepartmentFilter --
-- 'all' | 'unassigned' | a department id) and download/print that whole
-- grouped Department -> Employee -> Reports set. This adds a "Share" option
-- next to those Download/Print buttons: a public link to the same grouped
-- view, gated public / password / restricted-to-emails, same three modes
-- and the same security shape as the single-report sharing system in
-- CMMS_REPORT_SHARING_SYSTEM.sql (bcrypt-via-pgcrypto password hashing,
-- SHA-256-hashed attempt-limited OTP codes, opaque hex share tokens,
-- SECURITY DEFINER RPCs the frontend calls directly via supabase-js, anon
-- access only for the read-only viewer RPCs).
--
-- Kept as its own set of tables/functions rather than folding into
-- cmms_report_shares: that table points at exactly one report_id, while
-- this shares a *filtered set* of reports (a "scope"), which is a
-- different shape (one row in, many reports out) -- mirrors how this
-- codebase generally adds a parallel migration file for a variant feature
-- rather than overloading an existing table's meaning.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1. TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_report_export_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  created_by_cmms_user_id UUID NULL REFERENCES public.cmms_users(id) ON DELETE SET NULL,

  -- Same scope model as ReportsManager's reportDepartmentFilter /
  -- reportReporterFilter in CMSSModule.jsx: 'all', 'unassigned', or a
  -- department UUID (stored as text so 'all'/'unassigned' fit the same
  -- column); reporter_filter is the same reporter_email-or-reporter_name
  -- key that groupReportsByDeptAndReporter() keys reporters by, or 'all'.
  department_filter TEXT NOT NULL DEFAULT 'all',
  reporter_filter TEXT NOT NULL DEFAULT 'all',

  token TEXT NOT NULL UNIQUE,
  visibility VARCHAR(20) NOT NULL,
  password_hash TEXT,
  allowed_emails TEXT[],

  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,

  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  view_count INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cmms_report_export_shares_visibility_chk CHECK (visibility IN ('public', 'password', 'restricted')),
  CONSTRAINT cmms_report_export_shares_password_chk CHECK (visibility != 'password' OR password_hash IS NOT NULL),
  CONSTRAINT cmms_report_export_shares_restricted_chk CHECK (visibility != 'restricted' OR (allowed_emails IS NOT NULL AND array_length(allowed_emails, 1) > 0))
);

CREATE INDEX IF NOT EXISTS idx_cmms_report_export_shares_token ON public.cmms_report_export_shares(token);
CREATE INDEX IF NOT EXISTS idx_cmms_report_export_shares_company ON public.cmms_report_export_shares(cmms_company_id);

CREATE TABLE IF NOT EXISTS public.cmms_report_export_share_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES public.cmms_report_export_shares(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmms_report_export_share_otps_lookup ON public.cmms_report_export_share_otps(share_id, email);

CREATE TABLE IF NOT EXISTS public.cmms_report_export_share_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES public.cmms_report_export_shares(id) ON DELETE CASCADE,
  viewer_email TEXT,
  outcome VARCHAR(20) NOT NULL,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cmms_report_export_share_access_log_outcome_chk CHECK (outcome IN ('viewed', 'wrong_password', 'wrong_code', 'locked'))
);

CREATE INDEX IF NOT EXISTS idx_cmms_report_export_share_access_log_share ON public.cmms_report_export_share_access_log(share_id, created_at DESC);

-- No client-facing RLS policies -- same reasoning as
-- CMMS_REPORT_SHARING_SYSTEM.sql: every access goes through the
-- SECURITY DEFINER functions below or, for the OTP email step, through
-- backend/routes/reportShareRoutes.js using the service-role key.
ALTER TABLE public.cmms_report_export_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_report_export_share_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_report_export_share_access_log ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. INTERNAL HELPER -- builds the { scope_label, company_name,
-- report_count, reports } payload shared by all three read paths below.
-- Not granted to anon/authenticated directly: it's only ever called from
-- inside the SECURITY DEFINER functions further down, which already did
-- their own access checks, so it runs under their privileges rather than
-- the original caller's.
-- ============================================================

DROP FUNCTION IF EXISTS public._fn_export_share_payload(UUID) CASCADE;
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

-- ============================================================
-- 3. ADMIN-ONLY MANAGEMENT FUNCTIONS
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_create_report_export_share(UUID, TEXT, TEXT, VARCHAR, TEXT, TEXT[], TIMESTAMPTZ) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_create_report_export_share(
  p_company_id UUID,
  p_department_filter TEXT DEFAULT 'all',
  p_reporter_filter TEXT DEFAULT 'all',
  p_visibility VARCHAR DEFAULT 'public',
  p_password TEXT DEFAULT NULL,
  p_allowed_emails TEXT[] DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
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

  v_token := encode(gen_random_bytes(24), 'hex');

  INSERT INTO public.cmms_report_export_shares (
    cmms_company_id, created_by_cmms_user_id, department_filter, reporter_filter,
    token, visibility, password_hash, allowed_emails, expires_at
  ) VALUES (
    p_company_id, v_cmms_user_id, COALESCE(NULLIF(TRIM(p_department_filter), ''), 'all'), COALESCE(NULLIF(TRIM(p_reporter_filter), ''), 'all'),
    v_token, p_visibility, v_password_hash, v_allowed_emails, p_expires_at
  )
  RETURNING cmms_report_export_shares.id INTO v_new_id;

  RETURN QUERY
  SELECT s.id, s.token, s.visibility, s.expires_at, s.created_at
  FROM public.cmms_report_export_shares s
  WHERE s.id = v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_create_report_export_share(UUID, TEXT, TEXT, VARCHAR, TEXT, TEXT[], TIMESTAMPTZ) TO authenticated;

DROP FUNCTION IF EXISTS public.fn_list_report_export_shares(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_list_report_export_shares(p_company_id UUID)
RETURNS TABLE (
  id UUID,
  token TEXT,
  visibility VARCHAR,
  department_filter TEXT,
  reporter_filter TEXT,
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
  SELECT s.id, s.token, s.visibility, s.department_filter, s.reporter_filter, s.allowed_emails,
         s.expires_at, s.revoked_at, s.view_count, s.failed_attempts, s.locked_until, s.created_at
  FROM public.cmms_report_export_shares s
  WHERE s.cmms_company_id = p_company_id
  ORDER BY s.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_list_report_export_shares(UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.fn_revoke_report_export_share(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_revoke_report_export_share(p_share_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_email TEXT;
  v_company_id UUID;
  v_cmms_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email FROM auth.users WHERE id = auth.uid();
  END IF;

  SELECT s.cmms_company_id INTO v_company_id FROM public.cmms_report_export_shares s WHERE s.id = p_share_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Share not found';
  END IF;

  SELECT LOWER(COALESCE(cu.role, 'member')) INTO v_cmms_role
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = v_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_cmms_role != 'admin' THEN
    RAISE EXCEPTION 'Only a company admin can revoke this share';
  END IF;

  UPDATE public.cmms_report_export_shares SET revoked_at = NOW(), updated_at = NOW() WHERE id = p_share_id;
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_revoke_report_export_share(UUID) TO authenticated;

-- ============================================================
-- 4. ANONYMOUS ACCESS FUNCTIONS
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_get_report_export_share_access(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_get_report_export_share_access(p_token TEXT)
RETURNS TABLE (
  status TEXT,
  visibility VARCHAR,
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
  v_payload record;
BEGIN
  SELECT * INTO v_share FROM public.cmms_report_export_shares WHERE token = p_token;

  IF v_share IS NULL OR v_share.revoked_at IS NOT NULL
     OR (v_share.expires_at IS NOT NULL AND v_share.expires_at <= NOW()) THEN
    RETURN QUERY SELECT 'invalid'::TEXT, NULL::VARCHAR, NULL::VARCHAR, NULL::TEXT, NULL::INT, NULL::JSONB;
    RETURN;
  END IF;

  IF v_share.visibility = 'password' THEN
    SELECT * INTO v_payload FROM public._fn_export_share_payload(v_share.id);
    RETURN QUERY SELECT 'password_required'::TEXT, v_share.visibility, v_payload.company_name, v_payload.scope_label, NULL::INT, NULL::JSONB;
    RETURN;
  END IF;

  IF v_share.visibility = 'restricted' THEN
    SELECT * INTO v_payload FROM public._fn_export_share_payload(v_share.id);
    RETURN QUERY SELECT 'email_required'::TEXT, v_share.visibility, v_payload.company_name, v_payload.scope_label, NULL::INT, NULL::JSONB;
    RETURN;
  END IF;

  -- Public
  UPDATE public.cmms_report_export_shares SET view_count = view_count + 1 WHERE id = v_share.id;
  INSERT INTO public.cmms_report_export_share_access_log (share_id, outcome) VALUES (v_share.id, 'viewed');

  SELECT * INTO v_payload FROM public._fn_export_share_payload(v_share.id);
  RETURN QUERY SELECT 'ok'::TEXT, v_share.visibility, v_payload.company_name, v_payload.scope_label, v_payload.report_count, v_payload.reports;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_report_export_share_access(TEXT) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.fn_verify_report_export_share_password(TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_verify_report_export_share_password(p_token TEXT, p_password TEXT)
RETURNS TABLE (
  status TEXT,
  locked_until TIMESTAMPTZ,
  company_name VARCHAR,
  scope_label TEXT,
  report_count INT,
  reports JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_share record;
  v_payload record;
BEGIN
  SELECT * INTO v_share
  FROM public.cmms_report_export_shares
  WHERE token = p_token AND visibility = 'password';

  IF v_share IS NULL OR v_share.revoked_at IS NOT NULL
     OR (v_share.expires_at IS NOT NULL AND v_share.expires_at <= NOW()) THEN
    RETURN QUERY SELECT 'invalid'::TEXT, NULL::TIMESTAMPTZ, NULL::VARCHAR, NULL::TEXT, NULL::INT, NULL::JSONB;
    RETURN;
  END IF;

  IF v_share.locked_until IS NOT NULL AND v_share.locked_until > NOW() THEN
    RETURN QUERY SELECT 'locked'::TEXT, v_share.locked_until, NULL::VARCHAR, NULL::TEXT, NULL::INT, NULL::JSONB;
    RETURN;
  END IF;

  IF v_share.password_hash IS NULL OR crypt(p_password, v_share.password_hash) != v_share.password_hash THEN
    UPDATE public.cmms_report_export_shares
    SET failed_attempts = failed_attempts + 1,
        locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE locked_until END,
        updated_at = NOW()
    WHERE id = v_share.id;

    INSERT INTO public.cmms_report_export_share_access_log (share_id, outcome)
    VALUES (v_share.id, CASE WHEN v_share.failed_attempts + 1 >= 5 THEN 'locked' ELSE 'wrong_password' END);

    RETURN QUERY SELECT 'invalid_password'::TEXT, NULL::TIMESTAMPTZ, NULL::VARCHAR, NULL::TEXT, NULL::INT, NULL::JSONB;
    RETURN;
  END IF;

  UPDATE public.cmms_report_export_shares
  SET failed_attempts = 0, locked_until = NULL, view_count = view_count + 1, updated_at = NOW()
  WHERE id = v_share.id;

  INSERT INTO public.cmms_report_export_share_access_log (share_id, outcome) VALUES (v_share.id, 'viewed');

  SELECT * INTO v_payload FROM public._fn_export_share_payload(v_share.id);
  RETURN QUERY SELECT 'ok'::TEXT, NULL::TIMESTAMPTZ, v_payload.company_name, v_payload.scope_label, v_payload.report_count, v_payload.reports;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_verify_report_export_share_password(TEXT, TEXT) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.fn_verify_report_export_share_otp(TEXT, TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_verify_report_export_share_otp(p_token TEXT, p_email TEXT, p_code TEXT)
RETURNS TABLE (
  status TEXT,
  company_name VARCHAR,
  scope_label TEXT,
  report_count INT,
  reports JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_share record;
  v_otp record;
  v_payload record;
  v_email TEXT := LOWER(TRIM(p_email));
  v_code_hash TEXT;
BEGIN
  SELECT * INTO v_share
  FROM public.cmms_report_export_shares
  WHERE token = p_token AND visibility = 'restricted';

  IF v_share IS NULL OR v_share.revoked_at IS NOT NULL
     OR (v_share.expires_at IS NOT NULL AND v_share.expires_at <= NOW())
     OR NOT (v_email = ANY(v_share.allowed_emails)) THEN
    RETURN QUERY SELECT 'invalid'::TEXT, NULL::VARCHAR, NULL::TEXT, NULL::INT, NULL::JSONB;
    RETURN;
  END IF;

  IF p_code IS NULL OR p_code !~ '^\d{6}$' THEN
    RETURN QUERY SELECT 'invalid_code'::TEXT, NULL::VARCHAR, NULL::TEXT, NULL::INT, NULL::JSONB;
    RETURN;
  END IF;

  SELECT * INTO v_otp
  FROM public.cmms_report_export_share_otps
  WHERE share_id = v_share.id AND email = v_email
    AND used_at IS NULL AND expires_at > NOW()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_otp IS NULL THEN
    RETURN QUERY SELECT 'no_active_code'::TEXT, NULL::VARCHAR, NULL::TEXT, NULL::INT, NULL::JSONB;
    RETURN;
  END IF;

  IF v_otp.attempts >= 5 THEN
    RETURN QUERY SELECT 'too_many_attempts'::TEXT, NULL::VARCHAR, NULL::TEXT, NULL::INT, NULL::JSONB;
    RETURN;
  END IF;

  v_code_hash := encode(digest(p_code, 'sha256'), 'hex');

  IF v_code_hash != v_otp.code_hash THEN
    UPDATE public.cmms_report_export_share_otps SET attempts = attempts + 1 WHERE id = v_otp.id;
    INSERT INTO public.cmms_report_export_share_access_log (share_id, viewer_email, outcome) VALUES (v_share.id, v_email, 'wrong_code');
    RETURN QUERY SELECT 'invalid_code'::TEXT, NULL::VARCHAR, NULL::TEXT, NULL::INT, NULL::JSONB;
    RETURN;
  END IF;

  UPDATE public.cmms_report_export_share_otps SET used_at = NOW() WHERE id = v_otp.id;
  UPDATE public.cmms_report_export_shares SET view_count = view_count + 1, updated_at = NOW() WHERE id = v_share.id;
  INSERT INTO public.cmms_report_export_share_access_log (share_id, viewer_email, outcome) VALUES (v_share.id, v_email, 'viewed');

  SELECT * INTO v_payload FROM public._fn_export_share_payload(v_share.id);
  RETURN QUERY SELECT 'ok'::TEXT, v_payload.company_name, v_payload.scope_label, v_payload.report_count, v_payload.reports;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_verify_report_export_share_otp(TEXT, TEXT, TEXT) TO anon, authenticated;

SELECT 'CMMS report export sharing installed.' AS status;
