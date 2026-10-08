\set ON_ERROR_STOP on
-- Installment engine: terms, creation rules, stock reservation, price lock, wallet and Flutterwave payments, pickup with
-- the store's seal scan, delivery, cancel / lapse, access control, grants and coin conservation.

TRUNCATE t.results;
CREATE TABLE t.kv (k TEXT PRIMARY KEY, val TEXT);
CREATE FUNCTION t.u(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-' || lpad(n::TEXT, 12, '0'))::UUID $$;
CREATE FUNCTION t.b(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT ('bbbbbbbb-0000-0000-0000-' || lpad(n::TEXT, 12, '0'))::UUID $$;
CREATE FUNCTION t.p(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT ('cccccccc-0000-0000-0000-' || lpad(n::TEXT, 12, '0'))::UUID $$;
CREATE FUNCTION t.bal(n INT) RETURNS NUMERIC LANGUAGE sql AS $$ SELECT COALESCE((SELECT ican_balance FROM public.ican_user_wallets WHERE user_id = t.u(n)), 0) $$;
CREATE FUNCTION t.bizbal(n INT) RETURNS NUMERIC LANGUAGE sql AS $$ SELECT COALESCE((SELECT ican_balance FROM public.ican_business_wallets WHERE business_profile_id = t.b(n)), 0) $$;
CREATE FUNCTION t.reserved(n INT) RETURNS NUMERIC LANGUAGE sql AS $$ SELECT COALESCE(reserved_stock, 0) FROM public.inventory WHERE product_id = t.p(n) $$;
CREATE FUNCTION t.stock(n INT) RETURNS NUMERIC LANGUAGE sql AS $$ SELECT current_stock FROM public.inventory WHERE product_id = t.p(n) $$;
CREATE FUNCTION t.plan(p_code TEXT) RETURNS public.installment_plans LANGUAGE sql AS $$ SELECT * FROM public.installment_plans WHERE code = p_code $$;
-- Every coin that exists: wallets + business wallets + what open plans hold + payouts waiting on a seal scan.
CREATE FUNCTION t.supply() RETURNS NUMERIC LANGUAGE sql AS $$
  SELECT (SELECT COALESCE(SUM(ican_balance), 0) FROM public.ican_user_wallets)
       + (SELECT COALESCE(SUM(ican_balance), 0) FROM public.ican_business_wallets)
       + public.installment_escrow_ican()
       + (SELECT COALESCE(SUM(ican), 0) FROM public.burned)
       + (SELECT COALESCE(SUM((l ->> 'ican_amount')::NUMERIC), 0) FROM public.icanera_delivery_receipts r, jsonb_array_elements(r.settlement_legs) l
           WHERE r.status = 'paid' AND r.reference_type = 'dropship_order' AND r.rider_user_id IS NULL)
$$;
CREATE FUNCTION t.minted() RETURNS NUMERIC LANGUAGE sql AS $$ SELECT COALESCE(SUM(ican), 0) FROM public.minted $$;
GRANT ALL ON ALL TABLES IN SCHEMA t TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email) SELECT t.u(n), 'u' || n || '@test.dev' FROM unnest(ARRAY[1,2,3,10,11,20]) n;
INSERT INTO public.users (id, full_name, phone) VALUES (t.u(1), 'Alice Buyer', '0772000001'), (t.u(2), 'Bob NoWallet', '0772000002'), (t.u(3), 'Olga Outsider', '0772000003');
INSERT INTO public.business_profiles (id, user_id, business_name) VALUES (t.b(10), t.u(10), 'Reseller Shop'), (t.b(20), t.u(20), 'Big Supermarket');
INSERT INTO public.business_account_members (business_profile_id, auth_user_id) VALUES (t.b(10), t.u(11));
INSERT INTO public.supermarkets (id, owner_user_id, name, address, latitude, longitude, pichin_business_profile_id)
  VALUES (t.b(30), t.u(20), 'Big Supermarket Kampala', 'Plot 5 Main St', 0.31, 32.58, t.b(20));
INSERT INTO public.products (id, supermarket_id, name, sku, selling_price, tax_rate) VALUES
  (t.p(1), t.b(30), 'Fridge', 'FR-1', 40000, 18), (t.p(2), t.b(30), 'Kettle', 'KT-1', 10000, 0);
INSERT INTO public.inventory (supermarket_id, product_id, current_stock, reserved_stock) VALUES (t.b(30), t.p(1), 10, 0), (t.b(30), t.p(2), 20, 0);
INSERT INTO public.dropship_listings (reseller_business_profile_id, product_id, supermarket_id, listed_price) VALUES
  (t.b(10), t.p(1), t.b(30), 50000), (t.b(10), t.p(2), t.b(30), 12000);
INSERT INTO public.t_riders VALUES (t.u(90), 'Rider One', 3000, true), (t.u(91), 'Rider Two', 4000, true);
INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES (t.u(1), 100);
INSERT INTO t.kv VALUES ('base', (SELECT (t.supply() - t.minted())::TEXT));
-- cart A: 2 fridges -> items 2 x 50,000 + 18 % tax = 118,000; store leg 98,000; reseller margin 20,000

-- ================================================================ 1. Terms and quote (open to anyone)
DO $t$
DECLARE r JSONB; e TEXT;
BEGIN
  PERFORM t.as_anon();
  r := public.installment_terms();
  PERFORM t.check('1.1 anyone can read the terms', (r ->> 'max_installments')::INT = 6 AND (r ->> 'min_deposit_pct')::INT = 20, r::TEXT);
  r := public.installment_quote(t.b(10), jsonb_build_array(jsonb_build_object('product_id', t.p(1), 'quantity', 2)));
  PERFORM t.check('1.2 quote prices tax in and gives the minimum deposit', (r ->> 'items_ugx')::NUMERIC = 118000 AND (r ->> 'min_deposit_ugx')::NUMERIC = 23600 AND (r ->> 'eligible')::BOOLEAN, r::TEXT);
  r := public.installment_quote(t.b(10), jsonb_build_array(jsonb_build_object('product_id', t.p(2), 'quantity', 1)));
  PERFORM t.check('1.3 a small order is not eligible', NOT (r ->> 'eligible')::BOOLEAN, r::TEXT);
  r := public.installment_quote(t.b(10), jsonb_build_array(jsonb_build_object('product_id', t.u(77), 'quantity', 1)));
  PERFORM t.check('1.4 an unknown product is refused', NOT (r ->> 'success')::BOOLEAN, r::TEXT);
  r := public.installment_quote(t.b(10), jsonb_build_array(jsonb_build_object('product_id', t.p(1), 'quantity', 50)));
  PERFORM t.check('1.5 a quote over the stock is refused', NOT (r ->> 'success')::BOOLEAN AND r ->> 'error' LIKE 'Not enough stock%', r::TEXT);
  r := public.business_site_info(t.b(10));
  PERFORM t.check('1.6 the website can ask whether accounts are on', (r ->> 'accounts_enabled')::BOOLEAN AND r ->> 'business_name' = 'Reseller Shop', r::TEXT);
  PERFORM t.reset();
END $t$;

-- ================================================================ 2. Creating a plan
DO $t$
DECLARE r JSONB; e TEXT; v_code TEXT; v_cart JSONB := jsonb_build_array(jsonb_build_object('product_id', t.p(1), 'quantity', 2)); p public.installment_plans; s JSONB;
BEGIN
  PERFORM t.as_anon();
  e := t.err(format($$SELECT public.installment_create(%L, %L::jsonb, 3, 7, 30000)$$, t.b(10), v_cart));
  PERFORM t.check('2.1 anonymous visitors cannot start a plan', e IS NOT NULL, e);

  PERFORM t.as_user(t.u(1));
  e := t.err(format($$SELECT public.installment_create(%L, %L::jsonb, 3, 7, 20000)$$, t.b(10), v_cart));
  PERFORM t.check('2.2 deposit below the minimum refused', e LIKE '%deposit must be at least UGX 23,600%', e);
  e := t.err(format($$SELECT public.installment_create(%L, %L::jsonb, 7, 7, 30000)$$, t.b(10), v_cart));
  PERFORM t.check('2.3 too many payments refused', e LIKE '%between 1 and 6%', e);
  e := t.err(format($$SELECT public.installment_create(%L, %L::jsonb, 3, 10, 30000)$$, t.b(10), v_cart));
  PERFORM t.check('2.4 odd frequency refused', e LIKE '%weekly%', e);
  e := t.err(format($$SELECT public.installment_create(%L, %L::jsonb, 6, 30, 30000)$$, t.b(10), v_cart));
  PERFORM t.check('2.5 a plan longer than 90 days refused', e LIKE '%within 90 days%', e);
  e := t.err(format($$SELECT public.installment_create(%L, %L::jsonb, 6, 7, 113000)$$, t.b(10), v_cart));
  PERFORM t.check('2.6 a deposit leaving less than the minimum per payment refused', e LIKE '%too large%', e);
  e := t.err(format($$SELECT public.installment_create(%L, %L::jsonb, 3, 7, 30000)$$, t.b(10), jsonb_build_array(jsonb_build_object('product_id', t.p(2), 'quantity', 1))));
  PERFORM t.check('2.7 an order under the minimum refused', e LIKE '%start from UGX 20,000%', e);
  e := t.err(format($$SELECT public.installment_create(%L, %L::jsonb, 3, 7, 30000)$$, t.b(10), jsonb_build_array(jsonb_build_object('product_id', t.p(1), 'quantity', 1.5))));
  PERFORM t.check('2.8 a fractional quantity refused', e LIKE '%Invalid quantity%', e);
  e := t.err(format($$SELECT public.installment_create(%L, %L::jsonb, 3, 7, 30000)$$, t.b(10), jsonb_build_array(jsonb_build_object('product_id', t.p(1), 'quantity', 1), jsonb_build_object('product_id', t.p(1), 'quantity', 1))));
  PERFORM t.check('2.9 the same item twice refused', e LIKE '%twice%', e);
  PERFORM t.reset();

  -- no wallet: nothing may be left behind
  PERFORM t.as_user(t.u(2));
  e := t.err(format($$SELECT public.installment_create(%L, %L::jsonb, 3, 7, 30000)$$, t.b(10), v_cart));
  PERFORM t.reset();
  PERFORM t.check('2.10 a customer without a wallet cannot pay the deposit', e LIKE '%wallet was not found%', e);
  PERFORM t.check('2.11 ...and nothing was reserved or recorded', (SELECT COUNT(*) FROM public.installment_plans) = 0 AND t.reserved(1) = 0);

  PERFORM t.as_user(t.u(1));
  r := public.installment_create(t.b(10), v_cart, 3, 7, 30000);
  PERFORM t.reset();
  v_code := r ->> 'code';
  INSERT INTO t.kv VALUES ('planA', v_code);
  p := t.plan(v_code);
  PERFORM t.check('2.12 a plan is created and the deposit taken', (r ->> 'success')::BOOLEAN AND p.status = 'active' AND p.paid_ugx = 30000, r::TEXT);
  PERFORM t.check('2.13 the deposit left the wallet and sits in the plan', t.bal(1) = 100 - 6 AND p.held_ican = 6 AND public.installment_escrow_ican() = 6, 'bal=' || t.bal(1));
  PERFORM t.check('2.14 the stock is reserved, not sold', t.reserved(1) = 2 AND t.stock(1) = 10);
  PERFORM t.check('2.15 the customer became one of the business''s customers', EXISTS (SELECT 1 FROM public.business_site_customers WHERE business_profile_id = t.b(10) AND user_id = t.u(1)));
  PERFORM t.check('2.16 the plan snapshot is priced', p.items_ugx = 118000 AND p.store_ugx = 98000 AND p.margin_ugx = 20000, p.items_ugx::TEXT || '/' || p.store_ugx || '/' || p.margin_ugx);
  PERFORM t.check('2.17 the ledger shows a held-payment row', EXISTS (SELECT 1 FROM public.ican_coin_transactions WHERE sender_user_id = t.u(1) AND merchant_name = 'Installment plan ' || v_code AND ican_amount = 6));

  PERFORM t.as_user(t.u(1));
  s := (public.installment_get(v_code) -> 'plan' -> 'schedule');
  PERFORM t.reset();
  PERFORM t.check('2.18 the schedule is a deposit plus three payments that add up', jsonb_array_length(s) = 4 AND (SELECT SUM((x ->> 'amount_ugx')::NUMERIC) FROM jsonb_array_elements(s) x) = 118000, s::TEXT);
  PERFORM t.check('2.19 only the deposit is marked paid', s -> 0 ->> 'status' = 'paid' AND s -> 1 ->> 'status' = 'upcoming' AND (s -> 3 ->> 'amount_ugx')::NUMERIC = 29200, s::TEXT);

  PERFORM t.as_user(t.u(1));
  e := t.err(format($$SELECT public.installment_create(%L, %L::jsonb, 3, 7, 30000)$$, t.b(10), jsonb_build_array(jsonb_build_object('product_id', t.p(1), 'quantity', 9))));
  PERFORM t.reset();
  PERFORM t.check('2.20 reserved stock cannot be sold to someone else', e LIKE '%Not enough stock%', e);
END $t$;

-- ================================================================ 3. Price lock
DO $t$
DECLARE e TEXT;
BEGIN
  e := t.err(format($$UPDATE public.dropship_listings SET listed_price = 55000 WHERE reseller_business_profile_id = %L AND product_id = %L$$, t.b(10), t.p(1)));
  PERFORM t.check('3.1 the price cannot be raised while a plan is open', e LIKE '%instalments%', e);
  e := t.err(format($$UPDATE public.dropship_listings SET is_active = FALSE WHERE reseller_business_profile_id = %L AND product_id = %L$$, t.b(10), t.p(1)));
  PERFORM t.check('3.2 the listing cannot be switched off while a plan is open', e LIKE '%instalments%', e);
  -- (run inside a block that always rolls back, so the price is not really changed)
  e := t.err(format($x$DO $y$ BEGIN UPDATE public.dropship_listings SET listed_price = 49000 WHERE reseller_business_profile_id = %L AND product_id = %L; RAISE EXCEPTION 'lowered'; END $y$$x$, t.b(10), t.p(1)));
  PERFORM t.check('3.3 the price can be lowered', e = 'lowered', e);
  e := t.err(format($$UPDATE public.dropship_listings SET listed_price = 13000 WHERE reseller_business_profile_id = %L AND product_id = %L$$, t.b(10), t.p(2)));
  PERFORM t.check('3.4 an unrelated item is not locked', e IS NULL, e);
  UPDATE public.dropship_listings SET listed_price = 12000 WHERE product_id = t.p(2);
END $t$;

-- ================================================================ 4. Paying from the wallet
DO $t$
DECLARE v TEXT := (SELECT val FROM t.kv WHERE k = 'planA'); e TEXT; r JSONB; p public.installment_plans;
BEGIN
  PERFORM t.as_user(t.u(1));
  e := t.err(format($$SELECT public.installment_pay_wallet(%L, 500)$$, v));
  PERFORM t.check('4.1 a payment below the minimum is refused', e LIKE '%smallest payment is UGX 1,000%', e);
  e := t.err(format($$SELECT public.installment_pay_wallet(%L, 999999)$$, v));
  PERFORM t.check('4.2 more than the balance is refused', e LIKE '%more than the remaining balance of UGX 88,000%', e);
  PERFORM t.reset();
  PERFORM t.as_user(t.u(3));
  e := t.err(format($$SELECT public.installment_pay_wallet(%L, 5000)$$, v));
  PERFORM t.reset();
  PERFORM t.check('4.3 someone else cannot pay into the plan', e LIKE '%Plan not found%', e);

  PERFORM t.as_user(t.u(1));
  r := public.installment_pay_wallet(v, 29400);
  PERFORM t.reset();
  p := t.plan(v);
  PERFORM t.check('4.4 a normal instalment is accepted', (r ->> 'success')::BOOLEAN AND p.paid_ugx = 59400 AND p.status = 'active', r::TEXT);
  PERFORM t.check('4.5 held coins follow the payments', p.held_ican = ROUND(30000 / 5000.0, 8) + ROUND(29400 / 5000.0, 8), p.held_ican::TEXT);

  PERFORM t.as_user(t.u(1));
  r := public.installment_pay_wallet(v, 58600);
  PERFORM t.reset();
  p := t.plan(v);
  PERFORM t.check('4.6 paying the balance in one go makes the plan ready', p.paid_ugx = 118000 AND p.status = 'ready', p.status);
  PERFORM t.as_user(t.u(1));
  e := t.err(format($$SELECT public.installment_pay_wallet(%L, 1000)$$, v));
  PERFORM t.reset();
  PERFORM t.check('4.7 a ready plan takes no more payments', e LIKE '%not taking payments%', e);
  PERFORM t.check('4.8 coins are conserved', (t.supply() - t.minted()) = (SELECT val::NUMERIC FROM t.kv WHERE k = 'base'), t.supply()::TEXT);
END $t$;

-- ================================================================ 5. Collect: pickup receipt, seal scan, release
DO $t$
DECLARE v TEXT := (SELECT val FROM t.kv WHERE k = 'planA'); e TEXT; r JSONB; p public.installment_plans; g JSONB; v_before NUMERIC := t.bal(1);
BEGIN
  PERFORM t.as_user(t.u(3));
  e := t.err(format($$SELECT public.installment_choose_pickup(%L)$$, v));
  PERFORM t.reset();
  PERFORM t.check('5.1 only the owner can arrange collection', e LIKE '%Plan not found%', e);

  PERFORM t.as_user(t.u(1));
  r := public.installment_choose_pickup(v);
  PERFORM t.reset();
  p := t.plan(v);
  PERFORM t.check('5.2 collection issues a pickup code', (r ->> 'success')::BOOLEAN AND p.status = 'pickup_ready' AND p.receipt_code IS NOT NULL AND p.fulfilment = 'pickup', r::TEXT);
  PERFORM t.check('5.3 the stock is sold and the reservation cleared', t.stock(1) = 8 AND t.reserved(1) = 0, t.stock(1) || '/' || t.reserved(1));
  PERFORM t.check('5.4 nobody has been paid yet', t.bizbal(20) = 0 AND t.bizbal(10) = 0 AND p.held_ican = 0);
  PERFORM t.check('5.5 the sale is on the books like any dropship sale',
    (SELECT total_amount FROM public.transactions WHERE customer_user_id = t.u(1) AND register_number = 'DROPSHIP') = 118000
    AND (SELECT COUNT(*) FROM public.receipts) = 2 AND (SELECT COUNT(*) FROM public.sales_transaction_items) = 1
    AND (SELECT transport_provider FROM public.dropship_orders WHERE id = p.dropship_order_id) = 'pickup');
  SELECT settlement_legs INTO g FROM public.icanera_delivery_receipts WHERE verification_code = p.receipt_code;
  PERFORM t.check('5.6 the receipt holds the store leg and the reseller leg', jsonb_array_length(g) = 2 AND (g -> 0 ->> 'ican_amount')::NUMERIC = ROUND(98000 / 5000.0, 8) AND (g -> 1 ->> 'ican_amount')::NUMERIC = ROUND(20000 / 5000.0, 8), g::TEXT);
  PERFORM t.check('5.7 coins are conserved while waiting for the scan', (t.supply() - t.minted()) = (SELECT val::NUMERIC FROM t.kv WHERE k = 'base'), t.supply()::TEXT);

  PERFORM t.as_user(t.u(1));
  e := t.err(format($$SELECT public.installment_choose_delivery(%L, 'x', 0.3, 32.5, 4)$$, v));
  PERFORM t.reset();
  PERFORM t.check('5.8 it cannot then be switched to delivery', e LIKE '%already arranged%', e);
  PERFORM t.as_user(t.u(1));
  e := t.err(format($$SELECT public.installment_cancel(%L)$$, v));
  PERFORM t.reset();
  PERFORM t.check('5.9 nor cancelled', e LIKE '%can no longer be cancelled%', e);

  -- A stranger (not the store) cannot approve; the store can, and that releases the money.
  PERFORM t.as_user(t.u(3));
  r := public.icanera_confirm_pickup(p.receipt_code);
  PERFORM t.reset();
  PERFORM t.check('5.10 a stranger cannot release the money', NOT (r ->> 'success')::BOOLEAN AND t.bizbal(20) = 0, r::TEXT);
  PERFORM t.as_user(t.u(20));
  r := public.icanera_confirm_pickup(p.receipt_code);
  PERFORM t.reset();
  PERFORM t.check('5.11 the store''s scan pays the store and the reseller exactly', (r ->> 'success')::BOOLEAN AND t.bizbal(20) = 19.6 AND t.bizbal(10) = 4, t.bizbal(20) || '/' || t.bizbal(10));
  PERFORM t.check('5.12 the customer ended up exactly 23.6 ICAN lighter', v_before - t.bal(1) = 0 AND t.bal(1) = 100 - 23.6, t.bal(1)::TEXT);
  PERFORM t.check('5.13 coins are conserved after the payout', (t.supply() - t.minted()) = (SELECT val::NUMERIC FROM t.kv WHERE k = 'base'), t.supply()::TEXT);

  PERFORM t.as_user(t.u(1));
  r := public.installment_get(v);
  PERFORM t.reset();
  PERFORM t.check('5.14 the plan now reads as completed', r -> 'plan' ->> 'status' = 'completed' AND r -> 'plan' ->> 'pickup_code' = p.receipt_code, (r -> 'plan' ->> 'status'));
  PERFORM t.check('5.15 the sale is marked completed for the reseller', (SELECT status FROM public.dropship_orders WHERE id = p.dropship_order_id) = 'completed');
END $t$;

-- ================================================================ 6. Mobile Money / card / bank
DO $t$
DECLARE r JSONB; e TEXT; v_code TEXT; ref TEXT; ref2 TEXT; p public.installment_plans; v_cart JSONB := jsonb_build_array(jsonb_build_object('product_id', t.p(1), 'quantity', 1)); v_bal NUMERIC;
BEGIN
  -- plan B: 1 fridge = 59,000; deposit by Mobile Money (nothing taken from the wallet)
  PERFORM t.as_user(t.u(1));
  r := public.installment_create(t.b(10), v_cart, 2, 14, 12000, 'flutterwave');
  PERFORM t.reset();
  v_code := r ->> 'code'; INSERT INTO t.kv VALUES ('planB', v_code);
  p := t.plan(v_code);
  PERFORM t.check('6.1 a Mobile Money plan waits for its deposit and still holds the stock', (r ->> 'deposit_pending')::BOOLEAN AND p.status = 'awaiting_deposit' AND p.paid_ugx = 0 AND t.reserved(1) = 1, r::TEXT);

  PERFORM t.as_user(t.u(1));
  e := t.err(format($$SELECT public.installment_pay_start(%L, 5000)$$, v_code));
  PERFORM t.check('6.2 the first payment must be the deposit', e LIKE '%deposit is UGX 12,000%', e);
  r := public.installment_pay_start(v_code, 12000, TRUE);
  PERFORM t.check('6.3 a dry run prices the fee and stores nothing', (r ->> 'charge_ugx')::NUMERIC = 12500 AND (r ->> 'processing_fee_ugx')::NUMERIC = 500 AND r ->> 'tx_ref' IS NULL, r::TEXT);
  r := public.installment_pay_start(v_code, 12000);
  PERFORM t.reset();
  ref := r ->> 'tx_ref';
  PERFORM t.check('6.4 a real start records an awaiting payment', ref LIKE 'INS-%' AND (SELECT status FROM public.installment_payments WHERE tx_ref = ref) = 'awaiting_payment', r::TEXT);

  PERFORM t.as_user(t.u(1));
  e := t.err(format($$SELECT public.installment_fulfil_payment(%L, 'FLW1', 12500)$$, ref));
  PERFORM t.reset();
  PERFORM t.check('6.5 customers cannot confirm a payment themselves', e IS NOT NULL, e);

  PERFORM t.as_service();
  r := public.installment_fulfil_payment(ref, 'FLW1', 9000);
  PERFORM t.check('6.6 an underpayment is refused', NOT (r ->> 'success')::BOOLEAN AND r ->> 'error' LIKE '%less than%', r::TEXT);
  v_bal := t.bal(1);
  r := public.installment_fulfil_payment(ref, 'FLW1', 12500);
  PERFORM t.reset();
  p := t.plan(v_code);
  PERFORM t.check('6.7 a verified payment activates the plan', (r ->> 'success')::BOOLEAN AND p.status = 'active' AND p.paid_ugx = 12000, r::TEXT);
  PERFORM t.check('6.8 the customer''s wallet is unchanged (coins in, coins held)', t.bal(1) = v_bal AND p.held_ican = 2.4, t.bal(1)::TEXT);
  PERFORM t.check('6.9 the coins were minted against the payment', (SELECT SUM(ican) FROM public.minted WHERE payment_ref = 'INS-' || ref) = 2.4);
  PERFORM t.as_service();
  r := public.installment_fulfil_payment(ref, 'FLW1', 12500);
  PERFORM t.reset();
  PERFORM t.check('6.10 confirming twice does not credit twice', (r ->> 'already_processed')::BOOLEAN AND (t.plan(v_code)).paid_ugx = 12000, r::TEXT);

  -- a second Mobile Money payment that arrives after the plan was cancelled is refused and must be refunded
  PERFORM t.as_user(t.u(1));
  r := public.installment_pay_start(v_code, 20000);
  ref2 := r ->> 'tx_ref';
  r := public.installment_cancel(v_code);
  PERFORM t.reset();
  PERFORM t.check('6.11 cancelling inside the cooling-off window refunds in full', (r ->> 'cancel_fee_ugx')::NUMERIC = 0 AND (r ->> 'refunded_ugx')::NUMERIC = 12000 AND t.bal(1) = v_bal + 2.4, r::TEXT);
  PERFORM t.as_service();
  r := public.installment_fulfil_payment(ref2, 'FLW2', 20800);
  PERFORM t.check('6.12 a late payment on a cancelled plan is refused and flagged for refund', NOT (r ->> 'success')::BOOLEAN AND (r ->> 'refund_required')::BOOLEAN, r::TEXT);
  PERFORM public.installment_mark_refunded(ref2, 'refunded');
  PERFORM t.reset();
  PERFORM t.check('6.13 ...with nothing minted or kept', (SELECT COUNT(*) FROM public.minted WHERE payment_ref = 'INS-' || ref2) = 0 AND t.bal(1) = v_bal + 2.4 AND (SELECT status FROM public.installment_payments WHERE tx_ref = ref2) = 'refunded');
  PERFORM t.check('6.14 the stock went back on the shelf', t.reserved(1) = 0);
END $t$;

-- ================================================================ 7. Delivery
DO $t$
DECLARE r JSONB; e TEXT; v_code TEXT; p public.installment_plans; v_cart JSONB := jsonb_build_array(jsonb_build_object('product_id', t.p(1), 'quantity', 1)); v_bal NUMERIC; v_stock NUMERIC := t.stock(1);
BEGIN
  PERFORM t.as_user(t.u(1));
  r := public.installment_create(t.b(10), v_cart, 1, 7, 12000);
  v_code := r ->> 'code'; INSERT INTO t.kv VALUES ('planC', v_code);
  e := t.err(format($$SELECT public.installment_choose_delivery(%L, 'Ntinda', 0.35, 32.6, 4)$$, v_code));
  PERFORM t.check('7.1 delivery cannot be chosen before the items are paid', e LIKE '%Finish paying%', e);
  r := public.installment_pay_wallet(v_code, 47000);
  PERFORM t.check('7.2 paid up: the plan is ready', (t.plan(v_code)).status = 'ready');
  e := t.err(format($$SELECT public.installment_choose_delivery(%L, 'Ntinda', 0.35, 32.6, 500)$$, v_code));
  PERFORM t.check('7.3 a silly delivery window is refused', e LIKE '%between 1 and 48%', e);
  r := public.installment_delivery_quote(v_code, 0.35, 32.6);
  PERFORM t.check('7.4 the quote is the real fare from the nearest ranked rider', (r ->> 'delivery_fee_ugx')::NUMERIC = 3000 AND r ->> 'rider_name' = 'Rider One', r::TEXT);
  r := public.installment_choose_delivery(v_code, 'Ntinda, near the market', 0.35, 32.6, 4);
  p := t.plan(v_code);
  PERFORM t.check('7.5 choosing delivery waits for the fare', p.status = 'active' AND p.delivery_fee_ugx = 3000 AND p.fulfilment = 'delivery' AND p.paid_ugx = 59000, r::TEXT);
  e := t.err(format($$SELECT public.installment_pay_wallet(%L, 1000)$$, v_code));
  PERFORM t.check('7.6 the fare must be paid in one go', e LIKE '%delivery fee of UGX 3,000 in one go%', e);

  -- change of mind: back to ready, then pick again
  r := public.installment_clear_delivery(v_code);
  PERFORM t.check('7.7 delivery can be undone before the fare is paid', (t.plan(v_code)).status = 'ready' AND (t.plan(v_code)).delivery_fee_ugx = 0);
  r := public.installment_choose_delivery(v_code, 'Ntinda, near the market', 0.35, 32.6, 4);

  -- the fare changes (the quoted rider's price rose) before it is paid
  UPDATE public.t_riders SET fare = 9000;
  v_bal := t.bal(1);
  e := t.err(format($$SELECT public.installment_pay_wallet(%L, 3000)$$, v_code));
  PERFORM t.check('7.8 if the real fare rose above what was paid the order does not go out', e LIKE '%delivery price changed%', e);
  PERFORM t.check('7.9 ...and nothing was taken', t.bal(1) = v_bal AND (t.plan(v_code)).paid_ugx = 59000 AND (t.plan(v_code)).status = 'active');
  UPDATE public.t_riders SET fare = CASE rider_id WHEN t.u(90) THEN 3000 ELSE 4000 END;

  -- the quoted rider goes away: the nearest other is picked
  UPDATE public.t_riders SET available = FALSE WHERE rider_id = t.u(90);
  UPDATE public.t_riders SET fare = 3000 WHERE rider_id = t.u(91);
  r := public.installment_pay_wallet(v_code, 3000);
  PERFORM t.reset();
  p := t.plan(v_code);
  PERFORM t.check('7.10 paying the fare sends the order out', (r ->> 'status') = 'dispatched' AND p.status = 'dispatched' AND p.receipt_code IS NOT NULL, r::TEXT);
  PERFORM t.check('7.11 the quoted rider was gone, so another was booked', (SELECT status FROM public.icanera_delivery_receipts WHERE verification_code = p.receipt_code) = 'paid');
  PERFORM t.check('7.12 the customer owns the delivery receipt and the sale', (SELECT customer_user_id FROM public.icanera_delivery_receipts WHERE verification_code = p.receipt_code) = t.u(1));
  PERFORM t.check('7.13 the stock was sold exactly once', t.stock(1) = v_stock - 1 AND t.reserved(1) = 0, t.stock(1) || '/' || t.reserved(1));
  PERFORM t.check('7.14 nothing is left held and the wallet kept only crumbs', p.held_ican = 0 AND public.installment_escrow_ican() = 0 AND t.bal(1) BETWEEN 66.4 - 0.0001 AND 66.4 + 0.0001, t.bal(1)::TEXT);
  PERFORM t.check('7.15 auth is back to normal afterwards', COALESCE(current_setting('request.jwt.claim.sub', true), '') IN ('', t.u(1)::TEXT));
  UPDATE public.t_riders SET available = TRUE;
END $t$;

-- ================================================================ 8. Delivery: Mobile Money fare, free delivery, no riders
DO $t$
DECLARE r JSONB; e TEXT; v_code TEXT; ref TEXT; p public.installment_plans; v_cart JSONB := jsonb_build_array(jsonb_build_object('product_id', t.p(1), 'quantity', 1)); v_bal NUMERIC;
BEGIN
  PERFORM t.as_user(t.u(1));
  r := public.installment_create(t.b(10), v_cart, 1, 7, 12000);
  v_code := r ->> 'code';
  r := public.installment_pay_wallet(v_code, 47000);
  r := public.installment_choose_delivery(v_code, 'Bukoto', 0.34, 32.6, 2, ARRAY['motorcycle']);
  r := public.installment_pay_start(v_code, 3000);
  ref := r ->> 'tx_ref';
  PERFORM t.reset();
  v_bal := t.bal(1);
  PERFORM t.as_service();
  r := public.installment_fulfil_payment(ref, 'FLW9', 3200);
  PERFORM t.reset();
  p := t.plan(v_code);
  PERFORM t.check('8.1 a Mobile Money fare dispatches the order as the customer', (r ->> 'success')::BOOLEAN AND p.status = 'dispatched'
    AND (SELECT customer_user_id FROM public.icanera_delivery_receipts WHERE verification_code = p.receipt_code) = t.u(1), r::TEXT);
  PERFORM t.check('8.2 the fare was funded by the payment, not the wallet', abs(t.bal(1) - v_bal) < 0.00001, t.bal(1) || ' vs ' || v_bal);
  PERFORM t.check('8.3 no stale identity was left on the session', COALESCE(current_setting('request.jwt.claim.sub', true), '') = '');

  -- a Mobile Money fare when no rider can be found: the payment must be flagged for refund and nothing kept
  PERFORM t.as_user(t.u(1));
  r := public.installment_create(t.b(10), v_cart, 1, 7, 12000);
  v_code := r ->> 'code';
  r := public.installment_pay_wallet(v_code, 47000);
  r := public.installment_choose_delivery(v_code, 'Bukoto', 0.34, 32.6, 2);
  r := public.installment_pay_start(v_code, 3000);
  ref := r ->> 'tx_ref';
  PERFORM t.reset();
  UPDATE public.t_riders SET available = FALSE;
  PERFORM t.as_service();
  r := public.installment_fulfil_payment(ref, 'FLW10', 3200);
  PERFORM t.reset();
  UPDATE public.t_riders SET available = TRUE;
  p := t.plan(v_code);
  PERFORM t.check('8.4 no rider: the payment is flagged for refund and the plan is untouched', NOT (r ->> 'success')::BOOLEAN AND (r ->> 'refund_required')::BOOLEAN AND p.paid_ugx = 59000 AND p.status = 'active', r::TEXT);
  PERFORM t.check('8.5 no coins were minted for the failed payment', (SELECT COUNT(*) FROM public.minted WHERE payment_ref = 'INS-' || ref) = 0);

  -- free delivery goes out at once
  UPDATE public.dropship_listings SET free_delivery = TRUE WHERE product_id = t.p(1) AND reseller_business_profile_id = t.b(10);
  PERFORM t.as_user(t.u(1));
  r := public.installment_cancel(v_code);
  r := public.installment_create(t.b(10), v_cart, 1, 7, 12000);
  v_code := r ->> 'code';
  r := public.installment_pay_wallet(v_code, 47000);
  r := public.installment_choose_delivery(v_code, 'Bukoto', 0.34, 32.6, 2);
  PERFORM t.reset();
  PERFORM t.check('8.6 a free delivery goes out the moment it is chosen', (r ->> 'status') = 'dispatched' AND (t.plan(v_code)).status = 'dispatched' AND (r ->> 'delivery_fee_ugx')::NUMERIC = 0, r::TEXT);
  UPDATE public.dropship_listings SET free_delivery = FALSE;
END $t$;

-- ================================================================ 9. Cancel and lapse
DO $t$
DECLARE r JSONB; e TEXT; v_code TEXT; p public.installment_plans; v_cart JSONB := jsonb_build_array(jsonb_build_object('product_id', t.p(1), 'quantity', 2)); v_bal NUMERIC; v_biz NUMERIC; v_res0 NUMERIC;
BEGIN
  v_res0 := t.reserved(1);
  PERFORM t.as_user(t.u(1));
  r := public.installment_create(t.b(10), v_cart, 3, 7, 40000);
  v_code := r ->> 'code';
  PERFORM t.reset();
  UPDATE public.installment_plans SET created_at = now() - interval '3 days' WHERE code = v_code;
  v_bal := t.bal(1); v_biz := t.bizbal(10);
  PERFORM t.as_user(t.u(1));
  r := public.installment_cancel(v_code);
  PERFORM t.reset();
  PERFORM t.check('9.1 cancelling after the cooling-off window costs 5 %', (r ->> 'cancel_fee_ugx')::NUMERIC = 2000 AND (r ->> 'refunded_ugx')::NUMERIC = 38000, r::TEXT);
  PERFORM t.check('9.2 the fee goes to the seller and the rest to the wallet', t.bizbal(10) = v_biz + 0.4 AND t.bal(1) = v_bal + 7.6, t.bizbal(10) || '/' || t.bal(1));
  PERFORM t.check('9.3 the stock is released', t.reserved(1) = v_res0);
  PERFORM t.check('9.4 coins are conserved through a cancellation', (t.supply() - t.minted()) = (SELECT val::NUMERIC FROM t.kv WHERE k = 'base'));

  -- seller cancel: fee-free
  PERFORM t.as_user(t.u(1));
  r := public.installment_create(t.b(10), v_cart, 3, 7, 40000);
  v_code := r ->> 'code';
  PERFORM t.reset();
  UPDATE public.installment_plans SET created_at = now() - interval '3 days' WHERE code = v_code;
  v_bal := t.bal(1);
  PERFORM t.as_user(t.u(3));
  e := t.err(format($$SELECT public.installment_seller_cancel(%L)$$, v_code));
  PERFORM t.reset();
  PERFORM t.check('9.5 an outsider cannot cancel a seller''s plan', e LIKE '%Plan not found%', e);
  PERFORM t.as_user(t.u(11));
  r := public.installment_seller_cancel(v_code, 'Out of stock');
  PERFORM t.reset();
  PERFORM t.check('9.6 a staff member of the seller can cancel, fee-free', (r ->> 'cancel_fee_ugx')::NUMERIC = 0 AND t.bal(1) = v_bal + 8, r::TEXT);

  -- sweep: unpaid deposit freed, overdue plan lapsed, a ready plan left alone
  PERFORM t.as_user(t.u(1));
  r := public.installment_create(t.b(10), jsonb_build_array(jsonb_build_object('product_id', t.p(1), 'quantity', 1)), 1, 7, 12000, 'flutterwave');
  INSERT INTO t.kv VALUES ('sweepDeposit', r ->> 'code');
  r := public.installment_create(t.b(10), v_cart, 2, 7, 30000);
  INSERT INTO t.kv VALUES ('sweepOverdue', r ->> 'code');
  r := public.installment_create(t.b(10), jsonb_build_array(jsonb_build_object('product_id', t.p(1), 'quantity', 1)), 1, 7, 12000);
  INSERT INTO t.kv VALUES ('sweepReady', r ->> 'code');
  PERFORM public.installment_pay_wallet(r ->> 'code', 47000);
  PERFORM t.reset();
  UPDATE public.installment_plans SET created_at = now() - interval '3 hours' WHERE code = (SELECT val FROM t.kv WHERE k = 'sweepDeposit');
  UPDATE public.installment_plans SET created_at = now() - interval '40 days', final_due_at = now() - interval '9 days' WHERE code = (SELECT val FROM t.kv WHERE k = 'sweepOverdue');
  UPDATE public.installment_plans SET created_at = now() - interval '90 days', final_due_at = now() - interval '60 days' WHERE code = (SELECT val FROM t.kv WHERE k = 'sweepReady');
  v_bal := t.bal(1); v_biz := t.bizbal(10);
  PERFORM t.as_user(t.u(1));
  e := t.err($$SELECT public.installment_run_due()$$);
  PERFORM t.reset();
  PERFORM t.check('9.7 the sweep is not callable by customers', e IS NOT NULL, e);
  PERFORM t.as_service();
  r := public.installment_run_due();
  PERFORM t.reset();
  PERFORM t.check('9.8 the sweep frees one deposit and lapses one plan', (r ->> 'released_deposits')::INT = 1 AND (r ->> 'lapsed')::INT = 1, r::TEXT);
  PERFORM t.check('9.9 the unpaid deposit plan is cancelled', (SELECT status FROM public.installment_plans WHERE code = (SELECT val FROM t.kv WHERE k = 'sweepDeposit')) = 'cancelled');
  PERFORM t.check('9.10 the overdue plan lapsed, charged the fee and refunded the rest', (SELECT status FROM public.installment_plans WHERE code = (SELECT val FROM t.kv WHERE k = 'sweepOverdue')) = 'lapsed'
    AND t.bizbal(10) = v_biz + 0.3 AND t.bal(1) = v_bal + 5.7, t.bizbal(10) || '/' || t.bal(1));
  PERFORM t.check('9.11 a fully paid plan waiting for a choice is not lapsed', (SELECT status FROM public.installment_plans WHERE code = (SELECT val FROM t.kv WHERE k = 'sweepReady')) = 'ready');
  PERFORM t.as_user(t.u(1)); PERFORM public.installment_cancel((SELECT val FROM t.kv WHERE k = 'sweepReady')); PERFORM t.reset();
END $t$;

-- ================================================================ 10. Business accounts and access
DO $t$
DECLARE r JSONB; e TEXT; v_code TEXT; c JSONB;
BEGIN
  PERFORM t.as_user(t.u(3));
  r := public.installment_my_plans();
  PERFORM t.check('10.1 someone with no plans sees none', jsonb_array_length(r) = 0, r::TEXT);
  e := t.err(format($$SELECT public.installment_seller_plans(%L)$$, t.b(10)));
  PERFORM t.check('10.2 an outsider cannot read the seller''s plans', e LIKE '%Business access required%', e);
  e := t.err(format($$SELECT public.business_site_customers_list(%L)$$, t.b(10)));
  PERFORM t.check('10.3 an outsider cannot read the customer list', e LIKE '%Business access required%', e);
  e := t.err(format($$SELECT public.business_site_set_accounts(%L, FALSE)$$, t.b(10)));
  PERFORM t.check('10.4 an outsider cannot switch accounts off', e LIKE '%Business access required%', e);
  r := public.business_site_join(t.b(10), 'website');
  PERFORM t.check('10.5 anyone can register on a business website', (r ->> 'success')::BOOLEAN, r::TEXT);
  r := public.business_site_join(t.b(10), 'website');
  PERFORM t.check('10.6 registering twice is harmless', (SELECT COUNT(*) FROM public.business_site_customers WHERE user_id = t.u(3)) = 1);
  r := public.installment_get((SELECT val FROM t.kv WHERE k = 'planA'));
  PERFORM t.check('10.7 and still cannot see someone else''s plan', NOT (r ->> 'success')::BOOLEAN, r::TEXT);
  e := t.err($$SELECT count(*) FROM public.installment_plans$$);
  PERFORM t.check('10.8 the plan table is hidden from other customers by RLS', (SELECT COUNT(*) FROM public.installment_plans) = 0);
  PERFORM t.reset();

  PERFORM t.as_user(t.u(11));
  c := public.business_site_customers_list(t.b(10));
  PERFORM t.check('10.9 the business sees its customers with what each paid and owes', jsonb_array_length(c) = 2
    AND (SELECT (x ->> 'plans')::INT FROM jsonb_array_elements(c) x WHERE x ->> 'full_name' = 'Alice Buyer') >= 5, c::TEXT);
  r := public.installment_seller_plans(t.b(10));
  PERFORM t.check('10.10 the seller sees every plan', jsonb_array_length(r) >= 5, jsonb_array_length(r)::TEXT);
  PERFORM t.reset();

  PERFORM t.as_user(t.u(1));
  r := public.business_site_my_accounts();
  PERFORM t.check('10.11 the customer sees the businesses they have an account with', jsonb_array_length(r) = 1 AND r -> 0 ->> 'business_name' = 'Reseller Shop', r::TEXT);
  PERFORM t.reset();

  -- switched off: no sign-ups, no plans
  PERFORM t.as_user(t.u(10));
  r := public.business_site_set_accounts(t.b(10), FALSE);
  PERFORM t.reset();
  PERFORM t.as_user(t.u(1));
  e := t.err(format($$SELECT public.installment_create(%L, %L::jsonb, 3, 7, 30000)$$, t.b(10), jsonb_build_array(jsonb_build_object('product_id', t.p(1), 'quantity', 2))));
  PERFORM t.check('10.12 with accounts off, no plans can be started', e LIKE '%not offering instalments%', e);
  e := t.err(format($$SELECT public.business_site_join(%L)$$, t.b(10)));
  PERFORM t.check('10.13 ...and no one can register', e LIKE '%not taking customer accounts%', e);
  PERFORM t.reset();
  PERFORM t.check('10.14 the website can see that accounts are off', NOT (public.business_site_info(t.b(10)) ->> 'accounts_enabled')::BOOLEAN);
  PERFORM t.as_user(t.u(10)); PERFORM public.business_site_set_accounts(t.b(10), TRUE); PERFORM t.reset();
END $t$;

-- ================================================================ 11. Grants
DO $t$
DECLARE e TEXT; fn TEXT;
BEGIN
  PERFORM t.as_anon();
  FOREACH fn IN ARRAY ARRAY[
    $$installment_pay_wallet('X', 1000)$$, $$installment_get('X')$$, $$installment_my_plans()$$, $$installment_cancel('X')$$,
    $$installment_choose_pickup('X')$$, $$business_site_join(gen_random_uuid())$$, $$business_site_customers_list(gen_random_uuid())$$,
    $$installment_run_due()$$, $$installment_fulfil_payment('X','Y',1)$$, $$installment_escrow_ican()$$, $$_inst_close(gen_random_uuid(),'cancelled','x',0)$$,
    $$_inst_dispatch(gen_random_uuid())$$, $$_inst_hold(gen_random_uuid(),1,'wallet',gen_random_uuid())$$
  ] LOOP
    e := t.err('SELECT public.' || fn);
    PERFORM t.check('11 anonymous cannot call ' || fn, e LIKE 'permission denied%', e);
  END LOOP;
  PERFORM t.reset();
  PERFORM t.as_user(t.u(1));
  FOREACH fn IN ARRAY ARRAY[
    $$installment_run_due()$$, $$installment_fulfil_payment('X','Y',1)$$, $$installment_mark_refunded('X')$$, $$installment_escrow_ican()$$,
    $$_inst_close(gen_random_uuid(),'cancelled','x',0)$$, $$_inst_dispatch(gen_random_uuid())$$, $$_inst_return_to_wallet(gen_random_uuid(),1,'x','y')$$
  ] LOOP
    e := t.err('SELECT public.' || fn);
    PERFORM t.check('11 a signed-in customer cannot call ' || fn, e LIKE 'permission denied%', e);
  END LOOP;
  e := t.err($$INSERT INTO public.installment_plans (code, customer_user_id, reseller_business_profile_id, supermarket_id, cart, items, items_ugx, store_ugx, margin_ugx, deposit_ugx, n_installments, frequency_days, final_due_at) VALUES ('HACK', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), '[]', '[]', 1, 1, 0, 1, 1, 1, now())$$);
  PERFORM t.check('11 a customer cannot write plans directly', e LIKE 'permission denied%', e);
  e := t.err($$UPDATE public.installment_plans SET paid_ugx = 999999999$$);
  PERFORM t.check('11 a customer cannot edit plans directly', e LIKE 'permission denied%', e);
  e := t.err($$SELECT * FROM public.installment_config$$);
  PERFORM t.check('11 the settings are not readable by customers', e LIKE 'permission denied%', e);
  PERFORM t.reset();
END $t$;

-- ================================================================ 12. Final books
DO $t$
DECLARE r RECORD;
BEGIN
  PERFORM t.check('12.1 every coin is still accounted for', (t.supply() - t.minted()) = (SELECT val::NUMERIC FROM t.kv WHERE k = 'base'), t.supply() || ' / ' || t.minted());
  PERFORM t.check('12.2 no plan holds coins it should not', NOT EXISTS (SELECT 1 FROM public.installment_plans WHERE status IN ('cancelled','lapsed','dispatched','completed','pickup_ready') AND held_ican <> 0));
  PERFORM t.check('12.3 held coins always match payments on open plans', NOT EXISTS (
    SELECT 1 FROM public.installment_plans p WHERE p.status IN ('awaiting_deposit','active','ready')
      AND abs(p.held_ican - COALESCE((SELECT SUM(ROUND(amount_ugx / 5000, 8)) FROM public.installment_payments WHERE plan_id = p.id AND status = 'paid'), 0)) > 0.00000001));
  PERFORM t.check('12.4 reserved stock matches open plans', t.reserved(1) = COALESCE((SELECT SUM((c ->> 'quantity')::NUMERIC) FROM public.installment_plans p, jsonb_array_elements(p.cart) c
      WHERE p.status IN ('awaiting_deposit','active','ready') AND (c ->> 'product_id')::UUID = t.p(1)), 0), t.reserved(1)::TEXT);
END $t$;
