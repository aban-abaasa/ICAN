-- ============================================================
-- CMMS Written Tests -- multiple question types
-- ============================================================
-- Extends the MCQ-only written test (CMMS_WRITTEN_TESTS.sql) with three
-- more question types an admin can mix into the same test:
--   multiple_choice -- unchanged, 4 options, one correct, auto-graded
--   yes_no           -- exactly the same machinery as multiple_choice, just
--                       with two fixed options (id 'yes'/'no') -- still
--                       auto-graded the same way, so no new grading logic
--   short_text        -- one line of free text -- no correct answer to check
--                        against, a human has to read and award points
--   long_text          -- same as short_text, just a paragraph-length answer
-- Free-text answers are stored, then graded afterwards by staff via
-- fn_grade_test_answer -- there is no reliable way to auto-score prose.
--
-- Run after: CMMS_WRITTEN_TESTS.sql.
-- Safe to run more than once.
-- ============================================================

ALTER TABLE public.cmms_test_questions
  ADD COLUMN IF NOT EXISTS question_type VARCHAR(20) NOT NULL DEFAULT 'multiple_choice';

ALTER TABLE public.cmms_test_questions DROP CONSTRAINT IF EXISTS cmms_test_questions_question_type_check;
ALTER TABLE public.cmms_test_questions ADD CONSTRAINT cmms_test_questions_question_type_check
  CHECK (question_type IN ('multiple_choice', 'yes_no', 'short_text', 'long_text'));

-- options/correct_option_id only make sense for multiple_choice/yes_no now.
ALTER TABLE public.cmms_test_questions ALTER COLUMN options DROP NOT NULL;
ALTER TABLE public.cmms_test_questions ALTER COLUMN correct_option_id DROP NOT NULL;

-- Admin's own private reference for grading free-text answers -- never sent
-- to the candidate (fn_get_test_assignment doesn't select it).
ALTER TABLE public.cmms_test_questions
  ADD COLUMN IF NOT EXISTS sample_answer TEXT;

-- The candidate's typed response for short_text/long_text -- MCQ/yes_no
-- keep using selected_option_id exactly as before.
ALTER TABLE public.cmms_test_answers
  ADD COLUMN IF NOT EXISTS answer_text TEXT;

-- Free-text answers start ungraded (NULL, not 0 -- 0 would read as "graded,
-- got nothing") until a human scores them via fn_grade_test_answer.
ALTER TABLE public.cmms_test_answers ALTER COLUMN is_correct DROP NOT NULL;
ALTER TABLE public.cmms_test_answers ALTER COLUMN is_correct DROP DEFAULT;
ALTER TABLE public.cmms_test_answers ALTER COLUMN points_awarded DROP NOT NULL;
ALTER TABLE public.cmms_test_answers ALTER COLUMN points_awarded DROP DEFAULT;

-- ============================================================
-- fn_get_test_assignment -- now also hands the candidate each question's
-- type, so the runner knows whether to render radio options or a text box.
-- ============================================================
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
  question_type VARCHAR,
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
    q.id, q.question_text, q.question_type, q.options, q.order_index
  FROM public.cmms_test_assignments a
  JOIN public.cmms_written_tests t ON t.id = a.test_id
  JOIN public.cmms_company_profiles cp ON cp.id = a.cmms_company_id
  LEFT JOIN public.cmms_test_questions q ON q.test_id = t.id
  WHERE a.access_token = p_access_token
  ORDER BY q.order_index ASC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_test_assignment(TEXT) TO authenticated;

-- ============================================================
-- fn_submit_test_assignment -- type-aware: auto-grades multiple_choice/
-- yes_no exactly as before, stores free text ungraded for short_text/
-- long_text. max_score always reflects every question's points (the full
-- possible total); score only ever counts what's actually been graded so
-- far -- auto or manual -- so a test with pending free-text questions shows
-- a true-but-partial score until staff finish grading it.
-- ============================================================
DROP FUNCTION IF EXISTS public.fn_submit_test_assignment(TEXT, JSONB);
CREATE OR REPLACE FUNCTION public.fn_submit_test_assignment(p_access_token TEXT, p_answers JSONB)
RETURNS TABLE (score INTEGER, max_score INTEGER, pending_review INTEGER)
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
  v_pending INTEGER := 0;
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

    IF v_question.question_type IN ('multiple_choice', 'yes_no') THEN
      v_is_correct := (v_question.correct_option_id = (v_answer ->> 'selected_option_id'));
      v_points := CASE WHEN v_is_correct THEN v_question.points ELSE 0 END;

      INSERT INTO public.cmms_test_answers (assignment_id, question_id, selected_option_id, is_correct, points_awarded)
      VALUES (v_assignment.id, v_question.id, v_answer ->> 'selected_option_id', v_is_correct, v_points)
      ON CONFLICT (assignment_id, question_id) DO UPDATE
      SET selected_option_id = EXCLUDED.selected_option_id, is_correct = EXCLUDED.is_correct,
          points_awarded = EXCLUDED.points_awarded, answer_text = NULL;
    ELSE
      -- short_text / long_text -- stored for a human to grade afterwards;
      -- is_correct/points_awarded stay NULL (pending), never auto-scored.
      INSERT INTO public.cmms_test_answers (assignment_id, question_id, answer_text, is_correct, points_awarded)
      VALUES (v_assignment.id, v_question.id, NULLIF(v_answer ->> 'answer_text', ''), NULL, NULL)
      ON CONFLICT (assignment_id, question_id) DO UPDATE
      SET answer_text = EXCLUDED.answer_text, selected_option_id = NULL, is_correct = NULL, points_awarded = NULL;
    END IF;
  END LOOP;

  SELECT
    COALESCE(SUM(points), 0),
    COALESCE(SUM(points) FILTER (WHERE question_type IN ('short_text', 'long_text')), 0)
  INTO v_max_score, v_pending
  FROM public.cmms_test_questions WHERE test_id = v_assignment.test_id;

  SELECT COALESCE(SUM(points_awarded), 0) INTO v_total_score
  FROM public.cmms_test_answers WHERE assignment_id = v_assignment.id;

  UPDATE public.cmms_test_assignments
  SET status = 'completed', submitted_at = NOW(), score = v_total_score, max_score = v_max_score
  WHERE id = v_assignment.id;

  UPDATE public.cmms_job_applications
  SET status_note = 'Written test score: ' || v_total_score || '/' || v_max_score
    || CASE WHEN v_pending > 0 THEN ' (' || v_pending || ' pt pending review)' ELSE '' END,
      updated_at = NOW()
  WHERE id = v_assignment.job_application_id;

  RETURN QUERY SELECT v_total_score, v_max_score, v_pending;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_submit_test_assignment(TEXT, JSONB) TO authenticated;

-- ============================================================
-- fn_grade_test_answer -- staff scores one free-text answer (0..that
-- question's points), then the assignment's total score is recomputed from
-- every answer's points_awarded (still-pending ones contribute 0 until
-- graded, same running-total logic fn_submit_test_assignment uses).
-- ============================================================
DROP FUNCTION IF EXISTS public.fn_grade_test_answer(UUID, INTEGER);
CREATE OR REPLACE FUNCTION public.fn_grade_test_answer(p_answer_id UUID, p_points_awarded INTEGER)
RETURNS TABLE (assignment_id UUID, score INTEGER, max_score INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_answer public.cmms_test_answers;
  v_question public.cmms_test_questions;
  v_assignment public.cmms_test_assignments;
  v_total_score INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  SELECT * INTO v_answer FROM public.cmms_test_answers WHERE id = p_answer_id;
  IF v_answer.id IS NULL THEN RAISE EXCEPTION 'Answer not found.'; END IF;

  SELECT * INTO v_assignment FROM public.cmms_test_assignments WHERE id = v_answer.assignment_id;
  IF NOT public.cmms_has_tool_action(v_assignment.cmms_company_id, 'announcements', 'manage_applications') THEN
    RAISE EXCEPTION 'You do not have permission to grade this test.';
  END IF;

  SELECT * INTO v_question FROM public.cmms_test_questions WHERE id = v_answer.question_id;
  IF p_points_awarded < 0 OR p_points_awarded > v_question.points THEN
    RAISE EXCEPTION 'Points must be between 0 and % for this question.', v_question.points;
  END IF;

  UPDATE public.cmms_test_answers
  SET points_awarded = p_points_awarded, is_correct = (p_points_awarded >= v_question.points)
  WHERE id = p_answer_id;

  SELECT COALESCE(SUM(points_awarded), 0) INTO v_total_score
  FROM public.cmms_test_answers WHERE assignment_id = v_assignment.id;

  UPDATE public.cmms_test_assignments SET score = v_total_score WHERE id = v_assignment.id;

  UPDATE public.cmms_job_applications
  SET status_note = 'Written test score: ' || v_total_score || '/' || v_assignment.max_score,
      updated_at = NOW()
  WHERE id = v_assignment.job_application_id;

  RETURN QUERY SELECT v_assignment.id, v_total_score, v_assignment.max_score;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_grade_test_answer(UUID, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS written test question types (yes/no, short text, long text) + manual grading installed' AS status;
