\set ON_ERROR_STOP on
-- Helpers (same shape as the repo's other SQL tests) and the state the migration will meet.
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
CREATE FUNCTION t.raises(p_sql TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$ BEGIN EXECUTE p_sql; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
-- the six server-only money functions, every overload
CREATE FUNCTION t.server_only_fns() RETURNS SETOF OID LANGUAGE sql AS $$
  SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN
    ('request_fiat_momo_send','request_fiat_bank_send','resolve_fiat_momo_send','mark_fiat_momo_send_processing','request_ican_payout','resolve_ican_payout') $$;
CREATE FUNCTION t.fn_text(p_name TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT string_agg(pg_get_functiondef(p.oid), E'\n' ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = p_name $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;
CREATE TABLE t.keep (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t.keep TO PUBLIC;
SET client_min_messages = info;

INSERT INTO auth.users (id, email) SELECT t.u(n), 'u' || n || '@t.dev' FROM generate_series(1, 3) n;
INSERT INTO public.wallet_accounts (user_id, currency, balance) VALUES (t.u(1), 'UGX', 100000), (t.u(2), 'UGX', 50000);

DO $t$
BEGIN
  PERFORM t.check('B1 BEFORE: the hole is real - anon and authenticated can run every server-only money function',
    (SELECT bool_and(has_function_privilege('anon', o, 'EXECUTE') AND has_function_privilege('authenticated', o, 'EXECUTE')) FROM t.server_only_fns() o));
  PERFORM t.check('B2 BEFORE: there are six functions in play', (SELECT count(*) FROM t.server_only_fns()) = 6);
  INSERT INTO t.keep VALUES
    ('sell',   (public.sell_ican_coins(t.u(1), 10))::TEXT),
    ('payout', (public.resolve_ican_payout('x', true))::TEXT);
  PERFORM t.check('B3 BEFORE: baseline at the fixed 3% - fee UGX 1,500 and 0.3 coin on 10 coins',
    (SELECT v FROM t.keep WHERE k = 'sell')::JSONB = '{"fee_ugx": 1500.00, "platform_credit_ican": 0.30000000}'::JSONB,
    (SELECT v FROM t.keep WHERE k = 'sell'));
END $t$;
