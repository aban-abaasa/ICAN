\set ON_ERROR_STOP on
SET client_min_messages = info;
DO $t$
BEGIN
  PERFORM t.check('U1 refused: the function is exactly as it was handed in (nothing half-patched)',
    position('/ 100.0' IN pg_get_functiondef('public.customer_self_checkout(jsonb,text,boolean,text)'::regprocedure)) > 0
    AND position('v_line_total / (1 + v_tax_rate / 100)' IN pg_get_functiondef('public.customer_self_checkout(jsonb,text,boolean,text)'::regprocedure)) = 0);
  EXECUTE (SELECT v FROM t.keep WHERE k = 'shop_def_original');   -- back to the deployed version for the real run
  PERFORM t.check('U2 restored', t.fn_text('public.customer_self_checkout(jsonb,text,boolean,text)') = (SELECT v FROM t.keep WHERE k = 'orig_shop_text'));
END $t$;
