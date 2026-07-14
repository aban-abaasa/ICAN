-- ===========================================================================
-- mbg_credit_ride_earning — tithe-free ICAN credit for ride/commission
-- payouts (rider earnings, chairperson commissions, cash-settlement
-- commission collection).
--
-- Mirrors mbg_debit_journey_fare's reasoning (CREATE_JOURNEY_ESCROW_FUNCTION.sql):
-- transfer_ican() always takes a 10% tithe on the recipient side, correct
-- for a peer gift/transfer but wrong here — a rider being paid their fare
-- share, or a chairperson receiving their commission, is being paid wages
-- for a service rendered, not receiving a personal gift. Tithe is the
-- recipient's own personal choice (see feedback_tithe_is_personal), not
-- something the platform gets to skim off a wage payment before the
-- recipient ever sees it.
--
-- Run after ICAN_CROSS_APP_WALLET_MIGRATION.sql, ICAN_BUY_SELL_COINS_ADDENDUM.sql
-- and CREATE_JOURNEY_ESCROW_FUNCTION.sql (reuses the same transaction_type
-- CHECK list — 'earn' already exists there, no ALTER needed).
-- ===========================================================================

CREATE OR REPLACE FUNCTION mbg_credit_ride_earning(
  p_user_id      UUID,
  p_ican_amount  DECIMAL,
  p_source_app   TEXT    DEFAULT 'mybodaguy',
  p_reference_id TEXT    DEFAULT NULL,
  p_note         TEXT    DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_actor_role TEXT;
  v_tx_id      UUID;
BEGIN
  IF p_ican_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  IF p_source_app NOT IN ('ican','digital-city-era','farm-agent','mybodaguy') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid source_app');
  END IF;

  -- Recipient may never have bought/sold/received ICAN before (e.g. a
  -- chairperson's first-ever commission) — ensure a wallet row exists.
  PERFORM get_or_create_ican_wallet(p_user_id);

  UPDATE ican_user_wallets
  SET ican_balance = ican_balance + p_ican_amount,
      total_earned = total_earned + p_ican_amount
  WHERE user_id = p_user_id;

  v_actor_role := ican_resolve_caller_role();

  INSERT INTO ican_coin_transactions
    (recipient_user_id, ican_amount, transaction_type, source_app, reference_id, note, actor_role)
  VALUES
    (p_user_id, p_ican_amount, 'earn', p_source_app, p_reference_id,
     COALESCE(p_note, format('Earned %s ICAN (ref: %s)', p_ican_amount::TEXT, coalesce(p_reference_id, '-'))),
     v_actor_role)
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object(
    'success',      true,
    'tx_id',        v_tx_id,
    'ican_credited', p_ican_amount,
    'actor_role',   v_actor_role
  );
END;
$$;

SELECT 'mbg_credit_ride_earning ready' AS status, now() AS run_at;
