-- ============================================================================
-- Buying and selling icaneracoin happen at its LIVE value, against the user's own
-- in-app wallet — no Flutterwave — and Sell works in the apps again.
--
-- Buying and selling are exchanges between the user's two balances: their in-app UGX
-- wallet (wallet_accounts) and their icaneracoin wallet. Flutterwave is for money
-- entering or leaving the platform (funding the in-app wallet, cashing out), not for
-- swapping between the two, so Buy no longer opens a payment window: it takes the UGX
-- from the in-app wallet (section 4).
--
-- This is a global platform, so both happen in the USER'S OWN currency (their sign-up country's
-- currency, the one the wallet badge shows), at the coin's live price in that currency —
-- not in UGX (sections 1b, 3, 4). A UGX user sees exactly what they saw before.
--
-- Two problems this fixes:
--
--  1. sell_ican_coins() paid out at a hardcoded 5,000 UGX per coin
--     (v_ugx_gross := ROUND(p_ican_amount * 5000, 2)) — the launch FLOOR — so the
--     Sell screens showed "1 IcanEra = UGX 5,000 (floor price)" however high the
--     live price had risen. The live price is ican_get_price_in_currency('UGX')
--     (FX + inflation floor + usage; never below 5,000), the same number the
--     wallet badge shows, and it is what a sale now pays.
--
--  2. Apps call sell_ican_coins_to_wallet(), which ADD_SELL_ICAN_TO_APP_WALLET.sql
--     defines but which had not been run, so Sell failed with "Could not find the
--     function public.sell_ican_coins_to_wallet ... in the schema cache". It is
--     created here as well (identical body), so one run fixes both.
--
-- How the price is swapped in: the deployed sell_ican_coins() has been patched in
-- place before (CLOSE_TRANSFER_AND_SELL_ICAN_OWNERSHIP_HOLE.sql adds an ownership
-- check that exists in no source file), so this does NOT redefine it from a copy of
-- the text in another file. It reads the LIVE definition, replaces just the
-- "p_ican_amount * 5000" gross calculation with the live price, and re-creates it —
-- every other line, including any check already patched in, is left exactly as it is.
-- The 3% platform fee is a share of the coins sold (credited in ICAN), so it is
-- unchanged; only the UGX figure paid out follows the live price.
--
-- If the live price cannot be read the sale is REFUSED (never guessed at 5,000), the
-- same fail-closed rule the journey pricing follows.
--
-- request_ican_payout() calls sell_ican_coins() for its UGX figure, so a cash-out to
-- mobile money / bank now follows the live price too.
--
-- Run once. Safe to re-run (a function already using the live price is skipped).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The live UGX price of one icaneracoin (refuses rather than guesses)
-- ----------------------------------------------------------------------------
-- The ICAN app's own Buy / Sell / Portfolio screens show ican_get_market_snapshot().price_ugx (its
-- "live engine" price), while the wallet badge shows ican_get_price_in_currency(). They come from
-- the same engine but are separate calls, so this takes the HIGHER of the two: a sale or purchase
-- here is never priced below what the ICAN app itself is showing.
CREATE OR REPLACE FUNCTION public.ican_live_ugx_price()
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_market   NUMERIC;
  v_currency NUMERIC;
  v_price    NUMERIC;
BEGIN
  BEGIN
    SELECT price_ugx INTO v_market FROM public.ican_get_market_snapshot() LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_market := NULL;
  END;
  BEGIN
    SELECT price_local INTO v_currency FROM public.ican_get_price_in_currency('UGX'::VARCHAR) LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_currency := NULL;
  END;
  v_price := GREATEST(COALESCE(v_market, 0), COALESCE(v_currency, 0));
  IF v_price IS NULL OR v_price <= 0 THEN
    RAISE EXCEPTION 'The live icaneracoin price is not available right now — please try again in a moment';
  END IF;
  RETURN v_price;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ican_live_ugx_price() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 1b. Every user trades in THEIR OWN currency (this is a global platform)
-- ----------------------------------------------------------------------------
-- A user's currency is the country they chose at sign-up: user_accounts.country_code ->
-- ican_country_currency_map, USD when the map / rate table has nothing for it — exactly how
-- ican_get_user_wallet_display() (the wallet badge) resolves it, so a purchase is always in
-- the currency the badge shows. (No country recorded = 'UG', as the badge does.)
CREATE OR REPLACE FUNCTION public.ican_user_currency(p_user_id UUID)
RETURNS VARCHAR LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_country VARCHAR(2);
  v_curr    VARCHAR(3);
BEGIN
  SELECT UPPER(COALESCE(ua.country_code, 'UG'))::VARCHAR(2) INTO v_country
  FROM public.user_accounts ua WHERE ua.user_id = p_user_id LIMIT 1;
  v_country := COALESCE(v_country, 'UG');

  SELECT ccm.currency_code INTO v_curr
  FROM public.ican_country_currency_map ccm
  WHERE UPPER(ccm.country_code) = v_country LIMIT 1;

  IF v_curr IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.ican_currency_rates r WHERE UPPER(r.currency_code) = UPPER(v_curr)
  ) THEN
    v_curr := 'USD';
  END IF;
  RETURN UPPER(v_curr);
END;
$$;
GRANT EXECUTE ON FUNCTION public.ican_user_currency(UUID) TO authenticated, service_role;

-- The live price of one icaneracoin in ANY currency (refuses rather than guesses). UGX keeps the
-- rule above (never below what the ICAN app itself shows); every other currency is the price the
-- wallet badge shows for it: ican_get_price_in_currency(currency).price_local.
CREATE OR REPLACE FUNCTION public.ican_live_price_in_currency(p_currency VARCHAR)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_price NUMERIC;
BEGIN
  IF UPPER(p_currency) = 'UGX' THEN
    RETURN public.ican_live_ugx_price();
  END IF;
  BEGIN
    SELECT price_local INTO v_price FROM public.ican_get_price_in_currency(UPPER(p_currency)::VARCHAR) LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_price := NULL;
  END;
  IF v_price IS NULL OR v_price <= 0 THEN
    RAISE EXCEPTION 'The live icaneracoin price in % is not available right now — please try again in a moment', UPPER(p_currency);
  END IF;
  RETURN v_price;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ican_live_price_in_currency(VARCHAR) TO authenticated, service_role;

-- What the Buy / Sell screens need in one call: the caller's currency, the live price of one coin in
-- it, and the money they hold in that currency in the in-app wallet.
CREATE OR REPLACE FUNCTION public.get_my_ican_trading_info()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_curr    VARCHAR;
  v_price   NUMERIC;
  v_balance NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  v_curr    := public.ican_user_currency(auth.uid());
  v_price   := public.ican_live_price_in_currency(v_curr);
  SELECT COALESCE(SUM(balance), 0) INTO v_balance
  FROM public.wallet_accounts WHERE user_id = auth.uid() AND UPPER(currency) = v_curr;
  RETURN jsonb_build_object('currency', v_curr, 'price_per_ican', v_price, 'wallet_balance', v_balance);
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_ican_trading_info() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_ican_trading_info() TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. sell_ican_coins(): gross UGX = coins x live price
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r       RECORD;
  def     TEXT;
  patched TEXT;
  found_any BOOLEAN := false;
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'sell_ican_coins' AND n.nspname = 'public'
  LOOP
    found_any := true;
    def := pg_get_functiondef(r.oid);

    IF position('ican_live_ugx_price' in def) > 0 THEN
      RAISE NOTICE 'Already uses the live price, skipping: %', r.sig;
      CONTINUE;
    END IF;

    patched := regexp_replace(def, 'p_ican_amount\s*\*\s*5000', 'p_ican_amount * public.ican_live_ugx_price()', 'g');
    IF patched = def THEN
      RAISE EXCEPTION 'Could not find the 5000 gross calculation in % — inspect it by hand, did not patch.', r.sig;
    END IF;

    EXECUTE patched;
    RAISE NOTICE 'Now pays at the live price: %', r.sig;
  END LOOP;

  IF NOT found_any THEN
    RAISE EXCEPTION 'public.sell_ican_coins does not exist — nothing to patch.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. The in-app Sell action: coins -> the user's own in-app wallet, IN THEIR OWN CURRENCY
--    (extends ADD_SELL_ICAN_TO_APP_WALLET.sql)
-- ----------------------------------------------------------------------------
-- sell_ican_coins() does the coin side: debits the coins, books the sale, credits the 3% fee to the
-- platform in ICAN, and reports a UGX payout. It is left alone (cash-outs to mobile money still use
-- it). This wraps it for the in-app wallet: the payout is worked out at the coin's live price in the
-- user's own currency, with the same fee share sell_ican_coins() applied, and credited to their
-- wallet_accounts row in that currency. For a UGX user the figure is exactly sell_ican_coins()'s.
--
-- wallet_accounts is keyed by (user_id, currency): a user can hold several rows, so the credit
-- targets ONE currency row (an unfiltered UPDATE ... RETURNING INTO fails with "query returned more
-- than one row").
CREATE OR REPLACE FUNCTION public.sell_ican_coins_to_wallet(
  p_user_id     UUID,
  p_ican_amount DECIMAL,
  p_source_app  TEXT    DEFAULT 'ican',
  p_reference   TEXT    DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_curr        VARCHAR;
  v_price       NUMERIC;
  v_sell_result JSONB;
  v_ugx_gross   DECIMAL;
  v_ugx_net     DECIMAL;
  v_gross       DECIMAL;
  v_payout      DECIMAL;
  v_new_balance DECIMAL;
BEGIN
  -- Price first: if it cannot be read nothing is sold.
  v_curr  := public.ican_user_currency(p_user_id);
  v_price := public.ican_live_price_in_currency(v_curr);

  v_sell_result := public.sell_ican_coins(p_user_id, p_ican_amount, p_source_app, p_reference);
  IF NOT COALESCE((v_sell_result->>'success')::boolean, false) THEN
    RETURN v_sell_result;
  END IF;

  v_ugx_gross := (v_sell_result->>'ugx_gross')::DECIMAL;
  v_ugx_net   := (v_sell_result->>'ugx_payout')::DECIMAL;

  IF v_curr = 'UGX' THEN
    v_gross  := v_ugx_gross;
    v_payout := v_ugx_net;
  ELSE
    v_gross  := ROUND(p_ican_amount * v_price, 2);
    -- The same share is kept as fee as sell_ican_coins() kept (3% of what is sold).
    v_payout := ROUND(v_gross * (v_ugx_net / NULLIF(v_ugx_gross, 0)), 2);
  END IF;

  UPDATE public.wallet_accounts
  SET balance = balance + v_payout, updated_at = now()
  WHERE user_id = p_user_id AND UPPER(currency) = v_curr
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    INSERT INTO public.wallet_accounts (user_id, currency, balance, created_at, updated_at)
    VALUES (p_user_id, v_curr, v_payout, now(), now())
    RETURNING balance INTO v_new_balance;
  END IF;

  RETURN v_sell_result || jsonb_build_object(
    'currency',       v_curr,
    'price_per_ican', v_price,
    'gross',          v_gross,
    'payout',         v_payout,
    'wallet_balance', v_new_balance
  );
EXCEPTION WHEN OTHERS THEN
  -- Everything above is undone with this block; the real reason goes back to the app instead of a bare 500.
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.sell_ican_coins_to_wallet(UUID, DECIMAL, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sell_ican_coins_to_wallet(UUID, DECIMAL, TEXT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. BUY from the in-app wallet: money out of the user's wallet_accounts row in THEIR OWN currency
--    at the coin's live price in that currency, coins in.
--    (buy_ican_coins() stays service-role-only: it mints coins with no payment, so it can
--    never be a client call. This one is safe for clients because the payment IS the
--    debit, taken in the same transaction, from the caller's own wallet only.)
--    No fee on a purchase, as before.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buy_ican_coins_from_wallet(
  p_user_id     UUID,
  p_ican_amount DECIMAL,
  p_source_app  TEXT    DEFAULT 'ican',
  p_reference   TEXT    DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_curr        VARCHAR;
  v_price       NUMERIC;
  v_cost        DECIMAL;
  v_actor_role  TEXT;
  v_new_balance DECIMAL;
  v_tx_id       UUID;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized: p_user_id must be the authenticated user');
  END IF;
  IF p_ican_amount IS NULL OR p_ican_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;
  IF p_source_app NOT IN ('ican','digital-city-era','farm-agent','mybodaguy') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid source_app');
  END IF;

  v_curr       := public.ican_user_currency(p_user_id);
  v_price      := public.ican_live_price_in_currency(v_curr);
  v_cost       := ROUND(p_ican_amount * v_price, 2);
  v_actor_role := ican_resolve_caller_role();

  -- The payment: one row-locked UPDATE with the funds check inside it. wallet_accounts is keyed by
  -- (user_id, currency), so it is the user's row in their own currency only — without that filter a
  -- user holding more than one currency fails with "query returned more than one row".
  UPDATE public.wallet_accounts
  SET balance = balance - v_cost, updated_at = now()
  WHERE user_id = p_user_id AND UPPER(currency) = v_curr AND balance >= v_cost
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('Not enough money in your IcanEra Wallet. This costs %s %s.', v_curr,
             to_char(v_cost, CASE WHEN v_curr = 'UGX' THEN 'FM999,999,999,990' ELSE 'FM999,999,999,990.00' END)));
  END IF;

  PERFORM get_or_create_ican_wallet(p_user_id);

  UPDATE ican_user_wallets
  SET ican_balance = ican_balance + p_ican_amount,
      total_earned = total_earned + p_ican_amount
  WHERE user_id = p_user_id;

  INSERT INTO ican_coin_transactions
    (recipient_user_id, ican_amount, transaction_type, source_app, reference_id, note, actor_role)
  VALUES
    (p_user_id, p_ican_amount, 'buy', p_source_app, p_reference,
     format('Bought %s ICAN for %s %s from the in-app wallet at %s %s per coin (ref: %s)',
            p_ican_amount::TEXT, v_curr, v_cost::TEXT, v_curr, v_price::TEXT, coalesce(p_reference, '-')),
     v_actor_role)
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object(
    'success',        true,
    'tx_id',          v_tx_id,
    'ican_bought',    p_ican_amount,
    'currency',       v_curr,
    'paid',           v_cost,
    'price_per_ican', v_price,
    'wallet_balance', v_new_balance,
    'actor_role',     v_actor_role
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.buy_ican_coins_from_wallet(UUID, DECIMAL, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buy_ican_coins_from_wallet(UUID, DECIMAL, TEXT, TEXT) TO authenticated;

-- Superseded by get_my_ican_trading_info() (any currency, not just UGX).
DROP FUNCTION IF EXISTS public.get_my_wallet_ugx_balance();

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Buying and selling icaneracoin now work in each user''s OWN currency at its live value in that currency; Buy takes the money from the in-app wallet (buy_ican_coins_from_wallet) instead of Flutterwave; sell_ican_coins_to_wallet exists for the apps; get_my_ican_trading_info() gives the screens the currency, price and wallet balance.';
END $$;
