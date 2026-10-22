\set ON_ERROR_STOP on
SET client_min_messages = info;
-- The deployed shop checkout is not the version the migration was written for (one line differs): the migration must refuse.
DO $t$
DECLARE d TEXT := pg_get_functiondef('public.customer_self_checkout(jsonb,text,boolean,text)'::regprocedure);
BEGIN
  INSERT INTO t.keep VALUES ('store_def_original', d);
  IF position('v_customer_charge_ican - v_store_ican;' IN d) = 0 THEN RAISE EXCEPTION 'test setup: the line to change is not there'; END IF;
  EXECUTE replace(d, 'v_customer_charge_ican - v_store_ican;', 'v_customer_charge_ican - v_store_ican + 0;');
  PERFORM t.check('U1 setup: the shop checkout now differs from the version the migration expects',
    position('v_store_ican + 0;' IN pg_get_functiondef('public.customer_self_checkout(jsonb,text,boolean,text)'::regprocedure)) > 0);
END $t$;
