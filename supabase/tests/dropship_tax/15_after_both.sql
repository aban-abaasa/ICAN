\set ON_ERROR_STOP on
SET client_min_messages = info;
-- BOTH migrations (the sale fee and the tax-included prices), in whichever order they were run: they do not get in each other's way.
DO $t$
DECLARE d JSONB; o JSONB;
BEGIN
  d := t.dropship(30, 12500);
  o := d -> 'order';
  PERFORM t.check('both: the customer still pays 31,000 (6.2 ICAN) - neither the fee nor the tax is added to what they were shown', (d ->> 'ok')::BOOLEAN
    AND (o ->> 'customer_paid_amount')::NUMERIC = 31000 AND (d ->> 'debit')::NUMERIC = 6.2, d::TEXT);
  PERFORM t.check('both: ICANera''s 2% is of the 25,000 of goods = 500 (0.1 ICAN), out of the reseller''s markup: 4,500 (0.9 ICAN)',
    (o ->> 'platform_fee_amount')::NUMERIC = 500 AND t.legs_total(d -> 'legs', t.u(130)) = 0.1 AND t.legs_total(d -> 'legs', t.u(120)) = 0.9
    AND (o ->> 'reseller_margin_amount')::NUMERIC = 4500, (d -> 'legs')::TEXT);
  PERFORM t.check('both: the store still gets its 20,000 (4 ICAN), the rider 1.2, and the legs add up to the debit',
    t.legs_total(d -> 'legs', t.u(110)) = 4.0 AND t.legs_total(d -> 'legs', t.u(140)) = 1.2 AND t.legs_total(d -> 'legs') = (d ->> 'debit')::NUMERIC);
  PERFORM t.check('both: the order adds up in shillings: store 20,000 + reseller 4,500 + ICANera 500 + fare 6,000 = 31,000',
    (o ->> 'wholesale_amount')::NUMERIC + (o ->> 'reseller_margin_amount')::NUMERIC + (o ->> 'platform_fee_amount')::NUMERIC + (o ->> 'real_transport_fare')::NUMERIC = 31000);
  PERFORM t.check('both: the guest quote still equals the order', (t.guest_quote() ->> 'order_total_ugx')::NUMERIC = 31000);
END $t$;
