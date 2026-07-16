-- ===========================================================================
-- ICAN FLUTTERWAVE PAYOUT MIGRATION
-- Adds real "send outside the app" cash-out: debits the shared ican_user_wallets
-- balance and disburses UGX to the user's mobile money or bank account via the
-- Flutterwave Transfers API.
--
-- Run after ICAN_CROSS_APP_WALLET_MIGRATION.sql and
-- ICAN_BUY_SELL_COINS_ADDENDUM.sql (both idempotent, both required —
-- this migration reuses sell_ican_coins() to perform the debit).
-- Works from all four apps via source_app.
-- ===========================================================================


-- ───────────────────────────────────────────────────────────────────────────
-- SECTION 1: PAYOUT REQUEST TABLE
-- One row per cash-out attempt. destination holds only what's needed to route
-- the Flutterwave transfer (phone number or bank account) — never card data.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ican_payout_requests (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sell_tx_id              UUID NOT NULL REFERENCES ican_coin_transactions(id),
  ican_amount             DECIMAL(18, 8) NOT NULL CHECK (ican_amount > 0),
  ugx_gross               DECIMAL(18, 2) NOT NULL,
  fee_ugx                 DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ugx_net                 DECIMAL(18, 2) NOT NULL,
  channel                 TEXT NOT NULL CHECK (channel IN ('mobilemoneyuganda', 'bank')),
  destination             JSONB NOT NULL,
  source_app              TEXT NOT NULL CHECK (source_app IN (
                            'ican', 'digital-city-era', 'farm-agent', 'mybodaguy'
                          )),
  status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                            'pending', 'processing', 'completed', 'failed'
                          )),
  flutterwave_reference   TEXT UNIQUE NOT NULL,
  flutterwave_transfer_id TEXT,
  failure_reason          TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ican_payout_user_id    ON ican_payout_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_ican_payout_status      ON ican_payout_requests(status);
CREATE INDEX IF NOT EXISTS idx_ican_payout_reference   ON ican_payout_requests(flutterwave_reference);
CREATE INDEX IF NOT EXISTS idx_ican_payout_created     ON ican_payout_requests(created_at DESC);

DROP TRIGGER IF EXISTS ican_payout_updated_at ON ican_payout_requests;
CREATE TRIGGER ican_payout_updated_at
  BEFORE UPDATE ON ican_payout_requests
  FOR EACH ROW EXECUTE FUNCTION _ican_set_updated_at();


-- ───────────────────────────────────────────────────────────────────────────
-- SECTION 2: ROW-LEVEL SECURITY
-- Owners can read their own payout requests. There is deliberately no INSERT
-- or UPDATE policy for authenticated users — rows are only ever written by
-- the SECURITY DEFINER functions below (request_ican_payout /
-- resolve_ican_payout), which run with elevated privilege and bypass RLS,
-- same pattern as every other write path in the ICAN wallet system.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE ican_payout_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payout_owner_read" ON ican_payout_requests;
CREATE POLICY "payout_owner_read" ON ican_payout_requests
  FOR SELECT USING (auth.uid() = user_id);

-- mybodaguy developer / dce admin-dashboard style oversight, matching the
-- existing "any authenticated user can read" policies on the wallet tables.
DROP POLICY IF EXISTS "payout_elevated_read" ON ican_payout_requests;
CREATE POLICY "payout_elevated_read" ON ican_payout_requests
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users mu
      WHERE mu.id = auth.uid() AND mu.role_type = 'developer' AND mu.is_active = TRUE
    )
  );


-- ───────────────────────────────────────────────────────────────────────────
-- SECTION 3: REQUEST A PAYOUT
-- Debits the wallet via sell_ican_coins() (reusing its balance lock + audit
-- trail) and opens a payout request row. Returns immediately with a
-- reference; the Edge Function that calls this is responsible for actually
-- initiating the Flutterwave transfer right after, and for reversing this
-- debit via resolve_ican_payout(success:=false) if that call fails.
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

  -- Debit the wallet using the existing, audited sell path. This locks the
  -- wallet row, validates balance, and records the 'sell' transaction —
  -- request_ican_payout does not duplicate that logic.
  v_reference := 'PAYOUT-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' ||
                 upper(substr(md5(gen_random_uuid()::text), 1, 8));

  v_sell_result := sell_ican_coins(p_user_id, p_ican_amount, p_source_app, v_reference);

  IF NOT (v_sell_result->>'success')::boolean THEN
    RETURN v_sell_result;
  END IF;

  v_sell_tx_id := (v_sell_result->>'tx_id')::UUID;
  v_ugx_gross  := (v_sell_result->>'ugx_payout')::DECIMAL;
  v_ugx_net    := v_ugx_gross - p_fee_ugx;

  -- sell_ican_coins() inserts with the table's default status ('completed'),
  -- but the payout hasn't actually landed yet — hold it at 'pending' until
  -- resolve_ican_payout() confirms or fails it.
  UPDATE ican_coin_transactions SET status = 'pending' WHERE id = v_sell_tx_id;

  IF v_ugx_net <= 0 THEN
    -- Refund immediately — fee would exceed the payout.
    PERFORM credit_ican_earning(p_user_id, p_ican_amount, p_source_app,
      'Refund: payout fee exceeded amount', v_reference);
    RETURN jsonb_build_object('success', false, 'error', 'Fee exceeds payout amount');
  END IF;

  INSERT INTO ican_payout_requests
    (user_id, sell_tx_id, ican_amount, ugx_gross, fee_ugx, ugx_net,
     channel, destination, source_app, status, flutterwave_reference)
  VALUES
    (p_user_id, v_sell_tx_id, p_ican_amount, v_ugx_gross, p_fee_ugx, v_ugx_net,
     p_channel, p_destination, p_source_app, 'pending', v_reference)
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'success',    true,
    'request_id', v_request_id,
    'sell_tx_id', v_sell_tx_id,
    'reference',  v_reference,
    'ugx_gross',  v_ugx_gross,
    'fee_ugx',    p_fee_ugx,
    'ugx_net',    v_ugx_net
  );
END;
$$;

-- Restricted to service_role: the calling Edge Function resolves p_user_id
-- from the caller's own access token (never trusts a client-supplied user
-- id) before invoking this RPC with the service role key. Not exposed to
-- authenticated/anon so it can't be called directly with an arbitrary
-- p_user_id.
REVOKE ALL ON FUNCTION request_ican_payout FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_ican_payout TO service_role;


-- ───────────────────────────────────────────────────────────────────────────
-- SECTION 4: MARK A PAYOUT AS SUBMITTED TO FLUTTERWAVE
-- Called right after the Transfers API accepts the request (HTTP 200,
-- status "NEW"). Purely a status/bookkeeping update — no money movement.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION mark_ican_payout_processing(
  p_reference             TEXT,
  p_flutterwave_transfer_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE ican_payout_requests
  SET status = 'processing',
      flutterwave_transfer_id = p_flutterwave_transfer_id
  WHERE flutterwave_reference = p_reference
    AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payout request not found or not pending');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION mark_ican_payout_processing FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_ican_payout_processing TO service_role;


-- ───────────────────────────────────────────────────────────────────────────
-- SECTION 5: RESOLVE A PAYOUT (SUCCESS OR FAILURE)
-- On success: marks the payout + its sell transaction completed.
-- On failure: refunds the user's wallet (credit_ican_earning, no tithe on a
-- refund would be wrong — see note) and marks both records failed.
-- Restricted to service_role: this is the only path that can move money
-- back into a wallet after a debit, so it must never be reachable with a
-- user's own JWT, only from the webhook/Edge Function holding the service
-- role key.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION resolve_ican_payout(
  p_reference               TEXT,
  p_success                 BOOLEAN,
  p_flutterwave_transfer_id TEXT DEFAULT NULL,
  p_failure_reason          TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_request ican_payout_requests;
BEGIN
  SELECT * INTO v_request
  FROM ican_payout_requests
  WHERE flutterwave_reference = p_reference
    AND status IN ('pending', 'processing')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payout request not found or already resolved');
  END IF;

  IF p_success THEN
    UPDATE ican_payout_requests
    SET status = 'completed',
        flutterwave_transfer_id = COALESCE(p_flutterwave_transfer_id, flutterwave_transfer_id)
    WHERE id = v_request.id;

    UPDATE ican_coin_transactions
    SET status = 'completed'
    WHERE id = v_request.sell_tx_id;

    RETURN jsonb_build_object('success', true, 'request_id', v_request.id, 'status', 'completed');
  ELSE
    UPDATE ican_payout_requests
    SET status = 'failed',
        failure_reason = p_failure_reason
    WHERE id = v_request.id;

    UPDATE ican_coin_transactions
    SET status = 'failed'
    WHERE id = v_request.sell_tx_id;

    -- Refund the debited ICAN in full — this reverses sell_ican_coins(), so
    -- it must not go through credit_ican_earning() (which would apply a 10%
    -- tithe on money the user never actually received).
    PERFORM get_or_create_ican_wallet(v_request.user_id);

    UPDATE ican_user_wallets
    SET ican_balance = ican_balance + v_request.ican_amount,
        total_spent  = total_spent  - v_request.ican_amount
    WHERE user_id = v_request.user_id;

    INSERT INTO ican_coin_transactions
      (recipient_user_id, ican_amount, transaction_type, source_app,
       reference_id, note, status)
    VALUES
      (v_request.user_id, v_request.ican_amount, 'refund', v_request.source_app,
       p_reference, format('Payout failed, refunded: %s', coalesce(p_failure_reason, 'unknown error')),
       'completed');

    RETURN jsonb_build_object('success', true, 'request_id', v_request.id, 'status', 'failed', 'refunded', true);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION resolve_ican_payout FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_ican_payout TO service_role;


-- ───────────────────────────────────────────────────────────────────────────
-- SECTION 6: VIEW — payout history for a user's wallet page
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW ican_payout_history AS
SELECT
  p.id,
  p.user_id,
  p.ican_amount,
  p.ugx_gross,
  p.fee_ugx,
  p.ugx_net,
  p.channel,
  p.destination,
  p.source_app,
  p.status,
  p.failure_reason,
  p.created_at,
  p.updated_at
FROM ican_payout_requests p;


-- ───────────────────────────────────────────────────────────────────────────
-- DONE
-- ───────────────────────────────────────────────────────────────────────────

SELECT
  'ICAN Flutterwave Payout Migration — complete' AS status,
  now() AS run_at;
