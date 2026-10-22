\set ON_ERROR_STOP on
SET client_min_messages = info;
-- BEFORE: the shop checkout as it is deployed in the live project. A UGX 10,000 product with 18% tax x 3.
DO $t$
DECLARE s JSONB;
BEGIN
  s := t.shop(1, t.cart(t.u(201), 3));
  PERFORM t.check('B1 today the customer is charged tax ON TOP of the shelf price: UGX 35,400 for 3 x 10,000', (s ->> 'ok')::BOOLEAN
    AND (s -> 'res' ->> 'total_ugx')::NUMERIC = 35400 AND (s -> 'res' ->> 'tax_ugx')::NUMERIC = 5400 AND (s -> 'res' ->> 'subtotal_ugx')::NUMERIC = 30000, s::TEXT);
  s := t.shop(2, t.cart(t.u(201), 3), TRUE);
  PERFORM t.check('B2 ...and from the wallet that is 7.08 ICAN + the 8% surcharge = 7.6464', (s ->> 'debit')::NUMERIC = 7.6464, s ->> 'debit');
  s := t.shop(3, t.cart(t.u(202), 3));
  PERFORM t.check('B3 a product with no tax is UGX 30,000 either way', (s -> 'res' ->> 'total_ugx')::NUMERIC = 30000 AND (s -> 'res' ->> 'tax_ugx')::NUMERIC = 0, s::TEXT);
END $t$;
