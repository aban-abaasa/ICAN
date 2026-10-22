\set ON_ERROR_STOP on
SET client_min_messages = info;
DO $t$
DECLARE s JSONB;
BEGIN
  PERFORM t.check('9.1 migrating again after a rollback works: four default rates',
    (SELECT count(*) FROM public.ican_fee_rates) = 4 AND (SELECT bool_and(rate = 0.03) FROM public.ican_fee_rates));
  s := public.sell_ican_coins(t.u(1), 10);
  PERFORM t.check('9.2 ...and cash-out reads the rate again', s::TEXT = (SELECT v FROM t.keep WHERE k = 'sell')
    AND position('ican_fee_rate' IN t.fn_text('sell_ican_coins')) > 0, s::TEXT);
END $t$;
