-- ============================================================
-- CMMS Job Applications -- surface the video-interview room and the
-- appointment letter on the public applicant tracking page too, same gap
-- as CMMS_APPLICANT_TEST_ACCESS_LINK.sql fixed for the written test
-- ============================================================
-- Same bug, two more stages of the pipeline: an applicant whose status has
-- moved to 'interview' (CMMS_INTERVIEW_SCHEDULES.sql) or 'hired'
-- (CMMS_HIRE_APPLICANT_INTO_CMMS.sql / CMMS_EMPLOYMENT_DOCUMENTS.sql) sees
-- that status badge on the public tracking page (PublicCompanyNoticeBoard.jsx)
-- but has no way to reach the actual video room or appointment letter from
-- there -- both links previously only ever went out by email.
--
-- Three pieces, mirroring the written-test pattern exactly:
--   1. Both tracking RPCs now also return the applicant's scheduled
--      (not yet joined-and-cancelled) interview id, and their latest
--      issued/signed employment document id -- NULL once there is nothing
--      pending, so the buttons below only ever appear when there is
--      something to act on.
--   2. fn_get_document_prefill_contact -- pre-fills an ICAN signup form from
--      the document's owner (job application or, if none, the cmms_users
--      row directly), same reasoning as the test/interview prefill RPCs.
--   3. fn_link_ican_account_via_document -- links the now-authenticated
--      candidate's ICAN account to whichever of the document's two possible
--      owners (job application, or an existing cmms_users row for a
--      re-issued contract with no application on file) matches the email
--      they just authenticated with. The video interview itself needs no
--      new RPC -- CandidateInterviewRoom.jsx / fn_can_join_interview /
--      fn_link_ican_account_via_interview_schedule already exist and work
--      once the applicant can actually find the link.
--
-- Run after: CMMS_ANNOUNCEMENTS_AND_JOBS.sql, CMMS_APPLICANT_ACCOUNT_RECOMMENDATION.sql,
-- CMMS_APPLICANT_TEST_ACCESS_LINK.sql, CMMS_INTERVIEW_SCHEDULES.sql,
-- CMMS_EMPLOYMENT_DOCUMENTS.sql.
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
  test_access_token VARCHAR,
  interview_schedule_id UUID,
  interview_scheduled_at TIMESTAMPTZ,
  document_id UUID,
  document_status VARCHAR
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
    ),
    (
      SELECT s.id FROM public.cmms_interview_schedules s
      WHERE s.job_application_id = ja.id AND s.status = 'scheduled'
      ORDER BY s.scheduled_at DESC LIMIT 1
    ),
    (
      SELECT s.scheduled_at FROM public.cmms_interview_schedules s
      WHERE s.job_application_id = ja.id AND s.status = 'scheduled'
      ORDER BY s.scheduled_at DESC LIMIT 1
    ),
    (
      SELECT d.id FROM public.cmms_employment_documents d
      WHERE d.job_application_id = ja.id AND d.status IN ('issued', 'signed')
      ORDER BY d.created_at DESC LIMIT 1
    ),
    (
      SELECT d.status FROM public.cmms_employment_documents d
      WHERE d.job_application_id = ja.id AND d.status IN ('issued', 'signed')
      ORDER BY d.created_at DESC LIMIT 1
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
  test_access_token VARCHAR,
  interview_schedule_id UUID,
  interview_scheduled_at TIMESTAMPTZ,
  document_id UUID,
  document_status VARCHAR
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
    ),
    (
      SELECT s.id FROM public.cmms_interview_schedules s
      WHERE s.job_application_id = ja.id AND s.status = 'scheduled'
      ORDER BY s.scheduled_at DESC LIMIT 1
    ),
    (
      SELECT s.scheduled_at FROM public.cmms_interview_schedules s
      WHERE s.job_application_id = ja.id AND s.status = 'scheduled'
      ORDER BY s.scheduled_at DESC LIMIT 1
    ),
    (
      SELECT d.id FROM public.cmms_employment_documents d
      WHERE d.job_application_id = ja.id AND d.status IN ('issued', 'signed')
      ORDER BY d.created_at DESC LIMIT 1
    ),
    (
      SELECT d.status FROM public.cmms_employment_documents d
      WHERE d.job_application_id = ja.id AND d.status IN ('issued', 'signed')
      ORDER BY d.created_at DESC LIMIT 1
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

-- ============================================================
-- Candidate-facing document access (mirrors
-- fn_get_test_prefill_contact / fn_link_ican_account_via_test_token)
-- ============================================================

-- Contact prefill by document id -- callable with NO auth (a candidate
-- arriving via the document link isn't signed in yet). Falls back to the
-- linked cmms_users row when the document has no job_application_id (e.g. a
-- contract re-issued after full onboarding). Never returns document
-- content/terms -- same narrow-shape principle as fn_verify_employment_document.
DROP FUNCTION IF EXISTS public.fn_get_document_prefill_contact(UUID);
CREATE OR REPLACE FUNCTION public.fn_get_document_prefill_contact(p_document_id UUID)
RETURNS TABLE (applicant_name VARCHAR, applicant_email VARCHAR, applicant_phone VARCHAR)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(ja.applicant_name, u.full_name),
    COALESCE(ja.applicant_email, u.email)::VARCHAR,
    COALESCE(ja.applicant_phone, u.phone)
  FROM public.cmms_employment_documents d
  LEFT JOIN public.cmms_job_applications ja ON ja.id = d.job_application_id
  LEFT JOIN public.cmms_users u ON u.id = d.cmms_user_id
  WHERE d.id = p_document_id;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_document_prefill_contact(UUID) TO anon, authenticated;

-- Link the now-authenticated candidate's ICAN account to whichever of the
-- document's two possible owners matches the email they just authenticated
-- with. Tries the job application first (the common case -- the same
-- application ican_user_id link the test/interview stages already use),
-- then the cmms_users row directly (a contract re-issued for an employee
-- with no cmms_job_applications row at all).
DROP FUNCTION IF EXISTS public.fn_link_ican_account_via_document(UUID);
CREATE OR REPLACE FUNCTION public.fn_link_ican_account_via_document(p_document_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_application_id UUID;
  v_cmms_user_id UUID;
  v_owner_email TEXT;
  v_caller_email TEXT;
  v_ja_updated INTEGER := 0;
  v_user_updated INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  SELECT d.job_application_id, d.cmms_user_id INTO v_job_application_id, v_cmms_user_id
  FROM public.cmms_employment_documents d WHERE d.id = p_document_id;

  IF v_job_application_id IS NULL AND v_cmms_user_id IS NULL THEN
    RAISE EXCEPTION 'This document link is invalid.';
  END IF;

  SELECT email INTO v_caller_email FROM auth.users WHERE id = auth.uid();
  IF v_caller_email IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  IF v_job_application_id IS NOT NULL THEN
    SELECT applicant_email INTO v_owner_email FROM public.cmms_job_applications WHERE id = v_job_application_id;
    IF v_owner_email IS NULL OR lower(v_owner_email) <> lower(v_caller_email) THEN
      RAISE EXCEPTION 'Sign in with the same email address you applied with (%).', v_owner_email;
    END IF;
    UPDATE public.cmms_job_applications
    SET ican_user_id = auth.uid(), ican_verified = TRUE, ican_verified_at = NOW()
    WHERE id = v_job_application_id AND (ican_user_id IS NULL OR ican_user_id = auth.uid());
    GET DIAGNOSTICS v_ja_updated = ROW_COUNT;
  END IF;

  IF v_cmms_user_id IS NOT NULL THEN
    SELECT email INTO v_owner_email FROM public.cmms_users WHERE id = v_cmms_user_id;
    IF v_owner_email IS NOT NULL AND lower(v_owner_email) = lower(v_caller_email) THEN
      UPDATE public.cmms_users
      SET ican_user_id = COALESCE(ican_user_id, auth.uid()),
          ican_verified = TRUE, ican_verified_at = NOW()
      WHERE id = v_cmms_user_id AND (ican_user_id IS NULL OR ican_user_id = auth.uid());
      GET DIAGNOSTICS v_user_updated = ROW_COUNT;
    END IF;
  END IF;

  RETURN (v_ja_updated + v_user_updated) > 0 OR EXISTS (
    SELECT 1 FROM public.cmms_employment_documents d
    LEFT JOIN public.cmms_users u ON u.id = d.cmms_user_id
    LEFT JOIN public.cmms_job_applications ja ON ja.id = d.job_application_id
    WHERE d.id = p_document_id AND (u.ican_user_id = auth.uid() OR ja.ican_user_id = auth.uid())
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_link_ican_account_via_document(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS applicant interview + document access link (public tracking pages can now join a pending video interview and open a pending appointment letter) installed' AS status;
