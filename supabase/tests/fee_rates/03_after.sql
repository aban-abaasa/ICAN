\set ON_ERROR_STOP on
SET client_min_messages = info;

-- ============ 1. The rates
DO $t$
DECLARE seeded_at TIMESTAMPTZ;
BEGIN
  PERFORM t.check('1.1 four rates, all 3%', (SELECT count(*) FROM public.ican_fee_rates) = 4
    AND (SELECT bool_and(rate = 0.03) FROM public.ican_fee_rates)
    AND (SELECT array_agg(key ORDER BY key) FROM public.ican_fee_rates) = ARRAY['coin_cash_out','send_bank','send_mobile_money','withdraw_wallet']);
  PERFORM t.check('1.2 ican_fee_rate reads them', public.ican_fee_rate('send_bank') = 0.03 AND public.ican_fee_rate('withdraw_wallet') = 0.03);
  PERFORM t.check('1.3 an unknown key is 0, never a made-up charge', public.ican_fee_rate('nonsense') = 0);

  SELECT updated_at INTO seeded_at FROM public.ican_fee_rates WHERE key = 'send_mobile_money';
  UPDATE public.ican_fee_rates SET rate = 0.0125 WHERE key = 'send_mobile_money';
  PERFORM t.check('1.4 a developer can change a rate (1.25%) and the server reads it at once', public.ican_fee_rate('send_mobile_money') = 0.0125);
  PERFORM t.check('1.5 updated_at moves when a rate changes',
    (SELECT updated_at FROM public.ican_fee_rates WHERE key = 'send_mobile_money') > seeded_at);
  UPDATE public.ican_fee_rates SET rate = 0.03 WHERE key = 'send_mobile_money';

  PERFORM t.check('1.6 a rate of 1 (100%) or below 0 is refused by the table',
    t.raises($q$ UPDATE public.ican_fee_rates SET rate = 1 WHERE key = 'send_bank' $q$)
    AND t.raises($q$ UPDATE public.ican_fee_rates SET rate = -0.01 WHERE key = 'send_bank' $q$));

  CREATE TEMP TABLE saved_rates AS SELECT * FROM public.ican_fee_rates;
  DELETE FROM public.ican_fee_rates;
  PERFORM t.check('1.7 with every row deleted, each charge falls back to 3% - never to free',
    public.ican_fee_rate('send_mobile_money') = 0.03 AND public.ican_fee_rate('send_bank') = 0.03
    AND public.ican_fee_rate('withdraw_wallet') = 0.03 AND public.ican_fee_rate('coin_cash_out') = 0.03);
  INSERT INTO public.ican_fee_rates SELECT * FROM saved_rates;
  DROP TABLE saved_rates;
END $t$;

-- ============ 2. Who can read and change the rates
DO $t$
BEGIN
  PERFORM t.as_anon();
  PERFORM t.check('2.1 anyone can read the rates (the app shows them before you pay)', (SELECT count(*) FROM public.ican_fee_rates) = 4);
  PERFORM t.check('2.2 anon cannot change, add or delete a rate',
    t.raises($q$ UPDATE public.ican_fee_rates SET rate = 0 $q$) AND t.raises($q$ DELETE FROM public.ican_fee_rates $q$)
    AND t.raises($q$ INSERT INTO public.ican_fee_rates (key, rate, label) VALUES ('x', 0, 'x') $q$));
  PERFORM t.as_user(1);
  PERFORM t.check('2.3 a signed-in user can read but not change a rate',
    (SELECT count(*) FROM public.ican_fee_rates) = 4 AND t.raises($q$ UPDATE public.ican_fee_rates SET rate = 0 $q$)
    AND t.raises($q$ DELETE FROM public.ican_fee_rates $q$));
  PERFORM t.as_admin();
  PERFORM t.check('2.4 nothing was changed by those attempts', (SELECT bool_and(rate = 0.03) FROM public.ican_fee_rates));
END $t$;

-- ============ 3. Bank sends
DO $t$
DECLARE r JSONB; req RECORD; bal NUMERIC;
BEGIN
  PERFORM t.check('3.1 exactly one request_fiat_bank_send (no ambiguous overload)', (SELECT count(*) FROM pg_proc WHERE proname = 'request_fiat_bank_send') = 1);

  UPDATE public.wallet_accounts SET balance = 100000 WHERE user_id = t.u(1);
  -- the six NAMED arguments card-pay-with-pin passes: still works, still free
  r := public.request_fiat_bank_send(p_user_id => t.u(1), p_amount => 10000, p_account_number => '0123456789', p_bank_code => '044', p_beneficiary => 'Jane Doe', p_note => 'x');
  SELECT balance INTO bal FROM public.wallet_accounts WHERE user_id = t.u(1);
  PERFORM t.check('3.2 the old six-argument call is unchanged: no fee, recipient gets all of it',
    (r->>'success')::BOOLEAN AND (r->>'fee')::NUMERIC = 0 AND (r->>'net_amount')::NUMERIC = 10000 AND bal = 90000, r::TEXT);

  UPDATE public.wallet_accounts SET balance = 100000 WHERE user_id = t.u(1);
  r := public.request_fiat_bank_send(t.u(1), 10000, '0123456789', '044', 'Jane Doe', 'x', 300);
  SELECT balance INTO bal FROM public.wallet_accounts WHERE user_id = t.u(1);
  SELECT * INTO req FROM public.ican_fiat_send_requests WHERE flutterwave_reference = r->>'reference';
  PERFORM t.check('3.3 a 300 fee on 10,000: wallet debited 10,000, fee kept, recipient receives 9,700',
    (r->>'success')::BOOLEAN AND bal = 90000 AND req.amount = 10000 AND req.fee = 300 AND req.net_amount = 9700
    AND (r->>'fee')::NUMERIC = 300 AND (r->>'net_amount')::NUMERIC = 9700, r::TEXT);

  UPDATE public.wallet_accounts SET balance = 100000 WHERE user_id = t.u(1);
  r := public.request_fiat_bank_send(t.u(1), 10000, '0123456789', '044', 'Jane Doe', 'x', 10000);
  PERFORM t.check('3.4 a fee that eats the whole amount is refused and nothing is debited',
    NOT (r->>'success')::BOOLEAN AND r->>'error' = 'Fee exceeds amount' AND (SELECT balance FROM public.wallet_accounts WHERE user_id = t.u(1)) = 100000, r::TEXT);
  r := public.request_fiat_bank_send(t.u(1), 10000, '0123456789', '044', 'Jane Doe', 'x', -5);
  PERFORM t.check('3.5 a negative fee is refused', NOT (r->>'success')::BOOLEAN AND r->>'error' = 'Fee cannot be negative', r::TEXT);
  r := public.request_fiat_bank_send(t.u(2), 60000, '0123456789', '044', 'Jane Doe', 'x', 1800);
  PERFORM t.check('3.6 not enough money: refused even with a fee', NOT (r->>'success')::BOOLEAN AND (SELECT balance FROM public.wallet_accounts WHERE user_id = t.u(2)) = 50000, r::TEXT);
END $t$;

-- ============ 4. Mobile-money sends (the real function) and refunds
DO $t$
DECLARE r JSONB; rf JSONB; bal NUMERIC;
BEGIN
  UPDATE public.wallet_accounts SET balance = 100000 WHERE user_id = t.u(1);
  r := public.request_fiat_momo_send(t.u(1), 10000, 'UGX', '+256771234567', 'MTN', 'x', 300);
  SELECT balance INTO bal FROM public.wallet_accounts WHERE user_id = t.u(1);
  PERFORM t.check('4.1 mobile money: 300 fee on 10,000 debits 10,000 and sends 9,700',
    (r->>'success')::BOOLEAN AND bal = 90000 AND (r->>'fee')::NUMERIC = 300 AND (r->>'net_amount')::NUMERIC = 9700, r::TEXT);
  rf := public.resolve_fiat_momo_send(p_reference => r->>'reference', p_success => false, p_failure_reason => 'bank said no');
  SELECT balance INTO bal FROM public.wallet_accounts WHERE user_id = t.u(1);
  PERFORM t.check('4.2 a failed transfer refunds the WHOLE 10,000, fee included', bal = 100000, rf::TEXT || ' balance=' || bal);
END $t$;

-- ============ 5. The coin cash-out rate
DO $t$
DECLARE s JSONB; p JSONB;
BEGIN
  PERFORM t.check('5.1 both functions no longer carry a fixed 0.03',
    position('0.03' IN t.fn_text('sell_ican_coins')) = 0 AND position('0.03' IN t.fn_text('resolve_ican_payout')) = 0
    AND position('ican_fee_rate(''coin_cash_out'')' IN t.fn_text('sell_ican_coins')) > 0
    AND position('ican_fee_rate(''coin_cash_out'')' IN t.fn_text('resolve_ican_payout')) > 0);
  s := public.sell_ican_coins(t.u(1), 10);
  p := public.resolve_ican_payout('x', true);
  PERFORM t.check('5.2 at the default rate the results are exactly what they were before the migration',
    s::TEXT = (SELECT v FROM t.keep WHERE k = 'sell') AND p::TEXT = (SELECT v FROM t.keep WHERE k = 'payout'), s::TEXT || ' / ' || p::TEXT);

  UPDATE public.ican_fee_rates SET rate = 0.02 WHERE key = 'coin_cash_out';
  s := public.sell_ican_coins(t.u(1), 10);
  p := public.resolve_ican_payout('x', true);
  PERFORM t.check('5.3 change the rate to 2% and both follow it (fee UGX 1,000; 0.2 coin; 2 coin)',
    (s->>'fee_ugx')::NUMERIC = 1000 AND (s->>'platform_credit_ican')::NUMERIC = 0.2 AND (p->>'platform_credit_ican')::NUMERIC = 2, s::TEXT || ' / ' || p::TEXT);
  UPDATE public.ican_fee_rates SET rate = 0 WHERE key = 'coin_cash_out';
  s := public.sell_ican_coins(t.u(1), 10);
  PERFORM t.check('5.4 and 0% makes it free', (s->>'fee_ugx')::NUMERIC = 0, s::TEXT);
  UPDATE public.ican_fee_rates SET rate = 0.03 WHERE key = 'coin_cash_out';
END $t$;

-- ============ 6. The hole is closed
DO $t$
BEGIN
  PERFORM t.check('6.1 AFTER: anon and authenticated can run none of the six functions (any overload)',
    (SELECT bool_and(NOT has_function_privilege('anon', o, 'EXECUTE') AND NOT has_function_privilege('authenticated', o, 'EXECUTE')) FROM t.server_only_fns() o));
  PERFORM t.check('6.2 AFTER: the Edge Functions (service_role) still can',
    (SELECT bool_and(has_function_privilege('service_role', o, 'EXECUTE')) FROM t.server_only_fns() o));
  PERFORM t.as_user(2);
  PERFORM t.check('6.3 a signed-in user cannot debit another user through the RPC',
    t.raises(format($q$ SELECT public.request_fiat_momo_send(%L, 1000, 'UGX', '+256771234567', 'MTN', 'x', 0) $q$, t.u(1))));
  PERFORM t.as_anon();
  PERFORM t.check('6.4 the public anon key cannot either',
    t.raises(format($q$ SELECT public.request_fiat_bank_send(%L, 1000, '0123456789', '044', 'Jane Doe') $q$, t.u(1))));
  PERFORM t.as_admin();
  PERFORM t.check('6.5 nobody was debited by those attempts', (SELECT balance FROM public.wallet_accounts WHERE user_id = t.u(1)) = 100000);
END $t$;
