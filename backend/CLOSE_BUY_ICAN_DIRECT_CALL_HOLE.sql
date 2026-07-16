-- ============================================================================
-- CLOSE: buy_ican_coins was callable directly by any authenticated client
-- ============================================================================
-- buy_ican_coins(p_user_id, p_ican_amount, p_source_app, p_payment_ref) credits
-- ICAN straight into a wallet with NO payment verification — p_payment_ref is
-- just a free-text note, never checked against anything. mybodaguy's
-- BuyIcan.tsx and agribone's BuyIcan.jsx already call it directly from the
-- browser via supabase.rpc(), so any signed-in user on either app could mint
-- themselves free ICAN.
--
-- FIX: revoke direct client execute; only the service role (used by the new
-- verify-flutterwave-payment edge function, which verifies payment with
-- Flutterwave BEFORE calling this) may call it from now on. Also add a
-- uniqueness guard so a retried/duplicate verification call for the same
-- Flutterwave transaction can't double-credit a wallet.
--
-- sell_ican_coins is untouched — it's an offline cash payout (cashier/admin
-- hands over cash), not a Flutterwave concern, out of scope here.
--
-- Run this in the shared Supabase SQL editor (same project as
-- ICAN_BUY_SELL_COINS_ADDENDUM.sql), after deploying verify-flutterwave-payment.
-- ============================================================================

-- Looked up dynamically instead of hardcoding buy_ican_coins(uuid, decimal,
-- text, text) — the live signature may differ slightly from
-- ICAN_BUY_SELL_COINS_ADDENDUM.sql (or that file may not have been run at
-- all yet), so find whatever overload(s) actually exist and lock those down.
DO $$
DECLARE
  r RECORD;
  found_any BOOLEAN := false;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'buy_ican_coins' AND n.nspname = 'public'
  LOOP
    found_any := true;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    RAISE NOTICE 'Locked down: %', r.sig;
  END LOOP;

  IF NOT found_any THEN
    RAISE EXCEPTION 'public.buy_ican_coins does not exist yet — run ICAN_BUY_SELL_COINS_ADDENDUM.sql first, then re-run this file.';
  END IF;
END $$;

-- Idempotency: a retried/duplicate call to verify-flutterwave-payment with the
-- same Flutterwave transaction_id (used as p_payment_ref / reference_id) must
-- not be able to credit the wallet twice. This constraint makes the second
-- insert fail outright; the edge function catches that and reports
-- "already processed" instead of erroring.
CREATE UNIQUE INDEX IF NOT EXISTS ican_coin_tx_buy_ref_unique
  ON ican_coin_transactions(reference_id)
  WHERE transaction_type = 'buy' AND reference_id IS NOT NULL;

DO $$
BEGIN
  RAISE NOTICE '✅ buy_ican_coins direct-call hole closed (service_role only) and buy-reference uniqueness enforced.';
END $$;
