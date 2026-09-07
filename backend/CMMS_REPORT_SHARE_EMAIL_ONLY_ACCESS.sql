-- ============================================================
-- CMMS Report Sharing — email-only access (no verification code)
-- Purpose: the "restricted to emails" mode originally required the viewer
-- to enter their email, receive a 6-digit code, and type it back in
-- (fn_verify_report_share_otp / fn_verify_report_export_share_otp in
-- CMMS_REPORT_SHARING_SYSTEM.sql / CMMS_REPORT_EXPORT_SHARING.sql). Per
-- product decision, that's too much friction: a listed email should see
-- the report as soon as they type it in, with no code step at all.
--
-- Trade-off, explicitly accepted: this only checks that the typed
-- address is on the admin's list — it does not prove the visitor
-- actually controls that inbox (no email is sent). Anyone who knows or
-- guesses an allowed address can view. That's materially weaker than the
-- OTP flow, which stays in place (unused by the UI now, but not
-- removed) in case stronger verification is wanted again later.
-- ============================================================

-- ---- Single report (see CMMS_REPORT_SHARING_SYSTEM.sql) ----

DROP FUNCTION IF EXISTS public.fn_verify_report_share_email(TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_verify_report_share_email(p_token TEXT, p_email TEXT)
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
SET search_path = public
AS $$
DECLARE
  v_share record;
  v_email TEXT := LOWER(TRIM(p_email));
BEGIN
  SELECT * INTO v_share
  FROM public.cmms_report_shares
  WHERE token = p_token AND visibility = 'restricted';

  IF v_share IS NULL OR v_share.revoked_at IS NOT NULL
     OR (v_share.expires_at IS NOT NULL AND v_share.expires_at <= NOW())
     OR v_email IS NULL OR v_email = ''
     OR NOT (v_email = ANY(v_share.allowed_emails)) THEN
    RETURN QUERY SELECT 'not_allowed'::TEXT, NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR,
      NULL::VARCHAR, NULL::TEXT, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

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

GRANT EXECUTE ON FUNCTION public.fn_verify_report_share_email(TEXT, TEXT) TO anon, authenticated;

-- ---- Department-scoped "Written Reports" export (see CMMS_REPORT_EXPORT_SHARING.sql) ----

DROP FUNCTION IF EXISTS public.fn_verify_report_export_share_email(TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_verify_report_export_share_email(p_token TEXT, p_email TEXT)
RETURNS TABLE (
  status TEXT,
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
  v_email TEXT := LOWER(TRIM(p_email));
BEGIN
  SELECT * INTO v_share
  FROM public.cmms_report_export_shares
  WHERE token = p_token AND visibility = 'restricted';

  IF v_share IS NULL OR v_share.revoked_at IS NOT NULL
     OR (v_share.expires_at IS NOT NULL AND v_share.expires_at <= NOW())
     OR v_email IS NULL OR v_email = ''
     OR NOT (v_email = ANY(v_share.allowed_emails)) THEN
    RETURN QUERY SELECT 'not_allowed'::TEXT, NULL::VARCHAR, NULL::TEXT, NULL::INT, NULL::JSONB;
    RETURN;
  END IF;

  UPDATE public.cmms_report_export_shares SET view_count = view_count + 1, updated_at = NOW() WHERE id = v_share.id;
  INSERT INTO public.cmms_report_export_share_access_log (share_id, viewer_email, outcome) VALUES (v_share.id, v_email, 'viewed');

  SELECT * INTO v_payload FROM public._fn_export_share_payload(v_share.id);
  RETURN QUERY SELECT 'ok'::TEXT, v_payload.company_name, v_payload.scope_label, v_payload.report_count, v_payload.reports;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_verify_report_export_share_email(TEXT, TEXT) TO anon, authenticated;

SELECT 'Email-only (no code) report share access installed.' AS status;
