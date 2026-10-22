\set ON_ERROR_STOP on
SET client_min_messages = info;
DO $t$
DECLARE s JSONB;
BEGIN
  PERFORM t.check('Z1 the shop checkout is the deployed one again (ignoring layout)',
    t.fn_text('public.customer_self_checkout(jsonb,text,boolean,text)') = (SELECT v FROM t.keep WHERE k = 'orig_shop_text'));
  s := t.shop(40, t.cart(t.u(201), 3));
  PERFORM t.check('Z2 and it charges tax on top again: UGX 35,400', (s -> 'res' ->> 'total_ugx')::NUMERIC = 35400 AND (s -> 'items' ->> 'tax')::NUMERIC = 5400, s::TEXT);
END $t$;
