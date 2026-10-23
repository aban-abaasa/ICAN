-- Delivery on the business website Market: the migration under test has been applied to the world in 01_world.sql.
\set ON_ERROR_STOP on

-- ── the switches are closed to the API roles; only the functions reach them ──
SELECT t.as_anon();
SELECT t.check('anon cannot read the delivery switches directly', t.raises($$ SELECT * FROM public.cmms_site_delivery $$));
SELECT t.login(1);
SELECT t.check('a signed-in user cannot read or write them directly either',
  t.raises($$ SELECT * FROM public.cmms_site_delivery $$) AND t.raises($$ INSERT INTO public.cmms_site_delivery (business_profile_id, enabled) VALUES (t.u(101), TRUE) $$));
SELECT t.as_admin();

-- ── who may ──
SELECT t.as_anon();
SELECT t.check('anonymous: cannot look at the checklist or flip the switch (not even callable)',
  t.raises($$ SELECT public.get_cmms_site_delivery(t.u(301)) $$) AND t.raises($$ SELECT public.fn_set_cmms_site_delivery(t.u(301), TRUE) $$));
SELECT t.login(2);
SELECT t.check('no rights on the website tool: refused', t.error_of($$ SELECT public.get_cmms_site_delivery(t.u(301)) $$) ILIKE '%permission%');
SELECT t.check('no rights on the website tool: cannot switch it either', t.error_of($$ SELECT public.fn_set_cmms_site_delivery(t.u(301), TRUE) $$) ILIKE '%permission%');
SELECT t.login(3);
SELECT t.check('website team who are not in the business: can read the checklist, may not change it',
  (public.get_cmms_site_delivery(t.u(301)) ->> 'can_change')::BOOLEAN IS FALSE
  AND t.error_of($$ SELECT public.fn_set_cmms_site_delivery(t.u(301), TRUE) $$) ILIKE '%member of the business%');
SELECT t.login(1);
SELECT t.check('a website that is not linked to a business says so',
  t.error_of($$ SELECT public.get_cmms_site_delivery(t.u(306)) $$) ILIKE '%Link this website%');

-- ── the checklist ──
DO $$
DECLARE i JSONB := public.get_cmms_site_delivery(t.u(301));
BEGIN
  PERFORM t.check('checklist: a store with location, wallet and UGX is ready and off by default',
    (i ->> 'ready')::BOOLEAN AND NOT (i ->> 'enabled')::BOOLEAN AND (i ->> 'can_change')::BOOLEAN AND i ->> 'store_name' = 'Kampala Mart Ntinda', i::TEXT);
  PERFORM t.check('checklist: products are counted with the reason they cannot go',
    (i -> 'products' ->> 'deliverable')::INT = 3 AND (i -> 'products' ->> 'no_tax')::INT = 1 AND (i -> 'products' ->> 'excluded')::INT = 1
    AND (i -> 'products' ->> 'no_price')::INT = 1 AND (i -> 'products' ->> 'services')::INT = 1, (i -> 'products')::TEXT);
  i := public.get_cmms_site_delivery(t.u(302));
  PERFORM t.check('checklist: no pickup location -> not ready', NOT (i ->> 'ready')::BOOLEAN AND NOT (i -> 'checks' ->> 'location')::BOOLEAN AND (i -> 'checks' ->> 'wallet')::BOOLEAN);
  i := public.get_cmms_site_delivery(t.u(303));
  PERFORM t.check('checklist: no business wallet -> not ready', NOT (i ->> 'ready')::BOOLEAN AND NOT (i -> 'checks' ->> 'wallet')::BOOLEAN);
  i := public.get_cmms_site_delivery(t.u(304));
  PERFORM t.check('checklist: a store selling in USD -> not ready (rider fares are UGX)', NOT (i ->> 'ready')::BOOLEAN AND NOT (i -> 'checks' ->> 'ugx')::BOOLEAN);
  i := public.get_cmms_site_delivery(t.u(305));
  PERFORM t.check('checklist: no store at all -> not ready', NOT (i ->> 'ready')::BOOLEAN AND NOT (i -> 'checks' ->> 'store')::BOOLEAN);
END $$;

-- ── the switch refuses to move until the store can really deliver, and says why ──
SELECT t.check('cannot switch on without a pickup location', t.error_of($$ SELECT public.fn_set_cmms_site_delivery(t.u(302), TRUE) $$) ILIKE '%pickup location%');
SELECT t.check('cannot switch on without a business wallet', t.error_of($$ SELECT public.fn_set_cmms_site_delivery(t.u(303), TRUE) $$) ILIKE '%business wallet%');
SELECT t.check('cannot switch on for a store that sells in another currency', t.error_of($$ SELECT public.fn_set_cmms_site_delivery(t.u(304), TRUE) $$) ILIKE '%UGX%');
SELECT t.check('cannot switch on without a store', t.error_of($$ SELECT public.fn_set_cmms_site_delivery(t.u(305), TRUE) $$) ILIKE '%no store linked%');
SELECT t.as_admin();
SELECT t.check('nothing was written by the refused attempts', (SELECT count(*) FROM public.cmms_site_delivery WHERE enabled) = 0);

-- ── what visitors may see ──
SELECT t.as_anon();
SELECT t.check('off by default: the storefront offers nothing', public.get_site_delivery_storefront(t.u(101)) = jsonb_build_object('enabled', FALSE));
SELECT t.check('a business that does not exist offers nothing', public.get_site_delivery_storefront(t.u(998)) = jsonb_build_object('enabled', FALSE));
SELECT t.check('NULL offers nothing', public.get_site_delivery_storefront(NULL) = jsonb_build_object('enabled', FALSE));

-- ── nothing is lent before delivery is on, so nobody can order a store product ──
SELECT t.login(4);
SELECT t.check('delivery off: an order for a store product is refused by dropship itself',
  t.error_of($$ SELECT public.site_checkout_with_pin('good-pin', t.u(101), jsonb_build_array(jsonb_build_object('product_id', t.u(401), 'quantity', 1))) $$) ILIKE '%not available from this reseller%');
SELECT t.as_admin();
SELECT t.check('delivery off: no listing was left behind', (SELECT count(*) FROM public.dropship_listings) = 1);

-- ── switch it on ──
SELECT t.login(1);
DO $$
DECLARE i JSONB;
BEGIN
  i := public.fn_set_cmms_site_delivery(t.u(301), TRUE);
  PERFORM t.check('switch on: the answer says it is on', (i ->> 'enabled')::BOOLEAN AND (i ->> 'ready')::BOOLEAN, i::TEXT);
END $$;
SELECT t.as_admin();
SELECT t.check('switching on lists NOTHING (store products are not turned into listings)', (SELECT count(*) FROM public.dropship_listings) = 1);

SELECT t.as_anon();
DO $$
DECLARE s JSONB := public.get_site_delivery_storefront(t.u(101)); ids TEXT[];
BEGIN
  SELECT array_agg(p ->> 'name' ORDER BY p ->> 'name') INTO ids FROM jsonb_array_elements(s -> 'products') p;
  PERFORM t.check('storefront: on, with the store pin', (s ->> 'enabled')::BOOLEAN AND s -> 'store' ->> 'name' = 'Kampala Mart Ntinda'
    AND (s -> 'store' ->> 'lat')::NUMERIC = 0.3476 AND (s -> 'store' ->> 'lng')::NUMERIC = 32.6169, s::TEXT);
  PERFORM t.check('storefront: only deliverable products, and not the one already listed by hand', ids = ARRAY['Rice 5kg', 'Sugar 1kg'], ids::TEXT);
  PERFORM t.check('storefront: store price, tax rate and the stock that is really free (stock - reserved)',
    (SELECT (p ->> 'price')::NUMERIC = 10000 AND (p ->> 'tax_rate')::NUMERIC = 18 AND (p ->> 'available_stock')::NUMERIC = 20 AND (p ->> 'in_stock')::BOOLEAN
            AND p -> 'images' ->> 0 = 'https://img.test/rice.jpg'
       FROM jsonb_array_elements(s -> 'products') p WHERE p ->> 'name' = 'Rice 5kg'), s::TEXT);
  PERFORM t.check('storefront: out of stock is shown as out of stock, not hidden',
    (SELECT NOT (p ->> 'in_stock')::BOOLEAN AND (p ->> 'available_stock')::NUMERIC = 0 FROM jsonb_array_elements(s -> 'products') p WHERE p ->> 'name' = 'Sugar 1kg'));
  PERFORM t.check('storefront: guest payment is offered because guest checkout lends too', (s ->> 'guest_ok')::BOOLEAN, s::TEXT);
END $$;

-- ── the rider picker ──
SELECT t.check('rider picker: closed to visitors who are not signed in', t.raises($$ SELECT * FROM public.site_find_delivery_riders(t.u(101), 0.35, 32.6) $$));
SELECT t.login(4);
DO $$
DECLARE n INT; first_name TEXT;
BEGIN
  SELECT count(*), min(full_name) FILTER (WHERE is_store_rider) INTO n, first_name FROM public.site_find_delivery_riders(t.u(101), 0.35, 32.6);
  PERFORM t.check('rider picker: dropship''s ranking (the store''s own rider first), with fares', n = 2 AND first_name = 'Store rider');
  PERFORM t.check('rider picker: no drop-off, no riders', (SELECT count(*) FROM public.site_find_delivery_riders(t.u(101), NULL, NULL)) = 0);
  PERFORM t.check('rider picker: a business that cannot deliver gets no riders', (SELECT count(*) FROM public.site_find_delivery_riders(t.u(102), 0.35, 32.6)) = 0);
END $$;

-- ── wallet checkout: lend -> dropship_checkout_with_pin -> take back ──
DO $$
DECLARE r JSONB; cart JSONB := jsonb_build_array(jsonb_build_object('product_id', t.u(401), 'quantity', 2));
BEGIN
  r := public.site_checkout_with_pin('wrong', t.u(101), cart, 'Cus', '0700', 'Ntinda', NULL, 0.35, 32.6, 4);
  PERFORM t.check('wallet: wrong PIN is refused by the real PIN check, and nothing is left lent',
    (r ->> 'success')::BOOLEAN IS FALSE AND r ->> 'error' = 'Wrong PIN' AND (SELECT count(*) FROM public.dropship_listings WHERE site_managed) = 0, r::TEXT);

  r := public.site_checkout_with_pin('good-pin', t.u(101), cart, 'Cus', '0700', 'Ntinda', NULL, 0.35, 32.6, 4);
  PERFORM t.check('wallet: the order goes through dropship_checkout', (r ->> 'success')::BOOLEAN AND (r ->> 'customer_paid_total')::NUMERIC = 20000, r::TEXT);
  PERFORM t.check('wallet: dropship saw the store product as a listing of the business itself, at the store price, as the customer',
    EXISTS (SELECT 1 FROM t.calls WHERE product_id = t.u(401) AND reseller = t.u(101) AND listed_price = 10000 AND site_managed AND uid = t.u(4)));
  PERFORM t.check('wallet: the loan is back - no listing exists afterwards', (SELECT count(*) FROM public.dropship_listings WHERE site_managed) = 0
    AND (SELECT count(*) FROM public.dropship_listings) = 1);
END $$;

DO $$
DECLARE r JSONB; flour JSONB := jsonb_build_array(jsonb_build_object('product_id', t.u(408), 'quantity', 1));
BEGIN
  r := public.site_checkout_with_pin('good-pin', t.u(101), flour, 'Cus', '0700', 'Ntinda', NULL, 0.35, 32.6, 4);
  PERFORM t.check('hand-made listing: the order uses it as it is (its own price)', (r ->> 'success')::BOOLEAN AND (r ->> 'customer_paid_total')::NUMERIC = 6500
    AND EXISTS (SELECT 1 FROM t.calls WHERE product_id = t.u(408) AND listed_price = 6500 AND NOT site_managed));
  PERFORM t.check('hand-made listing: still there, unchanged, still the owner''s', (SELECT listed_price = 6500 AND free_delivery AND NOT site_managed AND is_active FROM public.dropship_listings WHERE product_id = t.u(408)));
END $$;

SELECT t.check('a product that cannot be delivered (no tax rate) is refused, nothing left lent',
  t.error_of($$ SELECT public.site_checkout_with_pin('good-pin', t.u(101), jsonb_build_array(jsonb_build_object('product_id', t.u(403), 'quantity', 1)), 'C', '0700', 'x', NULL, 0.35, 32.6, 4) $$) ILIKE '%not available from this reseller%');
SELECT t.check('a product of ANOTHER shop cannot be bought through this business',
  t.error_of($$ SELECT public.site_checkout_with_pin('good-pin', t.u(101), jsonb_build_array(jsonb_build_object('product_id', t.u(409), 'quantity', 1)), 'C', '0700', 'x', NULL, 0.35, 32.6, 4) $$) ILIKE '%not available from this reseller%');
SELECT t.check('an inactive / excluded / service / no-price product is refused too',
  t.raises($$ SELECT public.site_checkout_with_pin('good-pin', t.u(101), jsonb_build_array(jsonb_build_object('product_id', t.u(407), 'quantity', 1)), 'C', '0700', 'x', NULL, 0.35, 32.6, 4) $$)
  AND t.raises($$ SELECT public.site_checkout_with_pin('good-pin', t.u(101), jsonb_build_array(jsonb_build_object('product_id', t.u(404), 'quantity', 1)), 'C', '0700', 'x', NULL, 0.35, 32.6, 4) $$)
  AND t.raises($$ SELECT public.site_checkout_with_pin('good-pin', t.u(101), jsonb_build_array(jsonb_build_object('product_id', t.u(405), 'quantity', 1)), 'C', '0700', 'x', NULL, 0.35, 32.6, 4) $$)
  AND t.raises($$ SELECT public.site_checkout_with_pin('good-pin', t.u(101), jsonb_build_array(jsonb_build_object('product_id', t.u(406), 'quantity', 1)), 'C', '0700', 'x', NULL, 0.35, 32.6, 4) $$));
SELECT t.check('a business that has NOT switched delivery on cannot sell its products this way',
  t.raises($$ SELECT public.site_checkout_with_pin('good-pin', t.u(109), jsonb_build_array(jsonb_build_object('product_id', t.u(409), 'quantity', 1)), 'C', '0700', 'x', NULL, 0.35, 32.6, 4) $$));
SELECT t.check('a malformed product id cannot crash or sneak through the loan',
  t.raises($$ SELECT public.site_checkout_with_pin('good-pin', t.u(101), '[{"product_id": "not-a-uuid", "quantity": 1}]'::jsonb, 'C', '0700', 'x', NULL, 0.35, 32.6, 4) $$));
SELECT t.as_anon();
SELECT t.check('anonymous: the wallet checkout is not even callable', t.raises($$ SELECT public.site_checkout_with_pin('good-pin', t.u(101), '[]'::jsonb) $$));
SELECT t.as_admin();
SELECT t.check('after every refused order: still no loaned listing and nothing added', (SELECT count(*) FROM public.dropship_listings WHERE site_managed) = 0 AND (SELECT count(*) FROM public.dropship_listings) = 1);

-- ── Mobile Money / card / bank: quote, pending order, then the REAL guest_checkout_fulfil places it ──
SELECT t.as_anon();
DO $$
DECLARE r JSONB; cart JSONB := jsonb_build_array(jsonb_build_object('product_id', t.u(401), 'quantity', 1));
BEGIN
  r := public.site_guest_checkout_start(t.u(101), cart, 'Guest', '0700000000', 'Ntinda', 0.35, 32.6, 4, NULL, TRUE);
  PERFORM t.check('guest quote: priced through guest_checkout_start, nothing created', (r ->> 'success')::BOOLEAN AND (r ->> 'order_total_ugx')::NUMERIC = 13000, r::TEXT);
  r := public.site_guest_checkout_start(t.u(101), jsonb_build_array(jsonb_build_object('product_id', t.u(403), 'quantity', 1)), 'Guest', '0700000000', 'Ntinda', 0.35, 32.6, 4, NULL, TRUE);
  PERFORM t.check('guest quote: a product that cannot be delivered is "no longer available"', (r ->> 'success')::BOOLEAN IS FALSE AND r ->> 'error' ILIKE '%no longer available%', r::TEXT);
  r := public.site_guest_checkout_start(t.u(101), cart, 'Guest', '0700000000', 'Ntinda', 0.35, 32.6, 4, NULL, FALSE);
  PERFORM t.check('guest order: the order is accepted and given a payment reference', (r ->> 'success')::BOOLEAN AND r ->> 'tx_ref' LIKE 'GCO-%', r::TEXT);
  PERFORM set_config('t.guest_ref', r ->> 'tx_ref', FALSE);
END $$;
SELECT t.as_admin();
SELECT t.check('guest order: the pending order is stored, awaiting payment', (SELECT status FROM public.guest_checkout_orders WHERE tx_ref = current_setting('t.guest_ref')) = 'awaiting_payment');
SELECT t.check('guest: nothing lent is left behind by the quotes and the order', (SELECT count(*) FROM public.dropship_listings WHERE site_managed) = 0 AND (SELECT count(*) FROM public.dropship_listings) = 1);

DO $$
DECLARE r JSONB; ref TEXT := current_setting('t.guest_ref');
BEGIN
  DELETE FROM t.calls;
  r := public.guest_checkout_fulfil(ref, 'flw-2', 13500);
  PERFORM t.check('guest: after the payment the (patched) fulfil places the order for the store product', (r ->> 'success')::BOOLEAN AND r ->> 'paid_via' = 'guest', r::TEXT);
  PERFORM t.check('guest: the order is fulfilled', (SELECT status FROM public.guest_checkout_orders WHERE tx_ref = ref) = 'fulfilled');
  PERFORM t.check('guest: dropship saw the lent listing, which is gone again', EXISTS (SELECT 1 FROM t.calls WHERE product_id = t.u(401) AND site_managed AND uid = t.u(999))
    AND (SELECT count(*) FROM public.dropship_listings WHERE site_managed) = 0);
END $$;

-- an order for a product that can no longer be delivered still fails safe (and is refunded by the edge function)
INSERT INTO public.guest_checkout_orders
  (tx_ref, reseller_business_profile_id, cart, customer_name, customer_phone, delivery_lat, delivery_lng, max_delivery_hours, rider_id,
   items_ugx, delivery_fee_ugx, order_total_ugx, processing_fee_ugx, charge_ugx)
VALUES ('GCO-BAD', t.u(101), jsonb_build_array(jsonb_build_object('product_id', t.u(403), 'quantity', 1)), 'Guest', '0700000000',
        0.35, 32.6, 4, t.u(900), 5000, 3000, 8000, 300, 8300);
DO $$
DECLARE r JSONB := public.guest_checkout_fulfil('GCO-BAD', 'flw-3', 8300);
BEGIN
  PERFORM t.check('guest: a product that became undeliverable fails safe and asks for the refund',
    (r ->> 'success')::BOOLEAN IS FALSE AND (r ->> 'refund_required')::BOOLEAN AND (SELECT status FROM public.guest_checkout_orders WHERE tx_ref = 'GCO-BAD') = 'failed');
  PERFORM t.check('guest: ... and nothing is left lent', (SELECT count(*) FROM public.dropship_listings WHERE site_managed) = 0);
END $$;

DO $$
DECLARE d TEXT := pg_get_functiondef('public.guest_checkout_fulfil(text,text,numeric)'::regprocedure);
BEGIN
  PERFORM t.check('patched fulfil: lends once, hands back once, lends BEFORE it calls dropship_checkout',
    (length(d) - length(replace(d, '_site_delivery_lend', ''))) / length('_site_delivery_lend') = 1
    AND (length(d) - length(replace(d, '_site_delivery_return', ''))) / length('_site_delivery_return') = 1
    AND position('_site_delivery_lend' IN d) < position('public.dropship_checkout(' IN d)
    AND position('public.dropship_checkout(' IN d) < position('_site_delivery_return' IN d));
END $$;

-- ── a plain dropship order of the SAME business is untouched by all of this ──
SELECT t.login(4);
SELECT t.check('a normal dropship checkout is unchanged', (public.dropship_checkout_with_pin('good-pin', t.u(101), jsonb_build_array(jsonb_build_object('product_id', t.u(408), 'quantity', 1))) ->> 'success')::BOOLEAN);
SELECT t.as_admin();

-- ── switch it off: the storefront and every order path close again ──
SELECT t.login(1);
SELECT t.check('switch off', NOT (public.fn_set_cmms_site_delivery(t.u(301), FALSE) ->> 'enabled')::BOOLEAN);
SELECT t.as_anon();
SELECT t.check('off again: the storefront offers nothing', public.get_site_delivery_storefront(t.u(101)) = jsonb_build_object('enabled', FALSE));
SELECT t.login(4);
SELECT t.check('off again: a store product can no longer be ordered with delivery',
  t.raises($$ SELECT public.site_checkout_with_pin('good-pin', t.u(101), jsonb_build_array(jsonb_build_object('product_id', t.u(401), 'quantity', 1)), 'C', '0700', 'x', NULL, 0.35, 32.6, 4) $$));
SELECT t.as_admin();

-- ── it also closes by itself when the store stops being able to deliver ──
SELECT t.login(1);
SELECT public.fn_set_cmms_site_delivery(t.u(301), TRUE);
SELECT t.as_admin();
UPDATE public.supermarkets SET latitude = NULL WHERE id = t.u(201);
SELECT t.as_anon();
SELECT t.check('the store lost its pin on the map: delivery quietly closes (the switch stays on)', public.get_site_delivery_storefront(t.u(101)) = jsonb_build_object('enabled', FALSE));
SELECT t.as_admin();
UPDATE public.supermarkets SET latitude = 0.3476 WHERE id = t.u(201);
SELECT t.as_anon();
SELECT t.check('... and comes back when the pin is back', (public.get_site_delivery_storefront(t.u(101)) ->> 'enabled')::BOOLEAN);
SELECT t.as_admin();

-- ── the invariant that matters most ──
SELECT t.check('INVARIANT: no loaned listing exists anywhere after all of the above', (SELECT count(*) FROM public.dropship_listings WHERE site_managed) = 0);
SELECT t.check('INVARIANT: the dropship world is exactly as the owner left it (one hand-made listing)', (SELECT count(*) FROM public.dropship_listings) = 1);
