-- ============================================================================
-- CMMS "MY SALARY" TAB — smarter attendance + IcanEra wallet ledger
-- Run after CMMS_ATTENDANCE_SUMMARY_AND_MANUAL_CHECKIN.sql,
-- CMMS_SALARY_ADVANCE_REQUESTS.sql, and ICAN_BUSINESS_WALLET_TRANSFERS.sql.
--
-- CONTEXT: "My salary and attendance" (CMMSEmployeeSelfService.jsx, mode=
-- 'payroll') only ever showed a bare count of recent check-ins and the
-- abstract business_payroll_entries rows — never the actual daily
-- check-in/check-out times, a days-present-this-month count, or the
-- on-chain IcanEra wallet transactions that back a salary/advance payment.
-- Those wallet legs already exist (pay_salary_advance and ordinary payroll
-- wallet runs both go through pitchin_business_wallet_transfer, which writes
-- ican_coin_transactions tagged with business_profile_id), the employee just
-- had no read path to them from the CMMS side.
--
-- get_attendance_summary() (see CMMS_ATTENDANCE_SUMMARY_AND_MANUAL_CHECKIN.sql)
-- already self-restricts a non-admin caller to their own rows and accepts a
-- date range, so the frontend can reuse it as-is for a "days this month"
-- count — no new SQL needed for that half.
--
-- This migration adds the other half: a self-scoped read of the IcanEra
-- wallet ledger entries tied to this employee's salary from this specific
-- company, so "My Salary" can show the real business-wallet-to-personal-
-- wallet transaction next to the payroll entry it settled, instead of just
-- the payroll entry's status.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_my_cmms_salary_wallet_transactions(
  p_cmms_company_id UUID,
  p_limit INT DEFAULT 30
)
RETURNS TABLE (
  id UUID,
  created_at TIMESTAMPTZ,
  direction TEXT,
  ican_amount NUMERIC,
  local_amount NUMERIC,
  local_currency TEXT,
  transaction_type TEXT,
  status TEXT,
  note TEXT,
  reference_id TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_profile_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required to view your wallet transactions';
  END IF;

  IF NOT public.cmms_active_staff(p_cmms_company_id) THEN
    RAISE EXCEPTION 'You are not an active member of this company';
  END IF;

  SELECT pichin_business_profile_id INTO v_business_profile_id
    FROM public.cmms_company_profiles
   WHERE id = p_cmms_company_id;
  IF v_business_profile_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT tx.id,
         tx.created_at,
         CASE WHEN tx.recipient_user_id = auth.uid() THEN 'received' ELSE 'sent' END AS direction,
         tx.ican_amount,
         tx.local_amount,
         tx.local_currency,
         tx.transaction_type,
         tx.status,
         tx.note,
         tx.reference_id
    FROM public.ican_coin_transactions tx
   WHERE tx.business_profile_id = v_business_profile_id
     AND (tx.sender_user_id = auth.uid() OR tx.recipient_user_id = auth.uid())
   ORDER BY tx.created_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 30), 200));
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_cmms_salary_wallet_transactions(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_cmms_salary_wallet_transactions(UUID, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
