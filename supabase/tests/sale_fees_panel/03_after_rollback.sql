\set ON_ERROR_STOP on
SET client_min_messages = info;
DO $t$
BEGIN
  PERFORM t.check('Z1 the panel functions are gone', to_regprocedure('public.ican_dev_set_sale_fee(text,text,numeric)') IS NULL AND to_regprocedure('public.ican_dev_get_sale_fees(text)') IS NULL);
  PERFORM t.check('Z2 the fees themselves and the record of changes are kept',
    (SELECT rate FROM public.ican_fee_rates WHERE key = 'store_sale') = 0.02 AND (SELECT count(*) FROM public.ican_fee_rate_changes) >= 1);
END $t$;
