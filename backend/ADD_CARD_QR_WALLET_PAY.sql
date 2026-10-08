-- ============================================================================
-- DIGITAL CARD QR -> ALSO PAY FROM AN ICANERA WALLET (own-country currency or ICAN coins)
-- ============================================================================
-- Needs: ADD_CARD_QR_FLUTTERWAVE_PAY.sql (card_qr_payments, card_qr_fulfil, _card_qr_resolve),
--        ADD_PUBLIC_TRANSACTION_QR.sql and ADD_SELL_ICAN_LIVE_PRICE.sql (ican_user_currency,
--        ican_live_price_in_currency).  Run it AFTER those (it replaces card_qr_fulfil and card_qr_pay_info
--        with versions that understand wallet payers).  Safe to run twice.
--
-- The card QR (/card-pay/<token>) already lets a scanner pay the holder with Mobile Money, card or bank
-- through Flutterwave. This adds the IcanEra wallet, for a scanner who signs in on the page. IcanEra is a
-- global platform, so the wallet money is in the PAYER'S OWN currency (their sign-up country's currency, the
-- one their wallet badge shows) — never assumed to be UGX:
--
--   card_qr_wallet_quote(token, amount)             -> the payer's currency, what the amount costs in coins,
--                                                      their balances (amount NULL = just currency + balances)
--   card_qr_pay_wallet(token, amount, source, note) -> amount is in the payer's own currency;
--                                                      source 'local' (their currency wallet) or 'ican' (coins)
--
-- No processing fee: the holder receives the full value and the payer pays exactly the amount. Everything is
-- priced at the LIVE icaneracoin value in the payer's currency (ican_live_price_in_currency, no hardcoded rate).
-- The holder is paid in icaneracoin; the platform's bookkeeping ledger stays in UGX (as everywhere else), so
-- the holder's record shows the UGX value of those coins at the live UGX price. The allowed size of a payment
-- is UGX 500 – 5,000,000 of value, whatever currency it was typed in.
--
--   local : payer's currency wallet (wallet_accounts row in THEIR currency) is debited; the holder is credited
--           exactly like a Flutterwave payment (personal -> IcanEra wallet, business -> business wallet).
--   ican  : payer's coins move to the holder (personal -> transfer_ican, business -> business wallet);
--           the holder gets the same income entry, receipt QR and notification.
--
-- Everything runs in ONE transaction, so if the holder's side cannot be applied (e.g. they switched the QR off
-- a moment ago) the payer's wallet is not touched. The browser never sends a recipient, a fee or a price.
-- ============================================================================

SET lock_timeout = '5s';

DO $$
BEGIN
  IF to_regprocedure('public.ican_user_currency(uuid)') IS NULL
     OR to_regprocedure('public.ican_live_price_in_currency(character varying)') IS NULL THEN
    RAISE NOTICE 'Run ADD_SELL_ICAN_LIVE_PRICE.sql first: ican_user_currency / ican_live_price_in_currency are missing.';
  END IF;
END $$;

ALTER TABLE public.card_qr_payments ADD COLUMN IF NOT EXISTS paid_via          TEXT NOT NULL DEFAULT 'guest';
ALTER TABLE public.card_qr_payments ADD COLUMN IF NOT EXISTS payer_user_id     UUID;
ALTER TABLE public.card_qr_payments ADD COLUMN IF NOT EXISTS pay_currency      TEXT;     -- the payer's own currency
ALTER TABLE public.card_qr_payments ADD COLUMN IF NOT EXISTS pay_amount_local  NUMERIC;  -- what they typed, in it

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'card_qr_payments_paid_via_chk') THEN
    ALTER TABLE public.card_qr_payments
      ADD CONSTRAINT card_qr_payments_paid_via_chk CHECK (paid_via IN ('guest', 'wallet_local', 'wallet_ican'));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. What the scan page shows: same as before, plus wallet_ok so the page knows this SQL is installed
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.card_qr_pay_info(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
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
    'fee_pct', public.public_tx_fee_pct(), 'min_ugx', 500, 'max_ugx', 5000000, 'wallet_ok', TRUE);
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Quote for a signed-in payer (nothing is stored or moved). p_amount is in the payer's own currency;
--    NULL returns just their currency, the live coin price in it and their balances.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.card_qr_wallet_quote(p_token TEXT, p_amount NUMERIC DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       UUID := auth.uid();
  k           RECORD;
  v_curr      VARCHAR;
  v_price     NUMERIC;   -- one coin, in the payer's currency
  v_ugx_price NUMERIC;   -- one coin, in UGX (bookkeeping + size limits)
  v_local     NUMERIC;
  v_ican      NUMERIC;
  v_ugx       NUMERIC;
  v_out       JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Sign in to pay with your IcanEra wallet');
  END IF;
  IF p_token IS NULL OR length(p_token) < 20 OR length(p_token) > 100 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This QR code is not active');
  END IF;
  SELECT * INTO k FROM public._card_qr_resolve(p_token);
  IF NOT FOUND OR NOT k.live THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This QR code is not active');
  END IF;
  IF k.user_id = v_uid THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'You cannot pay your own card');
  END IF;

  BEGIN
    v_curr      := public.ican_user_currency(v_uid);
    v_price     := public.ican_live_price_in_currency(v_curr);
    v_ugx_price := public.public_tx_ican_price_ugx();
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', FALSE, 'error', SQLERRM);
  END;

  v_out := jsonb_build_object(
    'success', TRUE,
    'currency', v_curr,
    'price_local', v_price,
    'local_balance', COALESCE((SELECT SUM(w.balance) FROM public.wallet_accounts w
                                WHERE w.user_id = v_uid AND UPPER(w.currency) = v_curr), 0),
    'ican_balance', COALESCE((SELECT u.ican_balance FROM public.ican_user_wallets u WHERE u.user_id = v_uid), 0));

  IF p_amount IS NULL THEN
    RETURN v_out;
  END IF;
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Enter an amount');
  END IF;

  v_local := ROUND(p_amount, 2);
  v_ican  := GREATEST(ROUND(v_local / v_price, 8), 0.00000001);
  v_ugx   := CEIL(v_ican * v_ugx_price);
  IF v_ugx < 500 OR v_ugx > 5000000 THEN
    RETURN jsonb_build_object('success', FALSE, 'error',
      format('A card payment must be worth between UGX 500 and UGX 5,000,000 — %s %s is worth about UGX %s',
             v_curr, to_char(v_local, 'FM999,999,999,990.00'), to_char(v_ugx, 'FM999,999,999,990')));
  END IF;

  RETURN v_out || jsonb_build_object('amount_local', v_local, 'ican_amount', v_ican, 'amount_ugx', v_ugx);
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Fulfil — replaces the Flutterwave-only version. Same behaviour for 'guest' payments; a wallet_ican
--    payment has already moved the coins, so only the holder's record + notification are written.
--    Called by the card-qr-pay Edge Function (guest) and by card_qr_pay_wallet (wallet).
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
  v_method TEXT;
  v_via    TEXT;
  v_where  TEXT;
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

  v_method := CASE p.paid_via
                WHEN 'wallet_local' THEN 'IcanEra wallet (' || COALESCE(p.pay_currency, 'local currency') || ', card QR)'
                WHEN 'wallet_ican'  THEN 'IcanEra wallet (ICAN coins, card QR)'
                ELSE 'Mobile Money / card / bank (card QR)' END;
  v_via    := CASE WHEN p.paid_via = 'guest' THEN 'guest' ELSE 'wallet' END;

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

    IF p.paid_via <> 'guest' AND p.ican_amount IS NOT NULL THEN
      v_ican := p.ican_amount; -- a wallet payment: exactly the coins that were priced and taken
    ELSE
      v_price := public.public_tx_ican_price_ugx();
      v_ican  := GREATEST(ROUND(p.amount_ugx / v_price, 8), 0.00000001);
    END IF;
    v_note := format('Paid by card QR — %s%s', p.payer_name, COALESCE(' | ' || p.note, ''));

    IF p.paid_via <> 'wallet_ican' THEN
      IF p.recipient_business_id IS NOT NULL THEN
        -- A sale: the full value goes to the business wallet.
        PERFORM public.ican_settle_business_wallet_income(
          p.recipient_business_id, v_ican, 'ican', 'CARDQR-' || p.tx_ref, 'pos_sale', v_note,
          jsonb_build_object('paid_via', v_via, 'card_qr', TRUE));
      ELSE
        v_res := public.buy_ican_coins(p.recipient_user_id, v_ican, 'ican', 'CARDQR-' || p.tx_ref);
        IF NOT COALESCE((v_res ->> 'success')::BOOLEAN, FALSE) THEN
          RAISE EXCEPTION '%', COALESCE(v_res ->> 'error', 'Could not credit the wallet');
        END IF;
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
        'payment_method', v_method,
        'payer_name', p.payer_name,
        'public_payment', jsonb_build_object('via', v_via, 'payer_name', p.payer_name, 'payer_phone', p.payer_phone,
                                             'paid_ugx', p_paid_ugx, 'paid_at', now(),
                                             'paid_currency', p.pay_currency, 'paid_amount_local', p.pay_amount_local)),
      v_code, 'paid', now());

    v_where := CASE WHEN p.recipient_business_id IS NOT NULL THEN 'business wallet.' ELSE 'IcanEra wallet.' END;
    FOREACH v_holder IN ARRAY public._public_tx_approver_ids(p.recipient_business_id, p.recipient_user_id) LOOP
      PERFORM public._public_tx_notify(
        v_holder, 'qr_card_payment',
        'Card QR payment: UGX ' || to_char(p.amount_ugx, 'FM999,999,999,990'),
        p.payer_name || ' paid UGX ' || to_char(p.amount_ugx, 'FM999,999,999,990') || ' to your card QR'
          || CASE p.paid_via WHEN 'wallet_ican' THEN ' with ICAN coins' WHEN 'wallet_local' THEN ' from their IcanEra wallet' ELSE '' END
          || COALESCE(' — ' || p.note, '') || '. It is in your ' || v_where,
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

-- ----------------------------------------------------------------------------
-- 4. Pay from the wallet (signed in). One transaction: any failure undoes the payer's debit too.
--    p_amount is in the payer's OWN currency.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.card_qr_pay_wallet(
  p_token  TEXT,
  p_amount NUMERIC,
  p_source TEXT,
  p_note   TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       UUID := auth.uid();
  k           RECORD;
  v_q         JSONB;
  v_curr      VARCHAR;
  v_local     NUMERIC;
  v_ican      NUMERIC;
  v_ugx       NUMERIC;
  v_name      TEXT;
  v_ref       TEXT;
  v_note      TEXT;
  v_balance   NUMERIC;
  v_res       JSONB;
  v_issuer    TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Sign in to pay with your IcanEra wallet');
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('local', 'ican') THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Choose which wallet to pay from');
  END IF;

  -- Same pricing, limits and checks as the quote (token live, not your own card, live price readable).
  v_q := public.card_qr_wallet_quote(p_token, p_amount);
  IF NOT COALESCE((v_q ->> 'success')::BOOLEAN, FALSE) THEN
    RETURN v_q;
  END IF;
  IF p_amount IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Enter an amount');
  END IF;
  v_curr  := v_q ->> 'currency';
  v_local := (v_q ->> 'amount_local')::NUMERIC;
  v_ican  := (v_q ->> 'ican_amount')::NUMERIC;
  v_ugx   := (v_q ->> 'amount_ugx')::NUMERIC;

  SELECT * INTO k FROM public._card_qr_resolve(p_token);

  IF (SELECT count(*) FROM public.card_qr_payments
       WHERE payer_user_id = v_uid AND created_at > now() - INTERVAL '1 minute') >= 10 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Too many payments in a minute — please wait and try again');
  END IF;

  SELECT COALESCE(NULLIF(btrim(pr.full_name), ''), 'IcanEra member') INTO v_name
    FROM public.profiles pr WHERE pr.id = v_uid;
  v_name := left(COALESCE(v_name, 'IcanEra member'), 80);

  BEGIN
    v_ref  := 'CQP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20));
    v_note := format('Paid by card QR — %s%s', v_name, COALESCE(' | ' || left(NULLIF(btrim(COALESCE(p_note, '')), ''), 140), ''));

    INSERT INTO public.card_qr_payments (
      tx_ref, card_kind, card_id, recipient_user_id, recipient_business_id, payer_name, note,
      amount_ugx, processing_fee_ugx, charge_ugx, ican_amount, paid_via, payer_user_id, pay_currency, pay_amount_local
    ) VALUES (
      v_ref, k.kind, k.card_id, k.user_id, k.business_id, v_name, left(NULLIF(btrim(COALESCE(p_note, '')), ''), 140),
      v_ugx, 0, v_ugx, v_ican, 'wallet_' || p_source, v_uid, v_curr, v_local);

    IF p_source = 'local' THEN
      -- wallet_accounts is keyed by (user_id, currency): only the payer's row in THEIR currency.
      UPDATE public.wallet_accounts
         SET balance = balance - v_local, updated_at = now()
       WHERE user_id = v_uid AND UPPER(currency) = v_curr AND COALESCE(status, 'active') = 'active' AND balance >= v_local;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Not enough money in your % wallet — this costs % %', v_curr, v_curr, to_char(v_local, 'FM999,999,999,990.00');
      END IF;
      -- History line for the payer (best effort: the ledger has had several shapes, never block a payment on it).
      BEGIN
        INSERT INTO public.wallet_transactions (user_id, transaction_type, amount, currency, status, metadata)
        VALUES (v_uid, 'withdrawal', v_local, v_curr, 'completed',
                jsonb_build_object('source', 'digital_card', 'card_qr_ref', v_ref, 'note', v_note));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'card_qr_pay_wallet: could not write the wallet_transactions line: %', SQLERRM;
      END;
    ELSIF k.business_id IS NULL THEN
      v_res := public.transfer_ican(v_uid, k.user_id, v_ican, v_note, 'ican', 'CARDQR-W-' || v_ref,
                                    v_local, v_curr, NULL, 'person', 'person_transfer', NULL);
      IF NOT COALESCE((v_res ->> 'success')::BOOLEAN, FALSE) THEN
        RAISE EXCEPTION '%', COALESCE(v_res ->> 'error', 'The transfer failed');
      END IF;
    ELSE
      SELECT ican_balance INTO v_balance FROM public.ican_user_wallets WHERE user_id = v_uid FOR UPDATE;
      IF v_balance IS NULL THEN
        RAISE EXCEPTION 'Your IcanEra wallet was not found';
      END IF;
      IF v_balance < v_ican THEN
        RAISE EXCEPTION 'You do not have enough ICAN coins for this payment';
      END IF;
      SELECT business_name INTO v_issuer FROM public.business_profiles WHERE id = k.business_id;
      UPDATE public.ican_user_wallets
         SET ican_balance = ican_balance - v_ican, total_spent = total_spent + v_ican
       WHERE user_id = v_uid;
      INSERT INTO public.ican_coin_transactions
        (sender_user_id, ican_amount, type, transaction_type, status, local_amount, local_currency,
         merchant_name, counterparty_type, expense_classification, source_app, reference_id, note, business_profile_id)
      VALUES
        (v_uid, v_ican, 'transfer_out', 'transfer_out', 'completed', v_local, v_curr,
         v_issuer, 'business', 'business_expense', 'ican', 'CARDQR-W-' || v_ref, v_note, k.business_id);
      PERFORM public.ican_settle_business_wallet_income(
        k.business_id, v_ican, 'ican', 'CARDQR-W-' || v_ref, 'pos_sale', v_note,
        jsonb_build_object('paid_via', 'wallet', 'card_qr', TRUE));
    END IF;

    -- Holder's side (credit for 'local', income record + notification for both). Failing undoes everything above.
    v_res := public.card_qr_fulfil(v_ref, 'WALLET-' || v_ref, v_ugx);
    IF NOT COALESCE((v_res ->> 'success')::BOOLEAN, FALSE) THEN
      RAISE EXCEPTION '%', COALESCE(v_res ->> 'error', 'The payment could not be completed');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', FALSE, 'error', SQLERRM);
  END;

  RETURN jsonb_build_object(
    'success', TRUE, 'code', v_res ->> 'code', 'receipt_number', v_res ->> 'receipt_number',
    'currency', v_curr, 'amount_local', v_local, 'amount_ugx', v_ugx, 'ican_amount', v_ican, 'source', p_source);
END;
$$;

REVOKE ALL ON FUNCTION public.card_qr_pay_info(TEXT)                            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.card_qr_wallet_quote(TEXT, NUMERIC)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.card_qr_pay_wallet(TEXT, NUMERIC, TEXT, TEXT)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.card_qr_fulfil(TEXT, TEXT, NUMERIC)               FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.card_qr_pay_info(TEXT)                         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.card_qr_wallet_quote(TEXT, NUMERIC)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.card_qr_pay_wallet(TEXT, NUMERIC, TEXT, TEXT)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.card_qr_fulfil(TEXT, TEXT, NUMERIC)            TO service_role;

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Card QRs can now be paid from an IcanEra wallet in the payer''s own currency, or with ICAN coins. No Edge Function change.';
END $$;
