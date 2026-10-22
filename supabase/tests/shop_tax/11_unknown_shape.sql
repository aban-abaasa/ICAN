\set ON_ERROR_STOP on
SET client_min_messages = info;
-- The deployed function is not the version the migration was written for (the tax line differs): it must refuse.
DO $t$
DECLARE d TEXT := pg_get_functiondef('public.customer_self_checkout(jsonb,text,boolean,text)'::regprocedure);
BEGIN
  INSERT INTO t.keep VALUES ('shop_def_original', d);
  IF position('v_unit_price * v_qty * (v_tax_rate / 100)' IN d) = 0 THEN RAISE EXCEPTION 'test setup: the line to change is not there'; END IF;
  EXECUTE replace(d, 'v_unit_price * v_qty * (v_tax_rate / 100)', 'v_unit_price * v_qty * (v_tax_rate / 100.0)');
END $t$;
