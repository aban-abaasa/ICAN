\set ON_ERROR_STOP on
SET client_min_messages = info;
DO $t$
DECLARE r JSONB;
BEGIN
  PERFORM t.as_email('icaneraera@gmail.com');
  r := public.ican_dev_set_sale_fee((SELECT v FROM t.keep WHERE k = 'token'), 'dropship_sale', 0.02);
  PERFORM t.as_admin();
  PERFORM t.check('T1 after a rollback the migration works again and the panel can change a fee', (r ->> 'success')::BOOLEAN AND public.ican_fee_rate('dropship_sale') = 0.02, r::TEXT);
END $t$;
