-- ============================================================================
-- CMMS SALARY ADVANCES — several open advances + a clear repayment plan
-- Run after CMMS_SALARY_ADVANCE_REQUESTS.sql,
-- CMMS_SALARY_ADVANCE_REQUISITION_REWARDS_NOTIFICATIONS.sql and
-- CMMS_SALARY_ADVANCE_RECOVERY_AMBIGUOUS_COLUMN_FIX.sql.
--
-- WHAT CHANGES
--   1. An employee may now have up to 3 advances open at once (pending,
--      approved, paid or confirmed). The old "one live advance" unique index
--      is removed. The approver still decides each request on its own.
--   2. Every request now states HOW it will be paid back: the number of pay
--      periods (1-12) it is spread over, plus an optional note. Each pay
--      period takes at most one installment (amount / installments, rounded
--      up to the cent) per advance, never more than what is left of that
--      period's pay, and never more than the advance still outstanding.
--      The approver sees the plan before approving.
--   3. apply_salary_advance_recovery walks every confirmed advance of an
--      employee, oldest first, sharing that period's available pay between
--      them. It stays idempotent per (advance, payroll entry).
--
-- Existing rows keep working: they default to 1 installment, i.e. the whole
-- balance is taken from the next payroll, exactly as before.
-- ============================================================================

ALTER TABLE public.business_salary_advances
  ADD COLUMN IF NOT EXISTS repayment_installments INT NOT NULL DEFAULT 1
    CHECK (repayment_installments BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS repayment_note TEXT;

DROP INDEX IF EXISTS public.uq_salary_advances_one_live_per_employee;

-- The old 4-argument signature must go first: adding defaulted arguments to a
-- new overload would leave PostgREST unable to choose between the two.
DROP FUNCTION IF EXISTS public.request_salary_advance(UUID, NUMERIC, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.request_salary_advance(
  p_cmms_company_id UUID,
  p_amount NUMERIC,
  p_currency TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_installments INT DEFAULT 1,
  p_repayment_note TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_max_open CONSTANT INT := 3;
  v_company public.cmms_company_profiles;
  v_currency TEXT;
  v_advance_id UUID;
  v_employee_name TEXT;
  v_employee_cmms_id UUID;
  v_open INT;
  v_installments INT := COALESCE(p_installments, 1);
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

  IF v_installments < 1 OR v_installments > 12 THEN
    RAISE EXCEPTION 'Choose a repayment plan of 1 to 12 pay periods';
  END IF;

  SELECT * INTO v_company FROM public.cmms_company_profiles WHERE id = p_cmms_company_id;
  IF v_company.id IS NULL OR v_company.pichin_business_profile_id IS NULL THEN
    RAISE EXCEPTION 'Link this CMMS company to its Pichin business profile before requesting a salary advance';
  END IF;

  -- Serialise this employee's requests so two taps cannot slip past the cap.
  PERFORM pg_advisory_xact_lock(hashtext('salary_advance:' || auth.uid()::text));

  SELECT count(*) INTO v_open
    FROM public.business_salary_advances
   WHERE employee_user_id = auth.uid()
     AND cmms_company_id = p_cmms_company_id
     AND status IN ('pending', 'approved', 'paid', 'confirmed');
  IF v_open >= c_max_open THEN
    RAISE EXCEPTION 'You already have % open salary advances. Wait for one to be settled or cancelled before requesting another.', c_max_open;
  END IF;

  v_currency := COALESCE(NULLIF(TRIM(p_currency), ''), (
    SELECT currency FROM public.business_compensation_profiles
    WHERE business_profile_id = v_company.pichin_business_profile_id
      AND employee_user_id = auth.uid()
      AND payroll_status = 'on_pay'
    ORDER BY effective_from DESC LIMIT 1
  ), 'UGX');

  INSERT INTO public.business_salary_advances (
    business_profile_id, cmms_company_id, employee_user_id, amount, currency, reason,
    repayment_installments, repayment_note
  ) VALUES (
    v_company.pichin_business_profile_id, p_cmms_company_id, auth.uid(), p_amount, v_currency,
    NULLIF(TRIM(p_reason), ''), v_installments, NULLIF(TRIM(p_repayment_note), '')
  ) RETURNING id INTO v_advance_id;

  SELECT id, COALESCE(full_name, user_name) INTO v_employee_cmms_id, v_employee_name
    FROM public.cmms_users
   WHERE cmms_company_id = p_cmms_company_id AND is_active
     AND lower(email) = lower(auth.jwt() ->> 'email')
   LIMIT 1;

  PERFORM public.cmms_notify_company_approvers(
    p_cmms_company_id, NULL, 'salary_advance_requested', 'Salary Advance Request',
    format('%s requested a %s %s salary advance, to be repaid over %s pay period(s), awaiting your approval.',
           COALESCE(v_employee_name, 'An employee'), v_currency, p_amount, v_installments),
    '💰', 'payroll', 'Review', 'payroll', 'approve', v_employee_cmms_id
  );

  RETURN v_advance_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_salary_advance(UUID, NUMERIC, TEXT, TEXT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_salary_advance(UUID, NUMERIC, TEXT, TEXT, INT, TEXT) TO authenticated;

-- ============================================================================
-- Recovery: one installment per advance per pay period, oldest advance first.
-- Return shape is unchanged (one row per advance recovered from an entry).
-- ============================================================================
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
#variable_conflict use_column
DECLARE
  v_period public.business_payroll_periods;
  v_company public.cmms_company_profiles;
  v_row RECORD;
  v_advance RECORD;
  v_outstanding NUMERIC(15,2);
  v_installment NUMERIC(15,2);
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
    v_available := GREATEST(v_row.base_amount + v_row.allowances + v_row.incentives - v_row.deductions, 0);

    FOR v_advance IN
      SELECT a.id, a.amount, a.recovered_amount, a.repayment_installments
        FROM public.business_salary_advances a
       WHERE a.employee_user_id = v_row.employee_user_id
         AND a.status = 'confirmed'
         AND a.amount > a.recovered_amount
       ORDER BY a.paid_at ASC NULLS LAST, a.requested_at ASC
    LOOP
      EXIT WHEN v_available <= 0;

      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.business_salary_advance_recoveries r
        WHERE r.salary_advance_id = v_advance.id AND r.payroll_entry_id = v_row.entry_id
      );

      v_outstanding := v_advance.amount - v_advance.recovered_amount;
      v_installment := CEIL(v_advance.amount / GREATEST(v_advance.repayment_installments, 1) * 100) / 100;
      v_take := LEAST(v_outstanding, v_installment, v_available);
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

      v_available := v_available - v_take;

      payroll_entry_id := v_row.entry_id; employee_user_id := v_row.employee_user_id; advance_recovered := v_take;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_salary_advance_recovery(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_salary_advance_recovery(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'Salary advances: up to 3 open per employee, each with a repayment plan (installments + note); recovery takes one installment per advance per pay period' AS status;
