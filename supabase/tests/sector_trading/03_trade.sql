\set ON_ERROR_STOP on
-- Buying and selling: exact money, server price, all-or-nothing failures, idempotent retries, slippage, limits, the
-- vault guards, money wallets in other currencies, a user's own view, and the operator controls.

TRUNCATE icanera_trading.telemetry_events, icanera_trading.contributor_buckets, icanera_trading.sector_index_cache,
         icanera_trading.sector_index_candles, icanera_trading.vault_entries, icanera_trading.sector_fills,
         icanera_trading.sector_holdings, icanera_trading.trade_requests, icanera_trading.sector_exposure;
UPDATE icanera_trading.vault_cache SET balance = 0;
UPDATE icanera_trading.fold_state SET folded_at = NULL, last_bucket = NULL, ledger_txid = '0'::xid8;
TRUNCATE public.ican_user_wallets, public.wallet_accounts;
DELETE FROM public.ican_price_cache;
SELECT public.ican_flush_price_ticks(TRUE, TRUE);

UPDATE icanera_trading.sector_settings SET trading_enabled = TRUE, fee_bps = 100, max_trades_per_minute = 1000, max_trade_icec = 100,
  max_position_icec = 1000, stress_pct = 50, k_min = 3, stale_s = 120, ema_minutes = 30, max_move_pct_per_hour = 10, window_hours = 24;

CREATE FUNCTION t.st(n INT, p_side TEXT, p_amount NUMERIC, p_cur TEXT, p_rid TEXT, p_sector TEXT DEFAULT 'iRETL',
                     p_expected NUMERIC DEFAULT NULL, p_slip NUMERIC DEFAULT 1) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  PERFORM t.as_user(t.u(n));
  r := public.ican_sector_trade(p_sector, p_side, p_amount, p_cur, p_rid, p_expected, p_slip);
  PERFORM t.reset();
  RETURN r;
END; $$;
CREATE FUNCTION t.icec(n INT) RETURNS NUMERIC LANGUAGE sql AS $$ SELECT ican_balance FROM public.ican_user_wallets WHERE user_id = t.u(n) $$;
CREATE FUNCTION t.cash(n INT, c TEXT) RETURNS NUMERIC LANGUAGE sql AS $$ SELECT balance FROM public.wallet_accounts WHERE user_id = t.u(n) AND currency = c $$;
CREATE FUNCTION t.held(n INT, tick TEXT DEFAULT 'iRETL') RETURNS NUMERIC LANGUAGE sql AS $$ SELECT COALESCE((SELECT units FROM icanera_trading.sector_holdings WHERE user_id = t.u(n) AND sector = tick), 0) $$;
CREATE FUNCTION t.vault() RETURNS NUMERIC LANGUAGE sql AS $$ SELECT icanera_trading.vault_balance() $$;
CREATE FUNCTION t.nfills() RETURNS BIGINT LANGUAGE sql AS $$ SELECT count(*) FROM icanera_trading.sector_fills $$;
CREATE FUNCTION t.setp(tick TEXT, lvl NUMERIC) RETURNS VOID LANGUAGE sql AS $$
  UPDATE icanera_trading.sector_index_cache SET level = lvl, price_icec = round(lvl / 100, 6), computed_at = clock_timestamp(), status = 'live' WHERE ticker = tick $$;
CREATE FUNCTION t.rec() RETURNS JSONB LANGUAGE sql AS $$ SELECT public.ican_sector_dev_reconcile('dev_test_secret') $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;

-- a live iRETL (5 contributors) and a warming iAGRI (2 of 3)
SELECT t.ev('iRETL', 'tr' || n, 100) FROM generate_series(1, 5) n;
SELECT t.ev('iAGRI', 'ta', 100); SELECT t.ev('iAGRI', 'tb', 100);
SELECT t.fold();
-- from here the tests set the index price by hand, so the on-demand fold is held off
UPDATE icanera_trading.fold_state SET folded_at = clock_timestamp() + INTERVAL '1 day';
SELECT t.setp('iRETL', 100);

INSERT INTO auth.users (id, email) SELECT t.u(n), 'u' || n || '@test.dev' FROM generate_series(30, 40) n ON CONFLICT DO NOTHING;
INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES (t.u(30), 50), (t.u(32), 5), (t.u(33), 200), (t.u(34), 1000), (t.u(36), 20), (t.u(39), 10);
INSERT INTO public.wallet_accounts (user_id, balance, currency) VALUES (t.u(31), 100000, 'UGX'), (t.u(31), 100, 'USD'), (t.u(38), 10, 'UGX');
-- the vault starts with 100 ICEC from the treasury
SELECT public.ican_sector_dev_vault_adjust('dev_test_secret', 100, 'opening balance for the tests');

-- ================================================================ 1. Who may call it
DO $t$
DECLARE r JSONB; e TEXT;
BEGIN
  PERFORM t.check('1.1 anon cannot execute the trade', NOT has_function_privilege('anon', 'public.ican_sector_trade(text,text,numeric,text,text,numeric,numeric)', 'EXECUTE'));
  PERFORM t.check('1.2 a signed-in user can', has_function_privilege('authenticated', 'public.ican_sector_trade(text,text,numeric,text,text,numeric,numeric)', 'EXECUTE'));
  PERFORM t.as_anon();
  e := t.err($$SELECT public.ican_sector_trade('iRETL','buy',1,'ICEC','req-anon-0001')$$);
  PERFORM t.reset();
  PERFORM t.check('1.3 anon is refused outright', e LIKE 'permission denied%', e);
  PERFORM set_config('request.jwt.claim.sub', '', true); PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r := public.ican_sector_trade('iRETL','buy',1,'ICEC','req-nosub-0001');
  PERFORM t.reset();
  PERFORM t.check('1.4 a session with no user id cannot trade', r ->> 'code' = 'not_signed_in', r::TEXT);
  PERFORM t.as_user(t.u(30));
  e := t.err($$SELECT public.ican_sector_dev_overview('wrong-token')$$);
  PERFORM t.reset();
  PERFORM t.check('1.5 the operator functions refuse a wrong token', e = 'unauthorized', e);
  PERFORM t.as_user(t.u(30));
  r := public.ican_sector_dev_overview('dev_test_secret');
  PERFORM t.reset();
  PERFORM t.check('1.6 ...and accept the right one', (r -> 'vault' ->> 'balance_icec')::NUMERIC = 100, (r -> 'vault')::TEXT);
  PERFORM t.check('1.7 anon cannot even reach the operator functions', NOT has_function_privilege('anon', 'public.ican_sector_dev_overview(text)', 'EXECUTE'));
END $t$;

-- ================================================================ 2. Validation, and nothing changes on a refusal
DO $t$
DECLARE r JSONB; n0 BIGINT := t.nfills(); b0 NUMERIC := t.icec(30); v0 NUMERIC := t.vault(); rid INT := 0; x RECORD;
BEGIN
  FOR x IN SELECT * FROM (VALUES
      ('sell-first side',  'hold',  10::NUMERIC, 'ICEC', 'iRETL', 'invalid_side'),
      ('zero amount',      'buy',    0,          'ICEC', 'iRETL', 'invalid_amount'),
      ('negative amount',  'buy',   -5,          'ICEC', 'iRETL', 'invalid_amount'),
      ('NaN amount',       'buy',   'NaN',       'ICEC', 'iRETL', 'invalid_amount'),
      ('absurd amount',    'buy',    1e13,       'ICEC', 'iRETL', 'invalid_amount'),
      ('bad ticker shape', 'buy',    10,         'ICEC', 'RETL',  'invalid_sector'),
      ('unknown ticker',   'buy',    10,         'ICEC', 'iZZZZ', 'invalid_sector'),
      ('bad currency',     'buy',    10,         'U$',   'iRETL', 'unsupported_currency'),
      ('currency with a rate but no wallet', 'buy', 10, 'NGN', 'iRETL', 'no_cash_wallet'),
      ('currency with no rate', 'buy', 10,       'XXX',  'iRETL', 'unsupported_currency'),
      ('warming sector',   'buy',    10,         'ICEC', 'iAGRI', 'sector_not_live')
    ) v(label, side, amt, cur, sec, expect)
  LOOP
    rid := rid + 1;
    r := t.st(30, x.side, x.amt, x.cur, 'validate-' || rid || '-xxxx', x.sec);
    PERFORM t.check('2.' || rid || ' ' || x.label || ' -> ' || x.expect, NOT (r ->> 'success')::BOOLEAN AND r ->> 'code' = x.expect, r::TEXT);
  END LOOP;
  r := t.st(30, 'buy', 10, 'ICEC', 'short');
  PERFORM t.check('2.20 a request id that is too short is refused', r ->> 'code' = 'invalid_request_id', r::TEXT);
  r := t.st(30, 'buy', 10, 'ICEC', 'bad id with spaces!');
  PERFORM t.check('2.21 ...or with odd characters', r ->> 'code' = 'invalid_request_id', r::TEXT);
  PERFORM t.check('2.22 not one of those refusals changed a balance, a fill, the vault or the idempotency table',
    t.icec(30) = b0 AND t.nfills() = n0 AND t.vault() = v0 AND NOT EXISTS (SELECT 1 FROM icanera_trading.trade_requests));
END $t$;

-- ================================================================ 3. A buy, to the last digit
DO $t$
DECLARE r JSONB; f icanera_trading.sector_fills;
BEGIN
  r := t.st(30, 'buy', 10, 'ICEC', 'buy-test-0001');       -- price 1.00, fee 1%
  PERFORM t.check('3.1 a buy succeeds', (r ->> 'success')::BOOLEAN, r::TEXT);
  PERFORM t.check('3.2 10 ICEC at 1.00 with a 1% fee: fee 0.1, collateral 9.9, units 9.9',
    (r ->> 'fee_icec')::NUMERIC = 0.1 AND (r ->> 'net_icec')::NUMERIC = 9.9 AND (r ->> 'units')::NUMERIC = 9.9 AND (r ->> 'gross_icec')::NUMERIC = 10, r::TEXT);
  PERFORM t.check('3.3 the user paid exactly 10 ICEC', t.icec(30) = 40);
  PERFORM t.check('3.4 and holds exactly 9.9 units', t.held(30) = 9.9);
  PERFORM t.check('3.5 the vault took the collateral and the fee (110)', t.vault() = 110, t.vault()::TEXT);
  SELECT * INTO f FROM icanera_trading.sector_fills WHERE request_id = 'buy-test-0001';
  PERFORM t.check('3.6 there is one immutable fill with the cost basis', f.side = 'buy' AND f.cost_basis_icec = 10 AND f.price_icec = 1 AND f.pay_currency = 'ICEC', f::TEXT);
  PERFORM t.check('3.7 and its two vault entries (+9.9 collateral, +0.1 fee)',
    (SELECT sum(amount) FROM icanera_trading.vault_entries WHERE fill_id = f.id) = 10
    AND (SELECT count(*) FROM icanera_trading.vault_entries WHERE fill_id = f.id) = 2);
  PERFORM t.check('3.8 the holding carries the cost', (SELECT cost_icec FROM icanera_trading.sector_holdings WHERE user_id = t.u(30)) = 10);
  PERFORM t.check('3.9 the main coin ledger is untouched (the price engine must not count sector trades as usage)',
    NOT EXISTS (SELECT 1 FROM public.ican_coin_transactions));
END $t$;

-- ================================================================ 4. Selling at a profit, in full and in part
DO $t$
DECLARE r JSONB; f icanera_trading.sector_fills;
BEGIN
  PERFORM t.setp('iRETL', 120);                              -- the sector grew 20%
  r := t.st(30, 'sell', 9.9, 'ICEC', 'sell-test-0001');
  PERFORM t.check('4.1 selling everything succeeds', (r ->> 'success')::BOOLEAN, r::TEXT);
  PERFORM t.check('4.2 gross 9.9 x 1.2 = 11.88, fee 0.1188, paid 11.7612',
    (r ->> 'gross_icec')::NUMERIC = 11.88 AND (r ->> 'fee_icec')::NUMERIC = 0.1188 AND (r ->> 'net_icec')::NUMERIC = 11.7612, r::TEXT);
  PERFORM t.check('4.3 the user''s ICEC is 40 + 11.7612', t.icec(30) = 51.7612, t.icec(30)::TEXT);
  PERFORM t.check('4.4 nothing left in the holding, cost basis cleared exactly',
    t.held(30) = 0 AND (SELECT cost_icec FROM icanera_trading.sector_holdings WHERE user_id = t.u(30)) = 0);
  PERFORM t.check('4.5 the vault paid out the net: 110 - 11.7612', t.vault() = 98.2388, t.vault()::TEXT);
  SELECT * INTO f FROM icanera_trading.sector_fills WHERE request_id = 'sell-test-0001';
  PERFORM t.check('4.6 the sell fill records the cost it released (10)', f.side = 'sell' AND f.cost_basis_icec = 10 AND f.net_icec = 11.7612, f::TEXT);

  -- a partial sell releases cost pro rata
  r := t.st(30, 'buy', 20, 'ICEC', 'buy-test-0002');         -- at 1.2: fee 0.2, collateral 19.8, units 16.5
  PERFORM t.check('4.7 20 ICEC at 1.2 buys 16.5 units', (r ->> 'units')::NUMERIC = 16.5, r::TEXT);
  r := t.st(30, 'sell', 5, 'ICEC', 'sell-test-0002');
  PERFORM t.check('4.8 selling 5 of 16.5 pays 6.00 - 1% = 5.94', (r ->> 'net_icec')::NUMERIC = 5.94, r::TEXT);
  PERFORM t.check('4.9 11.5 units remain', t.held(30) = 11.5);
  PERFORM t.check('4.10 cost basis released pro rata: 20 x 5 / 16.5 = 6.06060606, leaving 13.93939394',
    (SELECT cost_basis_icec FROM icanera_trading.sector_fills WHERE request_id = 'sell-test-0002') = 6.06060606
    AND (SELECT cost_icec FROM icanera_trading.sector_holdings WHERE user_id = t.u(30)) = 13.93939394);
  PERFORM t.check('4.11 selling more than is held is refused, and changes nothing',
    t.st(30, 'sell', 11.50000001, 'ICEC', 'sell-test-0003') ->> 'code' = 'insufficient_units' AND t.held(30) = 11.5);
  PERFORM t.check('4.12 the books balance', (t.rec() ->> 'ok')::BOOLEAN, t.rec()::TEXT);
END $t$;

-- ================================================================ 5. Slippage
DO $t$
DECLARE r JSONB; h0 NUMERIC := t.held(30); c0 NUMERIC := t.icec(30);
BEGIN
  -- the price is 1.2
  r := t.st(30, 'buy', 5, 'ICEC', 'slip-test-0001', 'iRETL', 1.0, 1);
  PERFORM t.check('5.1 a buy when the price rose past the tolerance (showed 1.00, now 1.20) is refused', r ->> 'code' = 'price_moved' AND (r ->> 'price_icec')::NUMERIC = 1.2, r::TEXT);
  r := t.st(30, 'sell', 1, 'ICEC', 'slip-test-0002', 'iRETL', 1.5, 1);
  PERFORM t.check('5.2 a sell when the price fell past the tolerance (showed 1.50, now 1.20) is refused', r ->> 'code' = 'price_moved', r::TEXT);
  PERFORM t.check('5.3 refusals changed nothing', t.held(30) = h0 AND t.icec(30) = c0);
  r := t.st(30, 'buy', 5, 'ICEC', 'slip-test-0003', 'iRETL', 1.195, 1);
  PERFORM t.check('5.4 a move inside the tolerance (1.195 -> 1.20 is 0.4%) goes through', (r ->> 'success')::BOOLEAN, r::TEXT);
  r := t.st(30, 'buy', 5, 'ICEC', 'slip-test-0004', 'iRETL', 2.0, 1);
  PERFORM t.check('5.5 a BETTER price than shown is always accepted', (r ->> 'success')::BOOLEAN, r::TEXT);
  r := t.st(30, 'sell', 1, 'ICEC', 'slip-test-0005', 'iRETL', 1.0, 1);
  PERFORM t.check('5.6 ...on the sell side too', (r ->> 'success')::BOOLEAN, r::TEXT);
  r := t.st(30, 'buy', 5, 'ICEC', 'slip-test-0006', 'iRETL', 1.0, 99);
  PERFORM t.check('5.7 an absurd tolerance is treated as 1%, not honoured', r ->> 'code' = 'price_moved', r::TEXT);
END $t$;

-- ================================================================ 6. A retry is harmless
DO $t$
DECLARE r1 JSONB; r2 JSONB; n0 BIGINT; c0 NUMERIC; v0 NUMERIC;
BEGIN
  r1 := t.st(33, 'buy', 30, 'ICEC', 'retry-test-0001');
  n0 := t.nfills(); c0 := t.icec(33); v0 := t.vault();
  PERFORM t.setp('iRETL', 150);                              -- the price moves between the attempt and the retry
  r2 := t.st(33, 'buy', 30, 'ICEC', 'retry-test-0001');
  PERFORM t.check('6.1 the same request id returns the first answer, flagged duplicate',
    (r2 ->> 'duplicate')::BOOLEAN AND r2 ->> 'fill_id' = r1 ->> 'fill_id' AND (r2 ->> 'units') = (r1 ->> 'units'), r2::TEXT);
  PERFORM t.check('6.2 and moved nothing, though the price is different now', t.nfills() = n0 AND t.icec(33) = c0 AND t.vault() = v0);
  r2 := t.st(33, 'sell', 1, 'ICEC', 'retry-test-0001');
  PERFORM t.check('6.3 even a retry with different parameters gets the original result, not a new trade', (r2 ->> 'duplicate')::BOOLEAN AND t.nfills() = n0);
  r2 := t.st(34, 'buy', 30, 'ICEC', 'retry-test-0001');
  PERFORM t.check('6.4 another user can use the same request id independently', (r2 ->> 'success')::BOOLEAN AND NOT (r2 ->> 'duplicate')::BOOLEAN, r2::TEXT);
  PERFORM t.setp('iRETL', 120);
END $t$;

-- ================================================================ 7. Failures leave no trace
DO $t$
DECLARE r JSONB; n0 BIGINT; v0 NUMERIC; c0 NUMERIC; q0 BIGINT; h0 NUMERIC;
BEGIN
  n0 := t.nfills(); v0 := t.vault(); c0 := t.icec(32); q0 := (SELECT count(*) FROM icanera_trading.trade_requests); h0 := t.held(32);
  r := t.st(32, 'buy', 6, 'ICEC', 'fail-test-0001');         -- has 5
  PERFORM t.check('7.1 not enough ICEC -> insufficient_funds', r ->> 'code' = 'insufficient_funds', r::TEXT);
  r := t.st(32, 'sell', 1, 'ICEC', 'fail-test-0002');        -- holds none
  PERFORM t.check('7.2 selling what you do not hold -> insufficient_units', r ->> 'code' = 'insufficient_units', r::TEXT);
  r := t.st(32, 'buy', 0.00000001, 'ICEC', 'fail-test-0003');        -- 1e-8 ICEC buys less than 1e-8 of a 1.2 unit
  PERFORM t.check('7.3 a dust amount that buys less than the smallest unit -> amount_too_small', r ->> 'code' = 'amount_too_small', r::TEXT);
  r := t.st(35, 'buy', 1, 'ICEC', 'fail-test-0004');         -- no wallet at all
  PERFORM t.check('7.4 a user with no coin wallet cannot buy', r ->> 'code' = 'insufficient_funds', r::TEXT);
  PERFORM t.check('7.5 and none of it touched a balance, a fill, the vault, a holding or the idempotency table',
    t.nfills() = n0 AND t.vault() = v0 AND t.icec(32) = c0 AND t.held(32) = h0
    AND (SELECT count(*) FROM icanera_trading.trade_requests) = q0 AND NOT EXISTS (SELECT 1 FROM public.ican_user_wallets WHERE user_id = t.u(35)));
  r := t.st(35, 'sell', 1, 'ICEC', 'fail-test-0005');
  PERFORM t.check('7.6 a failed sell does not create a wallet row either', r ->> 'code' = 'insufficient_units' AND NOT EXISTS (SELECT 1 FROM public.ican_user_wallets WHERE user_id = t.u(35)));
END $t$;

-- ================================================================ 8. Limits
DO $t$
DECLARE r JSONB;
BEGIN
  r := t.st(34, 'buy', 100.00000001, 'ICEC', 'limit-test-0001');
  PERFORM t.check('8.1 above the per-trade ceiling -> trade_too_large', r ->> 'code' = 'trade_too_large', r::TEXT);
  r := t.st(34, 'buy', 100, 'ICEC', 'limit-test-0002');
  PERFORM t.check('8.2 exactly at the ceiling is fine', (r ->> 'success')::BOOLEAN, r::TEXT);
  UPDATE icanera_trading.sector_settings SET max_position_icec = 150;
  r := t.st(34, 'buy', 21, 'ICEC', 'limit-test-0003');       -- already 30 (earlier) + 100 = 130 at cost
  PERFORM t.check('8.3 above the per-sector position ceiling (130 + 21 > 150) -> position_too_large', r ->> 'code' = 'position_too_large', r::TEXT);
  r := t.st(34, 'buy', 20, 'ICEC', 'limit-test-0004');
  PERFORM t.check('8.4 right up to it (130 + 20 = 150) is fine', (r ->> 'success')::BOOLEAN, r::TEXT);
  UPDATE icanera_trading.sector_settings SET max_position_icec = 1000;
  PERFORM t.check('8.5 the ceiling is on cost, so selling frees room again',
    (t.st(34, 'sell', 10, 'ICEC', 'limit-test-0005') ->> 'success')::BOOLEAN);
END $t$;

-- ================================================================ 9. The vault guards
DO $t$
DECLARE r JSONB; v NUMERIC; e NUMERIC; ratio NUMERIC; ov JSONB;
BEGIN
  v := t.vault(); e := icanera_trading.exposure_icec();
  PERFORM t.check('9.1 exposure is what users hold at today''s prices', e = round(
    (SELECT sum(units) FROM icanera_trading.sector_holdings WHERE sector = 'iRETL') * 1.2, 6) OR abs(e - (SELECT sum(units) FROM icanera_trading.sector_holdings WHERE sector = 'iRETL') * 1.2) < 0.0001,
    format('%s', e));

  -- stress: shrink the vault so a further buy would leave it below exposure x 1.5
  PERFORM public.ican_sector_dev_vault_adjust('dev_test_secret', -(v - e * 1.5 - 5), 'test: leave 5 ICEC of headroom');
  r := t.st(33, 'buy', 3, 'ICEC', 'vault-test-0001');
  PERFORM t.check('9.2 a buy that fits inside the stress margin goes through', (r ->> 'success')::BOOLEAN, r::TEXT);
  r := t.st(33, 'buy', 90, 'ICEC', 'vault-test-0002');
  PERFORM t.check('9.3 a buy that would breach it -> capacity_reached', r ->> 'code' = 'capacity_reached', r::TEXT);
  PERFORM t.check('9.4 ...and left nothing behind', NOT EXISTS (SELECT 1 FROM icanera_trading.sector_fills WHERE request_id = 'vault-test-0002'));
  PERFORM t.check('9.5 selling is never blocked by the stress margin', (t.st(33, 'sell', 1, 'ICEC', 'vault-test-0003') ->> 'success')::BOOLEAN);

  -- the operator cannot withdraw what users need
  ov := public.ican_sector_dev_overview('dev_test_secret');
  PERFORM t.check('9.6 the overview shows the cover ratio and the one required', (ov -> 'vault' ->> 'cover_ratio')::NUMERIC >= 1.5 AND (ov -> 'vault' ->> 'required_ratio')::NUMERIC = 1.5, (ov -> 'vault')::TEXT);
  PERFORM t.check('9.7 a withdrawal that would break the margin is refused',
    t.err($$SELECT public.ican_sector_dev_vault_adjust('dev_test_secret', -1000, 'too much')$$) LIKE '%below what users hold%');
  PERFORM t.check('9.8 an adjustment needs a reason', t.err($$SELECT public.ican_sector_dev_vault_adjust('dev_test_secret', 5, '')$$) LIKE '%memo%');
  PERFORM t.check('9.9 and a zero amount is refused', t.err($$SELECT public.ican_sector_dev_vault_adjust('dev_test_secret', 0, 'nothing')$$) LIKE '%non-zero%');

  -- the operator cannot empty a vault that users depend on. (Its own sub-block: the refusal rolls back only itself,
  -- never the checks recorded above.)
  BEGIN
    PERFORM public.ican_sector_dev_vault_adjust('dev_test_secret', -(t.vault() - 1), 'test: empty the vault');
    PERFORM t.check('9.10 the operator cannot empty a vault that users depend on', FALSE, 'the withdrawal was allowed');
  EXCEPTION WHEN OTHERS THEN
    PERFORM t.check('9.10 the operator cannot empty a vault that users depend on', SQLERRM LIKE '%below what users hold%', SQLERRM);
  END;
END $t$;

DO $t$
DECLARE r JSONB; held NUMERIC;
BEGIN
  -- force the situation directly (a ledger entry the operator tooling would refuse): the vault is short
  INSERT INTO icanera_trading.vault_entries (kind, amount, memo) VALUES ('adjustment', -(t.vault() - 0.5), 'test: simulate a vault that lost money');
  held := t.held(33);
  r := t.st(33, 'sell', held, 'ICEC', 'vault-test-0004');
  PERFORM t.check('9.11 a sell the vault cannot pay -> vault_insufficient, and the user keeps their units', r ->> 'code' = 'vault_insufficient' AND t.held(33) = held, r::TEXT);
  PERFORM t.check('9.12 buying is closed too while the vault is short (capacity)', t.st(33, 'buy', 1, 'ICEC', 'vault-test-0005') ->> 'code' = 'capacity_reached');
  PERFORM public.ican_sector_dev_vault_adjust('dev_test_secret', 500, 'test: top up again');
  r := t.st(33, 'sell', held, 'ICEC', 'vault-test-0006');
  PERFORM t.check('9.13 once the vault is funded the same sell goes through', (r ->> 'success')::BOOLEAN, r::TEXT);
END $t$;

-- ================================================================ 10. Money wallets in other currencies
DO $t$
DECLARE r JSONB; P NUMERIC; rate_usd NUMERIC; pay NUMERIC; fee NUMERIC; net NUMERIC; units NUMERIC; before NUMERIC; got NUMERIC;
BEGIN
  SELECT price_ugx INTO P FROM public.ican_price_cache WHERE id;
  PERFORM t.setp('iRETL', 100);
  -- buy with 20,000 UGX
  pay := trunc(20000 * 1 / P, 8); fee := trunc(pay * 100 / 10000, 8); net := pay - fee; units := trunc(net / 1.0, 8);
  r := t.st(31, 'buy', 20000, 'UGX', 'fiat-test-0001');
  PERFORM t.check('10.1 buying with UGX succeeds', (r ->> 'success')::BOOLEAN, r::TEXT);
  PERFORM t.check('10.2 exactly 20,000 UGX left the wallet', t.cash(31, 'UGX') = 80000, t.cash(31, 'UGX')::TEXT);
  PERFORM t.check('10.3 it bought units from the ICEC value of the money at the server price and rate',
    (r ->> 'units')::NUMERIC = units AND (r ->> 'gross_icec')::NUMERIC = pay AND (r ->> 'pay_amount')::NUMERIC = 20000 AND t.held(31) = units, format('%s vs %s', r ->> 'units', units));
  PERFORM t.check('10.4 the user''s ICEC wallet was not touched (the money bought the units directly)', NOT EXISTS (SELECT 1 FROM public.ican_user_wallets WHERE user_id = t.u(31)));
  PERFORM t.check('10.5 the vault holds the ICEC value (collateral + fee = pay)',
    (SELECT sum(amount) FROM icanera_trading.vault_entries WHERE fill_id = (r ->> 'fill_id')::UUID) = pay);

  -- sell into USD at a 20% higher index
  PERFORM t.setp('iRETL', 120);
  SELECT rate_to_ugx INTO rate_usd FROM public.ican_currency_rates WHERE currency_code = 'USD';
  before := t.cash(31, 'USD');
  r := t.st(31, 'sell', units, 'USD', 'fiat-test-0002');
  got := trunc((r ->> 'net_icec')::NUMERIC * P / rate_usd, 2);
  PERFORM t.check('10.6 selling into a USD wallet succeeds', (r ->> 'success')::BOOLEAN, r::TEXT);
  PERFORM t.check('10.7 the USD credited is net ICEC x coin price / USD rate, to the cent', t.cash(31, 'USD') = before + got AND (r ->> 'pay_amount')::NUMERIC = got, format('%s vs %s', t.cash(31, 'USD'), before + got));
  PERFORM t.check('10.8 everything was sold', t.held(31) = 0);

  r := t.st(31, 'buy', 1000, 'USD', 'fiat-test-0003');       -- has ~100 USD; 1000 USD is 4M UGX = ~800 ICEC (also over the trade ceiling)
  PERFORM t.check('10.9 a money amount over the ceiling is stopped on its ICEC value', r ->> 'code' = 'trade_too_large', r::TEXT);
  r := t.st(38, 'buy', 11, 'UGX', 'fiat-test-0004');          -- has 10 UGX
  PERFORM t.check('10.10 not enough money -> insufficient_funds', r ->> 'code' = 'insufficient_funds', r::TEXT);
  PERFORM t.check('10.11 the books balance after money-wallet trades too', (t.rec() ->> 'ok')::BOOLEAN, t.rec()::TEXT);
  PERFORM t.setp('iRETL', 120);
END $t$;

-- ================================================================ 11. A user sees only their own position
DO $t$
DECLARE r JSONB; fl JSONB;
BEGIN
  PERFORM t.st(36, 'buy', 10, 'ICEC', 'view-test-0001');     -- price 1.2: units 8.25, cost 10
  PERFORM t.as_user(t.u(36));
  r := public.ican_sector_my_holdings();
  PERFORM t.reset();
  PERFORM t.check('11.1 my holdings lists exactly my sector', jsonb_array_length(r -> 'holdings') = 1 AND r -> 'holdings' -> 0 ->> 'sector' = 'iRETL', r::TEXT);
  PERFORM t.check('11.2 with units 8.25, cost 10, value 9.9 (8.25 x 1.2) and a -0.1 result',
    (r -> 'holdings' -> 0 ->> 'units')::NUMERIC = 8.25 AND (r -> 'holdings' -> 0 ->> 'cost_icec')::NUMERIC = 10
    AND (r -> 'holdings' -> 0 ->> 'value_icec')::NUMERIC = 9.9 AND (r -> 'holdings' -> 0 ->> 'pnl_icec')::NUMERIC = -0.1, (r -> 'holdings' -> 0)::TEXT);
  PERFORM t.as_user(t.u(36));
  fl := public.ican_sector_my_fills(10);
  PERFORM t.reset();
  PERFORM t.check('11.3 my fills show my trade and nobody else''s', jsonb_array_length(fl -> 'fills') = 1 AND (fl -> 'fills' -> 0 ->> 'units')::NUMERIC = 8.25, fl::TEXT);
  PERFORM t.check('11.4 fills carry no user id', fl::TEXT !~* 'user_id');
  PERFORM t.as_user(t.u(37));
  r := public.ican_sector_my_holdings();
  PERFORM t.reset();
  PERFORM t.check('11.5 someone with no position sees none', jsonb_array_length(r -> 'holdings') = 0, r::TEXT);
  PERFORM t.as_anon();
  PERFORM t.check('11.6 a signed-out visitor cannot read positions', NOT has_function_privilege('anon', 'public.ican_sector_my_holdings()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.ican_sector_my_fills(int,timestamptz)', 'EXECUTE'));
  PERFORM t.reset();
END $t$;

-- ================================================================ 12. Switches
DO $t$
DECLARE r JSONB; e TEXT; v0 BIGINT; h0 NUMERIC;
BEGIN
  v0 := (SELECT feed_version FROM icanera_trading.fold_state);
  r := public.ican_sector_dev_set_settings('dev_test_secret', '{"trading_enabled": false}');
  PERFORM t.check('12.1 the kill switch is a setting', NOT (r ->> 'trading_enabled')::BOOLEAN, r::TEXT);
  PERFORM t.check('12.2 it bumps the feed version so open screens notice', (SELECT feed_version FROM icanera_trading.fold_state) > v0);
  h0 := t.held(36);
  PERFORM t.check('12.3 while it is off, buys are refused', t.st(36, 'buy', 1, 'ICEC', 'switch-test-0001') ->> 'code' = 'trading_paused');
  PERFORM t.check('12.4 ...and sells too (everything pauses together)', t.st(36, 'sell', 1, 'ICEC', 'switch-test-0002') ->> 'code' = 'trading_paused' AND t.held(36) = h0);
  PERFORM public.ican_sector_dev_set_settings('dev_test_secret', '{"trading_enabled": true}');
  PERFORM t.check('12.5 and it comes back', (t.st(36, 'sell', 1, 'ICEC', 'switch-test-0003') ->> 'success')::BOOLEAN);

  e := t.err($$SELECT public.ican_sector_dev_set_settings('dev_test_secret', '{"drop_everything": 1}')$$);
  PERFORM t.check('12.6 an unknown setting is rejected, not ignored', e LIKE 'unknown setting%', e);
  e := t.err($$SELECT public.ican_sector_dev_set_settings('dev_test_secret', '{"fee_bps": 5000}')$$);
  PERFORM t.check('12.7 a value outside the allowed range is rejected by the table itself', e LIKE '%fee_bps%', e);
  e := t.err($$SELECT public.ican_sector_dev_set_settings('dev_test_secret', '{"current_terms_version": 9}')$$);
  PERFORM t.check('12.8 a terms version with no wording cannot be switched on', e LIKE '%wording%', e);

  PERFORM public.ican_sector_dev_set_sector('dev_test_secret', 'iRETL', NULL, TRUE);
  r := t.st(36, 'buy', 1, 'ICEC', 'switch-test-0004');
  PERFORM t.check('12.9 a halted sector refuses trades', r ->> 'code' = 'sector_not_live', r::TEXT);
  PERFORM public.ican_sector_dev_set_sector('dev_test_secret', 'iRETL', NULL, FALSE);
  UPDATE icanera_trading.fold_state SET folded_at = clock_timestamp() + INTERVAL '1 day';   -- the operator call above folded; hold it off again
  PERFORM t.setp('iRETL', 120);
  PERFORM t.check('12.10 and trades again once resumed', (t.st(36, 'buy', 1, 'ICEC', 'switch-test-0005') ->> 'success')::BOOLEAN);

  UPDATE icanera_trading.sector_index_cache SET computed_at = clock_timestamp() - INTERVAL '10 minutes' WHERE ticker = 'iRETL';
  r := t.st(36, 'buy', 1, 'ICEC', 'switch-test-0006');
  PERFORM t.check('12.11 a stale index refuses trades', r ->> 'code' = 'index_stale', r::TEXT);
  PERFORM t.setp('iRETL', 120);

  PERFORM public.ican_sector_dev_set_settings('dev_test_secret', '{"max_trades_per_minute": 3}');
  DELETE FROM icanera_trading.trade_requests WHERE user_id = t.u(34);
  PERFORM t.st(34, 'buy', 1, 'ICEC', 'rate-test-00001'); PERFORM t.st(34, 'buy', 1, 'ICEC', 'rate-test-00002'); PERFORM t.st(34, 'buy', 1, 'ICEC', 'rate-test-00003');
  PERFORM t.check('12.12 the fourth trade inside a minute is rate limited', t.st(34, 'buy', 1, 'ICEC', 'rate-test-00004') ->> 'code' = 'rate_limited');
  PERFORM t.check('12.13 a retry of an earlier one is still answered', (t.st(34, 'buy', 1, 'ICEC', 'rate-test-00001') ->> 'duplicate')::BOOLEAN);
  PERFORM t.check('12.14 the limit is per user: someone who has not traded is unaffected', (t.st(39, 'buy', 1, 'ICEC', 'rate-test-00005') ->> 'success')::BOOLEAN);
  PERFORM public.ican_sector_dev_set_settings('dev_test_secret', '{"max_trades_per_minute": 1000}');
  UPDATE icanera_trading.fold_state SET folded_at = clock_timestamp() + INTERVAL '1 day';
  PERFORM t.setp('iRETL', 120);
END $t$;

-- ================================================================ 13. A zero fee leaves no fee entries
DO $t$
DECLARE r JSONB;
BEGIN
  PERFORM public.ican_sector_dev_set_settings('dev_test_secret', '{"fee_bps": 0}');
  UPDATE icanera_trading.fold_state SET folded_at = clock_timestamp() + INTERVAL '1 day';
  PERFORM t.setp('iRETL', 120);
  r := t.st(36, 'buy', 1.2, 'ICEC', 'nofee-test-0001');
  PERFORM t.check('13.1 with no fee, 1.2 ICEC at 1.20 buys exactly 1 unit', (r ->> 'units')::NUMERIC = 1 AND (r ->> 'fee_icec')::NUMERIC = 0, r::TEXT);
  PERFORM t.check('13.2 and writes a single vault entry', (SELECT count(*) FROM icanera_trading.vault_entries WHERE fill_id = (r ->> 'fill_id')::UUID) = 1);
  PERFORM public.ican_sector_dev_set_settings('dev_test_secret', '{"fee_bps": 100}');
  UPDATE icanera_trading.fold_state SET folded_at = clock_timestamp() + INTERVAL '1 day';
  PERFORM t.setp('iRETL', 120);
END $t$;

-- ================================================================ 14. The ledger caches stay exact
SELECT icanera_trading.fold_ledgers();
DO $t$
DECLARE b1 NUMERIC; u1 NUMERIC; lb xid8;
BEGIN
  b1 := t.vault(); u1 := icanera_trading.sector_exposure_units('iRETL'); lb := (SELECT ledger_txid FROM icanera_trading.fold_state);
  PERFORM t.check('14.1 folding the ledgers moved the boundary forward', lb > '0'::xid8, lb::TEXT);
  PERFORM t.check('14.2 the cached vault balance now covers (nearly) all entries and the total is exact',
    b1 = (SELECT sum(amount) FROM icanera_trading.vault_entries)
    AND (SELECT balance FROM icanera_trading.vault_cache) <> 0, format('%s vs %s', b1, (SELECT sum(amount) FROM icanera_trading.vault_entries)));
  PERFORM t.check('14.3 units owed per sector equal the sum of everyone''s holdings',
    u1 = (SELECT sum(units) FROM icanera_trading.sector_holdings WHERE sector = 'iRETL'), u1::TEXT);
END $t$;
SELECT icanera_trading.fold_ledgers();
DO $t$
BEGIN
  PERFORM t.check('14.4 folding again counts nothing twice', t.vault() = (SELECT sum(amount) FROM icanera_trading.vault_entries));
  PERFORM t.check('14.5 reconciliation passes', (t.rec() ->> 'ok')::BOOLEAN, t.rec()::TEXT);
END $t$;

-- ================================================================ 15. Reconciliation can actually see a problem
DO $t$
DECLARE r JSONB;
BEGIN
  UPDATE icanera_trading.sector_holdings SET units = units + 1 WHERE user_id = t.u(36) AND sector = 'iRETL';
  r := t.rec();
  PERFORM t.check('15.1 a holding that no fill explains is reported', NOT (r ->> 'ok')::BOOLEAN AND jsonb_array_length(r -> 'units_mismatches') >= 1, r::TEXT);
  UPDATE icanera_trading.sector_holdings SET units = units - 1 WHERE user_id = t.u(36) AND sector = 'iRETL';
  ALTER TABLE icanera_trading.vault_entries DISABLE TRIGGER trg_vault_entries_immutable;
  UPDATE icanera_trading.vault_entries SET amount = amount + 1 WHERE id = (SELECT min(id) FROM icanera_trading.vault_entries WHERE fill_id IS NOT NULL);
  r := t.rec();
  PERFORM t.check('15.2 a vault entry that disagrees with its fill is reported', NOT (r ->> 'ok')::BOOLEAN AND (r ->> 'fills_without_matching_vault_entries')::INT >= 1, r::TEXT);
  UPDATE icanera_trading.vault_entries SET amount = amount - 1 WHERE id = (SELECT min(id) FROM icanera_trading.vault_entries WHERE fill_id IS NOT NULL);
  ALTER TABLE icanera_trading.vault_entries ENABLE TRIGGER trg_vault_entries_immutable;
  r := t.rec();
  PERFORM t.check('15.3 and once repaired, it is clean again', (r ->> 'ok')::BOOLEAN, r::TEXT);
END $t$;
