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
-- 3. The in-app Sell action: coins -> the user's own in-app wallet balance
--    (same as ADD_SELL_ICAN_TO_APP_WALLET.sql)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sell_ican_coins_to_wallet(
  p_user_id     UUID,
  p_ican_amount DECIMAL,
  p_source_app  TEXT    DEFAULT 'ican',
  p_reference   TEXT    DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sell_result JSONB;
  v_ugx_payout  DECIMAL;
  v_new_balance DECIMAL;
BEGIN
  v_sell_result := public.sell_ican_coins(p_user_id, p_ican_amount, p_source_app, p_reference);
  IF NOT COALESCE((v_sell_result->>'success')::boolean, false) THEN
    RETURN v_sell_result;
  END IF;

  v_ugx_payout := (v_sell_result->>'ugx_payout')::DECIMAL;

  -- wallet_accounts is keyed by (user_id, currency): a user can hold several rows, so this must
  -- target the UGX one only (an unfiltered UPDATE ... RETURNING INTO fails with "query returned
  -- more than one row").
  UPDATE public.wallet_accounts
  SET balance = balance + v_ugx_payout, updated_at = now()
  WHERE user_id = p_user_id AND currency = 'UGX'
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    INSERT INTO public.wallet_accounts (user_id, currency, balance, created_at, updated_at)
    VALUES (p_user_id, 'UGX', v_ugx_payout, now(), now())
    RETURNING balance INTO v_new_balance;
  END IF;

  RETURN v_sell_result || jsonb_build_object('wallet_balance', v_new_balance);
EXCEPTION WHEN OTHERS THEN
  -- Everything above is undone with this block; the real reason goes back to the app instead of a bare 500.
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.sell_ican_coins_to_wallet(UUID, DECIMAL, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sell_ican_coins_to_wallet(UUID, DECIMAL, TEXT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. BUY from the in-app wallet: UGX out of wallet_accounts at the live price, coins in.
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
  v_price       NUMERIC;
  v_ugx_cost    DECIMAL;
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

  v_price      := public.ican_live_ugx_price();
  v_ugx_cost   := ROUND(p_ican_amount * v_price, 2);
  v_actor_role := ican_resolve_caller_role();

  -- The payment: one row-locked UPDATE with the funds check inside it. wallet_accounts is keyed by
  -- (user_id, currency), so it is the user's UGX row only — without that filter a user holding more
  -- than one currency fails with "query returned more than one row".
  UPDATE public.wallet_accounts
  SET balance = balance - v_ugx_cost, updated_at = now()
  WHERE user_id = p_user_id AND currency = 'UGX' AND balance >= v_ugx_cost
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('Not enough money in your IcanEra Wallet. This costs UGX %s.', to_char(v_ugx_cost, 'FM999,999,999,990')));
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
     format('Bought %s ICAN for UGX %s from the in-app wallet at UGX %s per coin (ref: %s)',
            p_ican_amount::TEXT, v_ugx_cost::TEXT, v_price::TEXT, coalesce(p_reference, '-')),
     v_actor_role)
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object(
    'success',        true,
    'tx_id',          v_tx_id,
    'ican_bought',    p_ican_amount,
    'ugx_paid',       v_ugx_cost,
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

-- The in-app wallet's UGX balance, for showing next to a purchase.
CREATE OR REPLACE FUNCTION public.get_my_wallet_ugx_balance()
RETURNS DECIMAL LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT balance FROM public.wallet_accounts WHERE user_id = auth.uid() AND currency = 'UGX' LIMIT 1), 0);
$$;
REVOKE ALL ON FUNCTION public.get_my_wallet_ugx_balance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_wallet_ugx_balance() TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Selling icaneracoin now pays at its live value (never below the 5,000 UGX floor); Buy takes UGX from the in-app wallet (buy_ican_coins_from_wallet) instead of Flutterwave; sell_ican_coins_to_wallet exists for the apps.';
END $$;
