-- ============================================================================
-- icaneracoin: buy and sell as ONE atomic, idempotent, server-priced step.
--
-- WHAT WAS WRONG
--   icanCoinService.buyIcanCoins / sellIcanCoins ran in the browser as several
--   separate round trips: read the cash balance, work out the new balance in
--   JavaScript, write it back, insert the ledger row, then read-modify-write the
--   coin balance. Under a burst (a double tap, two tabs, a retry, or many
--   signed-in users at once) that is a textbook lost-update race:
--     * two sells that both read "10 coins" both pass the balance check and both
--       pay out; the final balance clamps at 0, so the cash was paid twice;
--     * two buys that both read "100 cash" both write "70": the user got coins
--       twice and paid once.
--   The browser also chose the price and converted currency with a hard-coded
--   FX table that is far from the platform's own ican_currency_rates (e.g. the
--   browser values 1 USD at 2,778 UGX; the server table says 4,089), so the
--   same money bought or sold different amounts of coin depending on the path.
--
-- WHAT THIS ADDS: public.ican_trade_execute(...)
--   * who you are comes from the session (auth.uid()), never from an argument;
--   * the price is the server's cached fair price (never older than 3 s) and
--     money is converted with ican_currency_rates -- the browser only says what
--     price it showed and how much movement it will accept (slippage);
--   * both wallet rows are locked in a fixed order before anything is checked,
--     so a user's concurrent trades queue up one behind the other and each sees
--     the previous one's result; different users never wait on each other;
--   * every check happens before the first write, and all writes (cash, coins,
--     ledger row, idempotency record) are one transaction: all of it or none;
--   * p_request_id makes a retry harmless: the same id returns the original
--     result and moves nothing, however many times and from however many tabs;
--   * a per-user rate limit, an optional per-trade ceiling and a one-row kill
--     switch (public.ican_trade_settings) protect the market during abuse.
--
-- The ledger row is written exactly like the old browser code wrote it
-- (type 'purchase' / 'sale', status 'completed', user_id = the trader), so every
-- screen that reads it keeps working, and its AFTER INSERT trigger appends the
-- tick that moves the live chart.
--
-- Safe to run more than once (settings an administrator changed are kept).
-- Rollback: supabase/rollback/20261018_rollback_atomic_trade.sql
-- Requires: 20261018100000_icaneracoin_burst_safe_feed.sql (ican_current_price_ugx),
--           wallet_accounts, ican_user_wallets, ican_coin_transactions, ican_currency_rates.
-- ============================================================================


-- 1. Switches an administrator can change from the SQL editor.
CREATE TABLE IF NOT EXISTS public.ican_trade_settings (
  id                    BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  trading_enabled       BOOLEAN NOT NULL DEFAULT TRUE,        -- FALSE pauses every buy and sell at once
  max_trades_per_minute INT     NOT NULL DEFAULT 60 CHECK (max_trades_per_minute > 0),
  max_trade_ugx         NUMERIC          DEFAULT NULL CHECK (max_trade_ugx IS NULL OR max_trade_ugx > 0) -- NULL = no ceiling
);
INSERT INTO public.ican_trade_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.ican_trade_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ican_trade_settings FROM PUBLIC, anon, authenticated;

-- 2. One row per executed trade request: what makes a retry safe.
CREATE TABLE IF NOT EXISTS public.ican_trade_requests (
  user_id    UUID        NOT NULL,
  request_id TEXT        NOT NULL CHECK (char_length(request_id) BETWEEN 8 AND 100),
  side       TEXT        NOT NULL CHECK (side IN ('buy', 'sell')),
  result     JSONB       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_id)
);
CREATE INDEX IF NOT EXISTS ican_trade_requests_recent ON public.ican_trade_requests (user_id, created_at DESC);
ALTER TABLE public.ican_trade_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ican_trade_requests FROM PUBLIC, anon, authenticated;


-- 3. The trade.
--    p_side                'buy' | 'sell'
--    p_amount              buy: cash to spend, in p_currency.  sell: coins to sell.
--    p_currency            the cash wallet to use (ISO code, must be in ican_currency_rates)
--    p_request_id          unique per user ACTION; reuse it only to retry that same action
--    p_expected_price_ugx  the price the screen showed (optional)
--    p_max_slippage_pct    how much WORSE than that the user accepts (default 1 %); better is always fine
-- Returns { success, ... }. On failure: { success:false, code, error } with nothing changed.
CREATE OR REPLACE FUNCTION public.ican_trade_execute(
  p_side               TEXT,
  p_amount             NUMERIC,
  p_currency           TEXT,
  p_country            TEXT    DEFAULT NULL,
  p_request_id         TEXT    DEFAULT NULL,
  p_expected_price_ugx NUMERIC DEFAULT NULL,
  p_max_slippage_pct   NUMERIC DEFAULT 1,
  p_payment_method     TEXT    DEFAULT 'wallet_balance'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       UUID    := auth.uid();
  v_side      TEXT    := lower(btrim(COALESCE(p_side, '')));
  v_cur       TEXT    := upper(btrim(COALESCE(p_currency, '')));
  v_country   TEXT    := NULLIF(upper(btrim(COALESCE(p_country, ''))), '');
  v_slip      NUMERIC := COALESCE(p_max_slippage_pct, 1);
  v_set       public.ican_trade_settings;
  v_prior     JSONB;
  v_price     NUMERIC;
  v_rate      NUMERIC;
  v_ugx       NUMERIC;
  v_ican      NUMERIC;
  v_local     NUMERIC;
  v_coin_bal  NUMERIC;
  v_cash_bal  NUMERIC;
  v_new_coin  NUMERIC;
  v_new_cash  NUMERIC;
  v_tx        UUID;
  v_recent    INT;
  v_result    JSONB;
  v_bad       BOOLEAN;
BEGIN
  -- ---- who and what ---------------------------------------------------------
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_signed_in', 'error', 'Please sign in to trade.');
  END IF;
  IF v_side NOT IN ('buy', 'sell') THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_side', 'error', 'Choose buy or sell.');
  END IF;
  IF p_amount IS NULL OR p_amount = 'NaN'::NUMERIC OR p_amount <= 0 OR p_amount > 1000000000000 THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_amount', 'error', 'Enter a valid amount.');
  END IF;
  IF v_cur !~ '^[A-Z]{3}$' THEN
    RETURN jsonb_build_object('success', false, 'code', 'unsupported_currency', 'error', 'Unsupported currency.');
  END IF;
  IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN v_country := NULL; END IF;
  IF p_request_id IS NULL OR char_length(p_request_id) NOT BETWEEN 8 AND 100 OR p_request_id !~ '^[A-Za-z0-9:_.-]+$' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_request_id', 'error', 'Missing or invalid request id.');
  END IF;
  IF v_slip < 0 OR v_slip > 50 OR v_slip = 'NaN'::NUMERIC THEN v_slip := 1; END IF;

  SELECT * INTO v_set FROM public.ican_trade_settings WHERE id;
  IF FOUND AND NOT v_set.trading_enabled THEN
    RETURN jsonb_build_object('success', false, 'code', 'trading_paused', 'error', 'Trading is paused for a moment. Please try again shortly.');
  END IF;

  -- ---- one trade at a time per user, then lock their two wallet rows -----------
  -- Concurrent trades by the same user queue on this lock BEFORE touching any row,
  -- so every check below sees the result of the trade before it, and two trades
  -- can never take the wallet rows in opposite orders (a brand-new user has no
  -- coin wallet row to lock yet, which would otherwise allow exactly that).
  -- Different users hash to different keys and never wait on each other.
  PERFORM pg_advisory_xact_lock(hashtextextended('ican_trade:' || v_uid::TEXT, 0));
  -- (The coin wallet is created below, only once a buy is certain to go through.)
  SELECT COALESCE(w.ican_balance, 0) INTO v_coin_bal
    FROM public.ican_user_wallets w WHERE w.user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN v_coin_bal := 0; END IF;
  SELECT a.balance INTO v_cash_bal
    FROM public.wallet_accounts a WHERE a.user_id = v_uid AND a.currency = v_cur AND a.status = 'active' FOR UPDATE;

  -- ---- a retry of something that already happened: same answer, nothing moves
  SELECT r.result INTO v_prior FROM public.ican_trade_requests r WHERE r.user_id = v_uid AND r.request_id = p_request_id;
  IF FOUND THEN
    RETURN v_prior || jsonb_build_object('duplicate', true);
  END IF;

  -- ---- rate limit (retries above do not count) --------------------------------
  SELECT count(*) INTO v_recent FROM public.ican_trade_requests r
   WHERE r.user_id = v_uid AND r.created_at > now() - INTERVAL '1 minute';
  IF v_recent >= COALESCE(v_set.max_trades_per_minute, 60) THEN
    RETURN jsonb_build_object('success', false, 'code', 'rate_limited', 'error', 'Too many trades in a minute. Please wait a moment.');
  END IF;

  -- ---- price and money conversion are the server's, not the browser's ----------
  v_price := public.ican_current_price_ugx(3);
  IF v_price IS NULL OR v_price <= 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'price_unavailable', 'error', 'The live price is unavailable right now. Please try again.');
  END IF;
  SELECT c.rate_to_ugx INTO v_rate FROM public.ican_currency_rates c WHERE c.currency_code = v_cur;
  IF v_rate IS NULL OR v_rate <= 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'unsupported_currency', 'error', 'Unsupported currency.');
  END IF;

  IF p_expected_price_ugx IS NOT NULL AND p_expected_price_ugx > 0 THEN
    v_bad := CASE v_side
      WHEN 'buy'  THEN v_price > p_expected_price_ugx * (1 + v_slip / 100)
      ELSE             v_price < p_expected_price_ugx * (1 - v_slip / 100) END;
    IF v_bad THEN
      RETURN jsonb_build_object('success', false, 'code', 'price_moved', 'price_ugx', v_price,
        'error', 'The price moved while you were trading. Review the new price and try again.');
    END IF;
  END IF;

  IF v_side = 'buy' THEN
    v_local := p_amount;
    v_ugx   := v_local * v_rate;
    v_ican  := trunc(v_ugx / v_price, 8);
  ELSE
    v_ican  := trunc(p_amount, 8);
    v_ugx   := v_ican * v_price;
    v_local := trunc(v_ugx / v_rate, 2);
  END IF;
  IF v_ican <= 0 OR v_local <= 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'amount_too_small', 'error', 'That amount is too small to trade.');
  END IF;
  IF v_set.max_trade_ugx IS NOT NULL AND v_ugx > v_set.max_trade_ugx THEN
    RETURN jsonb_build_object('success', false, 'code', 'trade_too_large', 'error', 'That is above the limit for a single trade.');
  END IF;

  -- ---- every check, before the first write -------------------------------------
  IF v_cash_bal IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'no_cash_wallet', 'error', 'No wallet found for currency: ' || v_cur);
  END IF;
  IF v_side = 'buy' AND v_cash_bal < v_local THEN
    RETURN jsonb_build_object('success', false, 'code', 'insufficient_funds',
      'error', format('Insufficient balance. You have %s %s, need %s', v_cash_bal, v_cur, v_local));
  END IF;
  IF v_side = 'sell' AND v_coin_bal < v_ican THEN
    RETURN jsonb_build_object('success', false, 'code', 'insufficient_coins',
      'error', format('Insufficient IcanEra balance. You have %s, need %s', v_coin_bal, v_ican));
  END IF;

  -- ---- the trade: all of it, in this one transaction ----------------------------
  IF v_side = 'buy' THEN
    UPDATE public.wallet_accounts SET balance = balance - v_local, updated_at = now()
     WHERE user_id = v_uid AND currency = v_cur RETURNING balance INTO v_new_cash;
    INSERT INTO public.ican_user_wallets (user_id) VALUES (v_uid) ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.ican_user_wallets
       SET ican_balance   = COALESCE(ican_balance, 0) + v_ican,
           total_earned   = COALESCE(total_earned, 0) + v_ican,
           purchase_count = COALESCE(purchase_count, 0) + 1
     WHERE user_id = v_uid RETURNING ican_balance INTO v_new_coin;
  ELSE
    UPDATE public.wallet_accounts SET balance = balance + v_local, updated_at = now()
     WHERE user_id = v_uid AND currency = v_cur RETURNING balance INTO v_new_cash;
    UPDATE public.ican_user_wallets
       SET ican_balance = COALESCE(ican_balance, 0) - v_ican,
           total_spent  = COALESCE(total_spent, 0) + v_ican,
           sale_count   = COALESCE(sale_count, 0) + 1
     WHERE user_id = v_uid RETURNING ican_balance INTO v_new_coin;
  END IF;

  INSERT INTO public.ican_coin_transactions
    (user_id, type, transaction_type, ican_amount, local_amount, country_code, currency, local_currency,
     price_per_coin, exchange_rate, payment_method, status, source_app, reference_id, "timestamp")
  VALUES
    (v_uid, CASE v_side WHEN 'buy' THEN 'purchase' ELSE 'sale' END,
     CASE v_side WHEN 'buy' THEN 'purchase' ELSE 'sale' END,
     v_ican, v_local, v_country, v_cur, v_cur,
     v_price, v_rate, CASE v_side WHEN 'buy' THEN COALESCE(p_payment_method, 'wallet_balance') ELSE NULL END,
     'completed', 'ican', p_request_id, now())
  RETURNING id INTO v_tx;

  v_result := jsonb_build_object(
    'success',           true,
    'side',              v_side,
    'ican_amount',       v_ican,
    'local_amount',      v_local,
    'currency',          v_cur,
    'price_per_coin',    v_price,
    'fx_rate_to_ugx',    v_rate,
    'total_ugx',         v_ugx,
    'new_ican_balance',  v_new_coin,
    'new_local_balance', v_new_cash,
    'transaction_id',    v_tx,
    'request_id',        p_request_id,
    'duplicate',         false
  );
  INSERT INTO public.ican_trade_requests (user_id, request_id, side, result)
  VALUES (v_uid, p_request_id, v_side, v_result);

  RETURN v_result;
END; $$;

REVOKE ALL ON FUNCTION public.ican_trade_execute(TEXT, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_trade_execute(TEXT, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT) TO authenticated;


-- 4. Tidy: an idempotency record is only needed while a client might still retry.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('icaneracoin-prune-trade-requests', '17 3 * * *',
      $job$DELETE FROM public.ican_trade_requests WHERE created_at < now() - INTERVAL '30 days'$job$);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'icaneracoin: could not schedule the nightly prune (%): old trade requests will just stay.', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
