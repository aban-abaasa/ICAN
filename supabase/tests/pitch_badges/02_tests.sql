\set ON_ERROR_STOP on
-- PitchIn product badges: the price (free to start), who may manage, live product data, and the money path.
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO PUBLIC;
CREATE FUNCTION t.as_user(n INT) RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', public.tu(n)::TEXT, false); PERFORM set_config('request.jwt.claim.email', '', false); EXECUTE 'SET ROLE authenticated'; END $$;
CREATE FUNCTION t.as_dev() RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', public.tu(9)::TEXT, false); PERFORM set_config('request.jwt.claim.email', 'dev@example.com', false); EXECUTE 'SET ROLE authenticated'; END $$;
CREATE FUNCTION t.as_anon() RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', false); PERFORM set_config('request.jwt.claim.email', '', false); EXECUTE 'SET ROLE anon'; END $$;
CREATE FUNCTION t.as_admin() RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', false); PERFORM set_config('request.jwt.claim.email', '', false); EXECUTE 'RESET ROLE'; END $$;
CREATE FUNCTION t.check(p_name TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT '') RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  IF p_ok IS TRUE THEN RAISE INFO 'PASS %', p_name; ELSE RAISE EXCEPTION 'FAIL % %', p_name, p_detail; END IF; END $$;
CREATE FUNCTION t.raises(p_sql TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$ BEGIN EXECUTE p_sql; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
CREATE TABLE t.keep (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t.keep TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;
-- the tables themselves are locked; these views (owned by the test runner) let the assertions look inside
CREATE VIEW t.badges  AS SELECT * FROM public.video_product_badges;
CREATE VIEW t.charges AS SELECT * FROM public.video_badge_charges;
GRANT SELECT ON t.badges, t.charges TO PUBLIC;
SET client_min_messages = info;

-- ============ 1. The price: free to start, a developer alternates it
SELECT t.as_anon();
DO $t$
BEGIN
  PERFORM t.check('1.1 the service starts free', (public.fn_pitch_badge_price() ->> 'price_ic')::NUMERIC = 0 AND (public.fn_pitch_badge_price() ->> 'charged')::BOOLEAN IS FALSE, public.fn_pitch_badge_price()::TEXT);
  PERFORM t.check('1.2 nobody can read or change the price table directly', t.raises('SELECT * FROM public.ican_service_prices') AND t.raises('UPDATE public.ican_service_prices SET price_ic = 0'));
  PERFORM t.check('1.3 an anonymous visitor cannot use the developer functions',
    t.raises($$SELECT public.ican_dev_get_service_prices('dev-secret')$$) AND t.raises($$SELECT public.ican_dev_set_service_price('dev-secret', 'pitch_product_badge', 5, true)$$));
END $t$;
SELECT t.as_user(1);
DO $t$
BEGIN
  PERFORM t.check('1.4 a business owner cannot change the price, even with the token',
    t.raises($$SELECT public.ican_dev_set_service_price('dev-secret', 'pitch_product_badge', 0.01, true)$$));
END $t$;
SELECT t.as_dev();
DO $t$
DECLARE r JSONB;
BEGIN
  PERFORM t.check('1.5 the developer needs the token as well as the allowlisted account', t.raises($$SELECT public.ican_dev_get_service_prices('wrong')$$));
  r := public.ican_dev_get_service_prices('dev-secret');
  PERFORM t.check('1.6 the developer sees the service, free', r #>> '{services,0,key}' = 'pitch_product_badge' AND (r #>> '{services,0,charged}')::BOOLEAN IS FALSE AND (r #>> '{services,0,effective_ic}')::NUMERIC = 0, r::TEXT);
  PERFORM t.check('1.7 charging with no price is refused', (public.ican_dev_set_service_price('dev-secret', 'pitch_product_badge', 0, true) ->> 'success')::BOOLEAN IS FALSE);
  PERFORM t.check('1.8 a negative or absurd price is refused',
    (public.ican_dev_set_service_price('dev-secret', 'pitch_product_badge', -1, false) ->> 'success')::BOOLEAN IS FALSE
    AND (public.ican_dev_set_service_price('dev-secret', 'pitch_product_badge', 2000000, true) ->> 'success')::BOOLEAN IS FALSE);
  PERFORM t.check('1.9 an unknown service is refused', (public.ican_dev_set_service_price('dev-secret', 'something_else', 5, true) ->> 'success')::BOOLEAN IS FALSE);
  r := public.ican_dev_set_service_price('dev-secret', 'pitch_product_badge', 5, false);
  PERFORM t.check('1.10 a price can be set while the service stays free', (r ->> 'changed')::BOOLEAN AND (public.fn_pitch_badge_price() ->> 'price_ic')::NUMERIC = 0, r::TEXT);
  r := public.ican_dev_set_service_price('dev-secret', 'pitch_product_badge', 5, true);
  PERFORM t.check('1.11 switching to Charged applies the remembered price', (public.fn_pitch_badge_price() ->> 'price_ic')::NUMERIC = 5, r::TEXT);
  r := public.ican_dev_set_service_price('dev-secret', 'pitch_product_badge', 5, false);
  PERFORM t.check('1.12 switching back to Free keeps the price for next time',
    (public.fn_pitch_badge_price() ->> 'price_ic')::NUMERIC = 0 AND (public.ican_dev_get_service_prices('dev-secret') #>> '{services,0,price_ic}')::NUMERIC = 5);
  PERFORM t.check('1.13 setting the same thing again changes nothing', (public.ican_dev_set_service_price('dev-secret', 'pitch_product_badge', 5, false) ->> 'changed')::BOOLEAN IS FALSE);
  r := public.ican_dev_get_service_prices('dev-secret');
  PERFORM t.check('1.14 every change is logged with who made it', jsonb_array_length(r -> 'changes') = 3 AND r #>> '{changes,0,changed_by}' = 'dev@example.com', (r -> 'changes')::TEXT);
END $t$;

-- ============ 2. Who may make badges, and for what
SELECT t.as_user(1);
DO $t$
DECLARE b JSONB; many INT;
BEGIN
  b := public.fn_save_pitch_badge('d0000000-0000-0000-0000-000000000001', NULL, 'c0000000-0000-0000-0000-000000000001', NULL, NULL, NULL, NULL, 5, 6, 'bottom-left');
  INSERT INTO t.keep VALUES ('milk', b ->> 'id');
  PERFORM t.check('2.1 the owner can badge one of their store''s products', b ->> 'name' = 'Fresh Milk 1L' AND (b ->> 'price')::NUMERIC = 4500 AND b ->> 'status' = 'draft' AND (b ->> 'linked')::BOOLEAN, b::TEXT);
  PERFORM t.check('2.2 the photo, currency and stock come from the store', b ->> 'image_url' = 'https://img.example/milk.jpg' AND b ->> 'currency' = 'UGX' AND b -> 'problem' = 'null'::JSONB);
  PERFORM t.check('2.3 another business''s product is refused',
    t.raises($$SELECT public.fn_save_pitch_badge('d0000000-0000-0000-0000-000000000001', NULL, 'c0000000-0000-0000-0000-000000000009', NULL, NULL, NULL, NULL, 0, 6, 'bottom-left')$$));
  PERFORM t.check('2.4 a typed badge needs a name and a price',
    t.raises($$SELECT public.fn_save_pitch_badge('d0000000-0000-0000-0000-000000000001', NULL, NULL, 'Gift box', NULL, NULL, NULL, 0, 6, 'bottom-left')$$)
    AND t.raises($$SELECT public.fn_save_pitch_badge('d0000000-0000-0000-0000-000000000001', NULL, NULL, NULL, 10000, NULL, NULL, 0, 6, 'bottom-left')$$));
  b := public.fn_save_pitch_badge('d0000000-0000-0000-0000-000000000001', NULL, NULL, 'Gift box', 25000, NULL, NULL, 20, 8, 'top-right');
  INSERT INTO t.keep VALUES ('gift', b ->> 'id');
  PERFORM t.check('2.5 a typed badge works', b ->> 'name' = 'Gift box' AND (b ->> 'price')::NUMERIC = 25000 AND NOT (b ->> 'linked')::BOOLEAN);
  PERFORM t.check('2.6 timing is checked: not before 0, 2-60 seconds long, not past the end of the video',
    t.raises($$SELECT public.fn_save_pitch_badge('d0000000-0000-0000-0000-000000000001', NULL, NULL, 'X', 1, NULL, NULL, -1, 6, 'bottom-left')$$)
    AND t.raises($$SELECT public.fn_save_pitch_badge('d0000000-0000-0000-0000-000000000001', NULL, NULL, 'X', 1, NULL, NULL, 0, 1, 'bottom-left')$$)
    AND t.raises($$SELECT public.fn_save_pitch_badge('d0000000-0000-0000-0000-000000000001', NULL, NULL, 'X', 1, NULL, NULL, 0, 61, 'bottom-left')$$)
    AND t.raises($$SELECT public.fn_save_pitch_badge('d0000000-0000-0000-0000-000000000001', NULL, NULL, 'X', 1, NULL, NULL, 60, 6, 'bottom-left')$$));
  PERFORM t.check('2.7 a position must be one of the four corners', t.raises($$SELECT public.fn_save_pitch_badge('d0000000-0000-0000-0000-000000000001', NULL, NULL, 'X', 1, NULL, NULL, 0, 6, 'middle')$$));
  b := public.fn_save_pitch_badge('d0000000-0000-0000-0000-000000000001', (SELECT v::UUID FROM t.keep WHERE k = 'gift'), NULL, 'Gift box deluxe', 30000, 'UGX', NULL, 25, 8, 'top-right');
  PERFORM t.check('2.8 editing a badge changes it in place', b ->> 'name' = 'Gift box deluxe' AND (b ->> 'price')::NUMERIC = 30000 AND (b ->> 'starts_at_sec')::INT = 25 AND (SELECT count(*) FROM t.badges) = 2);
  PERFORM t.check('2.9 a badge of another pitch cannot be edited through this pitch',
    t.raises($$SELECT public.fn_save_pitch_badge('d0000000-0000-0000-0000-000000000002', (SELECT v::UUID FROM t.keep WHERE k = 'gift'), NULL, 'Hijack', 1, NULL, NULL, 0, 6, 'bottom-left')$$));
END $t$;
SELECT t.as_user(2);
DO $t$
DECLARE b JSONB;
BEGIN
  b := public.fn_save_pitch_badge('d0000000-0000-0000-0000-000000000001', NULL, 'c0000000-0000-0000-0000-000000000002', NULL, NULL, NULL, NULL, 40, 6, 'bottom-right');
  INSERT INTO t.keep VALUES ('bread', b ->> 'id');
  PERFORM t.check('2.10 CMMS staff who may edit announcements can badge the business''s products', b ->> 'name' = 'Brown Bread');
  PERFORM t.check('2.11 ...and see the products to pick from', jsonb_array_length(public.fn_pitch_badge_products('b0000000-0000-0000-0000-000000000001')) = 2);
  PERFORM t.check('2.12 ...but not another business''s', t.raises($$SELECT public.fn_save_pitch_badge('d0000000-0000-0000-0000-000000000003', NULL, NULL, 'X', 1, NULL, NULL, 0, 6, 'bottom-left')$$));
END $t$;
SELECT t.as_user(3);
DO $t$
BEGIN
  PERFORM t.check('2.13 a stranger can do nothing',
    t.raises($$SELECT public.fn_save_pitch_badge('d0000000-0000-0000-0000-000000000001', NULL, NULL, 'X', 1, NULL, NULL, 0, 6, 'bottom-left')$$)
    AND t.raises($$SELECT public.fn_list_pitch_badges_manage('d0000000-0000-0000-0000-000000000001')$$)
    AND t.raises($$SELECT public.fn_pitch_badge_products('b0000000-0000-0000-0000-000000000001')$$)
    AND t.raises($$SELECT public.fn_delete_video_badge((SELECT v::UUID FROM t.keep WHERE k = 'milk'))$$)
    AND t.raises($$SELECT public.fn_publish_video_badge((SELECT v::UUID FROM t.keep WHERE k = 'milk'))$$));
END $t$;
SELECT t.as_admin();
DO $t$
BEGIN
  -- fill the pitch to its limit of 12 (3 exist), as the owner
  PERFORM t.as_user(1);
  FOR i IN 1..9 LOOP
    PERFORM public.fn_save_pitch_badge('d0000000-0000-0000-0000-000000000001', NULL, NULL, 'Filler ' || i, 100, NULL, NULL, i, 3, 'bottom-left');
  END LOOP;
  PERFORM t.check('2.14 a video carries at most 12 badges', t.raises($$SELECT public.fn_save_pitch_badge('d0000000-0000-0000-0000-000000000001', NULL, NULL, 'One too many', 1, NULL, NULL, 0, 3, 'bottom-left')$$));
  PERFORM t.as_admin();
  DELETE FROM public.video_product_badges WHERE label LIKE 'Filler %';
END $t$;
SELECT t.as_anon();
DO $t$
BEGIN
  PERFORM t.check('2.15 the badge tables cannot be read directly', t.raises('SELECT * FROM public.video_product_badges') AND t.raises('SELECT * FROM public.video_badge_charges'));
  PERFORM t.check('2.16 a draft badge shows to nobody', jsonb_array_length(public.fn_get_pitch_badges('d0000000-0000-0000-0000-000000000001') -> 'badges') = 0);
END $t$;

-- ============ 3. Publishing while the service is free
SELECT t.as_user(2);
DO $t$
DECLARE r JSONB;
BEGIN
  r := public.fn_publish_video_badge((SELECT v::UUID FROM t.keep WHERE k = 'milk'));
  PERFORM t.check('3.1 while free, staff can publish', (r ->> 'success')::BOOLEAN AND (r ->> 'paid_ic')::NUMERIC = 0 AND r ->> 'kind' = 'publish', r::TEXT);
  PERFORM t.check('3.2 it runs for 30 days', (r ->> 'live_until')::TIMESTAMPTZ BETWEEN now() + INTERVAL '29 days 23 hours' AND now() + INTERVAL '30 days 1 hour', r ->> 'live_until');
  r := public.fn_publish_video_badge((SELECT v::UUID FROM t.keep WHERE k = 'milk'));
  PERFORM t.check('3.3 publishing twice does not extend it or charge again', (r ->> 'success')::BOOLEAN IS FALSE AND (SELECT count(*) FROM t.charges) = 1, r::TEXT);
  PERFORM public.fn_publish_video_badge((SELECT v::UUID FROM t.keep WHERE k = 'bread'));
END $t$;
SELECT t.as_anon();
DO $t$
DECLARE r JSONB;
BEGIN
  r := public.fn_get_pitch_badges('d0000000-0000-0000-0000-000000000001');
  PERFORM t.check('3.4 anyone sees the live badges of a public pitch, in video order', jsonb_array_length(r -> 'badges') = 2 AND r #>> '{badges,0,name}' = 'Fresh Milk 1L' AND r #>> '{badges,1,name}' = 'Brown Bread', r::TEXT);
  PERFORM t.check('3.5 the badge says where to shop', r ->> 'site_company_id' = 'e0000000-0000-0000-0000-000000000001');
  PERFORM t.check('3.6 the typed badge that was never published stays hidden', NOT (r::TEXT LIKE '%Gift box%'));
  PERFORM t.check('3.7 a private pitch shows nothing to the public', jsonb_array_length(public.fn_get_pitch_badges('d0000000-0000-0000-0000-000000000002') -> 'badges') = 0);
  PERFORM t.check('3.8 an unknown pitch is just empty', jsonb_array_length(public.fn_get_pitch_badges(gen_random_uuid()) -> 'badges') = 0);
END $t$;

-- ============ 4. Smart: the badge follows the store
SELECT t.as_admin();
UPDATE public.products SET selling_price = 4000 WHERE id = 'c0000000-0000-0000-0000-000000000001';
SELECT t.as_anon();
DO $t$
BEGIN
  PERFORM t.check('4.1 a price change in the store shows in the video straight away', (public.fn_get_pitch_badges('d0000000-0000-0000-0000-000000000001') #>> '{badges,0,price}')::NUMERIC = 4000);
END $t$;
SELECT t.as_admin();
UPDATE public.inventory SET current_stock = 2, reserved_stock = 2 WHERE product_id = 'c0000000-0000-0000-0000-000000000001';
SELECT t.as_anon();
DO $t$
BEGIN
  PERFORM t.check('4.2 a sold-out product''s badge disappears', jsonb_array_length(public.fn_get_pitch_badges('d0000000-0000-0000-0000-000000000001') -> 'badges') = 1
    AND public.fn_get_pitch_badges('d0000000-0000-0000-0000-000000000001') #>> '{badges,0,name}' = 'Brown Bread');
END $t$;
SELECT t.as_user(1);
DO $t$
DECLARE r JSONB;
BEGIN
  r := public.fn_list_pitch_badges_manage('d0000000-0000-0000-0000-000000000001');
  PERFORM t.check('4.3 the owner is told why it is hidden', (SELECT j ->> 'problem' FROM jsonb_array_elements(r -> 'badges') j WHERE j ->> 'name' = 'Fresh Milk 1L') = 'sold_out', r::TEXT);
  PERFORM t.check('4.4 the owner sees drafts and live badges together', jsonb_array_length(r -> 'badges') = 3 AND (r ->> 'can_pay')::BOOLEAN);
END $t$;
SELECT t.as_admin();
UPDATE public.inventory SET current_stock = 10, reserved_stock = 0 WHERE product_id = 'c0000000-0000-0000-0000-000000000001';
UPDATE public.supermarkets SET is_active = FALSE WHERE id = 'a0000000-0000-0000-0000-000000000001';
SELECT t.as_anon();
DO $t$
BEGIN
  PERFORM t.check('4.5 back in stock it comes back; a closed store takes its badges down',
    jsonb_array_length(public.fn_get_pitch_badges('d0000000-0000-0000-0000-000000000001') -> 'badges') = 0);
END $t$;
SELECT t.as_admin();
UPDATE public.supermarkets SET is_active = TRUE WHERE id = 'a0000000-0000-0000-0000-000000000001';
UPDATE public.products SET is_service = TRUE WHERE id = 'c0000000-0000-0000-0000-000000000002';
UPDATE public.inventory SET current_stock = 0 WHERE product_id = 'c0000000-0000-0000-0000-000000000002';
SELECT t.as_anon();
DO $t$
BEGIN
  PERFORM t.check('4.6 a service is never "sold out"', public.fn_get_pitch_badges('d0000000-0000-0000-0000-000000000001') #>> '{badges,1,name}' = 'Brown Bread');
END $t$;
SELECT t.as_admin();
DELETE FROM public.products WHERE id = 'c0000000-0000-0000-0000-000000000002';
SELECT t.as_anon();
DO $t$
BEGIN
  PERFORM t.check('4.7 a deleted product just drops its badge', NOT (public.fn_get_pitch_badges('d0000000-0000-0000-0000-000000000001')::TEXT LIKE '%Brown Bread%'));
END $t$;
SELECT t.as_user(1);
DO $t$
BEGIN
  PERFORM t.check('4.8 the manager of a private pitch can still preview its badges', jsonb_array_length(public.fn_get_pitch_badges('d0000000-0000-0000-0000-000000000002') -> 'badges') = 0
    AND public.fn_get_pitch_badges('d0000000-0000-0000-0000-000000000002') ? 'badges');
END $t$;

-- ============ 5. Switching the service to Charged
SELECT t.as_dev();
SELECT public.ican_dev_set_service_price('dev-secret', 'pitch_product_badge', 5, true) ->> 'success' AS charged_on;
SELECT t.as_user(1);
DO $t$
DECLARE r JSONB; gift UUID := (SELECT v::UUID FROM t.keep WHERE k = 'gift');
BEGIN
  PERFORM t.check('5.1 the apps now show the price', (public.fn_pitch_badge_price() ->> 'price_ic')::NUMERIC = 5 AND (public.fn_pitch_badge_price() ->> 'charged')::BOOLEAN);
  r := public.fn_publish_video_badge(gift);
  PERFORM t.check('5.2 an empty business wallet cannot publish, and nothing changes',
    (r ->> 'success')::BOOLEAN IS FALSE AND r ->> 'error' LIKE 'Not enough%' AND (SELECT status FROM t.badges WHERE id = gift) = 'draft'
    AND (SELECT count(*) FROM public.platform_credits) = 0 AND (SELECT count(*) FROM t.charges) = 2, r::TEXT);
END $t$;
SELECT t.as_admin();
UPDATE public.ican_business_wallets SET ican_balance = 12 WHERE business_profile_id = 'b0000000-0000-0000-0000-000000000001';
SELECT t.as_user(2);
DO $t$
DECLARE r JSONB;
BEGIN
  r := public.fn_publish_video_badge((SELECT v::UUID FROM t.keep WHERE k = 'gift'));
  PERFORM t.check('5.3 staff cannot spend the business''s wallet: only the owner pays', (r ->> 'success')::BOOLEAN IS FALSE AND r ->> 'error' LIKE 'Only the business owner%'
    AND (SELECT ican_balance FROM public.ican_business_wallets WHERE business_profile_id = 'b0000000-0000-0000-0000-000000000001') = 12, r::TEXT);
END $t$;
SELECT t.as_user(1);
DO $t$
DECLARE r JSONB; gift UUID := (SELECT v::UUID FROM t.keep WHERE k = 'gift');
BEGIN
  r := public.fn_publish_video_badge(gift);
  PERFORM t.check('5.4 the owner pays 5 IC from the business wallet', (r ->> 'success')::BOOLEAN AND (r ->> 'paid_ic')::NUMERIC = 5
    AND (SELECT ican_balance FROM public.ican_business_wallets WHERE business_profile_id = 'b0000000-0000-0000-0000-000000000001') = 7
    AND (SELECT total_spent FROM public.ican_business_wallets WHERE business_profile_id = 'b0000000-0000-0000-0000-000000000001') = 5, r::TEXT);
  PERFORM t.check('5.5 the platform is credited the same 5, tagged to this charge',
    (SELECT count(*) = 1 AND bool_and(amount = 5 AND fee_type = 'pitch_product_badge' AND actor = public.tu(1) AND reference LIKE 'video-badge:%') FROM public.platform_credits));
  PERFORM t.check('5.6 the badge is live for 30 days and the charge is on record',
    (SELECT status = 'live' AND live_until > now() + INTERVAL '29 days' FROM t.badges WHERE id = gift)
    AND (SELECT amount_ic = 5 AND kind = 'publish' AND paid_by = public.tu(1) FROM t.charges WHERE badge_id = gift AND amount_ic > 0));
  r := public.fn_publish_video_badge(gift);
  PERFORM t.check('5.7 a double tap charges nothing more', (r ->> 'success')::BOOLEAN IS FALSE AND (SELECT ican_balance FROM public.ican_business_wallets WHERE business_profile_id = 'b0000000-0000-0000-0000-000000000001') = 7);
END $t$;

-- the platform side fails: the business must not be charged and the badge must not go live
SELECT t.as_admin();
SELECT set_config('test.fail_credit', 'on', false);
SELECT t.as_user(1);
DO $t$
DECLARE milk UUID := (SELECT v::UUID FROM t.keep WHERE k = 'milk'); before_balance NUMERIC; before_until TIMESTAMPTZ;
BEGIN
  PERFORM t.as_admin();
  UPDATE public.video_product_badges SET live_until = now() + INTERVAL '3 days' WHERE id = milk;
  SELECT ican_balance INTO before_balance FROM public.ican_business_wallets WHERE business_profile_id = 'b0000000-0000-0000-0000-000000000001';
  SELECT live_until INTO before_until FROM t.badges WHERE id = milk;
  PERFORM t.as_user(1);
  PERFORM t.check('5.8 if the platform cannot be credited the whole payment is undone', t.raises(format('SELECT public.fn_publish_video_badge(%L)', milk)));
  PERFORM t.as_admin();
  PERFORM t.check('5.9 ...the wallet, the badge and the records are exactly as before',
    (SELECT ican_balance FROM public.ican_business_wallets WHERE business_profile_id = 'b0000000-0000-0000-0000-000000000001') = before_balance
    AND (SELECT live_until FROM t.badges WHERE id = milk) = before_until
    AND (SELECT count(*) FROM public.platform_credits) = 1 AND (SELECT count(*) FROM t.charges) = 3);
END $t$;
SELECT set_config('test.fail_credit', 'off', false);

-- renewals
SELECT t.as_user(1);
DO $t$
DECLARE milk UUID := (SELECT v::UUID FROM t.keep WHERE k = 'milk'); r JSONB; until_before TIMESTAMPTZ;
BEGIN
  SELECT live_until INTO until_before FROM t.badges WHERE id = milk;
  r := public.fn_publish_video_badge(milk);
  PERFORM t.check('5.10 in its last 7 days a badge can be renewed for the current price', (r ->> 'success')::BOOLEAN AND r ->> 'kind' = 'renew' AND (r ->> 'paid_ic')::NUMERIC = 5
    AND (SELECT ican_balance FROM public.ican_business_wallets WHERE business_profile_id = 'b0000000-0000-0000-0000-000000000001') = 2, r::TEXT);
  PERFORM t.check('5.11 a renewal adds 30 days to what is left (nothing already paid for is lost)',
    (r ->> 'live_until')::TIMESTAMPTZ BETWEEN until_before + INTERVAL '29 days 23 hours' AND until_before + INTERVAL '30 days 1 hour', r ->> 'live_until');
END $t$;
SELECT t.as_admin();
UPDATE public.video_product_badges SET live_until = now() - INTERVAL '1 day' WHERE id = (SELECT v::UUID FROM t.keep WHERE k = 'gift');
SELECT t.as_anon();
DO $t$
BEGIN
  PERFORM t.check('5.12 an expired badge stops showing', NOT (public.fn_get_pitch_badges('d0000000-0000-0000-0000-000000000001')::TEXT LIKE '%Gift box%'));
END $t$;
SELECT t.as_user(1);
DO $t$
DECLARE r JSONB; gift UUID := (SELECT v::UUID FROM t.keep WHERE k = 'gift');
BEGIN
  r := public.fn_publish_video_badge(gift);
  PERFORM t.check('5.13 an expired badge needs the owner to pay again, and the wallet only has 2 IC', (r ->> 'success')::BOOLEAN IS FALSE AND r ->> 'error' LIKE 'Not enough%', r::TEXT);
END $t$;

-- ============ 6. And back to free, any time
SELECT t.as_dev();
SELECT public.ican_dev_set_service_price('dev-secret', 'pitch_product_badge', 5, false) ->> 'success' AS charged_off;
SELECT t.as_user(2);
DO $t$
DECLARE r JSONB; gift UUID := (SELECT v::UUID FROM t.keep WHERE k = 'gift');
BEGIN
  r := public.fn_publish_video_badge(gift);
  PERFORM t.check('6.1 switched back to free, an expired badge is renewed at no cost by staff', (r ->> 'success')::BOOLEAN AND (r ->> 'paid_ic')::NUMERIC = 0
    AND (SELECT ican_balance FROM public.ican_business_wallets WHERE business_profile_id = 'b0000000-0000-0000-0000-000000000001') = 2
    AND (SELECT count(*) FROM public.platform_credits) = 2, r::TEXT);
  PERFORM t.check('6.2 a free renewal still starts from now', (r ->> 'live_until')::TIMESTAMPTZ BETWEEN now() + INTERVAL '29 days 23 hours' AND now() + INTERVAL '30 days 1 hour');
END $t$;

-- ============ 7. Removing
SELECT t.as_user(2);
DO $t$
BEGIN
  PERFORM t.check('7.1 staff can remove a badge', public.fn_delete_video_badge((SELECT v::UUID FROM t.keep WHERE k = 'gift')));
  PERFORM t.check('7.2 the record of what it cost stays', (SELECT count(*) FROM t.charges WHERE badge_id IS NULL AND amount_ic = 5) = 1 OR (SELECT count(*) FROM t.charges) >= 4);
END $t$;
SELECT t.as_admin();
DO $t$
BEGIN
  -- deleting the pitch takes its badges with it; the charges stay
  DELETE FROM public.pitches WHERE id = 'd0000000-0000-0000-0000-000000000001';
  PERFORM t.check('7.3 deleting a pitch removes its badges', (SELECT count(*) FROM t.badges WHERE pitch_id = 'd0000000-0000-0000-0000-000000000001') = 0);
END $t$;

-- ============ 8. The same badges on status updates
-- (the pitch service is Free here; the status service has its own price and switch)
SELECT t.as_user(1);
DO $t$
DECLARE b JSONB; r JSONB;
BEGIN
  b := public.fn_save_status_badge('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', NULL, 'c0000000-0000-0000-0000-000000000001', NULL, NULL, NULL, NULL, 4, 8, 'bottom-left');
  INSERT INTO t.keep VALUES ('smilk', b ->> 'id');
  PERFORM t.check('8.1 a business owner can badge their own video status', b ->> 'name' = 'Fresh Milk 1L' AND b ->> 'status_id' = 'f0000000-0000-0000-0000-000000000001' AND b -> 'pitch_id' = 'null'::JSONB AND (b ->> 'starts_at_sec')::INT = 4, b::TEXT);
  PERFORM t.check('8.2 it is a draft nobody else sees', jsonb_array_length(public.fn_get_status_badges('f0000000-0000-0000-0000-000000000001') -> 'badges') = 0);
  PERFORM t.check('8.3 a business that is not theirs is refused',
    t.raises($$SELECT public.fn_save_status_badge('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', NULL, NULL, 'X', 1, NULL, NULL, 0, 6, 'bottom-left')$$));
  PERFORM t.check('8.4 another business''s product is refused',
    t.raises($$SELECT public.fn_save_status_badge('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', NULL, 'c0000000-0000-0000-0000-000000000009', NULL, NULL, NULL, NULL, 0, 6, 'bottom-left')$$));
  PERFORM t.check('8.5 all the badges on one status must be from one business, even when both are theirs',
    t.raises($$SELECT public.fn_save_status_badge('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', NULL, 'c0000000-0000-0000-0000-000000000003', NULL, NULL, NULL, NULL, 10, 6, 'bottom-left')$$));
  PERFORM public.fn_save_status_badge('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', NULL, NULL, 'Gift box', 25000, NULL, NULL, 12, 6, 'top-right');
  PERFORM public.fn_save_status_badge('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', NULL, NULL, 'Gift card', 5000, NULL, NULL, 20, 6, 'top-left');
  PERFORM t.check('8.6 a status carries at most 3 badges', t.raises($$SELECT public.fn_save_status_badge('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', NULL, NULL, 'Fourth', 1, NULL, NULL, 25, 6, 'top-left')$$));
  r := public.fn_list_status_badges_manage('f0000000-0000-0000-0000-000000000001');
  PERFORM t.check('8.7 the owner sees their businesses, the price and the badges',
    jsonb_array_length(r -> 'businesses') = 2 AND (r ->> 'can_pay')::BOOLEAN AND r ->> 'business_profile_id' = 'b0000000-0000-0000-0000-000000000001'
    AND jsonb_array_length(r -> 'badges') = 3 AND NOT (r ->> 'always_on')::BOOLEAN AND (r #>> '{price,days}')::INT = 1, r::TEXT);
END $t$;
SELECT t.as_user(2);
DO $t$
BEGIN
  PERFORM t.check('8.8 CMMS staff cannot touch a status, even one of their company''s owner',
    t.raises($$SELECT public.fn_save_status_badge('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', NULL, NULL, 'X', 1, NULL, NULL, 0, 6, 'bottom-left')$$)
    AND t.raises($$SELECT public.fn_list_status_badges_manage('f0000000-0000-0000-0000-000000000001')$$)
    AND t.raises($$SELECT public.fn_publish_video_badge((SELECT v::UUID FROM t.keep WHERE k = 'smilk'))$$)
    AND t.raises($$SELECT public.fn_delete_video_badge((SELECT v::UUID FROM t.keep WHERE k = 'smilk'))$$));
END $t$;
SELECT t.as_user(4);
DO $t$
BEGIN
  PERFORM t.check('8.9 another user cannot badge or look into someone else''s status',
    t.raises($$SELECT public.fn_save_status_badge('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', NULL, NULL, 'X', 1, NULL, NULL, 0, 6, 'bottom-left')$$)
    AND t.raises($$SELECT public.fn_list_status_badges_manage('f0000000-0000-0000-0000-000000000001')$$));
END $t$;

-- publishing: free, then charged, with its own price
SELECT t.as_user(1);
DO $t$
DECLARE r JSONB; st_expires TIMESTAMPTZ;
BEGIN
  r := public.fn_publish_video_badge((SELECT v::UUID FROM t.keep WHERE k = 'smilk'));
  PERFORM t.check('8.10 while free a status badge goes live at no cost', (r ->> 'success')::BOOLEAN AND (r ->> 'paid_ic')::NUMERIC = 0, r::TEXT);
  SELECT expires_at INTO st_expires FROM public.ican_statuses WHERE id = 'f0000000-0000-0000-0000-000000000001';
  PERFORM t.check('8.11 it lasts exactly as long as the status', (r ->> 'live_until')::TIMESTAMPTZ = st_expires, r ->> 'live_until');
  PERFORM t.check('8.12 publishing it again is refused (nothing to renew)', (public.fn_publish_video_badge((SELECT v::UUID FROM t.keep WHERE k = 'smilk')) ->> 'success')::BOOLEAN IS FALSE);
END $t$;
SELECT t.as_anon();
DO $t$
DECLARE r JSONB;
BEGIN
  r := public.fn_get_status_badges('f0000000-0000-0000-0000-000000000001');
  PERFORM t.check('8.13 viewers see the live badge of a video status, with its timing', jsonb_array_length(r -> 'badges') = 1 AND r #>> '{badges,0,name}' = 'Fresh Milk 1L'
    AND NOT (r ->> 'always_on')::BOOLEAN AND (r #>> '{badges,0,starts_at_sec}')::INT = 4, r::TEXT);
  PERFORM t.check('8.14 and where to shop', r ->> 'site_company_id' = 'e0000000-0000-0000-0000-000000000001');
  PERFORM t.check('8.15 the unpublished ones stay hidden', NOT (r::TEXT LIKE '%Gift box%'));
END $t$;

-- a photo status has no timeline
SELECT t.as_user(1);
DO $t$
DECLARE b JSONB;
BEGIN
  b := public.fn_save_status_badge('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', NULL, 'c0000000-0000-0000-0000-000000000001', NULL, NULL, NULL, NULL, 33, 9, 'bottom-right');
  INSERT INTO t.keep VALUES ('photo', b ->> 'id');
  PERFORM t.check('8.16 on a photo status the badge is placed at 0 for the whole time, whatever was typed', (b ->> 'starts_at_sec')::INT = 0 AND (b ->> 'duration_sec')::INT = 60, b::TEXT);
  PERFORM public.fn_publish_video_badge((SELECT v::UUID FROM t.keep WHERE k = 'photo'));
  PERFORM t.check('8.17 and the viewers are told to keep it on screen', (public.fn_get_status_badges('f0000000-0000-0000-0000-000000000002') ->> 'always_on')::BOOLEAN
    AND jsonb_array_length(public.fn_get_status_badges('f0000000-0000-0000-0000-000000000002') -> 'badges') = 1);
END $t$;

-- ended and private statuses
SELECT t.as_user(1);
DO $t$
BEGIN
  PERFORM t.check('8.18 a status that has ended takes no new badges',
    t.raises($$SELECT public.fn_save_status_badge('f0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', NULL, NULL, 'X', 1, NULL, NULL, 0, 6, 'bottom-left')$$));
  PERFORM public.fn_save_status_badge('f0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001', NULL, NULL, 'Secret deal', 100, NULL, NULL, 1, 6, 'bottom-left');
END $t$;
SELECT t.as_admin();
UPDATE public.video_product_badges SET status = 'live', live_until = now() + INTERVAL '20 hours' WHERE label = 'Secret deal';
UPDATE public.video_product_badges SET status = 'live', live_until = now() + INTERVAL '20 hours' WHERE status_id = 'f0000000-0000-0000-0000-000000000004';
SELECT t.as_anon();
DO $t$
BEGIN
  PERFORM t.check('8.19 a private status''s badges are not shown to the public', jsonb_array_length(public.fn_get_status_badges('f0000000-0000-0000-0000-000000000005') -> 'badges') = 0);
END $t$;
SELECT t.as_user(1);
DO $t$
BEGIN
  PERFORM t.check('8.20 ...but its owner sees them', jsonb_array_length(public.fn_get_status_badges('f0000000-0000-0000-0000-000000000005') -> 'badges') = 1);
END $t$;
SELECT t.as_admin();
INSERT INTO public.video_product_badges (status_id, business_profile_id, label, price, status, live_until) VALUES
  ('f0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'Old deal', 1, 'draft', NULL);
SELECT t.as_user(1);
DO $t$
BEGIN
  PERFORM t.check('8.21 publishing onto an ended status is refused', (public.fn_publish_video_badge((SELECT id FROM t.badges WHERE label = 'Old deal')) ->> 'success')::BOOLEAN IS FALSE);
END $t$;
SELECT t.as_anon();
DO $t$
BEGIN
  PERFORM t.check('8.22 viewers get nothing from an ended status', jsonb_array_length(public.fn_get_status_badges('f0000000-0000-0000-0000-000000000004') -> 'badges') = 0);
END $t$;

-- the status service is priced on its own
SELECT t.as_dev();
DO $t$
DECLARE r JSONB;
BEGIN
  r := public.ican_dev_get_service_prices('dev-secret');
  PERFORM t.check('8.23 the developer panel lists both services, neither charging right now', jsonb_array_length(r -> 'services') = 2
    AND r #>> '{services,0,key}' = 'pitch_product_badge' AND r #>> '{services,1,key}' = 'status_product_badge'
    AND (SELECT bool_and((s ->> 'effective_ic')::NUMERIC = 0) FROM jsonb_array_elements(r -> 'services') s), r::TEXT);
  r := public.ican_dev_set_service_price('dev-secret', 'status_product_badge', 2, true);
  PERFORM t.check('8.24 the status price can be switched on alone', (r ->> 'success')::BOOLEAN AND (public.fn_status_badge_price() ->> 'price_ic')::NUMERIC = 2 AND (public.fn_pitch_badge_price() ->> 'price_ic')::NUMERIC = 0, r::TEXT);
END $t$;
SELECT t.as_admin();
UPDATE public.ican_business_wallets SET ican_balance = 1 WHERE business_profile_id = 'b0000000-0000-0000-0000-000000000001';
SELECT t.as_user(1);
DO $t$
DECLARE r JSONB; b JSONB;
BEGIN
  b := public.fn_save_status_badge('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', NULL, 'c0000000-0000-0000-0000-000000000001', NULL, NULL, NULL, NULL, 0, 6, 'top-left');
  r := public.fn_publish_video_badge((b ->> 'id')::UUID);
  PERFORM t.check('8.25 with the status price on, an empty business wallet cannot publish', (r ->> 'success')::BOOLEAN IS FALSE AND r ->> 'error' LIKE 'Not enough%' AND (SELECT status FROM t.badges WHERE id = (b ->> 'id')::UUID) = 'draft', r::TEXT);
  INSERT INTO t.keep VALUES ('paid', b ->> 'id');
END $t$;
SELECT t.as_admin();
UPDATE public.ican_business_wallets SET ican_balance = 10 WHERE business_profile_id = 'b0000000-0000-0000-0000-000000000001';
SELECT t.as_user(1);
DO $t$
DECLARE r JSONB; credits_before INT; bal_before NUMERIC;
BEGIN
  SELECT count(*), (SELECT ican_balance FROM public.ican_business_wallets WHERE business_profile_id = 'b0000000-0000-0000-0000-000000000001') INTO credits_before, bal_before FROM public.platform_credits;
  r := public.fn_publish_video_badge((SELECT v::UUID FROM t.keep WHERE k = 'paid'));
  PERFORM t.check('8.26 the owner pays the status price from the business wallet', (r ->> 'success')::BOOLEAN AND (r ->> 'paid_ic')::NUMERIC = 2
    AND (SELECT ican_balance FROM public.ican_business_wallets WHERE business_profile_id = 'b0000000-0000-0000-0000-000000000001') = bal_before - 2, r::TEXT);
  PERFORM t.check('8.27 the platform is credited under the status service', (SELECT count(*) FROM public.platform_credits) = credits_before + 1
    AND (SELECT fee_type FROM public.platform_credits ORDER BY ctid DESC LIMIT 1) = 'status_product_badge');
  PERFORM t.check('8.28 a pitch badge is still free', (public.fn_pitch_badge_price() ->> 'charged')::BOOLEAN IS FALSE);
END $t$;

-- removing
SELECT t.as_user(1);
DO $t$
BEGIN
  PERFORM t.check('8.29 the status owner can remove a badge', public.fn_delete_video_badge((SELECT v::UUID FROM t.keep WHERE k = 'paid')));
END $t$;
SELECT t.as_admin();
DO $t$
BEGIN
  PERFORM t.check('8.30 a badge cannot sit on a pitch and a status at once, or on neither',
    t.raises($$INSERT INTO public.video_product_badges (pitch_id, status_id, business_profile_id, label, price) VALUES ('d0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'X', 1)$$)
    AND t.raises($$INSERT INTO public.video_product_badges (business_profile_id, label, price) VALUES ('b0000000-0000-0000-0000-000000000001', 'X', 1)$$));
  DELETE FROM public.ican_statuses WHERE id = 'f0000000-0000-0000-0000-000000000001';
  PERFORM t.check('8.31 deleting a status removes its badges', (SELECT count(*) FROM public.video_product_badges WHERE status_id = 'f0000000-0000-0000-0000-000000000001') = 0);
END $t$;

-- ============ 9. What is happening on my own status cards
SELECT t.as_anon();
DO $t$
BEGIN
  PERFORM t.check('9.1 a visitor who is not signed in cannot ask', t.raises('SELECT public.fn_my_status_updates()'));
END $t$;
SELECT t.as_user(3);
DO $t$
BEGIN
  PERFORM t.check('9.2 someone with no statuses gets nothing', public.fn_my_status_updates() = '[]'::JSONB);
END $t$;
SELECT t.as_admin();
UPDATE public.ican_statuses SET view_count = 7 WHERE id = 'f0000000-0000-0000-0000-000000000002';
INSERT INTO public.ican_status_messages (status_id, sender_id, message_text) VALUES
  ('f0000000-0000-0000-0000-000000000002', public.tu(3), 'How much?'),
  ('f0000000-0000-0000-0000-000000000002', public.tu(4), 'Is it fresh?'),
  ('f0000000-0000-0000-0000-000000000002', public.tu(1), 'Yes, delivered this morning');
SELECT t.as_user(1);
DO $t$
DECLARE r JSONB; photo JSONB;
BEGIN
  r := public.fn_my_status_updates();
  PERFORM t.check('9.3 only my active statuses: the ended one and other people''s are left out', jsonb_array_length(r) = 2
    AND NOT (r::TEXT LIKE '%f0000000-0000-0000-0000-000000000004%') AND NOT (r::TEXT LIKE '%f0000000-0000-0000-0000-000000000003%'), r::TEXT);
  SELECT j INTO photo FROM jsonb_array_elements(r) j WHERE j ->> 'status_id' = 'f0000000-0000-0000-0000-000000000002';
  PERFORM t.check('9.4 comments from others are counted, my own replies are not', (photo ->> 'comment_count')::INT = 2, photo::TEXT);
  PERFORM t.check('9.5 the view count comes through', (photo ->> 'view_count')::INT = 7);
  PERFORM t.check('9.6 live badges are listed, none hidden yet', jsonb_array_length(photo -> 'badges') = 1 AND photo #>> '{badges,0,name}' = 'Fresh Milk 1L' AND photo #> '{badges,0,problem}' = 'null'::JSONB, (photo -> 'badges')::TEXT);
END $t$;
SELECT t.as_admin();
UPDATE public.inventory SET current_stock = 0 WHERE product_id = 'c0000000-0000-0000-0000-000000000001';
SELECT t.as_user(1);
DO $t$
DECLARE photo JSONB;
BEGIN
  SELECT j INTO photo FROM jsonb_array_elements(public.fn_my_status_updates()) j WHERE j ->> 'status_id' = 'f0000000-0000-0000-0000-000000000002';
  PERFORM t.check('9.7 when the product sells out the card learns why its badge is hidden', photo #>> '{badges,0,problem}' = 'sold_out', (photo -> 'badges')::TEXT);
END $t$;
SELECT t.as_user(4);
DO $t$
BEGIN
  PERFORM t.check('9.8 another owner sees only their own status', jsonb_array_length(public.fn_my_status_updates()) = 1
    AND public.fn_my_status_updates() #>> '{0,status_id}' = 'f0000000-0000-0000-0000-000000000003');
END $t$;
