\set ON_ERROR_STOP on
-- Business digital cards: issuing, access, the scan RPCs, approval with the business PIN, and isolation from personal cards.
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO PUBLIC;
CREATE FUNCTION t.u(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-' || lpad(n::TEXT, 12, '0'))::UUID $$;
CREATE FUNCTION t.as_user(n INT) RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', t.u(n)::TEXT, false); EXECUTE 'SET ROLE authenticated'; END $$;
CREATE FUNCTION t.as_anon() RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', false); EXECUTE 'SET ROLE anon'; END $$;
CREATE FUNCTION t.as_admin() RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'RESET ROLE'; END $$;
CREATE FUNCTION t.check(p_name TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT '') RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  IF p_ok IS TRUE THEN RAISE INFO 'PASS %', p_name; ELSE RAISE EXCEPTION 'FAIL % %', p_name, p_detail; END IF; END $$;
-- true when the statement raises an error
CREATE FUNCTION t.raises(p_sql TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$ BEGIN EXECUTE p_sql; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;
SET client_min_messages = info;

-- users: 1 owner, 2 co-owner, 3 staff, 4 stranger, 5 other business's owner
INSERT INTO auth.users (id, email, raw_user_meta_data) SELECT t.u(n), 'u' || n || '@t.dev', jsonb_build_object('full_name', 'User ' || n) FROM generate_series(1, 5) n;
INSERT INTO public.business_profiles (id, user_id, business_name) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', t.u(1), 'Kampala Mart'), ('bbbbbbbb-0000-0000-0000-000000000002', t.u(5), 'Other Shop');
INSERT INTO public.business_co_owners (business_profile_id, user_id) VALUES ('bbbbbbbb-0000-0000-0000-000000000001', t.u(2));
INSERT INTO public.business_account_members (business_profile_id, auth_user_id) VALUES ('bbbbbbbb-0000-0000-0000-000000000001', t.u(3));
INSERT INTO public.ican_business_wallet_settings (business_profile_id, pin_hash)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001', extensions.crypt('4321', extensions.gen_salt('bf')));

CREATE FUNCTION t.biz() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT 'bbbbbbbb-0000-0000-0000-000000000001'::UUID $$;
CREATE TABLE t.keep (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t.keep TO PUBLIC;

-- ============ 1. Issuing
DO $t$
DECLARE c public.ican_business_digital_cards; c2 public.ican_business_digital_cards;
BEGIN
  PERFORM t.as_user(1);
  c := public.get_or_create_business_digital_card(t.biz());
  c2 := public.get_or_create_business_digital_card(t.biz());
  PERFORM t.check('1.1 owner gets a 16-digit card starting 8 named after the business',
    c.card_number ~ '^8[0-9]{15}$' AND c.holder_name = 'KAMPALA MART' AND c.expiry_year = extract(year from now())::int + 4, c::TEXT);
  PERFORM t.check('1.2 asking again returns the same card', c.id = c2.id AND c.qr_token = c2.qr_token);
  PERFORM t.as_admin(); INSERT INTO t.keep VALUES ('token', c.qr_token), ('card', c.id::TEXT);

  PERFORM t.as_user(2);
  PERFORM t.check('1.3 co-owner sees the same card', (public.get_or_create_business_digital_card(t.biz())).id = c.id);
  PERFORM t.as_user(3);
  PERFORM t.check('1.4 staff see the same card', (public.get_or_create_business_digital_card(t.biz())).id = c.id);
  PERFORM t.as_user(4);
  PERFORM t.check('1.5 a stranger cannot get or create it', t.raises($$ SELECT public.get_or_create_business_digital_card(t.biz()) $$));
  PERFORM t.check('1.6 a stranger cannot read the card or its token via the table', (SELECT count(*) FROM public.ican_business_digital_cards) = 0);
  PERFORM t.as_user(5);
  PERFORM t.check('1.7 another business owner cannot touch this card',
    t.raises($$ SELECT public.rotate_business_card_qr(t.biz()) $$) AND t.raises($$ SELECT public.set_business_card_qr_enabled(t.biz(), false) $$));
  PERFORM t.check('1.8 no direct client writes',
    t.raises($$ INSERT INTO public.ican_business_digital_cards (business_profile_id, card_number, holder_name, expiry_month, expiry_year, qr_token)
                VALUES (t.biz(), '8000000000000000', 'X', 1, 2030, 'tok') $$));
  PERFORM t.as_admin();
END $t$;

-- ============ 2. Isolation from personal cards (the card-pay-with-pin function only reads ican_digital_cards)
DO $t$
DECLARE tok TEXT := (SELECT v FROM t.keep WHERE k = 'token'); p public.ican_digital_cards;
BEGIN
  PERFORM t.as_user(1);
  p := public.get_or_create_my_digital_card();
  PERFORM t.as_admin();
  PERFORM t.check('2.1 personal card is separate and starts 9', p.card_number ~ '^9[0-9]{15}$' AND p.user_id = t.u(1));
  PERFORM t.check('2.2 the business token is NOT a personal card token (PIN-at-scan payout cannot find it)',
    (SELECT count(*) FROM public.ican_digital_cards WHERE qr_token = tok) = 0);
  PERFORM t.check('2.3 owner has exactly one personal and one business card', (SELECT count(*) FROM public.ican_digital_cards WHERE user_id = t.u(1)) = 1
    AND (SELECT count(*) FROM public.ican_business_digital_cards) = 1);
END $t$;

-- ============ 3. Public scan RPCs
DO $t$
DECLARE tok TEXT := (SELECT v FROM t.keep WHERE k = 'token'); ptok TEXT := (SELECT qr_token FROM public.ican_digital_cards WHERE user_id = t.u(1));
  i RECORD; rid UUID;
BEGIN
  PERFORM t.as_anon();
  SELECT * INTO i FROM public.get_card_qr_info(tok);
  PERFORM t.check('3.1 scan page shows the business name, last4 and never offers PIN payout',
    i.holder_first_name = 'Kampala Mart' AND i.last4 ~ '^[0-9]{4}$' AND i.pin_pay_enabled = false, to_jsonb(i)::TEXT);
  SELECT * INTO i FROM public.get_card_qr_info(ptok);
  PERFORM t.check('3.2 personal token behaves as before (first name, PIN payout on)', i.holder_first_name = 'User' AND i.pin_pay_enabled = true, to_jsonb(i)::TEXT);
  PERFORM t.check('3.3 unknown token is not active', NOT EXISTS (SELECT 1 FROM public.get_card_qr_info('nope')));

  rid := public.submit_card_qr_request(tok, 'Sam Buyer', '0772123456', 'MTN', 25000, 'Refund');
  PERFORM t.as_admin();
  PERFORM t.check('3.4 request lands in the business inbox, not a personal one',
    (SELECT status FROM public.ican_business_card_qr_requests WHERE id = rid) = 'pending'
    AND (SELECT count(*) FROM public.ican_card_qr_requests) = 0);
  PERFORM t.as_anon();
  PERFORM t.check('3.5 validation still applies',
    t.raises($$ SELECT public.submit_card_qr_request((SELECT v FROM t.keep WHERE k='token'), 'Sam', '12', 'MTN', 25000, NULL) $$)
    AND t.raises($$ SELECT public.submit_card_qr_request((SELECT v FROM t.keep WHERE k='token'), 'Sam', '0772123456', 'MTN', 10, NULL) $$)
    AND t.raises($$ SELECT public.submit_card_qr_request('nope', 'Sam', '0772123456', 'MTN', 25000, NULL) $$));
  PERFORM t.check('3.6 anonymous scanners cannot read requests',
    (SELECT count(*) FROM public.ican_business_card_qr_requests) = 0 AND t.raises($$ SELECT public.approve_business_card_qr_request(gen_random_uuid(), '4321') $$));
  PERFORM t.as_admin();
  INSERT INTO t.keep VALUES ('req', rid::TEXT);
END $t$;

-- ============ 4. Inbox access
DO $t$
BEGIN
  PERFORM t.as_user(1); PERFORM t.check('4.1 owner sees the request', (SELECT count(*) FROM public.ican_business_card_qr_requests) = 1);
  PERFORM t.as_user(3); PERFORM t.check('4.2 staff see the request', (SELECT count(*) FROM public.ican_business_card_qr_requests) = 1);
  PERFORM t.as_user(4); PERFORM t.check('4.3 a stranger does not', (SELECT count(*) FROM public.ican_business_card_qr_requests) = 0);
  PERFORM t.as_user(5); PERFORM t.check('4.4 another business does not', (SELECT count(*) FROM public.ican_business_card_qr_requests) = 0);
  PERFORM t.as_admin();
END $t$;

-- ============ 5. Approval needs a shareholder AND the business PIN
DO $t$
DECLARE rid UUID := (SELECT v FROM t.keep WHERE k = 'req')::UUID; r JSONB;
BEGIN
  PERFORM t.as_user(3);
  r := public.approve_business_card_qr_request(rid, '4321');
  PERFORM t.check('5.1 staff cannot approve even with the right PIN', (r->>'success')::BOOLEAN = false, r::TEXT);
  PERFORM t.as_user(4);
  r := public.approve_business_card_qr_request(rid, '4321');
  PERFORM t.check('5.2 a stranger cannot approve', (r->>'success')::BOOLEAN = false, r::TEXT);

  PERFORM t.as_user(1);
  r := public.approve_business_card_qr_request(rid, '0000');
  PERFORM t.check('5.3 wrong PIN is refused and still counted',
    (r->>'success')::BOOLEAN = false AND (SELECT pin_failed_attempts FROM public.ican_business_wallet_settings) = 1
    AND (SELECT status FROM public.ican_business_card_qr_requests WHERE id = rid) = 'pending', r::TEXT);
  r := public.approve_business_card_qr_request(rid, 'abc');
  PERFORM t.check('5.4 malformed PIN is refused', (r->>'success')::BOOLEAN = false, r::TEXT);

  r := public.approve_business_card_qr_request(rid, '4321');
  PERFORM t.check('5.5 owner with the right PIN approves; nothing else changes',
    (r->>'success')::BOOLEAN AND (SELECT status FROM public.ican_business_card_qr_requests WHERE id = rid) = 'approved'
    AND (SELECT resolved_by FROM public.ican_business_card_qr_requests WHERE id = rid) = t.u(1)
    AND (SELECT pin_failed_attempts FROM public.ican_business_wallet_settings) = 0, r::TEXT);
  r := public.approve_business_card_qr_request(rid, '4321');
  PERFORM t.check('5.6 an approved request cannot be approved or declined again',
    (r->>'success')::BOOLEAN = false);
  PERFORM public.decline_business_card_qr_request(rid);
  PERFORM t.check('5.7 decline leaves a resolved request alone', (SELECT status FROM public.ican_business_card_qr_requests WHERE id = rid) = 'approved');
  PERFORM t.as_admin();
END $t$;

DO $t$
DECLARE tok TEXT := (SELECT v FROM t.keep WHERE k = 'token'); rid UUID; r JSONB; i INT;
BEGIN
  PERFORM t.as_anon(); rid := public.submit_card_qr_request(tok, 'Amy', '0701234567', 'AIRTEL', 5000, NULL);
  PERFORM t.as_user(3);
  PERFORM public.decline_business_card_qr_request(rid);
  PERFORM t.check('5.8 staff can decline', (SELECT status FROM public.ican_business_card_qr_requests WHERE id = rid) = 'declined');
  PERFORM t.as_user(4);
  PERFORM t.check('5.9 a stranger cannot decline', t.raises(format($$ SELECT public.decline_business_card_qr_request(%L) $$, rid)));

  -- lockout: 5 wrong PINs lock the business PIN, after which even the right PIN is refused
  PERFORM t.as_anon(); rid := public.submit_card_qr_request(tok, 'Bo', '0701234567', 'AIRTEL', 5000, NULL);
  PERFORM t.as_user(2);
  FOR i IN 1..5 LOOP r := public.approve_business_card_qr_request(rid, '1111'); END LOOP;
  r := public.approve_business_card_qr_request(rid, '4321');
  PERFORM t.check('5.10 five wrong PINs lock approval (co-owner too)', (r->>'success')::BOOLEAN = false AND (r->>'message') ILIKE '%lock%', r::TEXT);
  PERFORM t.as_admin();
  UPDATE public.ican_business_wallet_settings SET pin_failed_attempts = 0, pin_locked_until = NULL;
  PERFORM t.as_user(2);
  r := public.approve_business_card_qr_request(rid, '4321');
  PERFORM t.check('5.11 a co-owner can approve once unlocked', (r->>'success')::BOOLEAN, r::TEXT);
  PERFORM t.as_admin();
END $t$;

-- ============ 6. Open-request cap, QR off, rotate
DO $t$
DECLARE tok TEXT := (SELECT v FROM t.keep WHERE k = 'token'); old TEXT; i INT; new TEXT;
BEGIN
  PERFORM t.as_anon();
  FOR i IN 1..10 LOOP PERFORM public.submit_card_qr_request(tok, 'Q' || i || ' x', '0701234567', 'MTN', 2000, NULL); END LOOP;
  PERFORM t.check('6.1 an 11th open request is refused', t.raises(format($$ SELECT public.submit_card_qr_request(%L, 'Z z', '0701234567', 'MTN', 2000, NULL) $$, tok)));

  PERFORM t.as_user(3);
  PERFORM public.set_business_card_qr_enabled(t.biz(), false);
  PERFORM t.as_anon();
  PERFORM t.check('6.2 QR off: scan page is inactive and requests are refused',
    NOT EXISTS (SELECT 1 FROM public.get_card_qr_info(tok)) AND t.raises(format($$ SELECT public.submit_card_qr_request(%L, 'Z z', '0701234567', 'MTN', 2000, NULL) $$, tok)));
  PERFORM t.as_user(1);
  PERFORM public.set_business_card_qr_enabled(t.biz(), true);

  new := public.rotate_business_card_qr(t.biz());
  PERFORM t.as_anon();
  PERFORM t.check('6.3 rotating kills the old QR and the new one works',
    NOT EXISTS (SELECT 1 FROM public.get_card_qr_info(tok)) AND EXISTS (SELECT 1 FROM public.get_card_qr_info(new)));
  PERFORM t.as_admin();
  PERFORM t.check('6.4 pending requests were expired by the rotation',
    (SELECT count(*) FROM public.ican_business_card_qr_requests WHERE status = 'pending') = 0
    AND (SELECT count(*) FROM public.ican_business_card_qr_requests WHERE status = 'expired') = 10);
END $t$;

-- ============ 7. Grants
DO $t$
BEGIN
  PERFORM t.check('7.1 member RPCs are closed to anon',
    NOT has_function_privilege('anon', 'public.get_or_create_business_digital_card(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.approve_business_card_qr_request(uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.rotate_business_card_qr(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.decline_business_card_qr_request(uuid)', 'EXECUTE'));
  PERFORM t.check('7.2 scan RPCs stay open to anon',
    has_function_privilege('anon', 'public.get_card_qr_info(text)', 'EXECUTE')
    AND has_function_privilege('anon', 'public.submit_card_qr_request(text,text,text,text,numeric,text)', 'EXECUTE'));
END $t$;
