-- ============================================================
-- CMMS Job Applications -- recommend an ICAN account so a forgotten
-- reference code is never the only way to check an application again
-- ============================================================
-- Today, an anonymous applicant's only way to check status later is typing
-- back their exact reference code + contact (fn_track_public_job_application)
-- -- lose the code and the application is effectively gone to them, even
-- though the record itself is fine. This gives them a second, permanent
-- path: a free ICAN account, linked to every application they've ever
-- submitted with that email, browsable with no code at all.
--
-- Two pieces:
--   1. fn_link_ican_account_to_application -- an explicit, immediate link,
--      called right after an applicant creates/signs into an ICAN account
--      from the "Application submitted!" screen (PublicCompanyNoticeBoard.jsx),
--      proven the same way fn_track_public_job_application already proves
--      ownership (reference code + the email/phone used to apply).
--   2. fn_get_my_job_applications -- self-healing: if step 1 never got a
--      chance to run (e.g. Supabase required email confirmation before a
--      session existed), simply signing in later with the SAME email this
--      RPC is called with still finds and auto-links any of that email's
--      unlinked applications at this company, purely by matching the
--      caller's own verified auth email -- no code needed, ever again.
--
-- Run after: CMMS_ANNOUNCEMENTS_AND_JOBS.sql, CMMS_JOB_APPLICATION_ICAN_LINK.sql.
-- Safe to run more than once.
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_link_ican_account_to_application(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.fn_link_ican_account_to_application(
  p_reference_code TEXT,
  p_contact TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  UPDATE public.cmms_job_applications
  SET ican_user_id = auth.uid(), ican_verified = TRUE, ican_verified_at = NOW()
  WHERE reference_code = UPPER(TRIM(p_reference_code))
    AND (ican_user_id IS NULL OR ican_user_id = auth.uid())
    AND (
      lower(applicant_email) = lower(TRIM(p_contact))
      OR applicant_phone = TRIM(p_contact)
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_link_ican_account_to_application(TEXT, TEXT) TO authenticated;

-- fn_get_my_job_applications -- lists the caller's own applications at one
-- company with no reference code at all: matched by an existing
-- ican_user_id link OR (self-healing, and then persisted) by the caller's
-- own verified auth email matching what they applied with.
DROP FUNCTION IF EXISTS public.fn_get_my_job_applications(UUID);
CREATE OR REPLACE FUNCTION public.fn_get_my_job_applications(p_company_id UUID)
RETURNS TABLE (
  reference_code VARCHAR,
  job_title VARCHAR,
  status VARCHAR,
  status_note TEXT,
  submitted_at TIMESTAMPTZ,
  status_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  SELECT au.email INTO v_email FROM auth.users au WHERE au.id = auth.uid();

  -- Opportunistically link anything this email applied with but that never
  -- got linked (e.g. they signed up after applying and email confirmation
  -- delayed the explicit link above) -- so the next time this runs, and
  -- every other feature keyed on ican_user_id (written tests, interviews,
  -- hiring), already sees it as linked too.
  UPDATE public.cmms_job_applications
  SET ican_user_id = auth.uid(), ican_verified = TRUE, ican_verified_at = NOW()
  WHERE cmms_company_id = p_company_id
    AND ican_user_id IS NULL
    AND v_email IS NOT NULL
    AND lower(applicant_email) = lower(v_email);

  RETURN QUERY
  SELECT ja.reference_code, a.title, ja.status, ja.status_note, ja.created_at, ja.status_updated_at
  FROM public.cmms_job_applications ja
  JOIN public.cmms_announcements a ON a.id = ja.job_posting_id
  WHERE ja.cmms_company_id = p_company_id
    AND ja.ican_user_id = auth.uid()
  ORDER BY ja.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_my_job_applications(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS applicant account recommendation (link + self-healing lookup) installed' AS status;
