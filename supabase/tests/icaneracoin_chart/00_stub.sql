-- Test stub for the icaneracoin live-chart / atomic-trade migrations. Not a migration: never run it against a real database.
--
-- Recreates just enough of Supabase (roles, auth.uid()/role(), the default function grants that make every function
-- callable by anon) plus the existing ICAN tables the migrations build on, with the column names, defaults and
-- constraints the live database has (read from the live project, not guessed). The fair-price engine and the
-- candlestick triggers are NOT stubbed: run.sh applies the repo's own ICAN_PRICE_ENGINE.sql and
-- ICAN_REAL_CANDLESTICK_ENGINE.sql on top of this, so the "before" state is the real one.
\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT UNIQUE);
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.sub', true), ''),
                  (NULLIF(current_setting('request.jwt.claims', true), '')::JSONB ->> 'sub'))::UUID $$;
CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''),
                  (NULLIF(current_setting('request.jwt.claims', true), '')::JSONB ->> 'role'))::TEXT $$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
-- What Supabase does on every project: new tables, sequences and FUNCTIONS are granted to the API roles.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- The dev secret, exactly as 20261009100000_secure_dev_access.sql keeps it.
CREATE TABLE public.ican_dev_secret_store (id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id), secret TEXT NOT NULL, rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE public.ican_dev_secret_store ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ican_dev_secret_store FROM PUBLIC, anon, authenticated;
INSERT INTO public.ican_dev_secret_store (id, secret) VALUES (TRUE, 'dev_test_secret');
CREATE FUNCTION public.ican_dev_secret() RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT secret FROM public.ican_dev_secret_store WHERE id $$;
REVOKE ALL ON FUNCTION public.ican_dev_secret() FROM PUBLIC, anon, authenticated;

-- FX table (live rates, trimmed).
CREATE TABLE public.ican_currency_rates (
  currency_code TEXT PRIMARY KEY, currency_name TEXT, country_name TEXT,
  rate_to_ugx NUMERIC NOT NULL, initial_rate_to_ugx NUMERIC, local_inflation_pct NUMERIC DEFAULT 0
);
INSERT INTO public.ican_currency_rates (currency_code, rate_to_ugx, initial_rate_to_ugx) VALUES
  ('UGX', 1, 1), ('USD', 4088.733, 3700), ('KES', 31.5202309728871617, 28.50), ('NGN', 3.0713094796172874, 2.40);

CREATE TABLE public.user_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL UNIQUE,
  country_code VARCHAR(2), ican_coin_balance NUMERIC
);

-- The ledger, with the live defaults and CHECKs.
CREATE TABLE public.ican_coin_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID, type TEXT, ican_amount NUMERIC NOT NULL, local_amount NUMERIC, country_code TEXT, currency TEXT,
  price_per_coin NUMERIC, exchange_rate NUMERIC, payment_method TEXT, status TEXT DEFAULT 'pending',
  sender_user_id UUID, recipient_user_id UUID,
  timestamp TIMESTAMPTZ DEFAULT now(), created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
  transaction_type TEXT NOT NULL DEFAULT 'earn', ugx_floor_value NUMERIC, data_hash TEXT,
  source_app TEXT NOT NULL DEFAULT 'ican', reference_id TEXT, actor_role TEXT, note TEXT,
  local_currency VARCHAR DEFAULT 'UGX', merchant_name TEXT,
  counterparty_type TEXT DEFAULT 'person', expense_classification TEXT DEFAULT 'person_transfer',
  classification_source TEXT DEFAULT 'rules', business_profile_id UUID,
  CHECK (transaction_type = ANY (ARRAY['earn','transfer_in','transfer_out','tithe','cashback','purchase','sale','refund','buy','sell','journey_payment'])),
  CHECK (source_app = ANY (ARRAY['ican','digital-city-era','farm-agent','mybodaguy'])),
  CHECK (counterparty_type = ANY (ARRAY['person','business','unknown'])),
  CHECK (expense_classification = ANY (ARRAY['person_transfer','personal_expense','business_expense','income','refund','cash_out','other']))
);
ALTER TABLE public.ican_coin_transactions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.ican_business_wallet_transactions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), amount_ican NUMERIC, status TEXT);
CREATE TABLE public.trust_transactions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), amount NUMERIC, currency TEXT, transaction_type TEXT);
CREATE TABLE public.ican_sacco_contributions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), amount NUMERIC);
CREATE TABLE public.ican_sacco_repayments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), amount NUMERIC);

CREATE SEQUENCE public.ican_price_ohlc_id_seq;
CREATE TABLE public.ican_price_ohlc (
  id BIGINT PRIMARY KEY DEFAULT nextval('public.ican_price_ohlc_id_seq'),
  open_price NUMERIC NOT NULL, high_price NUMERIC NOT NULL, low_price NUMERIC NOT NULL, close_price NUMERIC NOT NULL,
  trading_volume NUMERIC, transaction_count INTEGER DEFAULT 0, timeframe TEXT DEFAULT '7s',
  open_time TIMESTAMPTZ NOT NULL, close_time TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_ican_ohlc_open_time ON public.ican_price_ohlc (open_time DESC);
CREATE INDEX idx_ican_ohlc_timeframe ON public.ican_price_ohlc (timeframe, open_time DESC);
ALTER TABLE public.ican_price_ohlc ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_ohlc_data ON public.ican_price_ohlc FOR SELECT USING (true);

-- Wallets (live shapes).
CREATE TABLE public.ican_user_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL UNIQUE,
  wallet_address TEXT NOT NULL UNIQUE DEFAULT ('ICA-' || upper(substr(md5(gen_random_uuid()::text), 1, 16))),
  ican_balance NUMERIC DEFAULT 0, total_spent NUMERIC DEFAULT 0, total_earned NUMERIC DEFAULT 0,
  purchase_count INTEGER DEFAULT 0, sale_count INTEGER DEFAULT 0,
  is_verified BOOLEAN DEFAULT false, status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
  total_tithe_paid NUMERIC NOT NULL DEFAULT 0, origin_app TEXT DEFAULT 'ican'
);
ALTER TABLE public.ican_user_wallets ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.wallet_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, balance NUMERIC NOT NULL, currency VARCHAR NOT NULL,
  status VARCHAR DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), metadata JSONB,
  UNIQUE (user_id, currency)
);
ALTER TABLE public.wallet_accounts ENABLE ROW LEVEL SECURITY;

-- Test helpers.
CREATE SCHEMA t;
CREATE TABLE t.results (n SERIAL PRIMARY KEY, name TEXT NOT NULL, ok BOOLEAN NOT NULL, info TEXT);
GRANT ALL ON SCHEMA t TO PUBLIC; GRANT ALL ON t.results TO PUBLIC; GRANT ALL ON SEQUENCE t.results_n_seq TO PUBLIC;
CREATE FUNCTION t.check(p_name TEXT, p_ok BOOLEAN, p_info TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN INSERT INTO t.results (name, ok, info) VALUES (p_name, COALESCE(p_ok, false), p_info); END; $$;
CREATE FUNCTION t.err(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END; $$;
CREATE FUNCTION t.u(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-' || lpad(n::TEXT, 12, '0'))::UUID $$;
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
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  EXECUTE 'RESET ROLE';
END; $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;
