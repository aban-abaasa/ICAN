-- ============================================================
-- CMMS Task Notifications: deep-link "View Task" to the actual task
-- ============================================================
-- Problem: cmms_notifications rows only carried action_tab ('tasks'), so
-- clicking "View Task" (NotificationsPanel.jsx) just switched to the Tasks
-- tab and left the user to find the right job assignment themselves.
--
-- This migration:
--   1. Adds cmms_notifications.related_task_id (cmms_job_assignments.id)
--      so a notification can point at the specific task it's about.
--   2. Updates fn_create_cmms_notification to accept and store it.
--   3. Updates fn_assign_job / fn_update_job_assignment_status to pass the
--      job assignment's id through when they raise a task notification.
-- Safe to run more than once.
-- ============================================================

ALTER TABLE public.cmms_notifications
  ADD COLUMN IF NOT EXISTS related_task_id UUID REFERENCES public.cmms_job_assignments(id) ON DELETE SET NULL;

-- ============================================================
-- fn_create_cmms_notification: now takes an optional related_task_id
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
  p_action_label VARCHAR DEFAULT 'View',
  p_related_task_id UUID DEFAULT NULL
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
    related_task_id
  ) VALUES (
    p_cmms_user_id,
    p_cmms_company_id,
    p_notification_type,
    p_title,
    p_message,
    p_icon,
    p_action_tab,
    p_action_label,
    p_related_task_id
  );
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification failure block the job assignment/update itself
  RAISE NOTICE 'Warning: Failed to create cmms_notification - %', SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_create_cmms_notification(UUID, UUID, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, UUID) TO authenticated;

-- ============================================================
-- fn_assign_job: pass the new assignment's id through as related_task_id
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

  -- Notification-center entry (feeds the bell icon / NotificationsPanel),
  -- deep-linked to this assignment so "View Task" opens it directly.
  PERFORM public.fn_create_cmms_notification(
    p_assigned_to_user_id,
    p_company_id,
    'task_assigned',
    'New Task Assigned',
    COALESCE(v_assigner_name, 'A manager') || ' assigned you: "' || TRIM(p_job_title) || '" (Priority: ' || COALESCE(p_priority, 'medium') || ')',
    '📋',
    'tasks',
    'View Task',
    v_assignment.id
  );

  RETURN v_assignment;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_assign_job(UUID, UUID, UUID, VARCHAR, TEXT, DATE, VARCHAR) TO authenticated;

-- ============================================================
-- fn_update_job_assignment_status: pass the assignment's id through too
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
  -- is fed changes a manager makes on their behalf). Deep-linked to this
  -- assignment so "View Task" opens it directly.
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
      'View Task',
      p_assignment_id
    );
  END LOOP;

  RETURN QUERY SELECT TRUE, format('Job status updated to "%s"', p_new_status)::VARCHAR, v_data;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_update_job_assignment_status(UUID, VARCHAR, SMALLINT, TEXT) TO authenticated;

SELECT 'Task notifications now deep-link to their job assignment' AS status;
