-- Test stub. Not a migration: never run this against a real database.
-- Just enough Supabase (roles, auth.uid / auth.jwt, default grants, the extensions schema) and the wallet tables for the REAL
-- backend/NATIONAL_ID_PER_COUNTRY.sql and backend/NATIONAL_ID_OWNERSHIP.sql to run. The dev secret is a stand-in for
-- supabase/migrations/20261009100000_secure_dev_access.sql (which needs far more of the app than this test does).
\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA extensions;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID $$;
CREATE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE sql STABLE AS
  $$ SELECT jsonb_build_object('email', NULLIF(current_setting('request.jwt.claim.email', true), '')) $$;
CREATE TABLE auth.users (id UUID PRIMARY KEY);

GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role;
-- Supabase's default: every new public table and FUNCTION is granted straight to the API roles.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- ── test helpers ─────────────────────────────────────────────────────────────
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO PUBLIC;
CREATE FUNCTION t.u(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-' || lpad(n::TEXT, 12, '0'))::UUID $$;
CREATE FUNCTION t.login(n INT, p_email TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', t.u(n)::TEXT, false);
  PERFORM set_config('request.jwt.claim.email', COALESCE(p_email, 'user' || n || '@test.local'), false);
  EXECUTE 'RESET ROLE'; EXECUTE 'SET ROLE authenticated'; END $$;
CREATE FUNCTION t.as_anon() RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', false); PERFORM set_config('request.jwt.claim.email', '', false);
  EXECUTE 'RESET ROLE'; EXECUTE 'SET ROLE anon'; END $$;
CREATE FUNCTION t.as_admin() RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'RESET ROLE'; END $$;
CREATE FUNCTION t.check(p_name TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT '') RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  IF p_ok IS TRUE THEN RAISE INFO 'PASS %', p_name; ELSE RAISE EXCEPTION 'FAIL % %', p_name, p_detail; END IF; END $$;
CREATE FUNCTION t.raises(p_sql TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$ BEGIN EXECUTE p_sql; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
-- the error message a statement raises ('' if it does not)
CREATE FUNCTION t.err(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$ BEGIN EXECUTE p_sql; RETURN ''; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;

-- ── the reviewer's secret (stand-in) ─────────────────────────────────────────
CREATE FUNCTION public.ican_dev_secret() RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT 'dev_test_secret'::TEXT $$;
REVOKE ALL ON FUNCTION public.ican_dev_secret() FROM PUBLIC, anon, authenticated;

-- ── wallets: the columns the national-ID trigger and functions look at ───────
CREATE TABLE public.user_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_type TEXT DEFAULT 'personal',
  account_holder_name TEXT, email TEXT, phone_number TEXT, country_code TEXT,
  pin_hash TEXT,
  usd_balance NUMERIC DEFAULT 0, ugx_balance NUMERIC DEFAULT 0, kes_balance NUMERIC DEFAULT 0, ican_coin_balance NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
