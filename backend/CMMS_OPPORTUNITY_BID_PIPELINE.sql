-- ============================================================
-- CMMS Opportunity Bid Pipeline -- gives business-opportunity bids the same
-- status/interview treatment cmms_job_applications already has, and lets a
-- winning bid become a task through the Service Provider Contract mechanism
-- that already exists for exactly this case.
-- ============================================================
-- Bids (CMMS_BUSINESS_OPPORTUNITIES_AND_BIDS.sql) only ever had a flat
-- status (submitted -> selected/rejected/withdrawn) -- no way to screen or
-- interview a bidder before deciding, unlike job applicants
-- (CMMS_ANNOUNCEMENTS_AND_JOBS.sql), who go through
-- submitted -> under_review -> shortlisted -> interview -> hired/rejected.
-- This file widens the bid status pipeline to match, and lets the same
-- live-video interview machinery (CMMS_INTERVIEW_SCHEDULES.sql,
-- CMMS_INTERVIEW_NOTIFICATIONS.sql) schedule a call with a bidder, not just
-- a job applicant.
--
-- A winning bid still can't become a plain internal task
-- (cmms_job_assignments / fn_assign_job) -- that function hard-requires an
-- existing, active cmms_users row of the SAME company, and a winning bidder
-- is by construction from a different company or no company at all (the
-- bid-insert policy already forbids bidding on your own opportunity). The
-- Service Provider Contract system (CMMS_SERVICE_PROVIDER_CONTRACTS.sql,
-- already published from the Tasks tab) is the one mechanism already built
-- for an external party with no CMMS login doing a task for the company --
-- so a selected bid is turned into a task by publishing one of those,
-- prefilled from the bid, instead of inventing a second contractor-task
-- system.
--
-- Unlike a job applicant, a bidder already has a known ICAN identity at bid
-- time (bidder_ican_user_id for individuals -- see
-- CMMS_BUSINESS_OPPORTUNITIES_AND_BIDS.sql's own docstring: everyone here
-- already has an ICAN account). So the anonymous-applicant email-linking
-- dance (CMMS_JOB_APPLICATION_ICAN_LINK.sql,
-- fn_link_ican_account_via_interview_schedule) is simply not needed for
-- bids, and is left untouched here.
--
-- Run after: CMMS_BUSINESS_OPPORTUNITIES_AND_BIDS.sql,
-- CMMS_INTERVIEW_SCHEDULES.sql, CMMS_INTERVIEW_NOTIFICATIONS.sql,
-- CMMS_SERVICE_PROVIDER_CONTRACTS.sql.
-- Safe to run more than once.
-- ============================================================

-- ============================================================
-- 1. cmms_business_opportunity_bids -- widen the status pipeline, add
-- status_note/status_updated_*  (exact mirror of cmms_job_applications),
-- and converted_contract_id (mirrors cmms_job_applications.hired_cmms_user_id
-- -- marks that this bid became a task, and lets the UI hide the "convert"
-- action once it has).
-- ============================================================

ALTER TABLE public.cmms_business_opportunity_bids
  ADD COLUMN IF NOT EXISTS status_note TEXT,
  ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status_updated_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS converted_contract_id UUID REFERENCES public.cmms_service_provider_contracts(id) ON DELETE SET NULL;

-- Column CHECK constraints on this table were never explicitly named, so
-- Postgres auto-named it "<table>_<column>_check" -- dropping that exact
-- name is safe/idempotent (IF EXISTS) whether this runs against the
-- original 4-status table or one this file already widened.
ALTER TABLE public.cmms_business_opportunity_bids
  DROP CONSTRAINT IF EXISTS cmms_business_opportunity_bids_status_check;
ALTER TABLE public.cmms_business_opportunity_bids
  ADD CONSTRAINT cmms_business_opportunity_bids_status_check
  CHECK (status IN ('submitted', 'under_review', 'shortlisted', 'interview', 'selected', 'rejected', 'withdrawn'));

-- Staff (same 'opportunities'/'manage' permission "Select Winner" already
-- requires) can move a bid through the screening stages and leave a note --
-- but NOT to 'selected' here. That transition must stay exclusively through
-- fn_select_opportunity_bid, which atomically rejects every other bid and
-- closes the opportunity; a plain UPDATE can't do that safely.
DROP POLICY IF EXISTS cmms_biz_bids_staff_status_update ON public.cmms_business_opportunity_bids;
CREATE POLICY cmms_biz_bids_staff_status_update ON public.cmms_business_opportunity_bids
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.cmms_business_opportunities o
      WHERE o.id = cmms_business_opportunity_bids.opportunity_id
        AND public.cmms_has_tool_action(o.cmms_company_id, 'opportunities', 'manage')
    )
  ) WITH CHECK (
    status <> 'selected'
    AND EXISTS (
      SELECT 1 FROM public.cmms_business_opportunities o
      WHERE o.id = cmms_business_opportunity_bids.opportunity_id
        AND public.cmms_has_tool_action(o.cmms_company_id, 'opportunities', 'manage')
    )
  );

-- ============================================================
-- 2. cmms_interview_schedules -- let a schedule belong to either a job
-- application (as before) or an opportunity bid.
-- ============================================================

ALTER TABLE public.cmms_interview_schedules ALTER COLUMN job_application_id DROP NOT NULL;
ALTER TABLE public.cmms_interview_schedules
  ADD COLUMN IF NOT EXISTS opportunity_bid_id UUID REFERENCES public.cmms_business_opportunity_bids(id) ON DELETE CASCADE;

DO $$ BEGIN
  ALTER TABLE public.cmms_interview_schedules
    ADD CONSTRAINT cmms_interview_schedules_one_parent_chk
    CHECK (num_nonnulls(job_application_id, opportunity_bid_id) = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_cmms_interview_schedules_bid ON public.cmms_interview_schedules(opportunity_bid_id);

-- Staff policy now authorizes on whichever parent is actually set, under
-- that parent's own tool permission -- an 'announcements'-only manager
-- can't reach a bid's interview, and an 'opportunities'-only manager can't
-- reach a job applicant's.
DROP POLICY IF EXISTS cmms_interview_schedules_staff_all ON public.cmms_interview_schedules;
CREATE POLICY cmms_interview_schedules_staff_all ON public.cmms_interview_schedules
  FOR ALL USING (
    (job_application_id IS NOT NULL AND public.cmms_has_tool_action(cmms_company_id, 'announcements', 'manage_applications'))
    OR (opportunity_bid_id IS NOT NULL AND public.cmms_has_tool_action(cmms_company_id, 'opportunities', 'manage'))
  ) WITH CHECK (
    (job_application_id IS NOT NULL AND public.cmms_has_tool_action(cmms_company_id, 'announcements', 'manage_applications'))
    OR (opportunity_bid_id IS NOT NULL AND public.cmms_has_tool_action(cmms_company_id, 'opportunities', 'manage'))
  );

-- The candidate themself may also see their own scheduled interview -- now
-- matched either via the linked job application (as before) or, for a bid,
-- directly via bidder_ican_user_id (already known at bid time, no
-- token-linking step needed). Business bids have no single "candidate"
-- identity to match here, so this only covers individual bidders --
-- staff can still record an interview outcome in status_note for a business
-- bid even without a joinable call.
DROP POLICY IF EXISTS cmms_interview_schedules_candidate_select ON public.cmms_interview_schedules;
CREATE POLICY cmms_interview_schedules_candidate_select ON public.cmms_interview_schedules
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.cmms_job_applications ja
      WHERE ja.id = cmms_interview_schedules.job_application_id
        AND ja.ican_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.cmms_business_opportunity_bids b
      WHERE b.id = cmms_interview_schedules.opportunity_bid_id
        AND b.bidder_ican_user_id = auth.uid()
    )
  );

-- fn_can_join_interview -- same single join gate, now resolving the
-- "candidate" (name + linked ICAN account) from whichever parent the
-- schedule actually has.
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
  v_candidate_name VARCHAR;
  v_candidate_ican_user_id UUID;
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

  IF v_schedule.job_application_id IS NOT NULL THEN
    SELECT ja.applicant_name, ja.ican_user_id INTO v_candidate_name, v_candidate_ican_user_id
    FROM public.cmms_job_applications ja WHERE ja.id = v_schedule.job_application_id;
  ELSE
    SELECT b.bidder_name, b.bidder_ican_user_id INTO v_candidate_name, v_candidate_ican_user_id
    FROM public.cmms_business_opportunity_bids b WHERE b.id = v_schedule.opportunity_bid_id;
  END IF;

  v_is_candidate := (v_candidate_ican_user_id = auth.uid());
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
    v_candidate_name,
    (SELECT cp.company_name FROM public.cmms_company_profiles cp WHERE cp.id = v_schedule.cmms_company_id),
    v_candidate_ican_user_id,
    -- Interviewer {id, email, name} list, for LiveBoardroom's `members` prop
    -- -- an interviewer with no linked ICAN account yet is simply omitted,
    -- since they couldn't join the call either way.
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', u.ican_user_id, 'email', au.email, 'name', u.full_name))
      FROM public.cmms_users u
      JOIN auth.users au ON au.id = u.ican_user_id
      WHERE u.id = ANY(v_schedule.interviewer_cmms_user_ids) AND u.ican_user_id IS NOT NULL
    ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_can_join_interview(UUID) TO authenticated;

-- fn_notify_interview_scheduled -- same "one notification per named
-- interviewer" behavior, gated and named from whichever parent applies.
DROP FUNCTION IF EXISTS public.fn_notify_interview_scheduled(UUID);
CREATE OR REPLACE FUNCTION public.fn_notify_interview_scheduled(p_schedule_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule public.cmms_interview_schedules;
  v_candidate_name VARCHAR;
  v_interviewer_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  SELECT * INTO v_schedule FROM public.cmms_interview_schedules WHERE id = p_schedule_id;
  IF v_schedule.id IS NULL THEN
    RAISE EXCEPTION 'Interview schedule not found.';
  END IF;

  IF v_schedule.job_application_id IS NOT NULL THEN
    IF NOT public.cmms_has_tool_action(v_schedule.cmms_company_id, 'announcements', 'manage_applications') THEN
      RAISE EXCEPTION 'You do not have permission to notify interviewers for this company.';
    END IF;
    SELECT applicant_name INTO v_candidate_name
    FROM public.cmms_job_applications WHERE id = v_schedule.job_application_id;
  ELSE
    IF NOT public.cmms_has_tool_action(v_schedule.cmms_company_id, 'opportunities', 'manage') THEN
      RAISE EXCEPTION 'You do not have permission to notify interviewers for this company.';
    END IF;
    SELECT bidder_name INTO v_candidate_name
    FROM public.cmms_business_opportunity_bids WHERE id = v_schedule.opportunity_bid_id;
  END IF;

  FOREACH v_interviewer_id IN ARRAY v_schedule.interviewer_cmms_user_ids
  LOOP
    PERFORM public.fn_create_cmms_notification(
      v_interviewer_id,
      v_schedule.cmms_company_id,
      'interview_scheduled',
      'Interview scheduled: ' || COALESCE(v_candidate_name, 'Candidate'),
      'You''re an interviewer for ' || COALESCE(v_candidate_name, 'a candidate') ||
        ' on ' || to_char(v_schedule.scheduled_at, 'FMDD Mon YYYY, HH12:MI AM') || '.',
      '🎥',
      'notices',
      'Join interview',
      NULL,
      -- Absolute, hardcoded to the production domain -- see
      -- CMMS_INTERVIEW_NOTIFICATIONS.sql for why.
      'https://icanera.space/candidate-interview?scheduleId=' || v_schedule.id
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_notify_interview_scheduled(UUID) TO authenticated;

-- ============================================================
-- 3. fn_publish_service_provider_contract -- widened with an optional
-- p_opportunity_bid_id: when given, this publish call IS the "won bid
-- becomes a task" step. Validates the bid actually won and hasn't already
-- been converted, then stamps cmms_business_opportunity_bids.
-- converted_contract_id once the contract exists, in the same call.
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_publish_service_provider_contract(UUID, UUID, VARCHAR, VARCHAR, VARCHAR, JSONB, VARCHAR, TEXT, TEXT, INT) CASCADE;
DROP FUNCTION IF EXISTS public.fn_publish_service_provider_contract(UUID, UUID, VARCHAR, VARCHAR, VARCHAR, JSONB, VARCHAR, TEXT, TEXT, INT, UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_publish_service_provider_contract(
  p_company_id UUID,
  p_job_assignment_id UUID,
  p_provider_name VARCHAR,
  p_provider_contact VARCHAR,
  p_title VARCHAR,
  p_content JSONB,
  p_access_mode VARCHAR,
  p_pin TEXT DEFAULT NULL,
  p_allowed_email TEXT DEFAULT NULL,
  p_valid_days INT DEFAULT 30,
  p_opportunity_bid_id UUID DEFAULT NULL
)
RETURNS TABLE (id UUID, access_token VARCHAR, valid_until TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token TEXT;
  v_pin_hash TEXT;
  v_allowed_email TEXT;
  v_new_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  IF NOT public.cmms_has_tool_action(p_company_id, 'tasks', 'publish_contract') THEN
    RAISE EXCEPTION 'You do not have permission to publish service provider contracts.';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_provider_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Provider name is required.';
  END IF;
  IF NULLIF(TRIM(COALESCE(p_title, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Contract title is required.';
  END IF;

  IF p_access_mode NOT IN ('pin', 'email') THEN
    RAISE EXCEPTION 'Choose a PIN or an email to keep this contract private.';
  END IF;

  IF p_access_mode = 'pin' THEN
    IF p_pin IS NULL OR LENGTH(TRIM(p_pin)) < 4 THEN
      RAISE EXCEPTION 'PIN must be at least 4 characters.';
    END IF;
    v_pin_hash := crypt(p_pin, gen_salt('bf'));
  ELSE
    v_allowed_email := NULLIF(LOWER(TRIM(COALESCE(p_allowed_email, ''))), '');
    IF v_allowed_email IS NULL OR v_allowed_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
      RAISE EXCEPTION 'Enter a valid email address.';
    END IF;
  END IF;

  -- A bid can only ever be converted into ONE contract, and only once it has
  -- actually won -- fn_select_opportunity_bid (CMMS_BUSINESS_OPPORTUNITIES_
  -- AND_BIDS.sql) is still the sole place 'selected' gets set, atomically,
  -- alongside rejecting every other bid and closing the opportunity.
  IF p_opportunity_bid_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cmms_business_opportunity_bids b
      JOIN public.cmms_business_opportunities o ON o.id = b.opportunity_id
      WHERE b.id = p_opportunity_bid_id
        AND o.cmms_company_id = p_company_id
        AND b.status = 'selected'
        AND b.converted_contract_id IS NULL
    ) THEN
      RAISE EXCEPTION 'This bid cannot be converted into a contract (not selected, or already converted).';
    END IF;
  END IF;

  v_token := encode(gen_random_bytes(24), 'hex');

  INSERT INTO public.cmms_service_provider_contracts (
    cmms_company_id, job_assignment_id, provider_name, provider_contact, title, content,
    access_mode, pin_hash, allowed_email, access_token,
    valid_until, published_by
  ) VALUES (
    p_company_id, p_job_assignment_id, TRIM(p_provider_name),
    NULLIF(TRIM(COALESCE(p_provider_contact, '')), ''), TRIM(p_title), COALESCE(p_content, '{}'::JSONB),
    p_access_mode, v_pin_hash, v_allowed_email, v_token,
    NOW() + (GREATEST(COALESCE(p_valid_days, 30), 1) || ' days')::INTERVAL,
    public.cmms_current_user_id_for_company(p_company_id)
  )
  RETURNING cmms_service_provider_contracts.id INTO v_new_id;

  IF p_opportunity_bid_id IS NOT NULL THEN
    UPDATE public.cmms_business_opportunity_bids
    SET converted_contract_id = v_new_id
    WHERE id = p_opportunity_bid_id;
  END IF;

  RETURN QUERY SELECT c.id, c.access_token, c.valid_until FROM public.cmms_service_provider_contracts c WHERE c.id = v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_publish_service_provider_contract(UUID, UUID, VARCHAR, VARCHAR, VARCHAR, JSONB, VARCHAR, TEXT, TEXT, INT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS opportunity bid pipeline (status/interview stages + won-bid-to-contract conversion) installed' AS status;
