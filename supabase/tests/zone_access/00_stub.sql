-- Test stub. Not a migration: never run this against a real database.
-- Just enough Supabase (roles, auth.uid / auth.jwt, default grants), CMMS, wallets and BodaGoEra rider cards for the REAL
-- migration 20261110100000_restricted_zone_access.sql to run. The fee-rate table + ican_fee_rate() are the real ones (run.sh
-- cuts them out of 20261106100000_fee_rates.sql).
\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID $$;
CREATE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE sql STABLE AS
  $$ SELECT jsonb_build_object('email', NULLIF(current_setting('request.jwt.claim.email', true), '')) $$;
CREATE TABLE auth.users (id UUID PRIMARY KEY);

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
-- Supabase's default: every new public table and FUNCTION is granted straight to the API roles.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- ── test helpers ─────────────────────────────────────────────────────────────
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO PUBLIC;
CREATE FUNCTION t.u(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-' || lpad(n::TEXT, 12, '0'))::UUID $$;
-- sign in as user n (with an e-mail, which the CMMS role lookup uses) as the API role
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
CREATE TABLE t.keep (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t.keep TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;

-- ── business + CMMS ──────────────────────────────────────────────────────────
CREATE TABLE public.business_profiles (id UUID PRIMARY KEY, user_id UUID, business_name TEXT);
CREATE TABLE public.cmms_company_profiles (id UUID PRIMARY KEY, pichin_business_profile_id UUID);
CREATE TABLE public.cmms_users (
  id UUID PRIMARY KEY, cmms_company_id UUID, email TEXT, user_name TEXT, role TEXT, is_active BOOLEAN DEFAULT TRUE, is_creator BOOLEAN DEFAULT FALSE);
CREATE TABLE public.cmms_roles (id UUID PRIMARY KEY, role_name TEXT, tool_access JSONB, is_active BOOLEAN DEFAULT TRUE);
CREATE TABLE public.cmms_user_roles (cmms_user_id UUID, cmms_role_id UUID, is_active BOOLEAN DEFAULT TRUE);

-- ── wallets ──────────────────────────────────────────────────────────────────
CREATE TABLE public.ican_user_wallets (user_id UUID PRIMARY KEY, ican_balance NUMERIC NOT NULL DEFAULT 0, total_spent NUMERIC NOT NULL DEFAULT 0);
CREATE TABLE public.ican_business_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_profile_id UUID NOT NULL UNIQUE,
  ican_balance NUMERIC(18,8) NOT NULL DEFAULT 0 CHECK (ican_balance >= 0), total_earned NUMERIC NOT NULL DEFAULT 0,
  total_spent NUMERIC NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_by UUID, updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.ican_business_wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_profile_id UUID NOT NULL, initiated_by UUID NOT NULL,
  amount_ican NUMERIC NOT NULL CHECK (amount_ican > 0), note TEXT NOT NULL DEFAULT '', reference_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed', executed_at TIMESTAMPTZ, direction TEXT NOT NULL DEFAULT 'out',
  source_app TEXT NOT NULL DEFAULT 'ican', operation_type TEXT NOT NULL DEFAULT 'transfer', metadata JSONB NOT NULL DEFAULT '{}');

CREATE TABLE public.mbg_platform_settings (key TEXT PRIMARY KEY, value NUMERIC);
CREATE FUNCTION public.mbg_get_setting_numeric(p_key TEXT, p_default NUMERIC) RETURNS NUMERIC LANGUAGE sql STABLE AS
  $$ SELECT COALESCE((SELECT value FROM public.mbg_platform_settings WHERE key = p_key), p_default) $$;

-- the rider wallet debit (ICAN/backend/ADD_JOURNEY_FARE_EXPENSE_CLASSIFICATION.sql): same refusal wording
CREATE FUNCTION public.mbg_debit_journey_fare(p_user_id UUID, p_ican_amount DECIMAL, p_source_app TEXT DEFAULT 'mybodaguy', p_reference_id TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_bal DECIMAL;
BEGIN
  SELECT ican_balance INTO v_bal FROM public.ican_user_wallets WHERE user_id = p_user_id FOR UPDATE;
  IF v_bal IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Wallet not found'); END IF;
  IF v_bal < p_ican_amount THEN
    RETURN jsonb_build_object('success', false, 'error', format('Insufficient ICAN. Have: %s, Need: %s', v_bal, p_ican_amount));
  END IF;
  UPDATE public.ican_user_wallets SET ican_balance = ican_balance - p_ican_amount, total_spent = total_spent + p_ican_amount WHERE user_id = p_user_id;
  RETURN jsonb_build_object('success', true, 'tx_id', gen_random_uuid(), 'ican_debited', p_ican_amount);
END $$;

-- the tithe-free credit that pays a rider back (ICAN/backend/ADD_RIDE_EARNING_CREDIT_FUNCTION.sql)
CREATE FUNCTION public.mbg_credit_ride_earning(p_user_id UUID, p_ican_amount DECIMAL, p_source_app TEXT DEFAULT 'mybodaguy', p_reference_id TEXT DEFAULT NULL, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES (p_user_id, p_ican_amount)
    ON CONFLICT (user_id) DO UPDATE SET ican_balance = public.ican_user_wallets.ican_balance + p_ican_amount;
  RETURN jsonb_build_object('success', true);
END $$;

-- ── the platform-fee business (ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql) ─────
CREATE TABLE public.ican_platform_fee_recipient (id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id), business_profile_id UUID);
CREATE FUNCTION public.fn_get_platform_fee_business_id() RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT business_profile_id FROM public.ican_platform_fee_recipient WHERE id = true $$;
CREATE TABLE public.platform_fee_log (reference TEXT UNIQUE, fee_type TEXT, amount_ican NUMERIC);
CREATE FUNCTION public.fn_credit_platform_fee_to_business(
  p_amount_ican NUMERIC, p_source_app TEXT, p_source_reference TEXT, p_fee_type TEXT, p_actor_user_id UUID,
  p_note TEXT DEFAULT '', p_metadata JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_biz UUID := public.fn_get_platform_fee_business_id();
BEGIN
  IF v_biz IS NULL THEN RETURN jsonb_build_object('success', false, 'credited', false, 'error', 'Platform fee recipient business not configured'); END IF;
  BEGIN
    INSERT INTO public.platform_fee_log VALUES (p_source_reference, p_fee_type, p_amount_ican);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', true, 'credited', false, 'status', 'already_settled');
  END;
  INSERT INTO public.ican_business_wallets (business_profile_id, ican_balance, total_earned) VALUES (v_biz, p_amount_ican, p_amount_ican)
    ON CONFLICT (business_profile_id) DO UPDATE SET ican_balance = public.ican_business_wallets.ican_balance + p_amount_ican;
  RETURN jsonb_build_object('success', true, 'credited', true);
END $$;

-- ── BodaGoEra riders and cards ───────────────────────────────────────────────
CREATE TABLE public.mbg_riders (
  id UUID PRIMARY KEY, user_id UUID, vehicle_type TEXT, plate_number TEXT, vehicle_model TEXT, vehicle_color TEXT,
  status TEXT DEFAULT 'active', license_expiry DATE);
CREATE TABLE public.mbg_rider_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), rider_id UUID NOT NULL REFERENCES public.mbg_riders(id) ON DELETE CASCADE,
  rider_user_id UUID NOT NULL, card_number TEXT NOT NULL UNIQUE, verify_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending_payment', 'active', 'revoked')),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ);
-- the keys the zones read from the real mbg_rider_card_payload
CREATE FUNCTION public.mbg_rider_card_payload(p_card_id UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT jsonb_build_object(
    'card_id', c.id, 'card_number', c.card_number, 'verify_code', c.verify_code, 'status', c.status, 'expires_at', c.expires_at,
    'card_expired', c.expires_at IS NOT NULL AND c.expires_at < now(), 'rider_id', r.id,
    'full_name', 'Rider ' || r.plate_number, 'avatar_url', NULL, 'vehicle_type', r.vehicle_type, 'plate_number', r.plate_number,
    'vehicle_model', r.vehicle_model, 'vehicle_color', r.vehicle_color, 'rider_status', r.status, 'stage', 'Kisenyi stage', 'division', 'Central',
    'permit_status', CASE WHEN r.license_expiry IS NULL THEN 'not_recorded' WHEN r.license_expiry < current_date THEN 'expired'
                          WHEN r.license_expiry <= current_date + 30 THEN 'expiring_soon' ELSE 'valid' END,
    'commission_owed_ugx', 0, 'insurance', NULL)
  FROM public.mbg_rider_cards c JOIN public.mbg_riders r ON r.id = c.rider_id WHERE c.id = p_card_id $$;

-- customers and their rides (status is an enum in the real table; the zones only compare it as text)
CREATE TABLE public.mbg_customers (id UUID PRIMARY KEY, user_id UUID);
CREATE TABLE public.mbg_rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), customer_id UUID NOT NULL REFERENCES public.mbg_customers(id),
  rider_id UUID REFERENCES public.mbg_riders(id), pickup_lat NUMERIC, pickup_lng NUMERIC, dropoff_lat NUMERIC, dropoff_lng NUMERIC,
  status TEXT NOT NULL DEFAULT 'pending', payment_method TEXT NOT NULL DEFAULT 'wallet', requested_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- phone alerts: record them instead of sending
CREATE TABLE public.push_log (user_id UUID, source TEXT, title TEXT, message TEXT);
CREATE FUNCTION public.mbg_push(p_user_id UUID, p_source TEXT, p_title TEXT, p_message TEXT, p_ride_id UUID, p_tag TEXT DEFAULT NULL, p_video BOOLEAN DEFAULT FALSE)
RETURNS VOID LANGUAGE sql AS $$ INSERT INTO public.push_log VALUES (p_user_id, p_source, p_title, p_message) $$;
