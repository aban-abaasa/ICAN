\set ON_ERROR_STOP on
-- Endpoint handlers: real behaviour against stub rows, the privacy promise (what must NEVER come back), input
-- validation, and a smoke test that every documented example answers in both sandbox and live mode.

TRUNCATE t.results;
TRUNCATE t.vars;
-- tomorrow 11:00 in Kampala: the standard (x1.0) fare band, whatever time the tests run
CREATE OR REPLACE FUNCTION t.std_time() RETURNS TEXT LANGUAGE sql AS
  $$ SELECT to_char(date_trunc('day', now() AT TIME ZONE 'Africa/Kampala') + INTERVAL '1 day 11 hours', 'YYYY-MM-DD"T"HH24:MI:SS') || '+03:00' $$;
GRANT EXECUTE ON FUNCTION t.std_time() TO PUBLIC;
DELETE FROM public.era_api_usage;

-- A developer with every app approved and generous limits.
DO $t$
DECLARE r JSONB; k JSONB; tk TEXT;
BEGIN
  PERFORM t.as_anon();
  r := public.era_api_request_access('Everything App', NULL, 'all@x.dev', NULL, NULL, ARRAY['icanera','bodagoera','supermarketera','farmagentera']);
  PERFORM t.reset();
  tk := r->>'ticket';
  PERFORM t.as_service();
  PERFORM public.era_api_admin_review((r->>'client_id')::UUID, 'approve', NULL, 6000, 1000000, NULL);
  PERFORM t.reset();
  PERFORM t.as_anon(); k := public.era_api_issue_key(tk, 'live'); PERFORM t.reset();
  PERFORM t.setv('live', k->>'key'); PERFORM t.setv('sandbox', r#>>'{sandbox_key,key}');
END $t$;

-- Stub rows for the live handlers
INSERT INTO public.icaneracoin_integrity_chain (seq, event_type, previous_hash, chain_hash)
VALUES (1357, 'transfer', repeat('0', 64), repeat('a', 64)), (1358, 'purchase', repeat('a', 64), repeat('b', 64));
INSERT INTO public.ican_price_ohlc (open_price, high_price, low_price, close_price, trading_volume, timeframe, open_time)
SELECT 5500 + n, 5510 + n, 5490 + n, 5505 + n, 10, '5m', date_trunc('hour', now()) - INTERVAL '1 hour' + (n * INTERVAL '5 minutes') FROM generate_series(0, 11) n;
INSERT INTO public.country_tax_rules (country_code, country_name, currency, personal_tax_period, corporate_tax_rate, vat_rate, capital_gains_rate,
  regulatory_body, filing_date, personal_tax_brackets, requirements, source, last_verified_at)
VALUES ('UG', 'Uganda', 'UGX', 'annual', 30, 18, 30, 'URA', '30 June', '[{"up_to":2820000,"rate":0}]', '{"secret":"internal"}', 'hand-verified', now());
INSERT INTO public.mbg_districts (name, code, description, is_active) VALUES ('Kampala', 'KLA', 'Capital', true), ('Hidden', 'HID', 'off', false);
INSERT INTO public.mbg_stages (name, location_name, location_lat, location_lng, description, is_active) VALUES
  ('Wandegeya Stage', 'Wandegeya', 0.33, 32.57, 'busy', true), ('Closed Stage', 'Nowhere', 0, 0, 'x', false);
INSERT INTO public.mbg_ports (country, city, port_name, latitude, longitude, is_active, un_locode) VALUES
  ('Kenya', 'Mombasa', 'Port of Mombasa', -4.04, 39.66, true, 'KEMBA'), ('Tanzania', 'Dar', 'Dar Port', -6.8, 39.2, true, 'TZDAR'), ('Kenya', 'Old', 'Closed', 0, 0, false, 'XX');
INSERT INTO public.mbg_platform_settings (key, value, is_public) VALUES
  ('ride.base_fare', '1000', true), ('ride.per_km_rate', '1000', true), ('ride.minimum_fare', '2000', true),
  ('cargo.base_fare', '5000', true), ('cargo.per_km_rate', '2000', true), ('commission.rider_percentage', '88', false);
INSERT INTO public.supermarkets (name, slug, city, country, location, phone, email, address, owner_user_id, is_active, status, business_type, offers_products, offers_services, price_currency, latitude, longitude) VALUES
  ('Kampala Fresh Mart', 'kfm', 'Kampala', 'Uganda', 'Plot 1', '+256700111222', 'owner@kfm.dev', 'secret street', gen_random_uuid(), true, NULL, 'supermarket', true, false, 'UGX', 0.34, 32.58),
  ('Dormant Store', 'dormant', 'Kampala', 'Uganda', 'x', NULL, NULL, NULL, NULL, false, NULL, 'supermarket', true, false, 'UGX', 0, 0),
  ('Suspended Store', 'susp', 'Jinja', 'Uganda', 'x', NULL, NULL, NULL, NULL, true, 'suspended', 'supermarket', true, false, 'UGX', 0, 0);
INSERT INTO public.supplier_catalog_items (supplier_user_id, name, category, brand, description, unit, min_order_qty, price_per_unit, currency, sku, barcode, cost_price, stock_quantity, metadata, is_available) VALUES
  (gen_random_uuid(), 'Sliced Bread 600g', 'Bakery', 'Daily Loaf', 'soft', 'loaf', 12, 4500, 'UGX', 'BRD-600', '6001234567890', 3000, 500, '{"internal":1}', true),
  (gen_random_uuid(), 'Bath Soap', 'Personal Care', 'Pure', NULL, 'bar', 24, 2800, 'UGX', 'SOP-200', NULL, 1800, 90, '{}', true),
  (gen_random_uuid(), 'Withdrawn Item', 'Bakery', 'Old', NULL, 'x', 1, 1, 'UGX', 'OLD-1', NULL, 1, 1, '{}', false);
INSERT INTO public.marketplace_listings (id, title, description, price, is_negotiable, type, status, location, district, user_id, thumbnail, images, contact_phone, contact_email, contact_whatsapp, expiry_date, featured) VALUES
  (1, 'Fresh matooke', 'Organic bunches', 180000, true, 'produce', 'active', 'Kakoba', 'Mbarara', gen_random_uuid(), NULL, ARRAY['a.jpg'], '+256700999888', 's@x.dev', '+256700999888', NULL, true),
  (2, 'Maize 10 bags', 'Dry', 1000000, false, 'produce', 'active', 'Nyendo', 'Masaka', gen_random_uuid(), NULL, NULL, '+256', 's2@x.dev', NULL, CURRENT_DATE + 5, false),
  (3, 'Expired maize', 'old', 900000, false, 'produce', 'active', 'x', 'Masaka', gen_random_uuid(), NULL, NULL, NULL, NULL, NULL, CURRENT_DATE - 1, false),
  (4, '5 acres', 'near road', 25000000, true, 'land', 'active', 'Kasanje', 'Wakiso', gen_random_uuid(), NULL, NULL, NULL, NULL, NULL, NULL, false),
  (5, 'Draft listing', 'not live', 5, false, 'produce', 'draft', 'x', 'Masaka', gen_random_uuid(), NULL, NULL, NULL, NULL, NULL, NULL, false),
  (6, 'Tractor hire', 'per acre', 120000, false, 'service', 'active', 'Nyendo', 'Masaka', gen_random_uuid(), NULL, NULL, NULL, NULL, NULL, NULL, false);
INSERT INTO public.produce_listings (listing_id, produce_type, crop_name, quantity, unit, is_organic, availability) VALUES
  (1, 'fruit', 'matooke', 40, 'bunches', true, 'available'), (2, 'cereal', ' Maize ', 10, 'bags', false, 'available'),
  (3, 'cereal', 'maize', 5, 'bags', false, 'available'), (5, 'cereal', 'beans', 1, 'bags', false, 'available');
INSERT INTO public.land_listings (listing_id, size_acres, land_type, is_for_sale, has_road_access, cadastral_information) VALUES (4, 5, 'agricultural', true, true, 'plot 77 secret');
INSERT INTO public.service_listings (listing_id, service_type, price_unit, experience_years, skills) VALUES (6, 'equipment rental', 'per acre', 8, ARRAY['ploughing']);
INSERT INTO public.crop_varieties (name, scientific_name, crop_type, season, maturity_days, expected_yield_per_hectare, soil_ph_min, soil_ph_max, water_requirements) VALUES
  ('Maize (Longe 5)', 'Zea mays', 'cereal', 'first rains', 110, 5.2, 5.8, 7, 'medium'), ('Climbing beans', 'Phaseolus vulgaris', 'legume', 'second rains', 75, 2.1, 6, 7.5, 'medium');

-- ================================================================ 1. ICANERA, live
DO $t$
DECLARE lk TEXT := t.v('live'); r JSONB;
BEGIN
  r := t.call(lk, '/icanera/coin/price', '{"currency":"usd"}');
  PERFORM t.check('1.1 coin price in a stored currency (case-insensitive)', (r#>>'{body,data,price}')::NUMERIC = 1.38151 AND r#>>'{body,data,source}' = 'stored', r::TEXT);
  r := t.call(lk, '/icanera/coin/price', '{"currency":"KES"}');
  PERFORM t.check('1.2 any other currency is derived from UGX and the FX table', (r#>>'{body,data,price}')::NUMERIC = round(5508.42 / 30.8, 6) AND r#>>'{body,data,source}' = 'derived-from-fx', r::TEXT);
  r := t.call(lk, '/icanera/coin/price', '{"currency":"XYZ"}');
  PERFORM t.check('1.3 an unknown currency is a 404', r->>'status' = '404', r::TEXT);
  r := t.call(lk, '/icanera/coin/price', '{"currency":"usdollar"}');
  PERFORM t.check('1.4 a malformed currency is a 400, not silently truncated', r->>'status' = '400', r::TEXT);
  PERFORM t.check('1.5 default currency is USD', (t.call(lk, '/icanera/coin/price')#>>'{body,data,currency}') = 'USD');

  r := t.call(lk, '/icanera/coin/candles', '{"interval":"5m","limit":"3"}');
  PERFORM t.check('1.6 candles: 5m, limit 3', jsonb_array_length(r#>'{body,data}') = 3, r::TEXT);
  r := t.call(lk, '/icanera/coin/candles', '{"interval":"1h"}');
  PERFORM t.check('1.7 candles re-binned to 1h aggregate the 5m rows (high=max, low=min, volume=sum)',
    jsonb_array_length(r#>'{body,data}') >= 1 AND (SELECT SUM((c->>'volume')::NUMERIC) FROM jsonb_array_elements(r#>'{body,data}') c) = 120, r::TEXT);
  PERFORM t.check('1.8 a bad interval is a 400', t.call(lk, '/icanera/coin/candles', '{"interval":"3d"}')->>'status' = '400');
  PERFORM t.check('1.9 a non-numeric limit is a 400 with a useful message', t.call(lk, '/icanera/coin/candles', '{"limit":"abc"}')#>>'{body,error,message}' = 'limit must be a whole number');
  PERFORM t.check('1.10 a huge limit is clamped, not an error', t.call(lk, '/icanera/coin/candles', '{"interval":"5m","limit":"99999"}')->>'status' = '200');

  r := t.call(lk, '/icanera/fx/rates', '{"region":"africa"}');
  PERFORM t.check('1.11 fx filtered by region (case-insensitive)', jsonb_array_length(r#>'{body,data}') = 1 AND r#>>'{body,data,0,currency_code}' = 'KES', r::TEXT);

  r := t.call(lk, '/icanera/tax/ug');
  PERFORM t.check('1.12 tax rules by country (any case) and flagged informational', r->>'status' = '200' AND r#>>'{body,data,country_name}' = 'Uganda' AND (r#>>'{body,data,informational_only}')::BOOLEAN, r::TEXT);
  PERFORM t.check('1.13 tax rules never include the internal requirements blob', r::TEXT NOT LIKE '%internal%');
  PERFORM t.check('1.14 unknown country is a 404; malformed one is a 400', t.call(lk, '/icanera/tax/ZZ')->>'status' = '404' AND t.call(lk, '/icanera/tax/U1')->>'status' = '400');

  r := t.call(lk, '/icanera/businesses', '{"q":"agro"}');
  PERFORM t.check('1.15 business directory search; no cover image field', jsonb_array_length(r#>'{body,data}') = 1 AND r::TEXT NOT LIKE '%cover%', r::TEXT);
END $t$;

-- ================================================================ 2. BODAGOERA, live
DO $t$
DECLARE lk TEXT := t.v('live'); r JSONB;
BEGIN
  r := t.call(lk, '/bodagoera/stages');
  PERFORM t.check('2.1 only active stages', jsonb_array_length(r#>'{body,data}') = 1 AND r#>>'{body,data,0,name}' = 'Wandegeya Stage' AND (r#>>'{body,data,0,latitude}')::NUMERIC = 0.33, r::TEXT);
  PERFORM t.check('2.2 only active districts', jsonb_array_length(t.call(lk, '/bodagoera/districts')#>'{body,data}') = 1);
  PERFORM t.check('2.3 ports filter by country, hide inactive', jsonb_array_length(t.call(lk, '/bodagoera/ports', '{"country":"kenya"}')#>'{body,data}') = 1);

  r := t.call(lk, '/bodagoera/fare/estimate', jsonb_build_object('km', '7.5', 'at', t.std_time()));
  PERFORM t.check('2.4 ride fare = base + per-km x distance', (r#>>'{body,data,estimated_fare}')::NUMERIC = 8500 AND r#>>'{body,data,currency}' = 'UGX', r::TEXT);
  PERFORM t.check('2.5 the minimum fare applies on short rides', (t.call(lk, '/bodagoera/fare/estimate', jsonb_build_object('km', '0.5', 'at', t.std_time()))#>>'{body,data,estimated_fare}')::NUMERIC = 2000);
  PERFORM t.check('2.6 cargo has its own rates', (t.call(lk, '/bodagoera/fare/estimate', jsonb_build_object('km', '3', 'kind', 'cargo', 'at', t.std_time()))#>>'{body,data,estimated_fare}')::NUMERIC = 11000);
  PERFORM t.check('2.7 km is required, numeric and bounded (400s)',
    t.call(lk, '/bodagoera/fare/estimate')#>>'{body,error,message}' = 'km is required'
    AND t.call(lk, '/bodagoera/fare/estimate', '{"km":"abc"}')->>'status' = '400'
    AND t.call(lk, '/bodagoera/fare/estimate', '{"km":"1000"}')->>'status' = '400'
    AND t.call(lk, '/bodagoera/fare/estimate', '{"km":"5","kind":"plane"}')->>'status' = '400');
  PERFORM t.check('2.8 non-public settings are never exposed', t.call(lk, '/bodagoera/fare/estimate', jsonb_build_object('km', '7.5', 'at', t.std_time()))::TEXT NOT LIKE '%commission%');

  r := t.call(lk, '/bodagoera/riders/verify', '{"code":"ABCDEF0123456789ABCD"}');
  PERFORM t.check('2.9 a valid rider card verifies', (r#>>'{body,data,is_valid}')::BOOLEAN AND r#>>'{body,data,full_name}' = 'Real Rider' AND r#>>'{body,data,plate_number}' = 'UBB 111C', r::TEXT);
  PERFORM t.check('2.10 ...and returns no phone number, licence or fee data',
    r::TEXT NOT LIKE '%phone%' AND r::TEXT NOT LIKE '%license%' AND r::TEXT NOT LIKE '%fees%' AND r::TEXT NOT LIKE '%commission%' AND r::TEXT NOT LIKE '%+256%', r::TEXT);
  PERFORM t.check('2.11 an unknown code is a clean is_valid:false', (t.call(lk, '/bodagoera/riders/verify', '{"code":"ZZZZZZZZZZZZZZZZZZZZ"}')#>>'{body,data,is_valid}')::BOOLEAN = FALSE);
  PERFORM t.check('2.12 a malformed code is a 400', t.call(lk, '/bodagoera/riders/verify', '{"code":"ab"}')->>'status' = '400' AND t.call(lk, '/bodagoera/riders/verify')->>'status' = '400');
END $t$;

-- ================================================================ 3. SUPERMARKETERA, live
DO $t$
DECLARE lk TEXT := t.v('live'); r JSONB;
BEGIN
  r := t.call(lk, '/supermarketera/stores');
  PERFORM t.check('3.1 only live stores (inactive and suspended are hidden)', jsonb_array_length(r#>'{body,data}') = 1 AND r#>>'{body,data,0,name}' = 'Kampala Fresh Mart', r::TEXT);
  PERFORM t.check('3.2 stores expose no phone, email, address or owner',
    r::TEXT NOT LIKE '%phone%' AND r::TEXT NOT LIKE '%+256%' AND r::TEXT NOT LIKE '%owner%' AND r::TEXT NOT LIKE '%secret street%' AND r::TEXT NOT LIKE '%kfm.dev%', r::TEXT);
  PERFORM t.check('3.3 store search by name and city', jsonb_array_length(t.call(lk, '/supermarketera/stores', '{"q":"fresh","city":"kampala"}')#>'{body,data}') = 1);

  r := t.call(lk, '/supermarketera/catalog');
  PERFORM t.check('3.4 catalogue hides withdrawn items', jsonb_array_length(r#>'{body,data}') = 2, r::TEXT);
  PERFORM t.check('3.5 catalogue never shows cost price, stock, supplier ids or metadata',
    r::TEXT NOT LIKE '%cost%' AND r::TEXT NOT LIKE '%stock%' AND r::TEXT NOT LIKE '%supplier%' AND r::TEXT NOT LIKE '%metadata%' AND r::TEXT NOT LIKE '%internal%', r::TEXT);
  PERFORM t.check('3.6 LIKE wildcards in a search are literal, not "match everything"', jsonb_array_length(t.call(lk, '/supermarketera/catalog', '{"q":"%"}')#>'{body,data}') = 0
    AND jsonb_array_length(t.call(lk, '/supermarketera/catalog', '{"q":"_"}')#>'{body,data}') = 0);
  PERFORM t.check('3.7 catalogue filter by category', jsonb_array_length(t.call(lk, '/supermarketera/catalog', '{"category":"bakery"}')#>'{body,data}') = 1);

  PERFORM t.check('3.8 barcode lookup', t.call(lk, '/supermarketera/barcode/6001234567890')#>>'{body,data,name}' = 'Sliced Bread 600g');
  PERFORM t.check('3.9 SKU lookup, case-insensitive', t.call(lk, '/supermarketera/barcode/brd-600')#>>'{body,data,sku}' = 'BRD-600');
  PERFORM t.check('3.10 unknown barcode is a 404; a withdrawn item is not findable; junk is a 400',
    t.call(lk, '/supermarketera/barcode/0000000000000')->>'status' = '404' AND t.call(lk, '/supermarketera/barcode/OLD-1')->>'status' = '404'
    AND t.call(lk, '/supermarketera/barcode/a%20b')->>'status' = '400');
  PERFORM t.check('3.11 categories with counts', jsonb_array_length(t.call(lk, '/supermarketera/categories')#>'{body,data}') = 2 AND (t.call(lk, '/supermarketera/categories')#>>'{body,data,0,catalogue_items}')::INT >= 1);
END $t$;

-- ================================================================ 4. FARMAGENTERA, live
DO $t$
DECLARE lk TEXT := t.v('live'); r JSONB;
BEGIN
  r := t.call(lk, '/farmagentera/listings');
  PERFORM t.check('4.1 only active, unexpired listings', jsonb_array_length(r#>'{body,data}') = 4, r::TEXT);   -- 1,2,4,6 (3 expired, 5 draft)
  PERFORM t.check('4.2 featured first', r#>>'{body,data,0,id}' = '1', r#>>'{body,data,0,title}');
  PERFORM t.check('4.3 listings never expose seller identity, contact details or private fields',
    r::TEXT NOT LIKE '%user_id%' AND r::TEXT NOT LIKE '%contact%' AND r::TEXT NOT LIKE '%+256%' AND r::TEXT NOT LIKE '%@x.dev%' AND r::TEXT NOT LIKE '%cadastral%' AND r::TEXT NOT LIKE '%secret%', r::TEXT);
  PERFORM t.check('4.4 each kind carries its own details',
    r#>>'{body,data,0,details,crop_name}' = 'matooke'
    AND (SELECT d#>>'{details,size_acres}' FROM jsonb_array_elements(r#>'{body,data}') d WHERE d->>'type' = 'land') = '5'
    AND (SELECT d#>>'{details,service_type}' FROM jsonb_array_elements(r#>'{body,data}') d WHERE d->>'type' = 'service') = 'equipment rental');
  PERFORM t.check('4.5 type and district filters', jsonb_array_length(t.call(lk, '/farmagentera/listings', '{"type":"produce"}')#>'{body,data}') = 2
    AND jsonb_array_length(t.call(lk, '/farmagentera/listings', '{"district":"masaka"}')#>'{body,data}') = 2);
  PERFORM t.check('4.6 an unknown type is a 400', t.call(lk, '/farmagentera/listings', '{"type":"cars"}')->>'status' = '400');

  r := t.call(lk, '/farmagentera/price-board');
  PERFORM t.check('4.7 price board groups by tidied crop name and ignores expired or draft listings',
    jsonb_array_length(r#>'{body,data}') = 2 AND (SELECT (c->>'listings')::INT FROM jsonb_array_elements(r#>'{body,data}') c WHERE c->>'crop_name' = 'Maize') = 1, r::TEXT);
  PERFORM t.check('4.8 crops: search and filter', jsonb_array_length(t.call(lk, '/farmagentera/crops', '{"q":"maize"}')#>'{body,data}') = 1
    AND jsonb_array_length(t.call(lk, '/farmagentera/crops', '{"type":"LEGUME"}')#>'{body,data}') = 1);
END $t$;

-- ================================================================ 5. Platform
DO $t$
DECLARE lk TEXT := t.v('live'); sk TEXT := t.v('sandbox'); r JSONB;
BEGIN
  r := t.call(lk, '/pulse');
  PERFORM t.check('5.1 pulse (live) sees all four apps', r#>>'{body,data,icanera,ican_ugx}' = '5508.42' AND (r#>>'{body,data,bodagoera,stages}')::INT = 1
    AND (r#>>'{body,data,supermarketera,stores}')::INT = 1 AND (r#>>'{body,data,farmagentera,active_listings}')::INT = 4, r::TEXT);
  r := t.call(sk, '/pulse');
  PERFORM t.check('5.2 pulse (sandbox) is fixtures', r#>>'{body,data,bodagoera,stages}' = '37' AND r#>>'{body,meta,mode}' = 'sandbox', r::TEXT);
  -- a narrower key only sees its own section
  PERFORM t.as_service();
  PERFORM public.era_api_admin_review((SELECT id FROM public.era_api_clients WHERE contact_email = 'all@x.dev'), 'approve', ARRAY['bodagoera'], NULL, NULL, NULL);
  PERFORM t.reset();
  r := t.call(lk, '/pulse');
  PERFORM t.check('5.3 pulse only includes approved apps', r#>'{body,data}' ? 'bodagoera' AND NOT (r#>'{body,data}' ? 'icanera') AND NOT (r#>'{body,data}' ? 'farmagentera'), r::TEXT);
  PERFORM t.check('5.4 scope is re-checked per call (approval narrowed => other apps 403)', t.call(lk, '/icanera/coin/price')->>'status' = '403');
  PERFORM t.as_service();
  PERFORM public.era_api_admin_review((SELECT id FROM public.era_api_clients WHERE contact_email = 'all@x.dev'), 'approve', ARRAY['icanera','bodagoera','supermarketera','farmagentera'], NULL, NULL, NULL);
  PERFORM t.reset();
END $t$;

-- ================================================================ 6. Smoke: every documented example answers, sandbox and live
CREATE FUNCTION t.example(p_example TEXT) RETURNS TABLE (path TEXT, q JSONB) LANGUAGE plpgsql AS $$
DECLARE parts TEXT[]; pair TEXT; kv TEXT[]; o JSONB := '{}';
BEGIN
  parts := string_to_array(p_example, '?');
  IF parts[2] IS NOT NULL THEN
    FOREACH pair IN ARRAY string_to_array(parts[2], '&') LOOP
      kv := string_to_array(pair, '=');
      o := o || jsonb_build_object(kv[1], kv[2]);
    END LOOP;
  END IF;
  path := parts[1]; q := o; RETURN NEXT;
END $$;
GRANT EXECUTE ON FUNCTION t.example(TEXT) TO PUBLIC;

DO $t$
DECLARE ep RECORD; ex RECORD; r JSONB; bad_s TEXT := ''; bad_l TEXT := ''; n INT := 0;
BEGIN
  FOR ep IN SELECT id, example_path FROM public.era_api_endpoints WHERE access = 'app' AND method = 'GET' ORDER BY sort LOOP
    n := n + 1;
    SELECT * INTO ex FROM t.example(ep.example_path);
    r := t.call(t.v('sandbox'), ex.path, ex.q);
    IF r->>'status' <> '200' THEN bad_s := bad_s || ep.id || '=' || (r->>'status') || ' '; END IF;
    r := t.call(t.v('live'), ex.path, ex.q);
    IF r->>'status' <> '200' THEN bad_l := bad_l || ep.id || '=' || (r->>'status') || ' ' || left(COALESCE(r#>>'{body,error,message}', ''), 60) || '; '; END IF;
  END LOOP;
  PERFORM t.check('6.1 all ' || n || ' documented examples answer 200 in the sandbox', bad_s = '' AND n = 29, bad_s);
  PERFORM t.check('6.2 and 200 live against real tables', bad_l = '', bad_l);
END $t$;

DO $t$
DECLARE ep RECORD; bad TEXT := '';
BEGIN
  -- the registry itself: every row well-formed, every handler exists, every parameter documented has a name and location
  FOR ep IN SELECT * FROM public.era_api_endpoints LOOP
    IF to_regprocedure(ep.handler || '(jsonb, boolean)') IS NULL THEN bad := bad || ep.id || ':nohandler '; END IF;
    IF ep.method = 'GET' AND (ep.example_path IS NULL OR ep.example_path NOT LIKE '/%') THEN bad := bad || ep.id || ':noexample '; END IF;
    IF ep.method = 'POST' AND jsonb_typeof(ep.body) <> 'array' THEN bad := bad || ep.id || ':nobody '; END IF;
    IF jsonb_typeof(ep.params) <> 'array' OR EXISTS (SELECT 1 FROM jsonb_array_elements(ep.params) x WHERE x->>'name' IS NULL OR x->>'in' NOT IN ('query', 'path')) THEN bad := bad || ep.id || ':params '; END IF;
    IF ep.path LIKE '%{%' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(ep.params) x WHERE x->>'in' = 'path' AND ep.path LIKE '%{' || (x->>'name') || '}%') THEN bad := bad || ep.id || ':pathparam '; END IF;
  END LOOP;
  PERFORM t.check('6.3 every registry row is well-formed with a real handler and documented params', bad = '', bad);
END $t$;
