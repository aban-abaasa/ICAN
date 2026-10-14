\set ON_ERROR_STOP on
-- The ICEC bridge: withdrawing to the chain, taking a withdrawal back, what the relayer may record, how a burn becomes
-- ledger credit (and when it does not), the supply cross-check, the books, and that nothing can be edited after the fact.
-- The chain is simulated by calling the relayer's functions directly with what a real chain would have emitted.

TRUNCATE public.ican_user_wallets, public.ican_coin_transactions;
TRUNCATE icanera_chain.locked_entries, icanera_chain.bridge_deposits, icanera_chain.bridge_withdrawals,
         icanera_chain.user_addresses, icanera_chain.link_challenges, icanera_chain.anomalies, icanera_chain.supply_checks,
         icanera_chain.sync_state RESTART IDENTITY CASCADE;

-- named ids so one block can refer to what another created
CREATE TABLE t.ids (name TEXT PRIMARY KEY, id UUID);
GRANT ALL ON t.ids TO PUBLIC;
CREATE FUNCTION t.id(p_name TEXT) RETURNS UUID LANGUAGE sql AS $$ SELECT id FROM t.ids WHERE name = p_name $$;

CREATE FUNCTION t.wd(n INT, amt NUMERIC, addr TEXT, rid TEXT, p_name TEXT DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  PERFORM t.as_user(t.u(n));
  r := public.ican_bridge_request_withdrawal(amt, addr, rid);
  PERFORM t.reset();
  IF p_name IS NOT NULL AND (r ->> 'success')::BOOLEAN THEN
    INSERT INTO t.ids VALUES (p_name, (r -> 'withdrawal' ->> 'id')::UUID) ON CONFLICT (name) DO UPDATE SET id = EXCLUDED.id;
  END IF;
  RETURN r;
END; $$;
CREATE FUNCTION t.cancel(n INT, wid UUID) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  PERFORM t.as_user(t.u(n));
  r := public.ican_bridge_cancel_withdrawal(wid);
  PERFORM t.reset();
  RETURN r;
END; $$;
CREATE FUNCTION t.bal(n INT) RETURNS NUMERIC LANGUAGE sql AS $$ SELECT COALESCE((SELECT ican_balance FROM public.ican_user_wallets WHERE user_id = t.u(n)), 0) $$;
CREATE FUNCTION t.locked() RETURNS NUMERIC LANGUAGE sql AS $$ SELECT icanera_chain.locked_total() $$;
CREATE FUNCTION t.rec() RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  PERFORM t.as_user(t.u(1));
  r := public.ican_chain_dev_reconcile('dev_test_secret');
  PERFORM t.reset();
  RETURN r;
END; $$;
CREATE FUNCTION t.w(p_id UUID) RETURNS icanera_chain.bridge_withdrawals LANGUAGE sql AS $$ SELECT * FROM icanera_chain.bridge_withdrawals WHERE id = p_id $$;

-- the relayer, as the service role
CREATE FUNCTION t.sub(p_id UUID, tx INT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  PERFORM t.as_service();
  r := public.ican_chain_operator_mark_submitted(p_id, t.h(tx));
  PERFORM t.reset();
  RETURN r;
END; $$;
-- report the mint event a real chain would emit for this withdrawal (optionally altered)
CREATE FUNCTION t.mint(p_id UUID, tx INT, blk BIGINT, p_to TEXT DEFAULT NULL, p_units TEXT DEFAULT NULL, p_chain BIGINT DEFAULT 31337, p_ref TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE w icanera_chain.bridge_withdrawals; r JSONB;
BEGIN
  SELECT * INTO w FROM icanera_chain.bridge_withdrawals WHERE id = p_id;
  PERFORM t.as_service();
  r := public.ican_chain_operator_record_mint(p_chain, COALESCE(p_ref, w.ref), t.h(tx), 0, blk, COALESCE(p_to, w.to_address), COALESCE(p_units, w.amount_units::TEXT));
  PERFORM t.reset();
  RETURN r;
END; $$;
CREATE FUNCTION t.burn(addr TEXT, units NUMERIC, tx INT, blk BIGINT, p_log INT DEFAULT 0, p_chain BIGINT DEFAULT 31337) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  PERFORM t.as_service();
  r := public.ican_chain_operator_record_burn(p_chain, t.h(tx), p_log, blk, addr, trunc(units)::TEXT, 'credit-' || tx);
  PERFORM t.reset();
  RETURN r;
END; $$;
CREATE FUNCTION t.supply(blk BIGINT, units NUMERIC) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  PERFORM t.as_service();
  r := public.ican_chain_operator_check_supply(31337, blk, trunc(units)::TEXT);
  PERFORM t.reset();
  RETURN r;
END; $$;
-- after an anomaly halted the bridge: look at it, close it, and switch the bridge back on
CREATE FUNCTION t.recover() RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE a RECORD;
BEGIN
  FOR a IN SELECT id FROM icanera_chain.anomalies WHERE resolved_at IS NULL LOOP
    PERFORM t.as_user(t.u(1));
    PERFORM public.ican_chain_dev_resolve_anomaly('dev_test_secret', a.id, 'looked at it in the test, expected');
    PERFORM t.reset();
  END LOOP;
  PERFORM t.set('{"bridge_enabled": true}');
END; $$;
CREATE FUNCTION t.nanom() RETURNS BIGINT LANGUAGE sql AS $$ SELECT count(*) FROM icanera_chain.anomalies WHERE resolved_at IS NULL $$;
CREATE FUNCTION t.enabled() RETURNS BOOLEAN LANGUAGE sql AS $$ SELECT bridge_enabled FROM icanera_chain.chain_settings $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;

INSERT INTO auth.users (id, email) SELECT t.u(n), 'b' || n || '@test.dev' FROM generate_series(1, 99) n ON CONFLICT DO NOTHING;
SELECT t.set('{"bridge_enabled": true, "min_withdrawal_icec": 1, "max_withdrawal_icec": 100, "max_daily_withdrawal_icec": 300, "max_withdrawals_per_hour": 100}');
INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES
  (t.u(10), 1000), (t.u(11), 5), (t.u(12), 50), (t.u(20), 1000), (t.u(21), 1000), (t.u(22), 1000), (t.u(23), 1000), (t.u(24), 1000), (t.u(25), 1000), (t.u(26), 1000);
SELECT t.link(10, t.a(1010)); SELECT t.link(10, t.a(1011)); SELECT t.link(11, t.a(1110)); SELECT t.link(12, t.a(1210));
SELECT t.link(20, t.a(2020)); SELECT t.link(21, t.a(2121)); SELECT t.link(22, t.a(2222)); SELECT t.link(23, t.a(2301)); SELECT t.link(23, t.a(2302));
SELECT t.link(24, t.a(2401)); SELECT t.link(25, t.a(2501)); SELECT t.link(26, t.a(2601));

-- ================================================================ A. Asking to withdraw
DO $t$
DECLARE r JSONB; x RECORD; b0 NUMERIC := t.bal(10);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true); PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r := public.ican_bridge_request_withdrawal(5, t.a(1010), 'req-nosub-0001');
  PERFORM t.reset();
  PERFORM t.check('A.1 a session with no user id cannot withdraw', r ->> 'code' = 'not_signed_in', r::TEXT);
  PERFORM t.as_anon();
  PERFORM t.check('A.2 anon is refused outright', t.err($$SELECT public.ican_bridge_request_withdrawal(5, '0x00', 'req-anon-00001')$$) LIKE 'permission denied%');
  PERFORM t.reset();

  FOR x IN SELECT * FROM (VALUES
      ('zero',            0::NUMERIC,             t.a(1010), 'req-a3-0000001', 'invalid_amount'),
      ('negative',        -5,                      t.a(1010), 'req-a3-0000002', 'invalid_amount'),
      ('NaN',             'NaN',                   t.a(1010), 'req-a3-0000003', 'invalid_amount'),
      ('nine decimals',   0.123456789,             t.a(1010), 'req-a3-0000004', 'invalid_amount'),
      ('absurd',          1e13,                    t.a(1010), 'req-a3-0000005', 'invalid_amount'),
      ('bad address',     5,                       'xyz',     'req-a3-0000006', 'invalid_address'),
      ('short request id',5,                       t.a(1010), 'short',          'invalid_request_id'),
      ('spaces in id',    5,                       t.a(1010), 'has a space 123','invalid_request_id'),
      ('unlinked address',5,                       t.a(5555), 'req-a3-0000009', 'address_not_linked'),
      ('someone else''s', 5,                       t.a(1110), 'req-a3-0000010', 'address_not_linked'),
      ('below minimum',   0.5,                     t.a(1010), 'req-a3-0000011', 'below_minimum'),
      ('above maximum',   101,                     t.a(1010), 'req-a3-0000012', 'above_maximum')
    ) v(label, amt, addr, rid, want) LOOP
    r := t.wd(10, x.amt, x.addr, x.rid);
    PERFORM t.check('A.3 refused: ' || x.label, r ->> 'code' = x.want AND NOT (r ->> 'success')::BOOLEAN, r::TEXT);
  END LOOP;
  r := t.wd(11, 10, t.a(1110), 'req-a3-0000013');
  PERFORM t.check('A.4 refused: more than the balance', r ->> 'code' = 'insufficient_funds', r::TEXT);
  r := t.wd(40, 10, t.a(1110), 'req-a3-0000014');
  PERFORM t.check('A.5 a user with no wallet at all is told they have no balance (not an error)', r ->> 'code' IN ('insufficient_funds', 'address_not_linked'), r::TEXT);
  PERFORM t.check('A.6 every refusal left no withdrawal, no lock and no change to the balance',
    (SELECT count(*) FROM icanera_chain.bridge_withdrawals) = 0 AND t.locked() = 0 AND t.bal(10) = b0);

  PERFORM t.set('{"bridge_enabled": false}');
  r := t.wd(10, 5, t.a(1010), 'req-a7-0000001');
  PERFORM t.check('A.7 while the bridge is paused, new withdrawals are refused', r ->> 'code' = 'bridge_paused', r::TEXT);
  PERFORM t.set('{"bridge_enabled": true}');
END $t$;

DO $t$
DECLARE r JSONB; r2 JSONB; w icanera_chain.bridge_withdrawals; b0 NUMERIC := t.bal(10); ncoin BIGINT;
BEGIN
  SELECT count(*) INTO ncoin FROM public.ican_coin_transactions;
  r := t.wd(10, 30.12345678, t.a(1010), 'wd-10-000001', 'wd1');
  PERFORM t.check('A.8 a valid withdrawal succeeds', (r ->> 'success')::BOOLEAN AND NOT (r ->> 'duplicate')::BOOLEAN, r::TEXT);
  w := t.w(t.id('wd1'));
  PERFORM t.check('A.9 the ledger is debited by exactly that amount, to 8 places', t.bal(10) = b0 - 30.12345678 AND (r ->> 'new_ican_balance')::NUMERIC = b0 - 30.12345678, t.bal(10)::TEXT);
  PERFORM t.check('A.10 the withdrawal is pending, nothing signed yet, for the right address and amount',
    w.status = 'pending' AND w.attempts = 0 AND w.tx_hash IS NULL AND w.to_address = t.a(1010) AND w.amount = 30.12345678 AND w.chain_id = 31337, row_to_json(w)::TEXT);
  PERFORM t.check('A.11 the on-chain amount is the exact 8-decimal integer', w.amount_units = 3012345678, w.amount_units::TEXT);
  PERFORM t.check('A.12 the bytes32 the contract will see is sha256 of the withdrawal id', w.ref = '0x' || encode(sha256(convert_to(w.id::TEXT, 'UTF8')), 'hex') AND w.ref ~ '^0x[0-9a-f]{64}$', w.ref);
  PERFORM t.check('A.13 the amount is locked: one lock entry, and the locked total equals it',
    t.locked() = 30.12345678 AND (SELECT count(*) FROM icanera_chain.locked_entries WHERE withdrawal_id = w.id AND kind = 'lock' AND amount = 30.12345678) = 1);
  PERFORM t.check('A.14 nothing was written to the icaneracoin ledger (the price engine counts those rows as usage)',
    (SELECT count(*) FROM public.ican_coin_transactions) = ncoin);
  PERFORM t.check('A.15 ICEC is conserved: wallet + locked = what it was', t.bal(10) + t.locked() = b0);

  -- a retry of the same request
  r2 := t.wd(10, 30.12345678, t.a(1010), 'wd-10-000001');
  PERFORM t.check('A.16 the same request id again is a duplicate: same withdrawal, nothing moves',
    (r2 ->> 'duplicate')::BOOLEAN AND r2 -> 'withdrawal' ->> 'id' = w.id::TEXT AND t.bal(10) = b0 - 30.12345678 AND t.locked() = 30.12345678, r2::TEXT);
  r2 := t.wd(10, 99, t.a(1011), 'wd-10-000001');
  PERFORM t.check('A.17 ...even if it now asks for a different amount or address, it gets the original back', (r2 ->> 'duplicate')::BOOLEAN AND (r2 -> 'withdrawal' ->> 'amount')::NUMERIC = 30.12345678, r2::TEXT);
  PERFORM t.set('{"bridge_enabled": false}');
  r2 := t.wd(10, 30.12345678, t.a(1010), 'wd-10-000001');
  PERFORM t.set('{"bridge_enabled": true}');
  PERFORM t.check('A.18 ...and a retry still gets its answer while the bridge is paused', (r2 ->> 'success')::BOOLEAN AND (r2 ->> 'duplicate')::BOOLEAN, r2::TEXT);
  r2 := t.wd(11, 1, t.a(1110), 'wd-10-000001');
  PERFORM t.check('A.19 request ids belong to the user: another user''s same id is a different request', (r2 ->> 'success')::BOOLEAN AND NOT (r2 ->> 'duplicate')::BOOLEAN, r2::TEXT);
  PERFORM t.cancel(11, (r2 -> 'withdrawal' ->> 'id')::UUID);
END $t$;

-- daily limit (300), cancelled withdrawals do not count against it
DO $t$
DECLARE r JSONB; b0 NUMERIC := t.bal(10) + t.locked();      -- wallet + locked is what stays constant through every step below
BEGIN
  r := t.wd(10, 100, t.a(1010), 'wd-10-000002', 'wd2');
  r := t.wd(10, 100, t.a(1011), 'wd-10-000003', 'wd3');
  PERFORM t.check('A.20 two more 100s are fine (230.12 so far)', (r ->> 'success')::BOOLEAN, r::TEXT);
  r := t.wd(10, 100, t.a(1010), 'wd-10-000004');
  PERFORM t.check('A.21 a fourth would pass 300 in a day, so it is refused', r ->> 'code' = 'daily_limit', r::TEXT);
  r := t.wd(10, 69.87654322, t.a(1010), 'wd-10-000005', 'wd5');
  PERFORM t.check('A.22 exactly up to the limit is allowed', (r ->> 'success')::BOOLEAN, r::TEXT);
  r := t.wd(10, 1, t.a(1010), 'wd-10-000006');
  PERFORM t.check('A.23 and one ICEC more is not', r ->> 'code' = 'daily_limit', r::TEXT);
  r := t.cancel(10, t.id('wd3'));
  PERFORM t.check('A.24 cancelling a pending withdrawal succeeds and refunds it in full', (r ->> 'success')::BOOLEAN AND (r ->> 'refunded_icec')::NUMERIC = 100, r::TEXT);
  PERFORM t.check('A.25 the refund is the ledger''s, to the cent: wallet + locked = what it was',
    t.bal(10) + t.locked() = b0 AND (t.w(t.id('wd3'))).status = 'cancelled');
  r := t.wd(10, 100, t.a(1010), 'wd-10-000007', 'wd7');
  PERFORM t.check('A.26 a cancelled withdrawal no longer counts against the daily limit', (r ->> 'success')::BOOLEAN, r::TEXT);
  r := t.cancel(10, t.id('wd3'));
  PERFORM t.check('A.27 cancelling again is a no-op that says so, and refunds nothing more', (r ->> 'success')::BOOLEAN AND (r ->> 'duplicate')::BOOLEAN AND t.bal(10) + t.locked() = b0, r::TEXT);
  r := t.cancel(11, t.id('wd2'));
  PERFORM t.check('A.28 you cannot cancel someone else''s withdrawal', r ->> 'code' = 'not_found' AND (t.w(t.id('wd2'))).status = 'pending', r::TEXT);
  r := t.cancel(10, gen_random_uuid());
  PERFORM t.check('A.29 or one that does not exist', r ->> 'code' = 'not_found', r::TEXT);
  PERFORM t.as_anon();
  PERFORM t.check('A.30 anon cannot cancel', t.err($$SELECT public.ican_bridge_cancel_withdrawal(gen_random_uuid())$$) LIKE 'permission denied%');
  PERFORM t.reset();
  PERFORM t.check('A.31 the cancel left exactly one cancel entry', (SELECT count(*) FROM icanera_chain.locked_entries WHERE withdrawal_id = t.id('wd3') AND kind = 'cancel' AND amount = -100) = 1);
END $t$;

-- the hourly cap counts cancelled ones too, so cancel-and-retry cannot be used to flood the queue
DO $t$
DECLARE r JSONB;
BEGIN
  PERFORM t.set('{"max_withdrawals_per_hour": 2}');
  r := t.wd(12, 1, t.a(1210), 'wd-12-000001', 'h1');
  r := t.wd(12, 1, t.a(1210), 'wd-12-000002', 'h2');
  r := t.wd(12, 1, t.a(1210), 'wd-12-000003');
  PERFORM t.check('A.32 a third withdrawal inside the hour is refused', r ->> 'code' = 'rate_limited', r::TEXT);
  PERFORM t.cancel(12, t.id('h1'));
  r := t.wd(12, 1, t.a(1210), 'wd-12-000003');
  PERFORM t.check('A.33 cancelling one does not make room', r ->> 'code' = 'rate_limited', r::TEXT);
  PERFORM t.set('{"max_withdrawals_per_hour": 100}');
  PERFORM t.cancel(12, t.id('h2'));
END $t$;

-- ================================================================ B. The relayer
DO $t$
DECLARE r JSONB; b BOOLEAN; n BIGINT;
BEGIN
  PERFORM t.as_service();
  b := public.ican_chain_operator_lease('sync', 'run-A', 60);
  PERFORM t.check('B.1 the first run takes the lease', b);
  PERFORM t.check('B.2 an overlapping run does not', NOT public.ican_chain_operator_lease('sync', 'run-B', 60));
  PERFORM t.check('B.3 the holder can renew it', public.ican_chain_operator_lease('sync', 'run-A', 60));
  PERFORM public.ican_chain_operator_release('sync', 'run-B');
  PERFORM t.check('B.4 a stranger cannot release it', NOT public.ican_chain_operator_lease('sync', 'run-B', 60));
  PERFORM public.ican_chain_operator_release('sync', 'run-A');
  PERFORM t.check('B.5 once released, another run can take it', public.ican_chain_operator_lease('sync', 'run-B', 60));
  PERFORM t.reset();
  UPDATE icanera_chain.sync_state SET lease_until = now() - INTERVAL '1 second' WHERE name = 'sync';
  PERFORM t.as_service();
  PERFORM t.check('B.6 a lease that expired (a crashed run) can be taken over', public.ican_chain_operator_lease('sync', 'run-C', 60));
  PERFORM t.check('B.7 the cursor starts at zero', public.ican_chain_operator_cursor('scan') = 0);
  PERFORM t.check('B.8 it moves forward', public.ican_chain_operator_cursor('scan', 100) = 100);
  PERFORM t.check('B.9 and never back', public.ican_chain_operator_cursor('scan', 50) = 100 AND public.ican_chain_operator_cursor('scan') = 100);
  PERFORM t.reset();
END $t$;

DO $t$
DECLARE r JSONB; w1 UUID; q JSONB;
BEGIN
  r := t.wd(20, 10, t.a(2020), 'wd-20-000001', 'o1');
  w1 := t.id('o1');
  PERFORM t.as_service();
  q := public.ican_chain_operator_next_mints(50, 180);
  PERFORM t.reset();
  PERFORM t.check('B.10 the queue shows the new withdrawal with what the relayer needs and nothing it does not',
    EXISTS (SELECT 1 FROM jsonb_array_elements(q) e WHERE e ->> 'id' = w1::TEXT AND e ->> 'to' = t.a(2020) AND e ->> 'amount_units' = '1000000000' AND e ->> 'status' = 'pending'
              AND e ->> 'ref' = (t.w(w1)).ref) AND NOT (q::TEXT ILIKE '%user_id%'), q::TEXT);
  PERFORM t.check('B.11 withdrawals that are cancelled or already final are not offered',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(q) e WHERE e ->> 'id' IN (t.id('wd3')::TEXT, t.id('h2')::TEXT)));

  PERFORM t.as_service();
  r := public.ican_chain_operator_mark_submitted(w1, 'zz');
  PERFORM t.check('B.12 a malformed hash is refused', r ->> 'code' = 'invalid_tx_hash', r::TEXT);
  r := public.ican_chain_operator_mark_submitted(gen_random_uuid(), t.h(1));
  PERFORM t.check('B.13 an unknown withdrawal is refused', r ->> 'code' = 'not_found', r::TEXT);
  PERFORM t.reset();
  r := t.sub(w1, 101);
  PERFORM t.check('B.14 recording the signed transaction moves it to submitted and counts the attempt',
    (r ->> 'success')::BOOLEAN AND (t.w(w1)).status = 'submitted' AND (t.w(w1)).tx_hash = t.h(101) AND (t.w(w1)).attempts = 1 AND (t.w(w1)).submitted_at IS NOT NULL, r::TEXT);
  PERFORM t.as_service();
  q := public.ican_chain_operator_next_mints(50, 180);
  PERFORM t.reset();
  PERFORM t.check('B.15 a submitted one that is fresh is not offered again', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(q) e WHERE e ->> 'id' = w1::TEXT));
  UPDATE icanera_chain.bridge_withdrawals SET submitted_at = now() - INTERVAL '1 hour' WHERE id = w1;
  PERFORM t.as_service();
  q := public.ican_chain_operator_next_mints(50, 180);
  PERFORM t.reset();
  PERFORM t.check('B.16 ...but one that has been waiting too long is', EXISTS (SELECT 1 FROM jsonb_array_elements(q) e WHERE e ->> 'id' = w1::TEXT AND e ->> 'status' = 'submitted'));
  r := t.cancel(20, w1);
  PERFORM t.check('B.17 once a transaction is signed the user can no longer cancel (the mint may exist)', r ->> 'code' = 'not_cancellable' AND (t.w(w1)).status = 'submitted', r::TEXT);

  PERFORM t.as_service();
  r := public.ican_chain_operator_requeue(w1, 'reverted: DailyCapExceeded');
  PERFORM t.reset();
  PERFORM t.check('B.18 a reverted attempt goes back in the queue, remembering why', (r ->> 'success')::BOOLEAN AND (t.w(w1)).status = 'pending' AND (t.w(w1)).last_error LIKE '%DailyCap%', r::TEXT);
  r := t.cancel(20, w1);
  PERFORM t.check('B.19 but it is STILL not cancellable: an earlier attempt could yet land', r ->> 'code' = 'not_cancellable' AND (t.w(w1)).status = 'pending' AND (t.w(w1)).attempts = 1, r::TEXT);
  PERFORM t.as_service();
  r := public.ican_chain_operator_requeue(w1, 'again');
  PERFORM t.reset();
  PERFORM t.check('B.20 only a submitted withdrawal can be requeued', r ->> 'code' = 'not_submitted', r::TEXT);

  PERFORM t.set('{"bridge_enabled": false}');
  PERFORM t.as_service();
  q := public.ican_chain_operator_next_mints(50, 180);
  PERFORM t.reset();
  PERFORM t.check('B.21 while the bridge is halted the queue is empty', q = '[]'::JSONB, q::TEXT);
  r := t.sub(w1, 102);
  PERFORM t.check('B.22 ...and the relayer is told not to broadcast', r ->> 'code' = 'halted' AND (t.w(w1)).attempts = 1, r::TEXT);
  PERFORM t.set('{"bridge_enabled": true}');
END $t$;

-- A cancel and a "signed" racing for the same withdrawal: exactly one of them wins.
DO $t$
DECLARE r JSONB; w UUID;
BEGIN
  r := t.wd(20, 5, t.a(2020), 'wd-20-000002', 'o2');
  w := t.id('o2');
  r := t.sub(w, 103);
  PERFORM t.check('B.23 (signed first) the relayer proceeds', (r ->> 'success')::BOOLEAN);
  r := t.cancel(20, w);
  PERFORM t.check('B.24 (signed first) the cancel is refused', r ->> 'code' = 'not_cancellable', r::TEXT);
  r := t.wd(20, 5, t.a(2020), 'wd-20-000003', 'o3');
  w := t.id('o3');
  r := t.cancel(20, w);
  PERFORM t.check('B.25 (cancel first) the cancel works', (r ->> 'success')::BOOLEAN);
  r := t.sub(w, 104);
  PERFORM t.check('B.26 (cancel first) the relayer is told it was cancelled and must not broadcast', r ->> 'code' = 'cancelled' AND (t.w(w)).tx_hash IS NULL AND (t.w(w)).attempts = 0, r::TEXT);
END $t$;

-- ================================================================ B2. What the relayer reports from the chain
DO $t$
DECLARE r JSONB; w UUID := t.id('o1'); wr icanera_chain.bridge_withdrawals; n0 BIGINT;
BEGIN
  wr := t.w(w);
  -- the right event, but the wrong amount / recipient: an anomaly, the bridge halts, the withdrawal does not move
  r := t.mint(w, 201, 1000, p_units => '1000000001');
  PERFORM t.check('B.27 a mint for the wrong amount is an anomaly, not a mint', r ->> 'code' = 'mismatch' AND (t.w(w)).status = 'pending' AND NOT t.enabled() AND t.nanom() = 1, r::TEXT);
  PERFORM t.recover();
  r := t.mint(w, 202, 1000, p_to => t.a(9999));
  PERFORM t.check('B.28 a mint to the wrong address is an anomaly too', r ->> 'code' = 'mismatch' AND (t.w(w)).status = 'pending' AND NOT t.enabled(), r::TEXT);
  PERFORM t.recover();
  r := t.mint(w, 203, 1000, p_ref => '0x' || repeat('ab', 32));
  PERFORM t.check('B.29 a mint for a reference the database never issued is an anomaly that halts the bridge', r ->> 'code' = 'unknown_ref' AND NOT t.enabled(), r::TEXT);
  PERFORM t.check('B.30 ...and the anomaly records what was seen',
    EXISTS (SELECT 1 FROM icanera_chain.anomalies WHERE kind = 'unknown_mint' AND details ->> 'ref' = '0x' || repeat('ab', 32) AND resolved_at IS NULL));
  PERFORM t.recover();
  r := t.mint(w, 204, 1000, p_chain => 1);
  PERFORM t.check('B.31 an event from another chain is an anomaly', r ->> 'code' = 'wrong_chain' AND NOT t.enabled(), r::TEXT);
  PERFORM t.recover();

  r := t.mint(w, 205, 1000);
  PERFORM t.check('B.32 the matching event makes the withdrawal final',
    (r ->> 'success')::BOOLEAN AND NOT (r ->> 'duplicate')::BOOLEAN AND (t.w(w)).status = 'minted' AND (t.w(w)).minted_block = 1000 AND (t.w(w)).minted_tx_hash = t.h(205), r::TEXT);
  r := t.mint(w, 205, 1000);
  PERFORM t.check('B.33 the same event reported again changes nothing', (r ->> 'duplicate')::BOOLEAN AND t.enabled(), r::TEXT);
  r := t.mint(w, 206, 1001);
  PERFORM t.check('B.34 a SECOND mint for the same withdrawal is an anomaly that halts the bridge', r ->> 'code' = 'second_mint' AND NOT t.enabled() AND (t.w(w)).minted_tx_hash = t.h(205), r::TEXT);
  PERFORM t.recover();
  r := t.sub(w, 207);
  PERFORM t.check('B.35 a minted withdrawal cannot be submitted again', r ->> 'code' = 'already_minted', r::TEXT);
  r := t.cancel(20, w);
  PERFORM t.check('B.36 or cancelled', r ->> 'code' = 'not_cancellable' OR r ->> 'code' IS NOT NULL, r::TEXT);
  PERFORM t.check('B.37 the user''s ICEC stays locked for the tokens now on-chain', t.locked() >= 10);

  -- a mint reported for a withdrawal that was never marked submitted (the relayer crashed after broadcasting)
  r := t.wd(20, 7, t.a(2020), 'wd-20-000004', 'o4');
  r := t.mint(t.id('o4'), 208, 1002);
  PERFORM t.check('B.38 a mint for a withdrawal still shown as pending is accepted (the chain is the truth)', (r ->> 'success')::BOOLEAN AND (t.w(t.id('o4'))).status = 'minted', r::TEXT);

  -- a mint for a withdrawal that was cancelled: the user was refunded AND tokens exist
  r := t.wd(20, 6, t.a(2020), 'wd-20-000005', 'o5');
  PERFORM t.cancel(20, t.id('o5'));
  r := t.mint(t.id('o5'), 209, 1003);
  PERFORM t.check('B.39 a mint after a refund is the worst anomaly: refused, the bridge halts, the refund stands',
    r ->> 'code' = 'mint_after_cancel' AND NOT t.enabled() AND (t.w(t.id('o5'))).status = 'cancelled'
    AND EXISTS (SELECT 1 FROM icanera_chain.anomalies WHERE kind = 'mint_after_cancel'), r::TEXT);
  PERFORM t.recover();

  PERFORM t.as_service();
  PERFORM t.check('B.40 bad input to the relayer functions raises, it is not silently accepted',
    t.err($$SELECT public.ican_chain_operator_record_mint(31337, 'nothex', 'nothex', 0, 1, 'nothex', '5')$$) = 'bad mint event');
  PERFORM t.reset();
END $t$;

-- ================================================================ C. A burn becomes ledger credit, or it does not
-- user 21: 10 ICEC to a(2121)
DO $t$
DECLARE r JSONB; b0 NUMERIC := t.bal(21); l0 NUMERIC;
BEGIN
  r := t.wd(21, 10, t.a(2121), 'wd-21-000001', 'c1');
  r := t.mint(t.id('c1'), 301, 2000);
  PERFORM t.check('C.0 setup: 10 ICEC minted to user 21''s address', (r ->> 'success')::BOOLEAN);
  l0 := t.locked();

  r := t.burn(t.a(2121), 4e8, 310, 2010);
  PERFORM t.check('C.1 a burn from a linked address within what was minted is credited to the account',
    (r ->> 'credited')::BOOLEAN AND NOT (r ->> 'duplicate')::BOOLEAN AND t.bal(21) = b0 - 10 + 4 AND t.locked() = l0 - 4, r::TEXT);
  PERFORM t.check('C.2 with one credit entry and the burn marked credited to that user',
    (SELECT count(*) FROM icanera_chain.locked_entries e JOIN icanera_chain.bridge_deposits d ON d.id = e.deposit_id WHERE e.kind = 'credit' AND e.amount = -4 AND d.user_id = t.u(21) AND d.status = 'credited') = 1);
  r := t.burn(t.a(2121), 4e8, 310, 2010);
  PERFORM t.check('C.3 the same burn event reported again (a re-scan) credits nothing more',
    (r ->> 'duplicate')::BOOLEAN AND t.bal(21) = b0 - 6 AND t.locked() = l0 - 4, r::TEXT);
  r := t.burn(t.a(2121), 4e8, 310, 2010, 1);
  PERFORM t.check('C.4 a different log index in the same transaction is a different burn', NOT (r ->> 'duplicate')::BOOLEAN AND (r ->> 'credited')::BOOLEAN AND t.bal(21) = b0 - 2, r::TEXT);
  r := t.burn(t.a(2121), 3e8, 311, 2011);
  PERFORM t.check('C.5 burning more than is left (2 left, 3 burned) is parked, not credited, with the reason',
    NOT (r ->> 'credited')::BOOLEAN AND r ->> 'reason' = 'exceeds_outstanding' AND t.bal(21) = b0 - 2
    AND (SELECT status || ':' || reason FROM icanera_chain.bridge_deposits WHERE tx_hash = t.h(311)) = 'unclaimed:exceeds_outstanding', r::TEXT);
  r := t.burn(t.a(2121), 2e8, 312, 2012);
  PERFORM t.check('C.6 burning exactly what is left is credited', (r ->> 'credited')::BOOLEAN AND t.bal(21) = b0, r::TEXT);
  PERFORM t.check('C.7 the account has been paid back exactly what it bridged out, no more: wallet = start balance', t.bal(21) = b0);
  PERFORM t.check('C.8 the 3-ICEC burn stays parked: those tokens are gone from the chain but not paid out (recoverable by hand from the locked ledger)',
    (SELECT status FROM icanera_chain.bridge_deposits WHERE tx_hash = t.h(311)) = 'unclaimed' AND t.locked() = l0 - 10);

  -- more is minted to the same address later: the parked burn is creditable now and the relayer's retry finds it
  r := t.wd(21, 3, t.a(2121), 'wd-21-000002', 'c2');
  r := t.mint(t.id('c2'), 302, 2020);
  PERFORM t.as_service();
  r := public.ican_chain_operator_retry_unclaimed(50);
  PERFORM t.reset();
  PERFORM t.check('C.9 the parked burn is credited once the matching mint is recorded', (r ->> 'credited')::INT >= 1 AND (SELECT status FROM icanera_chain.bridge_deposits WHERE tx_hash = t.h(311)) = 'credited' AND t.bal(21) = b0, r::TEXT);
  PERFORM t.as_service();
  r := public.ican_chain_operator_retry_unclaimed(50);
  PERFORM t.reset();
  PERFORM t.check('C.10 running the retry again credits nothing more', (r ->> 'credited')::INT = 0 AND t.bal(21) = b0, r::TEXT);
END $t$;

DO $t$
DECLARE r JSONB; b0 NUMERIC; l0 NUMERIC;
BEGIN
  -- an address nobody linked
  b0 := (SELECT COALESCE(SUM(ican_balance), 0) FROM public.ican_user_wallets); l0 := t.locked();
  r := t.burn(t.a(3333), 5e8, 320, 2030);
  PERFORM t.check('C.11 a burn from an address nobody linked is parked, with the reason, and the ledger does not move',
    NOT (r ->> 'credited')::BOOLEAN AND r ->> 'reason' = 'address_not_linked' AND (SELECT COALESCE(SUM(ican_balance), 0) FROM public.ican_user_wallets) = b0 AND t.locked() = l0, r::TEXT);
  -- linking it afterwards must not let it claim something it never had minted to it
  PERFORM t.link(22, t.a(3333));
  PERFORM t.as_service();
  r := public.ican_chain_operator_retry_unclaimed(50);
  PERFORM t.reset();
  PERFORM t.check('C.12 linking the address afterwards does not make an old burn payable: nothing was ever minted to it',
    (SELECT status || ':' || reason FROM icanera_chain.bridge_deposits WHERE tx_hash = t.h(320)) = 'unclaimed:exceeds_outstanding' AND t.bal(22) = 1000, r::TEXT);

  -- per ADDRESS, not per account: user 23 has two addresses, ICEC was minted to the first only
  r := t.wd(23, 10, t.a(2301), 'wd-23-000001', 'c3');
  r := t.mint(t.id('c3'), 303, 2040);
  r := t.burn(t.a(2302), 5e8, 321, 2041);
  PERFORM t.check('C.13 tokens burned from a sibling address that never received any are not credited',
    NOT (r ->> 'credited')::BOOLEAN AND r ->> 'reason' = 'exceeds_outstanding' AND t.bal(23) = 990, r::TEXT);
  r := t.burn(t.a(2301), 10e8, 322, 2042);
  PERFORM t.check('C.14 the address that did receive them is credited in full', (r ->> 'credited')::BOOLEAN AND t.bal(23) = 1000, r::TEXT);

  -- a revoked address: its burns still go to the account that bridged to it (that can only return value to its source)
  r := t.wd(24, 10, t.a(2401), 'wd-24-000001', 'c4');
  r := t.mint(t.id('c4'), 304, 2050);
  PERFORM t.as_user(t.u(24));
  r := public.ican_chain_unlink_address(t.a(2401));
  PERFORM t.reset();
  PERFORM t.check('C.15 (setup) the address is revoked', (r ->> 'success')::BOOLEAN);
  r := t.wd(24, 5, t.a(2401), 'wd-24-000002');
  PERFORM t.check('C.16 no NEW withdrawal can go to a revoked address', r ->> 'code' = 'address_not_linked', r::TEXT);
  r := t.burn(t.a(2401), 10e8, 323, 2051);
  PERFORM t.check('C.17 but a burn from it is still credited to the same account', (r ->> 'credited')::BOOLEAN AND t.bal(24) = 1000, r::TEXT);

  -- unlinking refunds withdrawals that were never picked up, and only those
  r := t.wd(25, 10, t.a(2501), 'wd-25-000001', 'u1');
  r := t.wd(25, 11, t.a(2501), 'wd-25-000002', 'u2');
  PERFORM t.sub(t.id('u2'), 330);
  PERFORM t.as_user(t.u(25));
  r := public.ican_chain_unlink_address(t.a(2501));
  PERFORM t.reset();
  PERFORM t.check('C.18 unlinking an address refunds its never-picked-up withdrawals and leaves the signed one alone',
    (r ->> 'refunded_withdrawals')::INT = 1 AND (r ->> 'refunded_icec')::NUMERIC = 10 AND (t.w(t.id('u1'))).status = 'cancelled' AND (t.w(t.id('u2'))).status = 'submitted'
    AND t.bal(25) = 989, r::TEXT);
  PERFORM t.mint(t.id('u2'), 331, 2060);

  -- invalid events raise
  PERFORM t.as_service();
  PERFORM t.check('C.19 a burn with a malformed hash raises', t.err($$SELECT public.ican_chain_operator_record_burn(31337, 'zz', 0, 1, '0x00', '5', NULL)$$) = 'bad burn event');
  PERFORM t.check('C.20 a burn of zero raises', t.err(format($q$SELECT public.ican_chain_operator_record_burn(31337, %L, 0, 1, %L, '0', NULL)$q$, t.h(900), t.a(1))) = 'bad burn event');
  PERFORM t.check('C.21 a burn of a negative amount raises', t.err(format($q$SELECT public.ican_chain_operator_record_burn(31337, %L, 0, 1, %L, '-5', NULL)$q$, t.h(901), t.a(1))) = 'bad burn event');
  PERFORM t.reset();
  r := t.burn(t.a(2121), 1e8, 902, 2100, 0, 99);
  PERFORM t.check('C.22 a burn from another chain is an anomaly and halts the bridge', r ->> 'code' = 'wrong_chain' AND NOT t.enabled(), r::TEXT);
  PERFORM t.recover();
END $t$;

-- a stolen operator key: tokens minted to an attacker with no withdrawal behind them
DO $t$
DECLARE r JSONB; b0 NUMERIC := (SELECT COALESCE(SUM(ican_balance), 0) FROM public.ican_user_wallets); l0 NUMERIC := t.locked(); s JSONB;
BEGIN
  PERFORM t.as_service();
  r := public.ican_chain_operator_record_mint(31337, '0x' || repeat('cd', 32), t.h(400), 0, 3000, t.a(6666), '9900000000000');
  PERFORM t.reset();
  PERFORM t.check('C.23 (stolen key) a mint the database never asked for halts the bridge', r ->> 'code' = 'unknown_ref' AND NOT t.enabled(), r::TEXT);
  r := t.burn(t.a(6666), 9900000000000, 401, 3001);
  PERFORM t.check('C.24 (stolen key) the attacker burning it for credit gets nothing', NOT (r ->> 'credited')::BOOLEAN AND (SELECT COALESCE(SUM(ican_balance), 0) FROM public.ican_user_wallets) = b0 AND t.locked() = l0, r::TEXT);
  PERFORM t.recover();
END $t$;

-- ================================================================ D. The supply cross-check
DO $t$
DECLARE r JSONB; exp NUMERIC; blk BIGINT := 2025; minted NUMERIC; burned NUMERIC;
BEGIN
  SELECT COALESCE(SUM(amount_units), 0) INTO minted FROM icanera_chain.bridge_withdrawals WHERE status = 'minted' AND minted_block <= blk;
  SELECT COALESCE(SUM(amount * 100000000), 0) INTO burned FROM icanera_chain.bridge_deposits WHERE block_number <= blk;
  exp := minted - burned;
  PERFORM t.check('D.1 the expected on-chain supply is minted less burned, from independent sums', icanera_chain.expected_supply_units(31337, blk) = exp, exp::TEXT);
  r := t.supply(blk, exp);
  PERFORM t.check('D.2 the right supply is OK and is recorded', (r ->> 'ok')::BOOLEAN AND t.enabled() AND (SELECT ok FROM icanera_chain.supply_checks ORDER BY id DESC LIMIT 1), r::TEXT);
  r := t.supply(blk, exp + 1);
  PERFORM t.check('D.3 one base unit too many on-chain is an anomaly that halts the bridge',
    NOT (r ->> 'ok')::BOOLEAN AND NOT t.enabled() AND EXISTS (SELECT 1 FROM icanera_chain.anomalies WHERE kind = 'supply_mismatch' AND resolved_at IS NULL), r::TEXT);
  PERFORM t.recover();
  r := t.supply(blk, exp - 1);
  PERFORM t.check('D.4 one too few is too', NOT (r ->> 'ok')::BOOLEAN AND NOT t.enabled(), r::TEXT);
  PERFORM t.recover();
  PERFORM t.check('D.5 a report only counts events up to its own block: an earlier block gives a different expectation',
    icanera_chain.expected_supply_units(31337, 1001) <> exp AND icanera_chain.expected_supply_units(31337, 1001) = (
      SELECT COALESCE(SUM(amount_units), 0) FROM icanera_chain.bridge_withdrawals WHERE status = 'minted' AND minted_block <= 1001)
      - (SELECT COALESCE(SUM(amount * 100000000), 0) FROM icanera_chain.bridge_deposits WHERE block_number <= 1001));
  PERFORM t.as_service();
  PERFORM t.check('D.6 a malformed report raises', t.err($$SELECT public.ican_chain_operator_check_supply(31337, 1, 'abc')$$) = 'bad supply report');
  PERFORM t.reset();
  PERFORM t.as_service();
  PERFORM public.ican_chain_operator_halt('the relayer saw something odd');
  PERFORM t.reset();
  PERFORM t.check('D.7 the relayer can halt the bridge itself, and it is recorded', NOT t.enabled() AND EXISTS (SELECT 1 FROM icanera_chain.anomalies WHERE kind = 'operator_halt' AND resolved_at IS NULL));
  PERFORM t.recover();
  r := t.supply(blk, exp);
  PERFORM t.check('D.8 a fresh, correct report after the incident is what makes the latest check green again', (r ->> 'ok')::BOOLEAN AND t.enabled(), r::TEXT);
END $t$;

-- ================================================================ E. The books
DO $t$
DECLARE r JSONB; e TEXT; held NUMERIC := NULL; r2 JSONB;
BEGIN
  r := t.rec();
  PERFORM t.check('E.1 the books reconcile', (r ->> 'ok')::BOOLEAN AND (r ->> 'locked_matches')::BOOLEAN, r::TEXT);
  PERFORM t.check('E.2 the locked total is every live withdrawal less everything paid back',
    t.locked() = (SELECT COALESCE(SUM(amount), 0) FROM icanera_chain.bridge_withdrawals WHERE status <> 'cancelled') - (SELECT COALESCE(SUM(amount), 0) FROM icanera_chain.bridge_deposits WHERE status = 'credited'));
  -- a rogue entry slipped in by hand shows up
  BEGIN
    INSERT INTO icanera_chain.locked_entries (kind, amount, user_id, withdrawal_id) SELECT 'cancel', -amount, user_id, id FROM icanera_chain.bridge_withdrawals WHERE status = 'minted' LIMIT 1;
    r2 := t.rec();
    RAISE EXCEPTION 'undo the tampering' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
  PERFORM t.check('E.3 a rogue release of locked ICEC is caught by the reconcile', NOT (r2 ->> 'ok')::BOOLEAN AND (r2 ->> 'cancelled_mismatches')::INT >= 1 AND NOT (r2 ->> 'locked_matches')::BOOLEAN, r2::TEXT);
  r := t.rec();
  PERFORM t.check('E.4 ...and after undoing it the books are clean again', (r ->> 'ok')::BOOLEAN, r::TEXT);
  -- the table itself refuses what should never happen
  e := t.err(format($q$INSERT INTO icanera_chain.locked_entries (kind, amount, user_id, withdrawal_id) VALUES ('lock', 1, %L, %L)$q$, t.u(20), t.id('o1')));
  PERFORM t.check('E.5 a withdrawal cannot be locked twice', e LIKE '%locked_entries_once_per_withdrawal%', e);
  e := t.err(format($q$INSERT INTO icanera_chain.locked_entries (kind, amount, user_id, withdrawal_id) VALUES ('cancel', -1, %L, %L), ('cancel', -1, %L, %L)$q$, t.u(20), t.id('o1'), t.u(20), t.id('o1')));
  PERFORM t.check('E.6 nor released twice', e LIKE '%locked_entries_once_per_withdrawal%', e);
  e := t.err(format($q$INSERT INTO icanera_chain.locked_entries (kind, amount, user_id, deposit_id) SELECT 'credit', -amount, user_id, id FROM icanera_chain.bridge_deposits WHERE status = 'credited' LIMIT 1$q$));
  PERFORM t.check('E.7 a burn cannot be credited twice', e LIKE '%locked_entries_once_per_deposit%', e);
  e := t.err(format($q$INSERT INTO icanera_chain.locked_entries (kind, amount, user_id, withdrawal_id) VALUES ('lock', -5, %L, %L)$q$, t.u(20), t.id('o2')));
  PERFORM t.check('E.8 the sign of an entry must match its kind', e LIKE '%locked_entries_check%', e);
END $t$;

-- ================================================================ F. Nothing can be edited after the fact
DO $t$
DECLARE e TEXT; w UUID := t.id('o1');
BEGIN
  e := t.err(format($q$UPDATE icanera_chain.bridge_withdrawals SET amount = 1 WHERE id = %L$q$, w));
  PERFORM t.check('F.1 a withdrawal''s amount cannot be changed', e LIKE 'a withdrawal''s identity and amount cannot be changed%', e);
  e := t.err(format($q$UPDATE icanera_chain.bridge_withdrawals SET to_address = %L WHERE id = %L$q$, t.a(7), w));
  PERFORM t.check('F.2 nor its destination', e LIKE 'a withdrawal''s identity and amount cannot be changed%', e);
  e := t.err(format($q$UPDATE icanera_chain.bridge_withdrawals SET user_id = %L WHERE id = %L$q$, t.u(30), w));
  PERFORM t.check('F.3 nor its owner', e LIKE 'a withdrawal''s identity and amount cannot be changed%', e);
  e := t.err(format($q$DELETE FROM icanera_chain.bridge_withdrawals WHERE id = %L$q$, w));
  PERFORM t.check('F.4 nor deleted', e LIKE 'bridge_withdrawals rows are never deleted%', e);
  e := t.err(format($q$UPDATE icanera_chain.bridge_withdrawals SET status = 'pending', minted_block = NULL WHERE id = %L$q$, w));
  PERFORM t.check('F.5 a minted withdrawal is final', e LIKE 'illegal withdrawal status change%', e);
  e := t.err(format($q$UPDATE icanera_chain.bridge_withdrawals SET status = 'pending', cancelled_at = NULL WHERE id = %L$q$, t.id('wd3')));
  PERFORM t.check('F.6 so is a cancelled one (it cannot be revived to be minted)', e LIKE 'illegal withdrawal status change%', e);
  e := t.err(format($q$UPDATE icanera_chain.bridge_withdrawals SET last_error = 'x' WHERE id = %L$q$, t.id('wd3')));
  PERFORM t.check('F.7 and a final one takes no further edits at all', e LIKE 'a cancelled withdrawal is final%', e);
  e := t.err(format($q$UPDATE icanera_chain.bridge_withdrawals SET status = 'minted' WHERE id = %L$q$, t.id('wd2')));
  PERFORM t.check('F.8 "minted" needs the block it was minted in', e LIKE '%bridge_withdrawals_check%', e);
  e := t.err($q$UPDATE icanera_chain.locked_entries SET amount = 1$q$);
  PERFORM t.check('F.9 the locked ledger cannot be edited', e LIKE 'locked_entries is append-only%', e);
  e := t.err($q$DELETE FROM icanera_chain.locked_entries$q$);
  PERFORM t.check('F.10 or have rows removed', e LIKE 'locked_entries is append-only%', e);
  e := t.err($q$UPDATE icanera_chain.bridge_deposits SET amount = 999 WHERE status = 'credited'$q$);
  PERFORM t.check('F.11 a recorded burn''s amount cannot be changed', e LIKE 'a recorded burn cannot be changed%', e);
  e := t.err($q$UPDATE icanera_chain.bridge_deposits SET status = 'unclaimed', credited_at = NULL WHERE status = 'credited'$q$);
  PERFORM t.check('F.12 a credited burn cannot be un-credited and credited again', e LIKE 'a credited burn is final%', e);
  e := t.err($q$DELETE FROM icanera_chain.bridge_deposits$q$);
  PERFORM t.check('F.13 burns are never deleted', e LIKE 'bridge_deposits rows are never deleted%', e);
  e := t.err($q$UPDATE icanera_chain.supply_checks SET ok = TRUE$q$);
  PERFORM t.check('F.14 the supply-check history cannot be rewritten', e LIKE 'supply_checks is append-only%', e);
END $t$;

-- ================================================================ G. What a user can see
DO $t$
DECLARE r JSONB; r2 JSONB;
BEGIN
  PERFORM t.as_user(t.u(21));
  r := public.ican_chain_my_overview();
  PERFORM t.reset();
  PERFORM t.check('G.1 a user sees their own withdrawals, burns and addresses',
    (r ->> 'success')::BOOLEAN AND jsonb_array_length(r -> 'withdrawals') = 2 AND jsonb_array_length(r -> 'addresses') = 1 AND jsonb_array_length(r -> 'burns') >= 4, r::TEXT);
  PERFORM t.check('G.2 and only their own', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'withdrawals') e WHERE e ->> 'to_address' <> t.a(2121)) AND NOT (r::TEXT LIKE '%' || t.u(22)::TEXT || '%'));
  PERFORM t.check('G.3 the on-chain figure is what was minted less what was burned back: 13 minted, 13 burned', (r ->> 'onchain_icec')::NUMERIC = 0, r ->> 'onchain_icec');
  PERFORM t.as_user(t.u(23));
  r2 := public.ican_chain_my_overview();
  PERFORM t.reset();
  PERFORM t.check('G.4 another user''s overview shows none of user 21''s rows', jsonb_array_length(r2 -> 'withdrawals') = 1 AND NOT (r2::TEXT LIKE '%' || t.a(2121) || '%'));
  PERFORM t.check('G.5 an unclaimed burn is visible to the account that owns the address', EXISTS (SELECT 1 FROM jsonb_array_elements(r2 -> 'burns') e WHERE e ->> 'status' = 'unclaimed' AND e ->> 'reason' = 'exceeds_outstanding'), (r2 -> 'burns')::TEXT);
  PERFORM t.as_user(t.u(20));
  r := public.ican_chain_my_overview();
  PERFORM t.reset();
  PERFORM t.check('G.6 in-flight ICEC is shown separately from on-chain ICEC', (r ->> 'in_flight_icec')::NUMERIC >= 0 AND (r ->> 'onchain_icec')::NUMERIC = 10 + 7, r::TEXT);
  PERFORM t.as_anon();
  PERFORM t.check('G.7 anon cannot read an overview', t.err($$SELECT public.ican_chain_my_overview()$$) LIKE 'permission denied%');
  PERFORM t.reset();
END $t$;

-- ================================================================ H. Administrators
DO $t$
DECLARE r JSONB; e TEXT;
BEGIN
  PERFORM t.as_user(t.u(1));
  r := public.ican_chain_dev_overview('dev_test_secret');
  PERFORM t.reset();
  PERFORM t.check('H.1 the overview shows settings, the queue by state, the locked total and open anomalies',
    r -> 'settings' ->> 'chain_id' = '31337' AND r -> 'withdrawals' ? 'minted' AND (r ->> 'locked_icec')::NUMERIC = t.locked() AND r ? 'open_anomalies' AND r ? 'unclaimed_burns', left(r::TEXT, 400));
  PERFORM t.as_user(t.u(1));
  e := t.err($$SELECT public.ican_chain_dev_set_contracts('dev_test_secret', '{"chain_id": 1}')$$);
  PERFORM t.reset();
  PERFORM t.check('H.2 the chain cannot be switched once withdrawals exist for the current one', e LIKE 'withdrawals already exist%', e);
  PERFORM t.as_user(t.u(1));
  e := t.err(format($q$SELECT public.ican_chain_dev_set_contracts('dev_test_secret', %L)$q$, jsonb_build_object('icec_community_address', t.a(1234))::TEXT));
  PERFORM t.reset();
  PERFORM t.check('H.3 nor the ICEC-C contract', e LIKE 'withdrawals already exist%', e);
  r := t.cfg(jsonb_build_object('stable_vault_address', t.a(5678), 'chain_id', 31337));
  PERFORM t.check('H.4 the stable-token addresses (display only) can still be corrected', (r ->> 'success')::BOOLEAN AND r -> 'config' ->> 'stable_vault_address' = t.a(5678), r::TEXT);
  PERFORM t.as_user(t.u(1));
  e := t.err($$SELECT public.ican_chain_dev_set_settings('dev_test_secret', '{"min_withdrawal_icec": 500}')$$);
  PERFORM t.reset();
  PERFORM t.check('H.5 settings that contradict each other are refused (minimum above maximum)', e LIKE '%chain_settings_check%', e);
  PERFORM t.as_user(t.u(1));
  e := t.err($$SELECT public.ican_chain_dev_requeue('dev_test_secret', gen_random_uuid(), 'short')$$);
  PERFORM t.reset();
  PERFORM t.check('H.6 a manual requeue demands a memo saying what was checked on-chain', e LIKE 'record what you checked%', e);
  PERFORM t.as_user(t.u(1));
  r := public.ican_chain_dev_requeue('dev_test_secret', t.id('o1'), 'checked processed(ref) is false and the nonce is consumed');
  PERFORM t.reset();
  PERFORM t.check('H.7 and only works on a submitted withdrawal', NOT (r ->> 'success')::BOOLEAN, r::TEXT);
  PERFORM t.as_user(t.u(1));
  e := t.err($$SELECT public.ican_chain_dev_resolve_anomaly('dev_test_secret', 1, 'ok')$$);
  PERFORM t.reset();
  PERFORM t.check('H.8 an anomaly cannot be closed without saying what was found', e LIKE 'say what you found%', e);
END $t$;

-- ================================================================ I. Conservation, over a long random run
-- Eight users with 10,000 ICEC each. 400 random steps: withdraw, sign, mint, burn back, cancel, requeue, retry. After every
-- step the ledger ICEC (wallets + locked) must be exactly what it was, and at the end the books reconcile and the
-- simulated chain's supply equals what the database expects.
TRUNCATE public.ican_user_wallets, public.ican_coin_transactions;
TRUNCATE icanera_chain.locked_entries, icanera_chain.bridge_deposits, icanera_chain.bridge_withdrawals, icanera_chain.supply_checks RESTART IDENTITY CASCADE;
DELETE FROM icanera_chain.anomalies;
SELECT t.set('{"bridge_enabled": true, "max_withdrawal_icec": 100, "max_daily_withdrawal_icec": 100000, "max_withdrawals_per_hour": 100000}');
INSERT INTO public.ican_user_wallets (user_id, ican_balance) SELECT t.u(n), 10000 FROM generate_series(40, 47) n;
SELECT t.link(n, t.a(4000 + n)) FROM generate_series(40, 47) n;
CREATE TABLE t.chain (addr TEXT PRIMARY KEY, units NUMERIC NOT NULL DEFAULT 0);

DO $t$
DECLARE
  step INT; op NUMERIC; n INT; w icanera_chain.bridge_withdrawals; r JSONB; amt NUMERIC; tx INT := 10000; blk BIGINT := 10000;
  supply NUMERIC := 0; total0 NUMERIC := 80000; bad INT := 0; wd INT := 0; mi INT := 0; bu INT := 0; ca INT := 0; ok BOOLEAN; cr NUMERIC := 0;
  have NUMERIC;
BEGIN
  PERFORM setseed(0.4242);
  FOR step IN 1..400 LOOP
    op := random();
    n := 40 + floor(random() * 8)::INT;
    blk := blk + 1; tx := tx + 1;
    IF op < 0.38 THEN                                                   -- withdraw
      amt := round((1 + random() * 49)::NUMERIC, 2);
      r := t.wd(n, amt, t.a(4000 + n), 'rnd-' || step || '-' || n);
      IF (r ->> 'success')::BOOLEAN THEN wd := wd + 1; END IF;
    ELSIF op < 0.50 THEN                                                -- the relayer signs one
      SELECT * INTO w FROM icanera_chain.bridge_withdrawals WHERE status = 'pending' ORDER BY random() LIMIT 1;
      IF FOUND THEN PERFORM t.sub(w.id, tx); END IF;
    ELSIF op < 0.66 THEN                                                -- a mint is confirmed on the chain
      SELECT * INTO w FROM icanera_chain.bridge_withdrawals WHERE status IN ('pending', 'submitted') ORDER BY random() LIMIT 1;
      IF FOUND THEN
        r := t.mint(w.id, tx, blk);
        IF (r ->> 'success')::BOOLEAN AND NOT COALESCE((r ->> 'duplicate')::BOOLEAN, FALSE) THEN
          supply := supply + w.amount_units;
          INSERT INTO t.chain VALUES (w.to_address, w.amount_units) ON CONFLICT (addr) DO UPDATE SET units = t.chain.units + EXCLUDED.units;
          mi := mi + 1;
        END IF;
      END IF;
    ELSIF op < 0.82 THEN                                                -- a holder burns some of what they hold on-chain
      SELECT addr, units INTO w.to_address, have FROM t.chain WHERE units > 0 ORDER BY random() LIMIT 1;
      IF FOUND THEN
        amt := GREATEST(1, floor(have * (0.1 + random() * 0.9)));
        r := t.burn(w.to_address, amt, tx, blk);
        UPDATE t.chain SET units = units - amt WHERE addr = w.to_address;
        supply := supply - amt;
        bu := bu + 1;
        IF (r ->> 'credited')::BOOLEAN THEN ca := ca + 1; END IF;
      END IF;
    ELSIF op < 0.90 THEN                                                -- a user changes their mind
      SELECT * INTO w FROM icanera_chain.bridge_withdrawals WHERE status = 'pending' ORDER BY random() LIMIT 1;
      IF FOUND THEN PERFORM t.cancel((SELECT (right(u::TEXT, 12))::INT FROM (SELECT w.user_id AS u) q), w.id); END IF;
    ELSIF op < 0.95 THEN                                                -- an attempt reverted
      SELECT * INTO w FROM icanera_chain.bridge_withdrawals WHERE status = 'submitted' ORDER BY random() LIMIT 1;
      IF FOUND THEN
        PERFORM t.as_service();
        PERFORM public.ican_chain_operator_requeue(w.id, 'reverted in the random test');
        PERFORM t.reset();
      END IF;
    ELSE                                                                -- the relayer retries parked burns
      PERFORM t.as_service();
      PERFORM public.ican_chain_operator_retry_unclaimed(100);
      PERFORM t.reset();
    END IF;

    -- the conservation law, after every step
    IF (SELECT COALESCE(SUM(ican_balance), 0) FROM public.ican_user_wallets) + t.locked() <> total0 THEN bad := bad + 1; END IF;
    IF NOT t.enabled() THEN bad := bad + 1; END IF;
  END LOOP;
  PERFORM t.check('I.1 over 400 random steps the ledger ICEC (wallets + locked) never differed from 80,000, not once', bad = 0, 'violations: ' || bad);
  PERFORM t.check('I.2 and the run did real work', wd > 60 AND mi > 30 AND bu > 15, format('%s withdrawals, %s mints, %s burns (%s credited)', wd, mi, bu, ca));
  r := t.rec();
  PERFORM t.check('I.3 the books reconcile at the end', (r ->> 'ok')::BOOLEAN, r::TEXT);
  r := t.supply(blk + 1, supply);
  PERFORM t.check('I.4 the simulated chain''s supply equals what the database expects', (r ->> 'ok')::BOOLEAN AND t.enabled(), r::TEXT);
  PERFORM t.check('I.5 no address was ever paid back more than was minted to it',
    NOT EXISTS (SELECT 1 FROM icanera_chain.bridge_deposits d WHERE d.status = 'credited' GROUP BY d.from_address
                HAVING SUM(d.amount) > (SELECT COALESCE(SUM(w2.amount), 0) FROM icanera_chain.bridge_withdrawals w2 WHERE w2.to_address = d.from_address AND w2.status = 'minted')));
  PERFORM t.check('I.6 no cancelled withdrawal was ever signed (the refund and the mint can never both happen)',
    NOT EXISTS (SELECT 1 FROM icanera_chain.bridge_withdrawals WHERE status = 'cancelled' AND (attempts > 0 OR tx_hash IS NOT NULL)));
  PERFORM t.check('I.7 every burn in this run was within what its address held, so every one was credited',
    (SELECT count(*) FROM icanera_chain.bridge_deposits WHERE status = 'unclaimed') = 0, (SELECT count(*) FROM icanera_chain.bridge_deposits WHERE status = 'unclaimed')::TEXT);
  PERFORM t.check('I.8 no wallet is negative', NOT EXISTS (SELECT 1 FROM public.ican_user_wallets WHERE ican_balance < 0));
END $t$;

-- ================================================================ J. The money paths do not depend on the FX number
DO $t$
BEGIN
  PERFORM t.check('J.1 no bridge function reads the FX oracle (a display number can never move a balance)',
    NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname IN ('public', 'icanera_chain')
                   AND (p.proname LIKE 'ican_bridge_%' OR p.proname LIKE 'ican_chain_operator_%' OR p.proname IN ('try_credit', 'cancel_pending', 'credit_wallet', 'locked_total', 'expected_supply_units')
                        OR p.proname IN ('ican_chain_link_challenge', 'ican_chain_unlink_address'))
                   AND p.proname <> 'ican_chain_operator_fx_observe'
                   AND (p.prosrc ILIKE '%fx_observations%' OR p.prosrc ILIKE '%fx_twap%' OR p.prosrc ILIKE '%ican_fx_rate%' OR p.prosrc ILIKE '%ican_currency_rates%')));
  PERFORM t.check('J.2 and none writes to the icaneracoin ledger',
    NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname IN ('public', 'icanera_chain') AND (p.proname LIKE 'ican_bridge_%' OR p.proname LIKE 'ican_chain_%' OR p.proname IN ('try_credit', 'cancel_pending', 'credit_wallet'))
                   AND p.prosrc ILIKE '%ican_coin_transactions%'));
  PERFORM t.check('J.3 every bridge function pins its search_path',
    NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.prosecdef AND (p.proname LIKE 'ican_bridge_%' OR p.proname LIKE 'ican_chain_%' OR p.proname = 'ican_fx_rate')
                   AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')));
END $t$;
