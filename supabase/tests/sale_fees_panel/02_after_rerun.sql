\set ON_ERROR_STOP on
SET client_min_messages = info;
DO $t$
BEGIN
  PERFORM t.check('R1 running the migration again keeps the rates and the record',
    (SELECT count(*) FROM public.ican_fee_rate_changes) = (SELECT v::INT FROM t.keep WHERE k = 'baseline_changes')
    AND (SELECT rate FROM public.ican_fee_rates WHERE key = 'store_sale') = 0.02);
  PERFORM t.check('R2 exactly one of each function', (SELECT count(*) FROM pg_proc WHERE proname = 'ican_dev_set_sale_fee') = 1 AND (SELECT count(*) FROM pg_proc WHERE proname = 'ican_dev_get_sale_fees') = 1);
END $t$;
