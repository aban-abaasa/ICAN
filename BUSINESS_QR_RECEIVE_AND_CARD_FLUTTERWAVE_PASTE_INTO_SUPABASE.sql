-- Paste this whole file into the Supabase SQL editor and run it once (safe to run twice).
-- Part 1: transaction QR can pay the client from the business wallet.
-- Part 2: personal + business digital card QRs can be paid with Flutterwave.
-- Part 3: clients can REQUEST money on the business website; an owner approves with the business-wallet PIN.
-- Needs ADD_PUBLIC_TRANSACTION_QR.sql, the digital card SQL and the business-wallet SQL already applied.

-- ===================== PART 1 =====================
-- ============================================================================
-- PUBLIC QR ON EVERY TRANSACTION — the client can also RECEIVE money from the business
-- ============================================================================
-- Run AFTER ADD_PUBLIC_TRANSACTION_QR.sql (it extends that file's QR) and after the business-wallet
-- files (PITCHIN_BUSINESS_PROFILE_ICAN_WALLET.sql, UNIFIED_BUSINESS_WALLET_OPERATIONS.sql).
--
-- The QR printed on a recorded transaction already lets a visitor SEE the receipt and, for a
-- money-in entry the owner switched on, PAY it. This adds the other direction: for a money-OUT
-- (expense) entry tagged to a business — a refund, a supplier or customer payout, change owed — the
-- owner can switch on "Let the client receive this money by scanning". The person named on the
-- receipt then scans the QR, signs in to IcanEra, and the amount moves from the BUSINESS WALLET to
-- their IcanEra wallet, priced at the live icaneracoin value.
--
-- Because this moves money OUT of a business, it is deliberately stricter than "pay by scanning":
--   * OFF by default, and only the business owner, a co-owner or someone given finance access
--     (not just whoever recorded the entry) can switch it on or off;
--   * the amount and the business always come from the server, never from the browser;
--   * ONE claim only (single use): the entry becomes 'received' and the link then shows a receipt;
--   * the switch expires on its own after 7 days, so a forgotten printout cannot be cashed later;
--   * the person who recorded the entry, the person who switched it on, and anyone on the
--     business's own team cannot claim it for themselves;
--   * the business wallet is debited atomically and only if it holds enough — otherwise nothing
--     moves; the claimer needs an IcanEra account (no Mobile Money payout here);
--   * every claim is written to the business wallet ledger, the coin ledger and a payout log, and
--     the owners / finance team are notified.
-- ============================================================================

SET lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. Columns on the ledger (same guard as public_code / public_pay_status)
-- ----------------------------------------------------------------------------
ALTER TABLE public.ican_transactions
  ADD COLUMN IF NOT EXISTS public_receive_status     TEXT NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS public_receive_enabled_by UUID,
  ADD COLUMN IF NOT EXISTS public_receive_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS public_received_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS public_received_by        UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ican_transactions_public_receive_status_check') THEN
    ALTER TABLE public.ican_transactions
      ADD CONSTRAINT ican_transactions_public_receive_status_check
      CHECK (public_receive_status IN ('off', 'open', 'received', 'closed'));
  END IF;
END $$;

-- These columns decide where business money goes: a direct UPDATE may never change them.
CREATE OR REPLACE FUNCTION public.fn_guard_public_tx_fields()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.public_tx_write', TRUE) = 'on' THEN
    RETURN NEW;
  END IF;
  NEW.public_code               := OLD.public_code;
  NEW.public_pay_status         := OLD.public_pay_status;
  NEW.public_paid_at            := OLD.public_paid_at;
  NEW.public_receive_status     := OLD.public_receive_status;
  NEW.public_receive_enabled_by := OLD.public_receive_enabled_by;
  NEW.public_receive_expires_at := OLD.public_receive_expires_at;
  NEW.public_received_at        := OLD.public_received_at;
  NEW.public_received_by        := OLD.public_received_by;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Payout log — one row per claim, unique per entry (a second claim cannot be written)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.public_tx_receipts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id        UUID NOT NULL UNIQUE,
  business_profile_id   UUID NOT NULL,
  recipient_user_id     UUID NOT NULL,
  recipient_name        TEXT,
  authorised_by         UUID NOT NULL,
  amount_ugx            NUMERIC NOT NULL CHECK (amount_ugx > 0),
  ican_amount           NUMERIC NOT NULL CHECK (ican_amount > 0),
  reference_id          TEXT NOT NULL UNIQUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS public_tx_receipts_biz_idx ON public.public_tx_receipts (business_profile_id, created_at DESC);
ALTER TABLE public.public_tx_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_tx_receipts FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Rules
-- ----------------------------------------------------------------------------
-- Why this entry cannot pay a client (NULL = it can).
CREATE OR REPLACE FUNCTION public._public_tx_receive_blocker(r public.ican_transactions)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF to_jsonb(r) ->> 'deleted_at' IS NOT NULL THEN
    RETURN 'This entry was deleted';
  END IF;
  IF r.business_profile_id IS NULL THEN
    RETURN 'Only entries recorded for a business can pay out of the business wallet';
  END IF;
  IF r.transaction_type IS DISTINCT FROM 'expense' THEN
    RETURN 'Only money-out (expense) entries can be received through the QR';
  END IF;
  IF upper(COALESCE(r.currency, 'UGX')) <> 'UGX' THEN
    RETURN 'Receiving by QR works for entries recorded in UGX';
  END IF;
  IF COALESCE(r.amount, 0) < 100 THEN
    RETURN 'The amount is too small (minimum UGX 100)';
  END IF;
  RETURN NULL;
END;
$$;

-- Is the switch really on right now? (on AND not expired)
CREATE OR REPLACE FUNCTION public._public_tx_receive_is_open(r public.ican_transactions)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT r.public_receive_status = 'open'
     AND r.public_receive_expires_at IS NOT NULL
     AND r.public_receive_expires_at > now();
$$;

REVOKE ALL ON FUNCTION public._public_tx_receive_blocker(public.ican_transactions) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._public_tx_receive_is_open(public.ican_transactions)  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. What a scan shows about receiving (anon) — kept separate from public_tx_receipt
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_tx_receive_info(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r         public.ican_transactions%ROWTYPE;
  v_blocker TEXT;
  v_open    BOOLEAN;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[a-z0-9]{16,40}$' THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;
  SELECT * INTO r FROM public.ican_transactions WHERE public_code = p_code;
  IF NOT FOUND OR to_jsonb(r) ->> 'deleted_at' IS NOT NULL THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;
  v_blocker := public._public_tx_receive_blocker(r);
  v_open    := v_blocker IS NULL AND public._public_tx_receive_is_open(r);
  RETURN jsonb_build_object(
    'found',        TRUE,
    'receivable',   v_open,
    'receive_status', CASE WHEN r.public_receive_status = 'open' AND NOT v_open THEN 'closed' ELSE r.public_receive_status END,
    'received',     r.public_receive_status = 'received',
    'received_at',  r.public_received_at,
    'amount_ugx',   CASE WHEN v_open THEN CEIL(r.amount) END,
    'expires_at',   CASE WHEN v_open THEN r.public_receive_expires_at END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.public_tx_receive_info(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_tx_receive_info(TEXT) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. The owner's side — see the state, switch it on / off
-- ----------------------------------------------------------------------------
-- Who may switch it: the business owner, a co-owner, or anyone given finance access to the business.
CREATE OR REPLACE FUNCTION public.public_tx_receive_state(p_tx_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r         public.ican_transactions%ROWTYPE;
  v_blocker TEXT;
  v_manage  BOOLEAN;
  v_pay     RECORD;
  v_open    BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Please sign in');
  END IF;
  SELECT * INTO r FROM public.ican_transactions WHERE id = p_tx_id;
  IF NOT FOUND OR NOT public._public_tx_can_manage(r) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Transaction not found');
  END IF;
  v_blocker := public._public_tx_receive_blocker(r);
  v_manage  := r.business_profile_id IS NOT NULL AND public._public_tx_business_access(r.business_profile_id);
  v_open    := public._public_tx_receive_is_open(r);

  SELECT pr.recipient_name, pr.amount_ugx INTO v_pay
    FROM public.public_tx_receipts pr WHERE pr.transaction_id = r.id;

  RETURN jsonb_build_object(
    'success',        TRUE,
    'receive_status', CASE WHEN r.public_receive_status = 'open' AND NOT v_open THEN 'closed' ELSE r.public_receive_status END,
    'can_enable',     v_blocker IS NULL AND v_manage AND r.public_receive_status IN ('off', 'closed', 'open'),
    'can_manage',     v_manage,
    'blocker',        v_blocker,
    'expires_at',     CASE WHEN v_open THEN r.public_receive_expires_at END,
    'received', CASE WHEN r.public_receive_status = 'received' THEN jsonb_build_object(
                  'recipient_name', v_pay.recipient_name,
                  'received_at', r.public_received_at,
                  'amount_ugx', COALESCE(v_pay.amount_ugx, r.amount)) END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.public_tx_set_receive(p_tx_id UUID, p_enable BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r         public.ican_transactions%ROWTYPE;
  v_blocker TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Please sign in');
  END IF;
  SELECT * INTO r FROM public.ican_transactions WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND OR NOT public._public_tx_can_manage(r) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Transaction not found');
  END IF;
  IF r.public_receive_status = 'received' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This money was already received');
  END IF;
  -- Switching it ON releases business money: owner, co-owner or finance access only.
  IF r.business_profile_id IS NULL OR NOT public._public_tx_business_access(r.business_profile_id) THEN
    RETURN jsonb_build_object('success', FALSE,
      'error', 'Only the business owner, a co-owner or someone with finance access can allow this');
  END IF;
  IF p_enable THEN
    v_blocker := public._public_tx_receive_blocker(r);
    IF v_blocker IS NOT NULL THEN
      RETURN jsonb_build_object('success', FALSE, 'error', v_blocker);
    END IF;
  END IF;

  PERFORM set_config('app.public_tx_write', 'on', TRUE);
  UPDATE public.ican_transactions
     SET public_receive_status     = CASE WHEN p_enable THEN 'open' ELSE 'closed' END,
         public_receive_enabled_by = CASE WHEN p_enable THEN auth.uid() ELSE public_receive_enabled_by END,
         public_receive_expires_at = CASE WHEN p_enable THEN now() + INTERVAL '7 days' ELSE NULL END,
         public_code               = COALESCE(public_code, public.fn_new_public_tx_code())
   WHERE id = r.id;
  PERFORM set_config('app.public_tx_write', 'off', TRUE);

  RETURN public.public_tx_receive_state(p_tx_id);
END;
$$;

REVOKE ALL ON FUNCTION public.public_tx_receive_state(UUID)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.public_tx_set_receive(UUID, BOOLEAN)   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.public_tx_receive_state(UUID)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_tx_set_receive(UUID, BOOLEAN) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. The client claims it (signed in): business wallet -> the client's IcanEra wallet
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_tx_receive_wallet(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      UUID := auth.uid();
  r          public.ican_transactions%ROWTYPE;
  v_blocker  TEXT;
  v_amount   NUMERIC;
  v_price    NUMERIC;
  v_ican     NUMERIC;
  v_name     TEXT;
  v_issuer   TEXT;
  v_receipt  TEXT;
  v_ref      TEXT;
  v_note     TEXT;
  v_approver UUID;
  v_wallet   public.ican_business_wallets%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Sign in to receive this money in your IcanEra wallet');
  END IF;
  IF p_code IS NULL OR p_code !~ '^[a-z0-9]{16,40}$' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This receipt link is not valid');
  END IF;

  SELECT * INTO r FROM public.ican_transactions WHERE public_code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This receipt link is not valid');
  END IF;
  IF r.public_receive_status = 'received' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This money has already been received');
  END IF;
  IF NOT public._public_tx_receive_is_open(r) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Receiving is not switched on for this receipt, or it has expired — ask the business to switch it on again');
  END IF;
  v_blocker := public._public_tx_receive_blocker(r);
  IF v_blocker IS NOT NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', v_blocker);
  END IF;

  -- The business's own people cannot cash out through a customer-facing QR.
  IF v_uid = r.user_id OR v_uid = r.public_receive_enabled_by
     OR public._public_tx_business_access(r.business_profile_id)
     OR v_uid = ANY (public._public_tx_approver_ids(r.business_profile_id, r.user_id)) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This is the business''s own payout — the client must scan it with their own IcanEra account');
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), 'IcanEra member') INTO v_name
    FROM public.profiles p WHERE p.id = v_uid;
  v_name := COALESCE(v_name, 'IcanEra member');
  SELECT business_name INTO v_issuer FROM public.business_profiles WHERE id = r.business_profile_id;
  v_receipt := public._public_tx_receipt_no(r.created_at, r.id, r.metadata);
  v_ref     := 'PUBTX-R-' || r.id::text;
  v_amount  := CEIL(r.amount);
  v_note    := format('Received by QR — %s | receipt %s | %s', v_name, v_receipt, COALESCE(NULLIF(r.description, ''), 'Payout'));

  BEGIN
    v_price := public.public_tx_ican_price_ugx();
    v_ican  := GREATEST(ROUND(v_amount / v_price, 8), 0.00000001);

    PERFORM public.get_or_create_pitchin_business_wallet(r.business_profile_id);

    -- Debit the BUSINESS wallet first, atomically and only when it can afford it.
    UPDATE public.ican_business_wallets
       SET ican_balance = ican_balance - v_ican,
           total_spent  = total_spent + v_ican,
           updated_at   = now()
     WHERE business_profile_id = r.business_profile_id
       AND status = 'active'
       AND ican_balance >= v_ican;
    IF NOT FOUND THEN
      SELECT * INTO v_wallet FROM public.ican_business_wallets WHERE business_profile_id = r.business_profile_id;
      IF v_wallet.id IS NULL OR v_wallet.status <> 'active' THEN
        RAISE EXCEPTION 'The business wallet is not available right now';
      END IF;
      RAISE EXCEPTION 'The business wallet does not have enough ICAN to pay this out right now — ask the business to top it up';
    END IF;

    -- Credit the client.
    PERFORM public.get_or_create_ican_wallet(v_uid);
    UPDATE public.ican_user_wallets
       SET ican_balance = ican_balance + v_ican, total_earned = total_earned + v_ican
     WHERE user_id = v_uid;

    INSERT INTO public.ican_business_wallet_transactions
      (business_profile_id, initiated_by, recipient_user_id, amount_ican, note, reference_id,
       status, executed_at, direction, source_app, operation_type, metadata)
    VALUES
      (r.business_profile_id, r.public_receive_enabled_by, v_uid, v_ican, v_note, v_ref,
       'completed', now(), 'out', 'ican', 'qr_receive',
       jsonb_build_object('receipt_number', v_receipt, 'transaction_id', r.id, 'amount_ugx', v_amount));

    INSERT INTO public.ican_coin_transactions
      (sender_user_id, recipient_user_id, ican_amount, type, transaction_type, status,
       local_amount, local_currency, source_app, reference_id, note, business_profile_id)
    VALUES
      (r.public_receive_enabled_by, v_uid, v_ican, 'transfer_out', 'transfer_out', 'completed',
       v_amount, 'UGX', 'ican', v_ref, v_note, r.business_profile_id);

    INSERT INTO public.public_tx_receipts
      (transaction_id, business_profile_id, recipient_user_id, recipient_name, authorised_by,
       amount_ugx, ican_amount, reference_id)
    VALUES
      (r.id, r.business_profile_id, v_uid, v_name, r.public_receive_enabled_by, v_amount, v_ican, v_ref);

    PERFORM set_config('app.public_tx_write', 'on', TRUE);
    UPDATE public.ican_transactions
       SET public_receive_status = 'received',
           public_received_at    = now(),
           public_received_by    = v_uid,
           metadata = COALESCE(metadata, '{}'::JSONB)
                      || jsonb_build_object('public_receive', jsonb_build_object(
                           'via', 'wallet', 'recipient_name', v_name, 'ican_amount', v_ican,
                           'amount_ugx', v_amount, 'received_at', now()))
     WHERE id = r.id;
    PERFORM set_config('app.public_tx_write', 'off', TRUE);

    FOREACH v_approver IN ARRAY public._public_tx_approver_ids(r.business_profile_id, r.user_id) LOOP
      PERFORM public._public_tx_notify(
        v_approver, 'qr_payout_received',
        'Paid out by QR: UGX ' || to_char(v_amount, 'FM999,999,999,990'),
        v_name || ' received UGX ' || to_char(v_amount, 'FM999,999,999,990') || ' from ' || COALESCE(v_issuer, 'the business wallet')
          || ' for "' || left(COALESCE(r.description, 'payout'), 80) || '" (' || v_receipt || ').',
        r.business_profile_id, r.id);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- the whole block rolls back: no half-moved money
    PERFORM set_config('app.public_tx_write', 'off', TRUE);
    RETURN jsonb_build_object('success', FALSE, 'error', SQLERRM);
  END;

  RETURN jsonb_build_object('success', TRUE, 'receipt_number', v_receipt,
                            'amount_ugx', v_amount, 'ican_received', v_ican);
END;
$$;

REVOKE ALL ON FUNCTION public.public_tx_receive_wallet(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.public_tx_receive_wallet(TEXT) TO authenticated;

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ A recorded money-out entry''s public QR can now pay the client from the business wallet: the owner (or finance) switches it on, the client scans, signs in and receives it once.';
END $$;

-- ===================== PART 2 =====================
-- ============================================================================
-- DIGITAL CARD QR -> PAY THE CARD HOLDER WITH FLUTTERWAVE (Mobile Money / card / bank)
-- ============================================================================
-- Needs: ICAN_DIGITAL_CARD_QR.sql (personal cards), the business-digital-cards migration
--        (supabase/migrations/20261008100000_business_digital_cards.sql), ADD_PUBLIC_TRANSACTION_QR.sql
--        (fee, notify and approver helpers) and the business-wallet SQL.  Safe to run twice.
--
-- The card QR (/card-pay/<token>) used to let a scanner ASK the card holder for money. It now also lets
-- the scanner PAY the holder, with no account, exactly like the QR on a recorded transaction:
--
--   card_qr_pay_info(token)            -> what the scan page shows (anon)
--   card_qr_pay_start(token, ...)      -> fixes the amount + fee and stores a pending payment (anon)
--   (browser)  Flutterwave inline checkout with that payment's tx_ref
--   Edge Function card-qr-pay          -> asks Flutterwave itself whether it was paid, then
--   card_qr_fulfil(tx_ref, ...)        -> credits the holder (service_role ONLY), or the function refunds
--
-- Where the money lands: a PERSONAL card pays the holder's IcanEra wallet; a BUSINESS card pays the
-- business wallet (a sale — no tithe). Both are priced at the LIVE icaneracoin value and the holder gets
-- the FULL amount: the payer adds the gateway fee, shown openly, same maths as the transaction QR.
-- The holder also gets an income entry in their records (with its own public receipt QR) and a notification.
--
-- Nothing here pays money OUT of any card, so it needs no PIN. The browser never sends an amount to
-- credit, a recipient or a fee — only the card token, what the payer wants to pay, and their name/phone.
-- ============================================================================

SET lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. Payments table (no foreign keys: deleting a card must never erase the record of real money)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.card_qr_payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_ref                TEXT NOT NULL UNIQUE,
  card_kind             TEXT NOT NULL CHECK (card_kind IN ('personal', 'business')),
  card_id               UUID NOT NULL,
  recipient_user_id     UUID NOT NULL,
  recipient_business_id UUID,
  payer_name            TEXT NOT NULL,
  payer_phone           TEXT,
  note                  TEXT,
  amount_ugx            NUMERIC NOT NULL CHECK (amount_ugx >= 500 AND amount_ugx <= 5000000),
  processing_fee_ugx    NUMERIC NOT NULL DEFAULT 0,
  charge_ugx            NUMERIC NOT NULL,
  ican_amount           NUMERIC(18, 8),
  status                TEXT NOT NULL DEFAULT 'awaiting_payment'
                        CHECK (status IN ('awaiting_payment', 'paid', 'failed', 'refunded')),
  flw_transaction_id    TEXT,
  paid_ugx              NUMERIC,
  transaction_id        UUID,
  receipt_code          TEXT,
  error                 TEXT,
  refund_note           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at               TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS card_qr_payments_card_idx ON public.card_qr_payments (card_kind, card_id, status, created_at DESC);
ALTER TABLE public.card_qr_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.card_qr_payments FROM PUBLIC, anon, authenticated;

-- Resolve a QR token to its card: personal first, then business (same order as get_card_qr_info).
CREATE OR REPLACE FUNCTION public._card_qr_resolve(p_token TEXT)
RETURNS TABLE (kind TEXT, card_id UUID, user_id UUID, business_id UUID, holder_name TEXT, last4 TEXT, live BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'personal', c.id, c.user_id, NULL::UUID, initcap(split_part(c.holder_name, ' ', 1)), right(c.card_number, 4),
         c.qr_enabled AND c.status = 'active'
    FROM public.ican_digital_cards c WHERE c.qr_token = p_token
  UNION ALL
  SELECT 'business', b.id, bp.user_id, b.business_profile_id, initcap(b.holder_name), right(b.card_number, 4),
         b.qr_enabled AND b.status = 'active'
    FROM public.ican_business_digital_cards b
    JOIN public.business_profiles bp ON bp.id = b.business_profile_id
   WHERE b.qr_token = p_token
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public._card_qr_resolve(TEXT) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. What the scan page shows (anon)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.card_qr_pay_info(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.card_qr_payments%ROWTYPE;
  k RECORD;
BEGIN
  IF p_token IS NULL OR length(p_token) < 20 OR length(p_token) > 100 THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;
  SELECT * INTO k FROM public._card_qr_resolve(p_token);
  IF NOT FOUND OR NOT k.live THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;
  RETURN jsonb_build_object(
    'found', TRUE, 'kind', k.kind, 'holder_name', k.holder_name, 'last4', k.last4,
    'fee_pct', public.public_tx_fee_pct(), 'min_ugx', 500, 'max_ugx', 5000000);
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Start a payment (anon): fixes the charge and stores the pending row Flutterwave will reference.
--    p_dry_run = TRUE only prices it (the page shows the total before asking for a phone number).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.card_qr_pay_start(
  p_token       TEXT,
  p_amount      NUMERIC,
  p_payer_name  TEXT,
  p_payer_phone TEXT,
  p_note        TEXT DEFAULT NULL,
  p_dry_run     BOOLEAN DEFAULT FALSE
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  k        RECORD;
  v_name   TEXT := NULLIF(btrim(COALESCE(p_payer_name, '')), '');
  v_phone  TEXT := regexp_replace(COALESCE(p_payer_phone, ''), '[^0-9+]', '', 'g');
  v_amount NUMERIC;
  v_pct    NUMERIC;
  v_charge NUMERIC;
  v_ref    TEXT;
BEGIN
  IF p_token IS NULL OR length(p_token) < 20 OR length(p_token) > 100 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This QR code is not active');
  END IF;
  SELECT * INTO k FROM public._card_qr_resolve(p_token);
  IF NOT FOUND OR NOT k.live THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This QR code is not active');
  END IF;

  IF p_amount IS NULL OR p_amount < 500 OR p_amount > 5000000 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Amount must be between UGX 500 and UGX 5,000,000');
  END IF;
  v_amount := CEIL(p_amount);

  IF NOT p_dry_run THEN
    IF v_name IS NULL OR char_length(v_name) < 2 OR char_length(v_name) > 80 THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'Enter your name');
    END IF;
    IF char_length(v_phone) < 9 OR char_length(v_phone) > 16 THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'Enter the phone number you will pay with');
    END IF;
  END IF;

  -- Refuse up front (before anyone is charged) if the live coin price can't be read.
  BEGIN
    PERFORM public.public_tx_ican_price_ugx();
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', FALSE, 'error', SQLERRM);
  END;

  v_pct    := public.public_tx_fee_pct();
  v_charge := CEIL((v_amount / (1 - v_pct / 100)) / 100) * 100;

  IF NOT p_dry_run THEN
    DELETE FROM public.card_qr_payments
     WHERE card_kind = k.kind AND card_id = k.card_id AND status = 'awaiting_payment'
       AND created_at < now() - INTERVAL '7 days';
    IF (SELECT count(*) FROM public.card_qr_payments
         WHERE card_kind = k.kind AND card_id = k.card_id AND status = 'awaiting_payment'
           AND created_at > now() - INTERVAL '1 hour') >= 20 THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'Too many attempts on this card — please wait a few minutes and try again');
    END IF;

    v_ref := 'CQP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20));
    INSERT INTO public.card_qr_payments (
      tx_ref, card_kind, card_id, recipient_user_id, recipient_business_id, payer_name, payer_phone, note,
      amount_ugx, processing_fee_ugx, charge_ugx
    ) VALUES (
      v_ref, k.kind, k.card_id, k.user_id, k.business_id, v_name, v_phone, left(NULLIF(btrim(COALESCE(p_note, '')), ''), 140),
      v_amount, v_charge - v_amount, v_charge);
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE, 'tx_ref', v_ref, 'amount_ugx', v_amount,
    'processing_fee_pct', v_pct, 'processing_fee_ugx', v_charge - v_amount, 'charge_ugx', v_charge);
END;
$$;

REVOKE ALL ON FUNCTION public.card_qr_pay_info(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.card_qr_pay_start(TEXT, NUMERIC, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.card_qr_pay_info(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.card_qr_pay_start(TEXT, NUMERIC, TEXT, TEXT, TEXT, BOOLEAN) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Fulfil — called ONLY by the card-qr-pay Edge Function, after Flutterwave itself confirmed the money.
--    Everything in the inner block rolls back on failure and the function then refunds the payer.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.card_qr_fulfil(
  p_tx_ref TEXT, p_flw_transaction_id TEXT, p_paid_ugx NUMERIC
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p        public.card_qr_payments%ROWTYPE;
  v_live   BOOLEAN;
  v_price  NUMERIC;
  v_ican   NUMERIC;
  v_note   TEXT;
  v_res    JSONB;
  v_err    TEXT;
  v_tx     UUID;
  v_code   TEXT;
  v_no     TEXT;
  v_holder UUID;
BEGIN
  SELECT * INTO p FROM public.card_qr_payments WHERE tx_ref = p_tx_ref FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Payment not found');
  END IF;
  IF p.status = 'paid' THEN
    RETURN jsonb_build_object('success', TRUE, 'already_processed', TRUE, 'code', p.receipt_code,
      'amount_ugx', p.amount_ugx, 'processing_fee_ugx', p.processing_fee_ugx, 'charged_ugx', p.paid_ugx);
  END IF;
  IF p.status IN ('failed', 'refunded') THEN
    RETURN jsonb_build_object('success', FALSE, 'status', p.status,
      'error', COALESCE(p.error, 'This payment could not be completed'));
  END IF;
  IF p_paid_ugx IS NULL OR p_paid_ugx < p.charge_ugx - 1 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'The amount paid is less than the amount due');
  END IF;

  BEGIN
    -- The holder switched the QR off (or the card was frozen/removed) while this was in flight.
    IF p.card_kind = 'personal' THEN
      SELECT c.qr_enabled AND c.status = 'active' INTO v_live FROM public.ican_digital_cards c WHERE c.id = p.card_id;
    ELSE
      SELECT b.qr_enabled AND b.status = 'active' INTO v_live FROM public.ican_business_digital_cards b WHERE b.id = p.card_id;
    END IF;
    IF NOT COALESCE(v_live, FALSE) THEN
      RAISE EXCEPTION 'The card holder has switched this QR off';
    END IF;

    v_price := public.public_tx_ican_price_ugx();
    v_ican  := GREATEST(ROUND(p.amount_ugx / v_price, 8), 0.00000001);
    v_note  := format('Paid by card QR — %s%s', p.payer_name, COALESCE(' | ' || p.note, ''));

    IF p.recipient_business_id IS NOT NULL THEN
      -- A sale: the full value goes to the business wallet.
      PERFORM public.ican_settle_business_wallet_income(
        p.recipient_business_id, v_ican, 'ican', 'CARDQR-' || p.tx_ref, 'pos_sale', v_note,
        jsonb_build_object('paid_via', 'guest', 'card_qr', TRUE));
    ELSE
      v_res := public.buy_ican_coins(p.recipient_user_id, v_ican, 'ican', 'CARDQR-' || p.tx_ref);
      IF NOT COALESCE((v_res ->> 'success')::BOOLEAN, FALSE) THEN
        RAISE EXCEPTION '%', COALESCE(v_res ->> 'error', 'Could not credit the wallet');
      END IF;
    END IF;

    -- The holder's own record: a paid income entry, which also carries the payer's public receipt QR.
    v_tx   := gen_random_uuid();
    v_code := public.fn_new_public_tx_code();
    v_no   := public._public_tx_receipt_no(now(), v_tx, NULL);
    INSERT INTO public.ican_transactions (
      id, user_id, transaction_type, amount, currency, description, status, business_profile_id,
      created_at, metadata, public_code, public_pay_status, public_paid_at
    ) VALUES (
      v_tx, p.recipient_user_id, 'income', p.amount_ugx, 'UGX',
      left('Card QR payment from ' || p.payer_name || COALESCE(' — ' || p.note, ''), 240),
      'completed', p.recipient_business_id, now(),
      jsonb_build_object(
        'source', 'card_qr_payment',
        'record_category', CASE WHEN p.recipient_business_id IS NOT NULL THEN 'business' ELSE 'personal' END,
        'receipt_number', v_no,
        'payment_method', 'Mobile Money / card / bank (card QR)',
        'payer_name', p.payer_name,
        'public_payment', jsonb_build_object('via', 'guest', 'payer_name', p.payer_name, 'payer_phone', p.payer_phone,
                                             'paid_ugx', p_paid_ugx, 'paid_at', now())),
      v_code, 'paid', now());

    FOREACH v_holder IN ARRAY public._public_tx_approver_ids(p.recipient_business_id, p.recipient_user_id) LOOP
      PERFORM public._public_tx_notify(
        v_holder, 'qr_card_payment',
        'Card QR payment: UGX ' || to_char(p.amount_ugx, 'FM999,999,999,990'),
        p.payer_name || ' paid UGX ' || to_char(p.amount_ugx, 'FM999,999,999,990') || ' to your card QR'
          || COALESCE(' — ' || p.note, '') || '. It is in your ' ||
          CASE WHEN p.recipient_business_id IS NOT NULL THEN 'business wallet.' ELSE 'IcanEra wallet.' END,
        p.recipient_business_id, v_tx);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    UPDATE public.card_qr_payments
       SET status = 'failed', error = v_err, flw_transaction_id = p_flw_transaction_id,
           paid_ugx = p_paid_ugx, updated_at = now()
     WHERE id = p.id;
    RETURN jsonb_build_object('success', FALSE, 'status', 'failed', 'error', v_err, 'refund_required', TRUE);
  END;

  UPDATE public.card_qr_payments
     SET status = 'paid', flw_transaction_id = p_flw_transaction_id, paid_ugx = p_paid_ugx,
         ican_amount = v_ican, transaction_id = v_tx, receipt_code = v_code, error = NULL,
         paid_at = now(), updated_at = now()
   WHERE id = p.id;

  RETURN jsonb_build_object(
    'success', TRUE, 'code', v_code, 'receipt_number', v_no,
    'amount_ugx', p.amount_ugx, 'processing_fee_ugx', p.processing_fee_ugx, 'charged_ugx', p_paid_ugx);
END;
$$;

CREATE OR REPLACE FUNCTION public.card_qr_mark_refunded(p_tx_ref TEXT, p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.card_qr_payments
     SET status = 'refunded', refund_note = p_note, updated_at = now()
   WHERE tx_ref = p_tx_ref AND status IN ('failed', 'awaiting_payment');
$$;

REVOKE ALL ON FUNCTION public.card_qr_fulfil(TEXT, TEXT, NUMERIC)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.card_qr_mark_refunded(TEXT, TEXT)    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.card_qr_fulfil(TEXT, TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.card_qr_mark_refunded(TEXT, TEXT)   TO service_role;

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Personal and business card QRs can now be paid with Mobile Money, card or bank through Flutterwave. Last step: deploy the card-qr-pay Edge Function.';
END $$;

-- ===================== PART 3 =====================
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
