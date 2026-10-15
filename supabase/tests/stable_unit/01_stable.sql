\set ON_ERROR_STOP on
-- ICEC-S in the system: the value follows the live dollar rate with an inflation floor, exact money, all-or-nothing
-- failures, idempotent retries, the funded-vault guard, the stale-feed refusal, and the operator controls.

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
DECLARE q JSONB; r JSONB; r2 JSONB; v RECORD; fx NUMERIC; flo NUMERIC; yrs NUMERIC; vault_before NUMERIC; bal_before NUMERIC; rec JSONB; ov JSONB;
BEGIN
  -- ============================================================ 1. the value of one ICEC-S
  PERFORM t.as_anon(); q := public.ican_stable_quote(); PERFORM t.reset();
  yrs := EXTRACT(EPOCH FROM (now() - TIMESTAMPTZ '2026-01-01')) / (365.25 * 86400);
  flo := 3700 * POWER(1.0358, yrs);
  PERFORM t.check('1.1 anyone can read the value; with the shilling weak it follows the live dollar rate (4022.80)',
    (q ->> 'available')::BOOLEAN AND (q ->> 'unit_ugx')::NUMERIC = 4022.802 AND NOT (q ->> 'protected')::BOOLEAN, q::TEXT);
  PERFORM t.check('1.2 the inflation floor is the start value grown by Uganda inflation',
    abs((q ->> 'floor_ugx')::NUMERIC - flo) < 0.01, q::TEXT);
  PERFORM t.check('1.3 every currency is the same value divided by its live rate (no arbitrage between wallets)',
    abs((q -> 'currencies' ->> 'KES')::NUMERIC - 4022.802 / 31.5202309728871617) < 0.0001 AND (q -> 'currencies' ->> 'UGX')::NUMERIC = 4022.802, q::TEXT);
  UPDATE public.ican_currency_rates SET rate_to_ugx = 3600 WHERE currency_code = 'USD';
  PERFORM t.as_anon(); q := public.ican_stable_quote(); PERFORM t.reset();
  PERFORM t.check('1.4 if the dollar rate ever fell below the inflation-adjusted start, the floor holds the value up and says so',
    (q ->> 'unit_ugx')::NUMERIC = round(flo, 6) AND (q ->> 'protected')::BOOLEAN, q::TEXT);
  UPDATE public.ican_currency_rates SET rate_to_ugx = 4022.802 WHERE currency_code = 'USD';
  PERFORM t.check('1.5 the value history records a point for the screen''s chart', jsonb_array_length(public.ican_stable_history(10)) >= 1);
  PERFORM t.check('1.6 the API roles cannot read or write the tables',
    NOT has_table_privilege('anon', 'icanera_stable.holdings', 'SELECT') AND NOT has_table_privilege('authenticated', 'icanera_stable.vault_entries', 'INSERT')
    AND NOT has_function_privilege('anon', 'public.ican_stable_swap(text,numeric,text,text,numeric,numeric)', 'EXECUTE'));

  -- ============================================================ 2. nothing moves while it is off / unfunded
  r := t.swap(1, 'buy', 100000, 'UGX', 'req-off-0001');
  PERFORM t.check('2.1 trading ships OFF', NOT (r ->> 'success')::BOOLEAN AND r ->> 'code' = 'trading_paused', r::TEXT);
  UPDATE icanera_stable.settings SET trading_enabled = TRUE;
  r := t.swap(1, 'buy', 100000, 'UGX', 'req-unfunded-1');
  PERFORM t.check('2.2 an unfunded vault refuses a buy: the dollar promise must be backed', NOT (r ->> 'success')::BOOLEAN AND r ->> 'code' = 'capacity_reached', r::TEXT);
  PERFORM t.check('2.3 ...and nothing moved', t.bal(1, 'UGX') = 1000000 AND (SELECT count(*) FROM icanera_stable.fills) = 0);
  PERFORM public.ican_stable_dev_vault_adjust('dev_test_secret', 5000000, 'opening reserve for the tests');

  -- ============================================================ 3. a buy, exactly
  -- 100,000 UGX: fee 0.5% = 500, net 99,500, units = 99,500 / 4022.802 = 24.73...
  r := t.swap(1, 'buy', 100000, 'UGX', 'req-buy-00001');
  PERFORM t.check('3.1 a buy succeeds', (r ->> 'success')::BOOLEAN, r::TEXT);
  PERFORM t.check('3.2 the fee is 0.5% and units are the rest at the live value, rounded down',
    (r ->> 'fee_ugx')::NUMERIC = 500 AND (r ->> 'units')::NUMERIC = trunc(99500 / 4022.802, 8), r::TEXT);
  PERFORM t.check('3.3 the wallet paid exactly the amount', t.bal(1, 'UGX') = 900000);
  PERFORM t.check('3.4 the vault took the collateral and the fee', (SELECT icanera_stable.vault_balance()) = 5100000, (SELECT icanera_stable.vault_balance())::TEXT);
  r2 := t.swap(1, 'buy', 100000, 'UGX', 'req-buy-00001');
  PERFORM t.check('3.5 the same request id again moves nothing and answers the same', (r2 ->> 'duplicate')::BOOLEAN AND t.bal(1, 'UGX') = 900000 AND (SELECT count(*) FROM icanera_stable.fills) = 1, r2::TEXT);

  -- ============================================================ 4. other wallets, same value
  r := t.swap(1, 'buy', 10, 'USD', 'req-buy-usd-1');   -- 10 USD = 40,228.02 UGX
  PERFORM t.check('4.1 paying from the USD wallet uses the live rate', (r ->> 'success')::BOOLEAN AND t.bal(1, 'USD') = 90 AND (r ->> 'gross_ugx')::NUMERIC = 40228.02, r::TEXT);
  r := t.swap(2, 'buy', 100, 'KES', 'req-no-kes-001');
  PERFORM t.check('4.2 no wallet in that currency: refused', r ->> 'code' = 'no_cash_wallet', r::TEXT);
  r := t.swap(2, 'buy', 5000, 'UGX', 'req-poor-00001');
  PERFORM t.check('4.3 not enough money: refused, nothing moved', r ->> 'code' = 'insufficient_funds' AND t.bal(2, 'UGX') = 1000, r::TEXT);

  -- ============================================================ 5. price protection, limits
  r := t.swap(1, 'buy', 1000, 'UGX', 'req-slip-00001', 3000);
  PERFORM t.check('5.1 a price that is worse than the one shown (beyond slippage) cancels the swap', r ->> 'code' = 'price_moved', r::TEXT);
  r := t.swap(1, 'buy', 9000000, 'UGX', 'req-big-000001');
  PERFORM t.check('5.2 above the per-swap limit: refused', r ->> 'code' IN ('trade_too_large', 'insufficient_funds'), r::TEXT);
  UPDATE icanera_stable.settings SET max_trade_ugx = 50000;
  r := t.swap(1, 'buy', 60000, 'UGX', 'req-big-000002');
  PERFORM t.check('5.3 the per-swap limit is enforced', r ->> 'code' = 'trade_too_large', r::TEXT);
  UPDATE icanera_stable.settings SET max_trade_ugx = 5000000;

  -- ============================================================ 6. a sell
  SELECT units INTO fx FROM icanera_stable.holdings WHERE user_id = t.u(1);
  bal_before := t.bal(1, 'UGX');
  r := t.swap(1, 'sell', 10, 'UGX', 'req-sell-00001');
  -- 10 units x 4022.802 = 40,228.02 gross; fee 0.5% = 201.14; net 40,026.88
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

  -- ============================================================ 8. the vault guard when the shilling weakens
  -- everyone is owed units x value; a weaker shilling raises that. A sell is still paid; a buy is refused once the margin is gone.
  UPDATE public.ican_currency_rates SET rate_to_ugx = 400000 WHERE currency_code = 'USD';
  r := t.swap(1, 'buy', 1000, 'UGX', 'req-weak-00001');
  PERFORM t.check('8.1 if the shilling collapses (400,000 per dollar), the vault no longer covers the margin: a new buy is refused', r ->> 'code' = 'capacity_reached', r::TEXT);
  r := t.swap(1, 'sell', 1, 'UGX', 'req-weak-00002');
  PERFORM t.check('8.2 ...but a holder can still sell at the new, higher value', (r ->> 'success')::BOOLEAN, r::TEXT);
  PERFORM t.check('8.3 an operator cannot withdraw the cover',
    t.err($$SELECT public.ican_stable_dev_vault_adjust('dev_test_secret', -5000000, 'try to drain it')$$) LIKE '%below what ICEC-S holders are owed%');
  UPDATE public.ican_currency_rates SET rate_to_ugx = 4022.802 WHERE currency_code = 'USD';

  -- ============================================================ 9. the books, and the operator
  rec := public.ican_stable_dev_reconcile('dev_test_secret');
  PERFORM t.check('9.1 the books balance: units bought - sold = units held; every fill has its vault entries', (rec ->> 'ok')::BOOLEAN, rec::TEXT);
  PERFORM t.check('9.2 fills and the vault ledger cannot be edited', t.err($$UPDATE icanera_stable.fills SET units = 1$$) LIKE '%never edited%'
    AND t.err($$DELETE FROM icanera_stable.vault_entries$$) LIKE '%never edited%');
  PERFORM t.check('9.3 the operator functions refuse a wrong token', t.err($$SELECT public.ican_stable_dev_overview('nope')$$) LIKE '%unauthorized%');
  ov := public.ican_stable_dev_overview('dev_test_secret');
  PERFORM t.check('9.4 the operator sees the cover', (ov -> 'vault' ->> 'cover_ratio')::NUMERIC > 1.25 AND (ov ->> 'holders')::INT = 1, ov::TEXT);
  PERFORM t.check('9.5 an unknown setting is refused', t.err($$SELECT public.ican_stable_dev_set_settings('dev_test_secret', '{"nope":1}')$$) LIKE '%unknown setting%');
  PERFORM t.as_user(t.u(1));
  PERFORM t.check('9.6 a user sees only their own position',
    (public.ican_stable_my_position() ->> 'units')::NUMERIC > 0 AND jsonb_array_length(public.ican_stable_my_fills(10)) >= 2);
  PERFORM t.reset();
  PERFORM t.as_user(t.u(2));
  PERFORM t.check('9.7 ...someone else sees none of it', (public.ican_stable_my_position() ->> 'units')::NUMERIC = 0 AND jsonb_array_length(public.ican_stable_my_fills(10)) = 0);
  PERFORM t.reset();
END $t$;
