-- ============================================================================
-- SUPPORT_CONSOLE.sql
-- ============================================================================
-- Purpose: a shareable link into ICANDevDashboard (ICANDevPanel.jsx) that
-- doesn't require typing in the master DEV_TOKEN ('dev_ICAN_Pr0_KV25', a
-- plain JS constant already shipped in the ICANDevPanel bundle) by hand.
-- The admin picks which nav tabs a given link should show (allowed_tabs,
-- default ['messages','board'] — defaults to just the low-risk Public
-- Board/Messages tabs, but can include any other tab). IMPORTANT: this is a
-- UI-level restriction only — every tab calls the same DEV_TOKEN-gated
-- RPCs underneath regardless of which ones are shown, so a link enabling
-- anything beyond Messages/Public Board effectively hands out full
-- dev-panel power (all user data, wallets, account recovery) to whoever
-- opens it. The admin UI (SupportTeamTab) shows this tradeoff explicitly
-- when picking tabs; it is not enforced here.
--
-- Deliberately mirrors CMMS_REPORT_SHARING_SYSTEM.sql's link-sharing shape
-- (same tables/columns/RPC pattern, same password-hashing and OTP-email
-- idiom) rather than inventing a new one — same two access modes:
--   - password:   the developer sets a password when creating the link
--   - restricted: the developer types in the allowed Gmail address(es);
--                 the viewer proves it with a 6-digit code emailed to them
--                 (reuses backend/routes/reportShareRoutes.js's existing
--                 OTP-email factory — see the added /request-support-link-otp
--                 route)
--
-- Design note on the Public Board delegation: devListAllLandingMessages /
-- devReplyToLandingMessage / devMarkCorrectAnswer (landingMessagesService.js)
-- call RPCs whose SQL bodies were never checked into this repo (created
-- directly in the Supabase SQL editor at some point), and landing_messages'
-- own schema isn't tracked here either. Rather than guess at column names
-- and risk writing broken SQL, the verify functions below hand an
-- already-verified caller the real dev token so the frontend keeps calling
-- those existing, working RPCs unchanged (see SupportConsole.jsx).
--
-- IWOS contract-staffing (near the bottom) is deliberately decoupled from
-- links: a link viewer has no real Supabase identity, so there's nothing to
-- pay. Onboarding someone as an IWOS contractor is a separate admin action,
-- keyed by their real ICAN account email.
--
-- Safe to re-run.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------
-- 1. Tables — same shape as cmms_report_shares / _otps / _access_log
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ican_support_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token           TEXT NOT NULL UNIQUE,
  label           TEXT,                    -- who/what this link is for, e.g. "Jane — support"
  visibility      TEXT NOT NULL,
  password_hash   TEXT,
  allowed_emails  TEXT[],
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  view_count      INT NOT NULL DEFAULT 0,
  -- Which ICANDevPanel nav tabs this link's board_token is meant to unlock.
  -- UI-level only: every tab still calls the same DEV_TOKEN-gated RPCs
  -- underneath, so a link enabling anything beyond 'board'/'messages' is
  -- handing out the literal master token — see the admin-UI warning in
  -- SupportTeamTab (ICANDevPanel.jsx). Not enforced here.
  allowed_tabs    TEXT[] NOT NULL DEFAULT ARRAY['messages', 'board'],

  CONSTRAINT ican_support_links_visibility_chk CHECK (visibility IN ('password', 'restricted')),
  CONSTRAINT ican_support_links_password_chk CHECK (visibility != 'password' OR password_hash IS NOT NULL),
  CONSTRAINT ican_support_links_restricted_chk CHECK (visibility != 'restricted' OR (allowed_emails IS NOT NULL AND array_length(allowed_emails, 1) > 0))
);
CREATE INDEX IF NOT EXISTS idx_support_links_token ON public.ican_support_links (token);

-- CREATE TABLE IF NOT EXISTS above is a no-op on an install that already
-- ran an earlier version of this file (before allowed_tabs existed) — same
-- trap called out in CORPORATE_SUBSCRIPTION_TRIAL_AND_ICAN_BILLING.sql for
-- monthly_price_ic. Add the column explicitly so re-running actually picks
-- it up on an existing table.
ALTER TABLE public.ican_support_links
  ADD COLUMN IF NOT EXISTS allowed_tabs TEXT[] NOT NULL DEFAULT ARRAY['messages', 'board'];

CREATE TABLE IF NOT EXISTS public.ican_support_link_otps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id    UUID NOT NULL REFERENCES public.ican_support_links(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  attempts    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_link_otps_lookup ON public.ican_support_link_otps (share_id, email);

-- Column named share_id (not link_id) so reportShareRoutes.js's existing
-- buildOtpRequestHandler() factory — which hard-codes that column name —
-- can be reused unmodified for this table too.
CREATE TABLE IF NOT EXISTS public.ican_support_link_access_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id     UUID NOT NULL REFERENCES public.ican_support_links(id) ON DELETE CASCADE,
  viewer_email TEXT,
  outcome      TEXT NOT NULL,
  ip_address   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ican_support_link_access_log_outcome_chk CHECK (outcome IN ('viewed', 'wrong_password', 'wrong_code', 'locked'))
);

ALTER TABLE public.ican_support_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_support_link_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_support_link_access_log ENABLE ROW LEVEL SECURITY;
-- No policies — every read/write goes through the SECURITY DEFINER functions below.

-- ------------------------------------------------------------
-- 2. Admin management — same dev_token-gated convention as every other
--    ican_dev_* function in ICANDevPanel.jsx.
-- ------------------------------------------------------------
-- Signature gained p_allowed_tabs — drop the earlier 5-arg version first
-- (CREATE OR REPLACE can't change a function's parameter list; same
-- reasoning as request_account_unlock()'s drop in
-- ACCOUNT_NUMBER_AND_PIN_RESET_SCOPING.sql).
DROP FUNCTION IF EXISTS public.ican_dev_create_support_link(TEXT, TEXT, TEXT, TEXT, TEXT[]);

CREATE OR REPLACE FUNCTION public.ican_dev_create_support_link(
  dev_token TEXT,
  p_label TEXT DEFAULT NULL,
  p_visibility TEXT DEFAULT 'password',
  p_password TEXT DEFAULT NULL,
  p_allowed_emails TEXT[] DEFAULT NULL,
  p_allowed_tabs TEXT[] DEFAULT ARRAY['messages', 'board']
) RETURNS JSONB SECURITY DEFINER SET search_path = public, extensions LANGUAGE plpgsql AS $$
DECLARE
  v_token TEXT;
  v_password_hash TEXT;
  v_allowed_emails TEXT[];
  v_allowed_tabs TEXT[];
  v_id UUID;
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;

  IF p_visibility NOT IN ('password', 'restricted') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid visibility mode.');
  END IF;

  IF p_visibility = 'password' THEN
    IF p_password IS NULL OR length(p_password) < 4 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Password must be at least 4 characters.');
    END IF;
    v_password_hash := crypt(p_password, gen_salt('bf'));
  END IF;

  IF p_visibility = 'restricted' THEN
    IF p_allowed_emails IS NULL OR array_length(p_allowed_emails, 1) IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Enter at least one email address.');
    END IF;
    SELECT array_agg(DISTINCT lower(trim(addr))) INTO v_allowed_emails
    FROM unnest(p_allowed_emails) AS addr
    WHERE trim(addr) != '';
  END IF;

  v_allowed_tabs := CASE WHEN p_allowed_tabs IS NULL OR array_length(p_allowed_tabs, 1) IS NULL
                         THEN ARRAY['messages', 'board'] ELSE p_allowed_tabs END;

  v_token := encode(gen_random_bytes(24), 'hex');

  INSERT INTO public.ican_support_links (token, label, visibility, password_hash, allowed_emails, allowed_tabs, created_by)
  VALUES (v_token, p_label, p_visibility, v_password_hash, v_allowed_emails, v_allowed_tabs, auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id, 'token', v_token, 'visibility', p_visibility);
END;
$$;
REVOKE ALL ON FUNCTION public.ican_dev_create_support_link(TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_dev_create_support_link(TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT[]) TO anon, authenticated;

-- Same reasoning as ican_dev_create_support_link's drop above — this
-- function's RETURNS TABLE shape gained allowed_tabs, and CREATE OR REPLACE
-- cannot change OUT-parameter row types.
DROP FUNCTION IF EXISTS public.ican_dev_list_support_links(TEXT);

CREATE OR REPLACE FUNCTION public.ican_dev_list_support_links(dev_token TEXT)
RETURNS TABLE (
  id UUID, token TEXT, label TEXT, visibility TEXT, allowed_emails TEXT[], allowed_tabs TEXT[],
  revoked_at TIMESTAMPTZ, view_count INT, failed_attempts INT, locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ
) SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT l.id, l.token, l.label, l.visibility, l.allowed_emails, l.allowed_tabs,
           l.revoked_at, l.view_count, l.failed_attempts, l.locked_until, l.created_at
    FROM public.ican_support_links l
    ORDER BY l.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.ican_dev_list_support_links(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_dev_list_support_links(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.ican_dev_revoke_support_link(dev_token TEXT, p_link_id UUID)
RETURNS JSONB SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE public.ican_support_links SET revoked_at = now() WHERE id = p_link_id AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Link not found or already revoked.');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.ican_dev_revoke_support_link(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_dev_revoke_support_link(TEXT, UUID) TO anon, authenticated;

-- Un-revoke: a revoked link is meant to be a dead end, not a one-way door —
-- the admin may have revoked it by mistake, or want to hand the same URL
-- back out later instead of minting a new token. Also clears any
-- brute-force lockout picked up before it was revoked, so the link is
-- immediately usable again rather than silently still locked.
CREATE OR REPLACE FUNCTION public.ican_dev_reactivate_support_link(dev_token TEXT, p_link_id UUID)
RETURNS JSONB SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE public.ican_support_links
     SET revoked_at = NULL, failed_attempts = 0, locked_until = NULL
   WHERE id = p_link_id AND revoked_at IS NOT NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Link not found or already live.');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.ican_dev_reactivate_support_link(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_dev_reactivate_support_link(TEXT, UUID) TO anon, authenticated;

-- Change which tabs an existing link grants without having to revoke it
-- and mint a new URL (the token, password/allowlist, and usage history all
-- stay put — only allowed_tabs changes).
CREATE OR REPLACE FUNCTION public.ican_dev_update_support_link_tabs(dev_token TEXT, p_link_id UUID, p_allowed_tabs TEXT[])
RETURNS JSONB SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_allowed_tabs IS NULL OR array_length(p_allowed_tabs, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pick at least one tab for this link to open.');
  END IF;
  UPDATE public.ican_support_links SET allowed_tabs = p_allowed_tabs WHERE id = p_link_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Link not found.');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.ican_dev_update_support_link_tabs(TEXT, UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_dev_update_support_link_tabs(TEXT, UUID, TEXT[]) TO anon, authenticated;

-- ------------------------------------------------------------
-- 3. Anonymous access — same three-function shape as
--    fn_get_report_share_access / fn_verify_report_share_password /
--    fn_verify_report_share_otp, returning a board token instead of
--    report content on success.
-- ------------------------------------------------------------

-- "What does this link need?" — SupportConsole.jsx calls this first.
CREATE OR REPLACE FUNCTION public.support_get_link_access(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_link public.ican_support_links;
BEGIN
  SELECT * INTO v_link FROM public.ican_support_links WHERE token = p_token;

  IF v_link.id IS NULL OR v_link.revoked_at IS NOT NULL
     OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= now()) THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF v_link.visibility = 'password' THEN
    RETURN jsonb_build_object('status', 'password_required', 'label', v_link.label);
  END IF;

  RETURN jsonb_build_object('status', 'email_required', 'label', v_link.label);
END;
$$;
REVOKE ALL ON FUNCTION public.support_get_link_access(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_get_link_access(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.support_verify_link_password(p_token TEXT, p_password TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_link public.ican_support_links;
BEGIN
  SELECT * INTO v_link FROM public.ican_support_links WHERE token = p_token AND visibility = 'password';

  IF v_link.id IS NULL OR v_link.revoked_at IS NOT NULL
     OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= now()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This link is invalid or has been revoked.');
  END IF;

  IF v_link.locked_until IS NOT NULL AND v_link.locked_until > now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many wrong attempts. Try again later.');
  END IF;

  IF v_link.password_hash IS NULL OR crypt(p_password, v_link.password_hash) != v_link.password_hash THEN
    UPDATE public.ican_support_links
       SET failed_attempts = failed_attempts + 1,
           locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN now() + interval '30 minutes' ELSE locked_until END
     WHERE id = v_link.id;
    INSERT INTO public.ican_support_link_access_log (share_id, outcome)
    VALUES (v_link.id, CASE WHEN v_link.failed_attempts + 1 >= 5 THEN 'locked' ELSE 'wrong_password' END);
    RETURN jsonb_build_object('success', false, 'error', 'Wrong password.');
  END IF;

  UPDATE public.ican_support_links
     SET failed_attempts = 0, locked_until = NULL, view_count = view_count + 1
   WHERE id = v_link.id;
  INSERT INTO public.ican_support_link_access_log (share_id, outcome) VALUES (v_link.id, 'viewed');

  RETURN jsonb_build_object('success', true, 'label', v_link.label, 'board_token', 'dev_ICAN_Pr0_KV25', 'allowed_tabs', to_jsonb(v_link.allowed_tabs));
END;
$$;
REVOKE ALL ON FUNCTION public.support_verify_link_password(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_verify_link_password(TEXT, TEXT) TO anon, authenticated;

-- OTP request itself (email send) goes through
-- backend/routes/reportShareRoutes.js's new /request-support-link-otp
-- route (same buildOtpRequestHandler factory, pointed at these tables) —
-- that needs a trusted server process for the Resend API key, same
-- reasoning as the CMMS report-share OTP. This function only verifies the
-- code once the viewer has it.
CREATE OR REPLACE FUNCTION public.support_verify_link_otp(p_token TEXT, p_email TEXT, p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_link public.ican_support_links;
  v_otp public.ican_support_link_otps;
  v_email TEXT := lower(trim(p_email));
  v_code_hash TEXT;
BEGIN
  SELECT * INTO v_link FROM public.ican_support_links WHERE token = p_token AND visibility = 'restricted';

  IF v_link.id IS NULL OR v_link.revoked_at IS NOT NULL
     OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= now())
     OR NOT (v_email = ANY(v_link.allowed_emails)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This link is invalid or has been revoked.');
  END IF;

  IF p_code IS NULL OR p_code !~ '^\d{6}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter the 6-digit code.');
  END IF;

  SELECT * INTO v_otp FROM public.ican_support_link_otps
   WHERE share_id = v_link.id AND email = v_email AND used_at IS NULL AND expires_at > now()
   ORDER BY created_at DESC LIMIT 1;

  IF v_otp.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active code — request a new one.');
  END IF;

  IF v_otp.attempts >= 5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many attempts — request a new code.');
  END IF;

  v_code_hash := encode(digest(p_code, 'sha256'), 'hex');

  IF v_code_hash != v_otp.code_hash THEN
    UPDATE public.ican_support_link_otps SET attempts = attempts + 1 WHERE id = v_otp.id;
    INSERT INTO public.ican_support_link_access_log (share_id, viewer_email, outcome) VALUES (v_link.id, v_email, 'wrong_code');
    RETURN jsonb_build_object('success', false, 'error', 'Wrong code.');
  END IF;

  UPDATE public.ican_support_link_otps SET used_at = now() WHERE id = v_otp.id;
  UPDATE public.ican_support_links SET view_count = view_count + 1 WHERE id = v_link.id;
  INSERT INTO public.ican_support_link_access_log (share_id, viewer_email, outcome) VALUES (v_link.id, v_email, 'viewed');

  RETURN jsonb_build_object('success', true, 'label', v_link.label, 'board_token', 'dev_ICAN_Pr0_KV25', 'allowed_tabs', to_jsonb(v_link.allowed_tabs));
END;
$$;
REVOKE ALL ON FUNCTION public.support_verify_link_otp(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_verify_link_otp(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- 4. Onboard a real ICAN account as an IWOS contract worker — independent
--    of support links (a link viewer has no real identity to pay). Looks
--    the person up by their ICAN account email, mirrors
--    grantBusinessAccess()/saveBusinessCompensation() in
--    businessManagementService.js exactly (same tables, same column sets,
--    same onConflict keys).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ican_dev_onboard_iwos_support_staff(
  dev_token TEXT,
  p_target_email TEXT,
  p_base_pay_amount NUMERIC,
  p_currency TEXT DEFAULT 'UGX',
  p_pay_frequency TEXT DEFAULT 'contract',
  p_job_title TEXT DEFAULT 'Support Agent'
) RETURNS JSONB SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  v_iwos_id UUID;
  v_user_id UUID;
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;

  IF p_base_pay_amount IS NULL OR p_base_pay_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter a pay amount greater than zero.');
  END IF;
  IF p_pay_frequency NOT IN ('hourly', 'daily', 'weekly', 'monthly', 'contract') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid pay frequency.');
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(trim(p_target_email)) LIMIT 1;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No ICAN account found for that email.');
  END IF;

  v_iwos_id := public.fn_get_platform_fee_business_id();
  IF v_iwos_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'IWOS business is not configured (fn_get_platform_fee_business_id() returned NULL).');
  END IF;

  INSERT INTO public.business_account_members
    (business_profile_id, auth_user_id, employment_status, job_title, permissions, invited_by, joined_at)
  VALUES
    (v_iwos_id, v_user_id, 'active', p_job_title, '{}'::jsonb, NULL, now())
  ON CONFLICT (business_profile_id, auth_user_id) DO UPDATE SET
    employment_status = 'active',
    job_title = EXCLUDED.job_title;

  INSERT INTO public.business_compensation_profiles
    (business_profile_id, employee_user_id, pay_type, base_salary, currency, pay_frequency, effective_from, payroll_status)
  VALUES
    (v_iwos_id, v_user_id,
     CASE WHEN p_pay_frequency = 'hourly' THEN 'hourly' ELSE 'monthly' END,
     p_base_pay_amount, upper(trim(p_currency)), p_pay_frequency, CURRENT_DATE, 'on_pay')
  ON CONFLICT (business_profile_id, employee_user_id, effective_from) DO UPDATE SET
    base_salary = EXCLUDED.base_salary,
    currency = EXCLUDED.currency,
    pay_frequency = EXCLUDED.pay_frequency,
    payroll_status = 'on_pay';

  RETURN jsonb_build_object('success', true, 'business_profile_id', v_iwos_id, 'user_id', v_user_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.ican_dev_onboard_iwos_support_staff(TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_dev_onboard_iwos_support_staff(TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- 5. Read-only IWOS staff/pay overview for the admin screen. Goes through a
--    dev_token-gated RPC rather than a direct table call under real RLS
--    (which requires ican_business_admin) — ICANDevPanel.jsx sessions
--    aren't necessarily a real authenticated Supabase user (the SignIn.jsx
--    dev intercept just sets a sessionStorage flag, no real auth.uid()).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ican_dev_get_iwos_overview(dev_token TEXT)
RETURNS JSONB SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  v_iwos_id UUID;
  v_members JSONB;
  v_compensation JSONB;
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;

  v_iwos_id := public.fn_get_platform_fee_business_id();

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.created_at DESC), '[]'::jsonb) INTO v_members
  FROM public.business_account_members m
  WHERE m.business_profile_id = v_iwos_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.effective_from DESC), '[]'::jsonb) INTO v_compensation
  FROM public.business_compensation_profiles c
  WHERE c.business_profile_id = v_iwos_id;

  RETURN jsonb_build_object(
    'business_profile_id', v_iwos_id,
    'members', v_members,
    'compensation', v_compensation
  );
END;
$$;
REVOKE ALL ON FUNCTION public.ican_dev_get_iwos_overview(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_iwos_overview(TEXT) TO anon, authenticated;

-- Without this, PostgREST keeps serving its cached schema and a brand-new
-- or resignatured RPC (like ican_dev_create_support_link just above) 404s
-- from the client for a while after this script runs — same fix used in
-- CMMS_ROLE_POSITION_DETAILS.sql.
NOTIFY pgrst, 'reload schema';

SELECT 'Support Console installed' AS status;
-- ============================================================================
-- VERIFY
-- ============================================================================
-- SELECT ican_dev_create_support_link('dev_ICAN_Pr0_KV25', 'Test', 'password', 'test1234');
-- SELECT support_get_link_access('<token from above>');
-- SELECT support_verify_link_password('<token>', 'test1234');
-- SELECT * FROM ican_support_links;
-- SELECT * FROM business_account_members WHERE business_profile_id = fn_get_platform_fee_business_id();
-- SELECT * FROM business_compensation_profiles WHERE business_profile_id = fn_get_platform_fee_business_id();
-- ============================================================================
