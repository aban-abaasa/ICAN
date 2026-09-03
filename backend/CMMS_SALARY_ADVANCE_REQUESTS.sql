-- ============================================================================
-- CMMS SALARY ADVANCE REQUESTS — "My Salary" tab
-- Run after SHARED_BUSINESS_AUTHORITY_AND_PAYROLL.sql,
-- CMMS_DEPARTMENT_PAYROLL_RLS_FIX.sql, CMMS_MY_SALARY_TAB_PAYROLL_ACCESS.sql,
-- and CMMS_STAFF_ATTENDANCE_VISITOR_MANAGEMENT.sql (for cmms_attendance_qr_admin
-- / cmms_active_staff).
--
-- FLOW:
--   1. An employee requests an advance from "My Salary" (request_salary_advance).
--   2. A Payroll role with Approve ticked (or a full admin) approves or
--      rejects it (decide_salary_advance).
--   3. Once approved, that same role pays it — cash or the IcanEra business
--      wallet (ICAN coin, on-chain like every other payroll payment in this
--      app) — recording the result (pay_salary_advance). Paying with the
--      wallet still goes through pitchin_business_wallet_transfer exactly
--      like a normal salary payment; this table only records the outcome.
--   4. The employee must separately confirm they actually received it
--      (confirm_salary_advance_received). Nothing is deducted from future
--      pay until the employee has confirmed — an admin marking something
--      "paid" is not enough on its own to reduce what the employee is owed.
--   5. Once confirmed, apply_salary_advance_recovery (run against a draft
--      payroll period, next to the existing "Calculate attendance" action)
--      deducts the outstanding balance from that employee's payroll entries
--      until it is fully recovered, the same reviewable-before-approval way
--      attendance deductions already work.
--
-- Only one live (not yet rejected/cancelled/settled) advance per employee is
-- allowed at a time — this keeps recovery unambiguous without needing a
-- multi-advance allocation ledger.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.business_salary_advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  employee_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'UGX',
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'rejected', 'cancelled', 'approved', 'paid', 'confirmed', 'settled')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  payment_method TEXT CHECK (payment_method IN ('cash', 'ican')),
  wallet_transaction_id UUID,
  paid_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  paid_at TIMESTAMPTZ,
  employee_confirmed_at TIMESTAMPTZ,
  recovered_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (recovered_amount >= 0),
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salary_advances_company ON public.business_salary_advances(cmms_company_id, status);
CREATE INDEX IF NOT EXISTS idx_salary_advances_employee ON public.business_salary_advances(employee_user_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_salary_advances_one_live_per_employee
  ON public.business_salary_advances(employee_user_id)
  WHERE status IN ('pending', 'approved', 'paid', 'confirmed');

-- One row per (advance, payroll entry) it was recovered from — an audit
-- ledger that also makes recovery idempotent: re-running it for a period
-- that already recovered from a given entry is a safe no-op.
CREATE TABLE IF NOT EXISTS public.business_salary_advance_recoveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salary_advance_id UUID NOT NULL REFERENCES public.business_salary_advances(id) ON DELETE CASCADE,
  payroll_entry_id UUID NOT NULL REFERENCES public.business_payroll_entries(id) ON DELETE CASCADE,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (salary_advance_id, payroll_entry_id)
);

-- ============================================================
-- Permission check — full admin, or a role with Payroll -> Approve.
-- ============================================================
CREATE OR REPLACE FUNCTION public.cmms_can_manage_salary_advances(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT public.cmms_attendance_qr_admin(p_company_id)
      OR EXISTS (
        SELECT 1
          FROM public.cmms_users cu
          JOIN public.cmms_user_roles ur ON ur.cmms_user_id = cu.id AND ur.is_active
          JOIN public.cmms_roles r ON r.id = ur.cmms_role_id AND r.is_active
         WHERE cu.cmms_company_id = p_company_id
           AND cu.is_active
           AND lower(cu.email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
           AND COALESCE((r.tool_access -> 'payroll' ->> 'approve')::BOOLEAN, FALSE)
      );
$$;

REVOKE ALL ON FUNCTION public.cmms_can_manage_salary_advances(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_can_manage_salary_advances(UUID) TO authenticated;

ALTER TABLE public.business_salary_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_salary_advance_recoveries ENABLE ROW LEVEL SECURITY;

-- All writes go through the SECURITY DEFINER functions below, which apply
-- their own checks — these policies only gate direct reads.
DROP POLICY IF EXISTS business_salary_advances_read ON public.business_salary_advances;
CREATE POLICY business_salary_advances_read ON public.business_salary_advances
  FOR SELECT TO authenticated
  USING (employee_user_id = auth.uid() OR public.cmms_can_manage_salary_advances(cmms_company_id));

DROP POLICY IF EXISTS business_salary_advance_recoveries_read ON public.business_salary_advance_recoveries;
CREATE POLICY business_salary_advance_recoveries_read ON public.business_salary_advance_recoveries
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.business_salary_advances a
      WHERE a.id = salary_advance_id
        AND (a.employee_user_id = auth.uid() OR public.cmms_can_manage_salary_advances(a.cmms_company_id))
    )
  );

-- ============================================================
-- 1. Employee requests an advance
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

  RETURN v_advance_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_salary_advance(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_salary_advance(UUID, NUMERIC, TEXT, TEXT) TO authenticated;

-- ============================================================
-- 2. Approver approves or rejects
-- ============================================================
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
END;
$$;

REVOKE ALL ON FUNCTION public.decide_salary_advance(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_salary_advance(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================
-- 3. Approver pays it — the ICAN wallet transfer itself already happened
--    client-side via pitchin_business_wallet_transfer (same on-chain
--    IcanEra coin ledger as every other payroll payment); this just
--    records the outcome, same shape as complete_cmms_payroll_payment.
-- ============================================================
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
END;
$$;

REVOKE ALL ON FUNCTION public.pay_salary_advance(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pay_salary_advance(UUID, TEXT, UUID) TO authenticated;

-- ============================================================
-- 4. Employee confirms receipt — required before any payroll recovery.
-- ============================================================
CREATE OR REPLACE FUNCTION public.confirm_salary_advance_received(p_advance_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_advance public.business_salary_advances;
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
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_salary_advance_received(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_salary_advance_received(UUID) TO authenticated;

-- ============================================================
-- 5. Either side can cancel before money has actually moved.
-- ============================================================
CREATE OR REPLACE FUNCTION public.cancel_salary_advance(p_advance_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_advance public.business_salary_advances;
  v_is_approver BOOLEAN;
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
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_salary_advance(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_salary_advance(UUID) TO authenticated;

-- ============================================================
-- 6. Recover a confirmed advance from a draft payroll period — reviewable
--    before approval/payment, same as attendance deductions. Safe to
--    re-run: business_salary_advance_recoveries' UNIQUE (advance, entry)
--    means an entry already recovered from is skipped, not double-charged.
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_salary_advance_recovery(
  p_payroll_period_id UUID
)
RETURNS TABLE (
  payroll_entry_id UUID,
  employee_user_id UUID,
  advance_recovered NUMERIC(15,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period public.business_payroll_periods;
  v_company public.cmms_company_profiles;
  v_row RECORD;
  v_advance public.business_salary_advances;
  v_outstanding NUMERIC(15,2);
  v_available NUMERIC(15,2);
  v_take NUMERIC(15,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required to apply salary advance recovery';
  END IF;

  SELECT * INTO v_period FROM public.business_payroll_periods WHERE id = p_payroll_period_id FOR UPDATE;
  IF v_period.id IS NULL THEN RAISE EXCEPTION 'Payroll period not found'; END IF;
  IF v_period.status NOT IN ('draft', 'pending_approval') THEN
    RAISE EXCEPTION 'Salary advance recovery can only be applied to draft or pending payroll periods';
  END IF;

  SELECT * INTO v_company
  FROM public.cmms_company_profiles
  WHERE pichin_business_profile_id = v_period.business_profile_id
  LIMIT 1;
  IF v_company.id IS NULL THEN RAISE EXCEPTION 'No CMMS company is linked to this payroll business'; END IF;
  IF NOT public.cmms_can_manage_salary_advances(v_company.id) THEN
    RAISE EXCEPTION 'You do not have permission to manage salary advances for this company';
  END IF;

  FOR v_row IN
    SELECT pe.id AS entry_id, pe.employee_user_id, pe.base_amount, pe.allowances, pe.incentives, pe.deductions
    FROM public.business_payroll_entries pe
    WHERE pe.payroll_period_id = v_period.id AND pe.status = 'draft'
  LOOP
    SELECT * INTO v_advance
      FROM public.business_salary_advances
     WHERE employee_user_id = v_row.employee_user_id
       AND status = 'confirmed'
       AND amount > recovered_amount
     ORDER BY paid_at ASC NULLS LAST
     LIMIT 1;

    CONTINUE WHEN v_advance.id IS NULL;

    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.business_salary_advance_recoveries
      WHERE salary_advance_id = v_advance.id AND payroll_entry_id = v_row.entry_id
    );

    v_outstanding := v_advance.amount - v_advance.recovered_amount;
    v_available := GREATEST(v_row.base_amount + v_row.allowances + v_row.incentives - v_row.deductions, 0);
    v_take := LEAST(v_outstanding, v_available);
    CONTINUE WHEN v_take <= 0;

    INSERT INTO public.business_salary_advance_recoveries (salary_advance_id, payroll_entry_id, amount)
    VALUES (v_advance.id, v_row.entry_id, v_take);

    UPDATE public.business_payroll_entries
    SET deductions = deductions + v_take, updated_at = now()
    WHERE id = v_row.entry_id;

    UPDATE public.business_salary_advances
    SET recovered_amount = recovered_amount + v_take,
        status = CASE WHEN recovered_amount + v_take >= amount THEN 'settled' ELSE status END,
        settled_at = CASE WHEN recovered_amount + v_take >= amount THEN now() ELSE settled_at END,
        updated_at = now()
    WHERE id = v_advance.id;

    payroll_entry_id := v_row.entry_id; employee_user_id := v_row.employee_user_id; advance_recovered := v_take;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_salary_advance_recovery(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_salary_advance_recovery(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
