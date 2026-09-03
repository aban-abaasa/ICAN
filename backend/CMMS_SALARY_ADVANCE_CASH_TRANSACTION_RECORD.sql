-- ============================================================================
-- Fix: cash-paid salary advances never showed up in the transaction feed.
-- Run after CMMS_SALARY_ADVANCE_REQUISITION_REWARDS_NOTIFICATIONS.sql.
--
-- BUG: pay_salary_advance() never wrote anything to ican_coin_transactions
-- for a 'cash' payment. A wallet ('ican') payment already has a real ledger
-- row from the wallet transfer the client executes before calling this
-- function (transferFromBusinessWallet in CMMSMySalaryPanel.jsx), but cash
-- never touches the wallet — so a cash-paid advance was invisible on both
-- the employee's personal transaction history and the business's
-- transaction feed, even after the employee confirmed receiving it. This
-- mirrors the exact gap already fixed for attendance-checkout cash salary
-- (cmms_settle_attendance_pay) and cash reward-point redemptions
-- (cmms_pay_reward_redemption) — pay_salary_advance was the one payment path
-- that never got the same single-row cash echo. See either of those
-- functions' long comment for why each field below (sender_user_id NULL,
-- explicit counterparty_type/expense_classification, source_app 'ican',
-- reference_id tying back to the row of truth) is set the way it is.
-- ============================================================================

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
  v_employee_name TEXT;
  v_business_name TEXT;
  v_coin_price NUMERIC;
  v_cash_ican_amount NUMERIC(18,8);
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

  SELECT id, COALESCE(full_name, user_name) INTO v_employee_cmms_id, v_employee_name
    FROM public.cmms_users
   WHERE cmms_company_id = v_advance.cmms_company_id AND ican_user_id = v_advance.employee_user_id
   LIMIT 1;

  IF p_payment_method = 'cash' AND NOT EXISTS (
    SELECT 1 FROM public.ican_coin_transactions
     WHERE reference_id = p_advance_id::TEXT AND note LIKE 'Salary advance (%'
  ) THEN
    SELECT business_name INTO v_business_name FROM public.business_profiles WHERE id = v_advance.business_profile_id;

    SELECT price_local INTO v_coin_price
      FROM public.ican_get_price_in_currency(upper(COALESCE(v_advance.currency, 'UGX')))
     LIMIT 1;
    v_cash_ican_amount := GREATEST(ROUND(v_advance.amount / COALESCE(NULLIF(v_coin_price, 0), 5000), 8), 0.00000001);

    INSERT INTO public.ican_coin_transactions
      (recipient_user_id, ican_amount, type, transaction_type, source_app, status,
       local_amount, local_currency, reference_id, note, business_profile_id,
       merchant_name, counterparty_type, expense_classification)
    VALUES (
      v_advance.employee_user_id, v_cash_ican_amount, 'transfer_out', 'transfer_out', 'ican', 'completed',
      v_advance.amount, v_advance.currency, p_advance_id::TEXT,
      'Salary advance (' || COALESCE(v_employee_name, 'Employee') || ')',
      v_advance.business_profile_id, v_business_name, 'business', 'business_expense'
    );
  END IF;

  PERFORM public.fn_create_cmms_notification(
    v_employee_cmms_id, v_advance.cmms_company_id, 'salary_advance_paid', 'Salary Advance Paid',
    format('Your %s %s salary advance was paid via %s.', v_advance.currency, v_advance.amount,
      CASE WHEN p_payment_method = 'ican' THEN 'IcanEra wallet' ELSE 'cash' END),
    '💸', 'payroll', 'Confirm Receipt'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pay_salary_advance(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pay_salary_advance(UUID, TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- BACKFILL: the fix above only changes pay_salary_advance() going forward.
-- Any cash advance that was already marked 'paid'/'confirmed'/'settled'
-- before this migration ran had pay_salary_advance() execute under the old
-- buggy code, so it will never get a ledger row on its own — do it once here
-- with the same logic (and the same NOT EXISTS guard) as the function above.
-- ============================================================================
DO $$
DECLARE
  v_advance RECORD;
  v_business_name TEXT;
  v_coin_price NUMERIC;
  v_cash_ican_amount NUMERIC(18,8);
  v_employee_name TEXT;
BEGIN
  FOR v_advance IN
    SELECT * FROM public.business_salary_advances
     WHERE payment_method = 'cash'
       AND status IN ('paid', 'confirmed', 'settled')
       AND NOT EXISTS (
         SELECT 1 FROM public.ican_coin_transactions
          WHERE reference_id = business_salary_advances.id::TEXT AND note LIKE 'Salary advance (%'
       )
  LOOP
    SELECT COALESCE(full_name, user_name) INTO v_employee_name
      FROM public.cmms_users
     WHERE cmms_company_id = v_advance.cmms_company_id AND ican_user_id = v_advance.employee_user_id
     LIMIT 1;

    SELECT business_name INTO v_business_name FROM public.business_profiles WHERE id = v_advance.business_profile_id;

    SELECT price_local INTO v_coin_price
      FROM public.ican_get_price_in_currency(upper(COALESCE(v_advance.currency, 'UGX')))
     LIMIT 1;
    v_cash_ican_amount := GREATEST(ROUND(v_advance.amount / COALESCE(NULLIF(v_coin_price, 0), 5000), 8), 0.00000001);

    INSERT INTO public.ican_coin_transactions
      (recipient_user_id, ican_amount, type, transaction_type, source_app, status,
       local_amount, local_currency, reference_id, note, business_profile_id,
       merchant_name, counterparty_type, expense_classification, created_at)
    VALUES (
      v_advance.employee_user_id, v_cash_ican_amount, 'transfer_out', 'transfer_out', 'ican', 'completed',
      v_advance.amount, v_advance.currency, v_advance.id::TEXT,
      'Salary advance (' || COALESCE(v_employee_name, 'Employee') || ')',
      v_advance.business_profile_id, v_business_name, 'business', 'business_expense',
      COALESCE(v_advance.paid_at, v_advance.updated_at)
    );
  END LOOP;
END;
$$;

SELECT 'pay_salary_advance now records a cash transaction in the ledger, and existing cash advances were backfilled' AS status;
