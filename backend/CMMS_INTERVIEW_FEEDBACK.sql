-- ============================================================
-- CMMS Live Interview Feedback (mark outcome after the call)
-- ============================================================
-- Lets an interviewer mark whether they were satisfied with the candidate
-- after a scheduled interview -- the same "mark it" step the written-test
-- pipeline already has (CMMS_WRITTEN_TESTS.sql's grading, extended by
-- CMMS_WRITTEN_TESTS_QUESTION_TYPES.sql's manual grading), now for the live
-- interview stage too.
--
-- A separate table, not new columns on cmms_interview_schedules, and
-- deliberately staff-only (no candidate SELECT policy at all):
-- cmms_interview_schedules_candidate_select already lets the applicant read
-- their OWN row directly (select *) so they know when to show up, and
-- internal hiring feedback/outcome must never be visible to them the same
-- way -- keeping it in its own table means there's no column on that
-- candidate-readable table to accidentally widen that leak through.
--
-- Run after: CMMS_INTERVIEW_SCHEDULES.sql.
-- Safe to run more than once.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_interview_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_schedule_id UUID NOT NULL UNIQUE REFERENCES public.cmms_interview_schedules(id) ON DELETE CASCADE,
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,

  outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('satisfied', 'not_satisfied')),
  feedback TEXT,

  marked_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmms_interview_feedback_schedule ON public.cmms_interview_feedback(interview_schedule_id);
CREATE INDEX IF NOT EXISTS idx_cmms_interview_feedback_company ON public.cmms_interview_feedback(cmms_company_id);

ALTER TABLE public.cmms_interview_feedback ENABLE ROW LEVEL SECURITY;

-- Same permission every other hiring-pipeline write already requires
-- (scheduling, cancelling, grading a written test).
DROP POLICY IF EXISTS cmms_interview_feedback_staff_all ON public.cmms_interview_feedback;
CREATE POLICY cmms_interview_feedback_staff_all ON public.cmms_interview_feedback
  FOR ALL USING (
    public.cmms_has_tool_action(cmms_company_id, 'announcements', 'manage_applications')
  ) WITH CHECK (
    public.cmms_has_tool_action(cmms_company_id, 'announcements', 'manage_applications')
  );

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS interview feedback (mark outcome) installed' AS status;
