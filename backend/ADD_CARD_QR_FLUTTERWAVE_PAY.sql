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
