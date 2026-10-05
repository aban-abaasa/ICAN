-- Test stub for the franchise layer. Not a migration: never run this against a real database.
--
-- Recreates just enough of Supabase (the anon / authenticated / service_role roles, auth.users, auth.uid(),
-- and the default grants Supabase gives new objects) plus the existing ICAN tables the franchise migration
-- attaches to. The fee-crediting and fee-reversal FUNCTIONS are not stubbed: run.sh extracts the real ones
-- from backend/ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql and backend/FIX_AND_BACKFILL_PLATFORM_FEE_ROUTING.sql,
-- so the franchise trigger is exercised against the actual money code.
\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  raw_user_meta_data JSONB DEFAULT '{}'::JSONB
);
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID $$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
-- Supabase's default: new public objects are open to the API roles. The migration must close what it needs closed.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO service_role;

CREATE TABLE public.profiles (id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, email TEXT, full_name TEXT);

CREATE TABLE public.business_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name TEXT, business_type TEXT, country VARCHAR(2), status TEXT DEFAULT 'active',
  metadata JSONB DEFAULT '{}'::JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.user_accounts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, country_code VARCHAR(2));

CREATE TYPE mbg_user_role_type AS ENUM ('customer', 'rider', 'developer');
CREATE TABLE public.mbg_users (id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, email TEXT NOT NULL, role_type mbg_user_role_type NOT NULL DEFAULT 'customer', is_active BOOLEAN NOT NULL DEFAULT true);
CREATE TABLE public.mbg_user_profiles (user_id UUID PRIMARY KEY REFERENCES public.mbg_users(id) ON DELETE CASCADE, country TEXT DEFAULT 'Uganda');
CREATE TABLE public.country_tax_rules (country_code VARCHAR(2) PRIMARY KEY, country_name TEXT NOT NULL);
INSERT INTO public.country_tax_rules VALUES ('ZM', 'Zambia'), ('UG', 'Uganda');

-- Real wallet tables (columns as in PITCHIN_BUSINESS_PROFILE_ICAN_WALLET.sql + the later UNIFIED_BUSINESS_WALLET_OPERATIONS additions).
CREATE TABLE public.ican_business_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL UNIQUE REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL UNIQUE DEFAULT ('3' || to_char(now(), 'YYYYMMDDHH24MISS') || floor(random()*1000000)::text),
  ican_balance NUMERIC(18,8) NOT NULL DEFAULT 0 CHECK (ican_balance >= 0),
  total_earned NUMERIC(18,8) NOT NULL DEFAULT 0,
  total_spent NUMERIC(18,8) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.ican_business_wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  initiated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  recipient_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  amount_ican NUMERIC(18,8) NOT NULL CHECK (amount_ican > 0),
  note TEXT NOT NULL DEFAULT '', reference_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending_approval','completed','rejected','cancelled')),
  required_approval_percentage NUMERIC(5,2) NOT NULL DEFAULT 60,
  approved_ownership_percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), executed_at TIMESTAMPTZ,
  direction TEXT, source_app TEXT, operation_type TEXT, metadata JSONB
);
CREATE TABLE public.ican_business_wallet_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  source_app TEXT NOT NULL, source_reference TEXT NOT NULL,
  amount_ican NUMERIC(18,8) NOT NULL CHECK (amount_ican > 0),
  settlement_type TEXT NOT NULL CHECK (settlement_type IN ('pos_sale', 'investment', 'refund', 'other_income')),
  note TEXT NOT NULL DEFAULT '', metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (source_app, source_reference)
);

-- HQ's fee-recipient business (the real ROUTE file bootstraps it from this email).
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000a1', 'icancoin9@gmail.com');
INSERT INTO public.profiles (id, email) VALUES ('00000000-0000-0000-0000-0000000000a1', 'icancoin9@gmail.com');
INSERT INTO public.business_profiles (id, user_id, business_name, country)
VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'IWOS ORGANIZATION LIMITED', 'UG');

-- The widened constraint (as the real FIX file leaves it) + REAL credit and reversal functions.
\i real_fee_credit.sql
\i real_fee_reverse.sql

CREATE SCHEMA IF NOT EXISTS t;
CREATE TABLE t.results (n SERIAL PRIMARY KEY, name TEXT NOT NULL, ok BOOLEAN NOT NULL, info TEXT);
GRANT ALL ON SCHEMA t TO PUBLIC;
GRANT ALL ON t.results TO PUBLIC;
GRANT ALL ON SEQUENCE t.results_n_seq TO PUBLIC;

CREATE FUNCTION t.check(p_name TEXT, p_ok BOOLEAN, p_info TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN INSERT INTO t.results (name, ok, info) VALUES (p_name, COALESCE(p_ok, false), p_info); END; $$;

-- Run a statement and return the error message it raised (NULL = it succeeded).
CREATE FUNCTION t.err(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END; $$;

-- Impersonate a signed-in user for the rest of the current transaction.
CREATE FUNCTION t.as_user(p_uid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::TEXT, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END; $$;
CREATE FUNCTION t.as_anon() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  EXECUTE 'SET LOCAL ROLE anon';
END; $$;
CREATE FUNCTION t.as_service() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  EXECUTE 'SET LOCAL ROLE service_role';
END; $$;
CREATE FUNCTION t.reset() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END; $$;
