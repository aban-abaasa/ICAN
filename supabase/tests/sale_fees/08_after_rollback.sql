\set ON_ERROR_STOP on
SET client_min_messages = info;
-- AFTER the rollback: both checkouts are the deployed text again (ignoring layout), and the sales are the "before" sales.
DO $t$
DECLARE d JSONB; s JSONB;
BEGIN
  PERFORM t.check('Z1 dropship_checkout is the original again',
    t.fn_text('public.dropship_checkout(uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])') = (SELECT v FROM t.keep WHERE k = 'drop_sig_text'));
  PERFORM t.check('Z2 customer_self_checkout is the original again',
    t.fn_text('public.customer_self_checkout(jsonb,text,boolean,text)') = (SELECT v FROM t.keep WHERE k = 'store_sig_text'));
  PERFORM t.check('Z3 the two rates and the fee helper are gone; the old rates and their fallbacks are not',
    NOT EXISTS (SELECT 1 FROM public.ican_fee_rates WHERE key IN ('dropship_sale', 'store_sale'))
    AND to_regprocedure('public.ican_sale_fee(text,numeric,numeric,integer)') IS NULL
    AND public.ican_fee_rate('dropship_sale') = 0 AND public.ican_fee_rate('send_bank') = 0.03 AND (SELECT count(*) FROM public.ican_fee_rates) = 4);
  PERFORM t.check('Z4 the record of fees already charged stays', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dropship_orders' AND column_name = 'platform_fee_amount'));
  d := t.dropship(40, 12500);
  s := t.store_sale(41);
  PERFORM t.check('Z5 a dropship sale is the old one: 7.1 ICAN, the reseller gets the full 1.0, no fee leg',
    (d ->> 'debit')::NUMERIC = 7.1 AND t.legs_total(d -> 'legs', t.u(120)) = 1.0 AND t.legs_for(d -> 'legs', t.u(130)) = 0 AND (d -> 'order' ->> 'platform_fee_amount')::NUMERIC = 0, d::TEXT);
  PERFORM t.check('Z6 a shop sale is the old one: the customer pays 6.48, the store gets 6',
    (s ->> 'debit')::NUMERIC = 6.48 AND (s ->> 'store_got')::NUMERIC = 6 AND (s ->> 'platform_got')::NUMERIC = 0.48, s::TEXT);
  PERFORM t.check('Z7 the rollback left no trace of the new functions or text',
    position('v_platform_fee' IN pg_get_functiondef('public.dropship_checkout(uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])'::regprocedure)) = 0
    AND position('ican_sale_fee' IN pg_get_functiondef('public.dropship_checkout(uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])'::regprocedure)) = 0
    AND position('store_sale' IN pg_get_functiondef('public.customer_self_checkout(jsonb,text,boolean,text)'::regprocedure)) = 0);
END $t$;
