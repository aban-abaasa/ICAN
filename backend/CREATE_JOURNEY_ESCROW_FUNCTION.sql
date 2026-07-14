-- ===========================================================================
-- JOURNEY ESCROW FUNCTION (Phase 1 of BodaGo multi-leg journey booking)
-- Run after ICAN_CROSS_APP_WALLET_MIGRATION.sql and
-- ICAN_BUY_SELL_COINS_ADDENDUM.sql (both idempotent).
--
-- transfer_ican() always deducts a 10% tithe on the recipient side — correct
-- for peer transfers/earnings, but wrong here: the user explicitly said
-- tithe is a personal choice paid to one's own church, not a fee the
-- platform gets to skim off a paid service. A customer booking a journey
-- (boda + flight + destination pickup) is paying the exact fare for a
-- service rendered, the same relationship as buy_ican_coins/sell_ican_coins
-- (no tithe on buy — user is paying full price). mbg_debit_journey_fare is
-- modeled directly on sell_ican_coins for that reason.
-- ===========================================================================

-- ── extend transaction_type CHECK to include 'journey_payment' ──────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'ican_coin_transactions'
      AND constraint_type = 'CHECK'
      AND constraint_name LIKE '%transaction_type%'
  ) THEN
    ALTER TABLE ican_coin_transactions
      DROP CONSTRAINT IF EXISTS ican_coin_transactions_transaction_type_check;
  END IF;

  ALTER TABLE ican_coin_transactions
    ADD CONSTRAINT ican_coin_transactions_transaction_type_check
    CHECK (transaction_type IN (
      'earn','transfer_in','transfer_out','tithe',
      'cashback','purchase','sale','refund',
      'buy','sell','journey_payment'
    ));
END $$;


-- ── mbg_debit_journey_fare ────────────────────────────────────────────────────
-- Tithe-free debit for a booked journey. The matching fiat/Duffel-balance
-- settlement (airline leg) and rider payouts (local legs) happen separately
-- and are not part of this function — this only moves ICAN off the
-- customer's balance and records the transaction for audit, exactly like
-- sell_ican_coins does for a coin sale.
-- p_ican_amount : exact ICAN cost of the full journey (already computed by
--                 the caller from the local-pickup + flight + local-dropoff
--                 fare estimate)
-- p_reference_id : the mbg_journeys.id this payment is for
CREATE OR REPLACE FUNCTION mbg_debit_journey_fare(
  p_user_id      UUID,
  p_ican_amount  DECIMAL,
  p_source_app   TEXT    DEFAULT 'mybodaguy',
  p_reference_id TEXT    DEFAULT NULL
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

  INSERT INTO ican_coin_transactions
    (sender_user_id, ican_amount, transaction_type,
     source_app, reference_id, note, actor_role)
  VALUES
    (p_user_id, p_ican_amount, 'journey_payment',
     p_source_app,
     p_reference_id,
     format('Paid %s ICAN for journey (ref: %s)', p_ican_amount::TEXT, coalesce(p_reference_id, '-')),
     v_actor_role)
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object(
    'success',      true,
    'tx_id',        v_tx_id,
    'ican_debited', p_ican_amount,
    'actor_role',   v_actor_role
  );
END;
$$;


-- ── confirmation ─────────────────────────────────────────────────────────────
SELECT
  'ICAN Journey Escrow Function — complete' AS status,
  now()                                     AS run_at;
