-- ============================================================
-- CMMS Written Online Tests (admin-built MCQ, auto-scored)
-- ============================================================
-- Lets a company admin build a multiple-choice test tied to a job posting,
-- send it to a specific applicant (cmms_job_applications), and have it
-- auto-scored the moment the candidate submits. No free-text grading in
-- this version -- every question is MCQ with exactly one correct option.
--
-- The candidate must hold a lightweight ICAN account to take a test (per
-- the app's hiring-pipeline decision -- see CMMS_JOB_APPLICATION_ICAN_LINK.sql
-- for how ican_user_id gets linked to their application). The access token
-- is what a "Take your test" email/notification link carries
-- (/candidate-test?token=<access_token>, see CandidateTestRunner.jsx); the
-- RPCs below additionally require auth.uid() to match the application's
-- linked ican_user_id, so the token alone -- without being signed in as
-- that exact candidate -- is not enough to see the questions or answers.
--
-- Run after: CMMS_ANNOUNCEMENTS_AND_JOBS.sql, CMMS_JOB_APPLICATION_ICAN_LINK.sql.
-- Safe to run more than once.
-- ============================================================

-- ============================================================
-- 1. cmms_written_tests -- the question bank / test definition
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_written_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  job_posting_id UUID REFERENCES public.cmms_announcements(id) ON DELETE SET NULL,

  title VARCHAR(255) NOT NULL,
  description TEXT,
  time_limit_minutes INTEGER CHECK (time_limit_minutes IS NULL OR time_limit_minutes > 0),
  passing_score INTEGER CHECK (passing_score IS NULL OR passing_score BETWEEN 0 AND 100),
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),

  created_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmms_written_tests_company ON public.cmms_written_tests(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_cmms_written_tests_job ON public.cmms_written_tests(job_posting_id);

DROP TRIGGER IF EXISTS trg_cmms_written_tests_touch_updated_at ON public.cmms_written_tests;
CREATE TRIGGER trg_cmms_written_tests_touch_updated_at
  BEFORE UPDATE ON public.cmms_written_tests
  FOR EACH ROW EXECUTE FUNCTION public.cmms_touch_updated_at();

-- ============================================================
-- 2. cmms_test_questions -- MCQ bank for a test
-- options is a JSONB array of {id, text}, e.g.
-- [{"id":"a","text":"..."}, {"id":"b","text":"..."}]. correct_option_id
-- must match one options[].id. Never selected by the candidate-facing RPC
-- below (fn_get_test_assignment strips it before returning).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_test_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES public.cmms_written_tests(id) ON DELETE CASCADE,

  question_text TEXT NOT NULL,
  options JSONB NOT NULL,
  correct_option_id TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 1 CHECK (points > 0),
  order_index INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmms_test_questions_test ON public.cmms_test_questions(test_id, order_index);

-- ============================================================
-- 3. cmms_test_assignments -- one candidate's attempt at one test
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_test_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES public.cmms_written_tests(id) ON DELETE CASCADE,
  job_application_id UUID NOT NULL REFERENCES public.cmms_job_applications(id) ON DELETE CASCADE,
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,

  access_token VARCHAR(64) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'in_progress', 'completed', 'expired')),

  score INTEGER,
  max_score INTEGER,
  started_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,

  created_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmms_test_assignments_application ON public.cmms_test_assignments(job_application_id);
CREATE INDEX IF NOT EXISTS idx_cmms_test_assignments_token ON public.cmms_test_assignments(access_token);

-- ============================================================
-- 4. cmms_test_answers -- graded per-question answers for one assignment
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_test_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.cmms_test_assignments(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.cmms_test_questions(id) ON DELETE CASCADE,
  selected_option_id TEXT,
  is_correct BOOLEAN NOT NULL DEFAULT FALSE,
  points_awarded INTEGER NOT NULL DEFAULT 0,

  UNIQUE (assignment_id, question_id)
);

-- ============================================================
-- 5. Extend cmms_job_applications.status to add 'written_test' (the
-- live-interview stage reuses the existing 'interview' value).
-- ============================================================
ALTER TABLE public.cmms_job_applications DROP CONSTRAINT IF EXISTS cmms_job_applications_status_check;
ALTER TABLE public.cmms_job_applications ADD CONSTRAINT cmms_job_applications_status_check
  CHECK (status IN ('submitted', 'under_review', 'shortlisted', 'written_test', 'interview', 'rejected', 'hired', 'withdrawn'));

-- ============================================================
-- 6. RLS -- staff side (admin/creator or a role with the "announcements"
-- tool's "manage_applications" action, same permission that already gates
-- cmms_job_applications) can manage tests/questions/assignments/answers for
-- their own company. Candidates never touch these tables directly -- only
-- through the SECURITY DEFINER RPCs below.
-- ============================================================
ALTER TABLE public.cmms_written_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_test_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_test_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_test_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cmms_written_tests_staff_all ON public.cmms_written_tests;
CREATE POLICY cmms_written_tests_staff_all ON public.cmms_written_tests
  FOR ALL USING (
    public.cmms_has_tool_action(cmms_company_id, 'announcements', 'manage_applications')
  ) WITH CHECK (
    public.cmms_has_tool_action(cmms_company_id, 'announcements', 'manage_applications')
  );

DROP POLICY IF EXISTS cmms_test_questions_staff_all ON public.cmms_test_questions;
CREATE POLICY cmms_test_questions_staff_all ON public.cmms_test_questions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.cmms_written_tests t
      WHERE t.id = cmms_test_questions.test_id
        AND public.cmms_has_tool_action(t.cmms_company_id, 'announcements', 'manage_applications')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cmms_written_tests t
      WHERE t.id = cmms_test_questions.test_id
        AND public.cmms_has_tool_action(t.cmms_company_id, 'announcements', 'manage_applications')
    )
  );

DROP POLICY IF EXISTS cmms_test_assignments_staff_all ON public.cmms_test_assignments;
CREATE POLICY cmms_test_assignments_staff_all ON public.cmms_test_assignments
  FOR ALL USING (
    public.cmms_has_tool_action(cmms_company_id, 'announcements', 'manage_applications')
  ) WITH CHECK (
    public.cmms_has_tool_action(cmms_company_id, 'announcements', 'manage_applications')
  );

DROP POLICY IF EXISTS cmms_test_answers_staff_select ON public.cmms_test_answers;
CREATE POLICY cmms_test_answers_staff_select ON public.cmms_test_answers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.cmms_test_assignments a
      WHERE a.id = cmms_test_answers.assignment_id
        AND public.cmms_has_tool_action(a.cmms_company_id, 'announcements', 'manage_applications')
    )
  );

-- ============================================================
-- 7. Candidate-facing RPCs -- SECURITY DEFINER, authenticated only (a
-- candidate must hold an ICAN account and be signed in as the exact
-- account linked to the application, per fn_link_ican_account_to_application).
-- ============================================================

-- 7a. Fetch the assignment + test + questions (never the correct answer).
DROP FUNCTION IF EXISTS public.fn_get_test_assignment(TEXT);
CREATE OR REPLACE FUNCTION public.fn_get_test_assignment(p_access_token TEXT)
RETURNS TABLE (
  assignment_id UUID,
  status VARCHAR,
  started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  score INTEGER,
  max_score INTEGER,
  test_title VARCHAR,
  test_description TEXT,
  time_limit_minutes INTEGER,
  company_name VARCHAR,
  question_id UUID,
  question_text TEXT,
  options JSONB,
  order_index INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment public.cmms_test_assignments;
  v_application public.cmms_job_applications;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required to view this test.';
  END IF;

  SELECT * INTO v_assignment FROM public.cmms_test_assignments WHERE access_token = p_access_token;
  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'This test link is invalid.';
  END IF;

  SELECT * INTO v_application FROM public.cmms_job_applications WHERE id = v_assignment.job_application_id;
  IF v_application.ican_user_id IS NULL OR v_application.ican_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'This test was not assigned to your account.';
  END IF;

  RETURN QUERY
  SELECT
    a.id, a.status, a.started_at, a.expires_at, a.score, a.max_score,
    t.title, t.description, t.time_limit_minutes,
    cp.company_name,
    q.id, q.question_text, q.options, q.order_index
  FROM public.cmms_test_assignments a
  JOIN public.cmms_written_tests t ON t.id = a.test_id
  JOIN public.cmms_company_profiles cp ON cp.id = a.cmms_company_id
  LEFT JOIN public.cmms_test_questions q ON q.test_id = t.id
  WHERE a.access_token = p_access_token
  ORDER BY q.order_index ASC NULLS LAST;
END;
$$;

-- 7b. Start the timer.
DROP FUNCTION IF EXISTS public.fn_start_test_assignment(TEXT);
CREATE OR REPLACE FUNCTION public.fn_start_test_assignment(p_access_token TEXT)
RETURNS TABLE (started_at TIMESTAMPTZ, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment public.cmms_test_assignments;
  v_application public.cmms_job_applications;
  v_time_limit INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  SELECT * INTO v_assignment FROM public.cmms_test_assignments WHERE access_token = p_access_token FOR UPDATE;
  IF v_assignment.id IS NULL THEN RAISE EXCEPTION 'This test link is invalid.'; END IF;

  SELECT * INTO v_application FROM public.cmms_job_applications WHERE id = v_assignment.job_application_id;
  IF v_application.ican_user_id IS NULL OR v_application.ican_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'This test was not assigned to your account.';
  END IF;

  IF v_assignment.status = 'completed' THEN
    RAISE EXCEPTION 'You have already submitted this test.';
  END IF;

  IF v_assignment.started_at IS NULL THEN
    SELECT t.time_limit_minutes INTO v_time_limit FROM public.cmms_written_tests t WHERE t.id = v_assignment.test_id;
    UPDATE public.cmms_test_assignments
    SET status = 'in_progress', started_at = NOW(),
        expires_at = CASE WHEN v_time_limit IS NOT NULL THEN NOW() + (v_time_limit || ' minutes')::INTERVAL ELSE NULL END
    WHERE id = v_assignment.id;
  END IF;

  RETURN QUERY SELECT a.started_at, a.expires_at FROM public.cmms_test_assignments a WHERE a.id = v_assignment.id;
END;
$$;

-- 7c. Submit answers -- grades server-side, the only place correct_option_id
-- is ever compared, and writes the score onto both the assignment and (as a
-- status_note, so staff see it inline) the application.
DROP FUNCTION IF EXISTS public.fn_submit_test_assignment(TEXT, JSONB);
CREATE OR REPLACE FUNCTION public.fn_submit_test_assignment(p_access_token TEXT, p_answers JSONB)
RETURNS TABLE (score INTEGER, max_score INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment public.cmms_test_assignments;
  v_application public.cmms_job_applications;
  v_answer JSONB;
  v_question public.cmms_test_questions;
  v_total_score INTEGER := 0;
  v_max_score INTEGER := 0;
  v_is_correct BOOLEAN;
  v_points INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  SELECT * INTO v_assignment FROM public.cmms_test_assignments WHERE access_token = p_access_token FOR UPDATE;
  IF v_assignment.id IS NULL THEN RAISE EXCEPTION 'This test link is invalid.'; END IF;

  SELECT * INTO v_application FROM public.cmms_job_applications WHERE id = v_assignment.job_application_id;
  IF v_application.ican_user_id IS NULL OR v_application.ican_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'This test was not assigned to your account.';
  END IF;

  IF v_assignment.status = 'completed' THEN
    RAISE EXCEPTION 'You have already submitted this test.';
  END IF;

  IF v_assignment.expires_at IS NOT NULL AND v_assignment.expires_at < NOW() THEN
    UPDATE public.cmms_test_assignments SET status = 'expired' WHERE id = v_assignment.id;
    RAISE EXCEPTION 'The time limit for this test has passed.';
  END IF;

  FOR v_answer IN SELECT * FROM jsonb_array_elements(COALESCE(p_answers, '[]'::jsonb))
  LOOP
    SELECT * INTO v_question FROM public.cmms_test_questions
    WHERE id = (v_answer ->> 'question_id')::UUID AND test_id = v_assignment.test_id;
    IF v_question.id IS NULL THEN CONTINUE; END IF;

    v_is_correct := (v_question.correct_option_id = (v_answer ->> 'selected_option_id'));
    v_points := CASE WHEN v_is_correct THEN v_question.points ELSE 0 END;
    v_max_score := v_max_score + v_question.points;
    v_total_score := v_total_score + v_points;

    INSERT INTO public.cmms_test_answers (assignment_id, question_id, selected_option_id, is_correct, points_awarded)
    VALUES (v_assignment.id, v_question.id, v_answer ->> 'selected_option_id', v_is_correct, v_points)
    ON CONFLICT (assignment_id, question_id) DO UPDATE
    SET selected_option_id = EXCLUDED.selected_option_id, is_correct = EXCLUDED.is_correct, points_awarded = EXCLUDED.points_awarded;
  END LOOP;

  -- Any question left unanswered by the candidate still counts toward
  -- max_score so the denominator always reflects the full test, not just
  -- however many questions they got to.
  SELECT COALESCE(SUM(points), 0) INTO v_max_score FROM public.cmms_test_questions WHERE test_id = v_assignment.test_id;

  UPDATE public.cmms_test_assignments
  SET status = 'completed', submitted_at = NOW(), score = v_total_score, max_score = v_max_score
  WHERE id = v_assignment.id;

  UPDATE public.cmms_job_applications
  SET status_note = 'Written test score: ' || v_total_score || '/' || v_max_score,
      updated_at = NOW()
  WHERE id = v_assignment.job_application_id;

  RETURN QUERY SELECT v_total_score, v_max_score;
END;
$$;

-- 7d. Contact prefill by token -- callable with NO auth at all (a candidate
-- arriving via the test link isn't signed in yet), so an ICAN signup form
-- can pre-fill name/email/phone before they even have an account. Returns
-- only that narrow contact shape -- never test content, questions, or score.
DROP FUNCTION IF EXISTS public.fn_get_test_prefill_contact(TEXT);
CREATE OR REPLACE FUNCTION public.fn_get_test_prefill_contact(p_access_token TEXT)
RETURNS TABLE (job_application_id UUID, applicant_name VARCHAR, applicant_email VARCHAR, applicant_phone VARCHAR)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ja.id, ja.applicant_name, ja.applicant_email, ja.applicant_phone
  FROM public.cmms_test_assignments a
  JOIN public.cmms_job_applications ja ON ja.id = a.job_application_id
  WHERE a.access_token = p_access_token;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_test_prefill_contact(TEXT) TO anon, authenticated;

-- 7e. Link the now-authenticated candidate's ICAN account to their
-- application, called right after signup/signin on the test link (see
-- CandidateTestRunner.jsx). Verifies the caller's own auth email matches
-- the application's applicant_email (SECURITY DEFINER functions run with
-- the function owner's grants, unlike an RLS policy body, so reading
-- auth.users here is safe -- same reasoning as cmms_current_user_id_for_company).
DROP FUNCTION IF EXISTS public.fn_link_ican_account_via_test_token(TEXT);
CREATE OR REPLACE FUNCTION public.fn_link_ican_account_via_test_token(p_access_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_application_id UUID;
  v_applicant_email VARCHAR;
  v_caller_email TEXT;
  v_updated INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  SELECT ja.id, ja.applicant_email INTO v_application_id, v_applicant_email
  FROM public.cmms_test_assignments a
  JOIN public.cmms_job_applications ja ON ja.id = a.job_application_id
  WHERE a.access_token = p_access_token;

  IF v_application_id IS NULL THEN
    RAISE EXCEPTION 'This test link is invalid.';
  END IF;

  SELECT email INTO v_caller_email FROM auth.users WHERE id = auth.uid();

  IF v_caller_email IS NULL OR lower(v_caller_email) <> lower(v_applicant_email) THEN
    RAISE EXCEPTION 'Sign in with the same email address you applied with (%).', v_applicant_email;
  END IF;

  UPDATE public.cmms_job_applications
  SET ican_user_id = auth.uid(), ican_verified = TRUE, ican_verified_at = NOW()
  WHERE id = v_application_id AND (ican_user_id IS NULL OR ican_user_id = auth.uid());

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_link_ican_account_via_test_token(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_test_assignment(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_start_test_assignment(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_submit_test_assignment(TEXT, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS written online tests (MCQ, auto-scored) installed' AS status;
