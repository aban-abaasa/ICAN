-- Test stub for the installment engine. Not a migration: never run this against a real database.
--
-- Recreates just enough of Supabase (roles, auth.users, auth.uid()) plus the existing ICAN tables and functions
-- the migration builds on, with the column names and constraints the live database has. dropship_checkout and
-- icanera_confirm_pickup are small stand-ins that keep the same contract the engine relies on (they need a signed-in
-- caller, check stock net of reservations, debit the caller's wallet, book the fare, hold the legs for the seal scan);
-- the engine's own money handling is what is under test.
\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT UNIQUE);
-- Same lookup order as Supabase's auth.uid().
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.sub', true), ''),
                  (NULLIF(current_setting('request.jwt.claims', true), '')::JSONB ->> 'sub'))::UUID $$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE public.users (id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, full_name TEXT, phone TEXT);

CREATE TABLE public.business_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name TEXT
);
CREATE TABLE public.business_account_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  auth_user_id UUID NOT NULL, employment_status TEXT NOT NULL DEFAULT 'active'
);
CREATE FUNCTION public.unified_business_member(p_business_profile_id UUID) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.business_profiles bp WHERE bp.id = p_business_profile_id AND bp.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.business_account_members m WHERE m.business_profile_id = p_business_profile_id
                AND m.auth_user_id = auth.uid() AND m.employment_status = 'active')) $$;

CREATE TABLE public.supermarkets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID, name TEXT, location TEXT, address TEXT, latitude NUMERIC, longitude NUMERIC,
  pichin_business_profile_id UUID
);
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supermarket_id UUID NOT NULL, name TEXT NOT NULL, sku TEXT, barcode TEXT,
  selling_price NUMERIC NOT NULL, tax_rate NUMERIC, is_active BOOLEAN DEFAULT TRUE, is_dropship_excluded BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE public.inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supermarket_id UUID NOT NULL, product_id UUID NOT NULL,
  current_stock NUMERIC, reserved_stock NUMERIC, updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (supermarket_id, product_id)
);
CREATE TABLE public.dropship_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id),
  product_id UUID NOT NULL, supermarket_id UUID NOT NULL,
  listed_price NUMERIC NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE,
  free_delivery BOOLEAN NOT NULL DEFAULT FALSE, max_delivery_subsidy NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reseller_business_profile_id, product_id)
);
CREATE TABLE public.dropship_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id TEXT NOT NULL, reseller_business_profile_id UUID NOT NULL, supermarket_id UUID NOT NULL,
  wholesale_amount NUMERIC NOT NULL, reseller_margin_amount NUMERIC NOT NULL, customer_paid_amount NUMERIC NOT NULL,
  customer_receipt_number TEXT NOT NULL, store_receipt_number TEXT NOT NULL,
  transport_provider TEXT NOT NULL DEFAULT 'bodagoera', transport_status TEXT NOT NULL DEFAULT 'not_requested',
  bodago_delivery_request_id UUID, pickup_address TEXT, delivery_address TEXT,
  status TEXT NOT NULL DEFAULT 'completed', created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivery_fee_amount NUMERIC NOT NULL DEFAULT 0, real_transport_fare NUMERIC, reseller_transport_subsidy NUMERIC NOT NULL DEFAULT 0
);
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supermarket_id UUID, cashier_id UUID, cashier_name TEXT, customer_name TEXT, customer_phone TEXT, items JSONB,
  items_count INTEGER, subtotal NUMERIC, tax_amount NUMERIC, tax_rate NUMERIC, total_amount NUMERIC, payment_method TEXT,
  receipt_number TEXT, transaction_id TEXT, status TEXT, created_at TIMESTAMPTZ, customer_user_id UUID,
  register_number VARCHAR, store_location VARCHAR,
  payment_status TEXT NOT NULL DEFAULT 'paid', balance_due_ugx NUMERIC NOT NULL DEFAULT 0
);
CREATE TABLE public.sales_transaction_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID, product_id UUID, product_name TEXT, product_sku TEXT, product_barcode TEXT,
  unit_price NUMERIC, quantity NUMERIC, line_total NUMERIC, tax_included BOOLEAN, tax_amount NUMERIC
);
CREATE TABLE public.receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number TEXT, transaction_id TEXT, cashier_id UUID, cashier_name TEXT, customer_name TEXT,
  subtotal NUMERIC, tax_amount NUMERIC, total_amount NUMERIC, amount_paid NUMERIC, payment_method TEXT,
  items_json JSONB, status TEXT, register_id TEXT, store_location TEXT, created_at TIMESTAMPTZ
);

-- Wallets and ledger (columns and CHECKs as in the live database).
CREATE TABLE public.ican_user_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL UNIQUE,
  ican_balance NUMERIC CHECK (ican_balance >= 0), total_spent NUMERIC DEFAULT 0, total_earned NUMERIC DEFAULT 0
);
CREATE TABLE public.ican_business_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_profile_id UUID NOT NULL UNIQUE,
  ican_balance NUMERIC NOT NULL DEFAULT 0 CHECK (ican_balance >= 0)
);
CREATE TABLE public.ican_coin_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID, type TEXT, ican_amount NUMERIC NOT NULL, local_amount NUMERIC,
  status TEXT DEFAULT 'pending', sender_user_id UUID, recipient_user_id UUID,
  transaction_type TEXT NOT NULL DEFAULT 'earn' CHECK (transaction_type IN ('earn','transfer_in','transfer_out','tithe','cashback','purchase','sale','refund','buy','sell','journey_payment')),
  source_app TEXT NOT NULL DEFAULT 'ican' CHECK (source_app IN ('ican','digital-city-era','farm-agent','mybodaguy')),
  reference_id TEXT, note TEXT, local_currency VARCHAR DEFAULT 'UGX', merchant_name TEXT,
  counterparty_type TEXT DEFAULT 'person' CHECK (counterparty_type IN ('person','business','unknown')),
  expense_classification TEXT DEFAULT 'person_transfer' CHECK (expense_classification IN ('person_transfer','personal_expense','business_expense','income','refund','cash_out','other')),
  business_profile_id UUID, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX ican_coin_tx_ref_uniq ON public.ican_coin_transactions(reference_id) WHERE reference_id IS NOT NULL;

CREATE FUNCTION public.get_or_create_ican_wallet(p_user_id UUID) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v UUID;
BEGIN
  INSERT INTO public.ican_user_wallets (user_id, ican_balance) VALUES (p_user_id, 0) ON CONFLICT (user_id) DO NOTHING;
  SELECT id INTO v FROM public.ican_user_wallets WHERE user_id = p_user_id; RETURN v;
END $$;

CREATE TABLE public.burned (n SERIAL PRIMARY KEY, ican NUMERIC NOT NULL);
CREATE TABLE public.minted (n SERIAL PRIMARY KEY, ican NUMERIC NOT NULL, payment_ref TEXT);
CREATE FUNCTION public.buy_ican_coins(p_user_id UUID, p_ican_amount NUMERIC, p_source_app TEXT, p_payment_ref TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM public.get_or_create_ican_wallet(p_user_id);
  UPDATE public.ican_user_wallets SET ican_balance = ican_balance + p_ican_amount, total_earned = total_earned + p_ican_amount WHERE user_id = p_user_id;
  INSERT INTO public.ican_coin_transactions (recipient_user_id, ican_amount, transaction_type, source_app, reference_id)
    VALUES (p_user_id, p_ican_amount, 'buy', p_source_app, p_payment_ref);
  INSERT INTO public.minted (ican, payment_ref) VALUES (p_ican_amount, p_payment_ref);
  RETURN jsonb_build_object('success', true);
END $$;
REVOKE ALL ON FUNCTION public.buy_ican_coins(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.ican_settle_business_wallet_income(p_business_profile_id UUID, p_amount_ican NUMERIC, p_source_app TEXT, p_source_reference TEXT, p_settlement_type TEXT, p_note TEXT, p_metadata JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.ican_business_wallets (business_profile_id, ican_balance) VALUES (p_business_profile_id, p_amount_ican)
  ON CONFLICT (business_profile_id) DO UPDATE SET ican_balance = public.ican_business_wallets.ican_balance + p_amount_ican;
END $$;
REVOKE ALL ON FUNCTION public.ican_settle_business_wallet_income(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

CREATE TABLE public.guest_checkout_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, note TEXT);
INSERT INTO public.guest_checkout_config VALUES ('gateway_fee_pct', '3.5', NULL);

CREATE FUNCTION public.mbg_get_setting_numeric(p_key TEXT, p_default NUMERIC) RETURNS NUMERIC LANGUAGE sql STABLE AS $$ SELECT p_default $$;

-- Riders: the fare and availability are controlled by the tests.
CREATE TABLE public.t_riders (rider_id UUID PRIMARY KEY, full_name TEXT, fare NUMERIC, available BOOLEAN DEFAULT TRUE);
CREATE FUNCTION public.dropship_ranked_riders(p_store_business_profile_id UUID, p_pickup_lat NUMERIC, p_pickup_lng NUMERIC, p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC, p_vehicle_types TEXT[] DEFAULT NULL, p_limit INT DEFAULT 8)
RETURNS TABLE (rider_id UUID, full_name TEXT, rating NUMERIC, vehicle_type TEXT, estimated_arrival_min INT, fare NUMERIC)
LANGUAGE sql STABLE AS $$
  SELECT r.rider_id, r.full_name, 4.5::NUMERIC, 'motorcycle'::TEXT, 12, r.fare FROM public.t_riders r WHERE r.available ORDER BY r.fare LIMIT p_limit $$;

-- Delivery receipts (same shape and status CHECK as live) and the seal scan.
CREATE TABLE public.icanera_delivery_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), verification_code TEXT UNIQUE NOT NULL,
  source_app TEXT NOT NULL CHECK (source_app IN ('mybodaguy','digital-city-era')),
  reference_type TEXT NOT NULL CHECK (reference_type IN ('mbg_ride','dropship_order')),
  reference_id UUID NOT NULL, customer_user_id UUID NOT NULL, store_owner_user_id UUID NOT NULL, rider_user_id UUID,
  store_name TEXT NOT NULL, item_summary TEXT, amount_ican NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','picked_up','delivered','cancelled','refunded')),
  settlement_legs JSONB, settled BOOLEAN NOT NULL DEFAULT false, max_delivery_hours NUMERIC, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE FUNCTION public.icanera_create_delivery_receipt(p_source_app TEXT, p_reference_type TEXT, p_reference_id UUID, p_customer_user_id UUID, p_store_owner_user_id UUID, p_rider_user_id UUID, p_store_name TEXT, p_item_summary TEXT, p_amount_ican NUMERIC, p_goods_snapshot JSONB DEFAULT NULL, p_settlement_legs JSONB DEFAULT NULL, p_max_delivery_hours NUMERIC DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_code TEXT := upper(substr(md5(gen_random_uuid()::text), 1, 10));
BEGIN
  INSERT INTO public.icanera_delivery_receipts (verification_code, source_app, reference_type, reference_id, customer_user_id, store_owner_user_id, rider_user_id, store_name, item_summary, amount_ican, settlement_legs, max_delivery_hours)
  VALUES (v_code, p_source_app, p_reference_type, p_reference_id, p_customer_user_id, p_store_owner_user_id, p_rider_user_id, p_store_name, p_item_summary, p_amount_ican, COALESCE(p_settlement_legs, '[]'::JSONB), p_max_delivery_hours);
  RETURN jsonb_build_object('success', true, 'verification_code', v_code, 'verify_url', 'https://bodagoera.icanera.space/verify/' || v_code);
END $$;
CREATE FUNCTION public.icanera_confirm_pickup(p_verification_code TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE r public.icanera_delivery_receipts%ROWTYPE; v_leg JSONB;
BEGIN
  SELECT * INTO r FROM public.icanera_delivery_receipts WHERE verification_code = upper(p_verification_code) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Receipt not found.'); END IF;
  IF auth.uid() IS DISTINCT FROM r.store_owner_user_id THEN RETURN jsonb_build_object('success', false, 'error', 'Only an active member of the issuing store can verify pickup.'); END IF;
  IF r.status <> 'paid' THEN RETURN jsonb_build_object('success', false, 'error', 'Already approved'); END IF;
  FOR v_leg IN SELECT * FROM jsonb_array_elements(r.settlement_legs) LOOP
    IF v_leg ->> 'payee_type' = 'business' THEN
      PERFORM public.ican_settle_business_wallet_income((v_leg ->> 'payee_id')::UUID, (v_leg ->> 'ican_amount')::NUMERIC, 'digital-city-era', 'x', 'pos_sale', '', '{}');
    END IF;
  END LOOP;
  UPDATE public.icanera_delivery_receipts SET status = 'picked_up', settled = true WHERE id = r.id;
  RETURN jsonb_build_object('success', true, 'status', 'picked_up');
END $$;

-- Stand-in for the live dropship_checkout: same contract, simpler books. Rider id NULL = auto-pick the cheapest.
CREATE FUNCTION public.dropship_checkout(p_reseller_business_profile_id UUID, p_cart JSONB, p_customer_name TEXT DEFAULT NULL, p_customer_phone TEXT DEFAULT NULL, p_delivery_address TEXT DEFAULT NULL, p_store_location TEXT DEFAULT NULL, p_delivery_lat NUMERIC DEFAULT NULL, p_delivery_lng NUMERIC DEFAULT NULL, p_max_delivery_hours NUMERIC DEFAULT NULL, p_rider_id UUID DEFAULT NULL, p_vehicle_types TEXT[] DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid UUID := auth.uid(); v_item JSONB; v_l RECORD; v_total NUMERIC := 0; v_sm UUID; v_fare NUMERIC; v_ican NUMERIC; v_bal NUMERIC;
  v_order UUID; v_store RECORD; v_receipt JSONB; v_rider UUID; v_free BOOLEAN := TRUE; v_margin NUMERIC := 0; v_sub NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Sign in with your ICANera wallet to check out'); END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart) LOOP
    SELECT dl.listed_price, dl.free_delivery, dl.max_delivery_subsidy, p.selling_price, p.tax_rate, p.supermarket_id INTO v_l
      FROM public.dropship_listings dl JOIN public.products p ON p.id = dl.product_id
     WHERE dl.reseller_business_profile_id = p_reseller_business_profile_id AND dl.product_id = (v_item ->> 'product_id')::UUID AND dl.is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product % is not available from this reseller', v_item ->> 'product_id'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.inventory i WHERE i.product_id = (v_item ->> 'product_id')::UUID AND i.supermarket_id = v_l.supermarket_id
                    AND GREATEST(i.current_stock - COALESCE(i.reserved_stock, 0), 0) >= (v_item ->> 'quantity')::NUMERIC FOR UPDATE) THEN
      RAISE EXCEPTION 'Insufficient stock for product %', v_item ->> 'product_id';
    END IF;
    UPDATE public.inventory SET current_stock = current_stock - (v_item ->> 'quantity')::NUMERIC WHERE product_id = (v_item ->> 'product_id')::UUID AND supermarket_id = v_l.supermarket_id;
    v_sm := v_l.supermarket_id;
    v_total := v_total + ROUND(v_l.listed_price * (v_item ->> 'quantity')::NUMERIC * (1 + v_l.tax_rate / 100), 2);
    v_margin := v_margin + ROUND((v_l.listed_price - v_l.selling_price) * (v_item ->> 'quantity')::NUMERIC, 2);
    IF NOT v_l.free_delivery THEN v_free := FALSE; END IF;
  END LOOP;
  IF p_rider_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.t_riders WHERE rider_id = p_rider_id AND available) THEN RAISE EXCEPTION 'Your chosen rider is no longer available — pick another'; END IF;
    v_rider := p_rider_id;
  ELSE
    SELECT rider_id INTO v_rider FROM public.t_riders WHERE available ORDER BY fare LIMIT 1;
  END IF;
  IF v_rider IS NULL THEN RAISE EXCEPTION 'No delivery riders are available right now — try again shortly'; END IF;
  SELECT fare INTO v_fare FROM public.t_riders WHERE rider_id = v_rider;
  v_sub := CASE WHEN v_free THEN LEAST(v_fare, v_margin) ELSE 0 END;
  v_total := v_total + (v_fare - v_sub);
  v_ican := ROUND(v_total / 5000, 8);
  SELECT ican_balance INTO v_bal FROM public.ican_user_wallets WHERE user_id = v_uid FOR UPDATE;
  IF v_bal IS NULL OR v_bal < v_ican THEN RAISE EXCEPTION 'Insufficient ICAN balance for this purchase'; END IF;
  UPDATE public.ican_user_wallets SET ican_balance = ican_balance - v_ican, total_spent = total_spent + v_ican WHERE user_id = v_uid;
  INSERT INTO public.burned (ican) VALUES (v_ican);  -- the stand-in pays no one: counted so supply stays checkable
  SELECT owner_user_id, name INTO v_store FROM public.supermarkets WHERE id = v_sm;
  INSERT INTO public.dropship_orders (transaction_id, reseller_business_profile_id, supermarket_id, wholesale_amount, reseller_margin_amount, customer_paid_amount, customer_receipt_number, store_receipt_number, delivery_fee_amount, status)
    VALUES ('DS', p_reseller_business_profile_id, v_sm, 0, v_margin, v_total, 'RCP-1', 'RCP-2', v_fare - v_sub, 'pending_dispatch') RETURNING id INTO v_order;
  v_receipt := public.icanera_create_delivery_receipt('digital-city-era', 'dropship_order', v_order, v_uid, v_store.owner_user_id, gen_random_uuid(), v_store.name, 'x', v_ican, NULL, '[]', p_max_delivery_hours);
  RETURN jsonb_build_object('success', true, 'dropship_order_id', v_order, 'customer_paid_total', v_total, 'delivery_fee', v_fare - v_sub,
    'customer_receipt_number', 'RCP-1', 'verification_code', v_receipt ->> 'verification_code', 'verify_url', v_receipt ->> 'verify_url');
END $$;

-- Test plumbing ------------------------------------------------------------------------------------------------
CREATE SCHEMA t;
CREATE TABLE t.results (n SERIAL PRIMARY KEY, name TEXT NOT NULL, ok BOOLEAN NOT NULL, info TEXT);
GRANT ALL ON SCHEMA t TO PUBLIC; GRANT ALL ON t.results TO PUBLIC; GRANT ALL ON SEQUENCE t.results_n_seq TO PUBLIC;
CREATE FUNCTION t.check(p_name TEXT, p_ok BOOLEAN, p_info TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN INSERT INTO t.results (name, ok, info) VALUES (p_name, COALESCE(p_ok, false), p_info); END; $$;
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
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;
