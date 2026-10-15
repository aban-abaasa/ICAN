\set ON_ERROR_STOP on
-- Fees: none when buying; a cash-out fee (3%) when selling, paid to the platform fee business; if that cannot be done the fee stays in
-- the pool; one credit per swap whatever the retries.

TRUNCATE icanera_stable.holdings, icanera_stable.fills, icanera_stable.vault_entries, icanera_stable.requests;
TRUNCATE public.wallet_accounts, public.t_fee_credits;
UPDATE public.t_fee_mode SET mode = 'ok', coin_price = 5000;
UPDATE icanera_stable.settings SET fee_bps = 300, max_trade_ugx = 5000000, max_position_ugx = 20000000, max_trades_per_minute = 1000;
UPDATE public.ican_currency_rates SET rate_to_ugx = 4000, updated_at = now() WHERE currency_code = 'USD';
INSERT INTO public.wallet_accounts (user_id, currency, balance) VALUES (t.u(30), 'UGX', 5000000);

DO $t$
DECLARE r JSONB; q JSONB; f RECORD; pool_before NUMERIC; pool_after NUMERIC; rec JSONB; credits INT; fee_ican NUMERIC;
BEGIN
  PERFORM t.as_anon(); q := public.ican_stable_quote(); PERFORM t.reset();
  PERFORM t.check('12.1 the quote says it plainly: no fee to buy, 3% to cash out', (q ->> 'buy_fee_bps')::INT = 0 AND (q ->> 'sell_fee_bps')::INT = 300, q::TEXT);

  r := t.swap(30, 'buy', 400000, 'UGX', 'fee-buy-00001');       -- 100 dollars
  PERFORM t.check('12.2 buying costs no fee: the whole 400,000 becomes ICEC-S and goes into the pool',
    (r ->> 'success')::BOOLEAN AND (r ->> 'fee_ugx')::NUMERIC = 0 AND (r ->> 'units')::NUMERIC = 100 AND icanera_stable.vault_usd(4000) = 100, r::TEXT);
  PERFORM t.check('12.3 ...and nothing was paid to the organisation for a buy', (SELECT count(*) FROM public.t_fee_credits) = 0);

  pool_before := icanera_stable.vault_usd(4000);
  r := t.swap(30, 'sell', 10, 'UGX', 'fee-sell-00001');         -- 10 dollars out: fee 0.30, seller gets 9.70 = 38,800 UGX
  SELECT * INTO f FROM icanera_stable.fills WHERE request_id = 'fee-sell-00001';
  PERFORM t.check('12.4 cashing out costs 3%: ten dollars of ICEC-S pays 9.70 dollars = 38,800 shillings', (r ->> 'success')::BOOLEAN AND (r ->> 'pay_amount')::NUMERIC = 38800 AND f.fee_usd = 0.3, r::TEXT);
  SELECT count(*), COALESCE(max(amount_ican), 0) INTO credits, fee_ican FROM public.t_fee_credits;
  PERFORM t.check('12.5 the fee was paid to the platform fee business: once, as ICEC at the live coin price (0.30 dollars = 1,200 UGX = 0.24 ICEC)',
    credits = 1 AND fee_ican = 0.24 AND (SELECT fee_type FROM public.t_fee_credits) = 'icec_s_cash_out' AND (SELECT source_reference FROM public.t_fee_credits) = 'icec-s-fee:' || f.id::TEXT
    AND (r ->> 'fee_paid_to_organisation')::BOOLEAN AND f.fee_released_usd = 0.3, (SELECT row_to_json(c)::TEXT FROM public.t_fee_credits c));
  pool_after := icanera_stable.vault_usd(4000);
  PERFORM t.check('12.6 the pool paid out the whole ten dollars (the seller''s 9.70 and the organisation''s 0.30)', pool_before - pool_after = 10, pool_before || ' -> ' || pool_after);
  rec := public.ican_stable_dev_reconcile('dev_test_secret');
  PERFORM t.check('12.7 the books balance and show what went to the organisation', (rec ->> 'ok')::BOOLEAN AND (rec ->> 'fees_paid_to_organisation_usd')::NUMERIC = 0.3, rec::TEXT);

  r := t.swap(30, 'sell', 10, 'UGX', 'fee-sell-00001');
  PERFORM t.check('12.8 a retry of the same sell changes nothing: still one credit, same answer', (r ->> 'duplicate')::BOOLEAN AND (SELECT count(*) FROM public.t_fee_credits) = 1);

  -- the fee must never be lost: if it cannot be paid, it stays in the pool
  UPDATE public.t_fee_mode SET mode = 'fail';
  pool_before := icanera_stable.vault_usd(4000);
  r := t.swap(30, 'sell', 10, 'UGX', 'fee-sell-00002');
  SELECT * INTO f FROM icanera_stable.fills WHERE request_id = 'fee-sell-00002';
  PERFORM t.check('12.9 if the organisation cannot be credited, the seller is charged the same and the fee STAYS IN THE POOL',
    (r ->> 'success')::BOOLEAN AND (r ->> 'pay_amount')::NUMERIC = 38800 AND f.fee_released_usd = 0 AND NOT (r ->> 'fee_paid_to_organisation')::BOOLEAN
    AND pool_before - icanera_stable.vault_usd(4000) = 9.7 AND (SELECT count(*) FROM public.t_fee_credits) = 1, r::TEXT);
  UPDATE public.t_fee_mode SET mode = 'raise';
  pool_before := icanera_stable.vault_usd(4000);
  r := t.swap(30, 'sell', 10, 'UGX', 'fee-sell-00003');
  PERFORM t.check('12.10 even if the credit raises an error, the sale still goes through and the fee stays in the pool',
    (r ->> 'success')::BOOLEAN AND pool_before - icanera_stable.vault_usd(4000) = 9.7, r::TEXT);
  UPDATE public.t_fee_mode SET mode = 'ok', coin_price = NULL;
  pool_before := icanera_stable.vault_usd(4000);
  r := t.swap(30, 'sell', 10, 'UGX', 'fee-sell-00004');
  PERFORM t.check('12.11 with no live coin price the fee also stays in the pool, and nothing is credited at a guessed price',
    (r ->> 'success')::BOOLEAN AND pool_before - icanera_stable.vault_usd(4000) = 9.7 AND (SELECT count(*) FROM public.t_fee_credits) = 1, r::TEXT);
  rec := public.ican_stable_dev_reconcile('dev_test_secret');
  PERFORM t.check('12.12 the books still balance after fees that stayed in the pool', (rec ->> 'ok')::BOOLEAN, rec::TEXT);
  UPDATE public.t_fee_mode SET mode = 'ok', coin_price = 5000;
  UPDATE public.ican_currency_rates SET rate_to_ugx = 4022.802 WHERE currency_code = 'USD';
END $t$;
