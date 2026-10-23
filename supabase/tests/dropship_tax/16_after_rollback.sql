\set ON_ERROR_STOP on
SET client_min_messages = info;
-- AFTER the rollbacks: every function is back to exactly the text it had, and dropship adds the tax on top again.
DO $t$
DECLARE d JSONB; q JSONB; p JSONB;
BEGIN
  PERFORM t.check('rollback: dropship_checkout is exactly as deployed', t.fn_text('public.dropship_checkout(uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])') = (SELECT v FROM t.keep WHERE k = 'txt_drop'));
  PERFORM t.check('rollback: guest_checkout_start is exactly as deployed', t.fn_text('public.guest_checkout_start(uuid,jsonb,text,text,text,numeric,numeric,numeric,text[],boolean)') = (SELECT v FROM t.keep WHERE k = 'txt_guest'));
  PERFORM t.check('rollback: _inst_price_cart is exactly as deployed', t.fn_text('public._inst_price_cart(uuid,jsonb,boolean)') = (SELECT v FROM t.keep WHERE k = 'txt_price'));
  PERFORM t.check('rollback: _inst_record_sale is exactly as deployed', t.fn_text('public._inst_record_sale(uuid,text,text)') = (SELECT v FROM t.keep WHERE k = 'txt_sale'));
  d := t.dropship(40, 12500);
  q := t.guest_quote();
  p := public._inst_price_cart(t.u(120), t.cart());
  PERFORM t.check('rollback: the order, the guest quote and instalments all add the tax on top again, and agree',
    (d -> 'order' ->> 'customer_paid_amount')::NUMERIC = 35500 AND (q ->> 'order_total_ugx')::NUMERIC = 35500 AND (p ->> 'items_amount')::NUMERIC = 29500
    AND (d ->> 'debit')::NUMERIC = 7.1, d::TEXT);
END $t$;
