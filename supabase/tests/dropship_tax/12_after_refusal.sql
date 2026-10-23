\set ON_ERROR_STOP on
SET client_min_messages = info;
DO $t$
BEGIN
  PERFORM t.check('refusal: dropship_checkout was NOT changed (all or nothing)', t.fn_text('public.dropship_checkout(uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])') = (SELECT v FROM t.keep WHERE k = 'txt_drop'));
  PERFORM t.check('refusal: guest_checkout_start was NOT changed', t.fn_text('public.guest_checkout_start(uuid,jsonb,text,text,text,numeric,numeric,numeric,text[],boolean)') = (SELECT v FROM t.keep WHERE k = 'txt_guest'));
  PERFORM t.check('refusal: _inst_record_sale was NOT changed', t.fn_text('public._inst_record_sale(uuid,text,text)') = (SELECT v FROM t.keep WHERE k = 'txt_sale'));
  PERFORM t.check('refusal: dropship still adds the tax on top', (t.dropship(11, 12500) -> 'order' ->> 'customer_paid_amount')::NUMERIC = 35500);
END $t$;
