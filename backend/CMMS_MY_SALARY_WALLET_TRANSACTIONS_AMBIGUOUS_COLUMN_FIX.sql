-- ============================================================================
-- Fix: get_my_cmms_salary_wallet_transactions() always failed with
-- 'column reference "id" is ambiguous'.
-- Run after CMMS_MY_SALARY_ATTENDANCE_WALLET_LEDGER.sql.
--
-- BUG: this function's RETURNS TABLE names its first output column `id` —
-- the exact same name as the real `id` column on cmms_company_profiles. The
-- lookup `SELECT pichin_business_profile_id INTO v_business_profile_id FROM
-- cmms_company_profiles WHERE id = p_cmms_company_id` is a bare reference to
-- `id`, and PL/pgSQL's default #variable_conflict setting ('error') refuses
-- to guess between the table column and the RETURNS TABLE output column of
-- the same name — it raises "column reference \"id\" is ambiguous" instead.
-- That statement runs on every call, before the RETURN QUERY, so this
-- function has never once returned data — the wallet ledger on "My Salary"
-- has been failing with a 400 from day one.
--
-- Same gotcha, same fix as get_attendance_summary
-- (CMMS_ATTENDANCE_SUMMARY_AND_MANUAL_CHECKIN.sql) and
-- apply_salary_advance_recovery (CMMS_SALARY_ADVANCE_RECOVERY_AMBIGUOUS_COLUMN_FIX.sql):
-- #variable_conflict use_column tells PL/pgSQL to prefer the real table
-- column whenever a bare name collides with one of these output columns.
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
#variable_conflict use_column
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

SELECT 'get_my_cmms_salary_wallet_transactions no longer errors on ambiguous id' AS status;
