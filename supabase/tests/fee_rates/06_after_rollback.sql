\set ON_ERROR_STOP on
SET client_min_messages = info;
DO $t$
DECLARE s JSONB;
BEGIN
  PERFORM t.check('8.1 rollback: the rates table and helper are gone',
    to_regclass('public.ican_fee_rates') IS NULL AND to_regprocedure('public.ican_fee_rate(text)') IS NULL);
  s := public.sell_ican_coins(t.u(1), 10);
  PERFORM t.check('8.2 rollback: cash-out is back to the fixed 3%',
    s::TEXT = (SELECT v FROM t.keep WHERE k = 'sell') AND position('0.03' IN t.fn_text('sell_ican_coins')) > 0, s::TEXT);
  PERFORM t.check('8.3 rollback: bank send is back to six arguments',
    (SELECT count(*) FROM pg_proc WHERE proname = 'request_fiat_bank_send') = 1
    AND (SELECT pronargs FROM pg_proc WHERE proname = 'request_fiat_bank_send') = 6);
  PERFORM t.check('8.4 rollback does NOT re-open the hole',
    (SELECT bool_and(NOT has_function_privilege('anon', o, 'EXECUTE') AND NOT has_function_privilege('authenticated', o, 'EXECUTE')) FROM t.server_only_fns() o));
END $t$;
