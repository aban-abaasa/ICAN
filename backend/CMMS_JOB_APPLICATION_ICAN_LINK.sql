-- ============================================================
-- CMMS Job Applications -> ICAN account link + portfolio resume reuse
-- ============================================================
-- Two additions to cmms_job_applications (CMMS_ANNOUNCEMENTS_AND_JOBS.sql),
-- both needed for the hiring pipeline (written tests + live video
-- interviews) added in CMMS_WRITTEN_TESTS.sql / CMMS_INTERVIEW_SCHEDULES.sql:
--
-- 1. ican_user_id / ican_verified / ican_verified_at -- mirrors the existing
--    cmms_users.ican_user_id pattern (CMMS_ADD_USER_SCHEMA.sql). A candidate
--    applies with no account (unchanged), but taking a written test or
--    joining a live interview requires a lightweight ICAN account; once they
--    sign up/sign in, fn_link_ican_account_to_application below stamps the
--    link so every later access check can just compare auth.uid().
--
-- 2. applicant_portfolio_handle -- if the signed-in candidate already has an
--    ICAN Portfolio (profiles.handle / the public /portfolio/<handle> resume
--    page, see portfolioService.js), let them point to it instead of
--    uploading a fresh PDF -- they already built a real resume there, no
--    reason to redo it.
--
-- Run after: CMMS_ANNOUNCEMENTS_AND_JOBS.sql.
-- Safe to run more than once.
-- ============================================================

ALTER TABLE public.cmms_job_applications
  ADD COLUMN IF NOT EXISTS ican_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ican_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ican_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS applicant_portfolio_handle VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_cmms_job_applications_ican_user ON public.cmms_job_applications(ican_user_id);

-- fn_submit_public_job_application (CMMS_ANNOUNCEMENTS_AND_JOBS.sql) already
-- accepts p_resume_url; a signed-in applicant can additionally pass their
-- portfolio handle as a resume substitute. Re-declared here (not a plain
-- ALTER) since Postgres can't add a parameter to an existing function.
DROP FUNCTION IF EXISTS public.fn_submit_public_job_application(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.fn_submit_public_job_application(
  p_job_posting_id UUID,
  p_applicant_name TEXT,
  p_applicant_email TEXT,
  p_applicant_phone TEXT DEFAULT NULL,
  p_cover_note TEXT DEFAULT NULL,
  p_resume_url TEXT DEFAULT NULL,
  p_resume_path TEXT DEFAULT NULL,
  p_portfolio_handle TEXT DEFAULT NULL
)
RETURNS TABLE (reference_code VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cmms_announcements;
  v_reference_code VARCHAR(20);
  v_ican_user_id UUID := auth.uid(); -- NULL for a genuinely anonymous applicant
BEGIN
  SELECT * INTO v_job
  FROM public.cmms_announcements
  WHERE id = p_job_posting_id
    AND post_type = 'job'
    AND visibility = 'public'
    AND status = 'published'
  FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'This job posting is not open for applications.';
  END IF;

  IF v_job.application_deadline IS NOT NULL AND v_job.application_deadline < CURRENT_DATE THEN
    RAISE EXCEPTION 'The application deadline for this job has passed.';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_applicant_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Applicant name is required.';
  END IF;
  IF NULLIF(TRIM(COALESCE(p_applicant_email, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Applicant email is required.';
  END IF;

  v_reference_code := 'JOB-' || UPPER(SUBSTR(REPLACE(gen_random_uuid()::text, '-', ''), 1, 8));

  INSERT INTO public.cmms_job_applications (
    job_posting_id, cmms_company_id, reference_code,
    applicant_name, applicant_email, applicant_phone,
    cover_note, resume_url, resume_path, status,
    ican_user_id, ican_verified, ican_verified_at, applicant_portfolio_handle
  ) VALUES (
    v_job.id, v_job.cmms_company_id, v_reference_code,
    TRIM(p_applicant_name), LOWER(TRIM(p_applicant_email)), NULLIF(TRIM(COALESCE(p_applicant_phone, '')), ''),
    NULLIF(TRIM(COALESCE(p_cover_note, '')), ''),
    NULLIF(TRIM(COALESCE(p_resume_url, '')), ''), NULLIF(TRIM(COALESCE(p_resume_path, '')), ''),
    'submitted',
    v_ican_user_id, v_ican_user_id IS NOT NULL, CASE WHEN v_ican_user_id IS NOT NULL THEN NOW() END,
    NULLIF(TRIM(COALESCE(p_portfolio_handle, '')), '')
  );

  UPDATE public.cmms_announcements
  SET applications_count = applications_count + 1
  WHERE id = v_job.id;

  RETURN QUERY SELECT v_reference_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_submit_public_job_application(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- The actual linking step (stamping auth.uid() onto ican_user_id) happens
-- via token-scoped RPCs colocated with the flow that needs it -- see
-- fn_link_ican_account_via_test_token (CMMS_WRITTEN_TESTS.sql) and
-- fn_link_ican_account_via_interview_schedule (CMMS_INTERVIEW_SCHEDULES.sql).
-- Both verify the newly-authenticated email matches the application's
-- applicant_email before linking, so a candidate can only ever link their
-- own application. Contact prefill for the signup form itself is scoped the
-- same way -- see fn_get_test_prefill_contact / fn_get_interview_prefill_contact.

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS job application ICAN account link + portfolio resume reuse installed' AS status;
