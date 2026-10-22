-- Test stub. Not a migration: never run this against a real database.
-- Just enough Supabase (roles, auth.uid, default grants) and enough of the shop / dropship / wallet world for the REAL
-- dropship_checkout and customer_self_checkout (run.sh loads their text straight out of the backend files) to run.
\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID $$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
-- Supabase's default: every new public table and FUNCTION is granted straight to the API roles.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- ── test helpers (same shape as the repo's other SQL tests) ──────────────────
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO PUBLIC;
CREATE FUNCTION t.u(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-' || lpad(n::TEXT, 12, '0'))::UUID $$;
CREATE FUNCTION t.login(n INT) RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN PERFORM set_config('request.jwt.claim.sub', t.u(n)::TEXT, false); END $$;
CREATE FUNCTION t.as_anon() RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', false); EXECUTE 'SET ROLE anon'; END $$;
CREATE FUNCTION t.as_authenticated() RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'SET ROLE authenticated'; END $$;
CREATE FUNCTION t.as_admin() RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'RESET ROLE'; END $$;
CREATE FUNCTION t.check(p_name TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT '') RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  IF p_ok IS TRUE THEN RAISE INFO 'PASS %', p_name; ELSE RAISE EXCEPTION 'FAIL % %', p_name, p_detail; END IF; END $$;
CREATE FUNCTION t.raises(p_sql TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$ BEGIN EXECUTE p_sql; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
-- the text of a function, with all whitespace collapsed (so a patch that only changed layout still compares equal)
CREATE FUNCTION t.fn_text(p_sig TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT regexp_replace(pg_get_functiondef(p_sig::regprocedure), '\s+', ' ', 'g') $$;
CREATE TABLE t.keep (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t.keep TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;

-- ── people, stores, catalogue ────────────────────────────────────────────────
CREATE TABLE public.business_profiles (id UUID PRIMARY KEY, user_id UUID, business_name TEXT);
CREATE TABLE public.users (id UUID PRIMARY KEY, full_name TEXT, phone TEXT);
CREATE FUNCTION public.ensure_dce_customer_profile(p_user UUID) RETURNS VOID LANGUAGE sql AS
  $$ INSERT INTO public.users (id, full_name, phone) VALUES (p_user, 'Test Customer', '0700000000') ON CONFLICT DO NOTHING $$;

CREATE TABLE public.supermarkets (
  id UUID PRIMARY KEY, owner_user_id UUID, name TEXT, location TEXT, address TEXT,
  pichin_business_profile_id UUID, latitude NUMERIC, longitude NUMERIC, price_currency TEXT);
CREATE TABLE public.products (
  id UUID PRIMARY KEY, supermarket_id UUID, name TEXT, sku TEXT, barcode TEXT, selling_price NUMERIC, tax_rate NUMERIC,
  is_active BOOLEAN DEFAULT TRUE, is_dropship_excluded BOOLEAN NOT NULL DEFAULT FALSE);
CREATE TABLE public.inventory (product_id UUID, supermarket_id UUID, current_stock NUMERIC, reserved_stock NUMERIC DEFAULT 0, updated_at TIMESTAMPTZ);
CREATE TABLE public.dropship_listings (
  reseller_business_profile_id UUID, product_id UUID, supermarket_id UUID, listed_price NUMERIC,
  is_active BOOLEAN NOT NULL DEFAULT TRUE, free_delivery BOOLEAN NOT NULL DEFAULT FALSE, max_delivery_subsidy NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (reseller_business_profile_id, product_id));

-- ── wallets ──────────────────────────────────────────────────────────────────
CREATE TABLE public.ican_user_wallets (user_id UUID PRIMARY KEY, ican_balance NUMERIC NOT NULL DEFAULT 0, total_spent NUMERIC NOT NULL DEFAULT 0);
CREATE TABLE public.ican_business_wallets (business_profile_id UUID PRIMARY KEY, ican_balance NUMERIC NOT NULL DEFAULT 0);
CREATE TABLE public.ican_coin_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), sender_user_id UUID, receiver_user_id UUID, ican_amount NUMERIC, type TEXT,
  transaction_type TEXT, status TEXT, local_amount NUMERIC, local_currency TEXT, merchant_name TEXT, counterparty_type TEXT,
  expense_classification TEXT, source_app TEXT, reference_id TEXT, note TEXT, business_profile_id UUID);

-- transfer_ican: the real one moves coin between two wallets and writes the sender's ledger row; so does this
CREATE FUNCTION public.transfer_ican(
  p_sender UUID, p_receiver UUID, p_amount DECIMAL, p_note TEXT, p_source_app TEXT, p_ref TEXT, p_local DECIMAL,
  p_currency TEXT, p_merchant TEXT, p_counterparty TEXT, p_class TEXT, p_business UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.ican_user_wallets SET ican_balance = ican_balance - p_amount, total_spent = total_spent + p_amount
   WHERE user_id = p_sender AND ican_balance >= p_amount;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance'); END IF;
  INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES (p_receiver, p_amount)
    ON CONFLICT (user_id) DO UPDATE SET ican_balance = public.ican_user_wallets.ican_balance + p_amount;
  INSERT INTO public.ican_coin_transactions (sender_user_id, receiver_user_id, ican_amount, type, transaction_type, status,
    local_amount, local_currency, merchant_name, counterparty_type, expense_classification, source_app, reference_id, note)
  VALUES (p_sender, p_receiver, p_amount, 'transfer_out', 'transfer_out', 'completed', p_local, p_currency, p_merchant,
    p_counterparty, p_class, p_source_app, p_ref, p_note);
  RETURN jsonb_build_object('success', true);
END $$;

-- ── the platform-fee business (ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql) ─────
CREATE TABLE public.ican_platform_fee_recipient (id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id), business_profile_id UUID);
CREATE FUNCTION public.fn_get_platform_fee_business_id() RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT business_profile_id FROM public.ican_platform_fee_recipient WHERE id = true $$;
REVOKE ALL ON FUNCTION public.fn_get_platform_fee_business_id() FROM PUBLIC, anon, authenticated;
CREATE TABLE public.platform_fee_log (reference TEXT, fee_type TEXT, amount_ican NUMERIC);
CREATE FUNCTION public.fn_credit_platform_fee_to_business(
  p_amount_ican NUMERIC, p_source_app TEXT, p_source_reference TEXT, p_fee_type TEXT, p_actor_user_id UUID,
  p_note TEXT DEFAULT '', p_metadata JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_biz UUID := public.fn_get_platform_fee_business_id();
BEGIN
  IF v_biz IS NULL THEN RETURN jsonb_build_object('success', false, 'credited', false, 'error', 'not configured'); END IF;
  INSERT INTO public.ican_business_wallets (business_profile_id, ican_balance) VALUES (v_biz, p_amount_ican)
    ON CONFLICT (business_profile_id) DO UPDATE SET ican_balance = public.ican_business_wallets.ican_balance + p_amount_ican;
  INSERT INTO public.platform_fee_log VALUES (p_source_reference, p_fee_type, p_amount_ican);
  RETURN jsonb_build_object('success', true, 'credited', true);
END $$;

-- what the settlement-leg release (icanera_confirm_pickup) calls for a business payee / a personal payee
CREATE TABLE public.business_income_log (business_profile_id UUID, amount_ican NUMERIC, reference TEXT, note TEXT);
CREATE FUNCTION public.ican_settle_business_wallet_income(
  p_business UUID, p_ican NUMERIC, p_source_app TEXT, p_ref TEXT, p_type TEXT, p_note TEXT, p_meta JSONB
) RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.ican_business_wallets (business_profile_id, ican_balance) VALUES (p_business, p_ican)
    ON CONFLICT (business_profile_id) DO UPDATE SET ican_balance = public.ican_business_wallets.ican_balance + p_ican;
  INSERT INTO public.business_income_log VALUES (p_business, p_ican, p_ref, p_note);
  RETURN jsonb_build_object('success', true);
END $$;
CREATE FUNCTION public.mbg_credit_ride_earning(p_user UUID, p_ican NUMERIC, p_app TEXT, p_ref TEXT, p_note TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES (p_user, p_ican)
    ON CONFLICT (user_id) DO UPDATE SET ican_balance = public.ican_user_wallets.ican_balance + p_ican;
  RETURN jsonb_build_object('success', true);
END $$;

-- ── BodaGoera (riders, rides, fares) ─────────────────────────────────────────
CREATE TABLE public.mbg_platform_settings (key TEXT PRIMARY KEY, value NUMERIC);
CREATE FUNCTION public.mbg_get_setting_numeric(p_key TEXT, p_default NUMERIC) RETURNS NUMERIC LANGUAGE sql STABLE AS
  $$ SELECT COALESCE((SELECT value FROM public.mbg_platform_settings WHERE key = p_key), p_default) $$;
CREATE FUNCTION public.mbg_ican_price_in_currency(p_currency TEXT) RETURNS NUMERIC LANGUAGE sql AS $$ SELECT 5000::NUMERIC $$;
CREATE FUNCTION public.mbg_haversine_km(a NUMERIC, b NUMERIC, c NUMERIC, d NUMERIC) RETURNS NUMERIC LANGUAGE sql AS $$ SELECT 5::NUMERIC $$;
CREATE FUNCTION public.mbg_current_time_multiplier() RETURNS NUMERIC LANGUAGE sql AS $$ SELECT 1::NUMERIC $$;
CREATE TABLE public.mbg_riders (
  id UUID PRIMARY KEY, user_id UUID, status TEXT, is_available BOOLEAN, mode TEXT,
  vip_surcharge_pct NUMERIC, discount_pct NUMERIC, return_discount_pct NUMERIC);
CREATE FUNCTION public.mbg_find_available_riders(
  a NUMERIC, b NUMERIC, c NUMERIC, d NUMERIC, e NUMERIC DEFAULT NULL, f NUMERIC DEFAULT NULL, g BOOLEAN DEFAULT false,
  h UUID[] DEFAULT NULL, i INTEGER DEFAULT 5, j TEXT[] DEFAULT NULL
) RETURNS TABLE (rider_id UUID) LANGUAGE sql AS
  $$ SELECT id FROM public.mbg_riders WHERE status = 'active' AND is_available LIMIT 1 $$;
CREATE TABLE public.mbg_stages (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), is_active BOOLEAN, location_lat NUMERIC, location_lng NUMERIC);
CREATE TABLE public.mbg_customers (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID);
CREATE TABLE public.mbg_rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), customer_id UUID, rider_id UUID, stage_id UUID, pickup_location TEXT,
  pickup_lat NUMERIC, pickup_lng NUMERIC, dropoff_location TEXT, dropoff_lat NUMERIC, dropoff_lng NUMERIC, status TEXT,
  fare NUMERIC, service_type TEXT, delivery_mode TEXT, supermarket_id UUID, time_multiplier NUMERIC, rider_earning NUMERIC,
  chairperson_commission_total NUMERIC, order_notes TEXT, payment_method TEXT, wallet_charged_at_acceptance BOOLEAN,
  max_delivery_hours NUMERIC);
CREATE TABLE public.mbg_ride_platform_fees (ride_id UUID, platform_fee_ugx NUMERIC);

-- ── receipts / the 3-party delivery receipt that holds the settlement legs ───
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), transaction_id TEXT, receipt_number TEXT, cashier_id UUID, cashier_name TEXT,
  register_number TEXT, store_location TEXT, supermarket_id UUID, subtotal NUMERIC, tax_amount NUMERIC, tax_rate NUMERIC,
  total_amount NUMERIC, payment_method TEXT, customer_name TEXT, customer_phone TEXT, customer_user_id UUID,
  items_count INTEGER, items JSONB, status TEXT, created_at TIMESTAMPTZ);
CREATE TABLE public.sales_transaction_items (
  transaction_id UUID, product_id UUID, product_name TEXT, product_sku TEXT, product_barcode TEXT, unit_price NUMERIC,
  quantity NUMERIC, line_total NUMERIC, tax_included BOOLEAN, tax_amount NUMERIC);
CREATE TABLE public.receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), receipt_number TEXT, transaction_id TEXT, cashier_id UUID, cashier_name TEXT,
  customer_name TEXT, subtotal NUMERIC, tax_amount NUMERIC, total_amount NUMERIC, amount_paid NUMERIC, payment_method TEXT,
  items_json JSONB, status TEXT, register_id TEXT, store_location TEXT, created_at TIMESTAMPTZ,
  supermarket_id UUID, store_name TEXT);   -- the last two are set by the deployed shop checkout, not by the repo copy
-- shop loyalty points (FIX_SELF_CHECKOUT_POINTS_AND_ADMIN_HISTORY.sql): the deployed shop checkout calls it, nothing to check here
CREATE FUNCTION public.dce_award_shop_points(p_customer UUID, p_total NUMERIC, p_receipt TEXT, p_store UUID, p_tx UUID) RETURNS VOID LANGUAGE sql AS $$ SELECT $$;
CREATE TABLE public.stub_delivery_receipts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), reference_id UUID, amount_ican NUMERIC, settlement_legs JSONB);
CREATE FUNCTION public.icanera_create_delivery_receipt(
  p_source_app TEXT, p_reference_type TEXT, p_reference_id UUID, p_customer UUID, p_store_owner UUID, p_rider UUID,
  p_store_name TEXT, p_summary TEXT, p_amount_ican NUMERIC, p_unused TEXT DEFAULT NULL, p_legs JSONB DEFAULT NULL, p_hours NUMERIC DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.stub_delivery_receipts (reference_id, amount_ican, settlement_legs) VALUES (p_reference_id, p_amount_ican, p_legs) RETURNING id INTO v_id;
  RETURN jsonb_build_object('verification_code', 'TESTCODE', 'verify_url', 'https://example.test/verify', 'id', v_id);
END $$;

CREATE TABLE public.dropship_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), transaction_id TEXT, reseller_business_profile_id UUID, supermarket_id UUID,
  wholesale_amount NUMERIC, reseller_margin_amount NUMERIC, customer_paid_amount NUMERIC, customer_receipt_number TEXT,
  store_receipt_number TEXT, pickup_address TEXT, delivery_address TEXT, delivery_fee_amount NUMERIC, real_transport_fare NUMERIC,
  reseller_transport_subsidy NUMERIC, status TEXT, transport_status TEXT, bodago_delivery_request_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());

SET client_min_messages = warning;
