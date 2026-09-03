-- ============================================================================
-- CMMS notification-center wiring for salary advances, requisitions ("needs"),
-- and reward points/redemptions.
-- Run after CMMS_SALARY_ADVANCE_REQUESTS.sql, CMMS_DEPARTMENT_INVENTORY_REQUISITIONS.sql,
-- CMMS_EMPLOYEE_REWARDS_POINTS.sql, and CMMS_TASK_PROGRESS_TRACKING_AND_NOTIFICATIONS.sql
-- (for fn_create_cmms_notification / the cmms_notifications table).
--
-- GAP THIS CLOSES: fn_assign_job / fn_update_job_assignment_status already
-- feed the bell-icon notification center (cmms_notifications), but three
-- other approval-shaped flows never did:
--   1. Salary advances (business_salary_advances) — an employee's request,
--      an approver's decision, payment, receipt confirmation, and
--      cancellation all happened silently; approvers had to go looking in
--      the Payroll tab for pending requests instead of being told.
--   2. Department requisitions ("needs" — cmms_requisitions) — submitting
--      one, moving it to finance review, and the final approve/reject never
--      notified anyone either.
--   3. Reward points redemptions (cmms_reward_redemptions) — an
--      auto-queued or admin-requested redemption, its payment, and its
--      cancellation never told the employee or an admin.
--
-- This migration redefines each of those functions (same signatures, so
-- existing grants are untouched) to additionally call
-- fn_create_cmms_notification — directly for a single recipient (the
-- employee, the requester, the payer), or through the new
-- cmms_notify_company_approvers helper below when the recipients are
-- "whoever can act on this" (admins, a payroll approver, a department
-- head, finance). fn_create_cmms_notification already swallows its own
-- errors (see CMMS_TASK_PROGRESS_TRACKING_AND_NOTIFICATIONS.sql), so none
-- of this can block the underlying request/decision/payment it rides on.
-- ============================================================================

-- ============================================================
-- 0. HELPER: notify every active company member who can act on an approval
-- — company admins, plus (optionally) an explicit list of extra role names
-- and/or anyone whose active role has a given tool_access permission.
-- ============================================================
CREATE OR REPLACE FUNCTION public.cmms_notify_company_approvers(
  p_cmms_company_id UUID,
  p_extra_roles TEXT[],
  p_notification_type VARCHAR,
  p_title VARCHAR,
  p_message TEXT,
  p_icon VARCHAR DEFAULT '📬',
  p_action_tab VARCHAR DEFAULT 'approvals',
  p_action_label VARCHAR DEFAULT 'Review',
  p_tool_key TEXT DEFAULT NULL,
  p_tool_action TEXT DEFAULT NULL,
  p_exclude_cmms_user_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient RECORD;
BEGIN
  FOR v_recipient IN
    SELECT DISTINCT cu.id
      FROM public.cmms_users cu
      LEFT JOIN public.cmms_user_roles ur ON ur.cmms_user_id = cu.id AND ur.is_active
      LEFT JOIN public.cmms_roles r ON r.id = ur.cmms_role_id AND r.is_active
     WHERE cu.cmms_company_id = p_cmms_company_id
       AND cu.is_active
       AND (p_exclude_cmms_user_id IS NULL OR cu.id <> p_exclude_cmms_user_id)
       AND (
         lower(COALESCE(r.role_name, cu.role, '')) IN ('admin', 'administrator', 'cmms_admin', 'business_admin')
         OR (p_extra_roles IS NOT NULL AND lower(COALESCE(r.role_name, cu.role, '')) = ANY(p_extra_roles))
         OR (p_tool_key IS NOT NULL AND p_tool_action IS NOT NULL
             AND COALESCE((r.tool_access -> p_tool_key ->> p_tool_action)::BOOLEAN, FALSE))
       )
  LOOP
    PERFORM public.fn_create_cmms_notification(
      v_recipient.id, p_cmms_company_id, p_notification_type, p_title, p_message, p_icon, p_action_tab, p_action_label
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_notify_company_approvers(UUID, TEXT[], VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_notify_company_approvers(UUID, TEXT[], VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, TEXT, TEXT, UUID) TO authenticated;

-- ============================================================
-- 1. SALARY ADVANCES
-- ============================================================

CREATE OR REPLACE FUNCTION public.request_salary_advance(
  p_cmms_company_id UUID,
  p_amount NUMERIC,
  p_currency TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company public.cmms_company_profiles;
  v_currency TEXT;
  v_advance_id UUID;
  v_employee_name TEXT;
  v_employee_cmms_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required to request a salary advance';
  END IF;

  IF NOT public.cmms_active_staff(p_cmms_company_id) THEN
    RAISE EXCEPTION 'You are not an active member of this company';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Enter an advance amount greater than zero';
  END IF;

  SELECT * INTO v_company FROM public.cmms_company_profiles WHERE id = p_cmms_company_id;
  IF v_company.id IS NULL OR v_company.pichin_business_profile_id IS NULL THEN
    RAISE EXCEPTION 'Link this CMMS company to its Pichin business profile before requesting a salary advance';
  END IF;

  v_currency := COALESCE(NULLIF(TRIM(p_currency), ''), (
    SELECT currency FROM public.business_compensation_profiles
    WHERE business_profile_id = v_company.pichin_business_profile_id
      AND employee_user_id = auth.uid()
      AND payroll_status = 'on_pay'
    ORDER BY effective_from DESC LIMIT 1
  ), 'UGX');

  BEGIN
    INSERT INTO public.business_salary_advances (
      business_profile_id, cmms_company_id, employee_user_id, amount, currency, reason
    ) VALUES (
      v_company.pichin_business_profile_id, p_cmms_company_id, auth.uid(), p_amount, v_currency, NULLIF(TRIM(p_reason), '')
    ) RETURNING id INTO v_advance_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'You already have an outstanding salary advance request. Wait for it to be resolved before requesting another.';
  END;

  SELECT id, COALESCE(full_name, user_name) INTO v_employee_cmms_id, v_employee_name
    FROM public.cmms_users
   WHERE cmms_company_id = p_cmms_company_id AND is_active
     AND lower(email) = lower(auth.jwt() ->> 'email')
   LIMIT 1;

  PERFORM public.cmms_notify_company_approvers(
    p_cmms_company_id, NULL, 'salary_advance_requested', 'Salary Advance Request',
    format('%s requested a %s %s salary advance awaiting your approval.', COALESCE(v_employee_name, 'An employee'), v_currency, p_amount),
    '💰', 'payroll', 'Review', 'payroll', 'approve', v_employee_cmms_id
  );

  RETURN v_advance_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_salary_advance(
  p_advance_id UUID,
  p_decision TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_advance public.business_salary_advances;
  v_employee_cmms_id UUID;
BEGIN
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected';
  END IF;

  SELECT * INTO v_advance FROM public.business_salary_advances WHERE id = p_advance_id FOR UPDATE;
  IF v_advance.id IS NULL THEN RAISE EXCEPTION 'Salary advance request not found'; END IF;
  IF v_advance.status <> 'pending' THEN RAISE EXCEPTION 'This request has already been decided'; END IF;

  IF NOT public.cmms_can_manage_salary_advances(v_advance.cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to approve salary advances for this company';
  END IF;

  UPDATE public.business_salary_advances
  SET status = p_decision, decided_by = auth.uid(), decided_at = now(),
      decision_note = NULLIF(TRIM(p_note), ''), updated_at = now()
  WHERE id = p_advance_id;

  SELECT id INTO v_employee_cmms_id
    FROM public.cmms_users
   WHERE cmms_company_id = v_advance.cmms_company_id AND ican_user_id = v_advance.employee_user_id
   LIMIT 1;

  PERFORM public.fn_create_cmms_notification(
    v_employee_cmms_id, v_advance.cmms_company_id,
    CASE WHEN p_decision = 'approved' THEN 'salary_advance_approved' ELSE 'salary_advance_rejected' END,
    CASE WHEN p_decision = 'approved' THEN 'Salary Advance Approved' ELSE 'Salary Advance Rejected' END,
    CASE WHEN p_decision = 'approved'
      THEN format('Your request for %s %s was approved.', v_advance.currency, v_advance.amount)
      ELSE format('Your request for %s %s was rejected.%s', v_advance.currency, v_advance.amount,
        CASE WHEN NULLIF(TRIM(p_note), '') IS NOT NULL THEN ' Reason: ' || TRIM(p_note) ELSE '' END)
    END,
    CASE WHEN p_decision = 'approved' THEN '✅' ELSE '🚫' END,
    'payroll', 'View'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.pay_salary_advance(
  p_advance_id UUID,
  p_payment_method TEXT,
  p_wallet_transaction_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_advance public.business_salary_advances;
  v_employee_cmms_id UUID;
BEGIN
  IF p_payment_method NOT IN ('cash', 'ican') THEN
    RAISE EXCEPTION 'Payment method must be cash or ican';
  END IF;

  SELECT * INTO v_advance FROM public.business_salary_advances WHERE id = p_advance_id FOR UPDATE;
  IF v_advance.id IS NULL THEN RAISE EXCEPTION 'Salary advance request not found'; END IF;
  IF v_advance.status <> 'approved' THEN RAISE EXCEPTION 'Only an approved advance can be paid'; END IF;

  IF NOT public.cmms_can_manage_salary_advances(v_advance.cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to pay salary advances for this company';
  END IF;

  UPDATE public.business_salary_advances
  SET status = 'paid', payment_method = p_payment_method, wallet_transaction_id = p_wallet_transaction_id,
      paid_by = auth.uid(), paid_at = now(), updated_at = now()
  WHERE id = p_advance_id;

  SELECT id INTO v_employee_cmms_id
    FROM public.cmms_users
   WHERE cmms_company_id = v_advance.cmms_company_id AND ican_user_id = v_advance.employee_user_id
   LIMIT 1;

  PERFORM public.fn_create_cmms_notification(
    v_employee_cmms_id, v_advance.cmms_company_id, 'salary_advance_paid', 'Salary Advance Paid',
    format('Your %s %s salary advance was paid via %s.', v_advance.currency, v_advance.amount,
      CASE WHEN p_payment_method = 'ican' THEN 'IcanEra wallet' ELSE 'cash' END),
    '💸', 'payroll', 'Confirm Receipt'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_salary_advance_received(p_advance_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_advance public.business_salary_advances;
  v_payer_cmms_id UUID;
BEGIN
  SELECT * INTO v_advance FROM public.business_salary_advances WHERE id = p_advance_id FOR UPDATE;
  IF v_advance.id IS NULL THEN RAISE EXCEPTION 'Salary advance request not found'; END IF;
  IF v_advance.employee_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Only the requesting employee can confirm receipt';
  END IF;
  IF v_advance.status <> 'paid' THEN
    RAISE EXCEPTION 'This advance has not been marked paid yet';
  END IF;

  UPDATE public.business_salary_advances
  SET status = 'confirmed', employee_confirmed_at = now(), updated_at = now()
  WHERE id = p_advance_id;

  SELECT id INTO v_payer_cmms_id
    FROM public.cmms_users
   WHERE cmms_company_id = v_advance.cmms_company_id AND ican_user_id = v_advance.paid_by
   LIMIT 1;

  PERFORM public.fn_create_cmms_notification(
    v_payer_cmms_id, v_advance.cmms_company_id, 'salary_advance_confirmed', 'Advance Receipt Confirmed',
    format('The employee confirmed receiving the %s %s salary advance.', v_advance.currency, v_advance.amount),
    '📬', 'payroll', 'View'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_salary_advance(p_advance_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_advance public.business_salary_advances;
  v_is_approver BOOLEAN;
  v_employee_cmms_id UUID;
BEGIN
  SELECT * INTO v_advance FROM public.business_salary_advances WHERE id = p_advance_id FOR UPDATE;
  IF v_advance.id IS NULL THEN RAISE EXCEPTION 'Salary advance request not found'; END IF;

  v_is_approver := public.cmms_can_manage_salary_advances(v_advance.cmms_company_id);
  IF v_advance.employee_user_id <> auth.uid() AND NOT v_is_approver THEN
    RAISE EXCEPTION 'You do not have permission to cancel this request';
  END IF;
  IF v_advance.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'Only a pending or approved (not yet paid) request can be cancelled';
  END IF;

  UPDATE public.business_salary_advances SET status = 'cancelled', updated_at = now() WHERE id = p_advance_id;

  IF auth.uid() = v_advance.employee_user_id THEN
    SELECT id INTO v_employee_cmms_id
      FROM public.cmms_users
     WHERE cmms_company_id = v_advance.cmms_company_id AND ican_user_id = v_advance.employee_user_id
     LIMIT 1;

    PERFORM public.cmms_notify_company_approvers(
      v_advance.cmms_company_id, NULL, 'salary_advance_cancelled', 'Salary Advance Cancelled',
      format('The employee cancelled their %s %s salary advance request.', v_advance.currency, v_advance.amount),
      '🚫', 'payroll', 'View', 'payroll', 'approve', v_employee_cmms_id
    );
  ELSE
    SELECT id INTO v_employee_cmms_id
      FROM public.cmms_users
     WHERE cmms_company_id = v_advance.cmms_company_id AND ican_user_id = v_advance.employee_user_id
     LIMIT 1;

    PERFORM public.fn_create_cmms_notification(
      v_employee_cmms_id, v_advance.cmms_company_id, 'salary_advance_cancelled', 'Salary Advance Cancelled',
      format('Your %s %s salary advance request was cancelled.', v_advance.currency, v_advance.amount),
      '🚫', 'payroll', 'View'
    );
  END IF;
END;
$$;

-- ============================================================
-- 2. REQUISITIONS ("needs")
-- ============================================================

CREATE OR REPLACE FUNCTION public.submit_requisition(
  p_department_id UUID,
  p_purpose VARCHAR,
  p_justification TEXT,
  p_urgency_level VARCHAR DEFAULT 'normal',
  p_required_by_date DATE DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::JSONB -- Array of {item_id, quantity, unit_price, lead_time_days}
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_company_id UUID;
  v_user_email VARCHAR(255);
  v_user_name VARCHAR(255);
  v_user_role VARCHAR(100);
  v_requisition_id UUID;
  v_requisition_number VARCHAR(100);
  v_item JSONB;
  v_total_cost NUMERIC(15, 2);
  v_dept_budget NUMERIC(15, 2);
  v_budget_used NUMERIC(15, 2);
  v_budget_available NUMERIC(15, 2);
  v_dept_head_id UUID;
BEGIN
  -- Get current user
  SELECT au.id, cu.email, cu.full_name, cu.cmms_company_id
  INTO v_user_id, v_user_email, v_user_name, v_company_id
  FROM auth.users au
  JOIN public.cmms_users cu ON au.email = cu.email
  WHERE au.id = auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated or not in CMMS system';
  END IF;

  -- Get user's role
  SELECT r.role_name INTO v_user_role
  FROM public.cmms_users cu
  JOIN public.cmms_user_roles cur ON cu.id = cur.cmms_user_id
  JOIN public.cmms_roles r ON cur.cmms_role_id = r.id
  WHERE cu.id = v_user_id AND cur.is_active = TRUE
  LIMIT 1;

  -- Verify user is in department
  IF NOT EXISTS (
    SELECT 1 FROM public.cmms_department_staff
    WHERE department_id = p_department_id
      AND cmms_user_id = v_user_id
      AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'User is not part of this department';
  END IF;

  -- Get company budget info
  SELECT cd.cmms_company_id, cd.annual_budget, COALESCE(cd.budget_used, 0), cd.department_head_id
  INTO v_company_id, v_dept_budget, v_budget_used, v_dept_head_id
  FROM public.cmms_departments cd
  WHERE cd.id = p_department_id;

  v_budget_available := COALESCE(v_dept_budget - v_budget_used, 0);

  -- Generate requisition number
  v_requisition_number := public.generate_requisition_number(v_company_id);

  -- Create requisition
  INSERT INTO public.cmms_requisitions (
    cmms_company_id,
    department_id,
    requisition_number,
    requested_by,
    requested_by_email,
    requested_by_name,
    requested_by_role,
    purpose,
    justification,
    urgency_level,
    required_by_date,
    status,
    budget_available,
    total_estimated_cost
  ) VALUES (
    v_company_id,
    p_department_id,
    v_requisition_number,
    v_user_id,
    v_user_email,
    v_user_name,
    v_user_role,
    p_purpose,
    p_justification,
    p_urgency_level,
    COALESCE(p_required_by_date, CURRENT_DATE + INTERVAL '7 days'),
    'pending_department_head',
    v_budget_available,
    0
  )
  RETURNING id INTO v_requisition_id;

  -- Add line items if provided
  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      INSERT INTO public.cmms_requisition_items (
        requisition_id,
        department_id,
        inventory_item_id,
        item_code,
        item_name,
        item_description,
        category,
        requested_quantity,
        unit_of_measure,
        unit_price,
        lead_time_days,
        expected_delivery_date
      ) VALUES (
        v_requisition_id,
        p_department_id,
        (v_item->>'inventory_item_id')::UUID,
        v_item->>'item_code',
        v_item->>'item_name',
        v_item->>'item_description',
        v_item->>'category',
        (v_item->>'requested_quantity')::NUMERIC,
        v_item->>'unit_of_measure',
        (v_item->>'unit_price')::NUMERIC,
        (v_item->>'lead_time_days')::INTEGER,
        (CURRENT_DATE + ((v_item->>'lead_time_days')::INTEGER || ' days')::INTERVAL)::DATE
      );
    END LOOP;
  END IF;

  -- Update total estimated cost
  UPDATE public.cmms_requisitions
  SET total_estimated_cost = public.calculate_requisition_total(v_requisition_id),
      budget_sufficient = (public.calculate_requisition_total(v_requisition_id) <= v_budget_available),
      cost_over_threshold = (public.calculate_requisition_total(v_requisition_id) > (v_dept_budget * 0.2))
  WHERE id = v_requisition_id;

  IF v_dept_head_id IS NOT NULL AND v_dept_head_id <> v_user_id THEN
    PERFORM public.fn_create_cmms_notification(
      v_dept_head_id, v_company_id, 'requisition_submitted', 'Requisition Awaiting Your Approval',
      format('%s submitted requisition %s (%s) for your department approval.', COALESCE(v_user_name, 'A staff member'), v_requisition_number, p_purpose),
      '📦', 'approvals', 'Review'
    );
  END IF;

  PERFORM public.cmms_notify_company_approvers(
    v_company_id, NULL, 'requisition_submitted', 'Requisition Awaiting Approval',
    format('%s submitted requisition %s (%s) for department approval.', COALESCE(v_user_name, 'A staff member'), v_requisition_number, p_purpose),
    '📦', 'approvals', 'Review', NULL, NULL, v_user_id
  );

  RETURN v_requisition_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_requisition(
  p_requisition_id UUID,
  p_decision VARCHAR,
  p_comment TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_user_email VARCHAR(255);
  v_user_name VARCHAR(255);
  v_user_role VARCHAR(100);
  v_current_status VARCHAR(50);
  v_department_id UUID;
  v_approval_level VARCHAR(50);
  v_new_status VARCHAR(50);
  v_company_id UUID;
  v_requested_by UUID;
  v_requisition_number VARCHAR(100);
BEGIN
  -- Get current user
  SELECT au.id, cu.email, cu.full_name
  INTO v_user_id, v_user_email, v_user_name
  FROM auth.users au
  JOIN public.cmms_users cu ON au.email = cu.email
  WHERE au.id = auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  -- Get requisition details
  SELECT cr.status, cr.department_id, cr.cmms_company_id, cr.requested_by, cr.requisition_number
  INTO v_current_status, v_department_id, v_company_id, v_requested_by, v_requisition_number
  FROM public.cmms_requisitions cr
  WHERE cr.id = p_requisition_id;

  -- Get user's role
  SELECT r.role_name INTO v_user_role
  FROM public.cmms_users cu
  JOIN public.cmms_user_roles cur ON cu.id = cur.cmms_user_id
  JOIN public.cmms_roles r ON cur.cmms_role_id = r.id
  WHERE cu.id = v_user_id AND cur.is_active = TRUE
  LIMIT 1;

  -- Determine approval level and new status
  CASE v_current_status
    WHEN 'pending_department_head' THEN
      v_approval_level := 'department_head';
      v_new_status := CASE WHEN p_decision = 'approved' THEN 'pending_finance' ELSE 'rejected' END;
    WHEN 'pending_finance' THEN
      v_approval_level := 'finance';
      v_new_status := CASE WHEN p_decision = 'approved' THEN 'approved' ELSE 'rejected' END;
    ELSE
      RAISE EXCEPTION 'Requisition cannot be approved in current status: %', v_current_status;
  END CASE;

  -- Record approval
  INSERT INTO public.cmms_requisition_approvals (
    requisition_id,
    approval_level,
    approved_by,
    approved_by_email,
    approved_by_name,
    approved_by_role,
    decision,
    decision_comment
  ) VALUES (
    p_requisition_id,
    v_approval_level,
    v_user_id,
    v_user_email,
    v_user_name,
    v_user_role,
    p_decision,
    p_comment
  );

  -- Update requisition status
  UPDATE public.cmms_requisitions
  SET status = v_new_status,
      updated_at = NOW()
  WHERE id = p_requisition_id;

  IF v_approval_level = 'department_head' THEN
    UPDATE public.cmms_requisitions
    SET dept_head_approved_by = v_user_id,
        dept_head_approved_at = NOW(),
        dept_head_decision_notes = p_comment
    WHERE id = p_requisition_id;
  END IF;

  IF v_approval_level = 'finance' THEN
    UPDATE public.cmms_requisitions
    SET finance_approved_by = v_user_id,
        finance_approved_at = NOW(),
        finance_decision_notes = p_comment
    WHERE id = p_requisition_id;
  END IF;

  IF v_new_status = 'pending_finance' THEN
    PERFORM public.cmms_notify_company_approvers(
      v_company_id, ARRAY['finance'], 'requisition_finance_review', 'Requisition Awaiting Finance Review',
      format('Requisition %s was approved by the department head and now needs finance review.', v_requisition_number),
      '💵', 'approvals', 'Review'
    );
  ELSIF v_new_status IN ('approved', 'rejected') THEN
    PERFORM public.fn_create_cmms_notification(
      v_requested_by, v_company_id,
      CASE WHEN v_new_status = 'approved' THEN 'requisition_approved' ELSE 'requisition_rejected' END,
      CASE WHEN v_new_status = 'approved' THEN 'Requisition Approved' ELSE 'Requisition Rejected' END,
      CASE WHEN v_new_status = 'approved'
        THEN format('Your requisition %s was fully approved.', v_requisition_number)
        ELSE format('Your requisition %s was rejected at the %s stage.%s', v_requisition_number, v_approval_level,
          CASE WHEN NULLIF(TRIM(p_comment), '') IS NOT NULL THEN ' Reason: ' || TRIM(p_comment) ELSE '' END)
      END,
      CASE WHEN v_new_status = 'approved' THEN '✅' ELSE '🚫' END,
      'requisitions', 'View'
    );
  END IF;
END;
$$;

-- ============================================================
-- 3. REWARD POINTS REDEMPTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_maybe_queue_reward_redemption(
  p_cmms_company_id UUID,
  p_cmms_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.cmms_rewards_settings;
  v_balance INTEGER;
  v_ican_amount NUMERIC(18,8);
  v_redemption_id UUID;
BEGIN
  SELECT * INTO v_settings FROM public.cmms_rewards_settings WHERE cmms_company_id = p_cmms_company_id;
  IF v_settings.cmms_company_id IS NULL OR NOT v_settings.enabled OR NOT v_settings.auto_redeem_enabled THEN
    RETURN;
  END IF;
  IF v_settings.ican_coins_per_point <= 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(points), 0) INTO v_balance
    FROM public.cmms_reward_points_ledger
   WHERE cmms_company_id = p_cmms_company_id AND cmms_user_id = p_cmms_user_id;

  IF v_balance < v_settings.auto_redeem_threshold_points THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cmms_users u
    WHERE u.id = p_cmms_user_id AND u.ican_user_id IS NOT NULL
  ) THEN
    RETURN; -- not linked to an ICAN wallet yet — nowhere to pay this out to
  END IF;

  v_ican_amount := ROUND(v_balance * v_settings.ican_coins_per_point, 8);
  IF v_ican_amount <= 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.cmms_reward_redemptions
    (cmms_company_id, cmms_user_id, points_redeemed, ican_coins_per_point, ican_amount, status, triggered_by)
  VALUES (p_cmms_company_id, p_cmms_user_id, v_balance, v_settings.ican_coins_per_point, v_ican_amount, 'pending', 'auto')
  RETURNING id INTO v_redemption_id;

  -- Reserve the points immediately so a second award landing a moment later
  -- computes its balance against zero, not against points already spoken for.
  INSERT INTO public.cmms_reward_points_ledger
    (cmms_company_id, cmms_user_id, points, source_type, source_id, reason)
  VALUES (p_cmms_company_id, p_cmms_user_id, -v_balance, 'redeemed', v_redemption_id, 'Auto-queued for redemption');

  PERFORM public.fn_create_cmms_notification(
    p_cmms_user_id, p_cmms_company_id, 'reward_redemption_queued', 'Reward Points Queued for Payout',
    format('%s point(s) were automatically queued for redemption (%s ICAN).', v_balance, v_ican_amount),
    '🎁', 'attendance', 'View'
  );

  PERFORM public.cmms_notify_company_approvers(
    p_cmms_company_id, NULL, 'reward_redemption_pending', 'Reward Redemption Ready for Payout',
    format('An employee reward redemption (%s ICAN) is ready to be paid.', v_ican_amount),
    '🎁', 'attendance', 'Pay'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cmms_request_reward_redemption(
  p_cmms_company_id UUID,
  p_cmms_user_id UUID,
  p_points INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.cmms_rewards_settings;
  v_balance INTEGER;
  v_points INTEGER;
  v_ican_amount NUMERIC(18,8);
  v_redemption_id UUID;
BEGIN
  IF NOT public.cmms_attendance_qr_admin(p_cmms_company_id) THEN
    RAISE EXCEPTION 'Only a company administrator can request a reward redemption';
  END IF;

  SELECT * INTO v_settings FROM public.cmms_rewards_settings WHERE cmms_company_id = p_cmms_company_id;
  IF v_settings.cmms_company_id IS NULL OR v_settings.ican_coins_per_point <= 0 THEN
    RAISE EXCEPTION 'Set an ICAN coins-per-point rate before redeeming points';
  END IF;

  SELECT COALESCE(SUM(points), 0) INTO v_balance
    FROM public.cmms_reward_points_ledger
   WHERE cmms_company_id = p_cmms_company_id AND cmms_user_id = p_cmms_user_id;

  v_points := COALESCE(p_points, v_balance);
  IF v_points IS NULL OR v_points <= 0 THEN
    RAISE EXCEPTION 'This employee has no reward points available to redeem';
  END IF;
  IF v_points > v_balance THEN
    RAISE EXCEPTION 'Cannot redeem more points than the employee has available (% available)', v_balance;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.cmms_users WHERE id = p_cmms_user_id AND ican_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'This employee is not linked to an ICAN wallet yet';
  END IF;

  v_ican_amount := ROUND(v_points * v_settings.ican_coins_per_point, 8);
  IF v_ican_amount <= 0 THEN
    RAISE EXCEPTION 'The ICAN coins-per-point rate is too low to redeem any points yet';
  END IF;

  INSERT INTO public.cmms_reward_redemptions
    (cmms_company_id, cmms_user_id, points_redeemed, ican_coins_per_point, ican_amount, status, triggered_by, requested_by)
  VALUES (p_cmms_company_id, p_cmms_user_id, v_points, v_settings.ican_coins_per_point, v_ican_amount, 'pending', 'manual', auth.uid())
  RETURNING id INTO v_redemption_id;

  INSERT INTO public.cmms_reward_points_ledger
    (cmms_company_id, cmms_user_id, points, source_type, source_id, reason, created_by)
  VALUES (p_cmms_company_id, p_cmms_user_id, -v_points, 'redeemed', v_redemption_id, 'Redemption requested by admin', auth.uid());

  PERFORM public.fn_create_cmms_notification(
    p_cmms_user_id, p_cmms_company_id, 'reward_redemption_requested', 'Reward Redemption Requested',
    format('An admin requested a redemption of %s point(s) (%s ICAN) on your behalf.', v_points, v_ican_amount),
    '🎁', 'attendance', 'View'
  );

  RETURN jsonb_build_object('redemption_id', v_redemption_id, 'points_redeemed', v_points, 'ican_amount', v_ican_amount);
END;
$$;

CREATE OR REPLACE FUNCTION public.cmms_cancel_reward_redemption(p_redemption_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_redemption public.cmms_reward_redemptions;
BEGIN
  SELECT * INTO v_redemption FROM public.cmms_reward_redemptions WHERE id = p_redemption_id FOR UPDATE;
  IF v_redemption.id IS NULL THEN
    RAISE EXCEPTION 'Redemption not found';
  END IF;
  IF NOT public.cmms_attendance_qr_admin(v_redemption.cmms_company_id) THEN
    RAISE EXCEPTION 'Only a company administrator can cancel a reward redemption';
  END IF;
  IF v_redemption.status <> 'pending' THEN
    RAISE EXCEPTION 'Only a pending redemption can be cancelled';
  END IF;

  UPDATE public.cmms_reward_redemptions
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
   WHERE id = p_redemption_id;

  INSERT INTO public.cmms_reward_points_ledger
    (cmms_company_id, cmms_user_id, points, source_type, source_id, reason, created_by)
  VALUES (v_redemption.cmms_company_id, v_redemption.cmms_user_id, v_redemption.points_redeemed,
    'redeemed_reversal', p_redemption_id, 'Redemption cancelled', auth.uid());

  PERFORM public.fn_create_cmms_notification(
    v_redemption.cmms_user_id, v_redemption.cmms_company_id, 'reward_redemption_cancelled', 'Reward Redemption Cancelled',
    format('Your redemption of %s point(s) was cancelled and the points were returned to your balance.', v_redemption.points_redeemed),
    '↩️', 'attendance', 'View'
  );

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.cmms_pay_reward_redemption(
  p_redemption_id UUID,
  p_payment_method TEXT,
  p_wallet_transaction_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_redemption public.cmms_reward_redemptions;
  v_business_profile_id UUID;
  v_employee_user_id UUID;
  v_employee_name TEXT;
  v_business_name TEXT;
  v_wallet_tx public.ican_business_wallet_transactions;
  v_wallet_tx_id UUID;
BEGIN
  SELECT * INTO v_redemption FROM public.cmms_reward_redemptions WHERE id = p_redemption_id FOR UPDATE;
  IF v_redemption.id IS NULL THEN
    RAISE EXCEPTION 'Redemption not found';
  END IF;
  IF NOT public.cmms_attendance_qr_admin(v_redemption.cmms_company_id) THEN
    RAISE EXCEPTION 'Only a company administrator can pay a reward redemption';
  END IF;
  IF v_redemption.status <> 'pending' THEN
    RAISE EXCEPTION 'This redemption has already been settled';
  END IF;
  IF lower(COALESCE(p_payment_method, '')) NOT IN ('cash', 'ican') THEN
    RAISE EXCEPTION 'Choose cash or wallet to record this payment';
  END IF;

  SELECT pichin_business_profile_id INTO v_business_profile_id
    FROM public.cmms_company_profiles WHERE id = v_redemption.cmms_company_id;

  SELECT ican_user_id, COALESCE(full_name, user_name) INTO v_employee_user_id, v_employee_name
    FROM public.cmms_users WHERE id = v_redemption.cmms_user_id;

  SELECT business_name INTO v_business_name FROM public.business_profiles WHERE id = v_business_profile_id;

  IF lower(p_payment_method) = 'ican' THEN
    BEGIN
      v_wallet_tx_id := NULLIF(trim(p_wallet_transaction_id), '')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      v_wallet_tx_id := NULL;
    END;
    IF v_wallet_tx_id IS NULL THEN
      RAISE EXCEPTION 'A completed IcanEra wallet transfer is required to record this payment';
    END IF;

    SELECT * INTO v_wallet_tx FROM public.ican_business_wallet_transactions WHERE id = v_wallet_tx_id FOR UPDATE;
    IF v_wallet_tx.id IS NULL THEN
      RAISE EXCEPTION 'Wallet transaction not found';
    END IF;
    IF v_wallet_tx.business_profile_id <> v_business_profile_id THEN
      RAISE EXCEPTION 'That wallet transaction does not belong to this business';
    END IF;
    IF v_wallet_tx.recipient_user_id IS DISTINCT FROM v_employee_user_id THEN
      RAISE EXCEPTION 'That wallet transaction was not paid to this employee';
    END IF;
    IF v_wallet_tx.status <> 'completed' THEN
      RAISE EXCEPTION 'This wallet payment is still awaiting business-wallet approval';
    END IF;
    IF ABS(v_wallet_tx.amount_ican - v_redemption.ican_amount) > 0.0001 THEN
      RAISE EXCEPTION 'The wallet payment amount (% ICAN) does not match the amount due (% ICAN)', v_wallet_tx.amount_ican, v_redemption.ican_amount;
    END IF;
  END IF;

  UPDATE public.cmms_reward_redemptions
     SET status = 'paid', payment_method = lower(p_payment_method), wallet_transaction_id = v_wallet_tx_id,
         paid_at = now(), paid_by = auth.uid()
   WHERE id = p_redemption_id;

  -- A wallet payment already has its own ledger row from the transfer we
  -- just verified. Cash never touches the wallet, so give it the same
  -- single echo row cmms_settle_attendance_pay writes for cash salary — see
  -- that function's long comment for exactly why each field here is set
  -- the way it is (sender_user_id NULL, single row, explicit
  -- counterparty_type/expense_classification, source_app 'ican', etc).
  IF lower(p_payment_method) = 'cash' THEN
    INSERT INTO public.ican_coin_transactions
      (recipient_user_id, ican_amount, type, transaction_type, source_app, status,
       local_amount, local_currency, reference_id, note, business_profile_id,
       merchant_name, counterparty_type, expense_classification)
    VALUES (
      v_employee_user_id, v_redemption.ican_amount, 'transfer_out', 'transfer_out', 'ican', 'completed',
      NULL, NULL, p_redemption_id::TEXT,
      'Reward points redeemed (' || COALESCE(v_employee_name, 'Employee') || ')',
      v_business_profile_id, v_business_name, 'business', 'business_expense'
    );
  END IF;

  PERFORM public.fn_create_cmms_notification(
    v_redemption.cmms_user_id, v_redemption.cmms_company_id, 'reward_redemption_paid', 'Reward Points Paid Out',
    format('Your %s point redemption (%s ICAN) was paid via %s.', v_redemption.points_redeemed, v_redemption.ican_amount,
      CASE WHEN lower(p_payment_method) = 'ican' THEN 'IcanEra wallet' ELSE 'cash' END),
    '💸', 'attendance', 'View'
  );

  RETURN jsonb_build_object('paid', true, 'ican_amount', v_redemption.ican_amount, 'points_redeemed', v_redemption.points_redeemed);
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────
-- VERIFY
-- ─────────────────────────────────────────────────────────────────────────
SELECT 'CMMS salary advance / requisition / reward-points notifications wired up' AS status;
