\set ON_ERROR_STOP on
SET client_min_messages = info;
DO $t$
DECLARE s JSONB;
BEGIN
  PERFORM t.check('R1 running it again changes nothing', t.fn_text('public.customer_self_checkout(jsonb,text,boolean,text)') = (SELECT v FROM t.keep WHERE k = 'patched_shop_text'));
  s := t.shop(20, t.cart(t.u(201), 3));
  PERFORM t.check('R2 and the price is still the shelf price', (s -> 'res' ->> 'total_ugx')::NUMERIC = 30000 AND (s -> 'res' ->> 'tax_ugx')::NUMERIC = 4576.27, s::TEXT);
END $t$;
