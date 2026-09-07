-- ============================================================
-- CMMS Live Video Interview -- notify the assigned interviewer(s) too
-- ============================================================
-- Bug: scheduling a live interview (CMMS_INTERVIEW_SCHEDULES.sql) only ever
-- put the candidate's join link on the admin's clipboard ("Copy link" in
-- CMMSAnnouncementsPanel.jsx) for them to manually forward. The named
-- interviewer(s) got nothing -- no notification, no link -- unless the
-- scheduling admin happened to tell them separately. fn_can_join_interview
-- already correctly gates who may open the room (the linked candidate, or
-- one of the named interviewers); this migration just makes sure the
-- interviewers actually learn the room exists and get their own link to it.
--
-- Two pieces:
--   1. fn_create_cmms_notification (CMMS_TASK_NOTIFICATION_DEEPLINK.sql)
--      gains an optional p_action_link -- the table
--      (CMMS_NOTIFICATIONS_TABLE.sql) already had an action_link column,
--      it was just never populated. Existing callers (fn_assign_job,
--      fn_update_job_assignment_status) are unaffected -- the new
--      parameter is trailing and defaults to NULL.
--   2. fn_notify_interview_scheduled -- loops the schedule's
--      interviewer_cmms_user_ids and sends each one their own notification
--      with action_link = https://icanera.space/candidate-interview?scheduleId=<id>
--      (always the production domain, never wherever the admin happened to
--      schedule from), the SAME standalone join page the candidate uses
--      (fn_can_join_interview already tells that page whether the caller is
--      the interviewer or the candidate). Called by
--      cmmsInterviewService.scheduleInterview() right after the schedule
--      row is inserted -- best-effort, never blocks scheduling itself if it
--      fails. Interviewers can also join without leaving the CMMS app at
--      all via the new "Join call" button in CMMSAnnouncementsPanel.jsx,
--      which calls fn_can_join_interview directly and drops straight into
--      LiveBoardroom in place.
--
-- Run after: CMMS_INTERVIEW_SCHEDULES.sql, CMMS_NOTIFICATIONS_TABLE.sql,
-- CMMS_TASK_NOTIFICATION_DEEPLINK.sql.
-- Safe to run more than once.
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_create_cmms_notification(UUID, UUID, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_create_cmms_notification(
  p_cmms_user_id UUID,
  p_cmms_company_id UUID,
  p_notification_type VARCHAR,
  p_title VARCHAR,
  p_message TEXT,
  p_icon VARCHAR DEFAULT '📬',
  p_action_tab VARCHAR DEFAULT 'tasks',
  p_action_label VARCHAR DEFAULT 'View',
  p_related_task_id UUID DEFAULT NULL,
  p_action_link VARCHAR DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_cmms_user_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.cmms_notifications (
    cmms_user_id,
    cmms_company_id,
    notification_type,
    title,
    message,
    icon,
    action_tab,
    action_label,
    related_task_id,
    action_link
  ) VALUES (
    p_cmms_user_id,
    p_cmms_company_id,
    p_notification_type,
    p_title,
    p_message,
    p_icon,
    p_action_tab,
    p_action_label,
    p_related_task_id,
    p_action_link
  );
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification failure block the action that triggered it.
  RAISE NOTICE 'Warning: Failed to create cmms_notification - %', SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_create_cmms_notification(UUID, UUID, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, UUID, VARCHAR) TO authenticated;

-- fn_notify_interview_scheduled -- one notification per named interviewer,
-- each with their own direct join link. Gated by the same
-- 'manage_applications' permission scheduling itself requires, so only
-- staff who could schedule the interview can trigger notifications for it.
DROP FUNCTION IF EXISTS public.fn_notify_interview_scheduled(UUID);
CREATE OR REPLACE FUNCTION public.fn_notify_interview_scheduled(p_schedule_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule public.cmms_interview_schedules;
  v_applicant_name VARCHAR;
  v_interviewer_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  SELECT * INTO v_schedule FROM public.cmms_interview_schedules WHERE id = p_schedule_id;
  IF v_schedule.id IS NULL THEN
    RAISE EXCEPTION 'Interview schedule not found.';
  END IF;

  IF NOT public.cmms_has_tool_action(v_schedule.cmms_company_id, 'announcements', 'manage_applications') THEN
    RAISE EXCEPTION 'You do not have permission to notify interviewers for this company.';
  END IF;

  SELECT applicant_name INTO v_applicant_name
  FROM public.cmms_job_applications WHERE id = v_schedule.job_application_id;

  FOREACH v_interviewer_id IN ARRAY v_schedule.interviewer_cmms_user_ids
  LOOP
    PERFORM public.fn_create_cmms_notification(
      v_interviewer_id,
      v_schedule.cmms_company_id,
      'interview_scheduled',
      'Interview scheduled: ' || COALESCE(v_applicant_name, 'Candidate'),
      'You''re an interviewer for ' || COALESCE(v_applicant_name, 'a candidate') ||
        ' on ' || to_char(v_schedule.scheduled_at, 'FMDD Mon YYYY, HH12:MI AM') || '.',
      '🎥',
      'notices',
      'Join interview',
      NULL,
      -- Absolute, hardcoded to the production domain -- never
      -- window.location.origin/a relative path, so the link always lands on
      -- the real deployed site (where Supabase Realtime signaling for the
      -- call is actually configured) regardless of which environment the
      -- interview was scheduled from.
      'https://icanera.space/candidate-interview?scheduleId=' || v_schedule.id
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_notify_interview_scheduled(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS interview-scheduled notifications (interviewers now get their own join link) installed' AS status;
