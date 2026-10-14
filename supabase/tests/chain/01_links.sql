\set ON_ERROR_STOP on
-- Linking a wallet address: the one-time challenge, the relayer's confirmation, one account per address, and who can
-- call what. Also the helpers the other files use.

TRUNCATE public.ican_user_wallets, public.ican_coin_transactions;
TRUNCATE icanera_chain.locked_entries, icanera_chain.bridge_deposits, icanera_chain.bridge_withdrawals,
         icanera_chain.user_addresses, icanera_chain.link_challenges, icanera_chain.anomalies, icanera_chain.supply_checks,
         icanera_chain.sync_state, icanera_chain.fx_observations RESTART IDENTITY CASCADE;

-- 40 hex characters, built from a number: t.a(1) = 0x0000...0001
CREATE FUNCTION t.a(n INT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$ SELECT '0x' || lpad(to_hex(n), 40, '0') $$;
CREATE FUNCTION t.h(n INT)  RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$ SELECT '0x' || lpad(to_hex(n), 64, '0') $$;
CREATE FUNCTION t.sig() RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$ SELECT '0x' || repeat('1b', 65) $$;

-- as a user: ask for the challenge; as the relayer: confirm it. Returns the relayer's answer.
CREATE FUNCTION t.link(n INT, addr TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE c JSONB; r JSONB;
BEGIN
  PERFORM t.as_user(t.u(n));
  c := public.ican_chain_link_challenge(addr);
  PERFORM t.reset();
  IF NOT COALESCE((c ->> 'success')::BOOLEAN, FALSE) OR c ->> 'challenge_id' IS NULL THEN RETURN c; END IF;
  PERFORM t.as_service();
  r := public.ican_chain_operator_link((c ->> 'challenge_id')::UUID, t.sig());
  PERFORM t.reset();
  RETURN r;
END; $$;
CREATE FUNCTION t.cfg(p_changes JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  PERFORM t.as_user(t.u(1));
  r := public.ican_chain_dev_set_contracts('dev_test_secret', p_changes);
  PERFORM t.reset();
  RETURN r;
END; $$;
CREATE FUNCTION t.set(p_changes JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  PERFORM t.as_user(t.u(1));
  r := public.ican_chain_dev_set_settings('dev_test_secret', p_changes);
  PERFORM t.reset();
  RETURN r;
END; $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;

INSERT INTO auth.users (id, email) SELECT t.u(n), 'c' || n || '@test.dev' FROM generate_series(1, 60) n ON CONFLICT DO NOTHING;

-- ================================================================ 1. Who may call what
DO $t$
DECLARE e TEXT; r JSONB; f TEXT;
BEGIN
  PERFORM t.check('1.1 a signed-out visitor can read the public config and the FX rate',
    has_function_privilege('anon', 'public.ican_chain_public_config()', 'EXECUTE') AND has_function_privilege('anon', 'public.ican_fx_rate(text)', 'EXECUTE'));
  FOREACH f IN ARRAY ARRAY['ican_chain_link_challenge(text)', 'ican_chain_unlink_address(text)', 'ican_bridge_request_withdrawal(numeric,text,text)',
                            'ican_bridge_cancel_withdrawal(uuid)', 'ican_chain_my_overview()'] LOOP
    PERFORM t.check('1.2 ' || f || ': not for anon, yes for a signed-in user',
      NOT has_function_privilege('anon', 'public.' || f, 'EXECUTE') AND has_function_privilege('authenticated', 'public.' || f, 'EXECUTE'));
  END LOOP;
  FOREACH f IN ARRAY ARRAY['ican_chain_operator_lease(text,text,int)', 'ican_chain_operator_release(text,text)', 'ican_chain_operator_cursor(text,bigint)',
                            'ican_chain_operator_next_mints(int,int)', 'ican_chain_operator_mark_submitted(uuid,text)', 'ican_chain_operator_requeue(uuid,text)',
                            'ican_chain_operator_record_mint(bigint,text,text,int,bigint,text,text)', 'ican_chain_operator_record_burn(bigint,text,int,bigint,text,text,text)',
                            'ican_chain_operator_retry_unclaimed(int)', 'ican_chain_operator_check_supply(bigint,bigint,text)', 'ican_chain_operator_halt(text)',
                            'ican_chain_operator_link(uuid,text)', 'ican_chain_operator_get_challenge(uuid)', 'ican_chain_operator_sync_contracts(text,text,text,text)', 'ican_chain_operator_adopt_chain(bigint)', 'ican_chain_operator_fx_observe(text,numeric,text,timestamptz)'] LOOP
    PERFORM t.check('1.3 ' || f || ': the relayer (service role) only',
      has_function_privilege('service_role', 'public.' || f, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.' || f, 'EXECUTE') AND NOT has_function_privilege('anon', 'public.' || f, 'EXECUTE'));
  END LOOP;
  PERFORM t.as_user(t.u(1));
  e := t.err($$SELECT public.ican_chain_operator_halt('i am a user')$$);
  PERFORM t.reset();
  PERFORM t.check('1.4 a signed-in user calling a relayer function is refused outright', e LIKE 'permission denied%', e);
  -- even a caller that reaches the function (a superuser session) is stopped by its own check unless it is the service role
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  e := t.err($$SELECT public.ican_chain_operator_halt('forged')$$);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM t.check('1.5 the second lock: the function itself refuses a caller whose role is not service_role', e = 'unauthorized', e);
  PERFORM t.check('1.6 no table in the schema is open to the API roles',
    NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'icanera_chain' AND grantee IN ('anon', 'authenticated', 'PUBLIC')));
  PERFORM t.check('1.7 row level security is on for every table in the schema',
    NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'icanera_chain' AND c.relkind = 'r' AND NOT c.relrowsecurity));
  PERFORM t.as_user(t.u(1));
  e := t.err($$SELECT * FROM icanera_chain.bridge_withdrawals$$);
  PERFORM t.reset();
  PERFORM t.check('1.8 a user cannot read the bridge tables directly', e LIKE 'permission denied%', e);
  PERFORM t.as_anon();
  r := public.ican_chain_public_config();
  PERFORM t.reset();
  PERFORM t.check('1.9 the public config says the bridge is off and nothing is deployed yet',
    (r ->> 'installed')::BOOLEAN AND NOT (r ->> 'bridge_enabled')::BOOLEAN AND r ->> 'chain_id' IS NULL AND r ->> 'icec_community_address' IS NULL, r::TEXT);
  PERFORM t.check('1.10 and it holds nothing secret', NOT (r ? 'operator') AND NOT (r::TEXT ILIKE '%secret%') AND NOT (r::TEXT ILIKE '%key%'));
END $t$;

-- ================================================================ 2. Before anything is deployed
DO $t$
DECLARE r JSONB;
BEGIN
  PERFORM t.as_user(t.u(1));
  r := public.ican_chain_link_challenge(t.a(1));
  PERFORM t.reset();
  PERFORM t.check('2.1 linking says "not set up yet" until the contracts are configured', r ->> 'code' = 'not_configured', r::TEXT);
  PERFORM t.as_user(t.u(1));
  r := public.ican_bridge_request_withdrawal(5, t.a(1), 'req-before-0001');
  PERFORM t.reset();
  PERFORM t.check('2.2 so does a withdrawal', r ->> 'code' = 'not_configured', r::TEXT);
END $t$;
DO $t$
DECLARE e TEXT;
BEGIN
  PERFORM t.as_user(t.u(1));
  e := t.err($$SELECT public.ican_chain_dev_set_settings('dev_test_secret', '{"bridge_enabled": true}')$$);
  PERFORM t.reset();
  PERFORM t.check('2.3 the bridge cannot be turned on before a chain and contract are set', e LIKE 'save the ICEC-C contract address first%', e);
  PERFORM t.as_user(t.u(1));
  e := t.err($$SELECT public.ican_chain_dev_set_settings('wrong', '{}')$$);
  PERFORM t.reset();
  PERFORM t.check('2.4 the admin functions need the dev token', e = 'unauthorized', e);
  PERFORM t.as_user(t.u(1));
  e := t.err($$SELECT public.ican_chain_dev_set_settings('dev_test_secret', '{"fee_bps": 5}')$$);
  PERFORM t.reset();
  PERFORM t.check('2.5 an unknown setting is refused, not ignored', e LIKE 'unknown setting%', e);
  PERFORM t.as_user(t.u(1));
  e := t.err($$SELECT public.ican_chain_dev_set_contracts('dev_test_secret', '{"icec_community_address": "0x1234"}')$$);
  PERFORM t.reset();
  PERFORM t.check('2.6 a malformed address is refused, naming the field and what was expected', e LIKE 'icec_community_address needs one contract address%' AND e LIKE '%Got "0x1234"%', e);
END $t$;

-- the network the rest of the tests use: chain 31337 (a local Hardhat chain), with upper-case input to prove it is normalised
SELECT t.cfg(jsonb_build_object('chain_id', 31337, 'icec_community_address', '0x' || upper(substr(t.a(900), 3)),
  'stable_token_address', t.a(901), 'stable_vault_address', t.a(902), 'reserve_token_address', t.a(903)));
SELECT t.set('{"min_withdrawal_icec": 1, "max_withdrawal_icec": 100, "max_daily_withdrawal_icec": 300, "max_withdrawals_per_hour": 100, "chain_name": "Local", "explorer_url": "https://explorer.test"}');

DO $t$
DECLARE r JSONB; s icanera_chain.chain_settings;
BEGIN
  SELECT * INTO s FROM icanera_chain.chain_settings;
  PERFORM t.check('2.7 contract addresses are stored lower-case', s.icec_community_address = t.a(900) AND s.chain_id = 31337, s.icec_community_address);
  r := public.ican_chain_public_config();
  PERFORM t.check('2.8 the public config now shows where everything is',
    r ->> 'icec_community_address' = t.a(900) AND r ->> 'stable_vault_address' = t.a(902) AND (r ->> 'chain_id')::BIGINT = 31337 AND r ->> 'chain_name' = 'Local', r::TEXT);
END $t$;

-- ================================================================ 2b. Addresses and the chain id that fill themselves in
DO $t$
DECLARE r JSONB; e TEXT; a TEXT := '0x00000000000000000000000000000000000000ab'; s icanera_chain.chain_settings;
BEGIN
  SELECT * INTO s FROM icanera_chain.chain_settings;
  PERFORM t.check('2b.1 the token and reserve that were sent are ignored: the chain knows them, so the database holds none yet', s.stable_token_address IS NULL AND s.reserve_token_address IS NULL, s.stable_token_address);
  r := t.cfg('{"stable_token_address": "definitely not an address", "reserve_token_address": ""}');
  PERFORM t.check('2b.2 a malformed stable_token_address is never an error (it is not something a person types)', (r ->> 'success')::BOOLEAN AND r -> 'auto_detected' ? 'stable_token_address' AND r::TEXT LIKE '%read from the vault on the chain%', r::TEXT);

  PERFORM t.check('2b.3 an address is found in plain text, in capitals, with quotes or spaces, without 0x, or inside an explorer link',
    icanera_chain.extract_address(a) = a AND icanera_chain.extract_address('  0X00000000000000000000000000000000000000AB ') = a
    AND icanera_chain.extract_address('"' || a || '"') = a AND icanera_chain.extract_address(substr(a, 3)) = a
    AND icanera_chain.extract_address('https://sepolia.etherscan.io/address/' || a || '#code') = a
    AND icanera_chain.extract_address('https://x/address/' || a || '?a=' || a) = a);
  PERFORM t.check('2b.4 but it never guesses: a transaction hash, two different addresses, or text with none give nothing',
    icanera_chain.extract_address('0x' || repeat('ab', 32)) IS NULL AND icanera_chain.extract_address('https://x/tx/0x' || repeat('ab', 32)) IS NULL
    AND icanera_chain.extract_address(a || ' and ' || t.a(7)) IS NULL AND icanera_chain.extract_address('hello') IS NULL
    AND icanera_chain.extract_address('0x1234') IS NULL AND icanera_chain.extract_address(NULL) IS NULL AND icanera_chain.extract_address('') IS NULL);
  r := t.cfg(jsonb_build_object('stable_vault_address', 'https://sepolia.etherscan.io/address/' || upper(a)));
  PERFORM t.check('2b.5 pasting an explorer link for the vault works', r -> 'config' ->> 'stable_vault_address' = a, r::TEXT);
  PERFORM t.as_user(t.u(1));
  e := t.err($$SELECT public.ican_chain_dev_set_contracts('dev_test_secret', '{"stable_vault_address": "nope"}')$$);
  PERFORM t.reset();
  PERFORM t.check('2b.6 a vault that is not an address is refused, by name', e LIKE 'stable_vault_address needs one contract address%', e);
  PERFORM t.as_user(t.u(1));
  e := t.err($$SELECT public.ican_chain_dev_set_contracts('dev_test_secret', '{"chain_id": "abc"}')$$);
  PERFORM t.reset();
  PERFORM t.check('2b.7 a chain id that is not a number is refused, with an example', e LIKE 'chain_id must be a whole number such as 11155111%', e);
  PERFORM t.as_user(t.u(1));
  e := t.err($$SELECT public.ican_chain_dev_set_contracts('dev_test_secret', '{"chain_id": -5}')$$);
  PERFORM t.reset();
  PERFORM t.check('2b.8 so is a negative one', e LIKE 'chain_id must be a whole number%', e);
  r := t.cfg('{"chain_id": "31337"}');
  PERFORM t.check('2b.9 a chain id sent as text is fine, and an empty settings object changes nothing', (r ->> 'success')::BOOLEAN AND (t.cfg('{}') ->> 'success')::BOOLEAN AND (r -> 'config' ->> 'chain_id')::BIGINT = 31337, r::TEXT);

  -- the relayer writes down what the vault says
  PERFORM t.as_service();
  r := public.ican_chain_operator_sync_contracts(a, t.a(901), t.a(903), 'USDC');
  PERFORM t.reset();
  SELECT * INTO s FROM icanera_chain.chain_settings;
  PERFORM t.check('2b.10 the relayer records the token, the reserve coin and its symbol from the vault, and when it checked',
    (r ->> 'success')::BOOLEAN AND (r ->> 'changed')::BOOLEAN AND s.stable_token_address = t.a(901) AND s.reserve_token_address = t.a(903) AND s.reserve_token_symbol = 'USDC' AND s.contracts_checked_at IS NOT NULL, r::TEXT);
  PERFORM t.as_service();
  r := public.ican_chain_operator_sync_contracts(a, t.a(901), t.a(903), 'USDC');
  PERFORM t.reset();
  PERFORM t.check('2b.11 saying the same again changes nothing', (r ->> 'success')::BOOLEAN AND NOT (r ->> 'changed')::BOOLEAN, r::TEXT);
  PERFORM t.as_service();
  r := public.ican_chain_operator_sync_contracts(t.a(777), t.a(901), t.a(903), 'USDC');
  PERFORM t.reset();
  PERFORM t.check('2b.12 facts read from a vault that is no longer the configured one are not written (a change of vault in between)', r ->> 'code' = 'vault_changed' AND NOT (r ->> 'success')::BOOLEAN, r::TEXT);
  PERFORM t.as_service();
  PERFORM t.check('2b.13 bad detections raise', t.err(format($q$SELECT public.ican_chain_operator_sync_contracts(%L, 'x', %L, 'USDC')$q$, a, t.a(903))) = 'bad contract detection'
    AND t.err(format($q$SELECT public.ican_chain_operator_sync_contracts(%L, %L, %L, 'a b c')$q$, a, t.a(901), t.a(903))) = 'bad contract detection');
  PERFORM t.reset();
  r := t.cfg(jsonb_build_object('stable_vault_address', t.a(5678)));
  SELECT * INTO s FROM icanera_chain.chain_settings;
  PERFORM t.check('2b.14 a NEW vault clears the old vault''s token and reserve at once, so nothing stale is ever shown',
    s.stable_token_address IS NULL AND s.reserve_token_address IS NULL AND s.contracts_checked_at IS NULL AND s.stable_vault_address = t.a(5678) AND r::TEXT LIKE '%read from the vault%', r::TEXT);
  PERFORM t.cfg(jsonb_build_object('stable_vault_address', a));
END $t$;

-- the chain id: adopted from the network the relayer is on, once, and never changed from there
DO $t$
DECLARE r1 JSONB; r2 JSONB; r3 JSONB; r4 JSONB; chain0 BIGINT; name1 TEXT; ex1 TEXT; chain1 BIGINT;
BEGIN
  BEGIN
    UPDATE icanera_chain.chain_settings SET chain_id = NULL, chain_name = NULL, explorer_url = NULL;
    PERFORM t.as_service();
    r1 := public.ican_chain_operator_adopt_chain(11155111);
    r2 := public.ican_chain_operator_adopt_chain(11155111);
    r3 := public.ican_chain_operator_adopt_chain(1);
    PERFORM t.reset();
    SELECT chain_id, chain_name, explorer_url INTO chain1, name1, ex1 FROM icanera_chain.chain_settings;
    PERFORM t.as_service();
    r4 := public.ican_chain_operator_adopt_chain(0) ;
    PERFORM t.reset();
    RAISE EXCEPTION 'undo' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
            WHEN OTHERS THEN PERFORM t.reset(); chain0 := -1; r4 := to_jsonb(SQLERRM);
  END;
  PERFORM t.check('2c.1 with no chain set, the relayer''s chain is adopted, and a known network gets its name and explorer link',
    (r1 ->> 'adopted')::BOOLEAN AND chain1 = 11155111 AND name1 = 'Sepolia' AND ex1 = 'https://sepolia.etherscan.io', r1::TEXT || name1);
  PERFORM t.check('2c.2 saying the same chain again is fine and adopts nothing new', (r2 ->> 'success')::BOOLEAN AND NOT (r2 ->> 'adopted')::BOOLEAN, r2::TEXT);
  PERFORM t.check('2c.3 a DIFFERENT chain once one is set is a mismatch, and is never adopted', NOT (r3 ->> 'success')::BOOLEAN AND r3 ->> 'code' = 'chain_mismatch' AND (r3 ->> 'chain_id')::BIGINT = 11155111, r3::TEXT);
  PERFORM t.check('2c.4 nonsense raises', r4 #>> '{}' = 'bad chain id', r4::TEXT);
  PERFORM t.check('2c.5 (the rollback restored the chain the rest of the tests use)', (SELECT chain_id FROM icanera_chain.chain_settings) = 31337);
  PERFORM t.check('2c.6 only the relayer can adopt a chain', NOT has_function_privilege('authenticated', 'public.ican_chain_operator_adopt_chain(bigint)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.ican_chain_operator_adopt_chain(bigint)', 'EXECUTE'));
END $t$;

-- ================================================================ 3. The challenge
DO $t$
DECLARE r JSONB; e TEXT; i INT; n BIGINT; c icanera_chain.link_challenges;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true); PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r := public.ican_chain_link_challenge(t.a(1));
  PERFORM t.reset();
  PERFORM t.check('3.1 a session with no user id cannot start a link', r ->> 'code' = 'not_signed_in', r::TEXT);

  PERFORM t.as_user(t.u(1));
  r := public.ican_chain_link_challenge('not-an-address');
  PERFORM t.reset();
  PERFORM t.check('3.2 a malformed address is refused', r ->> 'code' = 'invalid_address', r::TEXT);

  PERFORM t.as_user(t.u(1));
  r := public.ican_chain_link_challenge('0x' || upper(substr(t.a(1), 3)));
  PERFORM t.reset();
  SELECT * INTO c FROM icanera_chain.link_challenges WHERE id = (r ->> 'challenge_id')::UUID;
  PERFORM t.check('3.3 a challenge is issued for the account, chain and (lower-cased) address',
    c.user_id = t.u(1) AND c.chain_id = 31337 AND c.address = t.a(1) AND c.used_at IS NULL, r::TEXT);
  PERFORM t.check('3.4 the message the wallet signs names the address, the account, the chain and an expiry, and says it moves no funds',
    r ->> 'message' LIKE '%Address: ' || t.a(1) || '%' AND r ->> 'message' LIKE '%Account: ' || t.u(1)::TEXT || '%'
    AND r ->> 'message' LIKE '%Chain ID: 31337%' AND r ->> 'message' LIKE '%Expires: 20%' AND r ->> 'message' ILIKE '%does not move any funds%', r ->> 'message');
  PERFORM t.check('3.5 the stored message is exactly what was returned', c.message = r ->> 'message');
  PERFORM t.as_user(t.u(1));
  e := (public.ican_chain_link_challenge(t.a(1)) ->> 'message');
  PERFORM t.reset();
  PERFORM t.check('3.6 each challenge has its own nonce (two requests never produce the same text)', e IS DISTINCT FROM (r ->> 'message'));

  -- rate limit: 10 challenges an hour
  FOR i IN 1..12 LOOP
    PERFORM t.as_user(t.u(2));
    r := public.ican_chain_link_challenge(t.a(100 + i));
    PERFORM t.reset();
  END LOOP;
  SELECT count(*) INTO n FROM icanera_chain.link_challenges WHERE user_id = t.u(2);
  PERFORM t.check('3.7 challenges are rate limited (10 an hour)', r ->> 'code' = 'rate_limited' AND n = 10, 'issued ' || n);
END $t$;

-- ================================================================ 4. The relayer confirms the link
DO $t$
DECLARE r JSONB; c JSONB; ch UUID; e TEXT; a icanera_chain.user_addresses;
BEGIN
  PERFORM t.as_user(t.u(3));
  c := public.ican_chain_link_challenge(t.a(3));
  PERFORM t.reset();
  ch := (c ->> 'challenge_id')::UUID;

  PERFORM t.as_service();
  r := public.ican_chain_operator_link(ch, 'nonsense');
  PERFORM t.check('4.1 a malformed signature is refused', r ->> 'code' = 'invalid_signature', r::TEXT);
  r := public.ican_chain_operator_link(gen_random_uuid(), t.sig());
  PERFORM t.check('4.2 an unknown challenge is refused', r ->> 'code' = 'unknown_challenge', r::TEXT);
  r := public.ican_chain_operator_link(ch, t.sig());
  PERFORM t.reset();
  SELECT * INTO a FROM icanera_chain.user_addresses WHERE address = t.a(3);
  PERFORM t.check('4.3 the link is recorded for the account that asked, with the proof kept',
    (r ->> 'success')::BOOLEAN AND a.user_id = t.u(3) AND a.chain_id = 31337 AND a.signature = t.sig() AND a.revoked_at IS NULL, r::TEXT);
  PERFORM t.as_service();
  r := public.ican_chain_operator_link(ch, t.sig());
  PERFORM t.reset();
  PERFORM t.check('4.4 the same challenge cannot be used twice (no replay)', r ->> 'code' = 'challenge_used', r::TEXT);
  PERFORM t.as_user(t.u(3));
  r := public.ican_chain_link_challenge(t.a(3));
  PERFORM t.reset();
  PERFORM t.check('4.5 asking to link an address that is already yours just says so', (r ->> 'already_linked')::BOOLEAN, r::TEXT);

  -- a challenge that has expired
  INSERT INTO icanera_chain.link_challenges (id, user_id, chain_id, address, message, expires_at)
  VALUES ('00000000-0000-0000-0000-00000000e001', t.u(4), 31337, t.a(4), 'old', now() - INTERVAL '1 minute');
  PERFORM t.as_service();
  r := public.ican_chain_operator_link('00000000-0000-0000-0000-00000000e001', t.sig());
  PERFORM t.reset();
  PERFORM t.check('4.6 an expired challenge is refused', r ->> 'code' = 'challenge_expired', r::TEXT);

  -- a challenge for a different chain than the one configured
  INSERT INTO icanera_chain.link_challenges (id, user_id, chain_id, address, message, expires_at)
  VALUES ('00000000-0000-0000-0000-00000000e002', t.u(4), 1, t.a(4), 'wrong chain', now() + INTERVAL '5 minutes');
  PERFORM t.as_service();
  r := public.ican_chain_operator_link('00000000-0000-0000-0000-00000000e002', t.sig());
  PERFORM t.reset();
  PERFORM t.check('4.7 a challenge made for another chain is refused', r ->> 'code' = 'wrong_chain', r::TEXT);

  -- what the relayer reads to check a signature
  PERFORM t.as_service();
  r := public.ican_chain_operator_get_challenge(ch);
  PERFORM t.reset();
  PERFORM t.check('4.7b the relayer can read a challenge: whose it is, the address, the exact text, and that it is used up',
    (r ->> 'found')::BOOLEAN AND r ->> 'user_id' = t.u(3)::TEXT AND r ->> 'address' = t.a(3) AND r ->> 'message' = c ->> 'message' AND (r ->> 'used')::BOOLEAN AND NOT (r ->> 'expired')::BOOLEAN, r::TEXT);
  PERFORM t.as_service();
  r := public.ican_chain_operator_get_challenge(gen_random_uuid());
  PERFORM t.reset();
  PERFORM t.check('4.7c an unknown challenge reads as not found', NOT (r ->> 'found')::BOOLEAN, r::TEXT);

  -- one account per address
  PERFORM t.as_user(t.u(5));
  r := public.ican_chain_link_challenge(t.a(3));
  PERFORM t.reset();
  PERFORM t.check('4.8 an address already linked to someone else cannot be linked again', r ->> 'code' = 'address_taken', r::TEXT);
  INSERT INTO icanera_chain.link_challenges (id, user_id, chain_id, address, message, expires_at)
  VALUES ('00000000-0000-0000-0000-00000000e003', t.u(5), 31337, t.a(3), 'sneaky', now() + INTERVAL '5 minutes');
  PERFORM t.as_service();
  r := public.ican_chain_operator_link('00000000-0000-0000-0000-00000000e003', t.sig());
  PERFORM t.reset();
  PERFORM t.check('4.9 ...even if a challenge for it is forced through, the relayer step refuses', r ->> 'code' = 'address_taken', r::TEXT);
  PERFORM t.check('4.10 and the address still belongs to its first owner', (SELECT user_id FROM icanera_chain.user_addresses WHERE address = t.a(3)) = t.u(3));

  -- the full helper, and a limit of 3 addresses
  PERFORM t.check('4.11 t.link links an address end to end', (t.link(6, t.a(61)) ->> 'success')::BOOLEAN);
  PERFORM t.check('4.12 a second address', (t.link(6, t.a(62)) ->> 'success')::BOOLEAN);
  PERFORM t.check('4.13 a third address', (t.link(6, t.a(63)) ->> 'success')::BOOLEAN);
  r := t.link(6, t.a(64));
  PERFORM t.check('4.14 a fourth is refused (limit 3)', r ->> 'code' = 'too_many_addresses', r::TEXT);
  r := t.link(7, '0x' || upper(substr(t.a(171), 3)));
  PERFORM t.check('4.15 a mixed-case address is stored lower-case',
    (r ->> 'success')::BOOLEAN AND EXISTS (SELECT 1 FROM icanera_chain.user_addresses WHERE address = t.a(171) AND user_id = t.u(7)), r::TEXT);
END $t$;

-- ================================================================ 5. Unlinking
SELECT t.link(8, t.a(81));
DO $t$
DECLARE r JSONB; e TEXT; w JSONB;
BEGIN
  PERFORM t.as_user(t.u(8));
  r := public.ican_chain_unlink_address(t.a(99));
  PERFORM t.reset();
  PERFORM t.check('5.1 unlinking an address that is not yours is refused', r ->> 'code' = 'address_not_found', r::TEXT);
  PERFORM t.as_user(t.u(9));
  r := public.ican_chain_unlink_address(t.a(81));
  PERFORM t.reset();
  PERFORM t.check('5.2 ...and so is unlinking someone else''s', r ->> 'code' = 'address_not_found', r::TEXT);
  PERFORM t.as_user(t.u(8));
  r := public.ican_chain_unlink_address(t.a(81));
  PERFORM t.reset();
  PERFORM t.check('5.3 unlinking your own works', (r ->> 'success')::BOOLEAN, r::TEXT);
  PERFORM t.check('5.4 the address is marked revoked, not deleted', (SELECT revoked_at IS NOT NULL FROM icanera_chain.user_addresses WHERE address = t.a(81)));
  PERFORM t.as_user(t.u(9));
  r := public.ican_chain_link_challenge(t.a(81));
  PERFORM t.reset();
  PERFORM t.check('5.6 ...it reports address_taken to another account', r ->> 'code' = 'address_taken', r::TEXT);
  -- a revoked address can be linked again by the same account with a fresh proof
  r := t.link(8, t.a(81));
  PERFORM t.check('5.7 the owner can link it again with a fresh proof', (r ->> 'success')::BOOLEAN AND NOT COALESCE((r ->> 'already_linked')::BOOLEAN, FALSE), r::TEXT);
  PERFORM t.check('5.8 and it is active again', (SELECT revoked_at IS NULL FROM icanera_chain.user_addresses WHERE address = t.a(81)));
END $t$;

-- ================================================================ 6. Link records cannot be tampered with
DO $t$
DECLARE e TEXT;
BEGIN
  e := t.err(format($q$UPDATE icanera_chain.user_addresses SET user_id = %L WHERE address = %L$q$, t.u(30), t.a(3)));
  PERFORM t.check('6.1 a linked address cannot be moved to another account', e LIKE 'a linked address cannot be moved%', e);
  e := t.err(format($q$UPDATE icanera_chain.user_addresses SET address = %L WHERE address = %L$q$, t.a(77), t.a(3)));
  PERFORM t.check('6.2 nor changed to another address', e LIKE 'a linked address cannot be moved%', e);
  e := t.err(format($q$DELETE FROM icanera_chain.user_addresses WHERE address = %L$q$, t.a(3)));
  PERFORM t.check('6.3 nor deleted', e LIKE 'user_addresses rows are never deleted%', e);
  e := t.err($q$UPDATE icanera_chain.link_challenges SET used_at = NULL WHERE used_at IS NOT NULL$q$);
  PERFORM t.check('6.4 a used challenge cannot be reset for reuse', e LIKE 'a signed challenge cannot be altered%', e);
  e := t.err($q$UPDATE icanera_chain.link_challenges SET message = 'edited' WHERE used_at IS NULL$q$);
  PERFORM t.check('6.5 an open challenge''s text cannot be edited', e LIKE 'a signed challenge cannot be altered%', e);
END $t$;
