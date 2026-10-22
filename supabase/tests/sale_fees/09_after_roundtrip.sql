\set ON_ERROR_STOP on
SET client_min_messages = info;
-- migration -> rollback -> migration: the same behaviour as the first time
DO $t$
DECLARE d JSONB; s JSONB;
BEGIN
  d := t.dropship(50, 12500);
  s := t.store_sale(51);
  PERFORM t.check('T1 after a rollback the migration works again: dropship fee 590, reseller 4,410, customer 7.1 ICAN',
    (d -> 'order' ->> 'platform_fee_amount')::NUMERIC = 590 AND (d -> 'order' ->> 'reseller_margin_amount')::NUMERIC = 4410 AND (d ->> 'debit')::NUMERIC = 7.1, d::TEXT);
  PERFORM t.check('T2 and the shop: customer 6, store 5.94, ICANera 0.06',
    (s ->> 'debit')::NUMERIC = 6 AND (s ->> 'store_got')::NUMERIC = 5.94 AND (s ->> 'platform_got')::NUMERIC = 0.06, s::TEXT);
  PERFORM t.check('T3 default rates are back', (SELECT rate FROM public.ican_fee_rates WHERE key = 'dropship_sale') = 0.02 AND (SELECT rate FROM public.ican_fee_rates WHERE key = 'store_sale') = 0.01);
END $t$;
