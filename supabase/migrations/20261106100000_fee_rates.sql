-- ============================================================================
-- Fee rates: one table the developer edits to change what the wallet charges
--
-- WHAT IS CHARGED (defaults, all 3%)
--   send_mobile_money  wallet money -> someone else's mobile-money number      taken OUT of the amount
--   send_bank          wallet money -> a bank account (anyone's, your own too)  taken OUT of the amount
--   withdraw_wallet    wallet money -> YOUR OWN registered mobile-money number  taken OUT of the amount
--   coin_cash_out      IcanEra coin sold for money: cash-out, payouts           (the old hardcoded 3%)
--
--   "Taken out of the amount": send UGX 10,000 at 3% -> your wallet is debited 10,000, the recipient receives 9,700.
--   The server picks the rate from what it can VERIFY, never from what the app claims: a bank account is always send_bank
--   (it cannot be proven to be yours), your own registered number is withdraw_wallet, any other number is send_mobile_money.
--   Sending to another IcanEra ACCOUNT, and sending IcanEra coin, stay free - they are not in this table.
--
-- HOW A DEVELOPER CHANGES A RATE (takes effect on the server at once; the app picks it up within a minute)
--     UPDATE public.ican_fee_rates SET rate = 0.02 WHERE key = 'send_mobile_money';   -- 2%
--     UPDATE public.ican_fee_rates SET rate = 0    WHERE key = 'send_bank';           -- free
--   A rate is a fraction from 0 up to (not including) 1. Anything else is refused by the table.
--
-- WHAT THIS MIGRATION DOES
--   1. public.ican_fee_rates            the rates (readable by everyone, writable only from the SQL editor / service role)
--   2. public.ican_fee_rate(key)        the one place the server reads a rate; a missing row falls back to the default 3%
--                                       (never silently to "free"), an unknown key is 0
--   3. request_fiat_bank_send           now takes p_fee (default 0, so existing callers such as card-pay-with-pin are unchanged);
--                                       request_fiat_momo_send already did. Both debit the whole amount, keep the fee and send
--                                       amount - fee. A failed transfer refunds the whole amount (resolve_fiat_momo_send).
--   4. sell_ican_coins / resolve_ican_payout
--                                       their three hardcoded "* 0.03" now read coin_cash_out. Patched in place, and ONLY when
--                                       every 0.03 in the function is one of the three known statements - otherwise the function
--                                       is left exactly as it is and a WARNING says so. At the default rate nothing changes.
--   5. SECURITY FIX - see the section at the end: the server-only money functions were callable by anyone.
--
-- Run order: this SQL first, then deploy the flutterwave-momo-send Edge Function, then the website.
-- Until the Edge Function is redeployed nothing is charged on sends or withdrawals; until this SQL has run the Edge Function
-- charges nothing either (it treats a missing rates table as "no fees yet"). Safe to run twice.
-- ============================================================================


-- ─── 1. The rates ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ican_fee_rates (
  key        TEXT PRIMARY KEY,
  rate       NUMERIC(7, 6) NOT NULL CHECK (rate >= 0 AND rate < 1),
  label      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DO NOTHING on conflict: running this again must never undo a rate the developer has already changed.
INSERT INTO public.ican_fee_rates (key, rate, label) VALUES
  ('send_mobile_money', 0.03, 'Sending wallet money to someone else''s mobile-money number (taken out of the amount)'),
  ('send_bank',         0.03, 'Sending wallet money to a bank account - anyone''s, including your own (taken out of the amount)'),
  ('withdraw_wallet',   0.03, 'Cashing out wallet money to your own registered mobile-money number (taken out of the amount)'),
  ('coin_cash_out',     0.03, 'Selling IcanEra coin for money: cash-out, conversion and payouts')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ican_fee_rates_touch() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ican_fee_rates_touch ON public.ican_fee_rates;
CREATE TRIGGER ican_fee_rates_touch BEFORE UPDATE ON public.ican_fee_rates
  FOR EACH ROW EXECUTE FUNCTION public.ican_fee_rates_touch();

-- Rates are public information (the app shows them before you pay). Changing one is not: there is deliberately no
-- INSERT/UPDATE/DELETE policy, so only the SQL editor and the service role can.
ALTER TABLE public.ican_fee_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ican_fee_rates_read ON public.ican_fee_rates;
CREATE POLICY ican_fee_rates_read ON public.ican_fee_rates FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.ican_fee_rates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ican_fee_rates TO anon, authenticated;


-- ─── 2. The one place the server reads a rate ────────────────────────────────

CREATE OR REPLACE FUNCTION public.ican_fee_rate(p_key TEXT) RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT r.rate FROM public.ican_fee_rates r WHERE r.key = p_key),
    -- a deleted row must not turn a charge into "free" by accident
    CASE p_key
      WHEN 'send_mobile_money' THEN 0.03
      WHEN 'send_bank'         THEN 0.03
      WHEN 'withdraw_wallet'   THEN 0.03
      WHEN 'coin_cash_out'     THEN 0.03
      ELSE 0
    END)
$$;

REVOKE ALL ON FUNCTION public.ican_fee_rate(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_fee_rate(TEXT) TO anon, authenticated, service_role;


-- ─── 3. Bank sends can carry a fee (mobile-money sends already could) ────────
--
-- Same body as before plus p_fee. The old six-argument signature is dropped first so there is exactly one function of this
-- name; a call with the old six named arguments (card-pay-with-pin) still resolves, with p_fee = 0.

DROP FUNCTION IF EXISTS public.request_fiat_bank_send(UUID, DECIMAL, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.request_fiat_bank_send(
  p_user_id        UUID,
  p_amount         DECIMAL,
  p_account_number TEXT,
  p_bank_code      TEXT,
  p_beneficiary    TEXT,
  p_note           TEXT DEFAULT NULL,
  p_fee            DECIMAL DEFAULT 0
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new_balance DECIMAL;
  v_fee         DECIMAL := COALESCE(p_fee, 0);
  v_net_amount  DECIMAL;
  v_reference   TEXT;
  v_request_id  UUID;
BEGIN
  IF p_account_number IS NULL OR p_account_number !~ '^[0-9]{5,20}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter a valid bank account number');
  END IF;
  IF p_bank_code IS NULL OR length(trim(p_bank_code)) = 0 OR length(trim(coalesce(p_beneficiary, ''))) < 2 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bank and account name are required');
  END IF;
  IF NOT (p_amount > 0) THEN
    RETURN jsonb_build_object('success', false, 'error', 'amount must be a positive number');
  END IF;
  IF v_fee < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Fee cannot be negative');
  END IF;

  v_net_amount := p_amount - v_fee;
  IF v_net_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Fee exceeds amount');
  END IF;

  UPDATE public.wallet_accounts
     SET balance = balance - p_amount
   WHERE user_id = p_user_id AND currency = 'UGX' AND balance >= p_amount
  RETURNING balance INTO v_new_balance;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance or wallet not found');
  END IF;

  -- MOMOSEND- prefix => webhook resolves via resolve_fiat_momo_send (refunds on failure).
  v_reference := 'MOMOSEND-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' ||
                 upper(substr(md5(gen_random_uuid()::text), 1, 8));

  INSERT INTO public.ican_fiat_send_requests
    (sender_user_id, amount, fee, net_amount, currency, recipient_phone, recipient_network,
     note, status, flutterwave_reference, bank_code, beneficiary_name)
  VALUES
    (p_user_id, p_amount, v_fee, v_net_amount, 'UGX', p_account_number, 'BANK',
     p_note, 'pending', v_reference, trim(p_bank_code), left(trim(p_beneficiary), 80))
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object('success', true, 'request_id', v_request_id, 'reference', v_reference,
                            'amount', p_amount, 'fee', v_fee, 'net_amount', v_net_amount, 'balance', v_new_balance);
END $$;


-- ─── 4. The coin cash-out rate ───────────────────────────────────────────────
--
-- sell_ican_coins (the UGX fee, and the same share credited to the platform in ICAN) and resolve_ican_payout (the platform
-- credit when a payout settles) each have the rate typed in as 0.03. They are rewritten from their own current text, so
-- whatever else they do is untouched. Each function is all-or-nothing: if ANY 0.03 in it is not one of the three known
-- statements it is skipped, because half a function on one rate and half on another would not balance.

DO $patch$
DECLARE
  v_name     TEXT;
  v_oid      OID;
  v_def      TEXT;
  v_new      TEXT;
  v_before   INT;
  v_after    INT;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['sell_ican_coins', 'resolve_ican_payout'] LOOP
    FOR v_oid IN
      SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = v_name
    LOOP
      v_def    := pg_get_functiondef(v_oid);
      v_before := (length(v_def) - length(replace(v_def, '0.03', ''))) / 4;
      CONTINUE WHEN v_before = 0;                       -- already patched

      v_new := regexp_replace(
        v_def,
        'ROUND\((v_ugx_gross|p_ican_amount|v_request\.ican_amount) \* 0\.03, ([0-9]+)\)',
        'ROUND(\1 * public.ican_fee_rate(''coin_cash_out''), \2)',
        'g');
      v_after := (length(v_new) - length(replace(v_new, '0.03', ''))) / 4;

      IF v_after = 0 THEN
        EXECUTE v_new;
        RAISE NOTICE 'ican_fee_rates: % now reads the coin_cash_out rate (% statement(s))', v_oid::regprocedure, v_before;
      ELSE
        RAISE WARNING 'ican_fee_rates: % left exactly as it was - it has % fixed 0.03 this migration does not recognise. Its cash-out fee stays 3%% until that is changed by hand.',
          v_oid::regprocedure, v_after;
      END IF;
    END LOOP;
  END LOOP;
END $patch$;


-- ─── 5. SECURITY FIX: server-only money functions were callable by anyone ────
--
-- These functions debit or credit the user passed in p_user_id / p_reference. Their own files say "restricted to
-- service_role", and the intent is right: only the Edge Functions (service-role key) ever call them - checked across the
-- website and the other apps' code. But the files do   REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO service_role;
-- and on Supabase new functions are ALSO granted straight to anon and authenticated, which REVOKE ... FROM PUBLIC does not
-- remove. So today anyone holding the public anon key can call them. Here the API roles are revoked by name. Every overload.

DO $lock$
DECLARE
  v_sig REGPROCEDURE;
BEGIN
  FOR v_sig IN
    SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('request_fiat_momo_send', 'request_fiat_bank_send', 'resolve_fiat_momo_send',
                         'mark_fiat_momo_send_processing', 'request_ican_payout', 'resolve_ican_payout')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_sig);
  END LOOP;
END $lock$;
