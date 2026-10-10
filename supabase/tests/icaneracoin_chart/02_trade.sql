\set ON_ERROR_STOP on
-- Atomic trade: identity, server price and FX, exact balances, all-or-nothing failures, idempotent retries,
-- slippage, validation, the kill switch and the rate limit.

TRUNCATE public.ican_coin_transactions, public.ican_price_ohlc, public.ican_price_ticks, public.ican_trade_requests,
         public.ican_user_wallets, public.wallet_accounts;
DELETE FROM public.ican_price_cache;
SELECT public.ican_flush_price_ticks(TRUE, TRUE);

CREATE FUNCTION t.cash(n INT, c TEXT) RETURNS NUMERIC LANGUAGE sql AS $$ SELECT balance FROM public.wallet_accounts WHERE user_id = t.u(n) AND currency = c $$;
CREATE FUNCTION t.coins(n INT) RETURNS NUMERIC LANGUAGE sql AS $$ SELECT ican_balance FROM public.ican_user_wallets WHERE user_id = t.u(n) $$;
CREATE FUNCTION t.trade(n INT, p_side TEXT, p_amount NUMERIC, p_cur TEXT, p_rid TEXT, p_expected NUMERIC DEFAULT NULL, p_slip NUMERIC DEFAULT 1) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  PERFORM t.as_user(t.u(n));
  r := public.ican_trade_execute(p_side, p_amount, p_cur, 'UG', p_rid, p_expected, p_slip);
  PERFORM t.reset();
  RETURN r;
END; $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;

INSERT INTO auth.users (id, email) SELECT t.u(n), 'u' || n || '@test.dev' FROM generate_series(10, 16) n;
INSERT INTO public.wallet_accounts (user_id, balance, currency) VALUES
  (t.u(10), 100000, 'UGX'), (t.u(11), 100, 'USD'), (t.u(11), 0, 'UGX'), (t.u(13), 50000, 'UGX'), (t.u(14), 1000000, 'UGX'),
  (t.u(15), 500, 'UGX');
INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES (t.u(11), 10), (t.u(12), 5), (t.u(14), 0), (t.u(15), 2);
UPDATE public.ican_trade_settings SET trading_enabled = TRUE, max_trades_per_minute = 1000, max_trade_ugx = NULL;

-- ================================================================ 1. Who may call it
DO $t$
DECLARE r JSONB; e TEXT;
BEGIN
  PERFORM t.check('1.1 a signed-out visitor (anon) cannot execute the trade function',
    NOT has_function_privilege('anon', 'public.ican_trade_execute(text,numeric,text,text,text,numeric,numeric,text)', 'EXECUTE'));
  PERFORM t.check('1.2 a signed-in user can',
    has_function_privilege('authenticated', 'public.ican_trade_execute(text,numeric,text,text,text,numeric,numeric,text)', 'EXECUTE'));
  PERFORM t.as_anon();
  e := t.err($$SELECT public.ican_trade_execute('buy', 100, 'UGX', 'UG', 'req-anon-0001')$$);
  PERFORM t.check('1.3 anon is refused outright', e LIKE 'permission denied%', e);
  PERFORM t.reset();
  -- a token with no subject is not a person
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r := public.ican_trade_execute('buy', 100, 'UGX', 'UG', 'req-nosub-0001');
  PERFORM t.reset();
  PERFORM t.check('1.4 a session with no user id cannot trade', NOT (r ->> 'success')::BOOLEAN AND r ->> 'code' = 'not_signed_in', r::TEXT);
  PERFORM t.as_user(t.u(10));
  e := t.err($$SELECT count(*) FROM public.ican_trade_requests$$);
  PERFORM t.reset();
  PERFORM t.check('1.5 the idempotency table is not readable through the API, even by a signed-in user', e LIKE 'permission denied%', e);
END $t$;

-- ================================================================ 2. Buying
DO $t$
DECLARE r JSONB; cash0 NUMERIC := t.cash(10, 'UGX'); coins0 NUMERIC := COALESCE(t.coins(10), 0); price NUMERIC; rate NUMERIC; l public.ican_coin_transactions; cached NUMERIC;
BEGIN
  r := t.trade(10, 'buy', 11000, 'UGX', 'buy-test-0001');
  PERFORM t.check('2.1 a buy succeeds', (r ->> 'success')::BOOLEAN, r::TEXT);
  price := (r ->> 'price_per_coin')::NUMERIC;
  SELECT price_ugx INTO cached FROM public.ican_price_cache WHERE id;
  PERFORM t.check('2.2 it executes at the server''s price, not a price the caller chose', price = cached, price || ' vs ' || cached);
  PERFORM t.check('2.3 the cash wallet is debited exactly', t.cash(10, 'UGX') = cash0 - 11000, t.cash(10, 'UGX')::TEXT);
  PERFORM t.check('2.4 the coin wallet is credited exactly (truncated to 8 decimals)',
    t.coins(10) = coins0 + trunc(11000 / price, 8) AND (r ->> 'ican_amount')::NUMERIC = trunc(11000 / price, 8), t.coins(10)::TEXT);
  PERFORM t.check('2.5 the result reports the new balances', (r ->> 'new_local_balance')::NUMERIC = t.cash(10, 'UGX') AND (r ->> 'new_ican_balance')::NUMERIC = t.coins(10));
  SELECT * INTO l FROM public.ican_coin_transactions WHERE id = (r ->> 'transaction_id')::UUID;
  PERFORM t.check('2.6 one completed ledger row, written for the trader, like the old browser code wrote it',
    l.user_id = t.u(10) AND l.type = 'purchase' AND l.status = 'completed' AND l.ican_amount = (r ->> 'ican_amount')::NUMERIC
    AND l.local_amount = 11000 AND l.currency = 'UGX' AND l.price_per_coin = price AND l.reference_id = 'buy-test-0001', to_jsonb(l)::TEXT);
  PERFORM t.check('2.7 the wallet counters move (purchase_count, total_earned)',
    (SELECT purchase_count FROM public.ican_user_wallets WHERE user_id = t.u(10)) = 1
    AND (SELECT total_earned FROM public.ican_user_wallets WHERE user_id = t.u(10)) = t.coins(10));
  PERFORM t.check('2.8 the ledger insert logged exactly one tick for the chart', (SELECT count(*) FROM public.ican_price_ticks) = 1);

  -- a user with no coin wallet yet gets one
  r := t.trade(13, 'buy', 5000, 'UGX', 'buy-test-0002');
  PERFORM t.check('2.9 the first buy creates the coin wallet', (r ->> 'success')::BOOLEAN AND t.coins(13) = (r ->> 'ican_amount')::NUMERIC, r::TEXT);

  -- foreign currency uses the server's FX table (4,088.733 UGX per USD), not a hard-coded browser table
  r := t.trade(11, 'buy', 10, 'USD', 'buy-test-0003');
  price := (r ->> 'price_per_coin')::NUMERIC;
  SELECT rate_to_ugx INTO rate FROM public.ican_currency_rates WHERE currency_code = 'USD';
  PERFORM t.check('2.10 a USD buy converts at the server rate', (r ->> 'success')::BOOLEAN AND (r ->> 'ican_amount')::NUMERIC = trunc(10 * rate / price, 8) AND (r ->> 'fx_rate_to_ugx')::NUMERIC = rate, r::TEXT);
  PERFORM t.check('2.11 ...and debits the USD wallet only', t.cash(11, 'USD') = 90 AND t.cash(11, 'UGX') = 0);
END $t$;

-- ================================================================ 3. Selling
DO $t$
DECLARE r JSONB; price NUMERIC; rate NUMERIC; cash0 NUMERIC; l public.ican_coin_transactions;
BEGIN
  cash0 := t.cash(11, 'USD');
  r := t.trade(11, 'sell', 2.5, 'USD', 'sell-test-0001');
  price := (r ->> 'price_per_coin')::NUMERIC;
  SELECT rate_to_ugx INTO rate FROM public.ican_currency_rates WHERE currency_code = 'USD';
  PERFORM t.check('3.1 a sell succeeds', (r ->> 'success')::BOOLEAN, r::TEXT);
  PERFORM t.check('3.2 coins are debited exactly', t.coins(11) = 10 + (SELECT ican_amount FROM public.ican_coin_transactions WHERE reference_id = 'buy-test-0003') - 2.5, t.coins(11)::TEXT);
  PERFORM t.check('3.3 the cash payout is the server value, rounded DOWN to cents',
    t.cash(11, 'USD') = cash0 + trunc(2.5 * price / rate, 2) AND (r ->> 'local_amount')::NUMERIC = trunc(2.5 * price / rate, 2), r::TEXT);
  SELECT * INTO l FROM public.ican_coin_transactions WHERE reference_id = 'sell-test-0001';
  PERFORM t.check('3.4 the ledger row is a completed sale for the seller', l.user_id = t.u(11) AND l.type = 'sale' AND l.status = 'completed' AND l.ican_amount = 2.5, to_jsonb(l)::TEXT);
  PERFORM t.check('3.5 sale_count and total_spent move',
    (SELECT sale_count FROM public.ican_user_wallets WHERE user_id = t.u(11)) = 1
    AND (SELECT total_spent FROM public.ican_user_wallets WHERE user_id = t.u(11)) = 2.5);
END $t$;

-- ================================================================ 4. Refusals change nothing
DO $t$
DECLARE r JSONB; c10 NUMERIC; k10 NUMERIC; c12 NUMERIC; k12 NUMERIC; ledger INT; reqs INT; ticks INT;
BEGIN
  c10 := t.cash(10, 'UGX'); k10 := t.coins(10);
  SELECT count(*) INTO ledger FROM public.ican_coin_transactions;
  SELECT count(*) INTO reqs FROM public.ican_trade_requests;
  SELECT count(*) INTO ticks FROM public.ican_price_ticks;

  r := t.trade(10, 'buy', 999999999, 'UGX', 'refuse-test-01');
  PERFORM t.check('4.1 more cash than you have is refused with the familiar message',
    NOT (r ->> 'success')::BOOLEAN AND r ->> 'code' = 'insufficient_funds' AND r ->> 'error' LIKE 'Insufficient balance.%', r::TEXT);
  r := t.trade(11, 'sell', 500, 'USD', 'refuse-test-02');
  PERFORM t.check('4.2 more coins than you own is refused', NOT (r ->> 'success')::BOOLEAN AND r ->> 'code' = 'insufficient_coins' AND r ->> 'error' LIKE 'Insufficient IcanEra balance.%', r::TEXT);
  r := t.trade(12, 'sell', 1, 'UGX', 'refuse-test-03');
  PERFORM t.check('4.3 selling into a cash wallet that does not exist is refused', NOT (r ->> 'success')::BOOLEAN AND r ->> 'error' LIKE 'No wallet found for currency%', r::TEXT);
  r := t.trade(10, 'buy', 100, 'ZZZ', 'refuse-test-04');
  PERFORM t.check('4.4 an unknown currency is refused', NOT (r ->> 'success')::BOOLEAN AND r ->> 'code' = 'unsupported_currency', r::TEXT);
  r := t.trade(10, 'buy', 0.0000001, 'UGX', 'refuse-test-05');
  PERFORM t.check('4.5 an amount too small to buy anything is refused', NOT (r ->> 'success')::BOOLEAN AND r ->> 'code' = 'amount_too_small', r::TEXT);
  r := t.trade(16, 'buy', 100, 'UGX', 'refuse-test-06');
  PERFORM t.check('4.6 a user with no cash wallet at all is refused', NOT (r ->> 'success')::BOOLEAN AND r ->> 'error' LIKE 'No wallet found%', r::TEXT);

  PERFORM t.check('4.7 not one balance moved', t.cash(10, 'UGX') = c10 AND t.coins(10) = k10 AND t.coins(12) = 5);
  PERFORM t.check('4.8 no ledger row, no idempotency record, no tick', (SELECT count(*) FROM public.ican_coin_transactions) = ledger
    AND (SELECT count(*) FROM public.ican_trade_requests) = reqs AND (SELECT count(*) FROM public.ican_price_ticks) = ticks);
  PERFORM t.check('4.10 a refused first-time buyer is not left with an empty coin wallet', NOT EXISTS (SELECT 1 FROM public.ican_user_wallets WHERE user_id = t.u(16)));
  PERFORM t.check('4.9 a refused request id can be used again (nothing was recorded against it)',
    (t.trade(10, 'buy', 1000, 'UGX', 'refuse-test-01') ->> 'success')::BOOLEAN);
END $t$;

-- ================================================================ 5. Retries are harmless
DO $t$
DECLARE a JSONB; b JSONB; c JSONB; cash0 NUMERIC; ledger INT;
BEGIN
  cash0 := t.cash(14, 'UGX');
  a := t.trade(14, 'buy', 20000, 'UGX', 'retry-test-0001');
  SELECT count(*) INTO ledger FROM public.ican_coin_transactions;
  b := t.trade(14, 'buy', 20000, 'UGX', 'retry-test-0001');
  c := t.trade(14, 'buy', 99999, 'UGX', 'retry-test-0001');   -- even a different amount under the same id is the same action
  PERFORM t.check('5.1 the first call executes', (a ->> 'success')::BOOLEAN AND NOT (a ->> 'duplicate')::BOOLEAN, a::TEXT);
  PERFORM t.check('5.2 a retry returns the original result marked duplicate', (b ->> 'duplicate')::BOOLEAN AND b ->> 'transaction_id' = a ->> 'transaction_id', b::TEXT);
  PERFORM t.check('5.3 a retry with different numbers still returns the original', c ->> 'transaction_id' = a ->> 'transaction_id' AND (c ->> 'ican_amount') = (a ->> 'ican_amount'));
  PERFORM t.check('5.4 the cash was debited once', t.cash(14, 'UGX') = cash0 - 20000, t.cash(14, 'UGX')::TEXT);
  PERFORM t.check('5.5 only one ledger row exists for it', (SELECT count(*) FROM public.ican_coin_transactions) = ledger);
  PERFORM t.check('5.6 another user can reuse the same id (ids are per user)', (t.trade(15, 'buy', 100, 'UGX', 'retry-test-0001') ->> 'success')::BOOLEAN);
END $t$;

-- ================================================================ 6. Slippage
DO $t$
DECLARE r JSONB; price NUMERIC; cash0 NUMERIC := t.cash(14, 'UGX');
BEGIN
  SELECT price_ugx INTO price FROM public.ican_price_cache WHERE id;
  r := t.trade(14, 'buy', 5000, 'UGX', 'slip-test-0001', price * 0.90, 1);
  PERFORM t.check('6.1 a buy is refused when the price is more than the allowed slippage ABOVE what the screen showed',
    NOT (r ->> 'success')::BOOLEAN AND r ->> 'code' = 'price_moved' AND (r ->> 'price_ugx')::NUMERIC > 0, r::TEXT);
  PERFORM t.check('6.2 ...and nothing moved', t.cash(14, 'UGX') = cash0);
  r := t.trade(14, 'buy', 5000, 'UGX', 'slip-test-0002', price * 1.10, 1);
  PERFORM t.check('6.3 a buy is accepted when the price is BETTER than the screen showed', (r ->> 'success')::BOOLEAN, r::TEXT);
  r := t.trade(14, 'buy', 5000, 'UGX', 'slip-test-0003', price * 0.97, 5);
  PERFORM t.check('6.4 a wider tolerance accepts the same move', (r ->> 'success')::BOOLEAN, r::TEXT);
  r := t.trade(15, 'sell', 1, 'UGX', 'slip-test-0004', price * 1.10, 1);
  PERFORM t.check('6.5 a sell is refused when the price is BELOW what the screen showed', NOT (r ->> 'success')::BOOLEAN AND r ->> 'code' = 'price_moved', r::TEXT);
  r := t.trade(15, 'sell', 1, 'UGX', 'slip-test-0005', price * 0.90, 1);
  PERFORM t.check('6.6 a sell is accepted when the price is better', (r ->> 'success')::BOOLEAN, r::TEXT);
  r := t.trade(14, 'buy', 5000, 'UGX', 'slip-test-0006', NULL);
  PERFORM t.check('6.7 no expected price means no slippage check', (r ->> 'success')::BOOLEAN, r::TEXT);
END $t$;

-- ================================================================ 7. Bad input
DO $t$
DECLARE r JSONB; amounts NUMERIC[] := ARRAY[0, -5, NULL, 'NaN'::NUMERIC, 10000000000000]; i INT;
BEGIN
  r := t.trade(14, 'hold', 100, 'UGX', 'input-test-0001');
  PERFORM t.check('7.1 an unknown side is refused', NOT (r ->> 'success')::BOOLEAN AND r ->> 'code' = 'invalid_side');
  FOR i IN 1..5 LOOP
    r := t.trade(14, 'buy', amounts[i], 'UGX', 'input-test-bad' || i);
    PERFORM t.check('7.2.' || i || ' a zero, negative, null, NaN or absurd amount is refused', NOT (r ->> 'success')::BOOLEAN AND r ->> 'code' = 'invalid_amount', r::TEXT);
  END LOOP;
  r := t.trade(14, 'buy', 100, 'ugx', 'input-test-0002');
  PERFORM t.check('7.3 currency codes are case-insensitive', (r ->> 'success')::BOOLEAN, r::TEXT);
  r := t.trade(14, 'buy', 100, 'UGX; DROP TABLE x', 'input-test-0003');
  PERFORM t.check('7.4 a malformed currency is refused', NOT (r ->> 'success')::BOOLEAN AND r ->> 'code' = 'unsupported_currency');
  PERFORM t.check('7.5 an empty request id is refused', (t.trade(14, 'buy', 100, 'UGX', '') ->> 'code') = 'invalid_request_id');
  PERFORM t.check('7.6 a too-short request id is refused', (t.trade(14, 'buy', 100, 'UGX', 'short') ->> 'code') = 'invalid_request_id');
  PERFORM t.check('7.7 a too-long request id is refused', (t.trade(14, 'buy', 100, 'UGX', repeat('a', 101)) ->> 'code') = 'invalid_request_id');
  PERFORM t.check('7.8 a request id with odd characters is refused', (t.trade(14, 'buy', 100, 'UGX', 'has space here') ->> 'code') = 'invalid_request_id');
  PERFORM t.check('7.9 a NULL request id is refused', (t.trade(14, 'buy', 100, 'UGX', NULL) ->> 'code') = 'invalid_request_id');
  r := t.trade(14, 'buy', 100, 'UGX', 'input-test-0004', NULL, -3);
  PERFORM t.check('7.10 a negative slippage setting falls back to the default instead of failing', (r ->> 'success')::BOOLEAN, r::TEXT);
END $t$;

-- ================================================================ 8. Kill switch, ceiling, rate limit
DO $t$
DECLARE r JSONB; cash0 NUMERIC;
BEGIN
  UPDATE public.ican_trade_settings SET trading_enabled = FALSE;
  r := t.trade(14, 'buy', 1000, 'UGX', 'switch-test-0001');
  PERFORM t.check('8.1 with trading paused, a buy is refused', NOT (r ->> 'success')::BOOLEAN AND r ->> 'code' = 'trading_paused', r::TEXT);
  r := t.trade(15, 'sell', 1, 'UGX', 'switch-test-0002');
  PERFORM t.check('8.2 ...and so is a sell', r ->> 'code' = 'trading_paused');
  UPDATE public.ican_trade_settings SET trading_enabled = TRUE;
  r := t.trade(14, 'buy', 1000, 'UGX', 'switch-test-0001');
  PERFORM t.check('8.3 ...and the same request works once trading resumes', (r ->> 'success')::BOOLEAN, r::TEXT);

  UPDATE public.ican_trade_settings SET max_trade_ugx = 10000;
  r := t.trade(14, 'buy', 50000, 'UGX', 'ceiling-test-01');
  PERFORM t.check('8.4 a trade above the ceiling is refused', r ->> 'code' = 'trade_too_large', r::TEXT);
  r := t.trade(14, 'buy', 5000, 'UGX', 'ceiling-test-02');
  PERFORM t.check('8.5 a trade under it goes through', (r ->> 'success')::BOOLEAN, r::TEXT);
  UPDATE public.ican_trade_settings SET max_trade_ugx = NULL;

  DELETE FROM public.ican_trade_requests WHERE user_id = t.u(14);
  UPDATE public.ican_trade_settings SET max_trades_per_minute = 3;
  PERFORM t.trade(14, 'buy', 100, 'UGX', 'rate-test-00001');
  PERFORM t.trade(14, 'buy', 100, 'UGX', 'rate-test-00002');
  PERFORM t.trade(14, 'buy', 100, 'UGX', 'rate-test-00003');
  r := t.trade(14, 'buy', 100, 'UGX', 'rate-test-00004');
  PERFORM t.check('8.6 the fourth trade inside a minute is rate limited', r ->> 'code' = 'rate_limited', r::TEXT);
  r := t.trade(14, 'buy', 100, 'UGX', 'rate-test-00001');
  PERFORM t.check('8.7 a retry of an earlier one is still answered (retries are not rate limited)', (r ->> 'duplicate')::BOOLEAN, r::TEXT);
  r := t.trade(15, 'buy', 100, 'UGX', 'rate-test-00001');
  PERFORM t.check('8.8 the limit is per user: someone else is unaffected', (r ->> 'success')::BOOLEAN, r::TEXT);
  UPDATE public.ican_trade_settings SET max_trades_per_minute = 1000;
END $t$;

-- ================================================================ 9. Nobody else is touched; the books balance
DO $t$
DECLARE bad INT;
BEGIN
  PERFORM t.check('9.1 a user who traded nothing kept their balances', t.coins(12) = 5 AND t.cash(13, 'UGX') = 50000 - 5000);
  -- every coin wallet equals its opening balance plus what its own ledger rows say
  SELECT count(*) INTO bad
    FROM (VALUES (t.u(10), 0::NUMERIC), (t.u(11), 10), (t.u(12), 5), (t.u(13), 0), (t.u(14), 0), (t.u(15), 2)) o(uid, opening)
    JOIN public.ican_user_wallets w ON w.user_id = o.uid
   WHERE w.ican_balance <> o.opening + COALESCE((SELECT sum(CASE x.type WHEN 'purchase' THEN x.ican_amount ELSE -x.ican_amount END)
                                                   FROM public.ican_coin_transactions x WHERE x.user_id = o.uid), 0);
  PERFORM t.check('9.2 each wallet = its opening coins + its ledger (no coin created or lost)', bad = 0, bad::TEXT);
  PERFORM t.check('9.3 no balance anywhere is negative', NOT EXISTS (SELECT 1 FROM public.wallet_accounts WHERE balance < 0) AND NOT EXISTS (SELECT 1 FROM public.ican_user_wallets WHERE ican_balance < 0));
END $t$;
