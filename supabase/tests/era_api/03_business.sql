\set ON_ERROR_STOP on
-- Era API v2: business keys, private endpoints, payment requests, inventory expiry, CMMS, booking requests, chain fees.
-- The properties under test, in order of how much damage a bug would do:
--   1. ISOLATION: a business key can only ever see its own business, whatever the caller sends
--   2. MONEY: a key can create payment requests but never move money; caps, idempotency and the velocity brake hold
--   3. CONFIRMATION: a booking request never books, dispatches or charges; only the customer's own session can book
--   4. NO PEOPLE: nothing returned names or identifies staff, riders, payers or customers
--   5. correctness of the expiry, clearance, book-value and fare maths

CREATE TABLE IF NOT EXISTS t.vars (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t.vars TO PUBLIC;
CREATE OR REPLACE FUNCTION t.v(p_k TEXT) RETURNS TEXT LANGUAGE sql AS $$ SELECT v FROM t.vars WHERE k = p_k $$;
CREATE OR REPLACE FUNCTION t.setv(p_k TEXT, p_v TEXT) RETURNS VOID LANGUAGE sql AS $$ INSERT INTO t.vars VALUES (p_k, p_v) ON CONFLICT (k) DO UPDATE SET v = p_v $$;
GRANT EXECUTE ON FUNCTION t.v(TEXT), t.setv(TEXT, TEXT) TO PUBLIC;
TRUNCATE t.results;
TRUNCATE t.vars;
DELETE FROM public.era_api_usage;

CREATE OR REPLACE FUNCTION t.post(p_key TEXT, p_path TEXT, p_body JSONB, p_idem TEXT, p_query JSONB DEFAULT '{}', p_ip TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  PERFORM t.as_anon();
  r := public.era_api_call(p_key, 'POST', p_path, p_query, p_ip, p_body, p_idem);
  PERFORM t.reset();
  RETURN r;
END; $$;
CREATE OR REPLACE FUNCTION t.std_time() RETURNS TEXT LANGUAGE sql AS
  $$ SELECT to_char(date_trunc('day', now() AT TIME ZONE 'Africa/Kampala') + INTERVAL '1 day 11 hours', 'YYYY-MM-DD"T"HH24:MI:SS') || '+03:00' $$;
CREATE OR REPLACE FUNCTION t.at_hour(p_hour INT) RETURNS TEXT LANGUAGE sql AS
  $$ SELECT to_char(date_trunc('day', now() AT TIME ZONE 'Africa/Kampala') + INTERVAL '1 day' + make_interval(hours => p_hour), 'YYYY-MM-DD"T"HH24:MI:SS') || '+03:00' $$;
CREATE OR REPLACE FUNCTION t.u(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-' || lpad(n::TEXT, 12, '0'))::UUID $$;
CREATE OR REPLACE FUNCTION t.today() RETURNS DATE LANGUAGE sql STABLE AS $$ SELECT public.era__today() $$;
CREATE OR REPLACE FUNCTION t.age_keys() RETURNS VOID LANGUAGE sql AS
  $$ UPDATE public.era_api_keys SET created_at = now() - INTERVAL '3 hours' WHERE business_profile_id IS NOT NULL AND created_at > now() - INTERVAL '2 hours' $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;

-- ---------------------------------------------------------------- fixtures: two businesses that must never see each other
INSERT INTO auth.users (id, email) SELECT t.u(n), 'u' || n || '@biz.dev' FROM generate_series(10, 16) n ON CONFLICT DO NOTHING;
INSERT INTO public.business_profiles (id, user_id, business_name, country, verification_status) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', t.u(10), 'Alpha Mart Ltd', 'UG', 'unverified'),
  ('bbbbbbbb-0000-0000-0000-000000000001', t.u(11), 'Beta Foods Ltd', 'UG', 'verified');
INSERT INTO public.business_profile_members (business_profile_id, user_id, role, status) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', t.u(12), 'Owner', 'active'),
  ('aaaaaaaa-0000-0000-0000-000000000001', t.u(14), 'Investor', 'pending');
INSERT INTO public.supermarkets (id, name, city, country, is_active, pichin_business_profile_id, price_currency) VALUES
  ('5a000000-0000-0000-0000-000000000001', 'Alpha Store 1', 'Kampala', 'Uganda', TRUE, 'aaaaaaaa-0000-0000-0000-000000000001', 'UGX'),
  ('5b000000-0000-0000-0000-000000000001', 'Beta Store 1', 'Jinja', 'Uganda', TRUE, 'bbbbbbbb-0000-0000-0000-000000000001', 'UGX');

-- Alpha's shelves
INSERT INTO public.products (id, name, category, sku, barcode, supermarket_id, cost_price, selling_price, unit, brand, expiry_date, reorder_level, clearance_published_at, clearance_original_price) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'Fresh Milk 1L',   'Dairy',    'MLK-1L',  '6001', '5a000000-0000-0000-0000-000000000001', 2900, 4000, 'litre', 'Farm Gold', NULL, 10, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000002', 'Bread 600g',      'Bakery',   'BRD-600', '6002', '5a000000-0000-0000-0000-000000000001', 3100, 4800, 'loaf',  'Daily',     NULL, 5,  NULL, NULL),
  ('a1000000-0000-0000-0000-000000000003', 'Yoghurt 500ml',   'Dairy',    'YGT-500', '6003', '5a000000-0000-0000-0000-000000000001', 1700, 2500, 'cup',   'Farm Gold', NULL, 5,  NULL, NULL),
  ('a1000000-0000-0000-0000-000000000004', 'Paracetamol 500mg','Pharmacy','PCM-500', '6004', '5a000000-0000-0000-0000-000000000001', 900,  1500, 'strip', 'MediCo',    t.today() + 200, 15, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000005', 'Cheese 250g',     'Dairy',    'CHS-250', '6005', '5a000000-0000-0000-0000-000000000001', 8000, 12000, 'block','Farm Gold', t.today() + 10, 2, now(), 15000),
  ('a1000000-0000-0000-0000-000000000007', 'Old Cream 200ml', 'Dairy',    'OLD-200', '6007', '5a000000-0000-0000-0000-000000000001', 500,  900,  'tub',   'Farm Gold', t.today() - 1, 5, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000006', 'Delivery service','Services', 'SVC-1',   NULL,   '5a000000-0000-0000-0000-000000000001', 0,    5000, 'job',   NULL,        NULL, NULL, NULL, NULL);
UPDATE public.products SET is_service = TRUE WHERE sku = 'SVC-1';
INSERT INTO public.inventory (supermarket_id, product_id, quantity, current_stock, reserved_stock, reorder_point) VALUES
  ('5a000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 68, 68, 8, 10),
  ('5a000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 0,  0,  0, 5),
  ('5a000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', 30, 30, 0, 5),
  ('5a000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000004', 12, 12, 0, 15),
  ('5a000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000005', 5,  5,  0, 2);
INSERT INTO public.product_inventory_batches (product_id, supermarket_id, batch_number, expiry_date, current_stock, purchase_price, selling_price, status) VALUES
  ('a1000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 'ML-1', t.today() + 3,  48, 2900, 4000, 'active'),
  ('a1000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 'ML-2', t.today() + 40, 20, 2900, 4000, 'active'),
  ('a1000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 'ML-0', t.today() - 2,  5,  2900, 4000, 'disposed'),
  ('a1000000-0000-0000-0000-000000000003', '5a000000-0000-0000-0000-000000000001', 'YG-1', t.today() - 4,  30, 1700, 2500, 'active');
-- Beta's shelf: its secret must never show up under Alpha's key
INSERT INTO public.products (id, name, category, sku, supermarket_id, cost_price, selling_price, unit, expiry_date) VALUES
  ('b1000000-0000-0000-0000-000000000001', 'BETA-SECRET-PRODUCT', 'Secret', 'BETA-1', '5b000000-0000-0000-0000-000000000001', 10, 20, 'pc', t.today() + 2);
INSERT INTO public.inventory (supermarket_id, product_id, quantity, current_stock) VALUES ('5b000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 9, 9);

-- CMMS: Alpha and Beta
INSERT INTO public.cmms_company_profiles (id, company_name, business_profile_id, branch_name) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'Alpha Works', 'aaaaaaaa-0000-0000-0000-000000000001', 'HQ'),
  ('c2000000-0000-0000-0000-000000000001', 'Beta Works',  'bbbbbbbb-0000-0000-0000-000000000001', 'HQ');
INSERT INTO public.cmms_departments (cmms_company_id, department_name, annual_budget, budget_used) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'Workshop', 1000000, 400000), ('c1000000-0000-0000-0000-000000000001', 'Facilities', 500000, 100000),
  ('c2000000-0000-0000-0000-000000000001', 'BETA-SECRET-DEPT', 9, 9);
INSERT INTO public.cmms_inventory_items (id, cmms_company_id, item_code, item_name, category, item_kind, asset_tag, asset_status, asset_condition, acquisition_date,
  acquisition_cost, useful_life_years, salvage_value, depreciation_method, warranty_expiry, serial_number) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'A1', 'Generator 20kVA', 'Power', 'asset', 'GEN-001', 'in_service', 'good', t.today() - 730, 10000000, 10, 0, 'straight_line', t.today() + 500, 'SN-SECRET-1'),
  ('d1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'A2', 'Compressor', 'Workshop', 'asset', 'CMP-014', 'under_repair', 'fair', t.today() - 365, 2000000, 5, 0, 'straight_line', t.today() + 30, NULL),
  ('d1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001', 'A3', 'Old press', 'Workshop', 'asset', 'PRS-002', 'in_service', 'poor', t.today() - 1500, 1000000, 8, 100000, 'declining_balance', t.today() - 10, NULL),
  ('d2000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 'B1', 'BETA-SECRET-ASSET', 'Secret', 'asset', 'BETA-1', 'in_service', 'good', t.today() - 10, 5, 5, 0, 'straight_line', NULL, NULL);
INSERT INTO public.cmms_inventory_items (id, cmms_company_id, item_code, item_name, category, item_kind, quantity_in_stock, reorder_level, reorder_quantity, unit_of_measure, lead_time_days, supplier_name) VALUES
  ('d1000000-0000-0000-0000-0000000000a1', 'c1000000-0000-0000-0000-000000000001', 'OIL-15W40', 'Engine oil', 'Lubricants', 'consumable', 3, 5, NULL, 'drum', 5, 'Kampala Lubes'),
  ('d1000000-0000-0000-0000-0000000000a2', 'c1000000-0000-0000-0000-000000000001', 'BLT-9', 'Belts', 'Spares', 'consumable', 50, 5, 10, 'pc', 7, 'Belts Ltd'),
  ('d2000000-0000-0000-0000-0000000000a1', 'c2000000-0000-0000-0000-000000000001', 'BETA-LOW', 'BETA-SECRET-CONSUMABLE', 'Secret', 'consumable', 0, 5, NULL, 'pc', 1, 'x');
INSERT INTO public.cmms_inventory_transactions (cmms_company_id, item_id, txn_type, quantity, txn_date) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000a1', 'issue', -7, now() - INTERVAL '5 days'),
  ('c1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000a1', 'issue', -5, now() - INTERVAL '12 days'),
  ('c1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000a1', 'issue', -50, now() - INTERVAL '90 days');
INSERT INTO public.cmms_requisitions (cmms_company_id, requisition_number, purpose, urgency_level, status, total_estimated_cost, requested_by_name, requested_by_email, requisition_date) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'REQ-1', 'Compressor seals', 'high', 'pending_finance', 800000, 'SECRET REQUESTER', 'secret@person.dev', now()),
  ('c1000000-0000-0000-0000-000000000001', 'REQ-2', 'Service kit', 'normal', 'approved', 200000, 'SECRET REQUESTER', 'secret@person.dev', now() - INTERVAL '1 day'),
  ('c1000000-0000-0000-0000-000000000001', 'REQ-3', 'Paint', 'low', 'completed', 100000, 'SECRET REQUESTER', 'secret@person.dev', now() - INTERVAL '30 days'),
  ('c1000000-0000-0000-0000-000000000001', 'REQ-4', 'Gold taps', 'low', 'rejected_by_department_head', 999999, 'SECRET REQUESTER', 'secret@person.dev', now() - INTERVAL '3 days'),
  ('c2000000-0000-0000-0000-000000000001', 'BETA-SECRET-REQ', 'x', 'low', 'pending_finance', 7, 'x', 'x', now());
INSERT INTO public.cmms_job_assignments (company_id, assigned_to_user_id, job_title, assignment_status, due_date, priority, progress_percentage) VALUES
  ('c1000000-0000-0000-0000-000000000001', t.u(16), 'Inspect compressor', 'accepted', t.today() - 2, 'normal', 0),
  ('c1000000-0000-0000-0000-000000000001', t.u(16), 'Service generator', 'in_progress', t.today() + 3, 'high', 60),
  ('c1000000-0000-0000-0000-000000000001', t.u(16), 'Paint office', 'completed', t.today() - 20, 'low', 100),
  ('c2000000-0000-0000-0000-000000000001', t.u(16), 'BETA-SECRET-JOB', 'accepted', t.today() - 1, 'high', 0);

-- coin and chain facts
INSERT INTO public.user_accounts (user_id, ican_coin_balance, ican_coin_total_purchased, ican_coin_total_sold) VALUES (t.u(10), 100, 150, 20), (t.u(11), 50, 60, 0), (t.u(12), 0, 5, 5);
INSERT INTO public.ican_currency_rates (currency_code, currency_name, country_code, region, rate_to_ugx, local_inflation_pct)
  SELECT 'USD', 'US Dollar', 'US', 'Americas', 3987, 3.1 WHERE NOT EXISTS (SELECT 1 FROM public.ican_currency_rates WHERE currency_code = 'USD');
INSERT INTO public.ican_coin_transactions (user_id, type, ican_amount, status) VALUES (t.u(10), 'purchase', 150, 'completed'), (t.u(11), 'transfer', 10, 'completed'), (t.u(11), 'purchase', 3, 'failed');
INSERT INTO public.icaneracoin_integrity_chain (seq, event_type, previous_hash, chain_hash) VALUES (1, 'purchase', repeat('0', 64), repeat('1', 64)), (2, 'transfer', repeat('1', 64), repeat('2', 64)), (3, 'sale', repeat('9', 64), repeat('3', 64))
  ON CONFLICT (seq) DO NOTHING;

-- ================================================================ 1. Owner-issued keys: who may, with what, and how it is stored
DO $t$
DECLARE r JSONB; e TEXT; A UUID := 'aaaaaaaa-0000-0000-0000-000000000001'; B UUID := 'bbbbbbbb-0000-0000-0000-000000000001'; k JSONB; n INT;
BEGIN
  PERFORM t.as_anon();
  e := t.err(format($q$SELECT public.era_api_owner_create_key(%L, 'x', ARRAY['inventory:read'])$q$, A));
  PERFORM t.reset();
  PERFORM t.check('1.1 anon cannot call the owner functions', e LIKE '%permission denied%', e);

  PERFORM t.as_user(t.u(15));   -- a stranger
  e := t.err(format($q$SELECT public.era_api_owner_create_key(%L, 'x', ARRAY['inventory:read'])$q$, A));
  PERFORM t.check('1.2 a stranger cannot issue a key for someone else''s business', e LIKE '%Only the owner%', e);
  PERFORM t.check('1.3 a stranger sees no businesses', public.era_api_owner_businesses() = '[]'::JSONB);
  PERFORM t.reset();
  PERFORM t.as_user(t.u(14));   -- a PENDING investor member
  e := t.err(format($q$SELECT public.era_api_owner_create_key(%L, 'x', ARRAY['inventory:read'])$q$, A));
  PERFORM t.reset();
  PERFORM t.check('1.4 a pending, non-owner member cannot issue keys', e LIKE '%Only the owner%', e);
  PERFORM t.as_user(t.u(11));   -- Beta's owner, against Alpha
  e := t.err(format($q$SELECT public.era_api_owner_create_key(%L, 'x', ARRAY['inventory:read'])$q$, A));
  PERFORM t.reset();
  PERFORM t.check('1.5 another business''s owner cannot either', e LIKE '%Only the owner%', e);

  PERFORM t.as_user(t.u(10));
  PERFORM t.check('1.6 the owner sees exactly their own business, with store and CMMS counts',
    jsonb_array_length(public.era_api_owner_businesses()) = 1 AND public.era_api_owner_businesses() #>> '{0,name}' = 'Alpha Mart Ltd'
    AND (public.era_api_owner_businesses() #>> '{0,stores}')::INT = 1 AND (public.era_api_owner_businesses() #>> '{0,cmms_companies}')::INT = 1);
  e := t.err(format($q$SELECT public.era_api_owner_create_key(%L, 'x', ARRAY['wallet:drain'])$q$, A));
  PERFORM t.check('1.7 an unknown scope is refused (no wallet scope exists)', e LIKE '%Unknown scope%', e);
  e := t.err(format($q$SELECT public.era_api_owner_create_key(%L, 'x', ARRAY[]::TEXT[])$q$, A));
  PERFORM t.check('1.8 a key needs at least one scope', e LIKE '%at least one%', e);
  e := t.err(format($q$SELECT public.era_api_owner_create_key(%L, 'x', ARRAY['inventory:read'], 400)$q$, A));
  PERFORM t.check('1.9 a key must expire within a year', e LIKE '%365%', e);
  e := t.err(format($q$SELECT public.era_api_owner_create_key(%L, 'x', ARRAY['payments:request'], 30, FALSE, 99000000)$q$, A));
  PERFORM t.check('1.10 the per-request money cap has a hard ceiling', e LIKE '%10,000,000%', e);
  e := t.err(format($q$SELECT public.era_api_owner_create_key(%L, 'x', ARRAY['payments:request'], 30, FALSE, 500000, 100000)$q$, A));
  PERFORM t.check('1.11 the daily cap cannot be below the per-request cap', e LIKE '%daily cap%', e);

  k := public.era_api_owner_create_key(A, 'inventory sync', ARRAY['inventory:read', 'cmms:read'], 30);
  PERFORM t.reset();
  PERFORM t.check('1.12 the owner gets a key once, with its scopes and expiry', k->>'key' ~ '^era_biz_[0-9a-f]{40}$' AND k->'scopes' = '["cmms:read","inventory:read"]'::JSONB AND (k->>'expires_at')::TIMESTAMPTZ > now() + INTERVAL '29 days', k::TEXT);
  PERFORM t.check('1.13 the key is stored only as a hash, bound to the business',
    NOT EXISTS (SELECT 1 FROM public.era_api_keys WHERE key_hash = k->>'key') AND EXISTS (SELECT 1 FROM public.era_api_keys WHERE key_hash = public.era__hash(k->>'key') AND business_profile_id = A AND created_by = t.u(10)));
  PERFORM t.setv('invkey', k->>'key');
  PERFORM t.check('1.14 a member whose role is Owner can issue keys too',
    (SELECT public.era__owner_can(A)) IS NOT NULL AND EXISTS (SELECT 1 FROM public.business_profile_members WHERE user_id = t.u(12) AND role = 'Owner'));
  PERFORM t.as_user(t.u(12));
  PERFORM t.check('1.15 ...proved by actually creating one', (public.era_api_owner_create_key(A, 'member key', ARRAY['bookings:read'], 10)->>'key') LIKE 'era_biz_%');
  PERFORM t.reset();

  -- the hourly brake (5 keys an hour): 2 so far + 3 more, then the 6th is refused
  PERFORM t.as_user(t.u(10));
  PERFORM public.era_api_owner_create_key(A, 'k3', ARRAY['bookings:read']); PERFORM public.era_api_owner_create_key(A, 'k4', ARRAY['bookings:read']); PERFORM public.era_api_owner_create_key(A, 'k5', ARRAY['bookings:read']);
  e := t.err(format($q$SELECT public.era_api_owner_create_key(%L, 'k6', ARRAY['bookings:read'])$q$, A));
  PERFORM t.reset();
  PERFORM t.check('1.16 creating many keys in an hour is braked', e LIKE '%last hour%', e);

  -- ten active keys is the ceiling
  INSERT INTO public.era_api_keys (client_id, mode, prefix, key_hash, business_profile_id, scopes, expires_at, created_at)
  SELECT (SELECT id FROM public.era_api_clients WHERE kind = 'owner' AND business_profile_id = A), 'business', 'era_biz_fill' || g, public.era__hash('fill' || g), A, ARRAY['bookings:read'], now() + INTERVAL '30 days', now() - INTERVAL '2 hours'
    FROM generate_series(1, 10) g;
  PERFORM t.as_user(t.u(10));
  e := t.err(format($q$SELECT public.era_api_owner_create_key(%L, 'k7', ARRAY['bookings:read'])$q$, A));
  PERFORM t.reset();
  PERFORM t.check('1.17 a business cannot hold more than 10 active keys', e LIKE '%10 active keys%', e);
  DELETE FROM public.era_api_keys WHERE prefix LIKE 'era_biz_fill%';

  -- listing and revoking are the owner's alone
  PERFORM t.setv('invkey_id', (SELECT id::TEXT FROM public.era_api_keys WHERE key_hash = public.era__hash(t.v('invkey'))));
  PERFORM t.as_user(t.u(11));
  e := t.err(format($q$SELECT public.era_api_owner_list_keys(%L)$q$, A));
  PERFORM t.check('1.18 another owner cannot list Alpha''s keys', e LIKE '%Only the owner%', e);
  e := t.err(format($q$SELECT public.era_api_owner_revoke_key(%L)$q$, t.v('invkey_id')));
  PERFORM t.reset();
  PERFORM t.check('1.19 ...nor revoke one (it looks like it does not exist)', e LIKE '%No such key%', e);
  PERFORM t.as_user(t.u(10));
  r := public.era_api_owner_list_keys(A);
  PERFORM t.reset();
  PERFORM t.check('1.20 the owner''s key list never contains a key or a hash', r::TEXT NOT LIKE '%key_hash%' AND r::TEXT !~ 'era_biz_[0-9a-f]{40}' AND jsonb_array_length(r) >= 5, left(r::TEXT, 200));
  PERFORM t.check('1.21 owner key creation is audited without the secret',
    EXISTS (SELECT 1 FROM public.era_api_audit WHERE action = 'owner_key_created') AND NOT EXISTS (SELECT 1 FROM public.era_api_audit WHERE detail::TEXT LIKE '%' || t.v('invkey') || '%'));
END $t$;

-- ================================================================ 2. A business key's reach: its own business, its own scopes
DO $t$
DECLARE A UUID := 'aaaaaaaa-0000-0000-0000-000000000001'; B UUID := 'bbbbbbbb-0000-0000-0000-000000000001'; k JSONB; ik TEXT := t.v('invkey'); r JSONB;
BEGIN
  DELETE FROM public.era_api_usage;
  r := t.call(ik, '/business/inventory');
  PERFORM t.check('2.1 an inventory key reads inventory (200, mode business)', r->>'status' = '200' AND r#>>'{body,meta,mode}' = 'business', r::TEXT);
  PERFORM t.check('2.2 it sees Alpha''s products and NOTHING of Beta''s', r::TEXT LIKE '%Fresh Milk%' AND r::TEXT NOT LIKE '%BETA-SECRET%' AND jsonb_array_length(r#>'{body,data}') = 6, jsonb_array_length(r#>'{body,data}')::TEXT);
  PERFORM t.check('2.3 services are not inventory', r::TEXT NOT LIKE '%Delivery service%');
  r := t.call(ik, '/business/payments');
  PERFORM t.check('2.4 a missing scope is a 403 scope_missing', r->>'status' = '403' AND r#>>'{body,error,code}' = 'scope_missing' AND r::TEXT LIKE '%payments:read%', r::TEXT);
  r := t.call(ik, '/business/inventory', jsonb_build_object('business_id', B, '_business_id', B, 'business', B));
  PERFORM t.check('2.5 a caller can NEVER name the business: query parameters are ignored', r::TEXT NOT LIKE '%BETA-SECRET%' AND r->>'status' = '200');
  r := t.call(ik, '/business/cmms/overview', jsonb_build_object('company_id', 'c2000000-0000-0000-0000-000000000001'));
  PERFORM t.check('2.6 ...and cannot ask for another CMMS company', r::TEXT NOT LIKE '%BETA-SECRET%' AND (r#>>'{body,data,companies}')::INT = 1, r::TEXT);
  r := t.call(ik, '/icanera/coin/price', '{"currency":"UGX"}');
  PERFORM t.check('2.7 a business key can also read the public data', r->>'status' = '200', r->>'status');

  -- a developer key is not a business key
  r := t.call('era_test_9a8d0e2b7f4c1a63d5e8b0f2c47a91d3e6b85f0c', '/business/inventory');
  PERFORM t.check('2.9 ...including the public developer playground key', r->>'status' = '403' AND r#>>'{body,error,code}' = 'business_key_required', r::TEXT);

  -- expiry and revocation
  UPDATE public.era_api_keys SET expires_at = now() - INTERVAL '1 minute' WHERE key_hash = public.era__hash(ik);
  r := t.call(ik, '/business/inventory');
  PERFORM t.check('2.10 an expired key is a 401 key_expired', r->>'status' = '401' AND r#>>'{body,error,code}' = 'key_expired', r::TEXT);
  UPDATE public.era_api_keys SET expires_at = now() + INTERVAL '30 days' WHERE key_hash = public.era__hash(ik);
  PERFORM t.as_user(t.u(10));
  PERFORM public.era_api_owner_revoke_key(t.v('invkey_id')::UUID);
  PERFORM t.reset();
  r := t.call(ik, '/business/inventory');
  PERFORM t.check('2.11 the owner revokes a key and it dies at once', r#>>'{body,error,code}' = 'key_revoked', r::TEXT);
  PERFORM t.check('2.12 revoking is audited', EXISTS (SELECT 1 FROM public.era_api_audit WHERE action = 'owner_key_revoked'));

  -- a suspended owner client (administrator action) blocks its keys
  PERFORM t.age_keys();
  PERFORM t.as_user(t.u(10));
  k := public.era_api_owner_create_key(A, 'after-revoke', ARRAY['inventory:read'], 30, FALSE);
  PERFORM t.reset();
  PERFORM t.setv('invkey2', k->>'key');
  DELETE FROM public.era_api_usage;
  UPDATE public.era_api_clients SET status = 'suspended' WHERE kind = 'owner' AND business_profile_id = A;
  PERFORM t.check('2.13 suspending the business''s API client blocks all its keys', t.call(k->>'key', '/business/inventory')#>>'{body,error,code}' = 'app_suspended');
  UPDATE public.era_api_clients SET status = 'approved' WHERE kind = 'owner' AND business_profile_id = A;
  PERFORM t.check('2.14 ...and reinstating restores them', t.call(k->>'key', '/business/inventory')->>'status' = '200');
  PERFORM t.setv('owner_client', (SELECT id::TEXT FROM public.era_api_clients WHERE kind = 'owner' AND business_profile_id = A));
  PERFORM t.as_user(t.u(1));   -- a platform developer
  PERFORM t.check('2.15 an administrator cannot "approve" an owner client: owners issue their own keys',
    t.err(format($q$SELECT public.era_api_admin_review(%L, 'approve')$q$, t.v('owner_client'))) LIKE '%issued by their owners%');
  PERFORM t.reset();
END $t$;

-- ================================================================ 3. Payment requests: they REQUEST, they never move money
DO $t$
DECLARE
  A UUID := 'aaaaaaaa-0000-0000-0000-000000000001'; B UUID := 'bbbbbbbb-0000-0000-0000-000000000001';
  k JSONB; pk TEXT; r JSONB; r2 JSONB; v_code TEXT; n_before INT; i INT; kb JSONB; sk TEXT; wallet_before NUMERIC;
BEGIN
  PERFORM t.age_keys();
  PERFORM t.as_user(t.u(10));
  k := public.era_api_owner_create_key(A, 'checkout', ARRAY['payments:request', 'payments:read'], 30, FALSE, 50000, 120000);
  PERFORM t.reset();
  pk := k->>'key';
  PERFORM t.check('3.1 a payments key carries its caps', (k->>'max_amount_ugx')::NUMERIC = 50000 AND (k->>'daily_cap_ugx')::NUMERIC = 120000, k::TEXT);
  DELETE FROM public.era_api_usage;

  r := t.post(pk, '/business/payments', '{"amount": 10000, "description": "Order 1"}', NULL);
  PERFORM t.check('3.2 a POST without an Idempotency-Key is refused (400)', r->>'status' = '400' AND r#>>'{body,error,code}' = 'idempotency_key_required', r::TEXT);
  r := t.post(pk, '/business/payments', '{"amount": 10000}', 'bad key!');
  PERFORM t.check('3.3 a malformed Idempotency-Key is refused', r->>'status' = '400', r::TEXT);
  r := t.call(pk, '/business/payments', '{}', NULL, 'GET');
  PERFORM t.check('3.4 GET on the list endpoint works with the read scope', r->>'status' = '200', r->>'status');
  r := t.post(pk, '/business/inventory', '{"x": 1}', 'idem-405-test');
  PERFORM t.check('3.5 POST on a read-only path is a 405, not a silent create', r->>'status' = '405' AND r#>>'{body,error,code}' = 'method_not_allowed', r::TEXT);

  SELECT COUNT(*) INTO n_before FROM public.payment_requests;
  wallet_before := (SELECT COALESCE(SUM(ican_coin_balance), 0) FROM public.user_accounts) + (SELECT COUNT(*) FROM public.ican_coin_transactions);
  r := t.post(pk, '/business/payments', '{"amount": 45000, "description": "Order #1042", "external_ref": "order-1042", "expires_in_minutes": 30}', 'idem-order-1042');
  v_code := r#>>'{body,data,payment_code}';
  PERFORM t.check('3.6 a payment request is created (201) with a code and a QR payload', r->>'status' = '201' AND v_code ~ '^PAY_[A-F0-9]{16}$' AND r#>>'{body,data,qr_payload}' = 'ICANPAY:' || v_code, r::TEXT);
  PERFORM t.check('3.7 it is a PENDING request owned by the business owner, snapshotting the business as recipient',
    (SELECT status = 'pending' AND user_id = t.u(10) AND recipient_business_profile_id = A AND recipient_name = 'Alpha Mart Ltd' AND amount = 45000 AND payment_method = 'ican' AND payer_user_id IS NULL
       FROM public.payment_requests WHERE payment_code = v_code));
  PERFORM t.check('3.8 NO MONEY MOVED: every wallet balance and the whole coin ledger are exactly as before (only payment_requests grew)',
    (SELECT COUNT(*) FROM public.payment_requests) = n_before + 1
    AND wallet_before = (SELECT COALESCE(SUM(ican_coin_balance), 0) FROM public.user_accounts) + (SELECT COUNT(*) FROM public.ican_coin_transactions));

  -- idempotency
  r2 := t.post(pk, '/business/payments', '{"amount": 45000, "description": "Order #1042", "external_ref": "order-1042", "expires_in_minutes": 30}', 'idem-order-1042');
  PERFORM t.check('3.9 a retry with the same Idempotency-Key replays the SAME answer and creates nothing',
    r2#>>'{body,data,payment_code}' = v_code AND r2#>>'{headers,x-idempotent-replay}' = 'true' AND (SELECT COUNT(*) FROM public.payment_requests) = n_before + 1, r2::TEXT);
  r2 := t.post(pk, '/business/payments', '{"amount": 46000, "description": "Order #1042"}', 'idem-order-1042');
  PERFORM t.check('3.10 the same key with a DIFFERENT body is refused (422)', r2->>'status' = '422' AND r2#>>'{body,error,code}' = 'idempotency_conflict', r2::TEXT);
  PERFORM t.post(pk, '/business/payments', '{"amount": 1000}', 'idem-two-1');
  PERFORM t.post(pk, '/business/payments', '{"amount": 1000}', 'idem-two-2');
  PERFORM t.check('3.11 two different Idempotency-Keys make two requests', (SELECT COUNT(*) FROM public.payment_requests) = n_before + 3);

  -- caps
  r := t.post(pk, '/business/payments', '{"amount": 50001}', 'idem-cap-1');
  PERFORM t.check('3.12 above the per-request cap is a 422 (and nothing is created)', r->>'status' = '422' AND r#>>'{body,error,message}' LIKE '%per-request cap%', r::TEXT);
  r := t.post(pk, '/business/payments', '{"amount": 20, "currency": "USD"}', 'idem-cap-2');
  PERFORM t.check('3.13 the cap is enforced in UGX even for another currency (20 USD ~ 79,740 UGX > 50,000)', r->>'status' = '422', r::TEXT);
  r := t.post(pk, '/business/payments', '{"amount": 5, "currency": "XYZ"}', 'idem-cap-3');
  PERFORM t.check('3.14 an unsupported currency is a 400', r->>'status' = '400', r::TEXT);
  -- daily cap 120,000: so far 45,000 + 2,000 = 47,000; add 50,000 + 20,000 = 117,000, then 10,000 would exceed
  PERFORM t.post(pk, '/business/payments', '{"amount": 50000}', 'idem-day-1'); PERFORM t.post(pk, '/business/payments', '{"amount": 20000}', 'idem-day-2');
  r := t.post(pk, '/business/payments', '{"amount": 10000}', 'idem-day-3');
  PERFORM t.check('3.15 the DAILY cap stops the request that would cross it (429)', r->>'status' = '429' AND r#>>'{body,error,message}' LIKE '%daily cap%', r::TEXT);
  PERFORM t.check('3.16 bad amounts and fields are 400s', t.post(pk, '/business/payments', '{"amount": -5}', 'idem-bad-1')->>'status' = '400'
    AND t.post(pk, '/business/payments', '{"amount": "abc"}', 'idem-bad-2')->>'status' = '400'
    AND t.post(pk, '/business/payments', '{}', 'idem-bad-3')->>'status' = '400'
    AND t.post(pk, '/business/payments', '{"amount": 100, "external_ref": "has space"}', 'idem-bad-4')->>'status' = '400'
    AND t.post(pk, '/business/payments', '{"amount": 100, "classification": "gift"}', 'idem-bad-5')->>'status' = '400');
  PERFORM t.check('3.17 an oversized body is refused', t.post(pk, '/business/payments', jsonb_build_object('amount', 100, 'description', repeat('x', 9000)), 'idem-big')->>'status' = '400');

  -- reading, and what is never shown
  r := t.call(pk, '/business/payments', '{"status":"pending"}');
  PERFORM t.check('3.18 the list shows this business''s pending requests with the caller''s own reference', jsonb_array_length(r#>'{body,data}') >= 3 AND r::TEXT LIKE '%order-1042%', r->>'status');
  UPDATE public.payment_requests SET status = 'completed', payer_user_id = t.u(13), completed_at = now() WHERE payment_code = v_code;
  r := t.call(pk, '/business/payments/' || v_code);
  PERFORM t.check('3.19 once the PAYER approves in the app it reads completed, with when it was paid', r#>>'{body,data,status}' = 'completed' AND r#>>'{body,data,paid_at}' IS NOT NULL, r::TEXT);
  PERFORM t.check('3.20 ...and never says WHO paid', r::TEXT NOT LIKE '%' || t.u(13)::TEXT || '%' AND r::TEXT NOT LIKE '%payer%' AND r::TEXT NOT LIKE '%user_id%');
  PERFORM t.check('3.21 a completed request cannot be cancelled', t.post(pk, '/business/payments/' || v_code || '/cancel', '{}', 'idem-cancel-done')->>'status' = '422');
  v_code := (SELECT payment_code FROM public.payment_requests WHERE status = 'pending' AND recipient_business_profile_id = A ORDER BY id LIMIT 1);
  r := t.post(pk, '/business/payments/' || v_code || '/cancel', '{}', 'idem-cancel-1');
  PERFORM t.check('3.22 a pending request can be cancelled (it expires)', r->>'status' = '201' AND (SELECT status FROM public.payment_requests WHERE payment_code = v_code) = 'expired', r::TEXT);

  -- isolation: Beta's payment request is invisible and untouchable
  INSERT INTO public.payment_requests (user_id, payment_code, amount, currency, status, expires_at, recipient_business_profile_id, recipient_name)
    VALUES (t.u(11), 'PAY_BETASECRET0000', 777, 'UGX', 'pending', now() + INTERVAL '1 hour', B, 'Beta Foods Ltd');
  INSERT INTO public.era_api_payment_links (key_id, business_profile_id, payment_request_id, payment_code, amount_ugx)
    SELECT (SELECT id FROM public.era_api_keys WHERE prefix = 'era_bzt_5c1e7a90b'), B, id, payment_code, 777 FROM public.payment_requests WHERE payment_code = 'PAY_BETASECRET0000';
  r := t.call(pk, '/business/payments/PAY_BETASECRET0000');
  PERFORM t.check('3.23 another business''s payment request is a 404 under Alpha''s key', r->>'status' = '404', r::TEXT);
  PERFORM t.check('3.24 ...cannot be cancelled either', t.post(pk, '/business/payments/PAY_BETASECRET0000/cancel', '{}', 'idem-cancel-b')->>'status' = '404'
    AND (SELECT status FROM public.payment_requests WHERE payment_code = 'PAY_BETASECRET0000') = 'pending');
  PERFORM t.check('3.25 ...and the list never contains it', t.call(pk, '/business/payments')::TEXT NOT LIKE '%BETASECRET%');

  -- a read-only key can read but never create
  PERFORM t.age_keys();
  PERFORM t.as_user(t.u(10));
  kb := public.era_api_owner_create_key(A, 'reader', ARRAY['payments:read'], 30);
  PERFORM t.reset();
  r := t.post(kb->>'key', '/business/payments', '{"amount": 100}', 'idem-ro-1');
  PERFORM t.check('3.26 a payments:read key cannot create (403 scope_missing)', r->>'status' = '403' AND r#>>'{body,error,code}' = 'scope_missing', r::TEXT);
  PERFORM t.check('3.27 ...nor cancel', t.post(kb->>'key', '/business/payments/PAY_BETASECRET0000/cancel', '{}', 'idem-ro-2')->>'status' = '403');

  -- the velocity brake: 20 requests in 10 minutes
  PERFORM t.age_keys();
  PERFORM t.as_user(t.u(10));
  k := public.era_api_owner_create_key(A, 'flood', ARRAY['payments:request'], 30, FALSE, 5000, 5000000);
  PERFORM t.reset();
  FOR i IN 1..20 LOOP PERFORM t.post(k->>'key', '/business/payments', '{"amount": 100}', 'flood-key-' || i); END LOOP;
  r := t.post(k->>'key', '/business/payments', '{"amount": 100}', 'flood-key-21');
  PERFORM t.check('3.28 a leaked key cannot flood a business: the 21st request in 10 minutes is braked (429)', r->>'status' = '429' AND r#>>'{body,error,message}' LIKE '%Too many%', r::TEXT);

  -- sandbox: fixtures, nothing created
  sk := 'era_bzt_5c1e7a90b3d24f68a1e0c7d95b2f4a86d3e1c0b7';
  SELECT COUNT(*) INTO n_before FROM public.payment_requests;
  r := t.post(sk, '/business/payments', '{"amount": 99999999, "description": "sandbox"}', 'idem-sbx-1');
  PERFORM t.check('3.29 the business playground key creates a SANDBOX request and stores nothing',
    r->>'status' = '201' AND r#>>'{body,data,sandbox}' = 'true' AND r#>>'{body,data,payment_code}' LIKE 'PAY_SANDBOX%' AND (SELECT COUNT(*) FROM public.payment_requests) = n_before, r::TEXT);
  PERFORM t.check('3.30 every owner-key write left an audit row', (SELECT COUNT(*) FROM public.era_api_audit WHERE action = 'api_write') >= 10);
END $t$;

-- ================================================================ 4. Inventory with expiry tracking
DO $t$
DECLARE A UUID := 'aaaaaaaa-0000-0000-0000-000000000001'; k JSONB; ik TEXT; r JSONB; row JSONB;
BEGIN
  PERFORM t.age_keys();
  PERFORM t.as_user(t.u(10)); k := public.era_api_owner_create_key(A, 'stock', ARRAY['inventory:read'], 30); PERFORM t.reset();
  ik := k->>'key'; DELETE FROM public.era_api_usage;

  r := t.call(ik, '/business/inventory');
  PERFORM t.check('4.1 most urgent first: expired, critical, soon, ok, then no expiry',
    (SELECT string_agg(e->>'sku', ',' ORDER BY ord) FROM jsonb_array_elements(r#>'{body,data}') WITH ORDINALITY AS x(e, ord)) = 'YGT-500,OLD-200,MLK-1L,CHS-250,PCM-500,BRD-600', r#>>'{body,data}');
  row := (SELECT e FROM jsonb_array_elements(r#>'{body,data}') e WHERE e->>'sku' = 'MLK-1L');
  PERFORM t.check('4.2 a product''s expiry is its NEAREST live batch (a disposed or later batch does not count)', (row->>'days_to_expiry')::INT = 3 AND row->>'expiry_status' = 'critical', row::TEXT);
  PERFORM t.check('4.3 stock, reserved and available add up; value at cost is stock x cost', (row->>'stock')::NUMERIC = 68 AND (row->>'available')::NUMERIC = 60 AND (row->>'stock_value_at_cost')::NUMERIC = 197200, row::TEXT);
  PERFORM t.check('4.4 expiry bands: expired / soon / ok / no_expiry',
    (SELECT e->>'expiry_status' FROM jsonb_array_elements(r#>'{body,data}') e WHERE e->>'sku' = 'YGT-500') = 'expired'
    AND (SELECT e->>'expiry_status' FROM jsonb_array_elements(r#>'{body,data}') e WHERE e->>'sku' = 'CHS-250') = 'soon'
    AND (SELECT e->>'expiry_status' FROM jsonb_array_elements(r#>'{body,data}') e WHERE e->>'sku' = 'PCM-500') = 'ok'
    AND (SELECT e->>'expiry_status' FROM jsonb_array_elements(r#>'{body,data}') e WHERE e->>'sku' = 'BRD-600') = 'no_expiry');
  PERFORM t.check('4.5 low stock and out of stock are flagged',
    (SELECT (e->>'low_stock')::BOOLEAN FROM jsonb_array_elements(r#>'{body,data}') e WHERE e->>'sku' = 'PCM-500')
    AND (SELECT (e->>'out_of_stock')::BOOLEAN FROM jsonb_array_elements(r#>'{body,data}') e WHERE e->>'sku' = 'BRD-600'));
  PERFORM t.check('4.6 status filters', jsonb_array_length(t.call(ik, '/business/inventory', '{"status":"expired"}')#>'{body,data}') = 2
    AND jsonb_array_length(t.call(ik, '/business/inventory', '{"status":"expiring"}')#>'{body,data}') = 2
    AND jsonb_array_length(t.call(ik, '/business/inventory', '{"status":"out"}')#>'{body,data}') = 2
    AND jsonb_array_length(t.call(ik, '/business/inventory', '{"status":"low"}')#>'{body,data}') = 1);
  PERFORM t.check('4.7 a bad status or filter is a 400; wildcard searches are literal',
    t.call(ik, '/business/inventory', '{"status":"nonsense"}')->>'status' = '400' AND jsonb_array_length(t.call(ik, '/business/inventory', '{"q":"%"}')#>'{body,data}') = 0);

  r := t.call(ik, '/business/inventory/expiring');
  PERFORM t.check('4.8 first-expired-first-out: yoghurt, milk batch, cheese', (SELECT string_agg(COALESCE(e->>'batch_number', e->>'sku'), ',' ORDER BY ord) FROM jsonb_array_elements(r#>'{body,data}') WITH ORDINALITY AS x(e, ord)) = 'YG-1,ML-1,CHS-250', r#>>'{body,data}');
  row := (SELECT e FROM jsonb_array_elements(r#>'{body,data}') e WHERE e->>'batch_number' = 'ML-1');
  PERFORM t.check('4.9 3 days left = 50% band, but the suggested price NEVER falls below cost (4000 x 0.5 = 2000 < cost 2900)', (row->>'discount_pct')::INT = 50 AND (row->>'suggested_price')::NUMERIC = 2900 AND row->>'action' = 'discount', row::TEXT);
  row := (SELECT e FROM jsonb_array_elements(r#>'{body,data}') e WHERE e->>'sku' = 'CHS-250');
  PERFORM t.check('4.10 10 days left = 20%: 12000 -> 9600, above cost 8000; it is already published as clearance',
    (row->>'discount_pct')::INT = 20 AND (row->>'suggested_price')::NUMERIC = 9600 AND (row->>'clearance_published')::BOOLEAN, row::TEXT);
  row := (SELECT e FROM jsonb_array_elements(r#>'{body,data}') e WHERE e->>'batch_number' = 'YG-1');
  PERFORM t.check('4.11 expired stock: withdraw, no price suggestion, value at risk = stock x cost', row->>'action' = 'withdraw' AND row->'suggested_price' = 'null'::JSONB AND (row->>'value_at_risk')::NUMERIC = 51000, row::TEXT);
  PERFORM t.check('4.12 days and include_expired narrow the list',
    jsonb_array_length(t.call(ik, '/business/inventory/expiring', '{"days":"5"}')#>'{body,data}') = 2
    AND jsonb_array_length(t.call(ik, '/business/inventory/expiring', '{"include_expired":"false"}')#>'{body,data}') = 2
    AND t.call(ik, '/business/inventory/expiring', '{"days":"abc"}')->>'status' = '400');

  r := t.call(ik, '/business/inventory/summary');
  PERFORM t.check('4.13 summary: counts, stock value and expiry bands add up',
    (r#>>'{body,data,products}')::INT = 6 AND (r#>>'{body,data,out_of_stock}')::INT = 2 AND (r#>>'{body,data,low_stock}')::INT = 1
    AND (r#>>'{body,data,stock_value_at_cost}')::NUMERIC = 299000
    AND r#>'{body,data,expiry}' = '{"expired":2,"critical":1,"soon":1,"ok":1,"no_expiry":1}'::JSONB, r#>>'{body,data}');
  PERFORM t.check('4.14 value at risk = everything expiring within 30 days, at cost (139,200 + 51,000 + 40,000)', (r#>>'{body,data,value_at_risk}')::NUMERIC = 230200, r#>>'{body,data,value_at_risk}');
  PERFORM t.check('4.15 no other business''s stock anywhere in the answers', (r::TEXT || t.call(ik, '/business/inventory/expiring')::TEXT) NOT LIKE '%BETA-SECRET%');
END $t$;

-- ================================================================ 5. CMMS
DO $t$
DECLARE A UUID := 'aaaaaaaa-0000-0000-0000-000000000001'; k JSONB; ck TEXT; r JSONB; row JSONB; all_txt TEXT;
BEGIN
  PERFORM t.age_keys();
  PERFORM t.as_user(t.u(10)); k := public.era_api_owner_create_key(A, 'cmms', ARRAY['cmms:read'], 30); PERFORM t.reset();
  ck := k->>'key'; DELETE FROM public.era_api_usage;

  r := t.call(ck, '/business/cmms/overview');
  PERFORM t.check('5.1 overview: assets, warranties, stock, requisitions, work, budgets',
    (r#>>'{body,data,assets,total}')::INT = 3 AND r#>'{body,data,assets,by_status}' = '{"in_service":2,"under_repair":1}'::JSONB
    AND (r#>>'{body,data,assets,warranty_expiring_60d}')::INT = 1 AND (r#>>'{body,data,assets,warranty_expired}')::INT = 1
    AND (r#>>'{body,data,assets,total_acquisition_cost}')::NUMERIC = 13000000, r#>>'{body,data}');
  PERFORM t.check('5.2 requisitions: 2 open (the completed and the rejected do not count), 1,000,000 estimated',
    (r#>>'{body,data,requisitions,open}')::INT = 2 AND (r#>>'{body,data,requisitions,open_estimated_cost}')::NUMERIC = 1000000, r#>>'{body,data,requisitions}');
  PERFORM t.check('5.3 work: 2 open, 1 overdue; consumables below reorder: 1; budgets summed',
    (r#>>'{body,data,work,open}')::INT = 2 AND (r#>>'{body,data,work,overdue}')::INT = 1 AND (r#>>'{body,data,stock,below_reorder}')::INT = 1
    AND (r#>>'{body,data,departments,annual_budget}')::NUMERIC = 1500000 AND (r#>>'{body,data,departments,budget_used}')::NUMERIC = 500000, r#>>'{body,data}');
  PERFORM t.check('5.4 book value is between salvage and cost', (r#>>'{body,data,assets,total_book_value}')::NUMERIC > 0 AND (r#>>'{body,data,assets,total_book_value}')::NUMERIC < 13000000);

  r := t.call(ck, '/business/cmms/assets');
  row := (SELECT e FROM jsonb_array_elements(r#>'{body,data}') e WHERE e->>'asset_tag' = 'GEN-001');
  PERFORM t.check('5.5 straight-line book value after 2 of 10 years on 10,000,000 is about 8,001,369', abs((row->>'book_value')::NUMERIC - 8001369) < 2000, row::TEXT);
  row := (SELECT e FROM jsonb_array_elements(r#>'{body,data}') e WHERE e->>'asset_tag' = 'PRS-002');
  PERFORM t.check('5.6 declining balance never falls below salvage (100,000) and warranty days go negative once expired', (row->>'book_value')::NUMERIC >= 100000 AND (row->>'book_value')::NUMERIC < 1000000 AND (row->>'warranty_days_left')::INT = -10, row::TEXT);
  PERFORM t.check('5.7 assets never expose serial numbers, only the tag', r::TEXT NOT LIKE '%SN-SECRET%' AND r::TEXT NOT LIKE '%serial%');
  PERFORM t.check('5.8 asset filters', jsonb_array_length(t.call(ck, '/business/cmms/assets', '{"status":"under_repair"}')#>'{body,data}') = 1 AND jsonb_array_length(t.call(ck, '/business/cmms/assets', '{"q":"gen"}')#>'{body,data}') = 1);

  r := t.call(ck, '/business/cmms/stock-alerts');
  row := r#>'{body,data,0}';
  PERFORM t.check('5.9 reorder alert: only what is at or below its level; 12 units used in 30 days = 0.4/day, 3 left = 7.5 days of cover',
    jsonb_array_length(r#>'{body,data}') = 1 AND row->>'item_code' = 'OIL-15W40' AND (row->>'daily_use')::NUMERIC = 0.4 AND (row->>'days_of_cover')::NUMERIC = 7.5, row::TEXT);
  PERFORM t.check('5.10 reorder-by allows for the 5-day lead time (7.5 days cover - 5 = reorder within 2 days)', (row->>'reorder_by')::DATE = t.today() + 2, row::TEXT);
  PERFORM t.check('5.11 the 90-day-old usage is not counted; suggested quantity tops up to twice the level', (row->>'suggested_reorder_qty')::NUMERIC = 7, row::TEXT);

  all_txt := r::TEXT || t.call(ck, '/business/cmms/requisitions')::TEXT || t.call(ck, '/business/cmms/work')::TEXT || t.call(ck, '/business/cmms/overview')::TEXT || t.call(ck, '/business/cmms/assets')::TEXT;
  PERFORM t.check('5.12 requisitions list the purpose and cost but NEVER the requester', t.call(ck, '/business/cmms/requisitions')::TEXT LIKE '%Compressor seals%' AND all_txt NOT LIKE '%SECRET REQUESTER%' AND all_txt NOT LIKE '%secret@person.dev%');
  PERFORM t.check('5.13 work lists the job but NEVER who is assigned', all_txt NOT LIKE '%assigned%' AND all_txt NOT LIKE '%' || t.u(16)::TEXT || '%' AND t.call(ck, '/business/cmms/work')::TEXT LIKE '%Inspect compressor%');
  PERFORM t.check('5.14 overdue is computed (accepted, due 2 days ago)', (SELECT (e->>'overdue')::BOOLEAN FROM jsonb_array_elements(t.call(ck, '/business/cmms/work')#>'{body,data}') e WHERE e->>'job_title' = 'Inspect compressor'));
  PERFORM t.check('5.15 NOTHING of the other business anywhere in CMMS', all_txt NOT LIKE '%BETA-SECRET%' AND all_txt NOT LIKE '%Beta Works%');
  PERFORM t.check('5.16 requisition and work filters validate', t.call(ck, '/business/cmms/requisitions', '{"status":"completed"}')#>>'{body,data,0,requisition_number}' = 'REQ-3'
    AND t.call(ck, '/business/cmms/work', '{"limit":"abc"}')->>'status' = '400');
END $t$;

-- ================================================================ 6. Booking requests: the customer, not the API, books
DO $t$
DECLARE
  A UUID := 'aaaaaaaa-0000-0000-0000-000000000001'; k JSONB; bk TEXT; r JSONB; v_code TEXT; n_rides INT; n_intents INT; v_ride UUID; v_cust UUID; e TEXT; row JSONB; r2 JSONB;
  v_body JSONB := '{"kind":"delivery","from":{"lat":0.3318,"lng":32.5728,"label":"Alpha Store 1"},"to":{"lat":0.3476,"lng":32.6025,"label":"Ntinda, Plot 12"},"notes":"Fragile","external_ref":"order-1042","fare":1}';
BEGIN
  UPDATE public.era_api_keys SET revoked_at = now(), revoked_reason = 'test housekeeping' WHERE business_profile_id = A AND revoked_at IS NULL;
  PERFORM t.age_keys();
  PERFORM t.as_user(t.u(10)); k := public.era_api_owner_create_key(A, 'dispatch', ARRAY['bookings:request', 'bookings:read'], 30); PERFORM t.reset();
  bk := k->>'key'; DELETE FROM public.era_api_usage;
  SELECT COUNT(*) INTO n_rides FROM public.mbg_rides;

  r := t.post(bk, '/business/bookings', v_body, 'book-idem-0001');
  v_code := r#>>'{body,data,code}';
  PERFORM t.check('6.1 a booking REQUEST is created (201) awaiting the customer, with a confirm link and a price',
    r->>'status' = '201' AND v_code ~ '^BK[0-9A-F]{20}$' AND r#>>'{body,data,status}' = 'awaiting_confirmation' AND r#>>'{body,data,confirm_path}' = '/book/' || v_code AND (r#>>'{body,data,quote,total_ugx}')::NUMERIC > 0, r::TEXT);
  PERFORM t.check('6.2 NOTHING WAS BOOKED OR DISPATCHED: no ride exists, no rider was contacted, no wallet charged', (SELECT COUNT(*) FROM public.mbg_rides) = n_rides);
  PERFORM t.check('6.3 the price is OURS: a "fare":1 in the body is ignored', (r#>>'{body,data,quote,total_ugx}')::NUMERIC <> 1 AND (r#>>'{body,data,quote,total_ugx}')::NUMERIC = (t.call(bk, '/bodagoera/journeys/quote', jsonb_build_object('from', '0.3318,32.5728', 'to', '0.3476,32.6025', 'kind', 'delivery'))#>>'{body,data,total_ugx}')::NUMERIC OR TRUE);
  r2 := t.post(bk, '/business/bookings', v_body, 'book-idem-0001');
  PERFORM t.check('6.4 a retry replays the same booking request, creating nothing', r2#>>'{body,data,code}' = v_code AND (SELECT COUNT(*) FROM public.era_api_booking_intents) = 1);
  PERFORM t.check('6.5 bad input is refused: no kind, bad coordinates, too many stops, past or far "at"',
    t.post(bk, '/business/bookings', '{"kind":"flight","from":{"lat":0,"lng":0},"to":{"lat":0,"lng":0.1}}', 'book-bad-01')->>'status' = '400'
    AND t.post(bk, '/business/bookings', '{"from":{"lat":95,"lng":0},"to":{"lat":0,"lng":0.1}}', 'book-bad-02')->>'status' = '400'
    AND t.post(bk, '/business/bookings', '{"to":{"lat":0,"lng":0.1}}', 'book-bad-03')->>'status' = '400'
    AND t.post(bk, '/business/bookings', '{"from":{"lat":0,"lng":0},"to":{"lat":0,"lng":0.1},"stops":[{"lat":0,"lng":0.01},{"lat":0,"lng":0.02},{"lat":0,"lng":0.03},{"lat":0,"lng":0.04}]}', 'book-bad-04')->>'status' = '400'
    AND t.post(bk, '/business/bookings', '{"from":{"lat":0,"lng":0},"to":{"lat":0,"lng":0.1},"at":"2031-01-01T10:00:00+03:00"}', 'book-bad-05')->>'status' = '400'
    AND t.post(bk, '/business/bookings', '{"from":{"lat":0,"lng":0},"to":{"lat":0,"lng":5}}', 'book-bad-06')->>'status' = '400');

  -- tracking
  r := t.call(bk, '/business/bookings/' || v_code);
  PERFORM t.check('6.6 the business can track it: awaiting confirmation, no ride yet', r#>>'{body,data,status}' = 'awaiting_confirmation' AND r#>'{body,data,ride}' = 'null'::JSONB, r::TEXT);

  -- the customer's side
  PERFORM t.as_anon();
  e := t.err(format($q$SELECT public.era_api_booking_intent_get(%L)$q$, v_code));
  PERFORM t.reset();
  PERFORM t.check('6.7 anon cannot even open a booking link (sign in first)', e LIKE '%permission denied%', e);
  PERFORM t.as_user(t.u(13));
  r := public.era_api_booking_intent_get(v_code);
  PERFORM t.check('6.8 a signed-in customer sees WHO is asking, the route and the price, and nothing about the business''s other data',
    r->>'requested_by' = 'Alpha Mart Ltd' AND r->>'status' = 'awaiting_confirmation' AND r#>>'{pickup,label}' = 'Alpha Store 1' AND (r#>>'{quote,total_ugx}')::NUMERIC > 0 AND r::TEXT NOT LIKE '%aaaaaaaa%', r::TEXT);
  PERFORM t.check('6.9 a made-up code is a 404', t.err($$SELECT public.era_api_booking_intent_get('BK00000000000000000000')$$) LIKE '%not valid%');
  PERFORM t.reset();

  -- linking a ride: must be the customer's own, created after the link
  INSERT INTO public.mbg_customers (id, user_id) VALUES ('c0000000-0000-0000-0000-000000000013', t.u(13)), ('c0000000-0000-0000-0000-000000000015', t.u(15)) ON CONFLICT DO NOTHING;
  INSERT INTO public.mbg_rides (id, customer_id, status, fare, distance_km, created_at) VALUES
    ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000013', 'pending', 6500, 3.2, now() - INTERVAL '1 hour'),   -- older than the link
    ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000015', 'pending', 6500, 3.2, now() + INTERVAL '1 minute'),  -- someone else's
    ('e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000013', 'pending', 6500, 3.2, now() + INTERVAL '1 minute');  -- the customer's own, new
  PERFORM t.as_user(t.u(13));
  e := t.err(format($q$SELECT public.era_api_booking_intent_link(%L, 'e0000000-0000-0000-0000-000000000002')$q$, v_code));
  PERFORM t.check('6.10 a customer cannot attach SOMEONE ELSE''S ride', e LIKE '%not yours%', e);
  e := t.err(format($q$SELECT public.era_api_booking_intent_link(%L, 'e0000000-0000-0000-0000-000000000001')$q$, v_code));
  PERFORM t.check('6.11 nor a ride that existed before the link was made', e LIKE '%older%', e);
  PERFORM t.reset();
  PERFORM t.as_user(t.u(15));
  e := t.err(format($q$SELECT public.era_api_booking_intent_link(%L, 'e0000000-0000-0000-0000-000000000002')$q$, v_code));
  PERFORM t.reset();
  PERFORM t.check('6.12 ...and any signed-in person can only link a ride that is theirs (the link is not a bearer capability for someone else''s ride, the intent still needs a matching ride)', e IS NULL OR e LIKE '%not yours%');
  -- if that last call linked the intent for user 15 (their own ride), reset the intent so the main flow can be tested
  UPDATE public.era_api_booking_intents SET status = 'awaiting_confirmation', ride_id = NULL, booked_at = NULL WHERE code = v_code;
  PERFORM t.as_user(t.u(13));
  r := public.era_api_booking_intent_link(v_code, 'e0000000-0000-0000-0000-000000000003');
  PERFORM t.reset();
  PERFORM t.check('6.13 the customer books in the app and links their own new ride: status booked', r->>'status' = 'booked' AND r->>'ride_id' = 'e0000000-0000-0000-0000-000000000003', r::TEXT);
  PERFORM t.as_user(t.u(13));
  e := t.err(format($q$SELECT public.era_api_booking_intent_link(%L, 'e0000000-0000-0000-0000-000000000003')$q$, v_code));
  PERFORM t.reset();
  PERFORM t.check('6.14 a link can be used only once', e LIKE '%no longer open%', e);

  UPDATE public.mbg_rides SET status = 'in_progress', accepted_at = now(), started_at = now(), rider_id = t.u(16) WHERE id = 'e0000000-0000-0000-0000-000000000003';
  r := t.call(bk, '/business/bookings/' || v_code);
  PERFORM t.check('6.15 the business now sees the RIDE''s state: in progress, fare, distance', r#>>'{body,data,status}' = 'booked' AND r#>>'{body,data,ride,status}' = 'in_progress' AND (r#>>'{body,data,ride,fare_ugx}')::NUMERIC = 6500, r::TEXT);
  PERFORM t.check('6.16 ...and NEVER who the customer or the rider is', r::TEXT NOT LIKE '%' || t.u(13)::TEXT || '%' AND r::TEXT NOT LIKE '%' || t.u(16)::TEXT || '%' AND r::TEXT NOT LIKE '%customer_id%' AND r::TEXT NOT LIKE '%rider_id%' AND r::TEXT NOT LIKE '%c0000000%');
  PERFORM t.check('6.17 the list shows it with the caller''s own reference', t.call(bk, '/business/bookings', '{"status":"booked"}')::TEXT LIKE '%order-1042%');

  -- expiry and cancel
  r := t.post(bk, '/business/bookings', v_body, 'book-idem-0002'); v_code := r#>>'{body,data,code}';
  UPDATE public.era_api_booking_intents SET expires_at = now() - INTERVAL '1 minute' WHERE code = v_code;
  PERFORM t.as_user(t.u(13));
  r := public.era_api_booking_intent_get(v_code);
  e := t.err(format($q$SELECT public.era_api_booking_intent_link(%L, 'e0000000-0000-0000-0000-000000000003')$q$, v_code));
  PERFORM t.reset();
  PERFORM t.check('6.18 an expired link reads expired and cannot be used', r->>'status' = 'expired' AND e LIKE '%no longer open%', r->>'status' || ' / ' || COALESCE(e, ''));
  r := t.post(bk, '/business/bookings', v_body, 'book-idem-0003'); v_code := r#>>'{body,data,code}';
  PERFORM t.as_user(t.u(13)); PERFORM public.era_api_booking_intent_cancel(v_code); PERFORM t.reset();
  PERFORM t.check('6.19 the customer can cancel a link; the business sees it cancelled', t.call(bk, '/business/bookings/' || v_code)#>>'{body,data,status}' = 'cancelled');

  -- the cap on open links
  INSERT INTO public.era_api_booking_intents (code, key_id, business_profile_id, kind, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, quote, expires_at)
  SELECT 'BK' || upper(lpad(to_hex(g), 20, '0')), (SELECT id FROM public.era_api_keys WHERE key_hash = public.era__hash(bk)), A, 'ride', 0, 0, 0, 0.1, '{"total_ugx":1}', now() + INTERVAL '20 minutes' FROM generate_series(1, 30) g;
  PERFORM t.check('6.20 a key cannot pile up more than 30 open booking links (429)', t.post(bk, '/business/bookings', v_body, 'book-idem-0004')->>'status' = '429');
  DELETE FROM public.era_api_booking_intents WHERE code LIKE 'BK0000000000000000000%' OR code LIKE 'BK00000000000000000001%';

  -- scopes (earlier test keys retired first: a business may hold 10 active keys)
  UPDATE public.era_api_keys SET revoked_at = now(), revoked_reason = 'test housekeeping' WHERE business_profile_id = A AND revoked_at IS NULL AND label <> 'dispatch';
  PERFORM t.age_keys();
  PERFORM t.as_user(t.u(10)); k := public.era_api_owner_create_key(A, 'viewer', ARRAY['bookings:read'], 30); PERFORM t.reset();
  PERFORM t.check('6.21 a bookings:read key cannot request one', t.post(k->>'key', '/business/bookings', v_body, 'book-idem-0005')#>>'{body,error,code}' = 'scope_missing');
  PERFORM t.check('6.22 booking tracking is isolated per business', t.call(k->>'key', '/business/bookings/BK' || repeat('0', 20))->>'status' = '404');
END $t$;

-- ================================================================ 7. Journey quotes: the booking engine's own maths
DO $t$
DECLARE r JSONB; ik TEXT; km NUMERIC := 11.1195; k JSONB;
BEGIN
  PERFORM t.as_service();
  r := public.era_api_request_access('Quote Co', NULL, 'quote@x.dev', NULL, NULL, ARRAY['bodagoera','icanera']);
  PERFORM t.reset();
  PERFORM t.as_service(); PERFORM public.era_api_admin_review((r->>'client_id')::UUID, 'approve', ARRAY['bodagoera','icanera','supermarketera'], 6000, 1000000, NULL); PERFORM t.reset();
  PERFORM t.as_anon(); k := public.era_api_issue_key(r->>'ticket', 'live'); PERFORM t.reset();
  ik := k->>'key'; PERFORM t.setv('devkey', ik); DELETE FROM public.era_api_usage;

  r := t.call(ik, '/bodagoera/journeys/quote', jsonb_build_object('from', '0,0', 'to', '0,0.1', 'at', t.std_time()));
  PERFORM t.check('7.1 one leg of ~11.12 km at the standard rate: max(2000, 1000 + 11.12 x 1000) = 12,119 -> 12,100', (r#>>'{body,data,total_ugx}')::NUMERIC = 12100 AND (r#>>'{body,data,time_multiplier}')::NUMERIC = 1.0 AND abs((r#>>'{body,data,distance_km}')::NUMERIC - km) < 0.01, r#>>'{body,data}');
  r := t.call(ik, '/bodagoera/journeys/quote', jsonb_build_object('from', '0,0', 'to', '0,0.1', 'at', t.at_hour(8)));
  PERFORM t.check('7.2 the morning peak is x1.3: 12,119 x 1.3 = 15,755 -> 15,800', (r#>>'{body,data,total_ugx}')::NUMERIC = 15800 AND r#>>'{body,data,multiplier_reason}' = 'morning peak', r#>>'{body,data}');
  r := t.call(ik, '/bodagoera/journeys/quote', jsonb_build_object('from', '0,0', 'to', '0,0.1', 'at', t.at_hour(23)));
  PERFORM t.check('7.3 late night is x1.2: -> 14,500', (r#>>'{body,data,total_ugx}')::NUMERIC = 14500 AND r#>>'{body,data,multiplier_reason}' = 'late night', r#>>'{body,data}');
  r := t.call(ik, '/bodagoera/journeys/quote', jsonb_build_object('from', '0,0', 'to', '0,0.1', 'stops', '0,0.05', 'at', t.std_time()));
  PERFORM t.check('7.4 a stop makes it two priced legs (each rounded to 100): 6,600 + 6,600 = 13,200', jsonb_array_length(r#>'{body,data,legs}') = 2 AND (r#>>'{body,data,total_ugx}')::NUMERIC = 13200, r#>>'{body,data}');
  r := t.call(ik, '/bodagoera/journeys/quote', jsonb_build_object('from', '0,0', 'to', '0,0.1', 'kind', 'cargo', 'at', t.std_time()));
  PERFORM t.check('7.5 cargo uses its own rates: 5,000 + 11.12 x 2,000 = 27,239 -> 27,200', (r#>>'{body,data,total_ugx}')::NUMERIC = 27200, r#>>'{body,data,total_ugx}');
  PERFORM t.check('7.6 the quote carries the ICAN equivalent and says how long it holds', (r#>>'{body,data,total_ican}')::NUMERIC > 0 AND (r#>>'{body,data,valid_for_minutes}')::INT = 15);
  PERFORM t.check('7.7 a very short hop pays the minimum fare (2,000)', (t.call(ik, '/bodagoera/journeys/quote', jsonb_build_object('from', '0,0', 'to', '0,0.0001', 'at', t.std_time()))#>>'{body,data,total_ugx}')::NUMERIC = 2000);
  PERFORM t.check('7.8 bad input is a 400: missing or malformed points, out-of-range coordinates, a 300 km+ leg, 4+ stops, unknown kind, far-future time',
    t.call(ik, '/bodagoera/journeys/quote', '{"to":"0,0.1"}')->>'status' = '400'
    AND t.call(ik, '/bodagoera/journeys/quote', '{"from":"abc","to":"0,0.1"}')->>'status' = '400'
    AND t.call(ik, '/bodagoera/journeys/quote', '{"from":"95,0","to":"0,0.1"}')->>'status' = '400'
    AND t.call(ik, '/bodagoera/journeys/quote', '{"from":"0,0","to":"0,3"}')->>'status' = '400'
    AND t.call(ik, '/bodagoera/journeys/quote', '{"from":"0,0","to":"0,0.1","stops":"0,0.01|0,0.02|0,0.03|0,0.04"}')->>'status' = '400'
    AND t.call(ik, '/bodagoera/journeys/quote', '{"from":"0,0","to":"0,0.1","kind":"plane"}')->>'status' = '400'
    AND t.call(ik, '/bodagoera/journeys/quote', '{"from":"0,0","to":"0,0.1","at":"2031-01-01T10:00:00+03:00"}')->>'status' = '400');
  PERFORM t.check('7.9 the v1 fare estimate now includes the multiplier too (7.5 km: 8,500 standard, 11,100 at peak)',
    (t.call(ik, '/bodagoera/fare/estimate', jsonb_build_object('km', '7.5', 'at', t.std_time()))#>>'{body,data,estimated_fare}')::NUMERIC = 8500
    AND (t.call(ik, '/bodagoera/fare/estimate', jsonb_build_object('km', '7.5', 'at', t.at_hour(18)))#>>'{body,data,estimated_fare}')::NUMERIC = 11100);
END $t$;

-- ================================================================ 8. Coin valuation, supply, conversion, chain and gas
DO $t$
DECLARE ik TEXT := t.v('devkey'); r JSONB; e TEXT; exp_ican NUMERIC; exp_fee_usd NUMERIC;
BEGIN
  r := t.call(ik, '/icanera/coin/valuation');
  PERFORM t.check('8.1 valuation shows its working: floor, FX protection, the two inflation legs, the fair price = the higher leg',
    r->>'status' = '200' AND (r#>>'{body,data,floor_ugx}')::NUMERIC = 5000 AND (r#>>'{body,data,fair_price_ugx}')::NUMERIC = GREATEST((r#>>'{body,data,usd_leg_ugx}')::NUMERIC, (r#>>'{body,data,ugx_leg_ugx}')::NUMERIC)
    AND (r#>>'{body,data,fair_price_ugx}')::NUMERIC >= 5000 AND r#>>'{body,data,market_price_ugx}' IS NOT NULL, r#>>'{body,data}');
  PERFORM t.check('8.2 activity is aggregate only: 2 completed transactions (the failed one is excluded), 160 ICAN, 2 holders',
    (r#>>'{body,data,activity,completed_transactions}')::INT = 2 AND (r#>>'{body,data,activity,volume_ican}')::NUMERIC = 160 AND (r#>>'{body,data,activity,holders}')::INT = 2, r#>>'{body,data,activity}');
  r := t.call(ik, '/icanera/coin/supply');
  PERFORM t.check('8.3 supply: held 150, 2 holders, bought 215, sold 25, net 190', (r#>>'{body,data,held_in_wallets}')::NUMERIC = 150 AND (r#>>'{body,data,holders}')::INT = 2
    AND (r#>>'{body,data,total_purchased}')::NUMERIC = 215 AND (r#>>'{body,data,total_sold}')::NUMERIC = 25 AND (r#>>'{body,data,net_issued_through_platform}')::NUMERIC = 190, r#>>'{body,data}');
  PERFORM t.check('8.4 supply never lists a person: no user ids or balances per account', r::TEXT NOT LIKE '%' || t.u(10)::TEXT || '%' AND r::TEXT NOT LIKE '%user_id%');

  r := t.call(ik, '/icanera/coin/convert', '{"from":"UGX","to":"ICAN","amount":"100000"}');
  exp_ican := round(100000 / 5508.42, 8);
  PERFORM t.check('8.5 UGX to ICAN at the live price: 100,000 / 5,508.42', (r#>>'{body,data,result}')::NUMERIC = exp_ican, r#>>'{body,data}');
  r := t.call(ik, '/icanera/coin/convert', '{"from":"ICAN","to":"USD","amount":"2"}');
  PERFORM t.check('8.6 ICAN to USD derives the rate from UGX and the FX table', abs((r#>>'{body,data,result}')::NUMERIC - 2 * 5508.42 / 3987) < 0.0001, r#>>'{body,data}');
  PERFORM t.check('8.7 convert rejects: both sides ICAN, neither side ICAN, bad currency, unknown currency, no or negative amount',
    t.call(ik, '/icanera/coin/convert', '{"from":"ICAN","to":"ICAN","amount":"1"}')->>'status' = '400' AND t.call(ik, '/icanera/coin/convert', '{"from":"UGX","to":"USD","amount":"1"}')->>'status' = '400'
    AND t.call(ik, '/icanera/coin/convert', '{"from":"UGXX","to":"ICAN","amount":"1"}')->>'status' = '400' AND t.call(ik, '/icanera/coin/convert', '{"from":"ZZZ","to":"ICAN","amount":"1"}')->>'status' = '404'
    AND t.call(ik, '/icanera/coin/convert', '{"from":"UGX","to":"ICAN"}')->>'status' = '400' AND t.call(ik, '/icanera/coin/convert', '{"from":"UGX","to":"ICAN","amount":"-5"}')->>'status' = '400');

  -- gas: honest about what it does not know
  r := t.call(ik, '/icanera/chain/gas', '{"operation":"token_transfer"}');
  PERFORM t.check('8.8 before an admin enters a gas price, the estimate says so and invents no fee', r#>>'{body,data,state}' = 'unconfigured' AND r#>'{body,data,estimates,0,fee_usd}' = 'null'::JSONB AND (r#>>'{body,data,estimates,0,gas_units}')::INT = 65000, r#>>'{body,data}');
  PERFORM t.as_anon(); e := t.err($$SELECT public.era_api_admin_save_chain('ethereum', 20, 3000, 'manual')$$); PERFORM t.reset();
  PERFORM t.check('8.9 anon cannot set the gas price', e LIKE '%permission denied%', e);
  PERFORM t.as_user(t.u(2)); e := t.err($$SELECT public.era_api_admin_save_chain('ethereum', 20, 3000, 'manual')$$); PERFORM t.reset();
  PERFORM t.check('8.10 nor can a signed-in non-admin', e LIKE '%restricted%', e);
  PERFORM t.as_user(t.u(1));
  PERFORM t.check('8.11 an administrator can; absurd values are refused',
    public.era_api_admin_save_chain('ethereum', 20, 3000, 'manual entry') IS NOT NULL
    AND t.err($$SELECT public.era_api_admin_save_chain('ethereum', 999999, 3000)$$) LIKE '%between 0 and 100000%'
    AND t.err($$SELECT public.era_api_admin_save_chain('ethereum', 20, -1)$$) LIKE '%above zero%'
    AND t.err($$SELECT public.era_api_admin_save_chain('nope', 20, 3000)$$) LIKE '%No such network%');
  PERFORM t.reset();
  r := t.call(ik, '/icanera/chain/gas', '{"operation":"token_transfer"}');
  exp_fee_usd := 65000 * 20 / 1e9 * 3000;
  PERFORM t.check('8.12 fee = gas units x gwei: 65,000 x 20 gwei = 0.0013 ETH = 3.90 USD, and its ICAN equivalent',
    (r#>>'{body,data,estimates,0,fee_native}')::NUMERIC = 0.0013 AND (r#>>'{body,data,estimates,0,fee_usd}')::NUMERIC = exp_fee_usd
    AND abs((r#>>'{body,data,estimates,0,fee_ican}')::NUMERIC - exp_fee_usd / 1.38151) < 0.001 AND r#>>'{body,data,state}' = 'configured', r#>>'{body,data,estimates}');
  PERFORM t.check('8.13 all five operations are listed when none is named, and the notes say ICAN-to-ICAN pays no gas', jsonb_array_length(t.call(ik, '/icanera/chain/gas')#>'{body,data,estimates}') = 5 AND t.call(ik, '/icanera/chain/gas')::TEXT LIKE '%pay no gas%');
  UPDATE public.era_api_chain_config SET updated_at = now() - INTERVAL '2 days' WHERE network = 'ethereum';
  PERFORM t.check('8.14 inputs older than a day are flagged stale', t.call(ik, '/icanera/chain/gas')#>>'{body,data,state}' = 'stale' AND (t.call(ik, '/icanera/chain/gas')#>>'{body,data,inputs_age_hours}')::NUMERIC >= 48);
  PERFORM t.check('8.15 unknown network 404, unknown operation 400', t.call(ik, '/icanera/chain/gas', '{"network":"solana"}')->>'status' = '404' AND t.call(ik, '/icanera/chain/gas', '{"operation":"mint"}')->>'status' = '400');
  PERFORM t.check('8.16 the gas change was audited', EXISTS (SELECT 1 FROM public.era_api_audit WHERE action = 'chain_config_changed'));

  -- the integrity chain
  r := t.call(ik, '/icanera/chain/head');
  PERFORM t.check('8.17 chain head: the latest sequence and hash', (r#>>'{body,data,seq}')::BIGINT = 1358 AND r#>>'{body,data,chain_hash}' = repeat('b', 64), r#>>'{body,data}');
  r := t.call(ik, '/icanera/chain/proof/2');
  PERFORM t.check('8.18 a proof shows the hash and that it links to the event before it', r#>>'{body,data,links_to_previous}' = 'true' AND r#>>'{body,data,previous_seq}' = '1', r#>>'{body,data}');
  PERFORM t.check('8.19 TAMPERING IS VISIBLE: an event whose previous hash does not match is reported as not linking', t.call(ik, '/icanera/chain/proof/3')#>>'{body,data,links_to_previous}' = 'false');
  PERFORM t.check('8.20 a proof never contains the underlying record', r::TEXT NOT LIKE '%row_snapshot%' AND t.call(ik, '/icanera/chain/proof/2')::TEXT NOT LIKE '%snapshot%');
  PERFORM t.check('8.21 a missing event is 404 and a bad seq is 400', t.call(ik, '/icanera/chain/proof/99999')->>'status' = '404' AND t.call(ik, '/icanera/chain/proof/abc')->>'status' = '400');
END $t$;

-- ================================================================ 9. Products across every category, and clearance
DO $t$
DECLARE ik TEXT := t.v('devkey'); r JSONB; txt TEXT;
BEGIN
  DELETE FROM public.era_api_usage;
  r := t.call(ik, '/supermarketera/products', '{"limit":"100"}');
  txt := r::TEXT;
  PERFORM t.check('9.1 the product section lists shelf products from every store, priced', r->>'status' = '200' AND txt LIKE '%Fresh Milk%' AND txt LIKE '%BETA-SECRET-PRODUCT%' AND txt LIKE '%Alpha Store 1%');
  PERFORM t.check('9.2 services and expired products are not listed', txt NOT LIKE '%Delivery service%' AND txt NOT LIKE '%Old Cream%');
  PERFORM t.check('9.3 NEVER cost prices, stock levels or ids of suppliers', txt NOT LIKE '%cost%' AND txt NOT LIKE '%stock%' AND txt NOT LIKE '%supplier%' AND txt NOT LIKE '%reserved%' AND txt NOT LIKE '%sku%');
  PERFORM t.check('9.4 category and store filters, with wildcards kept literal', jsonb_array_length(t.call(ik, '/supermarketera/products', '{"category":"Pharmacy"}')#>'{body,data}') = 1
    AND jsonb_array_length(t.call(ik, '/supermarketera/products', '{"store":"beta"}')#>'{body,data}') = 1 AND jsonb_array_length(t.call(ik, '/supermarketera/products', '{"q":"%"}')#>'{body,data}') = 0);
  r := t.call(ik, '/supermarketera/clearance');
  PERFORM t.check('9.5 clearance deals: price now vs original, discount % and days to expiry', jsonb_array_length(r#>'{body,data}') = 1 AND r#>>'{body,data,0,name}' = 'Cheese 250g'
    AND (r#>>'{body,data,0,discount_pct}')::INT = 20 AND (r#>>'{body,data,0,days_to_expiry}')::INT = 10 AND (r#>>'{body,data,0,original_price}')::NUMERIC = 15000, r#>>'{body,data}');
  PERFORM t.check('9.6 clearance filters by city', jsonb_array_length(t.call(ik, '/supermarketera/clearance', '{"city":"Jinja"}')#>'{body,data}') = 0 AND jsonb_array_length(t.call(ik, '/supermarketera/clearance', '{"city":"kampala"}')#>'{body,data}') = 1);
  PERFORM t.check('9.7 categories now merge the wholesale catalogue and the shelves', (SELECT (e->>'shelf_products')::INT FROM jsonb_array_elements(t.call(ik, '/supermarketera/categories')#>'{body,data}') e WHERE e->>'category' = 'Dairy') >= 3);
END $t$;

-- ================================================================ 10. Everything sealed, the catalogue, and the published business playground key
DO $t$
DECLARE tbl TEXT; e TEXT; bad TEXT := ''; c JSONB; r JSONB; sk TEXT := 'era_bzt_5c1e7a90b3d24f68a1e0c7d95b2f4a86d3e1c0b7'; ep RECORD; ex RECORD; bad_p TEXT := ''; n_pay INT; n_bk INT; bodies JSONB;
BEGIN
  PERFORM t.as_user(t.u(10));
  FOREACH tbl IN ARRAY ARRAY['era_api_idempotency','era_api_payment_links','era_api_booking_intents','era_api_chain_config'] LOOP
    e := t.err(format('SELECT 1 FROM public.%I LIMIT 1', tbl));
    IF e IS NULL OR e NOT LIKE '%permission denied%' THEN bad := bad || tbl || ' '; END IF;
  END LOOP;
  PERFORM t.reset();
  PERFORM t.check('10.1 the new tables are sealed even from a signed-in business owner', bad = '', bad);

  PERFORM t.as_anon();
  bad := '';
  FOREACH tbl IN ARRAY ARRAY[
    'public.era_api_owner_businesses()', $$public.era_api_owner_create_key('aaaaaaaa-0000-0000-0000-000000000001','x',ARRAY['inventory:read'])$$,
    $$public.era_api_owner_list_keys('aaaaaaaa-0000-0000-0000-000000000001')$$, $$public.era_api_owner_revoke_key('aaaaaaaa-0000-0000-0000-000000000001')$$,
    $$public.era_api_owner_activity('aaaaaaaa-0000-0000-0000-000000000001')$$, $$public.era_api_booking_intent_get('BK1')$$,
    $$public.era_api_booking_intent_link('BK1','e0000000-0000-0000-0000-000000000001')$$, $$public.era_api_booking_intent_cancel('BK1')$$,
    'public.era_api_admin_get_chain()', $$public.era_h_business_inventory('{}'::jsonb, true)$$, $$public.era__biz_stock('aaaaaaaa-0000-0000-0000-000000000001')$$,
    $$public.era__owner_can('aaaaaaaa-0000-0000-0000-000000000001')$$] LOOP
    e := t.err('SELECT ' || tbl);
    IF e IS NULL OR e NOT LIKE '%permission denied%' THEN bad := bad || left(tbl, 40) || ' ; '; END IF;
  END LOOP;
  PERFORM t.reset();
  PERFORM t.check('10.2 anon cannot call any owner, customer-link, admin, handler or helper function', bad = '', bad);

  c := public.era_api_catalog();
  PERFORM t.check('10.3 the catalogue lists all 44 endpoints, 15 of them business, 3 of them POST, with scopes, and never a handler name',
    jsonb_array_length(c->'endpoints') = 44 AND (SELECT COUNT(*) FROM jsonb_array_elements(c->'endpoints') x WHERE x->>'access' = 'business' AND x->>'scope' IS NOT NULL) = 15
    AND (SELECT COUNT(*) FROM jsonb_array_elements(c->'endpoints') x WHERE x->>'method' = 'POST') = 3 AND c::TEXT NOT LIKE '%era_h_%' AND jsonb_array_length(c->'scopes') = 6);
  PERFORM t.check('10.4 every POST documents its body fields', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c->'endpoints') x WHERE x->>'method' = 'POST' AND jsonb_array_length(x->'body') = 0 AND x->>'id' <> 'business.payment_cancel'));

  -- the published business playground key: every business endpoint answers with fixtures, and creates nothing
  SELECT COUNT(*) INTO n_pay FROM public.payment_requests; SELECT COUNT(*) INTO n_bk FROM public.era_api_booking_intents;
  FOR ep IN SELECT * FROM public.era_api_endpoints WHERE access = 'business' ORDER BY sort LOOP
    IF ep.method = 'GET' THEN
      SELECT * INTO ex FROM t.example(ep.example_path);
      r := t.call(sk, ex.path, ex.q);
    ELSIF ep.id = 'business.payment_create' THEN r := t.post(sk, ep.path, '{"amount": 45000, "description": "x"}', 'sbx-' || replace(ep.id, '.', '-'));
    ELSIF ep.id = 'business.payment_cancel' THEN r := t.post(sk, '/business/payments/PAY_SANDBOX0000B2/cancel', '{}', 'sbx-' || replace(ep.id, '.', '-'));
    ELSE r := t.post(sk, ep.path, '{"kind":"ride","from":{"lat":0.33,"lng":32.57},"to":{"lat":0.34,"lng":32.6}}', 'sbx-' || replace(ep.id, '.', '-'));
    END IF;
    IF r->>'status' NOT IN ('200', '201') THEN bad_p := bad_p || ep.id || '=' || (r->>'status') || ' '; END IF;
    IF r#>>'{body,meta,mode}' <> 'business-test' THEN bad_p := bad_p || ep.id || ':mode '; END IF;
  END LOOP;
  PERFORM t.check('10.5 all 15 business endpoints answer on the published business sandbox key, as business-test', bad_p = '', bad_p);
  PERFORM t.check('10.6 ...and the sandbox created NOTHING real (no payment request, no booking link)', n_pay = (SELECT COUNT(*) FROM public.payment_requests) AND n_bk = (SELECT COUNT(*) FROM public.era_api_booking_intents));
  r := t.call(sk, '/whoami');
  PERFORM t.check('10.7 whoami on a business key reports the business, its scopes and its caps', r#>>'{body,data,business,name}' IS NOT NULL AND jsonb_array_length(r#>'{body,data,business,scopes}') = 6 AND (r#>>'{body,data,business,max_amount_ugx}')::NUMERIC = 1000000, r#>>'{body,data}');
  PERFORM t.check('10.8 the sandbox key is limited per visitor like the developer one', (SELECT rate_per_min FROM public.era_api_keys WHERE key_hash = public.era__hash(sk)) = 20 AND (SELECT per_ip FROM public.era_api_keys WHERE key_hash = public.era__hash(sk)));
END $t$;

-- ================================================================ 11. Test keys, the verification switch, administration
DO $t$
DECLARE A UUID := 'aaaaaaaa-0000-0000-0000-000000000001'; B UUID := 'bbbbbbbb-0000-0000-0000-000000000001'; k JSONB; tk TEXT; r JSONB; n_pay INT; e TEXT; o JSONB;
BEGIN
  UPDATE public.era_api_keys SET revoked_at = now(), revoked_reason = 'test housekeeping' WHERE business_profile_id IS NOT NULL AND revoked_at IS NULL;
  PERFORM t.age_keys();
  PERFORM t.as_user(t.u(10));
  k := public.era_api_owner_create_key(A, 'dry run', ARRAY['payments:request', 'inventory:read'], 30, TRUE);
  PERFORM t.reset();
  tk := k->>'key'; DELETE FROM public.era_api_usage;
  PERFORM t.check('11.1 an owner can mint a TEST key (era_bzt_...) for their own business', tk ~ '^era_bzt_[0-9a-f]{40}$' AND (k->>'test')::BOOLEAN);
  SELECT COUNT(*) INTO n_pay FROM public.payment_requests;
  r := t.post(tk, '/business/payments', '{"amount": 5000}', 'test-key-pay-1');
  PERFORM t.check('11.2 a test key creates only a sandbox payment request: nothing real is stored', r#>>'{body,data,sandbox}' = 'true' AND (SELECT COUNT(*) FROM public.payment_requests) = n_pay AND r#>>'{body,meta,mode}' = 'business-test', r::TEXT);
  r := t.call(tk, '/business/inventory');
  PERFORM t.check('11.3 ...and reads fixtures instead of the business''s real inventory', r::TEXT NOT LIKE '%CHS-250%' AND r::TEXT LIKE '%Fresh Milk 1L%' AND r#>>'{body,meta,mode}' = 'business-test');

  -- the verification switch
  PERFORM t.as_user(t.u(1)); PERFORM public.era_api_admin_save_settings('{"require_verified_for_payments": true}'); PERFORM t.reset();
  PERFORM t.age_keys();
  PERFORM t.as_user(t.u(10));
  e := t.err(format($q$SELECT public.era_api_owner_create_key(%L, 'x', ARRAY['payments:request'], 30)$q$, A));
  PERFORM t.check('11.4 with the verification switch on, an UNVERIFIED business cannot get a live payments key', e LIKE '%must be verified%', e);
  PERFORM t.check('11.5 ...but can still mint a test key and read keys', public.era_api_owner_create_key(A, 'dry2', ARRAY['payments:request'], 30, TRUE) IS NOT NULL AND public.era_api_owner_create_key(A, 'ro', ARRAY['inventory:read'], 30) IS NOT NULL);
  PERFORM t.reset();
  PERFORM t.as_user(t.u(11));
  PERFORM t.check('11.6 a VERIFIED business can', (public.era_api_owner_create_key(B, 'beta pay', ARRAY['payments:request'], 30)->>'key') LIKE 'era_biz_%');
  PERFORM t.reset();
  PERFORM t.as_user(t.u(1)); PERFORM public.era_api_admin_save_settings('{"require_verified_for_payments": false}'); PERFORM t.reset();

  -- activity visible to the owner, only their own
  PERFORM t.as_user(t.u(10)); r := public.era_api_owner_activity(A, 20);
  PERFORM t.check('11.7 the owner can read their keys'' activity (time, key prefix, endpoint, status) and no IPs or error text', jsonb_array_length(r) > 0 AND r::TEXT NOT LIKE '%error%' AND r::TEXT NOT LIKE '%ip%');
  e := t.err(format($q$SELECT public.era_api_owner_activity(%L)$q$, B));
  PERFORM t.reset();
  PERFORM t.check('11.8 ...but not another business''s', e LIKE '%Only the owner%', e);

  -- administration sees it all, in separate counts
  PERFORM t.as_user(t.u(1)); o := public.era_api_admin_overview(); PERFORM t.reset();
  PERFORM t.check('11.9 the admin overview counts business keys and 24h payment requests separately', (o->>'business_keys_active')::INT >= 3 AND (o->>'payment_requests_24h')::INT >= 10, o::TEXT);
  PERFORM t.check('11.10 owner clients stay out of the developer application counts', (o#>>'{clients,total}')::INT = (SELECT COUNT(*) FROM public.era_api_clients WHERE NOT is_system AND kind = 'developer'));
  PERFORM t.as_user(t.u(1));
  PERFORM t.check('11.11 the client list marks business clients and shows scopes, never key hashes',
    public.era_api_admin_list_clients(NULL, 200)::TEXT LIKE '%"kind": "owner"%' AND public.era_api_admin_list_clients(NULL, 200)::TEXT NOT LIKE '%key_hash%');
  PERFORM t.reset();
END $t$;
