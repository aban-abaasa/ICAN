\set ON_ERROR_STOP on
SET client_min_messages = info;
-- BEFORE the migration: the checkouts as they are deployed today. These numbers are what "nothing else changed" is measured against.
--
--   dropship sale  UGX 10,000 x 2, listed at 12,500 -> goods 20,000 + VAT 4,500 + markup 5,000, delivery 6,000 = 35,500 = 7.1 ICAN
--   shop sale      UGX 10,000 x 3 = 30,000 = 6 ICAN; today an 8% surcharge is added on top of that

DO $t$
DECLARE d JSONB; s JSONB;
BEGIN
  d := t.dropship(1, 12500);
  PERFORM t.check('B1 dropship sale runs against the real, unpatched function', (d ->> 'ok')::BOOLEAN AND (d -> 'res' ->> 'success')::BOOLEAN, d::TEXT);
  PERFORM t.check('B2 customer pays 7.1 ICAN (UGX 35,500)', (d ->> 'debit')::NUMERIC = 7.1, d ->> 'debit');
  PERFORM t.check('B3 legs: store 4.9, rider 1.2, reseller 1.0 - no fee to ICANera', t.legs_total(d -> 'legs') = 7.1
    AND t.legs_total(d -> 'legs', t.u(110)) = 4.9 AND t.legs_total(d -> 'legs', t.u(140)) = 1.2
    AND t.legs_total(d -> 'legs', t.u(120)) = 1.0 AND t.legs_for(d -> 'legs', t.u(130)) = 0, (d -> 'legs')::TEXT);
  INSERT INTO t.keep VALUES ('b_dropship_debit', d ->> 'debit'), ('b_dropship_reseller', (d -> 'order' ->> 'reseller_margin_amount'));

  s := t.store_sale(2);
  PERFORM t.check('B4 shop sale runs against the real, unpatched function', (s ->> 'ok')::BOOLEAN AND (s -> 'res' ->> 'success')::BOOLEAN, s::TEXT);
  PERFORM t.check('B5 today the customer pays the shelf price PLUS an 8% surcharge (6.48 ICAN)', (s ->> 'debit')::NUMERIC = 6.48, s ->> 'debit');
  PERFORM t.check('B6 the store gets the full 6 ICAN, ICANera 0.48 comes out of the customer', (s ->> 'store_got')::NUMERIC = 6 AND (s ->> 'platform_got')::NUMERIC = 0.48, s::TEXT);
  s := t.store_sale(3, 3, 6.0);
  PERFORM t.check('B7 a customer holding exactly the shelf price (6 ICAN) cannot pay today', NOT (s ->> 'ok')::BOOLEAN, s::TEXT);
  INSERT INTO t.keep VALUES ('b_store_total_ugx', (t.store_sale(4) -> 'res' ->> 'total_ugx'));
END $t$;

-- remember the deployed text of both functions: the rollback must give back exactly this (ignoring layout)
INSERT INTO t.keep VALUES
  ('drop_sig_text', t.fn_text('public.dropship_checkout(uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])')),
  ('store_sig_text', t.fn_text('public.customer_self_checkout(jsonb,text,boolean,text)'));

-- hardened like DROPSHIP_CHECKOUT_REQUIRE_PIN.sql does: customers reach dropship_checkout only through the PIN wrapper
REVOKE EXECUTE ON FUNCTION public.dropship_checkout(UUID, JSONB, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, UUID, TEXT[]) FROM PUBLIC, anon, authenticated;
