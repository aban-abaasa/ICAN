-- ============================================================
-- CMMS Task Assignment: Progress Tracking + Notifications
-- ============================================================
-- Problem: Once a task/job is assigned (cmms_job_assignments), the person
-- who assigned it has no way to track how far along it is other than
-- manually re-querying, and no notification is ever sent to them when the
-- assignee moves the job forward (accepted / in_progress / completed /
-- rejected). fn_assign_job also only dropped a chat message
-- (cmms_report_messages) instead of a real notification-center entry.
--
-- This migration:
--   1. Adds progress_percentage / progress_notes / last_progress_update to
--      cmms_job_assignments so progress is more granular than just status.
--   2. Adds fn_create_cmms_notification(...) - a small SECURITY DEFINER
--      helper (mirrors the pattern already used across this file) that
--      writes into the existing public.cmms_notifications table, the same
--      table the bell icon (NotificationsPanel.jsx) already polls and
--      subscribes to in real time. Failures here never block the caller.
--   3. Updates fn_assign_job to notify the assignee ("task_assigned").
--   4. Updates fn_update_job_assignment_status to accept progress inputs
--      and notify whichever side (assigner/assignee) did NOT make the
--      change ("task_progress_update" / "task_completed"), so the person
--      who assigned the job is fed progress in their notifications feed.
--   5. Updates fn_get_job_assignments / fn_get_user_job_assignments to
--      return the new progress columns so the UI can render them.
--   6. Fixes fn_update_job_assignment_status resolving the caller's
--      cmms_users row by email alone (LIMIT 1, no company filter) before
--      knowing the assignment's company - for a user who is a member of
--      more than one CMMS company under the same email, that could pick
--      the wrong company_id and make the assignment lookup return nothing,
--      surfacing as "Job assignment not found or unauthorized" even to the
--      correct assignee. It now resolves the assignment (and its real
--      company_id) first, then scopes the user lookup to that company.
--   7. Fixes fn_update_job_assignment_status letting an explicit (stale)
--      progress_percentage override the 100%/0% implied by a status of
--      completed/pending - the status dropdown in the UI passes the task's
--      current percentage alongside the new status rather than NULL, so
--      marking a task "completed" while it was e.g. 40% left it at 40%
--      instead of jumping to 100%. Status now always wins for those two.
--   8. Fixes fn_get_job_assignments error 42702 "column reference \"id\" is
--      ambiguous". RETURNS TABLE(id UUID, ...) makes "id" an implicit
--      variable at function scope, so the unqualified `WHERE id = ...` in
--      the assigned_to/assigned_by name/email subqueries collided with it.
--      Both subqueries now use an explicit table alias.
--   9. Fixes every name lookup here (fn_assign_job's assigner, fn_update_
--      job_assignment_status's actor, fn_get_job_assignments' assigned_to/
--      assigned_by, fn_get_user_job_assignments' assigned_by) reading
--      cmms_users.name - a column added later (see CMMS_REPORT_MESSAGING_
--      SYSTEM.sql) that nothing ever populates. The frontend writes new
--      members to cmms_users.user_name, so .name is NULL for effectively
--      everyone and every one of these was silently falling back to
--      showing someone's email address instead of their name. All now
--      read COALESCE(cu.name, cu.user_name).
--  10. Backfills rows already stuck with the bug fix #7 describes - e.g. a
--      task showing "completed" with "Progress 0%" in the assigner's
--      Progress tab. Fix #7 only stops it happening on *future* status
--      updates; it does nothing for a row that was already saved wrong
--      before this migration was deployed. One-time UPDATE below forces
--      completed -> 100% and pending -> 0% for any row that still
--      disagrees, same rule fn_update_job_assignment_status now enforces
--      going forward.
--
-- Safe to re-run.
-- ============================================================

-- ============================================================
-- 1. PROGRESS COLUMNS ON cmms_job_assignments
-- ============================================================

ALTER TABLE public.cmms_job_assignments
ADD COLUMN IF NOT EXISTS progress_percentage SMALLINT NOT NULL DEFAULT 0
  CHECK (progress_percentage BETWEEN 0 AND 100);

ALTER TABLE public.cmms_job_assignments
ADD COLUMN IF NOT EXISTS progress_notes TEXT;

ALTER TABLE public.cmms_job_assignments
ADD COLUMN IF NOT EXISTS last_progress_update TIMESTAMPTZ;

-- ============================================================
-- 1a. BACKFILL: repair rows saved before fix #7 existed, where the
-- displayed status and progress_percentage disagree (e.g. "completed"
-- sitting at an old in-progress percentage instead of 100%).
-- ============================================================

UPDATE public.cmms_job_assignments
SET progress_percentage = 100, updated_at = NOW()
WHERE assignment_status = 'completed' AND progress_percentage <> 100;

UPDATE public.cmms_job_assignments
SET progress_percentage = 0, updated_at = NOW()
WHERE assignment_status = 'pending' AND progress_percentage <> 0;

-- ============================================================
-- 2. HELPER: fn_create_cmms_notification
-- Small wrapper so both fn_assign_job and fn_update_job_assignment_status
-- feed the same notification center instead of duplicating the INSERT.
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_create_cmms_notification(UUID, UUID, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_create_cmms_notification(
  p_cmms_user_id UUID,
  p_cmms_company_id UUID,
  p_notification_type VARCHAR,
  p_title VARCHAR,
  p_message TEXT,
  p_icon VARCHAR DEFAULT '📬',
  p_action_tab VARCHAR DEFAULT 'tasks',
  p_action_label VARCHAR DEFAULT 'View'
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
    action_label
  ) VALUES (
    p_cmms_user_id,
    p_cmms_company_id,
    p_notification_type,
    p_title,
    p_message,
    p_icon,
    p_action_tab,
    p_action_label
  );
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification failure block the job assignment/update itself
  RAISE NOTICE 'Warning: Failed to create cmms_notification - %', SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_create_cmms_notification(UUID, UUID, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR) TO authenticated;

-- ============================================================
-- 3. fn_assign_job: notify the assignee via the notification center
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_assign_job(UUID, UUID, UUID, VARCHAR, TEXT, DATE, VARCHAR) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_assign_job(
  p_company_id UUID,
  p_report_id UUID,
  p_assigned_to_user_id UUID,
  p_job_title VARCHAR,
  p_job_description TEXT DEFAULT NULL,
  p_due_date DATE DEFAULT NULL,
  p_priority VARCHAR DEFAULT 'medium'
)
RETURNS public.cmms_job_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
  v_assigner_id UUID;
  v_assigner_name VARCHAR;
  v_assigner_role TEXT;
  v_assignment public.cmms_job_assignments;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email FROM auth.users WHERE id = v_auth_uid;
  END IF;

  SELECT cu.id, COALESCE(cu.name, cu.user_name), LOWER(TRIM(COALESCE(cu.role, 'member')))
  INTO v_assigner_id, v_assigner_name, v_assigner_role
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
    AND LOWER(TRIM(cu.email)) = LOWER(TRIM(v_auth_email))
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_assigner_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this CMMS company';
  END IF;

  IF v_assigner_role NOT IN ('admin', 'coordinator', 'supervisor') THEN
    RAISE EXCEPTION 'Permission denied. Only admin, coordinator, or supervisor can assign jobs.';
  END IF;

  IF p_report_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cmms_company_reports
      WHERE id = p_report_id AND cmms_company_id = p_company_id
    ) THEN
      RAISE EXCEPTION 'Report not found';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cmms_users
    WHERE id = p_assigned_to_user_id
      AND cmms_company_id = p_company_id
      AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'User not found or inactive';
  END IF;

  INSERT INTO public.cmms_job_assignments (
    report_id,
    company_id,
    assigned_to_user_id,
    assigned_by_user_id,
    job_title,
    job_description,
    due_date,
    priority
  ) VALUES (
    p_report_id,
    p_company_id,
    p_assigned_to_user_id,
    v_assigner_id,
    TRIM(p_job_title),
    TRIM(COALESCE(p_job_description, '')),
    p_due_date,
    COALESCE(p_priority, 'medium')
  )
  RETURNING * INTO v_assignment;

  -- In-app chat message (existing behavior)
  BEGIN
    INSERT INTO public.cmms_report_messages (
      report_id,
      company_id,
      sender_id,
      recipient_id,
      message_text,
      message_type
    ) VALUES (
      p_report_id,
      p_company_id,
      v_assigner_id,
      p_assigned_to_user_id,
      '📋 Job assigned: ' || p_job_title || ' (Priority: ' || COALESCE(p_priority, 'medium') || ')',
      'assignment'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Warning: Failed to send assignment message - %', SQLERRM;
  END;

  -- Notification-center entry (feeds the bell icon / NotificationsPanel)
  PERFORM public.fn_create_cmms_notification(
    p_assigned_to_user_id,
    p_company_id,
    'task_assigned',
    'New Task Assigned',
    COALESCE(v_assigner_name, 'A manager') || ' assigned you: "' || TRIM(p_job_title) || '" (Priority: ' || COALESCE(p_priority, 'medium') || ')',
    '📋',
    'tasks',
    'View Task'
  );

  RETURN v_assignment;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_assign_job(UUID, UUID, UUID, VARCHAR, TEXT, DATE, VARCHAR) TO authenticated;

-- ============================================================
-- 4. fn_update_job_assignment_status: progress + notify the other side
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_update_job_assignment_status(UUID, VARCHAR) CASCADE;
DROP FUNCTION IF EXISTS public.fn_update_job_assignment_status(UUID, VARCHAR, SMALLINT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_update_job_assignment_status(
  p_assignment_id UUID,
  p_new_status VARCHAR,
  p_progress_percentage SMALLINT DEFAULT NULL,
  p_progress_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  message VARCHAR,
  data JSON
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
  v_auth_user_id UUID;
  v_auth_user_name VARCHAR;
  v_company_id UUID;
  v_job_title VARCHAR;
  v_assignment_user_id UUID;
  v_assigned_by_user_id UUID;
  v_assignment_role VARCHAR;
  v_effective_progress SMALLINT;
  v_updated_count INT;
  v_data JSON;
  v_recipient_id UUID;
  v_notification_type VARCHAR;
  v_notification_title VARCHAR;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Not authenticated'::VARCHAR, NULL::JSON;
    RETURN;
  END IF;

  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email FROM auth.users WHERE id = v_auth_uid;
  END IF;

  -- Resolve the assignment FIRST to learn its real company_id. Looking up
  -- the caller's cmms_users row by email alone (no company filter) picks an
  -- arbitrary row via LIMIT 1 when the same email belongs to cmms_users in
  -- more than one company - that previously caused the company-scoped
  -- assignment lookup below to find nothing, surfacing as "Job assignment
  -- not found or unauthorized" even for the correct assignee.
  SELECT cja.company_id, cja.assigned_to_user_id, cja.assigned_by_user_id, cja.job_title
  INTO v_company_id, v_assignment_user_id, v_assigned_by_user_id, v_job_title
  FROM public.cmms_job_assignments cja
  WHERE cja.id = p_assignment_id;

  IF v_company_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Job assignment not found'::VARCHAR, NULL::JSON;
    RETURN;
  END IF;

  SELECT cu.id, COALESCE(cu.name, cu.user_name), cu.role
  INTO v_auth_user_id, v_auth_user_name, v_assignment_role
  FROM public.cmms_users cu
  WHERE LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.cmms_company_id = v_company_id
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_auth_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Not a CMMS member of this company'::VARCHAR, NULL::JSON;
    RETURN;
  END IF;

  IF NOT (
    v_auth_user_id = v_assignment_user_id
    OR v_auth_user_id = v_assigned_by_user_id
    OR v_assignment_role IN ('admin', 'supervisor', 'coordinator')
  ) THEN
    RETURN QUERY SELECT FALSE, 'Unauthorized to update this job'::VARCHAR, NULL::JSON;
    RETURN;
  END IF;

  IF p_new_status NOT IN ('pending', 'accepted', 'in_progress', 'completed', 'rejected') THEN
    RETURN QUERY SELECT FALSE, 'Invalid status. Must be: pending, accepted, in_progress, completed, rejected'::VARCHAR, NULL::JSON;
    RETURN;
  END IF;

  IF p_progress_percentage IS NOT NULL AND (p_progress_percentage < 0 OR p_progress_percentage > 100) THEN
    RETURN QUERY SELECT FALSE, 'Progress percentage must be between 0 and 100'::VARCHAR, NULL::JSON;
    RETURN;
  END IF;

  -- Completed/pending always pin progress to 100/0 - a task can't be
  -- "completed" while still showing its old in-progress percentage, which
  -- is what happened when the caller (e.g. the status dropdown) echoed back
  -- the task's existing percentage alongside the new status instead of
  -- passing NULL. Status wins over an explicit percentage for those two;
  -- otherwise fall back to whatever percentage the caller actually sent.
  v_effective_progress := CASE
    WHEN p_new_status = 'completed' THEN 100
    WHEN p_new_status = 'pending' THEN 0
    WHEN p_progress_percentage IS NOT NULL THEN p_progress_percentage
    ELSE NULL
  END;

  UPDATE public.cmms_job_assignments
  SET
    assignment_status = p_new_status,
    progress_percentage = COALESCE(v_effective_progress, progress_percentage),
    progress_notes = COALESCE(p_progress_notes, progress_notes),
    last_progress_update = NOW(),
    updated_at = NOW()
  WHERE id = p_assignment_id
    AND company_id = v_company_id;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RETURN QUERY SELECT FALSE, 'Failed to update job assignment'::VARCHAR, NULL::JSON;
    RETURN;
  END IF;

  SELECT row_to_json(cja.*)
  INTO v_data
  FROM public.cmms_job_assignments cja
  WHERE cja.id = p_assignment_id;

  -- Notify whichever side of the assignment did NOT make this change, so
  -- the assigner is fed progress on jobs they handed out (and the assignee
  -- is fed changes a manager makes on their behalf).
  v_notification_type := CASE WHEN p_new_status = 'completed' THEN 'task_completed' ELSE 'task_progress_update' END;
  v_notification_title := CASE WHEN p_new_status = 'completed' THEN 'Task Completed' ELSE 'Task Progress Updated' END;

  FOR v_recipient_id IN
    SELECT DISTINCT uid FROM UNNEST(ARRAY[v_assigned_by_user_id, v_assignment_user_id]) AS uid
    WHERE uid IS NOT NULL AND uid <> v_auth_user_id
  LOOP
    PERFORM public.fn_create_cmms_notification(
      v_recipient_id,
      v_company_id,
      v_notification_type,
      v_notification_title,
      COALESCE(v_auth_user_name, 'A team member') || ' set "' || COALESCE(v_job_title, 'a task') || '" to ' ||
        REPLACE(p_new_status, '_', ' ') ||
        CASE WHEN v_effective_progress IS NOT NULL THEN ' (' || v_effective_progress || '% complete)' ELSE '' END,
      CASE WHEN p_new_status = 'completed' THEN '✅' ELSE '🔧' END,
      'tasks',
      'View Task'
    );
  END LOOP;

  RETURN QUERY SELECT TRUE, format('Job status updated to "%s"', p_new_status)::VARCHAR, v_data;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_update_job_assignment_status(UUID, VARCHAR, SMALLINT, TEXT) TO authenticated;

-- ============================================================
-- 5. fn_get_job_assignments: include progress columns
-- (assigner/manager-facing - already returns rows for jobs I assigned)
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_get_job_assignments(UUID, UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_get_job_assignments(
  p_company_id UUID,
  p_report_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  report_id UUID,
  company_id UUID,
  assigned_to_user_id UUID,
  assigned_to_user_name VARCHAR,
  assigned_to_user_email VARCHAR,
  assigned_by_user_id UUID,
  assigned_by_user_name VARCHAR,
  assigned_by_user_email VARCHAR,
  job_title VARCHAR,
  job_description TEXT,
  assignment_status VARCHAR,
  progress_percentage SMALLINT,
  progress_notes TEXT,
  last_progress_update TIMESTAMPTZ,
  due_date DATE,
  priority VARCHAR,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
  v_auth_user_id UUID;
  v_auth_user_role VARCHAR;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email FROM auth.users WHERE id = v_auth_uid;
  END IF;

  SELECT cu.id, cu.role
  INTO v_auth_user_id, v_auth_user_role
  FROM public.cmms_users cu
  WHERE LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
    AND cu.cmms_company_id = p_company_id
  LIMIT 1;

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Not a member of this CMMS company';
  END IF;

  RETURN QUERY
  SELECT
    cja.id,
    cja.report_id,
    cja.company_id,
    cja.assigned_to_user_id,
    (SELECT COALESCE(cu2.name, cu2.user_name) FROM public.cmms_users cu2 WHERE cu2.id = cja.assigned_to_user_id) AS assigned_to_user_name,
    (SELECT cu2.email FROM public.cmms_users cu2 WHERE cu2.id = cja.assigned_to_user_id) AS assigned_to_user_email,
    cja.assigned_by_user_id,
    (SELECT COALESCE(cu3.name, cu3.user_name) FROM public.cmms_users cu3 WHERE cu3.id = cja.assigned_by_user_id) AS assigned_by_user_name,
    (SELECT cu3.email FROM public.cmms_users cu3 WHERE cu3.id = cja.assigned_by_user_id) AS assigned_by_user_email,
    cja.job_title,
    cja.job_description,
    cja.assignment_status,
    cja.progress_percentage,
    cja.progress_notes,
    cja.last_progress_update,
    cja.due_date,
    cja.priority,
    cja.created_at,
    cja.updated_at
  FROM public.cmms_job_assignments cja
  WHERE cja.company_id = p_company_id
    AND (p_report_id IS NULL OR cja.report_id = p_report_id)
    AND (
      v_auth_user_role IN ('admin', 'supervisor', 'coordinator')
      OR cja.assigned_to_user_id = v_auth_user_id
      OR cja.assigned_by_user_id = v_auth_user_id
    )
  ORDER BY cja.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_job_assignments(UUID, UUID) TO authenticated;

-- ============================================================
-- 6. fn_get_user_job_assignments: include progress columns
-- (assignee-facing - "Your Assigned Tasks")
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_get_user_job_assignments(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_get_user_job_assignments(p_company_id UUID)
RETURNS TABLE (
  id UUID,
  report_id UUID,
  report_title VARCHAR,
  job_title VARCHAR,
  job_description TEXT,
  assignment_status VARCHAR,
  progress_percentage SMALLINT,
  progress_notes TEXT,
  last_progress_update TIMESTAMPTZ,
  priority VARCHAR,
  due_date DATE,
  assigned_by_user_id UUID,
  assigned_by_name VARCHAR,
  assigned_by_email VARCHAR,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  days_until_due INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
  v_user_id UUID;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email FROM auth.users WHERE id = v_auth_uid;
  END IF;

  SELECT cu.id
  INTO v_user_id
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this CMMS company';
  END IF;

  RETURN QUERY
  SELECT
    cja.id,
    cja.report_id,
    COALESCE(ccr.report_title, '')::VARCHAR,
    cja.job_title,
    cja.job_description,
    cja.assignment_status,
    cja.progress_percentage,
    cja.progress_notes,
    cja.last_progress_update,
    cja.priority,
    cja.due_date,
    cja.assigned_by_user_id,
    (SELECT COALESCE(u.name, u.user_name) FROM public.cmms_users u WHERE u.id = cja.assigned_by_user_id) AS assigned_by_name,
    (SELECT u.email FROM public.cmms_users u WHERE u.id = cja.assigned_by_user_id) AS assigned_by_email,
    cja.created_at,
    cja.updated_at,
    (cja.due_date - CURRENT_DATE)::INT AS days_until_due
  FROM public.cmms_job_assignments cja
  LEFT JOIN public.cmms_company_reports ccr ON ccr.id = cja.report_id
  WHERE cja.assigned_to_user_id = v_user_id
    AND cja.company_id = p_company_id
  ORDER BY cja.priority DESC, cja.due_date ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_user_job_assignments(UUID) TO authenticated;

SELECT 'CMMS task progress tracking + notifications installed successfully!' as status;
