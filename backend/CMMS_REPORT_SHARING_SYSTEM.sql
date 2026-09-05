-- ============================================================
-- CMMS Report Sharing System
-- Purpose: Let a CMMS admin generate a link for a single report
-- (public.cmms_company_reports) that an outside viewer -- with no
-- ICAN account -- can open, in one of three privacy modes:
--   - public:     anyone with the link
--   - password:   anyone with the link + a password the admin sets
--   - restricted: only specific email addresses, proven with a
--                 6-digit code emailed to them on demand
--
-- Follows the same shape as this codebase's other self-service auth
-- flows rather than inventing a new one:
--   - Password hashing:  crypt(pw, gen_salt('bf')) -- same bcrypt-via-
--     pgcrypto idiom as AGENT_CASH_IN_PIN_VERIFICATION.sql.
--   - OTP codes:          SHA-256 hash via digest(), attempt-limited --
--     same shape as account_creation_otps in
--     SIGNUP_EMAIL_OTP_VERIFICATION.sql (a 6-digit code's entropy is
--     the limiting factor either way, not the hash).
--   - Opaque share token:  encode(gen_random_bytes(24), 'hex') -- same
--     idea as pin_reset_tokens' raw-token-only-ever-in-the-email
--     pattern in PIN_RESET_EMAIL_SELFSERVICE.sql, except this token is
--     the link itself (it's meant to be shared) rather than a secret.
--   - Business logic lives in SECURITY DEFINER RPCs the frontend calls
--     directly via supabase-js, same as fn_get_filtered_reports /
--     fn_create_filtered_report in CMMS_ROLE_BASED_REPORT_ACCESS.sql.
--     Only sending the OTP email needs a trusted Node process (Resend
--     needs a server-side API key) -- see backend/routes/reportShareRoutes.js.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1. TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_report_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.cmms_company_reports(id) ON DELETE CASCADE,
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  created_by_cmms_user_id UUID NULL REFERENCES public.cmms_users(id) ON DELETE SET NULL,

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

  CONSTRAINT cmms_report_shares_visibility_chk CHECK (visibility IN ('public', 'password', 'restricted')),
  CONSTRAINT cmms_report_shares_password_chk CHECK (visibility != 'password' OR password_hash IS NOT NULL),
  CONSTRAINT cmms_report_shares_restricted_chk CHECK (visibility != 'restricted' OR (allowed_emails IS NOT NULL AND array_length(allowed_emails, 1) > 0))
);

CREATE INDEX IF NOT EXISTS idx_cmms_report_shares_token ON public.cmms_report_shares(token);
CREATE INDEX IF NOT EXISTS idx_cmms_report_shares_report ON public.cmms_report_shares(report_id);
CREATE INDEX IF NOT EXISTS idx_cmms_report_shares_company ON public.cmms_report_shares(cmms_company_id);

CREATE TABLE IF NOT EXISTS public.cmms_report_share_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES public.cmms_report_shares(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmms_report_share_otps_lookup ON public.cmms_report_share_otps(share_id, email);

CREATE TABLE IF NOT EXISTS public.cmms_report_share_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES public.cmms_report_shares(id) ON DELETE CASCADE,
  viewer_email TEXT,
  outcome VARCHAR(20) NOT NULL,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cmms_report_share_access_log_outcome_chk CHECK (outcome IN ('viewed', 'wrong_password', 'wrong_code', 'locked'))
);

CREATE INDEX IF NOT EXISTS idx_cmms_report_share_access_log_share ON public.cmms_report_share_access_log(share_id, created_at DESC);

-- No client-facing RLS policies on any of these three tables -- every
-- access goes through the SECURITY DEFINER functions below (which run
-- as the table owner regardless of RLS) or, for the OTP email step
-- only, through backend/routes/reportShareRoutes.js using the
-- service-role key. Same shape as pin_reset_tokens.
ALTER TABLE public.cmms_report_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_report_share_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_report_share_access_log ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. ADMIN-ONLY MANAGEMENT FUNCTIONS
-- (mirrors fn_get_filtered_reports' auth.jwt() email -> cmms_users join)
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_create_report_share(UUID, VARCHAR, TEXT, TEXT[], TIMESTAMPTZ) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_create_report_share(
  p_report_id UUID,
  p_visibility VARCHAR,
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
  v_company_id UUID;
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

  SELECT ccr.cmms_company_id INTO v_company_id
  FROM public.cmms_company_reports ccr
  WHERE ccr.id = p_report_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Report not found';
  END IF;

  SELECT cu.id, LOWER(COALESCE(cu.role, 'member'))
  INTO v_cmms_user_id, v_cmms_role
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = v_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_cmms_user_id IS NULL OR v_cmms_role != 'admin' THEN
    RAISE EXCEPTION 'Only a company admin can share this report';
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

  INSERT INTO public.cmms_report_shares (
    report_id, cmms_company_id, created_by_cmms_user_id,
    token, visibility, password_hash, allowed_emails, expires_at
  ) VALUES (
    p_report_id, v_company_id, v_cmms_user_id,
    v_token, p_visibility, v_password_hash, v_allowed_emails, p_expires_at
  )
  RETURNING cmms_report_shares.id INTO v_new_id;

  RETURN QUERY
  SELECT crs.id, crs.token, crs.visibility, crs.expires_at, crs.created_at
  FROM public.cmms_report_shares crs
  WHERE crs.id = v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_create_report_share(UUID, VARCHAR, TEXT, TEXT[], TIMESTAMPTZ) TO authenticated;

DROP FUNCTION IF EXISTS public.fn_list_report_shares(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_list_report_shares(p_report_id UUID)
RETURNS TABLE (
  id UUID,
  token TEXT,
  visibility VARCHAR,
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

  SELECT ccr.cmms_company_id INTO v_company_id
  FROM public.cmms_company_reports ccr
  WHERE ccr.id = p_report_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Report not found';
  END IF;

  SELECT LOWER(COALESCE(cu.role, 'member')) INTO v_cmms_role
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = v_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_cmms_role != 'admin' THEN
    RAISE EXCEPTION 'Only a company admin can view this report''s shares';
  END IF;

  RETURN QUERY
  SELECT crs.id, crs.token, crs.visibility, crs.allowed_emails, crs.expires_at,
         crs.revoked_at, crs.view_count, crs.failed_attempts, crs.locked_until, crs.created_at
  FROM public.cmms_report_shares crs
  WHERE crs.report_id = p_report_id
  ORDER BY crs.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_list_report_shares(UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.fn_revoke_report_share(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_revoke_report_share(p_share_id UUID)
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

  SELECT crs.cmms_company_id INTO v_company_id
  FROM public.cmms_report_shares crs
  WHERE crs.id = p_share_id;

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

  UPDATE public.cmms_report_shares
  SET revoked_at = NOW(), updated_at = NOW()
  WHERE id = p_share_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_revoke_report_share(UUID) TO authenticated;

-- ============================================================
-- 3. ANONYMOUS ACCESS FUNCTIONS
-- (GRANT ... TO anon, authenticated -- same as redeem_pin_reset_token
-- in PIN_RESET_EMAIL_SELFSERVICE.sql: a viewer following a share link
-- has no ICAN session, by design.)
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_get_report_share_access(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_get_report_share_access(p_token TEXT)
RETURNS TABLE (
  status TEXT,
  visibility VARCHAR,
  company_name VARCHAR,
  report_title TEXT,
  report_category VARCHAR,
  severity VARCHAR,
  report_body TEXT,
  report_status VARCHAR,
  reporter_name VARCHAR,
  reporter_role VARCHAR,
  report_created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_share record;
BEGIN
  SELECT * INTO v_share
  FROM public.cmms_report_shares
  WHERE token = p_token;

  IF v_share IS NULL OR v_share.revoked_at IS NOT NULL
     OR (v_share.expires_at IS NOT NULL AND v_share.expires_at <= NOW()) THEN
    RETURN QUERY SELECT 'invalid'::TEXT, NULL::VARCHAR, NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR,
      NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_share.visibility = 'password' THEN
    RETURN QUERY SELECT 'password_required'::TEXT, v_share.visibility, NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR,
      NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_share.visibility = 'restricted' THEN
    RETURN QUERY SELECT 'email_required'::TEXT, v_share.visibility, NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR,
      NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- Public
  UPDATE public.cmms_report_shares SET view_count = view_count + 1 WHERE id = v_share.id;
  INSERT INTO public.cmms_report_share_access_log (share_id, outcome) VALUES (v_share.id, 'viewed');

  RETURN QUERY
  SELECT 'ok'::TEXT, v_share.visibility, cp.company_name, ccr.report_title, ccr.report_category,
         ccr.severity, ccr.report_body, ccr.status, ccr.reporter_name, ccr.reporter_role, ccr.created_at
  FROM public.cmms_company_reports ccr
  JOIN public.cmms_company_profiles cp ON cp.id = ccr.cmms_company_id
  WHERE ccr.id = v_share.report_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_report_share_access(TEXT) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.fn_verify_report_share_password(TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_verify_report_share_password(p_token TEXT, p_password TEXT)
RETURNS TABLE (
  status TEXT,
  locked_until TIMESTAMPTZ,
  company_name VARCHAR,
  report_title TEXT,
  report_category VARCHAR,
  severity VARCHAR,
  report_body TEXT,
  report_status VARCHAR,
  reporter_name VARCHAR,
  reporter_role VARCHAR,
  report_created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_share record;
BEGIN
  SELECT * INTO v_share
  FROM public.cmms_report_shares
  WHERE token = p_token AND visibility = 'password';

  IF v_share IS NULL OR v_share.revoked_at IS NOT NULL
     OR (v_share.expires_at IS NOT NULL AND v_share.expires_at <= NOW()) THEN
    RETURN QUERY SELECT 'invalid'::TEXT, NULL::TIMESTAMPTZ, NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR,
      NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_share.locked_until IS NOT NULL AND v_share.locked_until > NOW() THEN
    RETURN QUERY SELECT 'locked'::TEXT, v_share.locked_until, NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR,
      NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_share.password_hash IS NULL OR crypt(p_password, v_share.password_hash) != v_share.password_hash THEN
    UPDATE public.cmms_report_shares
    SET failed_attempts = failed_attempts + 1,
        locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE locked_until END,
        updated_at = NOW()
    WHERE id = v_share.id;

    INSERT INTO public.cmms_report_share_access_log (share_id, outcome)
    VALUES (v_share.id, CASE WHEN v_share.failed_attempts + 1 >= 5 THEN 'locked' ELSE 'wrong_password' END);

    RETURN QUERY SELECT 'invalid_password'::TEXT, NULL::TIMESTAMPTZ, NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR,
      NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  UPDATE public.cmms_report_shares
  SET failed_attempts = 0, locked_until = NULL, view_count = view_count + 1, updated_at = NOW()
  WHERE id = v_share.id;

  INSERT INTO public.cmms_report_share_access_log (share_id, outcome) VALUES (v_share.id, 'viewed');

  RETURN QUERY
  SELECT 'ok'::TEXT, NULL::TIMESTAMPTZ, cp.company_name, ccr.report_title, ccr.report_category,
         ccr.severity, ccr.report_body, ccr.status, ccr.reporter_name, ccr.reporter_role, ccr.created_at
  FROM public.cmms_company_reports ccr
  JOIN public.cmms_company_profiles cp ON cp.id = ccr.cmms_company_id
  WHERE ccr.id = v_share.report_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_verify_report_share_password(TEXT, TEXT) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.fn_verify_report_share_otp(TEXT, TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_verify_report_share_otp(p_token TEXT, p_email TEXT, p_code TEXT)
RETURNS TABLE (
  status TEXT,
  company_name VARCHAR,
  report_title TEXT,
  report_category VARCHAR,
  severity VARCHAR,
  report_body TEXT,
  report_status VARCHAR,
  reporter_name VARCHAR,
  reporter_role VARCHAR,
  report_created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_share record;
  v_otp record;
  v_email TEXT := LOWER(TRIM(p_email));
  v_code_hash TEXT;
BEGIN
  SELECT * INTO v_share
  FROM public.cmms_report_shares
  WHERE token = p_token AND visibility = 'restricted';

  IF v_share IS NULL OR v_share.revoked_at IS NOT NULL
     OR (v_share.expires_at IS NOT NULL AND v_share.expires_at <= NOW())
     OR NOT (v_email = ANY(v_share.allowed_emails)) THEN
    RETURN QUERY SELECT 'invalid'::TEXT, NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR,
      NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF p_code IS NULL OR p_code !~ '^\d{6}$' THEN
    RETURN QUERY SELECT 'invalid_code'::TEXT, NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR,
      NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT * INTO v_otp
  FROM public.cmms_report_share_otps
  WHERE share_id = v_share.id AND email = v_email
    AND used_at IS NULL AND expires_at > NOW()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_otp IS NULL THEN
    RETURN QUERY SELECT 'no_active_code'::TEXT, NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR,
      NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_otp.attempts >= 5 THEN
    RETURN QUERY SELECT 'too_many_attempts'::TEXT, NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR,
      NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  v_code_hash := encode(digest(p_code, 'sha256'), 'hex');

  IF v_code_hash != v_otp.code_hash THEN
    UPDATE public.cmms_report_share_otps SET attempts = attempts + 1 WHERE id = v_otp.id;
    INSERT INTO public.cmms_report_share_access_log (share_id, viewer_email, outcome) VALUES (v_share.id, v_email, 'wrong_code');
    RETURN QUERY SELECT 'invalid_code'::TEXT, NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR,
      NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  UPDATE public.cmms_report_share_otps SET used_at = NOW() WHERE id = v_otp.id;
  UPDATE public.cmms_report_shares SET view_count = view_count + 1, updated_at = NOW() WHERE id = v_share.id;
  INSERT INTO public.cmms_report_share_access_log (share_id, viewer_email, outcome) VALUES (v_share.id, v_email, 'viewed');

  RETURN QUERY
  SELECT 'ok'::TEXT, cp.company_name, ccr.report_title, ccr.report_category,
         ccr.severity, ccr.report_body, ccr.status, ccr.reporter_name, ccr.reporter_role, ccr.created_at
  FROM public.cmms_company_reports ccr
  JOIN public.cmms_company_profiles cp ON cp.id = ccr.cmms_company_id
  WHERE ccr.id = v_share.report_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_verify_report_share_otp(TEXT, TEXT, TEXT) TO anon, authenticated;

SELECT 'CMMS report sharing system installed.' AS status;
