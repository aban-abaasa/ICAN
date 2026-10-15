\set ON_ERROR_STOP on
-- ICEC-S, automatic and user to user: on from the start with nothing to fund; the price is a dollar's worth (live rate, inflation
-- floor) or the pool's share per ICEC-S if the pool holds less; exact money, all-or-nothing failures, idempotent retries, the
-- stale-feed refusal, and a randomised run proving the pool can always pay what it owes.

TRUNCATE icanera_stable.holdings, icanera_stable.fills, icanera_stable.vault_entries, icanera_stable.requests, icanera_stable.price_history;
TRUNCATE public.wallet_accounts;
INSERT INTO public.wallet_accounts (user_id, currency, balance) VALUES
  (t.u(1), 'UGX', 1000000), (t.u(1), 'USD', 100), (t.u(1), 'KES', 50000), (t.u(2), 'UGX', 1000);
CREATE FUNCTION t.swap(p_user INT, p_side TEXT, p_amount NUMERIC, p_cur TEXT, p_rid TEXT, p_exp NUMERIC DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN PERFORM t.as_user(t.u(p_user)); r := public.ican_stable_swap(p_side, p_amount, p_cur, p_rid, p_exp); PERFORM t.reset(); RETURN r; END; $$;
CREATE FUNCTION t.bal(p_user INT, p_cur TEXT) RETURNS NUMERIC LANGUAGE sql AS $$ SELECT balance FROM public.wallet_accounts WHERE user_id = t.u(p_user) AND currency = p_cur $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;

DO $t$
DECLARE q JSONB; r JSONB; r2 JSONB; fx NUMERIC; flo NUMERIC; yrs NUMERIC; bal_before NUMERIC; rec JSONB; ov JSONB; pv RECORD;
        v_units NUMERIC; v_vault NUMERIC; nav_before NUMERIC; nav_after NUMERIC; i INT; u INT; rate NUMERIC; amt NUMERIC; bad INT := 0; swaps INT := 0; ok INT := 0;
BEGIN
  -- ============================================================ 1. the value of one ICEC-S
  PERFORM t.as_anon(); q := public.ican_stable_quote(); PERFORM t.reset();
  yrs := EXTRACT(EPOCH FROM (now() - TIMESTAMPTZ '2026-01-01')) / (365.25 * 86400);
  flo := 3700 * POWER(1.0358, yrs);
  PERFORM t.check('1.1 anyone can read the value; with the shilling weak it follows the live dollar rate (4022.80)',
    (q ->> 'available')::BOOLEAN AND (q ->> 'unit_ugx')::NUMERIC = 4022.802 AND (q ->> 'dollar_ugx')::NUMERIC = 4022.802 AND NOT (q ->> 'protected')::BOOLEAN, q::TEXT);
  PERFORM t.check('1.2 the inflation floor is the start value grown by Uganda inflation', abs((q ->> 'floor_ugx')::NUMERIC - flo) < 0.01, q::TEXT);
  PERFORM t.check('1.3 every currency is the same value divided by its live rate (no arbitrage between wallets)',
    abs((q -> 'currencies' ->> 'KES')::NUMERIC - 4022.802 / 31.5202309728871617) < 0.0001 AND (q -> 'currencies' ->> 'UGX')::NUMERIC = 4022.802, q::TEXT);
  UPDATE public.ican_currency_rates SET rate_to_ugx = 3600 WHERE currency_code = 'USD';
  PERFORM t.as_anon(); q := public.ican_stable_quote(); PERFORM t.reset();
  PERFORM t.check('1.4 if the dollar rate ever fell below the inflation-adjusted start, the floor holds the value up and says so',
    (q ->> 'unit_ugx')::NUMERIC = trunc(flo, 6) AND (q ->> 'protected')::BOOLEAN, q::TEXT);
  UPDATE public.ican_currency_rates SET rate_to_ugx = 4022.802 WHERE currency_code = 'USD';
  PERFORM t.check('1.5 the value history records a point for the screen''s chart', jsonb_array_length(public.ican_stable_history(10)) >= 1);
  PERFORM t.check('1.6 the API roles cannot read or write the tables',
    NOT has_table_privilege('anon', 'icanera_stable.holdings', 'SELECT') AND NOT has_table_privilege('authenticated', 'icanera_stable.vault_entries', 'INSERT')
    AND NOT has_function_privilege('anon', 'public.ican_stable_swap(text,numeric,text,text,numeric,numeric)', 'EXECUTE'));

  -- ============================================================ 2. automatic: on from the start, nothing to fund
  PERFORM t.check('2.1 swaps are ON from the start and there is no margin to fund',
    (SELECT trading_enabled AND stress_pct = 0 FROM icanera_stable.settings) AND (q ->> 'trading_enabled')::BOOLEAN, q::TEXT);
  PERFORM t.check('2.2 the pool starts empty', icanera_stable.vault_balance() = 0);

  -- ============================================================ 3. the first buy, exactly
  r := t.swap(1, 'buy', 100000, 'UGX', 'req-buy-00001');
  PERFORM t.check('3.1 the very first buy works with an empty pool', (r ->> 'success')::BOOLEAN, r::TEXT);
  PERFORM t.check('3.2 the fee is 0.5% and units are the rest at the dollar value, rounded down',
    (r ->> 'fee_ugx')::NUMERIC = 500 AND (r ->> 'units')::NUMERIC = trunc(99500 / 4022.802, 8), r::TEXT);
  PERFORM t.check('3.3 the wallet paid exactly the amount and the pool holds what was paid', t.bal(1, 'UGX') = 900000 AND icanera_stable.vault_balance() = 100000);
  r2 := t.swap(1, 'buy', 100000, 'UGX', 'req-buy-00001');
  PERFORM t.check('3.4 the same request id again moves nothing and answers the same', (r2 ->> 'duplicate')::BOOLEAN AND t.bal(1, 'UGX') = 900000 AND (SELECT count(*) FROM icanera_stable.fills) = 1, r2::TEXT);
  PERFORM t.as_anon(); q := public.ican_stable_quote(); PERFORM t.reset();
  PERFORM t.check('3.5 the pool holds more than a dollar per ICEC-S (the fee stays in it), so the price is still a dollar',
    NOT (q ->> 'pool_short')::BOOLEAN AND (q ->> 'unit_ugx')::NUMERIC = 4022.802 AND (q ->> 'cover_pct')::NUMERIC > 100, q::TEXT);

  -- ============================================================ 4. other wallets, same value
  r := t.swap(1, 'buy', 10, 'USD', 'req-buy-usd-1');
  PERFORM t.check('4.1 paying from the USD wallet uses the live rate', (r ->> 'success')::BOOLEAN AND t.bal(1, 'USD') = 90 AND (r ->> 'gross_ugx')::NUMERIC = 40228.02, r::TEXT);
  r := t.swap(2, 'buy', 100, 'KES', 'req-no-kes-001');
  PERFORM t.check('4.2 no wallet in that currency: refused', r ->> 'code' = 'no_cash_wallet', r::TEXT);
  r := t.swap(2, 'buy', 5000, 'UGX', 'req-poor-00001');
  PERFORM t.check('4.3 not enough money: refused, nothing moved', r ->> 'code' = 'insufficient_funds' AND t.bal(2, 'UGX') = 1000, r::TEXT);

  -- ============================================================ 5. price protection, limits
  r := t.swap(1, 'buy', 1000, 'UGX', 'req-slip-00001', 3000);
  PERFORM t.check('5.1 a price worse than the one shown (beyond slippage) cancels the swap', r ->> 'code' = 'price_moved', r::TEXT);
  UPDATE icanera_stable.settings SET max_trade_ugx = 50000;
  r := t.swap(1, 'buy', 60000, 'UGX', 'req-big-000002');
  PERFORM t.check('5.2 the per-swap limit is enforced', r ->> 'code' = 'trade_too_large', r::TEXT);
  UPDATE icanera_stable.settings SET max_trade_ugx = 5000000;

  -- ============================================================ 6. a sell
  SELECT units INTO fx FROM icanera_stable.holdings WHERE user_id = t.u(1);
  r := t.swap(1, 'sell', 10, 'UGX', 'req-sell-00001');
  PERFORM t.check('6.1 a sell pays the value less the fee', (r ->> 'success')::BOOLEAN AND (r ->> 'pay_amount')::NUMERIC = trunc((40228.02 - trunc(40228.02 * 50 / 10000, 8)), 2), r::TEXT);
  PERFORM t.check('6.2 the units left are exact', (SELECT units FROM icanera_stable.holdings WHERE user_id = t.u(1)) = fx - 10);
  r := t.swap(1, 'sell', 100000, 'UGX', 'req-sell-00002');
  PERFORM t.check('6.3 you cannot sell more than you hold', r ->> 'code' = 'insufficient_units', r::TEXT);
  r := t.swap(2, 'sell', 1, 'UGX', 'req-sell-00003');
  PERFORM t.check('6.4 someone who holds none cannot sell', r ->> 'code' = 'insufficient_units', r::TEXT);

  -- ============================================================ 7. the rates must be live
  UPDATE public.ican_currency_rates SET updated_at = now() - INTERVAL '4 hours' WHERE currency_code = 'USD';
  r := t.swap(1, 'buy', 1000, 'UGX', 'req-stale-0001');
  PERFORM t.check('7.1 with the currency feed stale nothing trades', r ->> 'code' = 'rates_stale', r::TEXT);
  PERFORM t.as_anon(); q := public.ican_stable_quote(); PERFORM t.reset();
  PERFORM t.check('7.2 ...and the screen is told', (q ->> 'rates_stale')::BOOLEAN AND NOT (q ->> 'trading_enabled')::BOOLEAN, q::TEXT);
  UPDATE public.ican_currency_rates SET updated_at = now() WHERE currency_code = 'USD';

  -- ============================================================ 8. the shilling collapses: the pool's share becomes the price
  UPDATE public.ican_currency_rates SET rate_to_ugx = 400000 WHERE currency_code = 'USD';
  PERFORM t.as_anon(); q := public.ican_stable_quote(); PERFORM t.reset();
  SELECT * INTO pv FROM icanera_stable.pool_value();
  PERFORM t.check('8.1 a dollar is now worth 400,000 shillings but the pool holds far less per ICEC-S, so the price is the pool''s share and the screen says so',
    (q ->> 'pool_short')::BOOLEAN AND (q ->> 'dollar_ugx')::NUMERIC = 400000 AND (q ->> 'unit_ugx')::NUMERIC = pv.nav_ugx AND pv.nav_ugx < 400000, q::TEXT);
  nav_before := icanera_stable.vault_balance() / icanera_stable.units_outstanding();
  r := t.swap(2, 'buy', 1000, 'UGX', 'req-weak-00001');
  nav_after := icanera_stable.vault_balance() / icanera_stable.units_outstanding();
  PERFORM t.check('8.2 a new buyer is not diluting anyone: they get units at the pool price and the pool per ICEC-S does not fall',
    (r ->> 'success')::BOOLEAN AND nav_after >= nav_before - 0.000001, r::TEXT || ' ' || nav_before || ' ' || nav_after);
  v_vault := icanera_stable.vault_balance(); v_units := icanera_stable.units_outstanding();
  r := t.swap(1, 'sell', 1, 'UGX', 'req-weak-00002');
  PERFORM t.check('8.3 a holder sells at the pool price: paid in full from the pool, which stays whole',
    (r ->> 'success')::BOOLEAN AND icanera_stable.vault_balance() >= 0 AND icanera_stable.vault_balance() >= icanera_stable.units_outstanding() * (SELECT price_ugx FROM icanera_stable.pool_value()) - 0.01, r::TEXT);
  UPDATE public.ican_currency_rates SET rate_to_ugx = 4022.802 WHERE currency_code = 'USD';

  -- ============================================================ 9. the pool can always pay: a randomised run through wild exchange rates
  TRUNCATE icanera_stable.holdings, icanera_stable.fills, icanera_stable.vault_entries, icanera_stable.requests;
  TRUNCATE public.wallet_accounts;
  INSERT INTO public.wallet_accounts (user_id, currency, balance) SELECT t.u(n), 'UGX', 2000000 FROM generate_series(10, 14) n;
  UPDATE icanera_stable.settings SET max_trade_ugx = 1000000000, max_position_ugx = 1000000000, max_trades_per_minute = 100000;
  FOR i IN 1..300 LOOP
    rate := (ARRAY[2500, 4022.802, 4100, 9000, 40000, 400000, 3000])[1 + floor(random() * 7)::INT];
    UPDATE public.ican_currency_rates SET rate_to_ugx = rate, updated_at = now() WHERE currency_code = 'USD';
    u := 10 + floor(random() * 5)::INT;
    amt := round((random() * 300000 + 1000)::NUMERIC, 2);
    IF random() < 0.55 THEN
      r := t.swap(u, 'buy', amt, 'UGX', 'rand-buy-' || i);
    ELSE
      SELECT LEAST(units, round((random() * 20)::NUMERIC, 4)) INTO v_units FROM icanera_stable.holdings WHERE user_id = t.u(u);
      IF v_units IS NULL OR v_units <= 0 THEN CONTINUE; END IF;
      r := t.swap(u, 'sell', v_units, 'UGX', 'rand-sell-' || i);
    END IF;
    swaps := swaps + 1; IF (r ->> 'success')::BOOLEAN THEN ok := ok + 1; END IF;
    SELECT * INTO pv FROM icanera_stable.pool_value();
    IF icanera_stable.vault_balance() < 0 OR (icanera_stable.units_outstanding() > 0 AND icanera_stable.vault_balance() < icanera_stable.units_outstanding() * pv.price_ugx - 0.01) THEN bad := bad + 1; END IF;
  END LOOP;
  UPDATE public.ican_currency_rates SET rate_to_ugx = 4022.802, updated_at = now() WHERE currency_code = 'USD';
  PERFORM t.check('9.1 across 300 random buys and sells through wild exchange rates, the pool always held at least what it owed at its own price (' || ok || ' swaps went through)', bad = 0 AND ok > 100, 'bad=' || bad || ' ok=' || ok);
  rec := public.ican_stable_dev_reconcile('dev_test_secret');
  PERFORM t.check('9.2 ...and the books balance afterwards', (rec ->> 'ok')::BOOLEAN, rec::TEXT);
  PERFORM t.check('9.3 nobody was left with a negative balance', NOT EXISTS (SELECT 1 FROM public.wallet_accounts WHERE balance < 0) AND NOT EXISTS (SELECT 1 FROM icanera_stable.holdings WHERE units < 0));

  -- ============================================================ 10. the operator is optional, and cannot take the pool away
  PERFORM t.check('10.1 fills and the vault ledger cannot be edited', t.err($$UPDATE icanera_stable.fills SET units = 1$$) LIKE '%never edited%'
    AND t.err($$DELETE FROM icanera_stable.vault_entries$$) LIKE '%never edited%');
  PERFORM t.check('10.2 the operator functions refuse a wrong token', t.err($$SELECT public.ican_stable_dev_overview('nope')$$) LIKE '%unauthorized%');
  PERFORM t.check('10.3 nothing can be taken out of the pool while anyone holds ICEC-S',
    icanera_stable.units_outstanding() > 0 AND t.err($$SELECT public.ican_stable_dev_vault_adjust('dev_test_secret', -1, 'try to take some')$$) LIKE '%belongs to the people who hold%');
  bal_before := icanera_stable.vault_balance();
  PERFORM public.ican_stable_dev_vault_adjust('dev_test_secret', 1000, 'optional top-up for the tests');
  PERFORM t.check('10.4 an optional top-up only ever helps holders (the pool per ICEC-S rises)', icanera_stable.vault_balance() = bal_before + 1000);
  ov := public.ican_stable_dev_overview('dev_test_secret');
  PERFORM t.check('10.5 the operator sees the pool per ICEC-S', (ov -> 'vault' ->> 'pool_per_unit_ugx') IS NOT NULL AND (ov ->> 'holders')::INT >= 1, ov::TEXT);
  PERFORM t.check('10.6 an unknown setting is refused', t.err($$SELECT public.ican_stable_dev_set_settings('dev_test_secret', '{"nope":1}')$$) LIKE '%unknown setting%');
  PERFORM t.as_user(t.u(10));
  PERFORM t.check('10.7 a user sees their own position', (public.ican_stable_my_position() ->> 'success')::BOOLEAN);
  PERFORM t.reset();
  PERFORM t.as_user(t.u(99));
  PERFORM t.check('10.8 ...and someone else sees none of it', (public.ican_stable_my_position() ->> 'units')::NUMERIC = 0 AND jsonb_array_length(public.ican_stable_my_fills(10)) = 0);
  PERFORM t.reset();
END $t$;
