\set ON_ERROR_STOP on
SET client_min_messages = info;
DO $t$
DECLARE s JSONB;
BEGIN
  PERFORM t.check('7.1 running the migration again keeps the rates a developer changed',
    public.ican_fee_rate('send_bank') = 0.02 AND public.ican_fee_rate('coin_cash_out') = 0.015);
  s := public.sell_ican_coins(t.u(1), 10);
  PERFORM t.check('7.2 the patched function is not patched twice and still follows the rate (1.5%)', (s->>'fee_ugx')::NUMERIC = 750, s::TEXT);
  PERFORM t.check('7.3 an overload with an unrecognised 0.03 is left exactly as it was',
    position('0.03' IN pg_get_functiondef('public.resolve_ican_payout(integer)'::regprocedure)) > 0);
  PERFORM t.check('7.4 an overload mixing known and unknown 0.03 is left whole, not half-changed',
    pg_get_functiondef('public.sell_ican_coins(text)'::regprocedure) LIKE '%ROUND(v_ugx_gross * 0.03, 2)%'
    AND pg_get_functiondef('public.sell_ican_coins(text)'::regprocedure) NOT LIKE '%ican_fee_rate%');
  PERFORM t.check('7.5 the lock-down covers the new overloads too',
    (SELECT bool_and(NOT has_function_privilege('anon', o, 'EXECUTE') AND NOT has_function_privilege('authenticated', o, 'EXECUTE')) FROM t.server_only_fns() o));
  PERFORM t.check('7.6 still exactly one bank-send function', (SELECT count(*) FROM pg_proc WHERE proname = 'request_fiat_bank_send') = 1);
END $t$;
DROP FUNCTION public.resolve_ican_payout(INT);
DROP FUNCTION public.sell_ican_coins(TEXT);
