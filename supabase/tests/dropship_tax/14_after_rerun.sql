\set ON_ERROR_STOP on
SET client_min_messages = info;
DO $t$
BEGIN
  PERFORM t.check('re-run: nothing is patched twice - every function is exactly as after the first run',
    t.fn_text('public.dropship_checkout(uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])') = (SELECT v FROM t.keep WHERE k = 'after_drop')
    AND t.fn_text('public.guest_checkout_start(uuid,jsonb,text,text,text,numeric,numeric,numeric,text[],boolean)') = (SELECT v FROM t.keep WHERE k = 'after_guest')
    AND t.fn_text('public._inst_price_cart(uuid,jsonb,boolean)') = (SELECT v FROM t.keep WHERE k = 'after_price')
    AND t.fn_text('public._inst_record_sale(uuid,text,text)') = (SELECT v FROM t.keep WHERE k = 'after_sale'));
  PERFORM t.check('re-run: still tax-included', (t.dropship(24, 12500) -> 'order' ->> 'customer_paid_amount')::NUMERIC = 31000);
END $t$;
