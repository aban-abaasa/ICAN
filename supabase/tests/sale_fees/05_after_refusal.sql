\set ON_ERROR_STOP on
SET client_min_messages = info;
-- The migration just refused (run.sh checked it exited with an error). Nothing it patches may have changed.
DO $t$
BEGIN
  PERFORM t.check('U2 dropship_checkout was NOT patched although it was fine - the two functions are all-or-nothing',
    t.fn_text('public.dropship_checkout(uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])') = (SELECT v FROM t.keep WHERE k = 'drop_sig_text'));
  PERFORM t.check('U3 the shop checkout is exactly as it was handed in (still the +0 line, no store fee)',
    position('v_store_ican + 0;' IN pg_get_functiondef('public.customer_self_checkout(jsonb,text,boolean,text)'::regprocedure)) > 0
    AND position('store_sale' IN pg_get_functiondef('public.customer_self_checkout(jsonb,text,boolean,text)'::regprocedure)) = 0);
  -- put the deployed version back so the real run below meets the shape it was written for
  EXECUTE (SELECT v FROM t.keep WHERE k = 'store_def_original');
  PERFORM t.check('U4 restored', t.fn_text('public.customer_self_checkout(jsonb,text,boolean,text)') = (SELECT v FROM t.keep WHERE k = 'store_sig_text'));
END $t$;
