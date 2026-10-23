\set ON_ERROR_STOP on
SET client_min_messages = info;
-- BEFORE: dropship adds the tax on top. Proves the checks below are measuring a real change.
DO $t$
DECLARE d JSONB; q JSONB; p JSONB;
BEGIN
  d := t.dropship(10, 12500);   -- 2 x listed 12,500 = 25,000 shown; fare 6,000
  PERFORM t.check('before: the customer pays 25,000 + 18% tax on top + the 6,000 fare = 35,500 (7.1 ICAN)',
    (d ->> 'ok')::BOOLEAN AND (d -> 'order' ->> 'customer_paid_amount')::NUMERIC = 35500 AND (d ->> 'debit')::NUMERIC = 7.1, d::TEXT);
  INSERT INTO t.keep VALUES ('b_debit', d ->> 'debit');
  q := t.guest_quote();
  PERFORM t.check('before: the guest quote says the same (items 29,500, total 35,500)', (q ->> 'items_ugx')::NUMERIC = 29500 AND (q ->> 'order_total_ugx')::NUMERIC = 35500, q::TEXT);
  p := public._inst_price_cart(t.u(120), t.cart());
  PERFORM t.check('before: so do instalments (items 29,500, store 24,500, markup 5,000)',
    (p ->> 'items_amount')::NUMERIC = 29500 AND (p ->> 'store_amount')::NUMERIC = 24500 AND (p ->> 'margin_amount')::NUMERIC = 5000, p::TEXT);
  INSERT INTO t.keep VALUES ('b_legacy_plan', p::TEXT);
END $t$;
