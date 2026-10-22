-- People, a business with a CMMS company, riders with ID cards, wallets.
\set ON_ERROR_STOP on

-- users: 1 owner, 2 gate guard, 3 viewer, 4 manager, 5 stranger, 6 cmms admin, 9 platform owner, 11-20 riders
INSERT INTO auth.users SELECT t.u(n) FROM generate_series(1, 20) n;

INSERT INTO public.business_profiles VALUES (t.u(100), t.u(1), 'Kololo Heights Estate'), (t.u(900), t.u(9), 'ICANera');
INSERT INTO public.ican_platform_fee_recipient VALUES (true, t.u(900));
INSERT INTO public.cmms_company_profiles VALUES (t.u(200), t.u(100));

INSERT INTO public.cmms_users (id, cmms_company_id, email, user_name, role) VALUES
  (t.u(302), t.u(200), 'guard@x.test',   'Guard',   'security'),
  (t.u(303), t.u(200), 'viewer@x.test',  'Viewer',  'auditor'),
  (t.u(304), t.u(200), 'manager@x.test', 'Manager', 'coordinator'),
  (t.u(305), t.u(200), 'admin@x.test',   'Admin',   'admin');
INSERT INTO public.cmms_roles VALUES
  (t.u(401), 'security',    '{"transport": {"gate": true}}', true),
  (t.u(402), 'auditor',     '{"transport": {"view": true}}', true),
  (t.u(403), 'coordinator', '{"transport": {"edit": true, "assign": true}}', true),
  (t.u(404), 'admin',       '{}', true);
INSERT INTO public.cmms_user_roles VALUES
  (t.u(302), t.u(401), true), (t.u(303), t.u(402), true), (t.u(304), t.u(403), true), (t.u(305), t.u(404), true);

-- riders: 11 motorcycle, 12 car, 13 truck, 14 bicycle, 15 motorcycle, 16 motorcycle (poor), 17 unpaid card, 18 expired card,
--         19 suspended rider, 20 revoked card, 21 motorcycle with an expired driving permit
INSERT INTO public.mbg_riders (id, user_id, vehicle_type, plate_number, vehicle_model, status, license_expiry) VALUES
  (t.u(1011), t.u(11), 'motorcycle', 'UAB 123X', 'Bajaj Boxer', 'active', current_date + 400),
  (t.u(1012), t.u(12), 'car',        'UBC 456Y', 'Toyota Premio', 'active', current_date + 400),
  (t.u(1013), t.u(13), 'truck',      'UCD 789Z', 'Isuzu FRR', 'active', current_date + 400),
  (t.u(1014), t.u(14), 'bicycle',    'BIKE-14', NULL, 'active', NULL),
  (t.u(1015), t.u(15), 'motorcycle', 'UEF 111A', 'TVS', 'active', current_date + 400),
  (t.u(1016), t.u(16), 'motorcycle', 'UGH 222B', 'TVS', 'active', current_date + 400),
  (t.u(1017), t.u(17), 'motorcycle', 'UJK 333C', 'TVS', 'active', current_date + 400),
  (t.u(1018), t.u(18), 'motorcycle', 'ULM 444D', 'TVS', 'active', current_date + 400),
  (t.u(1019), t.u(19), 'motorcycle', 'UNP 555E', 'TVS', 'suspended', current_date + 400),
  (t.u(1020), t.u(20), 'motorcycle', 'UQR 666F', 'TVS', 'active', current_date + 400),
  (t.u(1021), t.u(21), 'motorcycle', 'UST 777G', 'TVS', 'active', current_date - 5);

CREATE FUNCTION t.code(n INT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$ SELECT 'RIDERCODE' || lpad(n::TEXT, 12, '0') $$;
GRANT EXECUTE ON FUNCTION t.code(INT) TO PUBLIC;

INSERT INTO public.mbg_rider_cards (rider_id, rider_user_id, card_number, verify_code, status, expires_at)
SELECT t.u(1000 + n), t.u(n), 'ICN-' || n, t.code(n),
       CASE n WHEN 17 THEN 'pending_payment' WHEN 20 THEN 'revoked' ELSE 'active' END,
       CASE n WHEN 18 THEN now() - INTERVAL '2 days' ELSE now() + INTERVAL '300 days' END
  FROM generate_series(11, 21) n;

INSERT INTO public.ican_user_wallets SELECT t.u(n), 10 FROM generate_series(11, 21) n;
UPDATE public.ican_user_wallets SET ican_balance = 0.1 WHERE user_id = t.u(16);

-- customers 31-35 (user ids 31-35), each with a wallet; customer 33 cannot cover a fee
INSERT INTO auth.users SELECT t.u(n) FROM generate_series(31, 35) n;
INSERT INTO public.mbg_customers SELECT t.u(500 + n), t.u(n) FROM generate_series(31, 35) n;
INSERT INTO public.ican_user_wallets SELECT t.u(n), 10 FROM generate_series(31, 35) n;
UPDATE public.ican_user_wallets SET ican_balance = 0.1 WHERE user_id = t.u(33);

-- a ride for customer c with rider r: from (a, b) to (c, d)
CREATE FUNCTION t.ride(p_customer INT, p_rider INT, p_plat NUMERIC, p_plng NUMERIC, p_dlat NUMERIC, p_dlng NUMERIC, p_status TEXT, p_pay TEXT)
RETURNS UUID LANGUAGE sql AS $$
  INSERT INTO public.mbg_rides (customer_id, rider_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, status, payment_method)
  VALUES (t.u(500 + p_customer), t.u(1000 + p_rider), p_plat, p_plng, p_dlat, p_dlng, p_status, p_pay) RETURNING id $$;
GRANT EXECUTE ON FUNCTION t.ride(INT, INT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) TO PUBLIC;
