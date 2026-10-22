\set ON_ERROR_STOP on
SET client_min_messages = info;
DO $t$
DECLARE d JSONB; s JSONB;
BEGIN
  PERFORM t.check('R1 running it again keeps the rates a developer set (2.5% and 1.5%)',
    (SELECT rate FROM public.ican_fee_rates WHERE key = 'dropship_sale') = 0.025 AND (SELECT rate FROM public.ican_fee_rates WHERE key = 'store_sale') = 0.015);
  PERFORM t.check('R2 and does not patch the checkouts a second time',
    t.fn_text('public.dropship_checkout(uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])') = (SELECT v FROM t.keep WHERE k = 'patched_drop')
    AND t.fn_text('public.customer_self_checkout(jsonb,text,boolean,text)') = (SELECT v FROM t.keep WHERE k = 'patched_store'));
  PERFORM t.check('R3 exactly one fee leg in the dropship checkout, exactly one fee in the shop checkout',
    (length(pg_get_functiondef('public.dropship_checkout(uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])'::regprocedure))
     - length(replace(pg_get_functiondef('public.dropship_checkout(uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])'::regprocedure), 'ican_sale_fee(', ''))) / length('ican_sale_fee(') = 1
    AND (length(pg_get_functiondef('public.customer_self_checkout(jsonb,text,boolean,text)'::regprocedure))
     - length(replace(pg_get_functiondef('public.customer_self_checkout(jsonb,text,boolean,text)'::regprocedure), 'ican_sale_fee(', ''))) / length('ican_sale_fee(') = 1);
  d := t.dropship(30, 12500);
  s := t.store_sale(31);
  PERFORM t.check('R4 and the new rates are charged: 2.5% -> 737.50, 1.5% -> 0.09 ICAN',
    (d -> 'order' ->> 'platform_fee_amount')::NUMERIC = 737.50 AND (s ->> 'platform_got')::NUMERIC = 0.09, d::TEXT || s::TEXT);
  UPDATE public.ican_fee_rates SET rate = 0.02 WHERE key = 'dropship_sale';
  UPDATE public.ican_fee_rates SET rate = 0.01 WHERE key = 'store_sale';
END $t$;
