\set ON_ERROR_STOP on
-- ICEC-S for the whole world: pounds and yen (and anything else in the live rates): the right decimals, and a wallet in the
-- person's own currency appearing the first time they sell into it.

INSERT INTO public.ican_currency_rates (currency_code, rate_to_ugx, initial_rate_to_ugx, local_inflation_pct, updated_at, stability_anchor_at) VALUES
  ('GBP', 5320.0056, 4720, 3.88, now(), '2026-01-01'), ('JPY', 25.4116, 22.5, 2.5, now(), '2026-01-01'), ('KWD', 13000, 12000, 3, now(), '2026-01-01')
ON CONFLICT (currency_code) DO UPDATE SET rate_to_ugx = EXCLUDED.rate_to_ugx, updated_at = now();
TRUNCATE public.wallet_accounts;
INSERT INTO public.wallet_accounts (user_id, currency, balance) VALUES (t.u(20), 'UGX', 2000000), (t.u(21), 'UGX', 1000);

DO $t$
DECLARE q JSONB; r JSONB; w NUMERIC; held NUMERIC;
BEGIN
  PERFORM t.check('11.1 the decimals each currency really has: yen none, pounds 2, dinars 3',
    icanera_stable.currency_decimals('JPY') = 0 AND icanera_stable.currency_decimals('GBP') = 2 AND icanera_stable.currency_decimals('KWD') = 3 AND icanera_stable.currency_decimals('UGX') = 2);
  PERFORM t.as_anon(); q := public.ican_stable_quote(); PERFORM t.reset();
  PERFORM t.check('11.2 the value is quoted in pounds and yen from the live rates (4,022.80 / 5,320.01 = 0.7562 pounds; 158.3 yen)',
    abs((q -> 'currencies' ->> 'GBP')::NUMERIC - 4022.802 / 5320.0056) < 0.0001 AND abs((q -> 'currencies' ->> 'JPY')::NUMERIC - 4022.802 / 25.4116) < 0.001, q::TEXT);

  r := t.swap(20, 'buy', 500000, 'UGX', 'glob-buy-0001');
  PERFORM t.check('11.3 a buyer holds some ICEC-S to sell', (r ->> 'success')::BOOLEAN, r::TEXT);

  -- no GBP wallet yet: a sell creates it
  PERFORM t.check('11.4 a person with no pound wallet has none', NOT EXISTS (SELECT 1 FROM public.wallet_accounts WHERE user_id = t.u(20) AND currency = 'GBP'));
  r := t.swap(20, 'sell', 5, 'GBP', 'glob-sell-gbp1');
  PERFORM t.check('11.5 selling into pounds creates the wallet and pays pence-exact: 5 x 4022.802 less 0.5% = 20,012.69 UGX = 3.76 GBP',
    (r ->> 'success')::BOOLEAN AND (r ->> 'pay_amount')::NUMERIC = 3.76 AND t.bal(20, 'GBP') = 3.76, r::TEXT);

  r := t.swap(20, 'sell', 2, 'JPY', 'glob-sell-jpy1');
  PERFORM t.check('11.6 selling into yen pays WHOLE yen: 8,005.37 UGX = 315 JPY, no fraction',
    (r ->> 'success')::BOOLEAN AND (r ->> 'pay_amount')::NUMERIC = 315 AND t.bal(20, 'JPY') = 315, r::TEXT);

  UPDATE public.wallet_accounts SET balance = 5000 WHERE user_id = t.u(20) AND currency = 'JPY';
  r := t.swap(20, 'buy', 1000.75, 'JPY', 'glob-buy-jpy1');
  PERFORM t.check('11.7 buying with yen takes whole yen (1,000.75 becomes 1,000) and leaves 4,000', (r ->> 'success')::BOOLEAN AND (r ->> 'pay_amount')::NUMERIC = 1000 AND t.bal(20, 'JPY') = 4000, r::TEXT);

  r := t.swap(21, 'buy', 100, 'GBP', 'glob-buy-gbp2');
  PERFORM t.check('11.8 a buy never creates a wallet: with no pound wallet there is nothing to pay from', r ->> 'code' IN ('no_cash_wallet', 'insufficient_funds') AND NOT (r ->> 'success')::BOOLEAN, r::TEXT);
  PERFORM t.check('11.9 ...and no empty wallet was created by the failed buy', NOT EXISTS (SELECT 1 FROM public.wallet_accounts WHERE user_id = t.u(21) AND currency = 'GBP'));
  r := t.swap(20, 'sell', 1, 'ZZZ', 'glob-sell-zzz1');
  PERFORM t.check('11.10 a currency the live rates do not know is refused', NOT (r ->> 'success')::BOOLEAN, r::TEXT);
  r := t.swap(20, 'sell', 0.0001, 'JPY', 'glob-sell-dust');
  PERFORM t.check('11.11 a sale too small to pay out even one yen is refused, nothing moved', r ->> 'code' = 'amount_too_small', r::TEXT);
  PERFORM t.check('11.12 the books still balance', (public.ican_stable_dev_reconcile('dev_test_secret') ->> 'ok')::BOOLEAN);
END $t$;
