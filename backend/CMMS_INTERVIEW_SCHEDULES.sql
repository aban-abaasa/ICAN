-- ============================================================
-- CMMS Live Video Interview Scheduling
-- ============================================================
-- Schedules a live video interview between one or more staff interviewers
-- and a job applicant, reusing the app's existing full-mesh WebRTC
-- "boardroom" engine (LiveBoardroom.jsx, signaling entirely over Supabase
-- Realtime broadcast/presence -- see ChatWidget.jsx's openCmmsBoardroom for
-- the existing launch pattern this follows). LiveBoardroom needs no new
-- code of its own for this: it only ever reads useAuth()'s {id, email}, and
-- any non-'trust' context value (here: 'cmms-interview') already skips
-- persisted chat and just broadcasts ephemerally, so a one-off room keyed
-- by this schedule's id is a drop-in groupId.
--
-- The candidate must hold a lightweight ICAN account (see
-- CMMS_JOB_APPLICATION_ICAN_LINK.sql) to be identifiable to LiveBoardroom at
-- all -- fn_can_join_interview below is the single gate that decides who
-- (which interviewer, or which candidate) may open that room.
--
-- Run after: CMMS_ANNOUNCEMENTS_AND_JOBS.sql, CMMS_JOB_APPLICATION_ICAN_LINK.sql.
-- Safe to run more than once.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_interview_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_application_id UUID NOT NULL REFERENCES public.cmms_job_applications(id) ON DELETE CASCADE,
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,

  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes > 0),
  interviewer_cmms_user_ids UUID[] NOT NULL DEFAULT '{}',
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),

  created_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmms_interview_schedules_application ON public.cmms_interview_schedules(job_application_id);
CREATE INDEX IF NOT EXISTS idx_cmms_interview_schedules_company ON public.cmms_interview_schedules(cmms_company_id, scheduled_at);

DROP TRIGGER IF EXISTS trg_cmms_interview_schedules_touch_updated_at ON public.cmms_interview_schedules;
CREATE TRIGGER trg_cmms_interview_schedules_touch_updated_at
  BEFORE UPDATE ON public.cmms_interview_schedules
  FOR EACH ROW EXECUTE FUNCTION public.cmms_touch_updated_at();

-- The room id LiveBoardroom's groupId uses -- computed, not stored, so it's
-- always derivable from just the schedule id (no risk of it drifting out of
-- sync with a stored column).
CREATE OR REPLACE FUNCTION public.cmms_interview_room_id(p_schedule_id UUID)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT 'cmms-interview-' || p_schedule_id::text;
$$;

ALTER TABLE public.cmms_interview_schedules ENABLE ROW LEVEL SECURITY;

-- Staff who can manage applications (same permission cmms_job_applications
-- itself uses) may schedule/view/update interviews for their company.
DROP POLICY IF EXISTS cmms_interview_schedules_staff_all ON public.cmms_interview_schedules;
CREATE POLICY cmms_interview_schedules_staff_all ON public.cmms_interview_schedules
  FOR ALL USING (
    public.cmms_has_tool_action(cmms_company_id, 'announcements', 'manage_applications')
  ) WITH CHECK (
    public.cmms_has_tool_action(cmms_company_id, 'announcements', 'manage_applications')
  );

-- The candidate themself may also see their own scheduled interview (to
-- know when to show up) -- matched via the application's linked ICAN account.
DROP POLICY IF EXISTS cmms_interview_schedules_candidate_select ON public.cmms_interview_schedules;
CREATE POLICY cmms_interview_schedules_candidate_select ON public.cmms_interview_schedules
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.cmms_job_applications ja
      WHERE ja.id = cmms_interview_schedules.job_application_id
        AND ja.ican_user_id = auth.uid()
    )
  );

-- fn_can_join_interview -- the single join gate: caller must be signed in as
-- either one of the named interviewers (matched via cmms_users.ican_user_id,
-- same linkage pattern job applications use) or the linked candidate, and
-- the schedule must not be cancelled.
DROP FUNCTION IF EXISTS public.fn_can_join_interview(UUID);
CREATE OR REPLACE FUNCTION public.fn_can_join_interview(p_schedule_id UUID)
RETURNS TABLE (
  can_join BOOLEAN,
  room_id TEXT,
  is_interviewer BOOLEAN,
  scheduled_at TIMESTAMPTZ,
  duration_minutes INTEGER,
  status VARCHAR,
  candidate_name VARCHAR,
  company_name VARCHAR,
  candidate_ican_user_id UUID,
  members JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule public.cmms_interview_schedules;
  v_application public.cmms_job_applications;
  v_is_interviewer BOOLEAN := FALSE;
  v_is_candidate BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required to join this interview.';
  END IF;

  SELECT * INTO v_schedule FROM public.cmms_interview_schedules WHERE id = p_schedule_id;
  IF v_schedule.id IS NULL THEN
    RAISE EXCEPTION 'This interview link is invalid.';
  END IF;

  SELECT * INTO v_application FROM public.cmms_job_applications WHERE id = v_schedule.job_application_id;

  v_is_candidate := (v_application.ican_user_id = auth.uid());
  SELECT EXISTS (
    SELECT 1 FROM public.cmms_users u
    WHERE u.id = ANY(v_schedule.interviewer_cmms_user_ids)
      AND u.ican_user_id = auth.uid()
  ) INTO v_is_interviewer;

  RETURN QUERY
  SELECT
    (v_schedule.status = 'scheduled' AND (v_is_interviewer OR v_is_candidate)),
    public.cmms_interview_room_id(v_schedule.id),
    v_is_interviewer,
    v_schedule.scheduled_at,
    v_schedule.duration_minutes,
    v_schedule.status,
    v_application.applicant_name,
    (SELECT company_name FROM public.cmms_company_profiles WHERE id = v_schedule.cmms_company_id),
    v_application.ican_user_id,
    -- Interviewer {id, email, name} list, for LiveBoardroom's `members` prop
    -- (initial participant display before presence populates it) -- an
    -- interviewer with no linked ICAN account yet is simply omitted, since
    -- they couldn't join the call either way.
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', u.ican_user_id, 'email', au.email, 'name', u.full_name))
      FROM public.cmms_users u
      JOIN auth.users au ON au.id = u.ican_user_id
      WHERE u.id = ANY(v_schedule.interviewer_cmms_user_ids) AND u.ican_user_id IS NOT NULL
    ), '[]'::jsonb);
END;
$$;

-- Contact prefill by schedule id -- callable with NO auth (a candidate
-- arriving via the interview link isn't signed in yet). Returns only the
-- narrow contact shape needed to pre-fill an ICAN signup form -- never the
-- interviewer list or notes.
DROP FUNCTION IF EXISTS public.fn_get_interview_prefill_contact(UUID);
CREATE OR REPLACE FUNCTION public.fn_get_interview_prefill_contact(p_schedule_id UUID)
RETURNS TABLE (job_application_id UUID, applicant_name VARCHAR, applicant_email VARCHAR, applicant_phone VARCHAR)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ja.id, ja.applicant_name, ja.applicant_email, ja.applicant_phone
  FROM public.cmms_interview_schedules s
  JOIN public.cmms_job_applications ja ON ja.id = s.job_application_id
  WHERE s.id = p_schedule_id;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_interview_prefill_contact(UUID) TO anon, authenticated;

-- Link the now-authenticated candidate's ICAN account to their application,
-- called right after signup/signin on the interview link (see
-- CandidateInterviewRoom.jsx). Same email-match proof as
-- fn_link_ican_account_via_test_token.
DROP FUNCTION IF EXISTS public.fn_link_ican_account_via_interview_schedule(UUID);
CREATE OR REPLACE FUNCTION public.fn_link_ican_account_via_interview_schedule(p_schedule_id UUID)
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
  FROM public.cmms_interview_schedules s
  JOIN public.cmms_job_applications ja ON ja.id = s.job_application_id
  WHERE s.id = p_schedule_id;

  IF v_application_id IS NULL THEN
    RAISE EXCEPTION 'This interview link is invalid.';
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

GRANT EXECUTE ON FUNCTION public.fn_link_ican_account_via_interview_schedule(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_can_join_interview(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS live video interview scheduling installed' AS status;
