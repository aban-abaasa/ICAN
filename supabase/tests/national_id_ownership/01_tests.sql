\set ON_ERROR_STOP on

CREATE FUNCTION t.key(p_user INT, p_file TEXT) RETURNS TEXT LANGUAGE sql AS
  $$ SELECT 'r2://cmms-employment-documents/' || t.u(p_user)::TEXT || '/' || p_file $$;
CREATE FUNCTION t.status(p_user INT) RETURNS JSONB LANGUAGE plpgsql AS $$ BEGIN
  PERFORM t.login(p_user); RETURN public.get_my_national_id_status(); END $$;
CREATE FUNCTION t.review(p_check UUID, p_approve BOOLEAN, p_note TEXT DEFAULT NULL, p_override BOOLEAN DEFAULT false) RETURNS JSONB LANGUAGE sql AS
  $$ SELECT public.ican_id_dev_review('dev_test_secret', p_check, p_approve, p_note, p_override) $$;
CREATE FUNCTION t.check_of(p_user INT) RETURNS UUID LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT id FROM public.national_id_checks WHERE user_id = t.u(p_user) ORDER BY (status = 'pending') DESC, created_at DESC LIMIT 1 $$;
-- start the hourly attempt count again (the scenarios below make more mistakes in a minute than a person would in an hour)
CREATE FUNCTION t.reset_attempts() RETURNS VOID LANGUAGE sql SECURITY DEFINER AS $$ DELETE FROM app_private.national_id_attempts $$;
-- whether user n holds a verified ID (read around row-level security)
CREATE FUNCTION t.verified_of(p_user INT) RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT COALESCE((SELECT verified FROM public.user_national_ids WHERE user_id = t.u(p_user)), false) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;

-- ── world: seven people, each with a personal wallet ────────────────────────
SELECT t.as_admin();
INSERT INTO auth.users (id) SELECT t.u(n) FROM generate_series(1, 8) n;
INSERT INTO public.user_accounts (user_id, account_holder_name, email, phone_number, country_code, ugx_balance) VALUES
  (t.u(1), 'Mallory Ssali',  'mallory@x.test', '+256700000001', 'UG', 100),   -- saves someone else's ID first
  (t.u(2), 'Bob Kato',       'bob@x.test',     '+256700000002', 'UG', 100),   -- its real owner
  (t.u(3), 'Carol Ng',       'carol@x.test',   '+256700000003', 'UG', 100),
  (t.u(4), 'Dan Okello',     'dan@x.test',     '+256700000004', 'UG', 100),
  (t.u(5), 'Eve Mugisha',    'eve@x.test',     '+256700000005', 'UG', 100),
  (t.u(6), 'Frank Opio',     'frank@x.test',   '+256700000006', 'UG', 100),
  (t.u(7), 'Grace Nabirye',  'grace@x.test',   '+256700000007', 'UG', 100);

-- ═══ 1. what the installer made, and what the API cannot reach ═══════════════
SELECT t.login(2);
DO $$ BEGIN
  PERFORM t.check('the checks table exists and starts empty', (SELECT count(*) FROM public.national_id_checks) = 0);
  PERFORM t.check('the API cannot read the photos of a request',   t.raises('SELECT id_photo FROM public.national_id_checks'));
  PERFORM t.check('the API cannot read the selfie of a request',   t.raises('SELECT selfie_photo FROM public.national_id_checks'));
  PERFORM t.check('the API cannot read the ID hash of a request',  t.raises('SELECT id_hash FROM public.national_id_checks'));
  PERFORM t.check('the API cannot read the ID hash itself',        t.raises('SELECT id_hash FROM public.user_national_ids'));
  PERFORM t.check('the API cannot write a verified ID directly',   t.raises('UPDATE public.user_national_ids SET verified = true'));
  PERFORM t.check('the API cannot file a request directly',
    t.raises($q$INSERT INTO public.national_id_checks (user_id, kind, country_code, id_type, id_hash, id_last4, name_on_id, id_photo, selfie_photo) VALUES (t.u(2), 'verify', 'UG', 'NIN', 'x', 'x', 'x', 'x', 'x')$q$));
  PERFORM t.check('the API cannot read the pepper-using helper', t.raises($q$SELECT app_private.national_id_hash('UG', 'CM1234567890AB')$q$));
END $$;
SELECT t.as_anon();
DO $$ BEGIN
  PERFORM t.check('signed-out callers cannot ask for verification',
    t.raises($q$SELECT public.request_my_id_verification('A B', 'r2://x', 'r2://y')$q$));
  PERFORM t.check('signed-out callers cannot claim an ID',
    t.raises($q$SELECT public.claim_national_id('UG', 'CM1234567890AB', 'A B', 'r2://x', 'r2://y')$q$));
  PERFORM t.check('signed-out callers cannot look up trust', t.raises($q$SELECT * FROM public.get_id_trust(ARRAY[t.u(2)])$q$));
END $$;

-- ═══ 2. the squatting problem: first to type an ID holds it ═════════════════
SELECT t.login(1);
DO $$ DECLARE r JSONB; BEGIN
  r := public.set_my_national_id('UG', 'CM1234567890AB');
  PERFORM t.check('Mallory saves a well-formed ID that is not hers', r ->> 'success' = 'true');
END $$;
SELECT t.login(2);
DO $$ DECLARE r JSONB; BEGIN
  r := public.set_my_national_id('UG', 'cm 1234-567890 ab');
  PERFORM t.check('the real owner is refused: already linked', r ->> 'success' = 'false' AND r ->> 'code' = 'id_taken', r::text);
  PERFORM t.check('...and the answer points to a review, not just "contact support"', r ->> 'error' ILIKE '%review%', r::text);
END $$;

-- ═══ 3. the owner's claim ═══════════════════════════════════════════════════
SELECT t.login(2);
DO $$ DECLARE r JSONB; BEGIN
  r := public.claim_national_id('UG', 'CM1234567890AB', 'Bob Kato Mugisha', NULL, NULL);
  PERFORM t.check('a claim with no photos is refused', r ->> 'success' = 'false' AND r ->> 'error' ILIKE '%photo of your ID%', r::text);
  r := public.claim_national_id('UG', 'CM1234567890AB', 'Bob Kato Mugisha', t.key(1, 'id.jpg'), t.key(2, 'me.jpg'));
  PERFORM t.check('a photo from someone else''s folder is refused', r ->> 'success' = 'false', r::text);
  r := public.claim_national_id('UG', 'CM1234567890AB', 'Bob Kato Mugisha', 'r2://pitches/' || t.u(2)::TEXT || '/id.jpg', t.key(2, 'me.jpg'));
  PERFORM t.check('a photo from another storage folder is refused', r ->> 'success' = 'false', r::text);
  r := public.claim_national_id('UG', 'CM1234567890AB', 'Bob Kato Mugisha', t.key(2, 'same.jpg'), t.key(2, 'same.jpg'));
  PERFORM t.check('the same picture twice is refused', r ->> 'success' = 'false', r::text);
  PERFORM t.reset_attempts();
  r := public.claim_national_id('UG', 'CM1234567890AB', 'Bob', t.key(2, 'id.jpg'), t.key(2, 'me.jpg'));
  PERFORM t.check('one name is not a full name', r ->> 'success' = 'false' AND r ->> 'error' ILIKE '%full name%', r::text);
  r := public.claim_national_id('UG', 'CM1234567890AB', 'Zed Yusuf', t.key(2, 'id.jpg'), t.key(2, 'me.jpg'));
  PERFORM t.check('a name that is not the wallet''s is refused', r ->> 'success' = 'false' AND r ->> 'error' ILIKE '%has to match%', r::text);
  PERFORM t.reset_attempts();
  r := public.claim_national_id('UG', 'CM9999999999ZZ', 'Bob Kato Mugisha', t.key(2, 'id.jpg'), t.key(2, 'me.jpg'));
  PERFORM t.check('an ID nobody holds is not a claim', r ->> 'code' = 'not_taken', r::text);
  r := public.claim_national_id('UG', 'CM1234', 'Bob Kato Mugisha', t.key(2, 'id.jpg'), t.key(2, 'me.jpg'));
  PERFORM t.check('a badly formed ID is refused', r ->> 'success' = 'false', r::text);
  r := public.claim_national_id('KE', '12345678', 'Bob Kato Mugisha', t.key(2, 'id.jpg'), t.key(2, 'me.jpg'));
  PERFORM t.check('an ID from another country than the wallet is refused', r ->> 'success' = 'false' AND r ->> 'error' ILIKE '%UG%', r::text);
END $$;
SELECT t.login(1);
DO $$ DECLARE r JSONB; BEGIN
  r := public.claim_national_id('UG', 'CM1234567890AB', 'Mallory Ssali Mukasa', t.key(1, 'id.jpg'), t.key(1, 'me.jpg'));
  PERFORM t.check('the holder cannot "claim" their own ID', r ->> 'code' = 'already_yours', r::text);
END $$;
SELECT t.login(2);
DO $$ DECLARE r JSONB; BEGIN
  PERFORM t.reset_attempts();
  r := public.claim_national_id('UG', 'cm1234567890ab', 'Bob Kato Mugisha', t.key(2, 'id.jpg'), t.key(2, 'me.jpg'), 'Call me on 0700000002');
  PERFORM t.check('a proper claim is filed', r ->> 'success' = 'true' AND r ->> 'checkId' IS NOT NULL, r::text);
  r := public.claim_national_id('UG', 'CM1234567890AB', 'Bob Kato Mugisha', t.key(2, 'id2.jpg'), t.key(2, 'me2.jpg'));
  PERFORM t.check('...and only one can wait at a time', r ->> 'success' = 'false' AND r ->> 'error' ILIKE '%waiting%', r::text);
  PERFORM t.check('the owner sees it as pending, without being told the photos',
    (public.get_my_national_id_status() #>> '{check,status}') = 'pending' AND (public.get_my_national_id_status() #>> '{check,kind}') = 'claim'
    AND (SELECT count(*) FROM public.national_id_checks) = 1);
END $$;

-- probing: asking about an ID that is taken, with nothing to back it up, uses up the hourly attempts like a wrong guess
SELECT t.login(8);
DO $$ DECLARE r JSONB; BEGIN
  FOR i IN 1..5 LOOP
    r := public.claim_national_id('UG', 'CM1234567890AB', 'Hank Odoi', NULL, NULL);
    PERFORM t.check('probe ' || i || ' of 5 is answered', r ->> 'success' = 'false' AND r ->> 'error' ILIKE '%photo%', r::text);
  END LOOP;
  r := public.claim_national_id('UG', 'CM1234567890AB', 'Hank Odoi', NULL, NULL);
  PERFORM t.check('the sixth is turned away for the hour', r ->> 'error' ILIKE '%Too many attempts%', r::text);
  r := public.set_my_national_id('UG', 'CF5555555555ZZ');
  PERFORM t.check('...and so is saving an ID', r ->> 'success' = 'false', r::text);
END $$;

-- ═══ 4. the squatter asks for verification too (it must lose, not win by being first) ═══
SELECT t.login(1);
DO $$ DECLARE r JSONB; BEGIN
  r := public.request_my_id_verification('Zed Yusuf Mukasa', t.key(1, 'id.jpg'), t.key(1, 'me.jpg'));
  PERFORM t.check('a name that is not the wallet''s cannot be verified', r ->> 'success' = 'false', r::text);
  r := public.request_my_id_verification('Mallory Ssali Mukasa', t.key(1, 'id.jpg'), t.key(1, 'me.jpg'));
  PERFORM t.check('the squatter can file a request', r ->> 'success' = 'true', r::text);
END $$;
SELECT t.login(5);
DO $$ DECLARE r JSONB; BEGIN
  r := public.request_my_id_verification('Eve Mugisha Akello', t.key(5, 'id.jpg'), t.key(5, 'me.jpg'));
  PERFORM t.check('no ID saved, nothing to verify', r ->> 'success' = 'false' AND r ->> 'error' ILIKE '%first%', r::text);
END $$;

-- ═══ 5. the reviewer ════════════════════════════════════════════════════════
SELECT t.login(2);
DO $$ BEGIN
  PERFORM t.check('the owner cannot approve their own claim',
    t.raises(format($q$SELECT public.ican_id_dev_review('guess', %L, true)$q$, t.check_of(2))));
  PERFORM t.check('the wrong token cannot list', t.raises($q$SELECT public.ican_id_dev_list('guess')$q$));
END $$;
DO $$ DECLARE l JSONB; c JSONB; BEGIN
  l := public.ican_id_dev_list('dev_test_secret');
  PERFORM t.check('two requests wait', jsonb_array_length(l -> 'checks') = 2 AND (l #>> '{counts,pending}') = '2', l::text);
  SELECT x INTO c FROM jsonb_array_elements(l -> 'checks') x WHERE x ->> 'kind' = 'claim';
  PERFORM t.check('the claim shows who holds the ID now', (c #>> '{holder,walletName}') = 'Mallory Ssali' AND (c #>> '{holder,verified}') = 'false', c::text);
  PERFORM t.check('...that the claimant''s wallet name fits the name on the ID', (c ->> 'nameMatchesWallet') = 'true', c::text);
  PERFORM t.check('...that another request is waiting on the same ID', (c ->> 'competing') = '1', c::text);
  PERFORM t.check('...the photos for the reviewer, and only the last 4 of the ID',
    (c ->> 'idPhoto') = t.key(2, 'id.jpg') AND (c ->> 'last4') = '90AB' AND NOT (c ? 'id_hash') AND NOT (c ? 'idHash'), c::text);
  PERFORM t.check('the queue is oldest first', (l #>> '{checks,0,kind}') = 'claim', l::text);
END $$;
DO $$ BEGIN
  PERFORM t.check('rejecting needs a reason', t.raises(format($q$SELECT t.review(%L, false)$q$, t.check_of(2))));
END $$;

-- approve the real owner's claim
DO $$ DECLARE r JSONB; BEGIN
  r := t.review(t.check_of(2), true, 'Checked in person');
  PERFORM t.check('approving the claim works', r ->> 'success' = 'true' AND r ->> 'displacedUserId' = t.u(1)::TEXT, r::text);
END $$;
DO $$ DECLARE s2 JSONB := t.status(2); s1 JSONB := t.status(1); BEGIN
  PERFORM t.check('the owner now holds a VERIFIED ID, with the name on it',
    s2 ->> 'verified' = 'true' AND s2 ->> 'nameOnId' = 'Bob Kato Mugisha' AND s2 ->> 'last4' = '90AB', s2::text);
  PERFORM t.check('the squatter is left with no ID at all', s1 ->> 'hasId' = 'false' AND s1 ->> 'verified' = 'false', s1::text);
  PERFORM t.check('the squatter''s own waiting request was closed', s1 #>> '{check,status}' = 'rejected' AND s1 #>> '{check,reviewNote}' ILIKE '%verified owner%', s1::text);
END $$;
SELECT t.as_admin();
DO $$ BEGIN
  PERFORM t.check('the claim records who it displaced (admin view)',
    (SELECT displaced_user_id FROM public.national_id_checks WHERE user_id = t.u(2) AND kind = 'claim') = t.u(1));
  PERFORM t.check('the squatter can save a real ID of their own again', (SELECT count(*) FROM public.user_national_ids WHERE user_id = t.u(1)) = 0);
  PERFORM t.check('a decided request cannot be decided twice', t.err(format($q$SELECT t.review(%L, true)$q$, (SELECT id FROM public.national_id_checks WHERE user_id = t.u(2) AND kind = 'claim'))) ILIKE '%already been approved%');
END $$;
SELECT t.login(1);
DO $$ DECLARE r JSONB; BEGIN
  r := public.set_my_national_id('UG', 'CF7777777777QQ');
  PERFORM t.check('...with an ID that is theirs', r ->> 'success' = 'true', r::text);
END $$;

-- ═══ 6. the name stays tied to the ID ═══════════════════════════════════════
SELECT t.login(2);
DO $$ BEGIN
  PERFORM t.check('a verified person cannot rename the wallet to someone else',
    t.err($q$UPDATE public.user_accounts SET account_holder_name = 'Alice Nakato' WHERE user_id = t.u(2)$q$) ILIKE '%NATIONAL_ID_NAME_LOCKED%');
  PERFORM t.check('...not even by sneaking a name in beside their own',
    t.err($q$UPDATE public.user_accounts SET account_holder_name = 'Bob Kato Nakato' WHERE user_id = t.u(2)$q$) ILIKE '%NATIONAL_ID_NAME_LOCKED%');
  PERFORM t.check('...but a shorter form of the name on the ID is fine',
    t.err($q$UPDATE public.user_accounts SET account_holder_name = 'Bob Mugisha' WHERE user_id = t.u(2)$q$) = '');
  PERFORM t.check('...and so is an initial',
    t.err($q$UPDATE public.user_accounts SET account_holder_name = 'B. Kato' WHERE user_id = t.u(2)$q$) = '');
  PERFORM t.check('an unverified person can still rename freely',
    (SELECT t.login(1)) IS NOT NULL AND t.err($q$UPDATE public.user_accounts SET account_holder_name = 'Mallory S' WHERE user_id = t.u(1)$q$) = '');
END $$;

-- ═══ 7. what a sender sees ══════════════════════════════════════════════════
SELECT t.login(3);
DO $$ DECLARE n INT; BEGIN
  PERFORM t.check('a verified wallet reads as verified, with a matching name',
    (SELECT verified AND name_matches FROM public.get_id_trust(ARRAY[t.u(2)])));
  PERFORM t.check('a wallet with no ID is not verified',
    (SELECT NOT verified AND NOT name_matches FROM public.get_id_trust(ARRAY[t.u(5)])));
  PERFORM t.check('a wallet with an unverified ID is not verified',
    (SELECT NOT verified FROM public.get_id_trust(ARRAY[t.u(1)])));
  SELECT count(*) INTO n FROM public.get_id_trust(ARRAY(SELECT t.u(i) FROM generate_series(1, 8) i) || ARRAY(SELECT t.u(i) FROM generate_series(1, 30) i));
  PERFORM t.check('at most 20 wallets are answered per call', n = 20, n::TEXT);
END $$;
SELECT t.as_admin();
UPDATE public.user_accounts SET account_holder_name = 'Bob Kato Mugisha' WHERE user_id = t.u(2);

-- ═══ 8. a verified ID cannot be taken away by a claim alone ══════════════════
SELECT t.login(3);
DO $$ DECLARE r JSONB; BEGIN
  r := public.claim_national_id('UG', 'CM1234567890AB', 'Carol Ng Akello', t.key(3, 'id.jpg'), t.key(3, 'me.jpg'), 'This is mine');
  PERFORM t.check('anyone can ask for a verified person''s ID', r ->> 'success' = 'true', r::text);
END $$;
DO $$ DECLARE l JSONB; BEGIN
  l := public.ican_id_dev_list('dev_test_secret');
  PERFORM t.check('the reviewer is shown the holder is verified', (l #>> '{checks,0,holder,verified}') = 'true', l::text);
  PERFORM t.check('approving without the override is refused', t.err(format($q$SELECT t.review(%L, true)$q$, t.check_of(3))) ILIKE '%already VERIFIED%');
  PERFORM t.check('...and nothing moved', t.verified_of(2));
END $$;
DO $$ DECLARE r JSONB; BEGIN
  r := t.review(t.check_of(3), false, 'Photos do not match the ID');
  PERFORM t.check('rejecting needs only a reason', r ->> 'status' = 'rejected', r::text);
  PERFORM t.check('the person sees the reason', (public.get_my_national_id_status() #>> '{check,reviewNote}') = 'Photos do not match the ID');
  r := public.claim_national_id('UG', 'CM1234567890AB', 'Carol Ng Akello', t.key(3, 'id3.jpg'), t.key(3, 'me3.jpg'));
  PERFORM t.check('they can ask again after a rejection', r ->> 'success' = 'true', r::text);
  r := t.review(t.check_of(3), true, 'Carol showed the card, Bob''s was a fake', true);
  PERFORM t.check('with the override a reviewer can replace a verified holder', r ->> 'success' = 'true' AND r ->> 'displacedUserId' = t.u(2)::TEXT, r::text);
END $$;
DO $$ BEGIN
  PERFORM t.check('Carol now holds it', (t.status(3) ->> 'verified') = 'true');
  PERFORM t.check('Bob does not', (t.status(2) ->> 'hasId') = 'false');
END $$;

-- ═══ 9. rejecting, asking again, and the daily limit ═════════════════════════
SELECT t.login(6);
DO $$ DECLARE r JSONB; BEGIN
  PERFORM public.set_my_national_id('UG', 'CM3333333333CC');
  FOR i IN 1..3 LOOP
    r := public.request_my_id_verification('Frank Opio Okot', t.key(6, 'id' || i || '.jpg'), t.key(6, 'me' || i || '.jpg'));
    PERFORM t.check('request ' || i || ' of 3 is accepted', r ->> 'success' = 'true', r::text);
    PERFORM t.review(t.check_of(6), false, 'Blurry photo');
  END LOOP;
  r := public.request_my_id_verification('Frank Opio Okot', t.key(6, 'id4.jpg'), t.key(6, 'me4.jpg'));
  PERFORM t.check('a fourth request in a day waits until tomorrow', r ->> 'success' = 'false' AND r ->> 'error' ILIKE '%tomorrow%', r::text);
END $$;

-- ═══ 10. enforcement: saved is not the same as proven ═══════════════════════
SELECT t.as_admin();
SELECT t.login(7);
DO $$ DECLARE r JSONB; BEGIN
  PERFORM public.set_my_national_id('UG', 'CF2222222222BB');
  r := public.request_my_id_verification('Grace Nabirye Auma', t.key(7, 'id.jpg'), t.key(7, 'me.jpg'));
  PERFORM t.check('Grace asks for verification', r ->> 'success' = 'true', r::text);
  r := t.review(t.check_of(7), true);
  PERFORM t.check('...and is verified', r ->> 'success' = 'true', r::text);
END $$;
SELECT t.login(4);
SELECT public.set_my_national_id('UG', 'CM1111111111AA');
SELECT t.as_admin();
UPDATE public.national_id_enforcement SET enforced = true, enforced_from = now();
DO $$ BEGIN
  PERFORM t.check('enforced, require_verified OFF: an ID on file can send',
    t.err($q$UPDATE public.user_accounts SET ugx_balance = ugx_balance - 1 WHERE user_id = t.u(4)$q$) = '');
  PERFORM t.check('enforced: no ID at all cannot send',
    t.err($q$UPDATE public.user_accounts SET ugx_balance = ugx_balance - 1 WHERE user_id = t.u(5)$q$) ILIKE '%NATIONAL_ID_REQUIRED%');
END $$;
UPDATE public.national_id_enforcement SET require_verified = true;
DO $$ BEGIN
  PERFORM t.check('require_verified: a saved but unverified ID cannot send',
    t.err($q$UPDATE public.user_accounts SET ugx_balance = ugx_balance - 1 WHERE user_id = t.u(4)$q$) ILIKE '%NATIONAL_ID_NOT_VERIFIED%');
  PERFORM t.check('require_verified: a verified ID can send',
    t.err($q$UPDATE public.user_accounts SET ugx_balance = ugx_balance - 1 WHERE user_id = t.u(7)$q$) = '');
  PERFORM t.check('require_verified: receiving money is never blocked',
    t.err($q$UPDATE public.user_accounts SET ugx_balance = ugx_balance + 5 WHERE user_id = t.u(4)$q$) = '');
  PERFORM t.check('require_verified: a wallet can still be finished with an ID that is only saved',
    t.err($q$UPDATE public.user_accounts SET pin_hash = 'hash' WHERE user_id = t.u(4)$q$) = '');
  PERFORM t.check('require_verified: ...but not with no ID',
    t.err($q$UPDATE public.user_accounts SET pin_hash = 'hash' WHERE user_id = t.u(5)$q$) ILIKE '%NATIONAL_ID_REQUIRED%');
  PERFORM t.check('the squatter who lost the ID cannot send any more than someone with none',
    t.err($q$UPDATE public.user_accounts SET ugx_balance = ugx_balance - 1 WHERE user_id = t.u(2)$q$) ILIKE '%NATIONAL_ID_REQUIRED%');
END $$;
INSERT INTO public.national_id_exemptions (user_id, reason) VALUES (t.u(5), 'treasury');
DO $$ BEGIN
  PERFORM t.check('an exempt account keeps moving money', t.err($q$UPDATE public.user_accounts SET ugx_balance = ugx_balance - 1 WHERE user_id = t.u(5)$q$) = '');
END $$;
UPDATE public.national_id_enforcement SET enforced = false, require_verified = false;

-- ═══ 11. the status the app reads ═══════════════════════════════════════════
DO $$ DECLARE s JSONB; BEGIN
  s := t.status(7);
  PERFORM t.check('status carries the verification fields',
    s ? 'verified' AND s ? 'requireVerified' AND s ? 'walletName' AND s ? 'check' AND s ->> 'verified' = 'true' AND s ->> 'idType' = 'NIN', s::text);
  PERFORM t.check('an unverified holder does not see a name on the ID', (t.status(4)) ->> 'nameOnId' IS NULL);
  PERFORM t.check('a person with no request has no check', (t.status(5)) -> 'check' = 'null'::jsonb);
END $$;
SELECT t.as_admin();
