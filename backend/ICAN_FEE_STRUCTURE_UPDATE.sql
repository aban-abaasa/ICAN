-- ===========================================================================
-- ICAN FEE STRUCTURE UPDATE
-- Changes the platform's fee model:
--   • Sending ICAN to another wallet (transfer_ican)      : 0% (was 10% tithe)
--   • Selling ICAN back — any channel, including payouts   : 3% platform fee
--     to mobile money / bank via request_ican_payout (was 0%, and payouts
--     separately charged 1.5%/2.5% on top — that extra charge is removed;
--     3% is now the single, uniform cash-out fee everywhere)
--
-- Run after ICAN_CROSS_APP_WALLET_MIGRATION.sql, ICAN_BUY_SELL_COINS_ADDENDUM.sql,
-- and ICAN_FLUTTERWAVE_PAYOUT_MIGRATION.sql (all idempotent).
--
-- credit_ican_earning() (cashback, delivery pay, produce sales, agent
-- commissions, dividends, etc.) is UNCHANGED — earnings still tithe 10%.
-- Only the peer-to-peer send and the sell/cash-out paths change here.
-- ===========================================================================


-- ───────────────────────────────────────────────────────────────────────────
-- 1. transfer_ican — 0% fee. Recipient now gets the full amount sent; no
--    tithe transaction is recorded (a 0-amount row would violate
--    ican_coin_transactions' CHECK (ican_amount > 0), so it's skipped
--    entirely rather than inserted as zero).
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION transfer_ican(
  p_from_user    UUID,
  p_to_user      UUID,
  p_amount       DECIMAL,
  p_note         TEXT    DEFAULT '',
  p_source_app   TEXT    DEFAULT 'ican',
  p_reference_id TEXT    DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_from_balance DECIMAL;
  v_actor_role   TEXT;
  v_out_tx_id    UUID;
  v_in_tx_id     UUID;
BEGIN
  IF p_source_app NOT IN ('ican','digital-city-era','farm-agent','mybodaguy') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid source_app');
  END IF;

  SELECT ican_balance INTO v_from_balance
  FROM ican_user_wallets WHERE user_id = p_from_user FOR UPDATE;

  IF v_from_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sender wallet not found. Call get_or_create_ican_wallet first.');
  END IF;

  IF v_from_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('Insufficient ICAN balance. Have: %s, Need: %s', v_from_balance, p_amount));
  END IF;

  v_actor_role := ican_resolve_caller_role();

  -- Debit sender
  UPDATE ican_user_wallets
  SET ican_balance = ican_balance - p_amount,
      total_spent  = total_spent  + p_amount
  WHERE user_id = p_from_user;

  -- Ensure recipient wallet exists
  PERFORM get_or_create_ican_wallet(p_to_user);

  -- Credit recipient — full amount, no tithe
  UPDATE ican_user_wallets
  SET ican_balance = ican_balance + p_amount,
      total_earned = total_earned + p_amount
  WHERE user_id = p_to_user;

  -- Record transfer_out
  INSERT INTO ican_coin_transactions
    (sender_user_id, recipient_user_id, ican_amount,
     transaction_type, source_app, reference_id, note, actor_role)
  VALUES
    (p_from_user, p_to_user, p_amount,
     'transfer_out', p_source_app, p_reference_id, p_note, v_actor_role)
  RETURNING id INTO v_out_tx_id;

  -- Record transfer_in (full amount, no tithe deduction)
  INSERT INTO ican_coin_transactions
    (sender_user_id, recipient_user_id, ican_amount,
     transaction_type, source_app, reference_id, note, actor_role)
  VALUES
    (p_from_user, p_to_user, p_amount,
     'transfer_in', p_source_app, p_reference_id, p_note, v_actor_role)
  RETURNING id INTO v_in_tx_id;

  RETURN jsonb_build_object(
    'success',            true,
    'out_tx_id',          v_out_tx_id,
    'in_tx_id',           v_in_tx_id,
    'amount_sent',        p_amount,
    'tithe_deducted',     0,
    'recipient_received', p_amount,
    'actor_role',         v_actor_role
  );
END;
$$;


-- ───────────────────────────────────────────────────────────────────────────
-- 2. sell_ican_coins — bakes in a flat 3% platform fee on the UGX payout.
--    The ICAN debited is unchanged (the seller still gives up the full
--    amount they chose to sell); the fee reduces what they're paid, same as
--    any cash-out fee. Returns ugx_gross / fee_ugx / ugx_payout (net) so
--    every caller (offline "Sell" UI, request_ican_payout) can show the
--    breakdown.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sell_ican_coins(
  p_user_id     UUID,
  p_ican_amount DECIMAL,
  p_source_app  TEXT    DEFAULT 'ican',
  p_reference   TEXT    DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_bal DECIMAL;
  v_ugx_gross   DECIMAL;
  v_fee         DECIMAL;
  v_ugx_net     DECIMAL;
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

  v_ugx_gross  := ROUND(p_ican_amount * 5000, 2);
  v_fee        := ROUND(v_ugx_gross * 0.03, 2);
  v_ugx_net    := v_ugx_gross - v_fee;
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
     format('Sold %s ICAN for UGX %s net of 3%% fee (gross UGX %s, fee UGX %s, ref: %s)',
            p_ican_amount::TEXT, v_ugx_net::TEXT, v_ugx_gross::TEXT, v_fee::TEXT, coalesce(p_reference, '-')),
     v_actor_role)
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object(
    'success',    true,
    'tx_id',      v_tx_id,
    'ican_sold',  p_ican_amount,
    'ugx_gross',  v_ugx_gross,
    'fee_ugx',    v_fee,
    'ugx_payout', v_ugx_net,
    'actor_role', v_actor_role
  );
END;
$$;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. request_ican_payout — reads the gross/fee/net breakdown from the
--    updated sell_ican_coins() instead of computing its own extra fee on
--    top. p_fee_ugx is kept only as an optional additional charge (defaults
--    to 0) rather than the primary fee mechanism — the 3% is now intrinsic
--    to sell_ican_coins itself, so the same fee applies whether the coin is
--    sold via the offline "Sell" UI or an automated Flutterwave payout.
--    Also fixes a bug in the "fee exceeds amount" refund path: it used to
--    call credit_ican_earning(), which would have wrongly applied a 10%
--    tithe to money the user never actually received.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION request_ican_payout(
  p_user_id       UUID,
  p_ican_amount   DECIMAL,
  p_channel       TEXT,
  p_destination   JSONB,
  p_source_app    TEXT,
  p_fee_ugx       DECIMAL DEFAULT 0
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sell_result JSONB;
  v_sell_tx_id  UUID;
  v_ugx_gross   DECIMAL;
  v_sell_fee    DECIMAL;
  v_ugx_net     DECIMAL;
  v_reference   TEXT;
  v_request_id  UUID;
BEGIN
  IF p_channel NOT IN ('mobilemoneyuganda', 'bank') THEN
    RETURN jsonb_build_object('success', false, 'error', 'channel must be mobilemoneyuganda or bank');
  END IF;

  IF p_destination IS NULL OR p_destination = '{}'::jsonb THEN
    RETURN jsonb_build_object('success', false, 'error', 'destination is required');
  END IF;

  v_reference := 'PAYOUT-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' ||
                 upper(substr(md5(gen_random_uuid()::text), 1, 8));

  -- sell_ican_coins() now bakes in the 3% platform fee itself.
  v_sell_result := sell_ican_coins(p_user_id, p_ican_amount, p_source_app, v_reference);

  IF NOT (v_sell_result->>'success')::boolean THEN
    RETURN v_sell_result;
  END IF;

  v_sell_tx_id := (v_sell_result->>'tx_id')::UUID;
  v_ugx_gross  := (v_sell_result->>'ugx_gross')::DECIMAL;
  v_sell_fee   := (v_sell_result->>'fee_ugx')::DECIMAL;
  v_ugx_net    := (v_sell_result->>'ugx_payout')::DECIMAL - COALESCE(p_fee_ugx, 0);

  UPDATE ican_coin_transactions SET status = 'pending' WHERE id = v_sell_tx_id;

  IF v_ugx_net <= 0 THEN
    -- Refund directly (no tithe) — this reverses the debit sell_ican_coins()
    -- just made, so it must not go through credit_ican_earning().
    PERFORM get_or_create_ican_wallet(p_user_id);
    UPDATE ican_user_wallets
    SET ican_balance = ican_balance + p_ican_amount,
        total_spent  = total_spent  - p_ican_amount
    WHERE user_id = p_user_id;
    UPDATE ican_coin_transactions SET status = 'failed' WHERE id = v_sell_tx_id;
    INSERT INTO ican_coin_transactions
      (recipient_user_id, ican_amount, transaction_type, source_app, reference_id, note, status)
    VALUES
      (p_user_id, p_ican_amount, 'refund', p_source_app, v_reference,
       'Refund: fee exceeded payout amount', 'completed');
    RETURN jsonb_build_object('success', false, 'error', 'Fee exceeds payout amount');
  END IF;

  INSERT INTO ican_payout_requests
    (user_id, sell_tx_id, ican_amount, ugx_gross, fee_ugx, ugx_net,
     channel, destination, source_app, status, flutterwave_reference)
  VALUES
    (p_user_id, v_sell_tx_id, p_ican_amount, v_ugx_gross, v_sell_fee + COALESCE(p_fee_ugx, 0), v_ugx_net,
     p_channel, p_destination, p_source_app, 'pending', v_reference)
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'success',    true,
    'request_id', v_request_id,
    'sell_tx_id', v_sell_tx_id,
    'reference',  v_reference,
    'ugx_gross',  v_ugx_gross,
    'fee_ugx',    v_sell_fee + COALESCE(p_fee_ugx, 0),
    'ugx_net',    v_ugx_net
  );
END;
$$;

REVOKE ALL ON FUNCTION request_ican_payout FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_ican_payout TO service_role;


-- ───────────────────────────────────────────────────────────────────────────
-- DONE
-- ───────────────────────────────────────────────────────────────────────────

SELECT
  'ICAN Fee Structure Update — complete (0% send, 3% sell/payout)' AS status,
  now() AS run_at;
