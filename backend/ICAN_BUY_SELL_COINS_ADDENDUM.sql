-- ===========================================================================
-- ICAN BUY / SELL COINS ADDENDUM
-- Run after ICAN_CROSS_APP_WALLET_MIGRATION.sql (it is idempotent).
-- Adds direct coin-exchange functions used by all four apps:
--   buy_ican_coins  — user pays UGX (recorded notionally), receives ICAN
--   sell_ican_coins — user surrenders ICAN, receives UGX (recorded notionally)
-- ===========================================================================

-- ── extend transaction_type CHECK to include 'buy' and 'sell' ────────────────
DO $$ BEGIN
  -- Drop the old check constraint and recreate with the new values.
  -- (ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT is the portable approach.)
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
      'buy','sell'
    ));
END $$;


-- ── buy_ican_coins ────────────────────────────────────────────────────────────
-- Credits ICAN to the buyer's wallet.
-- p_ican_amount  : exact number of ICAN coins to purchase (e.g. 2.5)
-- p_source_app   : calling app identifier
-- p_payment_ref  : optional reference (receipt, mobile-money tx ID, etc.)
-- Returns JSONB with success, tx_id, ican_bought, ugx_paid, actor_role.
CREATE OR REPLACE FUNCTION buy_ican_coins(
  p_user_id      UUID,
  p_ican_amount  DECIMAL,
  p_source_app   TEXT    DEFAULT 'ican',
  p_payment_ref  TEXT    DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ugx_cost   DECIMAL;
  v_actor_role TEXT;
  v_tx_id      UUID;
BEGIN
  IF p_ican_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  IF p_source_app NOT IN ('ican','digital-city-era','farm-agent','mybodaguy') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid source_app');
  END IF;

  -- 1 ICAN = 5,000 UGX floor price
  v_ugx_cost   := ROUND(p_ican_amount * 5000, 2);
  v_actor_role := ican_resolve_caller_role();

  -- Ensure wallet exists
  PERFORM get_or_create_ican_wallet(p_user_id);

  -- Credit the purchased ICAN directly (no tithe on buy — user is paying full price)
  UPDATE ican_user_wallets
  SET ican_balance = ican_balance + p_ican_amount,
      total_earned = total_earned + p_ican_amount
  WHERE user_id = p_user_id;

  -- Record the buy transaction (recipient = buyer)
  INSERT INTO ican_coin_transactions
    (recipient_user_id, ican_amount, transaction_type,
     source_app, reference_id, note, actor_role)
  VALUES
    (p_user_id, p_ican_amount, 'buy',
     p_source_app,
     p_payment_ref,
     format('Bought %s ICAN for UGX %s (ref: %s)',
            p_ican_amount::TEXT, v_ugx_cost::TEXT, coalesce(p_payment_ref, '-')),
     v_actor_role)
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object(
    'success',     true,
    'tx_id',       v_tx_id,
    'ican_bought', p_ican_amount,
    'ugx_paid',    v_ugx_cost,
    'actor_role',  v_actor_role
  );
END;
$$;


-- ── sell_ican_coins ───────────────────────────────────────────────────────────
-- Debits ICAN from the seller's wallet.
-- The matching UGX payout is handled offline (cashier/admin hands over cash).
-- p_ican_amount : exact number of ICAN coins to sell
-- p_source_app  : calling app identifier
-- p_reference   : optional reference (cashier ID, payout request ID, etc.)
CREATE OR REPLACE FUNCTION sell_ican_coins(
  p_user_id     UUID,
  p_ican_amount DECIMAL,
  p_source_app  TEXT    DEFAULT 'ican',
  p_reference   TEXT    DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_bal DECIMAL;
  v_ugx_payout  DECIMAL;
  v_actor_role  TEXT;
  v_tx_id       UUID;
BEGIN
  IF p_ican_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  IF p_source_app NOT IN ('ican','digital-city-era','farm-agent','mybodaguy') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid source_app');
  END IF;

  -- Lock and check balance
  SELECT ican_balance INTO v_current_bal
  FROM ican_user_wallets WHERE user_id = p_user_id FOR UPDATE;

  IF v_current_bal IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
  END IF;

  IF v_current_bal < p_ican_amount THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('Insufficient ICAN. Have: %s, Need: %s', v_current_bal, p_ican_amount));
  END IF;

  v_ugx_payout := ROUND(p_ican_amount * 5000, 2);
  v_actor_role := ican_resolve_caller_role();

  -- Debit the sold ICAN
  UPDATE ican_user_wallets
  SET ican_balance = ican_balance - p_ican_amount,
      total_spent  = total_spent  + p_ican_amount
  WHERE user_id = p_user_id;

  -- Record the sell transaction (sender = seller)
  INSERT INTO ican_coin_transactions
    (sender_user_id, ican_amount, transaction_type,
     source_app, reference_id, note, actor_role)
  VALUES
    (p_user_id, p_ican_amount, 'sell',
     p_source_app,
     p_reference,
     format('Sold %s ICAN for UGX %s (ref: %s)',
            p_ican_amount::TEXT, v_ugx_payout::TEXT, coalesce(p_reference, '-')),
     v_actor_role)
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object(
    'success',    true,
    'tx_id',      v_tx_id,
    'ican_sold',  p_ican_amount,
    'ugx_payout', v_ugx_payout,
    'actor_role', v_actor_role
  );
END;
$$;


-- ── confirmation ─────────────────────────────────────────────────────────────
SELECT
  'ICAN Buy/Sell Coins Addendum — complete' AS status,
  now()                                     AS run_at;
