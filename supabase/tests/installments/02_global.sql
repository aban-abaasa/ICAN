\set ON_ERROR_STOP on
-- Global instalments: plans in other currencies (coins converted at each payment's coin price), pay in full, shops abroad
-- (ship-to-me with tracking, buyer protection, disputes, auto-release), domestic non-UGX stores, and the browse functions.
-- Runs after 01_engine.sql on the same database (reuses its t.* helpers).

CREATE FUNCTION t.ship_addr() RETURNS JSONB LANGUAGE sql AS
  $$ SELECT jsonb_build_object('name', 'Alice Buyer', 'phone', '+256772000001', 'line1', 'Plot 9 Ntinda Rd', 'city', 'Kampala', 'country', 'Uganda', 'note', 'Call on arrival') $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email) SELECT t.u(n), 'u' || n || '@test.dev' FROM unnest(ARRAY[40,41,42,60,62,63,70,72]) n;
INSERT INTO public.users (id, full_name, phone) VALUES (t.u(40), 'Ugandan Buyer', '0772000040'), (t.u(41), 'Kenyan Buyer', '0722000041'), (t.u(42), 'American Buyer', '+15550000042');
INSERT INTO public.t_user_cur VALUES (t.u(41), 'KES'), (t.u(42), 'USD');          -- the Ugandan buyer defaults to UGX
INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES (t.u(40), 100), (t.u(41), 100), (t.u(42), 100);
-- a shop in China: prices in CNY
INSERT INTO public.business_profiles (id, user_id, business_name) VALUES (t.b(61), t.u(60), 'Shenzhen Gadgets Ltd'), (t.b(62), t.u(62), 'AfriImports Reseller'),
  (t.b(71), t.u(70), 'Austin Audio'), (t.b(72), t.u(72), 'Austin Reseller');
INSERT INTO public.business_account_members (business_profile_id, auth_user_id) VALUES (t.b(62), t.u(63));
INSERT INTO auth.users (id, email) VALUES (t.u(61), 'u61@test.dev') ON CONFLICT DO NOTHING;
INSERT INTO public.supermarkets (id, owner_user_id, name, address, country, price_currency, pichin_business_profile_id) VALUES
  (t.b(65), t.u(60), 'Shenzhen Gadgets Warehouse', 'Nanshan District, Shenzhen', 'China', 'CNY', t.b(61)),
  (t.b(75), t.u(70), 'Austin Audio Store', '12 Congress Ave, Austin', 'United States', 'USD', t.b(71));
INSERT INTO public.products (id, supermarket_id, name, sku, selling_price, tax_rate, images, brand) VALUES
  (t.p(11), t.b(65), 'Smart Watch', 'SW-1', 100, 10, '["w.jpg"]', 'Zhi'),
  (t.p(12), t.b(75), 'Headset', 'HS-1', 40, 0, NULL, 'Aud');
INSERT INTO public.inventory (supermarket_id, product_id, current_stock, reserved_stock) VALUES (t.b(65), t.p(11), 50, 0), (t.b(75), t.p(12), 30, 0);
INSERT INTO public.dropship_listings (reseller_business_profile_id, product_id, supermarket_id, listed_price) VALUES
  (t.b(62), t.p(11), t.b(65), 120), (t.b(72), t.p(12), t.b(75), 50);
UPDATE t.kv SET val = (t.supply() - t.minted())::TEXT WHERE k = 'base';           -- the new wallets above are part of the supply now
-- cart W: 2 watches = 2 x 120 + 10 % tax = 264 CNY; store leg 224 (200 wholesale + 24 tax), reseller margin 40

-- ================================================================ 1. Terms per currency
DO $t$
DECLARE r JSONB; e TEXT;
BEGIN
  PERFORM t.as_anon();
  r := public.installment_terms('CNY');
  PERFORM t.check('G1.1 CNY terms: live coin price, 0.01 unit, thresholds converted from the UGX settings',
    (r ->> 'coin_price')::NUMERIC = 9.8 AND (r ->> 'unit')::NUMERIC = 0.01 AND (r ->> 'min_order_amount')::NUMERIC = 39.2 AND (r ->> 'min_payment_amount')::NUMERIC = 1.96
    AND NOT (r ->> 'delivery_available')::BOOLEAN, r::TEXT);
  r := public.installment_terms('KES');
  PERFORM t.check('G1.2 KES terms: unit 1, order minimum 700', (r ->> 'unit')::NUMERIC = 1 AND (r ->> 'min_order_amount')::NUMERIC = 700, r::TEXT);
  r := public.installment_terms();
  PERFORM t.check('G1.3 UGX terms are unchanged and the only ones with rider delivery', (r ->> 'coin_price')::NUMERIC = 5000 AND (r ->> 'min_order_amount')::NUMERIC = 20000 AND (r ->> 'delivery_available')::BOOLEAN, r::TEXT);
  e := t.err($$SELECT public.installment_terms('XXX')$$);
  PERFORM t.check('G1.4 a currency with no live coin price is refused with a clear message', e LIKE '%not available right now%', e);
  r := public.installment_quote(t.b(62), jsonb_build_array(jsonb_build_object('product_id', t.p(11), 'quantity', 2)));
  PERFORM t.check('G1.5 a quote for the shop in China is in CNY with a CNY minimum deposit',
    r ->> 'currency' = 'CNY' AND (r ->> 'items_amount')::NUMERIC = 264 AND (r ->> 'min_deposit_amount')::NUMERIC = 52.8 AND (r ->> 'coin_price')::NUMERIC = 9.8 AND (r ->> 'eligible')::BOOLEAN, r::TEXT);
  PERFORM t.check('G1.6 signed out, the quote does not guess whether the shop is abroad', (r -> 'cross_border') = 'null'::JSONB, r::TEXT);
  PERFORM t.as_user(t.u(40));
  r := public.installment_quote(t.b(62), jsonb_build_array(jsonb_build_object('product_id', t.p(11), 'quantity', 2)));
  PERFORM t.check('G1.7 a Ugandan buyer is told the shop in China is abroad', (r ->> 'cross_border')::BOOLEAN AND r ->> 'buyer_currency' = 'UGX', r::TEXT);
  PERFORM t.reset();
END $t$;

-- ================================================================ 2. Browse: currency and "abroad" for the person looking
DO $t$
DECLARE r RECORD;
BEGIN
  PERFORM t.as_anon();
  SELECT * INTO r FROM public.installment_browse_products('watch');
  PERFORM t.check('G2.1 anyone can browse, and each product says its currency', r.currency = 'CNY' AND r.min_price = 120 AND r.store_country = 'China' AND r.cross_border IS NULL, r::TEXT);
  PERFORM t.reset();
  PERFORM t.as_user(t.u(40));
  SELECT * INTO r FROM public.installment_browse_products('watch');
  PERFORM t.check('G2.2 a Ugandan buyer sees the shop in China as abroad', r.cross_border IS TRUE);
  SELECT * INTO r FROM public.installment_browse_products('headset');
  PERFORM t.check('G2.3 ... and the US shop too', r.currency = 'USD' AND r.cross_border IS TRUE);
  PERFORM t.check('G2.4 a Kenyan buyer sees the Ugandan fridge as abroad', (SELECT cross_border FROM public.installment_browse_products('fridge') LIMIT 1) IS NOT NULL);
  PERFORM t.reset();
  PERFORM t.as_user(t.u(42));
  SELECT * INTO r FROM public.installment_browse_products('headset');
  PERFORM t.check('G2.5 an American buyer sees the US shop as domestic', r.cross_border IS FALSE);
  PERFORM t.reset();
  SELECT * INTO r FROM public.installment_product_offers(t.p(11));
  PERFORM t.check('G2.6 offers carry the currency', r.currency = 'CNY' AND r.listed_price = 120 AND r.in_stock, r::TEXT);
  SELECT * INTO r FROM public.installment_shelf(t.b(62));
  PERFORM t.check('G2.7 the shelf carries currency, tax rate and country', r.currency = 'CNY' AND r.tax_rate = 10 AND r.store_country = 'China' AND r.available_stock = 50, r::TEXT);
END $t$;

-- ================================================================ 3. A CNY plan: coins priced at each payment
DO $t$
DECLARE r JSONB; p public.installment_plans; v_code TEXT; v_before NUMERIC := t.bal(40); e TEXT; s JSONB; v_coins NUMERIC;
        v_cart JSONB := jsonb_build_array(jsonb_build_object('product_id', t.p(11), 'quantity', 2));
BEGIN
  PERFORM t.as_user(t.u(40));
  e := t.err(format($$SELECT public.installment_create(%L, %L::jsonb, 2, 7, 40)$$, t.b(62), v_cart));
  PERFORM t.check('G3.1 the minimum deposit is enforced in CNY', e LIKE '%deposit must be at least CNY 52.8%', e);
  r := public.installment_create(t.b(62), v_cart, 2, 7, 100);
  v_code := r ->> 'code'; INSERT INTO t.kv VALUES ('cny', v_code);
  p := t.plan(v_code);
  PERFORM t.reset();
  PERFORM t.check('G3.2 the plan is in CNY, abroad for a UGX buyer, with a 0.01 unit', p.currency = 'CNY' AND p.cross_border AND p.buyer_currency = 'UGX' AND p.unit = 0.01 AND (r ->> 'cross_border')::BOOLEAN, r::TEXT);
  PERFORM t.check('G3.3 the deposit bought coins at 9.8 CNY per coin', p.held_ican = ROUND(100 / 9.8, 8) AND v_before - t.bal(40) = ROUND(100 / 9.8, 8), p.held_ican::TEXT);
  PERFORM t.check('G3.4 the ledger records the amount in CNY', EXISTS (SELECT 1 FROM public.ican_coin_transactions WHERE sender_user_id = t.u(40) AND local_currency = 'CNY' AND local_amount = 100));
  PERFORM t.as_user(t.u(40));
  s := public.installment_get(v_code) -> 'plan' -> 'schedule';
  PERFORM t.reset();
  PERFORM t.check('G3.5 the schedule rounds to 0.01 and adds up to 264', jsonb_array_length(s) = 3 AND (s -> 1 ->> 'amount')::NUMERIC = 82 AND (s -> 2 ->> 'amount')::NUMERIC = 82
    AND (SELECT SUM((x ->> 'amount')::NUMERIC) FROM jsonb_array_elements(s) x) = 264, s::TEXT);

  -- the coin gets dearer, then cheaper: each payment buys coins at ITS moment's price
  UPDATE public.t_prices SET price = 10 WHERE currency = 'CNY';
  PERFORM t.as_user(t.u(40));
  e := t.err(format($$SELECT public.installment_pay_wallet(%L, 1)$$, v_code));
  PERFORM t.check('G3.6 the smallest payment is the converted minimum (CNY 2)', e LIKE '%smallest payment is CNY 2%', e);
  PERFORM public.installment_pay_wallet(v_code, 82);
  UPDATE public.t_prices SET price = 8 WHERE currency = 'CNY';
  PERFORM public.installment_pay_wallet(v_code, 82);
  PERFORM t.reset();
  p := t.plan(v_code);
  v_coins := ROUND(100 / 9.8, 8) + 8.2 + 10.25;
  PERFORM t.check('G3.7 the held coins are the sum of what each payment bought', p.held_ican = v_coins AND p.status = 'ready' AND p.paid_amount = 264, p.held_ican::TEXT || ' vs ' || v_coins);
  PERFORM t.check('G3.8 the payments remember their coin price', (SELECT array_agg(coin_price ORDER BY coin_price DESC) FROM public.installment_payments WHERE plan_id = p.id) = ARRAY[10, 9.8, 8]::NUMERIC[]);
  UPDATE public.t_prices SET price = 9.8 WHERE currency = 'CNY';
  PERFORM t.check('G3.9 coins are conserved across currencies', (t.supply() - t.minted()) = (SELECT val::NUMERIC FROM t.kv WHERE k = 'base'));
END $t$;

-- ================================================================ 4. Abroad: no pickup, no rider — ship to me
DO $t$
DECLARE v_code TEXT := (SELECT val FROM t.kv WHERE k = 'cny'); e TEXT; r JSONB;
BEGIN
  PERFORM t.as_user(t.u(40));
  e := t.err(format($$SELECT public.installment_choose_pickup(%L)$$, v_code));
  PERFORM t.check('G4.1 collecting is refused for a shop abroad', e LIKE '%another country%shipping%', e);
  e := t.err(format($$SELECT public.installment_choose_delivery(%L, 'x', 0.3, 32.5, 4)$$, v_code));
  PERFORM t.check('G4.2 so is a local rider', e LIKE '%another country%', e);
  e := t.err(format($$SELECT public.installment_choose_shipping(%L, '{"name":"A"}'::jsonb)$$, v_code));
  PERFORM t.check('G4.3 shipping needs a full address', e LIKE '%needs your%', e);
  e := t.err(format($$SELECT public.installment_choose_shipping(%L, NULL)$$, v_code));
  PERFORM t.check('G4.4 and an address at all', e LIKE '%Enter your shipping address%', e);
  PERFORM t.reset();

  PERFORM t.as_user(t.u(3));
  e := t.err(format($$SELECT public.installment_choose_shipping(%L, %L::jsonb)$$, v_code, t.ship_addr()));
  PERFORM t.reset();
  PERFORM t.check('G4.5 only the owner can choose shipping', e LIKE '%Plan not found%', e);

  PERFORM t.as_user(t.u(40));
  r := public.installment_choose_shipping(v_code, t.ship_addr() || '{"evil":"<script>","line2":"  "}'::jsonb);
  PERFORM t.reset();
  PERFORM t.check('G4.6 shipping chosen: waiting for the seller', (r ->> 'status') = 'shipping_pending' AND (t.plan(v_code)).status = 'shipping_pending' AND (t.plan(v_code)).fulfilment = 'ship');
  PERFORM t.check('G4.7 the address keeps only known, non-empty fields', NOT ((t.plan(v_code)).shipping ? 'evil') AND NOT ((t.plan(v_code)).shipping ? 'line2') AND (t.plan(v_code)).shipping ->> 'city' = 'Kampala', (t.plan(v_code)).shipping::TEXT);
  PERFORM t.check('G4.8 the stock is still only reserved; the seller has been paid nothing', t.reserved(11) = 2 AND t.stock(11) = 50 AND t.bizbal(61) = 0 AND t.bizbal(62) = 0);
  PERFORM t.check('G4.9 the held coins are still held and counted', public.installment_escrow_ican() >= (t.plan(v_code)).held_ican AND (t.supply() - t.minted()) = (SELECT val::NUMERIC FROM t.kv WHERE k = 'base'));
  PERFORM t.as_user(t.u(40));
  e := t.err(format($$SELECT public.installment_confirm_received(%L)$$, v_code));
  PERFORM t.check('G4.10 nothing can be confirmed before it is shipped', e LIKE '%has not shipped%', e);
  e := t.err(format($$SELECT public.installment_report_problem(%L, 'it is late and I am worried about it')$$, v_code));
  PERFORM t.check('G4.11 nor reported', e LIKE '%once the seller has shipped%', e);
  PERFORM t.reset();
  PERFORM t.check('G4.12 the price lock still holds while it waits to ship', t.err(format($$UPDATE public.dropship_listings SET listed_price = 130 WHERE product_id = %L$$, t.p(11))) LIKE '%instalments%');
END $t$;

-- ================================================================ 5. The seller ships; the buyer confirms; the seller is paid
DO $t$
DECLARE v_code TEXT := (SELECT val FROM t.kv WHERE k = 'cny'); e TEXT; r JSONB; p public.installment_plans; v_held NUMERIC; v_store NUMERIC; v_list JSONB;
BEGIN
  PERFORM t.as_user(t.u(3));
  e := t.err(format($$SELECT public.installment_seller_ship(%L, 'DHL', 'JD0123456789')$$, v_code));
  PERFORM t.reset();
  PERFORM t.check('G5.1 an outsider cannot ship someone else''s order', e LIKE '%Plan not found%', e);

  PERFORM t.as_user(t.u(63));
  v_list := public.installment_seller_plans(t.b(62));
  PERFORM t.check('G5.2 the seller sees the order with the buyer''s shipping address', (v_list -> 0 -> 'shipping' ->> 'line1') = 'Plot 9 Ntinda Rd' AND (v_list -> 0 ->> 'status') = 'shipping_pending' AND (v_list -> 0 ->> 'currency') = 'CNY', v_list::TEXT);
  e := t.err(format($$SELECT public.installment_seller_ship(%L, '', '')$$, v_code));
  PERFORM t.check('G5.3 the carrier and tracking number are required', e LIKE '%carrier and the tracking number%', e);
  e := t.err(format($$SELECT public.installment_seller_ship(%L, 'DHL', 'JD0123456789', 'javascript:alert(1)')$$, v_code));
  PERFORM t.check('G5.4 a tracking link must be http(s)', e LIKE '%http%', e);
  r := public.installment_seller_ship(v_code, 'DHL Express', 'JD0123456789', 'https://track.example/JD0123456789', 12);
  PERFORM t.reset();
  p := t.plan(v_code);
  PERFORM t.check('G5.5 shipped: tracking recorded, stock left the shelf', (r ->> 'status') = 'shipped' AND p.status = 'shipped' AND p.shipment ->> 'tracking_no' = 'JD0123456789' AND p.shipment ->> 'carrier' = 'DHL Express'
    AND t.stock(11) = 48 AND t.reserved(11) = 0, p.shipment::TEXT);
  PERFORM t.check('G5.6 the sale is on the books as an international shipment', (SELECT transport_provider FROM public.dropship_orders WHERE id = p.dropship_order_id) = 'international_shipping'
    AND (SELECT delivery_address FROM public.dropship_orders WHERE id = p.dropship_order_id) LIKE '%Ntinda%');
  PERFORM t.check('G5.7 still nobody is paid, the coins are still held', t.bizbal(61) = 0 AND t.bizbal(62) = 0 AND p.held_ican > 0);
  PERFORM t.as_user(t.u(63));
  e := t.err(format($$SELECT public.installment_seller_ship(%L, 'DHL', 'again')$$, v_code));
  PERFORM t.reset();
  PERFORM t.check('G5.8 it cannot be shipped twice', e LIKE '%not waiting to be shipped%', e);

  PERFORM t.as_user(t.u(40));
  r := public.installment_get(v_code);
  PERFORM t.check('G5.9 the buyer sees tracking and when it auto-releases', r -> 'plan' -> 'shipment' ->> 'tracking_url' LIKE 'https://track.example/%' AND r -> 'plan' ->> 'auto_release_at' IS NOT NULL AND (r -> 'plan' ->> 'ship_available')::BOOLEAN, r::TEXT);
  e := t.err(format($$SELECT public.installment_cancel(%L)$$, v_code));
  PERFORM t.check('G5.10 a shipped order can no longer be cancelled by the buyer', e LIKE '%can no longer be cancelled%', e);
  v_held := p.held_ican;
  r := public.installment_confirm_received(v_code);
  PERFORM t.reset();
  v_store := ROUND(v_held * 224 / 264, 8);
  PERFORM t.check('G5.11 confirming receipt completes the plan', (r ->> 'status') = 'completed' AND (t.plan(v_code)).status = 'completed' AND (t.plan(v_code)).held_ican = 0);
  PERFORM t.check('G5.12 the store and the reseller are paid in the proportion of the price, to the last coin', t.bizbal(61) = v_store AND t.bizbal(62) = v_held - v_store, t.bizbal(61) || ' / ' || t.bizbal(62) || ' vs ' || v_store);
  PERFORM t.check('G5.13 coins are conserved after the payout', (t.supply() - t.minted()) = (SELECT val::NUMERIC FROM t.kv WHERE k = 'base'));
  PERFORM t.as_user(t.u(40));
  e := t.err(format($$SELECT public.installment_confirm_received(%L)$$, v_code));
  PERFORM t.reset();
  PERFORM t.check('G5.14 the seller cannot be paid twice', e LIKE '%nothing to confirm%', e);
END $t$;

-- ================================================================ 6. Problems: report, seller refund, support decision
DO $t$
DECLARE v_cart JSONB := jsonb_build_array(jsonb_build_object('product_id', t.p(11), 'quantity', 1)); r JSONB; e TEXT; v_a TEXT; v_b TEXT; v_c TEXT;
        v_bal NUMERIC; v_stock NUMERIC; v_held NUMERIC; v_paid NUMERIC;
BEGIN
  -- three plans, each paid in full at once (1 watch = 132 CNY) and shipped
  PERFORM t.as_user(t.u(40));
  v_a := (public.installment_create(t.b(62), v_cart, 0, 7, 132)) ->> 'code';
  v_b := (public.installment_create(t.b(62), v_cart, 0, 7, 132)) ->> 'code';
  v_c := (public.installment_create(t.b(62), v_cart, 0, 7, 132)) ->> 'code';
  PERFORM t.check('G6.0 pay in full: ready at once, and the schedule is the one payment', (t.plan(v_a)).status = 'ready' AND (t.plan(v_a)).n_installments = 0 AND (SELECT count(*) FROM public.installment_payments WHERE plan_id = (t.plan(v_a)).id) = 1);
  PERFORM public.installment_choose_shipping(v_a, t.ship_addr());
  PERFORM public.installment_choose_shipping(v_b, t.ship_addr());
  PERFORM public.installment_choose_shipping(v_c, t.ship_addr());
  PERFORM t.reset();
  PERFORM t.as_user(t.u(63));
  PERFORM public.installment_seller_ship(v_a, 'DHL', 'A1'); PERFORM public.installment_seller_ship(v_b, 'DHL', 'B1'); PERFORM public.installment_seller_ship(v_c, 'DHL', 'C1');
  PERFORM t.reset();

  PERFORM t.as_user(t.u(40));
  e := t.err(format($$SELECT public.installment_report_problem(%L, 'short')$$, v_a));
  PERFORM t.check('G6.1 a problem report needs an explanation', e LIKE '%what went wrong%', e);
  r := public.installment_report_problem(v_a, 'The parcel arrived empty and the courier agrees');
  PERFORM public.installment_report_problem(v_b, 'The watch is not the one I ordered at all');
  PERFORM t.reset();
  PERFORM t.check('G6.2 a reported order is disputed and its money stays held', (r ->> 'status') = 'disputed' AND (t.plan(v_a)).status = 'disputed' AND (t.plan(v_a)).held_ican > 0 AND (t.plan(v_a)).problem ->> 'note' LIKE 'The parcel%');
  PERFORM t.check('G6.3 the seller still has not been paid', t.bizbal(61) = (SELECT ROUND(ican_balance, 8) FROM public.ican_business_wallets WHERE business_profile_id = t.b(61)));

  -- the seller agrees to refund A: the buyer gets the coins back in full; the stock is NOT put back (it left the shelf)
  v_bal := t.bal(40); v_held := (t.plan(v_a)).held_ican; v_paid := (t.plan(v_a)).paid_amount; v_stock := t.stock(11);
  PERFORM t.as_user(t.u(3));
  e := t.err(format($$SELECT public.installment_seller_cancel(%L)$$, v_a));
  PERFORM t.reset();
  PERFORM t.check('G6.4 an outsider cannot refund', e LIKE '%Plan not found%', e);
  PERFORM t.as_user(t.u(63));
  r := public.installment_seller_cancel(v_a, 'Sorry — refunded');
  PERFORM t.reset();
  PERFORM t.check('G6.5 the seller refunds a disputed order in full', (r ->> 'status') = 'cancelled' AND (r ->> 'refunded_amount')::NUMERIC = v_paid AND t.bal(40) = v_bal + v_held AND (t.plan(v_a)).held_ican = 0, r::TEXT);
  PERFORM t.check('G6.6 the shipped stock is not restocked automatically', t.stock(11) = v_stock);

  -- support decides B: customers and sellers cannot
  PERFORM t.as_user(t.u(40));
  e := t.err(format($$SELECT public.installment_admin_resolve(%L, 'refund')$$, v_b));
  PERFORM t.reset();
  PERFORM t.check('G6.7 only support (the service role) can decide a dispute', e LIKE 'permission denied%', e);
  PERFORM t.as_service();
  e := t.err(format($$SELECT public.installment_admin_resolve(%L, 'refund')$$, v_c));
  PERFORM t.check('G6.8 only disputed orders can be decided', e LIKE '%No disputed order%', e);
  e := t.err(format($$SELECT public.installment_admin_resolve(%L, 'maybe')$$, v_b));
  PERFORM t.check('G6.9 the decision must be refund or release', e LIKE '%refund or release%', e);
  v_bal := (SELECT ican_balance FROM public.ican_business_wallets WHERE business_profile_id = t.b(61));
  r := public.installment_admin_resolve(v_b, 'release', 'Photos show the right watch');
  PERFORM t.reset();
  PERFORM t.check('G6.10 support can release a disputed order to the seller', (r ->> 'status') = 'completed' AND (t.plan(v_b)).status = 'completed' AND t.bizbal(61) > v_bal);
  PERFORM t.check('G6.11 coins are conserved through refunds and releases', (t.supply() - t.minted()) = (SELECT val::NUMERIC FROM t.kv WHERE k = 'base'));
  INSERT INTO t.kv VALUES ('shippedC', v_c);
END $t$;

-- ================================================================ 7. The sweep: unshipped refunds, auto-release
DO $t$
DECLARE v_cart JSONB := jsonb_build_array(jsonb_build_object('product_id', t.p(11), 'quantity', 1)); v_u TEXT; v_old TEXT; v_new TEXT; r JSONB; v_bal NUMERIC; v_res NUMERIC;
BEGIN
  PERFORM t.as_user(t.u(40));
  v_u := (public.installment_create(t.b(62), v_cart, 0, 7, 132)) ->> 'code';
  PERFORM public.installment_choose_shipping(v_u, t.ship_addr());
  PERFORM t.reset();
  UPDATE public.installment_plans SET shipping_chosen_at = now() - interval '15 days' WHERE code = v_u;
  -- C (shipped earlier) goes past the protection period; a fresh one is shipped just now
  v_old := (SELECT val FROM t.kv WHERE k = 'shippedC');
  UPDATE public.installment_plans SET shipped_at = now() - interval '31 days' WHERE code = v_old;
  PERFORM t.as_user(t.u(40));
  v_new := (public.installment_create(t.b(62), v_cart, 0, 7, 132)) ->> 'code';
  PERFORM public.installment_choose_shipping(v_new, t.ship_addr());
  PERFORM t.reset();
  PERFORM t.as_user(t.u(63)); PERFORM public.installment_seller_ship(v_new, 'DHL', 'N1'); PERFORM t.reset();
  UPDATE public.installment_plans SET shipped_at = now() - interval '10 days' WHERE code = v_new;
  v_res := t.reserved(11); v_bal := t.bal(40);

  PERFORM t.as_service();
  r := public.installment_run_due();
  PERFORM t.reset();
  PERFORM t.check('G7.1 the sweep refunds one unshipped order and auto-releases one shipped order', (r ->> 'unshipped_refunded')::INT = 1 AND (r ->> 'auto_released')::INT = 1, r::TEXT);
  PERFORM t.check('G7.2 the unshipped order was refunded in full and its stock released', (t.plan(v_u)).status = 'cancelled' AND (t.plan(v_u)).cancel_fee_amount = 0 AND t.bal(40) > v_bal AND t.reserved(11) = v_res - 1);
  PERFORM t.check('G7.3 the old shipped order paid the seller', (t.plan(v_old)).status = 'completed' AND (t.plan(v_old)).held_ican = 0);
  PERFORM t.check('G7.4 a recent shipped order is left alone', (t.plan(v_new)).status = 'shipped' AND (t.plan(v_new)).held_ican > 0);
  PERFORM t.check('G7.5 coins are conserved after the sweep', (t.supply() - t.minted()) = (SELECT val::NUMERIC FROM t.kv WHERE k = 'base'));
END $t$;

-- ================================================================ 8. Mobile Money / card / bank in another currency
DO $t$
DECLARE v_cart JSONB := jsonb_build_array(jsonb_build_object('product_id', t.p(11), 'quantity', 2)); v_code TEXT; r JSONB; ref TEXT; v_bal NUMERIC := t.bal(40); p public.installment_plans; e TEXT;
BEGIN
  PERFORM t.as_user(t.u(40));
  r := public.installment_create(t.b(62), v_cart, 2, 7, 100, 'flutterwave');
  v_code := r ->> 'code';
  r := public.installment_pay_start(v_code, 100, TRUE);
  PERFORM t.check('G8.1 the charge is in CNY, rounded to 0.01, with the fee and the coin price', r ->> 'currency' = 'CNY' AND (r ->> 'coin_price')::NUMERIC = 9.8
    AND (r ->> 'charge_amount')::NUMERIC = ceil(100 / 0.965 / 0.01) * 0.01 AND (r ->> 'ican_amount')::NUMERIC = ROUND(100 / 9.8, 8), r::TEXT);
  r := public.installment_pay_start(v_code, 100);
  ref := r ->> 'tx_ref';
  PERFORM t.reset();
  UPDATE public.t_prices SET price = 12 WHERE currency = 'CNY';             -- the coin moves while the customer is paying
  PERFORM t.as_service();
  r := public.installment_fulfil_payment(ref, 'FLW-CNY-1', 103.00);
  PERFORM t.check('G8.2 an underpayment in CNY is refused', NOT (r ->> 'success')::BOOLEAN AND r ->> 'error' LIKE '%less than%', r::TEXT);
  r := public.installment_fulfil_payment(ref, 'FLW-CNY-1', (ceil(100 / 0.965 / 0.01) * 0.01));
  PERFORM t.reset();
  p := t.plan(v_code);
  PERFORM t.check('G8.3 the verified payment mints the coins at the price it was started at, not the later price', (r ->> 'success')::BOOLEAN AND p.status = 'active' AND p.held_ican = ROUND(100 / 9.8, 8)
    AND (SELECT SUM(ican) FROM public.minted WHERE payment_ref = 'INS-' || ref) = ROUND(100 / 9.8, 8), r::TEXT);
  PERFORM t.check('G8.4 the wallet is unchanged (coins in, coins held)', t.bal(40) = v_bal);
  UPDATE public.t_prices SET price = 9.8 WHERE currency = 'CNY';
  PERFORM t.as_user(t.u(40)); PERFORM public.installment_cancel(v_code); PERFORM t.reset();
END $t$;

-- ================================================================ 9. A store priced in another currency IN the buyer's own country
DO $t$
DECLARE v_cart JSONB := jsonb_build_array(jsonb_build_object('product_id', t.p(12), 'quantity', 4)); v_code TEXT; r JSONB; p public.installment_plans; e TEXT; v_split NUMERIC; v_receipt TEXT;
BEGIN
  -- 4 headsets = 4 x 50 = 200 USD, store leg 160, margin 40
  PERFORM t.as_user(t.u(42));
  r := public.installment_create(t.b(72), v_cart, 1, 14, 100);
  v_code := r ->> 'code';
  p := t.plan(v_code);
  PERFORM t.check('G9.1 a US buyer at a US shop: USD plan, not abroad, unit 0.01', p.currency = 'USD' AND NOT p.cross_border AND p.unit = 0.01 AND p.held_ican = ROUND(100 / 1.35, 8), r::TEXT);
  PERFORM t.reset(); UPDATE public.ican_user_wallets SET ican_balance = ican_balance + 100 WHERE user_id = t.u(42); UPDATE t.kv SET val = (val::NUMERIC + 100)::TEXT WHERE k = 'base'; PERFORM t.as_user(t.u(42));
  PERFORM public.installment_pay_wallet(v_code, 100);
  e := t.err(format($$SELECT public.installment_choose_shipping(%L, %L::jsonb)$$, v_code, t.ship_addr()));
  PERFORM t.check('G9.2 a domestic buyer is not shipped to', e LIKE '%your own country%', e);
  e := t.err(format($$SELECT public.installment_choose_delivery(%L, 'x', 30.2, -97.7, 4)$$, v_code));
  PERFORM t.check('G9.3 rider delivery is only for UGX stores so far', e LIKE '%only available for stores priced in UGX%', e);
  r := public.installment_choose_pickup(v_code);
  p := t.plan(v_code);
  PERFORM t.reset();
  v_receipt := p.receipt_code;
  v_split := ROUND(ROUND(100 / 1.35, 8) * 2 * 160 / 200, 8);
  PERFORM t.check('G9.4 pickup works in USD with legs split by the price', (r ->> 'status') = 'pickup_ready' AND (SELECT ((settlement_legs -> 0 ->> 'ican_amount')::NUMERIC) FROM public.icanera_delivery_receipts WHERE verification_code = v_receipt) > 0, r::TEXT);
  PERFORM t.as_user(t.u(70));
  PERFORM public.icanera_confirm_pickup(v_receipt);
  PERFORM t.reset();
  PERFORM t.check('G9.5 the store scan pays the store and the reseller exactly what the plan held', t.bizbal(71) + t.bizbal(72) = ROUND(100 / 1.35, 8) * 2 AND t.bizbal(71) = ROUND(ROUND(100 / 1.35, 8) * 2 * 160 / 200, 8),
    t.bizbal(71) || ' / ' || t.bizbal(72));
  PERFORM t.check('G9.6 coins are conserved', (t.supply() - t.minted()) = (SELECT val::NUMERIC FROM t.kv WHERE k = 'base'));
END $t$;

-- ================================================================ 10. Unavailable prices, totals per currency, grants
DO $t$
DECLARE e TEXT; r JSONB;
BEGIN
  INSERT INTO public.supermarkets (id, owner_user_id, name, price_currency, pichin_business_profile_id) VALUES (t.b(95), t.u(60), 'Mystery Store', 'XYZ', t.b(61));
  INSERT INTO public.products (id, supermarket_id, name, selling_price, tax_rate) VALUES (t.p(13), t.b(95), 'Mystery', 10, 0);
  INSERT INTO public.inventory (supermarket_id, product_id, current_stock, reserved_stock) VALUES (t.b(95), t.p(13), 5, 0);
  INSERT INTO public.dropship_listings (reseller_business_profile_id, product_id, supermarket_id, listed_price) VALUES (t.b(62), t.p(13), t.b(95), 12);
  PERFORM t.as_user(t.u(40));
  e := t.err(format($$SELECT public.installment_create(%L, %L::jsonb, 1, 7, 6)$$, t.b(62), jsonb_build_array(jsonb_build_object('product_id', t.p(13), 'quantity', 1))));
  PERFORM t.check('G10.1 a currency with no live coin price cannot start a plan, and nothing is left behind', e LIKE '%not available right now%' AND t.reserved(13) = 0, e);
  r := public.installment_quote(t.b(62), jsonb_build_array(jsonb_build_object('product_id', t.p(13), 'quantity', 1)));
  PERFORM t.check('G10.2 and its quote says so instead of failing', NOT (r ->> 'success')::BOOLEAN AND r ->> 'error' LIKE '%not available right now%', r::TEXT);
  r := public.business_site_my_accounts();
  PERFORM t.check('G10.3 account totals are kept per currency, never added across them',
    (SELECT COUNT(*) FROM jsonb_array_elements(r) a WHERE a ->> 'business_name' = 'AfriImports Reseller') = 1
    AND (SELECT (a -> 'totals' -> 0 ->> 'currency') FROM jsonb_array_elements(r) a WHERE a ->> 'business_name' = 'AfriImports Reseller') = 'CNY', r::TEXT);
  PERFORM t.reset();
  PERFORM t.as_user(t.u(63));
  r := public.business_site_customers_list(t.b(62));
  PERFORM t.check('G10.4 the seller''s customer list is per currency too', jsonb_typeof(r -> 0 -> 'totals') = 'array' AND r -> 0 -> 'totals' -> 0 ->> 'currency' = 'CNY', r::TEXT);
  PERFORM t.reset();

  PERFORM t.as_anon();
  FOREACH e IN ARRAY ARRAY[$$installment_choose_shipping('X','{}'::jsonb)$$, $$installment_seller_ship('X','a','b')$$, $$installment_confirm_received('X')$$,
    $$installment_report_problem('X','a long enough note')$$, $$installment_admin_resolve('X','refund')$$, $$_inst_record_sale(gen_random_uuid(),'a','b')$$,
    $$_inst_release_to_sellers(gen_random_uuid(),'x')$$, $$_inst_refund_shipped(gen_random_uuid(),'x')$$, $$_inst_price('CNY')$$] LOOP
    PERFORM t.check('G10 anonymous cannot call ' || e, t.err('SELECT public.' || e) LIKE 'permission denied%', t.err('SELECT public.' || e));
  END LOOP;
  PERFORM t.reset();
  PERFORM t.as_user(t.u(40));
  FOREACH e IN ARRAY ARRAY[$$installment_admin_resolve('X','refund')$$, $$_inst_record_sale(gen_random_uuid(),'a','b')$$, $$_inst_release_to_sellers(gen_random_uuid(),'x')$$,
    $$_inst_refund_shipped(gen_random_uuid(),'x')$$, $$_inst_price('CNY')$$, $$_inst_totals(gen_random_uuid(), gen_random_uuid())$$] LOOP
    PERFORM t.check('G10 a customer cannot call ' || e, t.err('SELECT public.' || e) LIKE 'permission denied%', t.err('SELECT public.' || e));
  END LOOP;
  PERFORM t.reset();
END $t$;

-- ================================================================ 11. Final books
DO $t$
BEGIN
  PERFORM t.check('G11.1 every coin is accounted for', (t.supply() - t.minted()) = (SELECT val::NUMERIC FROM t.kv WHERE k = 'base'), (t.supply() - t.minted())::TEXT);
  PERFORM t.check('G11.2 no closed plan holds coins', NOT EXISTS (SELECT 1 FROM public.installment_plans WHERE status IN ('cancelled', 'lapsed', 'completed', 'dispatched', 'pickup_ready') AND held_ican <> 0));
  PERFORM t.check('G11.3 held coins equal the coins bought by the paid payments on every open plan', NOT EXISTS (
    SELECT 1 FROM public.installment_plans p WHERE p.status IN ('awaiting_deposit', 'active', 'ready', 'shipping_pending', 'shipped', 'disputed')
      AND abs(p.held_ican - COALESCE((SELECT SUM(ican_amount) FROM public.installment_payments WHERE plan_id = p.id AND status = 'paid'), 0)) > 0.00000001));
END $t$;

-- ================================================================ 12. A plan's page gets the terms of ITS currency
DO $t$
DECLARE r JSONB; v_code TEXT;
BEGIN
  PERFORM t.as_user(t.u(40));
  v_code := (public.installment_create(t.b(62), jsonb_build_array(jsonb_build_object('product_id', t.p(11), 'quantity', 1)), 2, 7, 40)) ->> 'code';
  r := public.installment_get(v_code);
  PERFORM t.check('G12.1 installment_get returns the terms in the plan''s own currency (minimum payment, unit, coin price)',
    r -> 'terms' ->> 'currency' = 'CNY' AND (r -> 'terms' ->> 'unit')::NUMERIC = 0.01 AND (r -> 'terms' ->> 'min_payment_amount')::NUMERIC < 10 AND (r -> 'terms' ->> 'coin_price')::NUMERIC = 9.8, (r -> 'terms')::TEXT);
  PERFORM t.reset();
END $t$;
