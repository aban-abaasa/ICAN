\set ON_ERROR_STOP on
SET client_min_messages = info;
DO $t$
BEGIN
  PERFORM t.check('no optional parts: the rollback restores dropship_checkout exactly', t.fn_text('public.dropship_checkout(uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])') = (SELECT v FROM t.keep WHERE k = 'txt_drop'));
  PERFORM t.check('no optional parts: and it adds the tax on top again', (t.dropship(51, 12500) -> 'order' ->> 'customer_paid_amount')::NUMERIC = 35500);
END $t$;
