-- Test stub. Not a migration: never run this against a real database.
-- Just enough Supabase (roles, auth.uid, default grants), CMMS permissions, stores/products/stock and the dropship + guest
-- checkout entry points for the REAL migration 20261113100000_site_delivery.sql to run. The dropship/guest functions here are
-- thin stand-ins that do what matters to this feature: they REFUSE a product the business has no active listing for (exactly what
-- the real dropship_checkout does) and record what listing they saw. guest_checkout_fulfil is the REAL one (run.sh cuts it out of
-- backend/ADD_GUEST_CHECKOUT_MOBILE_MONEY.sql).
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

-- ── test helpers ─────────────────────────────────────────────────────────────
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO PUBLIC;
CREATE FUNCTION t.u(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-' || lpad(n::TEXT, 12, '0'))::UUID $$;
CREATE FUNCTION t.login(n INT) RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', t.u(n)::TEXT, false);
  EXECUTE 'RESET ROLE'; EXECUTE 'SET ROLE authenticated'; END $$;
CREATE FUNCTION t.as_anon() RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', false);
  EXECUTE 'RESET ROLE'; EXECUTE 'SET ROLE anon'; END $$;
CREATE FUNCTION t.as_admin() RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'RESET ROLE'; END $$;
CREATE FUNCTION t.check(p_name TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT '') RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  IF p_ok IS TRUE THEN RAISE INFO 'PASS %', p_name; ELSE RAISE EXCEPTION 'FAIL % %', p_name, p_detail; END IF; END $$;
CREATE FUNCTION t.raises(p_sql TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$ BEGIN EXECUTE p_sql; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
-- the message an statement raises ('' when it does not)
CREATE FUNCTION t.error_of(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$ BEGIN EXECUTE p_sql; RETURN ''; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
CREATE TABLE t.keep (k TEXT PRIMARY KEY, v TEXT);
GRANT ALL ON t.keep TO PUBLIC;
-- what the stand-in dropship_checkout saw: the listing it was about to sell from
CREATE TABLE t.calls (id SERIAL PRIMARY KEY, product_id UUID, reseller UUID, listed_price NUMERIC, site_managed BOOLEAN, uid UUID);
GRANT ALL ON t.calls TO PUBLIC;
GRANT USAGE ON SEQUENCE t.calls_id_seq TO PUBLIC;
CREATE TABLE t.perm (company UUID, uid UUID);   -- who has edit rights on the website tool
GRANT ALL ON t.perm TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;

-- ── business, stores, products, stock ────────────────────────────────────────
CREATE TABLE public.business_profiles (id UUID PRIMARY KEY, user_id UUID, business_name TEXT, supermarket_id UUID);
CREATE TABLE public.business_member_roles (business_profile_id UUID, auth_user_id UUID, status TEXT DEFAULT 'active');
CREATE TABLE public.supermarkets (
  id UUID PRIMARY KEY, name TEXT, location TEXT, address TEXT, latitude NUMERIC, longitude NUMERIC,
  owner_user_id UUID, pichin_business_profile_id UUID, is_active BOOLEAN DEFAULT TRUE, price_currency TEXT,
  created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.products (
  id UUID PRIMARY KEY, supermarket_id UUID, name TEXT, sku TEXT, brand TEXT, images JSONB, image_url TEXT,
  selling_price NUMERIC, tax_rate NUMERIC, is_active BOOLEAN DEFAULT TRUE, is_dropship_excluded BOOLEAN NOT NULL DEFAULT FALSE,
  is_service BOOLEAN DEFAULT FALSE);
CREATE TABLE public.inventory (product_id UUID, supermarket_id UUID, current_stock NUMERIC, reserved_stock NUMERIC DEFAULT 0);
CREATE TABLE public.cmms_company_profiles (id UUID PRIMARY KEY, company_name TEXT, business_profile_id UUID);

-- the real dropship_listings columns that matter (ADD_DROPSHIP_SMART_TRANSPORT.sql adds the delivery ones)
CREATE TABLE public.dropship_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  supermarket_id UUID NOT NULL,
  listed_price NUMERIC NOT NULL CHECK (listed_price >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  free_delivery BOOLEAN NOT NULL DEFAULT FALSE,
  max_delivery_subsidy NUMERIC NOT NULL DEFAULT 0 CHECK (max_delivery_subsidy >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reseller_business_profile_id, product_id)
);

-- ── permissions (the real ones live in the CMMS and unified-business SQL) ─────
CREATE FUNCTION public.cmms_has_tool_action(p_company_id UUID, p_tool_id TEXT, p_action TEXT DEFAULT 'view')
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM t.perm WHERE company = p_company_id AND uid = auth.uid() AND p_tool_id = 'announcements') $$;
CREATE FUNCTION public.unified_business_member(p_business_profile_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.business_profiles bp WHERE bp.id = p_business_profile_id AND bp.user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.business_member_roles r WHERE r.business_profile_id = p_business_profile_id AND r.auth_user_id = auth.uid() AND r.status = 'active') $$;

-- ── dropship: riders, checkout (refuses a product without an active listing, like the real one), PIN wrapper ──
CREATE FUNCTION public.dropship_ranked_riders(
  p_store_business_profile_id UUID, p_pickup_lat NUMERIC, p_pickup_lng NUMERIC, p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC,
  p_vehicle_types TEXT[] DEFAULT NULL, p_limit INT DEFAULT 8
) RETURNS TABLE (rider_id UUID, full_name TEXT, rating NUMERIC, vehicle_type TEXT, distance_to_pickup_km NUMERIC,
                 estimated_arrival_min INTEGER, fare NUMERIC, is_store_rider BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT t.u(900), 'Store rider'::TEXT, 4.8::NUMERIC, 'motorcycle'::TEXT, 1.2::NUMERIC, 6, 3000::NUMERIC, TRUE
  UNION ALL SELECT t.u(901), 'Other rider'::TEXT, 4.5::NUMERIC, 'motorcycle'::TEXT, 2.5::NUMERIC, 11, 3500::NUMERIC, FALSE $$;
REVOKE ALL ON FUNCTION public.dropship_ranked_riders(UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT[], INT) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.dropship_checkout(
  p_reseller_business_profile_id UUID, p_cart JSONB, p_customer_name TEXT DEFAULT NULL, p_customer_phone TEXT DEFAULT NULL,
  p_delivery_address TEXT DEFAULT NULL, p_store_location TEXT DEFAULT NULL, p_delivery_lat NUMERIC DEFAULT NULL,
  p_delivery_lng NUMERIC DEFAULT NULL, p_max_delivery_hours NUMERIC DEFAULT NULL, p_rider_id UUID DEFAULT NULL,
  p_vehicle_types TEXT[] DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_item JSONB; v_l public.dropship_listings%ROWTYPE; v_total NUMERIC := 0;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart) LOOP
    SELECT * INTO v_l FROM public.dropship_listings
     WHERE reseller_business_profile_id = p_reseller_business_profile_id AND product_id = (v_item ->> 'product_id')::UUID AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product % is not available from this reseller', v_item ->> 'product_id'; END IF;
    INSERT INTO t.calls (product_id, reseller, listed_price, site_managed, uid)
    VALUES (v_l.product_id, v_l.reseller_business_profile_id, v_l.listed_price, v_l.site_managed, auth.uid());
    v_total := v_total + v_l.listed_price * (v_item ->> 'quantity')::NUMERIC;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'customer_paid_total', v_total, 'delivery_fee', 3000);
END $$;
REVOKE EXECUTE ON FUNCTION public.dropship_checkout(UUID, JSONB, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, UUID, TEXT[]) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.dropship_checkout_with_pin(
  p_pin_hash TEXT, p_reseller_business_profile_id UUID, p_cart JSONB, p_customer_name TEXT DEFAULT NULL, p_customer_phone TEXT DEFAULT NULL,
  p_delivery_address TEXT DEFAULT NULL, p_store_location TEXT DEFAULT NULL, p_delivery_lat NUMERIC DEFAULT NULL, p_delivery_lng NUMERIC DEFAULT NULL,
  p_max_delivery_hours NUMERIC DEFAULT NULL, p_rider_id UUID DEFAULT NULL, p_vehicle_types TEXT[] DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Sign in to pay with your IcanEra wallet'); END IF;
  IF p_pin_hash IS DISTINCT FROM 'good-pin' THEN RETURN jsonb_build_object('success', false, 'error', 'Wrong PIN'); END IF;
  RETURN public.dropship_checkout(p_reseller_business_profile_id, p_cart, p_customer_name, p_customer_phone, p_delivery_address,
    p_store_location, p_delivery_lat, p_delivery_lng, p_max_delivery_hours, p_rider_id, p_vehicle_types);
END $$;
REVOKE ALL ON FUNCTION public.dropship_checkout_with_pin(TEXT, UUID, JSONB, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, UUID, TEXT[]) FROM PUBLIC, anon;

-- the coin top-up guest_checkout_fulfil makes for its payer account
CREATE FUNCTION public.buy_ican_coins(p_user UUID, p_ican NUMERIC, p_app TEXT, p_ref TEXT)
RETURNS JSONB LANGUAGE sql AS $$ SELECT jsonb_build_object('success', true) $$;
