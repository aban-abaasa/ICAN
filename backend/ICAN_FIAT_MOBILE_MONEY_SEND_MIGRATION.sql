-- ===========================================================================
-- ICAN FIAT MOBILE MONEY SEND MIGRATION
--
-- Fixes "Send Money -> Mobile Money" (handleSendViaMOMO in ICANWallet.jsx),
-- which previously debited the local-currency wallet_accounts balance and
-- then called momoService.processTransfer() -- a direct MTN MOMO API call
-- that never touched Flutterwave and had no way to confirm the money
-- actually reached a real account. That path is being replaced with the
-- same pattern already used for ICAN cash-out (see
-- ICAN_FLUTTERWAVE_PAYOUT_MIGRATION.sql / flutterwave-payout Edge Function):
-- debit atomically first, submit to the Flutterwave Transfers API, then let
-- flutterwave-transfer-webhook confirm or refund asynchronously once
-- Flutterwave reports the real, final outcome.
--
-- Flutterwave has no pre-transfer "resolve account name" endpoint for
-- Uganda mobile money (unlike Nigerian bank accounts), so a phone number
-- cannot be proven to belong to a named person before money moves. The
-- honest verification available here is: the sender explicitly confirms
-- the phone number + network before submitting, and the Transfers API
-- itself is the source of truth for whether a real, reachable mobile
-- money account received the funds -- if Flutterwave rejects or fails the
-- transfer, this migration refunds the sender automatically.
--
-- Safe to run multiple times.
-- ===========================================================================


-- ───────────────────────────────────────────────────────────────────────────
-- SECTION 1: SEND REQUEST TABLE
-- One row per outgoing fiat-to-mobile-money send. destination-identifying
-- fields only (phone + network) -- never card or PIN data.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ican_fiat_send_requests (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount                  DECIMAL(15, 2) NOT NULL CHECK (amount > 0),
  fee                     DECIMAL(15, 2) NOT NULL DEFAULT 0,
  net_amount              DECIMAL(15, 2) NOT NULL,
  currency                TEXT NOT NULL DEFAULT 'UGX',
  recipient_phone         TEXT NOT NULL,
  recipient_network       TEXT NOT NULL CHECK (recipient_network IN ('MTN', 'AIRTEL')),
  note                    TEXT,
  status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                            'pending', 'processing', 'completed', 'failed'
                          )),
  flutterwave_reference   TEXT UNIQUE NOT NULL,
  flutterwave_transfer_id TEXT,
  failure_reason          TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ican_fiat_send_sender     ON ican_fiat_send_requests(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_ican_fiat_send_status     ON ican_fiat_send_requests(status);
CREATE INDEX IF NOT EXISTS idx_ican_fiat_send_reference  ON ican_fiat_send_requests(flutterwave_reference);
CREATE INDEX IF NOT EXISTS idx_ican_fiat_send_created    ON ican_fiat_send_requests(created_at DESC);

DROP TRIGGER IF EXISTS ican_fiat_send_updated_at ON ican_fiat_send_requests;
CREATE TRIGGER ican_fiat_send_updated_at
  BEFORE UPDATE ON ican_fiat_send_requests
  FOR EACH ROW EXECUTE FUNCTION _ican_set_updated_at();


-- ───────────────────────────────────────────────────────────────────────────
-- SECTION 2: ROW-LEVEL SECURITY
-- Same pattern as ican_payout_requests: owners can read their own rows.
-- No INSERT/UPDATE policy for authenticated users -- rows are only ever
-- written by the SECURITY DEFINER functions below, callable only by
-- service_role (i.e. only from the flutterwave-momo-send Edge Function and
-- the transfer webhook, which resolve the caller's identity server-side).
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE ican_fiat_send_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fiat_send_owner_read" ON ican_fiat_send_requests;
CREATE POLICY "fiat_send_owner_read" ON ican_fiat_send_requests
  FOR SELECT USING (auth.uid() = sender_user_id);

DROP POLICY IF EXISTS "fiat_send_elevated_read" ON ican_fiat_send_requests;
CREATE POLICY "fiat_send_elevated_read" ON ican_fiat_send_requests
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users mu
      WHERE mu.id = auth.uid() AND mu.role_type = 'developer' AND mu.is_active = TRUE
    )
  );


-- ───────────────────────────────────────────────────────────────────────────
-- SECTION 3: REQUEST A SEND
-- Atomically debits wallet_accounts.balance (row-locked, insufficient-funds
-- guard baked into the WHERE clause -- same technique as
-- adjust_wallet_account_balance in FIX_WALLET_ACCOUNTS_ATOMIC_BALANCE.sql,
-- but taking an explicit p_user_id since this is called by the Edge
-- Function with the service-role key, not the sender's own JWT, so
-- auth.uid() would be null here) and opens a pending send-request row.
-- Restricted to service_role: the calling Edge Function resolves
-- p_user_id from the caller's own access token before invoking this with
-- the service role key, so it can never be called with an arbitrary
-- sender.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION request_fiat_momo_send(
  p_user_id           UUID,
  p_amount            DECIMAL,
  p_currency          TEXT,
  p_recipient_phone   TEXT,
  p_recipient_network TEXT,
  p_note              TEXT DEFAULT NULL,
  p_fee               DECIMAL DEFAULT 0
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_new_balance DECIMAL;
  v_net_amount  DECIMAL;
  v_reference   TEXT;
  v_request_id  UUID;
BEGIN
  IF p_recipient_network NOT IN ('MTN', 'AIRTEL') THEN
    RETURN jsonb_build_object('success', false, 'error', 'recipient_network must be MTN or AIRTEL');
  END IF;

  IF p_recipient_phone IS NULL OR length(trim(p_recipient_phone)) < 6 THEN
    RETURN jsonb_build_object('success', false, 'error', 'A valid recipient_phone is required');
  END IF;

  IF NOT (p_amount > 0) THEN
    RETURN jsonb_build_object('success', false, 'error', 'amount must be a positive number');
  END IF;

  v_net_amount := p_amount - COALESCE(p_fee, 0);
  IF v_net_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Fee exceeds amount');
  END IF;

  -- Atomic, row-locked debit: the balance check and the write happen in the
  -- same statement, so this can never race with another concurrent debit
  -- into a negative balance.
  UPDATE public.wallet_accounts
  SET balance = balance - p_amount
  WHERE user_id = p_user_id
    AND currency = p_currency
    AND balance >= p_amount
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance or wallet not found');
  END IF;

  v_reference := 'MOMOSEND-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' ||
                 upper(substr(md5(gen_random_uuid()::text), 1, 8));

  INSERT INTO ican_fiat_send_requests
    (sender_user_id, amount, fee, net_amount, currency,
     recipient_phone, recipient_network, note, status, flutterwave_reference)
  VALUES
    (p_user_id, p_amount, COALESCE(p_fee, 0), v_net_amount, p_currency,
     trim(p_recipient_phone), p_recipient_network, p_note, 'pending', v_reference)
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'success',    true,
    'request_id', v_request_id,
    'reference',  v_reference,
    'amount',     p_amount,
    'fee',        COALESCE(p_fee, 0),
    'net_amount', v_net_amount,
    'balance',    v_new_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION request_fiat_momo_send FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_fiat_momo_send TO service_role;


-- ───────────────────────────────────────────────────────────────────────────
-- SECTION 4: MARK A SEND AS SUBMITTED TO FLUTTERWAVE
-- Called right after the Transfers API accepts the request. Bookkeeping
-- only -- no money movement.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION mark_fiat_momo_send_processing(
  p_reference               TEXT,
  p_flutterwave_transfer_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE ican_fiat_send_requests
  SET status = 'processing',
      flutterwave_transfer_id = p_flutterwave_transfer_id
  WHERE flutterwave_reference = p_reference
    AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Send request not found or not pending');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION mark_fiat_momo_send_processing FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_fiat_momo_send_processing TO service_role;


-- ───────────────────────────────────────────────────────────────────────────
-- SECTION 5: RESOLVE A SEND (SUCCESS OR FAILURE)
-- On success: marks the request completed -- the money has genuinely
-- landed in the recipient's mobile money account, confirmed by Flutterwave.
-- On failure: refunds the sender's wallet_accounts balance atomically and
-- marks the request failed. Restricted to service_role, same reasoning as
-- resolve_ican_payout -- this is the only path that can move money back
-- into a wallet after a debit.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION resolve_fiat_momo_send(
  p_reference               TEXT,
  p_success                 BOOLEAN,
  p_flutterwave_transfer_id TEXT DEFAULT NULL,
  p_failure_reason          TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_request ican_fiat_send_requests;
BEGIN
  SELECT * INTO v_request
  FROM ican_fiat_send_requests
  WHERE flutterwave_reference = p_reference
    AND status IN ('pending', 'processing')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Send request not found or already resolved');
  END IF;

  IF p_success THEN
    UPDATE ican_fiat_send_requests
    SET status = 'completed',
        flutterwave_transfer_id = COALESCE(p_flutterwave_transfer_id, flutterwave_transfer_id)
    WHERE id = v_request.id;

    RETURN jsonb_build_object('success', true, 'request_id', v_request.id, 'status', 'completed');
  ELSE
    UPDATE ican_fiat_send_requests
    SET status = 'failed',
        failure_reason = p_failure_reason
    WHERE id = v_request.id;

    -- Refund the full original debit (amount, not net_amount) atomically.
    UPDATE public.wallet_accounts
    SET balance = balance + v_request.amount
    WHERE user_id = v_request.sender_user_id
      AND currency = v_request.currency;

    RETURN jsonb_build_object('success', true, 'request_id', v_request.id, 'status', 'failed', 'refunded', true);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION resolve_fiat_momo_send FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_fiat_momo_send TO service_role;


-- ───────────────────────────────────────────────────────────────────────────
-- SECTION 6: VIEW — send history for a user's wallet page
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW ican_fiat_send_history AS
SELECT
  s.id,
  s.sender_user_id,
  s.amount,
  s.fee,
  s.net_amount,
  s.currency,
  s.recipient_phone,
  s.recipient_network,
  s.note,
  s.status,
  s.failure_reason,
  s.created_at,
  s.updated_at
FROM ican_fiat_send_requests s;


-- ───────────────────────────────────────────────────────────────────────────
-- DONE
-- ───────────────────────────────────────────────────────────────────────────

SELECT
  'ICAN Fiat Mobile Money Send Migration — complete' AS status,
  now() AS run_at;
