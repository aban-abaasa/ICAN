-- Test stub for the Era API. Not a migration: never run this against a real database.
--
-- Recreates just enough of Supabase (the anon / authenticated / service_role roles, auth.users, auth.uid(), and the
-- default grants Supabase gives new objects) plus the existing app tables the endpoint handlers read, with the
-- column names of the real schema.
\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT UNIQUE,
  raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::JSONB, raw_app_meta_data JSONB NOT NULL DEFAULT '{}'::JSONB);
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID $$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
-- Supabase's default: new public objects are open to the API roles. The migration must close what it needs closed.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TYPE mbg_user_role_type AS ENUM ('customer', 'rider', 'developer');
CREATE TABLE public.mbg_users (id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, email TEXT NOT NULL,
  role_type mbg_user_role_type NOT NULL DEFAULT 'customer', is_active BOOLEAN NOT NULL DEFAULT true);
CREATE TABLE public.ican_franchise_admins (user_id UUID PRIMARY KEY, note TEXT);

-- ICANERA
CREATE TABLE public.ican_coin_market_prices (id BIGSERIAL PRIMARY KEY, price_usd NUMERIC, price_ugx NUMERIC, price_eur NUMERIC,
  price_gbp NUMERIC, price_jpy NUMERIC, percentage_change_24h NUMERIC, percentage_change_7d NUMERIC, all_time_high NUMERIC,
  all_time_low NUMERIC, timestamp TIMESTAMPTZ DEFAULT now(), last_updated TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.ican_price_ohlc (id BIGSERIAL PRIMARY KEY, open_price NUMERIC, high_price NUMERIC, low_price NUMERIC,
  close_price NUMERIC, trading_volume NUMERIC, timeframe TEXT, open_time TIMESTAMPTZ);
CREATE TABLE public.ican_currency_rates (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), currency_code VARCHAR(3), currency_name TEXT,
  country_name TEXT, country_code VARCHAR(2), region TEXT, rate_to_ugx NUMERIC, initial_rate_to_ugx NUMERIC, local_inflation_pct NUMERIC, updated_at TIMESTAMPTZ DEFAULT now(), stability_anchor_at TIMESTAMPTZ);
CREATE TABLE public.ican_country_currency_map (country_code VARCHAR(2), currency_code VARCHAR(3));
CREATE TABLE public.country_tax_rules (id BIGSERIAL PRIMARY KEY, country_code VARCHAR(2), country_name VARCHAR, currency VARCHAR,
  personal_tax_brackets JSONB, personal_tax_period VARCHAR, corporate_tax_rate NUMERIC, vat_rate NUMERIC, capital_gains_rate NUMERIC,
  deductible_expenses JSONB, filing_date VARCHAR, regulatory_body VARCHAR, requirements JSONB, source TEXT, source_citation TEXT,
  last_verified_at TIMESTAMPTZ);
-- the existing anon-callable directory search (same signature and result shape as the real one)
CREATE FUNCTION public.fn_search_public_cmms_businesses(p_query TEXT, p_limit INTEGER, p_offset INTEGER)
RETURNS TABLE (id UUID, company_name VARCHAR, industry VARCHAR, location VARCHAR, tagline VARCHAR, website VARCHAR,
               logo_url TEXT, cover_image_url TEXT, open_jobs BIGINT, notices BIGINT) LANGUAGE sql STABLE AS $$
  SELECT gen_random_uuid(), n::VARCHAR, 'Retail'::VARCHAR, 'Kampala'::VARCHAR, 'tag'::VARCHAR, NULL::VARCHAR, NULL::TEXT, 'cover'::TEXT, 1::BIGINT, 2::BIGINT
    FROM unnest(ARRAY['Agro Hub', 'Beta Co', 'Gamma Ltd']) n
   WHERE p_query IS NULL OR n ILIKE '%' || p_query || '%' LIMIT p_limit OFFSET p_offset $$;

-- BODAGOERA
CREATE TABLE public.mbg_districts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT, code TEXT, description TEXT, is_active BOOLEAN DEFAULT true);
CREATE TABLE public.mbg_stages (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), parish_id UUID, name TEXT, location_name TEXT,
  location_lat NUMERIC, location_lng NUMERIC, description TEXT, is_active BOOLEAN DEFAULT true);
CREATE TABLE public.mbg_ports (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), country TEXT, city TEXT, port_name TEXT, latitude NUMERIC,
  longitude NUMERIC, is_active BOOLEAN DEFAULT true, un_locode TEXT);
CREATE TABLE public.mbg_platform_settings (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), key TEXT UNIQUE, value TEXT, is_public BOOLEAN DEFAULT false);
-- the real verifier returns more than the API may pass on (phones, licence, fees): the handler must strip it
CREATE FUNCTION public.mbg_verify_rider_card(p_code TEXT) RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_code = 'ABCDEF0123456789ABCD' THEN jsonb_build_object(
    'is_valid', true, 'state', 'valid', 'card_number', 'BGE-9', 'full_name', 'Real Rider', 'vehicle_type', 'motorcycle',
    'plate_number', 'UBB 111C', 'rating', 4.9, 'completed_rides', 10, 'stage', 'S', 'district', 'D', 'permit_status', 'valid',
    'stage_contact_phone', '+256700000000', 'license_masked', 'XXXX1234', 'fees', jsonb_build_object('commission_owed_ugx', 5000))
    ELSE jsonb_build_object('is_valid', false) END $$;

-- SUPERMARKETERA
CREATE TABLE public.supermarkets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT, location TEXT, phone TEXT, address TEXT,
  is_active BOOLEAN DEFAULT true, owner_user_id UUID, slug TEXT, description TEXT, logo_url TEXT, email TEXT, city TEXT, country TEXT,
  status TEXT, latitude NUMERIC, longitude NUMERIC, business_type VARCHAR, offers_products BOOLEAN, offers_services BOOLEAN, price_currency VARCHAR);
CREATE TABLE public.supplier_catalog_items (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), supplier_user_id UUID, name TEXT, category TEXT,
  description TEXT, unit TEXT, min_order_qty NUMERIC, price_per_unit NUMERIC, currency TEXT, image_url TEXT, is_available BOOLEAN DEFAULT true,
  supplier_business_profile_id UUID, metadata JSONB, sku TEXT, barcode TEXT, brand TEXT, cost_price NUMERIC, tax_rate NUMERIC,
  stock_quantity INTEGER, minimum_stock INTEGER, price_tiers JSONB);

-- FARMAGENTERA
CREATE TABLE public.marketplace_listings (id SERIAL PRIMARY KEY, title TEXT, description TEXT, price NUMERIC, is_negotiable BOOLEAN,
  type TEXT, status TEXT, location TEXT, district TEXT, user_id UUID, thumbnail TEXT, images TEXT[], contact_phone TEXT, contact_email TEXT,
  contact_whatsapp TEXT, expiry_date DATE, featured BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.produce_listings (id SERIAL PRIMARY KEY, listing_id INTEGER, produce_type TEXT, crop_name TEXT, quantity NUMERIC, unit TEXT,
  harvest_date DATE, is_organic BOOLEAN, quality_description TEXT, min_order_quantity NUMERIC, availability TEXT);
CREATE TABLE public.land_listings (id SERIAL PRIMARY KEY, listing_id INTEGER, size_acres NUMERIC, land_type TEXT, ownership_type TEXT,
  is_for_sale BOOLEAN, lease_term TEXT, soil_type TEXT, water_source TEXT, has_road_access BOOLEAN, has_electricity BOOLEAN, cadastral_information TEXT);
CREATE TABLE public.service_listings (id SERIAL PRIMARY KEY, listing_id INTEGER, service_type TEXT, availability_schedule TEXT, price_unit TEXT,
  experience_years INTEGER, skills TEXT[], equipment TEXT[], service_area TEXT, qualifications TEXT);
CREATE TABLE public.crop_varieties (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR, scientific_name VARCHAR, crop_type VARCHAR,
  season VARCHAR, maturity_days INTEGER, expected_yield_per_hectare NUMERIC, description TEXT, soil_ph_min NUMERIC, soil_ph_max NUMERIC, water_requirements VARCHAR);

-- test helpers
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

-- Make an API call exactly as the gateway does: as the anon role, through the one public entry point.
CREATE FUNCTION t.call(p_key TEXT, p_path TEXT, p_query JSONB DEFAULT '{}', p_ip TEXT DEFAULT NULL, p_method TEXT DEFAULT 'GET')
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  PERFORM t.as_anon();
  r := public.era_api_call(p_key, p_method, p_path, p_query, p_ip);
  PERFORM t.reset();
  RETURN r;
END; $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;

-- Fixtures: a developer (admin), an ordinary user, and some real-looking rows for the live handlers.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'dev@test.dev'),
  ('00000000-0000-0000-0000-000000000002', 'user@test.dev'),
  ('00000000-0000-0000-0000-000000000003', 'apiadmin@test.dev'),
  ('00000000-0000-0000-0000-000000000004', 'franchise@test.dev');
INSERT INTO public.mbg_users (id, email, role_type) VALUES
  ('00000000-0000-0000-0000-000000000001', 'dev@test.dev', 'developer'),
  ('00000000-0000-0000-0000-000000000002', 'user@test.dev', 'customer');
INSERT INTO public.ican_franchise_admins (user_id) VALUES ('00000000-0000-0000-0000-000000000004');
