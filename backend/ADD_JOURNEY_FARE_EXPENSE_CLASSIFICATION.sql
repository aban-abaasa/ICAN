-- ============================================================================
-- mbg_debit_journey_fare never let a caller say whether the fare being paid
-- is a personal or business expense — every journey/ride/delivery fare debit
-- landed with expense_classification defaulted to 'person_transfer'
-- (ican_coin_transactions' own column default), regardless of what the
-- customer actually intended. For a mybodaguy store delivery this produced a
-- confusing split: the goods leg was hardcoded 'business_expense' (tagged to
-- the store) while the fare leg silently fell back to personal — so ONE
-- delivery order showed up under BOTH the "Business" and "Personal" sections
-- of the customer's own ICANera Wallet transaction history, instead of one
-- side the customer actually chose.
--
-- Adds one new trailing, defaulted param — every existing caller (mybodaguy
-- ride/delivery completion, journey booking, etc.) keeps working unchanged
-- with expense_classification left NULL (falls through to the column's own
-- default exactly as before). The old 4-arg overload is dropped first so
-- PostgREST's RPC resolution never has two compatible overloads to choose
-- between (same precedent as ADD_RIDER_CONFIRMED_PAYMENT_METHOD_AT_COMPLETION.sql
-- in mybodaguy).
--
-- Run after CREATE_JOURNEY_ESCROW_FUNCTION.sql and
-- ICAN_TRANSACTION_CONTEXT_MIGRATION.sql (adds expense_classification).
-- ============================================================================

DROP FUNCTION IF EXISTS mbg_debit_journey_fare(UUID, DECIMAL, TEXT, TEXT);

CREATE OR REPLACE FUNCTION mbg_debit_journey_fare(
  p_user_id      UUID,
  p_ican_amount  DECIMAL,
  p_source_app   TEXT    DEFAULT 'mybodaguy',
  p_reference_id TEXT    DEFAULT NULL,
  p_expense_classification TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_bal DECIMAL;
  v_actor_role  TEXT;
  v_tx_id       UUID;
BEGIN
  IF p_ican_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  IF p_source_app NOT IN ('ican','digital-city-era','farm-agent','mybodaguy') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid source_app');
  END IF;

  IF p_expense_classification IS NOT NULL
     AND p_expense_classification NOT IN ('personal_expense', 'business_expense') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid expense_classification');
  END IF;

  SELECT ican_balance INTO v_current_bal
  FROM ican_user_wallets WHERE user_id = p_user_id FOR UPDATE;

  IF v_current_bal IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
  END IF;

  IF v_current_bal < p_ican_amount THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('Insufficient ICAN. Have: %s, Need: %s', v_current_bal, p_ican_amount));
  END IF;

  v_actor_role := ican_resolve_caller_role();

  -- Debit the full fare — no tithe.
  UPDATE ican_user_wallets
  SET ican_balance = ican_balance - p_ican_amount,
      total_spent  = total_spent  + p_ican_amount
  WHERE user_id = p_user_id;

  -- COALESCE to the column's own prior default ('person_transfer') rather
  -- than inserting NULL when the caller omits this param — an explicit NULL
  -- in the INSERT list overrides the column DEFAULT, which would silently
  -- change behavior for every pre-existing caller that never passed this.
  INSERT INTO ican_coin_transactions
    (sender_user_id, ican_amount, transaction_type,
     source_app, reference_id, note, actor_role, expense_classification)
  VALUES
    (p_user_id, p_ican_amount, 'journey_payment',
     p_source_app,
     p_reference_id,
     format('Paid %s ICAN for journey (ref: %s)', p_ican_amount::TEXT, coalesce(p_reference_id, '-')),
     v_actor_role,
     COALESCE(p_expense_classification, 'person_transfer'))
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object(
    'success',      true,
    'tx_id',        v_tx_id,
    'ican_debited', p_ican_amount,
    'actor_role',   v_actor_role
  );
END;
$$;

SELECT 'mbg_debit_journey_fare now accepts an optional expense_classification' AS status, now() AS run_at;
