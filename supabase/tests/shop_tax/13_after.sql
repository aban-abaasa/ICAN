\set ON_ERROR_STOP on
SET client_min_messages = info;
-- AFTER: tax is inside the selling price.
DO $t$
DECLARE s JSONB; store0 NUMERIC;
BEGIN
  s := t.shop(10, t.cart(t.u(201), 3));
  PERFORM t.check('1.1 3 x UGX 10,000 costs UGX 30,000 - the shelf price, nothing added', (s ->> 'ok')::BOOLEAN AND (s -> 'res' ->> 'total_ugx')::NUMERIC = 30000, s::TEXT);
  PERFORM t.check('1.2 the 18% tax is the part INSIDE it: 4,576.27, so the net subtotal is 25,423.73',
    (s -> 'res' ->> 'tax_ugx')::NUMERIC = 4576.27 AND (s -> 'res' ->> 'subtotal_ugx')::NUMERIC = 25423.73, s::TEXT);
  PERFORM t.check('1.3 subtotal + tax = total (nothing lost to rounding)',
    (s -> 'res' ->> 'subtotal_ugx')::NUMERIC + (s -> 'res' ->> 'tax_ugx')::NUMERIC = (s -> 'res' ->> 'total_ugx')::NUMERIC);
  PERFORM t.check('1.4 the transaction says the same: net 25,423.73 + tax 4,576.27 = 30,000, tax rate 18%',
    (s -> 'tx' ->> 'subtotal')::NUMERIC = 25423.73 AND (s -> 'tx' ->> 'tax_amount')::NUMERIC = 4576.27 AND (s -> 'tx' ->> 'total_amount')::NUMERIC = 30000
    AND (s -> 'tx' ->> 'tax_rate')::NUMERIC = 18.00, (s -> 'tx')::TEXT);
  PERFORM t.check('1.5 so does the receipt the customer is handed: total and amount paid UGX 30,000',
    (s -> 'receipt' ->> 'total_amount')::NUMERIC = 30000 AND (s -> 'receipt' ->> 'amount_paid')::NUMERIC = 30000
    AND (s -> 'receipt' ->> 'tax_amount')::NUMERIC = 4576.27, (s -> 'receipt')::TEXT);
  PERFORM t.check('1.6 and the line items: the line is UGX 30,000 and records the tax inside it (4,576.27), not the old price x rate (5,400)',
    (s -> 'items' ->> 'line_total')::NUMERIC = 30000 AND (s -> 'items' ->> 'tax')::NUMERIC = 4576.27, (s -> 'items')::TEXT);
  s := t.shop(11, t.cart(t.u(201), 1, t.u(202), 1));
  PERFORM t.check('2.1 two lines, one taxed and one not: UGX 20,000, of which 1,525.42 is tax',
    (s -> 'res' ->> 'total_ugx')::NUMERIC = 20000 AND (s -> 'res' ->> 'tax_ugx')::NUMERIC = 1525.42 AND (s -> 'items' ->> 'tax')::NUMERIC = 1525.42, s::TEXT);
  s := t.shop(12, t.cart(t.u(202), 3));
  PERFORM t.check('2.2 a product with no tax is unchanged: UGX 30,000, tax 0', (s -> 'res' ->> 'total_ugx')::NUMERIC = 30000 AND (s -> 'res' ->> 'tax_ugx')::NUMERIC = 0, s::TEXT);
  store0 := t.userbal(t.u(101));
  s := t.shop(13, t.cart(t.u(201), 3), TRUE);
  PERFORM t.check('3.1 paid from the wallet: 30,000 = 6 ICAN, plus the shop''s existing 8% surcharge (this migration does not touch it) = 6.48',
    (s ->> 'debit')::NUMERIC = 6.48 AND (s -> 'res' ->> 'total_ugx')::NUMERIC = 30000, s::TEXT);
  PERFORM t.check('3.2 the store receives the full 6 ICAN of the shelf price (before: 7.08, the tax-on-top total)', t.userbal(t.u(101)) - store0 = 6, (t.userbal(t.u(101)) - store0)::TEXT);
  s := t.shop(14, t.cart(t.u(201), 3), TRUE, 6.0);
  PERFORM t.check('3.3 a customer holding exactly the 6 ICAN shelf price still cannot pay while the 8% surcharge exists - that is the fee migration''s job',
    NOT (s ->> 'ok')::BOOLEAN, s::TEXT);
  PERFORM t.check('4.1 only customer_self_checkout changed; who may call it did not',
    has_function_privilege('authenticated', 'public.customer_self_checkout(jsonb,text,boolean,text)', 'EXECUTE')
    AND (SELECT prosecdef FROM pg_proc WHERE proname = 'customer_self_checkout')
    AND (SELECT count(*) FROM pg_proc WHERE proname = 'customer_self_checkout') = 1);
END $t$;
INSERT INTO t.keep VALUES ('patched_shop_text', t.fn_text('public.customer_self_checkout(jsonb,text,boolean,text)'));
