-- ============================================================
-- CMMS Job Applications -- surface the written-test link on the public
-- applicant tracking page, not just in an email
-- ============================================================
-- Bug: an applicant assigned a written test (cmms_job_applications.status
-- = 'written_test', see CMMS_WRITTEN_TESTS.sql's assignTestToApplication)
-- sees that status as a badge on the public "Track my application" page
-- (PublicCompanyNoticeBoard.jsx) but has NO way to actually open the test
-- from there -- the /candidate-test?token=<access_token> link only ever
-- went out by email. If that email didn't arrive (spam, typo, delay), the
-- applicant is stuck looking at a "written test" badge with nothing to
-- click, even though the test is sitting there waiting for them.
--
-- Fix: both tracking RPCs now also return the pending assignment's
-- access_token (NULL once the test has been completed or expired, so the
-- button naturally disappears after submission -- status_note already
-- shows the score at that point).
--
-- Run after: CMMS_ANNOUNCEMENTS_AND_JOBS.sql, CMMS_APPLICANT_ACCOUNT_RECOMMENDATION.sql,
-- CMMS_WRITTEN_TESTS.sql.
-- Safe to run more than once.
-- ============================================================

-- fn_get_my_job_applications -- signed-in applicant, no reference code.
DROP FUNCTION IF EXISTS public.fn_get_my_job_applications(UUID);
CREATE OR REPLACE FUNCTION public.fn_get_my_job_applications(p_company_id UUID)
RETURNS TABLE (
  reference_code VARCHAR,
  job_title VARCHAR,
  status VARCHAR,
  status_note TEXT,
  submitted_at TIMESTAMPTZ,
  status_updated_at TIMESTAMPTZ,
  test_access_token VARCHAR
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
  SELECT
    ja.reference_code, a.title, ja.status, ja.status_note, ja.created_at, ja.status_updated_at,
    (
      SELECT ta.access_token FROM public.cmms_test_assignments ta
      WHERE ta.job_application_id = ja.id AND ta.status IN ('assigned', 'in_progress')
      ORDER BY ta.created_at DESC LIMIT 1
    )
  FROM public.cmms_job_applications ja
  JOIN public.cmms_announcements a ON a.id = ja.job_posting_id
  WHERE ja.cmms_company_id = p_company_id
    AND ja.ican_user_id = auth.uid()
  ORDER BY ja.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_my_job_applications(UUID) TO authenticated;

-- fn_track_public_job_application -- reference code + contact, no account.
DROP FUNCTION IF EXISTS public.fn_track_public_job_application(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.fn_track_public_job_application(p_reference_code TEXT, p_contact TEXT)
RETURNS TABLE (
  reference_code VARCHAR,
  job_title VARCHAR,
  company_name VARCHAR,
  status VARCHAR,
  status_note TEXT,
  submitted_at TIMESTAMPTZ,
  status_updated_at TIMESTAMPTZ,
  test_access_token VARCHAR
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ja.reference_code, a.title, cp.company_name, ja.status, ja.status_note,
    ja.created_at, ja.status_updated_at,
    (
      SELECT ta.access_token FROM public.cmms_test_assignments ta
      WHERE ta.job_application_id = ja.id AND ta.status IN ('assigned', 'in_progress')
      ORDER BY ta.created_at DESC LIMIT 1
    )
  FROM public.cmms_job_applications ja
  JOIN public.cmms_announcements a ON a.id = ja.job_posting_id
  JOIN public.cmms_company_profiles cp ON cp.id = ja.cmms_company_id
  WHERE ja.reference_code = UPPER(TRIM(p_reference_code))
    AND (
      lower(ja.applicant_email) = lower(TRIM(p_contact))
      OR ja.applicant_phone = TRIM(p_contact)
    );
$$;

GRANT EXECUTE ON FUNCTION public.fn_track_public_job_application(TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS applicant test-access link (public tracking pages can now open a pending written test) installed' AS status;
