\set ON_ERROR_STOP on
SET client_min_messages = info;
-- AFTER the tax migration: the customer pays what they were shown, the store gets its shelf price, nothing is added on top.
DO $t$
DECLARE d JSONB; o JSONB; q JSONB; p JSONB; sale JSONB; plan UUID; r1 public.receipts; r2 public.receipts; tx public.transactions; it public.sales_transaction_items;
BEGIN
  -- ── 1. a dropship sale: 2 x listed 12,500 (shelf 10,000, 18% VAT, markup 5,000) + the 6,000 fare ─────────────────────
  d := t.dropship(20, 12500);
  o := d -> 'order';
  PERFORM t.check('1.1 the customer pays 25,000 + the 6,000 fare = 31,000 (6.2 ICAN) - no tax on top', (d ->> 'ok')::BOOLEAN AND (d ->> 'debit')::NUMERIC = 6.2
    AND (o ->> 'customer_paid_amount')::NUMERIC = 31000 AND (d -> 'res' ->> 'customer_paid_total')::NUMERIC = 31000, d::TEXT);
  PERFORM t.check('1.2 the store receives its shelf price, 20,000 (4 ICAN); the reseller its markup, 5,000 (1 ICAN); the rider the fare, 1.2',
    t.legs_total(d -> 'legs', t.u(110)) = 4.0 AND t.legs_total(d -> 'legs', t.u(120)) = 1.0 AND t.legs_total(d -> 'legs', t.u(140)) = 1.2, (d -> 'legs')::TEXT);
  PERFORM t.check('1.3 every coin the customer paid lands somewhere: the legs add up to the debit', t.legs_total(d -> 'legs') = (d ->> 'debit')::NUMERIC);
  PERFORM t.check('1.4 the order record: store 20,000 + markup 5,000 = the 25,000 of goods, 31,000 paid with the fare',
    (o ->> 'wholesale_amount')::NUMERIC = 20000 AND (o ->> 'reseller_margin_amount')::NUMERIC = 5000 AND (o ->> 'real_transport_fare')::NUMERIC = 6000
    AND (d -> 'res' ->> 'store_wholesale_total')::NUMERIC = 20000, o::TEXT);
  SELECT * INTO tx FROM public.transactions WHERE transaction_id = o ->> 'transaction_id';
  PERFORM t.check('1.5 the customer''s transaction: total 31,000 and the tax is the 3,050.85 INSIDE the store''s price (not 4,500 on top)',
    tx.total_amount = 31000 AND tx.tax_amount = 3050.85 AND tx.subtotal = 27949.15, to_jsonb(tx)::TEXT);
  r1 := t.rec(o ->> 'customer_receipt_number');
  r2 := t.rec(o ->> 'store_receipt_number');
  PERFORM t.check('1.6 the customer''s receipt says the same', r1.total_amount = 31000 AND r1.tax_amount = 3050.85 AND r1.subtotal = 27949.15);
  PERFORM t.check('1.7 the store''s receipt: its price without tax 16,949.15 + tax 3,050.85 = 20,000, plus the fare = 26,000',
    r2.subtotal = 16949.15 AND r2.tax_amount = 3050.85 AND r2.total_amount = 26000 AND r2.amount_paid = 26000, to_jsonb(r2)::TEXT);
  SELECT * INTO it FROM public.sales_transaction_items WHERE transaction_id = tx.id;
  PERFORM t.check('1.8 the sale item records the tax inside it (3,050.85), not listed price x rate (4,500)', it.tax_amount = 3050.85 AND it.line_total = 25000 AND it.quantity = 2, to_jsonb(it)::TEXT);

  -- ── 2. at the shelf price (no markup) the customer pays exactly the shelf price ───────────────────────────────────────
  d := t.dropship(21, 10000, 3);
  o := d -> 'order';
  PERFORM t.check('2.1 3 x 10,000 + the fare = 36,000 (7.2 ICAN); no markup; the store gets all 30,000',
    (o ->> 'customer_paid_amount')::NUMERIC = 36000 AND (d ->> 'debit')::NUMERIC = 7.2 AND (o ->> 'reseller_margin_amount')::NUMERIC = 0
    AND (o ->> 'wholesale_amount')::NUMERIC = 30000 AND t.legs_total(d -> 'legs', t.u(110)) = 6.0 AND t.legs_for(d -> 'legs', t.u(120)) = 0, d::TEXT);
  tx := NULL; SELECT * INTO tx FROM public.transactions WHERE transaction_id = o ->> 'transaction_id';
  PERFORM t.check('2.2 the tax inside 30,000 at 18% is 4,576.27', tx.tax_amount = 4576.27 AND tx.total_amount = 36000);

  -- ── 3. a product with no tax ─────────────────────────────────────────────────────────────────────────────────────────
  UPDATE public.products SET tax_rate = 0 WHERE id = t.u(201);
  d := t.dropship(22, 12500);
  o := d -> 'order';
  SELECT * INTO tx FROM public.transactions WHERE transaction_id = o ->> 'transaction_id';
  PERFORM t.check('3.1 0% tax: still 31,000, and no tax is recorded', (o ->> 'customer_paid_amount')::NUMERIC = 31000 AND tx.tax_amount = 0 AND (o ->> 'wholesale_amount')::NUMERIC = 20000, d::TEXT);
  UPDATE public.products SET tax_rate = 18 WHERE id = t.u(201);

  -- ── 4. the guest (Mobile Money / card / bank) quote equals the order ───────────────────────────────────────────────────
  d := t.dropship(23, 12500);
  q := t.guest_quote();
  PERFORM t.check('4.1 the guest quote: items 25,000 + fare 6,000 = 31,000 - the very figure the order charged',
    (q ->> 'items_ugx')::NUMERIC = 25000 AND (q ->> 'delivery_fee_ugx')::NUMERIC = 6000 AND (q ->> 'order_total_ugx')::NUMERIC = 31000
    AND (q ->> 'order_total_ugx')::NUMERIC = (d -> 'res' ->> 'customer_paid_total')::NUMERIC, q::TEXT);

  -- ── 5. instalment pricing prices the cart the way the order does ───────────────────────────────────────────────────────
  p := public._inst_price_cart(t.u(120), t.cart());
  PERFORM t.check('5.1 instalments: items 25,000 = store 20,000 + markup 5,000', (p ->> 'items_amount')::NUMERIC = 25000 AND (p ->> 'store_amount')::NUMERIC = 20000
    AND (p ->> 'margin_amount')::NUMERIC = 5000 AND (p ->> 'items_amount')::NUMERIC = (p ->> 'store_amount')::NUMERIC + (p ->> 'margin_amount')::NUMERIC, p::TEXT);
  PERFORM t.check('5.2 ... and equals what the order charges for the goods', (p ->> 'items_amount')::NUMERIC = (d -> 'res' ->> 'customer_paid_total')::NUMERIC - 6000);
  PERFORM t.check('5.3 each line carries the tax inside it and is marked as tax-included',
    (p -> 'lines' -> 0 ->> 'tax_amount')::NUMERIC = 3050.85 AND (p -> 'lines' -> 0 ->> 'line_total')::NUMERIC = 25000 AND (p -> 'lines' -> 0 ->> 'tax_inclusive')::BOOLEAN, (p -> 'lines')::TEXT);

  -- the receipts of an instalment sale started now
  INSERT INTO public.installment_plans (customer_user_id, customer_name, customer_phone, reseller_business_profile_id, supermarket_id, items, items_amount, store_amount, margin_amount)
  VALUES (t.u(1030), 'Cust', '0700', t.u(120), t.u(100), p -> 'lines', (p ->> 'items_amount')::NUMERIC, (p ->> 'store_amount')::NUMERIC, (p ->> 'margin_amount')::NUMERIC)
  RETURNING id INTO plan;
  sale := public._inst_record_sale(plan, 'pickup', NULL);
  o := to_jsonb((SELECT od FROM public.dropship_orders od WHERE od.id = (sale ->> 'order_id')::UUID));
  r1 := t.rec(sale ->> 'customer_receipt');
  r2 := t.rec(sale ->> 'store_receipt');
  PERFORM t.check('5.4 instalment sale, customer receipt: 21,949.15 + tax 3,050.85 = 25,000', r1.subtotal = 21949.15 AND r1.tax_amount = 3050.85 AND r1.total_amount = 25000, to_jsonb(r1)::TEXT);
  PERFORM t.check('5.5 instalment sale, store receipt: 16,949.15 + tax 3,050.85 = the 20,000 it is owed', r2.subtotal = 16949.15 AND r2.tax_amount = 3050.85 AND r2.total_amount = 20000, to_jsonb(r2)::TEXT);
  PERFORM t.check('5.6 instalment sale, order record and the store''s snapshot: store 20,000, markup 5,000, paid 25,000',
    (o ->> 'wholesale_amount')::NUMERIC = 20000 AND (o ->> 'reseller_margin_amount')::NUMERIC = 5000 AND (o ->> 'customer_paid_amount')::NUMERIC = 25000
    AND (SELECT (l ->> 'line_total')::NUMERIC FROM jsonb_array_elements(r2.items_json) l LIMIT 1) = 20000, o::TEXT);
  SELECT * INTO it FROM public.sales_transaction_items WHERE transaction_id = (SELECT id FROM public.transactions WHERE receipt_number = sale ->> 'customer_receipt');
  PERFORM t.check('5.7 instalment sale item: the tax inside (3,050.85)', it.tax_amount = 3050.85 AND it.line_total = 25000, to_jsonb(it)::TEXT);

  -- a plan started BEFORE the change (tax on top, no marker on its lines) is recorded exactly as it always was
  p := (SELECT v::JSONB FROM t.keep WHERE k = 'b_legacy_plan');
  INSERT INTO public.installment_plans (customer_user_id, customer_name, customer_phone, reseller_business_profile_id, supermarket_id, items, items_amount, store_amount, margin_amount)
  VALUES (t.u(1031), 'Cust', '0700', t.u(120), t.u(100), p -> 'lines', (p ->> 'items_amount')::NUMERIC, (p ->> 'store_amount')::NUMERIC, (p ->> 'margin_amount')::NUMERIC)
  RETURNING id INTO plan;
  sale := public._inst_record_sale(plan, 'pickup', NULL);
  r1 := t.rec(sale ->> 'customer_receipt');
  r2 := t.rec(sale ->> 'store_receipt');
  PERFORM t.check('5.8 an older plan (tax on top): customer receipt 25,000 + 4,500 = 29,500, as before', r1.subtotal = 25000 AND r1.tax_amount = 4500 AND r1.total_amount = 29500, to_jsonb(r1)::TEXT);
  PERFORM t.check('5.9 an older plan: store receipt 20,000 + 4,500 = 24,500, as before', r2.subtotal = 20000 AND r2.tax_amount = 4500 AND r2.total_amount = 24500
    AND (SELECT (l ->> 'line_total')::NUMERIC FROM jsonb_array_elements(r2.items_json) l LIMIT 1) = 24500, to_jsonb(r2)::TEXT);
  SELECT * INTO it FROM public.sales_transaction_items WHERE transaction_id = (SELECT id FROM public.transactions WHERE receipt_number = sale ->> 'customer_receipt');
  PERFORM t.check('5.10 an older plan: its sale item still records the 4,500', it.tax_amount = 4500, to_jsonb(it)::TEXT);
END $t$;

INSERT INTO t.keep (k, v)
SELECT 'after_' || k, t.fn_text(sig) FROM (VALUES
  ('drop',  'public.dropship_checkout(uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])'),
  ('price', 'public._inst_price_cart(uuid,jsonb,boolean)'),
  ('sale',  'public._inst_record_sale(uuid,text,text)')) AS x(k, sig);
INSERT INTO t.keep (k, v) SELECT 'after_guest', t.fn_text('public.guest_checkout_start(uuid,jsonb,text,text,text,numeric,numeric,numeric,text[],boolean)')
 WHERE to_regprocedure('public.guest_checkout_start(uuid,jsonb,text,text,text,numeric,numeric,numeric,text[],boolean)') IS NOT NULL;
