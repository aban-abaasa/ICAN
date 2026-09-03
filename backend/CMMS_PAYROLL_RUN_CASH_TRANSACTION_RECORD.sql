-- ============================================================================
-- Fix: cash-paid NORMAL PAYROLL RUNS never showed up in the transaction feed.
-- Run after CMMS_PAYDAY_ADVISORY_NOTIFICATIONS.sql.
--
-- BUG: complete_cmms_payroll_payment() — the "pay this payroll entry" action
-- used for an ordinary payroll run (as opposed to the attendance check-out
-- pay-confirmation flow, or a salary advance) — never wrote anything to
-- ican_coin_transactions for a 'cash' payment. A wallet ('ican') payment
-- already has a real ledger row from the wallet transfer the client executes
-- before calling this function, but cash never touches the wallet — so a
-- cash-paid payroll run was invisible on both the employee's personal
-- transaction history and the business's transaction feed. This was the one
-- remaining salary-payment path that never got the same single-row cash echo
-- already applied to cmms_settle_attendance_pay (attendance-checkout cash
-- salary, CMMS_PAYDAY_ADVISORY_NOTIFICATIONS.sql), pay_salary_advance
-- (CMMS_SALARY_ADVANCE_CASH_TRANSACTION_RECORD.sql), and cash reward-point
-- redemptions (cmms_pay_reward_redemption). See any of those functions' long
-- comment for why each field below (sender_user_id NULL, explicit
-- counterparty_type/expense_classification, source_app 'ican', reference_id
-- tying back to the row of truth) is set the way it is.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_cmms_payroll_payment(p_payroll_entry_id UUID, p_payment_method TEXT, p_wallet_transaction_id TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.cmms_payroll_employee_approvals;
  v_entry public.business_payroll_entries;
  v_cmms_company_id UUID;
  v_currency TEXT;
  v_employee_name TEXT;
  v_business_name TEXT;
  v_coin_price NUMERIC;
  v_cash_ican_amount NUMERIC(18,8);
BEGIN
  SELECT * INTO v_entry FROM public.business_payroll_entries WHERE id = p_payroll_entry_id FOR UPDATE;
  IF NOT public.ican_business_admin(v_entry.business_profile_id) THEN RAISE EXCEPTION 'You cannot complete this payroll payment'; END IF;
  SELECT * INTO v_request FROM public.cmms_payroll_employee_approvals WHERE payroll_entry_id = p_payroll_entry_id FOR UPDATE;
  IF v_request.status <> 'approved' THEN RAISE EXCEPTION 'Employee approval is required before salary payment'; END IF;
  IF p_payment_method NOT IN ('cash', 'ican') THEN RAISE EXCEPTION 'Invalid payment method'; END IF;
  UPDATE public.business_payroll_entries SET status = 'paid', metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('payment_method', p_payment_method, 'wallet_transaction_id', p_wallet_transaction_id, 'paid_at', now()), updated_at = now() WHERE id = p_payroll_entry_id;
  UPDATE public.cmms_payroll_employee_approvals SET status = 'paid', payment_method = p_payment_method, wallet_transaction_id = p_wallet_transaction_id, paid_at = now() WHERE id = v_request.id;

  SELECT id INTO v_cmms_company_id FROM public.cmms_company_profiles WHERE pichin_business_profile_id = v_entry.business_profile_id LIMIT 1;
  v_currency := COALESCE(NULLIF(v_entry.metadata->>'currency', ''), v_request.currency, 'UGX');

  IF lower(p_payment_method) = 'cash' AND NOT EXISTS (
    SELECT 1 FROM public.ican_coin_transactions
     WHERE reference_id = v_entry.id::TEXT AND note LIKE 'Salary (%'
  ) THEN
    SELECT COALESCE(full_name, user_name) INTO v_employee_name
      FROM public.cmms_users
     WHERE cmms_company_id = v_cmms_company_id AND ican_user_id = v_entry.employee_user_id
     LIMIT 1;

    SELECT business_name INTO v_business_name FROM public.business_profiles WHERE id = v_entry.business_profile_id;

    SELECT price_local INTO v_coin_price
      FROM public.ican_get_price_in_currency(upper(COALESCE(v_currency, 'UGX')))
     LIMIT 1;
    v_cash_ican_amount := GREATEST(ROUND(v_entry.net_amount / COALESCE(NULLIF(v_coin_price, 0), 5000), 8), 0.00000001);

    INSERT INTO public.ican_coin_transactions
      (recipient_user_id, ican_amount, type, transaction_type, source_app, status,
       local_amount, local_currency, reference_id, note, business_profile_id,
       merchant_name, counterparty_type, expense_classification)
    VALUES (
      v_entry.employee_user_id, v_cash_ican_amount, 'transfer_out', 'transfer_out', 'ican', 'completed',
      v_entry.net_amount, v_currency, v_entry.id::TEXT,
      'Salary (' || COALESCE(v_employee_name, 'Employee') || ')',
      v_entry.business_profile_id, v_business_name, 'business', 'business_expense'
    );
  END IF;

  IF v_cmms_company_id IS NOT NULL THEN
    PERFORM public.cmms_queue_payday_advisory(
      v_cmms_company_id, v_entry.employee_user_id, v_entry.net_amount, v_currency, 'payroll_run', p_payroll_entry_id
    );
  END IF;

  RETURN TRUE;
END; $$;

REVOKE ALL ON FUNCTION public.complete_cmms_payroll_payment(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_cmms_payroll_payment(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- BACKFILL: covers every salary payment path in one sweep. The fix above
-- only changes complete_cmms_payroll_payment() going forward, and
-- cmms_settle_attendance_pay's own fix (CMMS_PAYDAY_ADVISORY_NOTIFICATIONS.sql)
-- had the same limitation — any payroll entry (from either a normal payroll
-- run or an attendance check-out) that was already marked 'paid' in cash
-- before its fix ran had the payment function execute under the old buggy
-- code, so it will never get a ledger row on its own. Sweep every cash-paid,
-- 'paid' business_payroll_entries row (regardless of which flow produced it)
-- and backfill the missing echo once, guarded by the same NOT EXISTS check
-- the functions themselves use.
-- ============================================================================
DO $$
DECLARE
  v_entry RECORD;
  v_cmms_company_id UUID;
  v_employee_name TEXT;
  v_business_name TEXT;
  v_currency TEXT;
  v_coin_price NUMERIC;
  v_cash_ican_amount NUMERIC(18,8);
BEGIN
  FOR v_entry IN
    SELECT * FROM public.business_payroll_entries
     WHERE status = 'paid'
       AND lower(COALESCE(metadata->>'payment_method', '')) = 'cash'
       AND NOT EXISTS (
         SELECT 1 FROM public.ican_coin_transactions
          WHERE reference_id = business_payroll_entries.id::TEXT AND note LIKE 'Salary (%'
       )
  LOOP
    SELECT id INTO v_cmms_company_id
      FROM public.cmms_company_profiles WHERE pichin_business_profile_id = v_entry.business_profile_id LIMIT 1;
    v_currency := COALESCE(NULLIF(v_entry.metadata->>'currency', ''), 'UGX');

    SELECT COALESCE(full_name, user_name) INTO v_employee_name
      FROM public.cmms_users
     WHERE cmms_company_id = v_cmms_company_id AND ican_user_id = v_entry.employee_user_id
     LIMIT 1;

    SELECT business_name INTO v_business_name FROM public.business_profiles WHERE id = v_entry.business_profile_id;

    SELECT price_local INTO v_coin_price
      FROM public.ican_get_price_in_currency(upper(v_currency))
     LIMIT 1;
    v_cash_ican_amount := GREATEST(ROUND(v_entry.net_amount / COALESCE(NULLIF(v_coin_price, 0), 5000), 8), 0.00000001);

    INSERT INTO public.ican_coin_transactions
      (recipient_user_id, ican_amount, type, transaction_type, source_app, status,
       local_amount, local_currency, reference_id, note, business_profile_id,
       merchant_name, counterparty_type, expense_classification, created_at)
    VALUES (
      v_entry.employee_user_id, v_cash_ican_amount, 'transfer_out', 'transfer_out', 'ican', 'completed',
      v_entry.net_amount, v_currency, v_entry.id::TEXT,
      'Salary (' || COALESCE(v_employee_name, 'Employee') || ')',
      v_entry.business_profile_id, v_business_name, 'business', 'business_expense',
      COALESCE(NULLIF(v_entry.metadata->>'paid_at', '')::timestamptz, v_entry.updated_at)
    );
  END LOOP;
END;
$$;

SELECT 'complete_cmms_payroll_payment now records a cash transaction in the ledger, and existing cash payroll entries were backfilled' AS status;
