-- ============================================================================
-- RECEIVE FROM A BUSINESS: a client asks the business for money on its website, an owner approves it
-- ============================================================================
-- Needs: ADD_PUBLIC_TRANSACTION_QR.sql (standing pay QR, notify helpers),
--        ADD_PUBLIC_TRANSACTION_QR_RECEIVE.sql (the receive columns on the ledger),
--        BUSINESS_WALLET_PIN_VERIFY.sql and the business-wallet SQL.   Safe to run twice.
--
-- The business website's Pay tab (/notices/<company>?pay=1) takes money IN. This adds a "Receive" side:
--
--   1. The business owner / co-owner switches "Let clients request money from us" ON (with a cap per
--      request). It is OFF by default — this is money leaving the business.
--   2. A client, signed in to IcanEra, files a request: amount + what it is for.
--   3. Every owner / co-owner is notified. ONE of them approves with the BUSINESS-WALLET PIN (the same PIN,
--      lock-out and shareholder rule the wallet uses everywhere), or rejects with a reason.
--   4. On approval the amount moves from the business wallet to the client's IcanEra wallet in one atomic
--      step (priced at the live icaneracoin value) and an expense entry is written to the business books.
--      On rejection or after 48 hours nothing moves.
--
-- Nothing is paid before approval; the client cannot choose who is paid (it is always their own signed-in
-- wallet); the business's own team cannot request from their own business; the approver cannot approve
-- their own request. The browser never sends a recipient, a rate or a balance.
-- ============================================================================

SET lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. Settings (on the business's standing pay QR) + the requests table
-- ----------------------------------------------------------------------------
ALTER TABLE public.public_tx_paycodes
  ADD COLUMN IF NOT EXISTS receive_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS receive_max_ugx NUMERIC NOT NULL DEFAULT 500000;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_tx_paycodes_receive_max_check') THEN
    ALTER TABLE public.public_tx_paycodes
      ADD CONSTRAINT public_tx_paycodes_receive_max_check CHECK (receive_max_ugx >= 500 AND receive_max_ugx <= 5000000);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.public_receive_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL,
  requester_user_id   UUID NOT NULL,
  requester_name      TEXT NOT NULL,
  requester_phone     TEXT,
  amount_ugx          NUMERIC NOT NULL CHECK (amount_ugx >= 500 AND amount_ugx <= 5000000),
  note                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'declined', 'expired')),
  decided_by          UUID,
  decided_at          TIMESTAMPTZ,
  decline_note        TEXT,
  ican_amount         NUMERIC(18, 8),
  reference_id        TEXT UNIQUE,
  transaction_id      UUID,
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '48 hours'),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS public_receive_requests_biz_idx  ON public.public_receive_requests (business_profile_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS public_receive_requests_user_idx ON public.public_receive_requests (requester_user_id, created_at DESC);
ALTER TABLE public.public_receive_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_receive_requests FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Helpers (internal)
-- ----------------------------------------------------------------------------
-- Owner and co-owners of a business (the people who may approve a payout).
CREATE OR REPLACE FUNCTION public._public_receive_approvers(p_business UUID)
RETURNS UUID[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(DISTINCT x.id), ARRAY[]::UUID[]) FROM (
    SELECT bp.user_id AS id FROM public.business_profiles bp WHERE bp.id = p_business
    UNION SELECT bco.user_id FROM public.business_co_owners bco WHERE bco.business_profile_id = p_business
  ) x WHERE x.id IS NOT NULL;
$$;

-- Inbox message carrying the request id (the wallet inbox shows it; qr_* types need no coin transaction).
CREATE OR REPLACE FUNCTION public._public_receive_notify(
  p_user UUID, p_type TEXT, p_title TEXT, p_message TEXT, p_business UUID, p_request UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  BEGIN
    INSERT INTO public.ican_wallet_inbox_notifications
      (recipient_user_id, source_app, notification_type, title, message, business_profile_id, reference_id, metadata)
    VALUES
      (p_user, 'ican', p_type, left(p_title, 200), left(p_message, 500), p_business, p_request::TEXT,
       jsonb_build_object('receive_request_id', p_request));
  EXCEPTION WHEN OTHERS THEN
    NULL; -- a missing inbox must never block a payout decision
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public._public_receive_json(q public.public_receive_requests)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', q.id, 'business_profile_id', q.business_profile_id,
    'issuer_name', (SELECT i.issuer_name FROM public._public_tx_issuer(q.business_profile_id, q.requester_user_id) i),
    'amount_ugx', q.amount_ugx, 'note', q.note,
    'requester_name', q.requester_name, 'requester_phone', q.requester_phone,
    'status', CASE WHEN q.status = 'pending' AND q.expires_at <= now() THEN 'expired' ELSE q.status END,
    'decline_note', q.decline_note, 'decided_at', q.decided_at,
    'created_at', q.created_at, 'expires_at', q.expires_at, 'ican_amount', q.ican_amount);
$$;

REVOKE ALL ON FUNCTION public._public_receive_approvers(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._public_receive_notify(UUID, TEXT, TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._public_receive_json(public.public_receive_requests) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Settings — read by the business team, changed ONLY by an owner / co-owner
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_receive_settings(
  p_business UUID, p_enabled BOOLEAN DEFAULT NULL, p_max NUMERIC DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.public_tx_paycodes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Please sign in');
  END IF;
  IF NOT public._public_tx_business_access(p_business) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Business access required');
  END IF;
  SELECT * INTO c FROM public.public_tx_paycodes WHERE business_profile_id = p_business FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Make the business''s permanent pay QR first');
  END IF;

  IF p_enabled IS NOT NULL OR p_max IS NOT NULL THEN
    IF NOT (auth.uid() = ANY (public._public_receive_approvers(p_business))) THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'Only the business owner or a co-owner can change this');
    END IF;
    IF p_max IS NOT NULL AND (p_max < 500 OR p_max > 5000000) THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'The biggest request must be between UGX 500 and UGX 5,000,000');
    END IF;
    UPDATE public.public_tx_paycodes
       SET receive_enabled = COALESCE(p_enabled, receive_enabled),
           receive_max_ugx = COALESCE(CEIL(p_max), receive_max_ugx),
           updated_at = now()
     WHERE id = c.id RETURNING * INTO c;
  END IF;
  RETURN jsonb_build_object('success', TRUE, 'enabled', c.receive_enabled, 'max_ugx', c.receive_max_ugx,
    'can_change', auth.uid() = ANY (public._public_receive_approvers(p_business)));
END;
$$;

-- Anyone: does this business take requests? (decides whether its website shows the Receive side)
CREATE OR REPLACE FUNCTION public.public_receive_info_by_business(p_business UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.public_tx_paycodes%ROWTYPE;
BEGIN
  IF p_business IS NULL THEN RETURN jsonb_build_object('found', FALSE); END IF;
  SELECT * INTO c FROM public.public_tx_paycodes WHERE business_profile_id = p_business;
  IF NOT FOUND OR NOT c.active OR NOT c.receive_enabled THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;
  RETURN jsonb_build_object('found', TRUE, 'max_ugx', c.receive_max_ugx, 'min_ugx', 500,
    'issuer_name', (SELECT i.issuer_name FROM public._public_tx_issuer(p_business, c.user_id) i));
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. The client files a request (signed in)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_receive_submit(
  p_business UUID, p_amount NUMERIC, p_note TEXT, p_name TEXT DEFAULT NULL, p_phone TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    UUID := auth.uid();
  c        public.public_tx_paycodes%ROWTYPE;
  v_name   TEXT;
  v_phone  TEXT := NULLIF(regexp_replace(COALESCE(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_note   TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_amount NUMERIC;
  q        public.public_receive_requests%ROWTYPE;
  v_issuer TEXT;
  v_id     UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Sign in to IcanEra to request money — it is paid into your IcanEra wallet');
  END IF;
  SELECT * INTO c FROM public.public_tx_paycodes WHERE business_profile_id = p_business;
  IF NOT FOUND OR NOT c.active OR NOT c.receive_enabled THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This business is not taking requests right now');
  END IF;
  IF p_amount IS NULL OR p_amount < 500 OR p_amount > c.receive_max_ugx THEN
    RETURN jsonb_build_object('success', FALSE,
      'error', 'Amount must be between UGX 500 and UGX ' || to_char(c.receive_max_ugx, 'FM999,999,999'));
  END IF;
  v_amount := CEIL(p_amount);
  IF v_note IS NULL OR char_length(v_note) < 3 OR char_length(v_note) > 200 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Say what the money is for (3–200 characters)');
  END IF;
  IF v_uid = ANY (public._public_tx_approver_ids(p_business, c.user_id)) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'You are part of this business — use the business wallet instead');
  END IF;
  IF (SELECT count(*) FROM public.public_receive_requests
       WHERE business_profile_id = p_business AND requester_user_id = v_uid
         AND status = 'pending' AND expires_at > now()) >= 2 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'You already have requests waiting for approval — wait for a decision first');
  END IF;
  IF (SELECT count(*) FROM public.public_receive_requests
       WHERE business_profile_id = p_business AND status = 'pending' AND expires_at > now()) >= 50 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This business has too many open requests right now — try again later');
  END IF;

  v_name := COALESCE(NULLIF(btrim(p_name), ''),
                     (SELECT NULLIF(btrim(p.full_name), '') FROM public.profiles p WHERE p.id = v_uid), 'IcanEra member');
  v_name := left(v_name, 80);
  IF v_phone IS NOT NULL AND char_length(v_phone) > 16 THEN v_phone := NULL; END IF;

  INSERT INTO public.public_receive_requests
    (business_profile_id, requester_user_id, requester_name, requester_phone, amount_ugx, note)
  VALUES (p_business, v_uid, v_name, v_phone, v_amount, v_note)
  RETURNING * INTO q;

  SELECT i.issuer_name INTO v_issuer FROM public._public_tx_issuer(p_business, c.user_id) i;
  FOREACH v_id IN ARRAY public._public_receive_approvers(p_business) LOOP
    PERFORM public._public_receive_notify(
      v_id, 'qr_receive_approval',
      'Approve payout: UGX ' || to_char(v_amount, 'FM999,999,999,990'),
      v_name || ' asks ' || COALESCE(v_issuer, 'your business') || ' for UGX ' || to_char(v_amount, 'FM999,999,999,990')
        || ' — "' || left(v_note, 80) || '". Open to approve with the business-wallet PIN, or reject.',
      p_business, q.id);
  END LOOP;

  RETURN jsonb_build_object('success', TRUE, 'request', public._public_receive_json(q));
END;
$$;

-- The requester (or an owner / co-owner) reads one request.
CREATE OR REPLACE FUNCTION public.public_receive_get(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  q public.public_receive_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Please sign in');
  END IF;
  SELECT * INTO q FROM public.public_receive_requests WHERE id = p_id;
  IF NOT FOUND OR NOT (q.requester_user_id = auth.uid()
                       OR auth.uid() = ANY (public._public_receive_approvers(q.business_profile_id))) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Request not found');
  END IF;
  RETURN jsonb_build_object('success', TRUE, 'request', public._public_receive_json(q));
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. An owner / co-owner decides. Approve = business-wallet PIN, then business wallet -> client wallet.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_receive_decide(
  p_id UUID, p_approve BOOLEAN, p_pin TEXT DEFAULT NULL, p_note TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := auth.uid();
  q         public.public_receive_requests%ROWTYPE;
  v_pin     JSONB;
  v_price   NUMERIC;
  v_ican    NUMERIC;
  v_ref     TEXT;
  v_note    TEXT;
  v_issuer  TEXT;
  v_owner   UUID;
  v_tx      UUID := gen_random_uuid();
  v_no      TEXT;
  v_balance NUMERIC;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Please sign in');
  END IF;
  SELECT * INTO q FROM public.public_receive_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT (v_uid = ANY (public._public_receive_approvers(q.business_profile_id))) THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'You cannot decide this request — only the business owner or a co-owner can');
  END IF;
  IF q.status <> 'pending' OR q.expires_at <= now() THEN
    IF q.status = 'pending' THEN
      UPDATE public.public_receive_requests SET status = 'expired' WHERE id = q.id;
    END IF;
    RETURN jsonb_build_object('success', FALSE, 'message', 'This request is no longer waiting for a decision');
  END IF;
  IF v_uid = q.requester_user_id THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'You cannot approve your own request');
  END IF;

  SELECT bp.user_id, bp.business_name INTO v_owner, v_issuer FROM public.business_profiles bp WHERE bp.id = q.business_profile_id;

  IF NOT p_approve THEN
    UPDATE public.public_receive_requests
       SET status = 'declined', decided_by = v_uid, decided_at = now(), decline_note = left(NULLIF(btrim(p_note), ''), 200)
     WHERE id = q.id RETURNING * INTO q;
    PERFORM public._public_receive_notify(q.requester_user_id, 'qr_receive_decision',
      'Request not approved',
      COALESCE(v_issuer, 'The business') || ' did not approve your request for UGX ' || to_char(q.amount_ugx, 'FM999,999,999,990')
        || COALESCE(': ' || q.decline_note, '.'), q.business_profile_id, q.id);
    RETURN jsonb_build_object('success', TRUE, 'request', public._public_receive_json(q));
  END IF;

  -- The business-wallet PIN: same check and same 5-tries / 15-minute lock the wallet uses everywhere.
  -- A wrong PIN comes back as JSON (not an exception) so the failed attempt is still counted.
  v_pin := public.verify_pitchin_business_wallet_pin(q.business_profile_id, p_pin);
  IF NOT COALESCE((v_pin ->> 'success')::BOOLEAN, FALSE) THEN
    RETURN jsonb_build_object('success', FALSE, 'message', COALESCE(v_pin ->> 'message', 'Incorrect PIN'));
  END IF;

  v_ref  := 'RECVREQ-' || q.id::text;
  v_no   := 'PAY-' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD') || '-' || upper(left(replace(q.id::text, '-', ''), 8));
  v_note := format('Paid by approval — %s | %s | %s', q.requester_name, v_no, q.note);

  BEGIN
    v_price := public.public_tx_ican_price_ugx();
    v_ican  := GREATEST(ROUND(q.amount_ugx / v_price, 8), 0.00000001);

    PERFORM public.get_or_create_pitchin_business_wallet(q.business_profile_id);
    UPDATE public.ican_business_wallets
       SET ican_balance = ican_balance - v_ican, total_spent = total_spent + v_ican, updated_at = now()
     WHERE business_profile_id = q.business_profile_id AND status = 'active' AND ican_balance >= v_ican;
    IF NOT FOUND THEN
      SELECT w.ican_balance INTO v_balance FROM public.ican_business_wallets w WHERE w.business_profile_id = q.business_profile_id;
      RAISE EXCEPTION 'The business wallet does not have enough ICAN to pay this out (it has %, needs %)',
        COALESCE(v_balance, 0), v_ican;
    END IF;

    PERFORM public.get_or_create_ican_wallet(q.requester_user_id);
    UPDATE public.ican_user_wallets
       SET ican_balance = ican_balance + v_ican, total_earned = total_earned + v_ican
     WHERE user_id = q.requester_user_id;

    INSERT INTO public.ican_business_wallet_transactions
      (business_profile_id, initiated_by, recipient_user_id, amount_ican, note, reference_id,
       status, executed_at, direction, source_app, operation_type, metadata)
    VALUES
      (q.business_profile_id, v_uid, q.requester_user_id, v_ican, v_note, v_ref,
       'completed', now(), 'out', 'ican', 'qr_receive_request',
       jsonb_build_object('request_id', q.id, 'amount_ugx', q.amount_ugx, 'receipt_number', v_no));

    INSERT INTO public.ican_coin_transactions
      (sender_user_id, recipient_user_id, ican_amount, type, transaction_type, status,
       local_amount, local_currency, source_app, reference_id, note, business_profile_id)
    VALUES
      (v_uid, q.requester_user_id, v_ican, 'transfer_out', 'transfer_out', 'completed',
       q.amount_ugx, 'UGX', 'ican', v_ref, v_note, q.business_profile_id);

    -- The business's books: an expense entry. Marked already received so the receive-by-QR switch
    -- (ADD_PUBLIC_TRANSACTION_QR_RECEIVE.sql) can never pay it a second time.
    INSERT INTO public.ican_transactions (
      id, user_id, transaction_type, amount, currency, description, status, business_profile_id, created_at, metadata,
      public_receive_status, public_received_at, public_received_by
    ) VALUES (
      v_tx, COALESCE(v_owner, v_uid), 'expense', q.amount_ugx, 'UGX',
      left('Payout to ' || q.requester_name || ' — ' || q.note, 240), 'completed', q.business_profile_id, now(),
      jsonb_build_object('source', 'receive_request', 'record_category', 'business', 'receipt_number', v_no,
                         'payment_method', 'IcanEra wallet (approved request)', 'payee_name', q.requester_name,
                         'approved_by', v_uid, 'request_id', q.id),
      'received', now(), q.requester_user_id);

    UPDATE public.public_receive_requests
       SET status = 'paid', decided_by = v_uid, decided_at = now(), ican_amount = v_ican,
           reference_id = v_ref, transaction_id = v_tx
     WHERE id = q.id RETURNING * INTO q;

    PERFORM public._public_receive_notify(q.requester_user_id, 'qr_receive_decision',
      'Money received: UGX ' || to_char(q.amount_ugx, 'FM999,999,999,990'),
      COALESCE(v_issuer, 'The business') || ' approved your request. UGX ' || to_char(q.amount_ugx, 'FM999,999,999,990')
        || ' is in your IcanEra wallet.', q.business_profile_id, q.id);
  EXCEPTION WHEN OTHERS THEN
    -- the whole block rolls back: no half-moved money, and the request stays pending
    RETURN jsonb_build_object('success', FALSE, 'message', SQLERRM);
  END;

  RETURN jsonb_build_object('success', TRUE, 'request', public._public_receive_json(q));
END;
$$;

REVOKE ALL ON FUNCTION public.public_receive_settings(UUID, BOOLEAN, NUMERIC)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.public_receive_info_by_business(UUID)                         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_receive_submit(UUID, NUMERIC, TEXT, TEXT, TEXT)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.public_receive_get(UUID)                                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.public_receive_decide(UUID, BOOLEAN, TEXT, TEXT)              FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.public_receive_settings(UUID, BOOLEAN, NUMERIC)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_receive_info_by_business(UUID)                      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_receive_submit(UUID, NUMERIC, TEXT, TEXT, TEXT)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_receive_get(UUID)                                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_receive_decide(UUID, BOOLEAN, TEXT, TEXT)           TO authenticated;

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Clients can now request money from a business on its website; an owner or co-owner approves with the business-wallet PIN and it is paid into the client''s IcanEra wallet. Switch it on in the business''s Permanent pay QR panel.';
END $$;
