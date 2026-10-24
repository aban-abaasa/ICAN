-- Test stub. Not a migration: never run this against a real database.
-- Just enough Supabase (roles, auth.uid(), default grants), the PitchIn / store / CMMS tables the migration reads, the developer
-- allowlist functions, and a stand-in for the platform-fee credit (fn_credit_platform_fee_to_business), which the real money path calls.
\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID $$;
CREATE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE sql STABLE AS
  $$ SELECT jsonb_build_object('email', current_setting('request.jwt.claim.email', true)) $$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- the businesses, pitches and stores
CREATE TABLE public.business_profiles (id UUID PRIMARY KEY, user_id UUID NOT NULL, business_name TEXT, supermarket_id UUID);
CREATE TABLE public.pitches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id),
  title TEXT, visibility TEXT DEFAULT 'public', status TEXT DEFAULT 'published', video_duration_seconds INTEGER);
CREATE TABLE public.ican_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, media_type TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'public',
  view_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE public.ican_status_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), status_id UUID NOT NULL REFERENCES public.ican_statuses(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL, message_text TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.supermarkets (id UUID PRIMARY KEY, name TEXT, is_active BOOLEAN DEFAULT TRUE, pichin_business_profile_id UUID, price_currency TEXT);
CREATE TABLE public.products (
  id UUID PRIMARY KEY, supermarket_id UUID, name TEXT, selling_price NUMERIC, price NUMERIC, images JSONB, image_url TEXT,
  is_active BOOLEAN DEFAULT TRUE, is_service BOOLEAN DEFAULT FALSE);
CREATE TABLE public.inventory (product_id UUID, supermarket_id UUID, current_stock NUMERIC, reserved_stock NUMERIC DEFAULT 0);

-- the business wallet (same columns the corporate billing uses)
CREATE TABLE public.ican_business_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_profile_id UUID NOT NULL UNIQUE, ican_balance NUMERIC(18,8) NOT NULL DEFAULT 0,
  total_spent NUMERIC(18,8) NOT NULL DEFAULT 0, created_by UUID, updated_at TIMESTAMPTZ DEFAULT now());

-- who may call dev functions: a secret plus an allowlisted operator (the test flips these)
CREATE FUNCTION public.ican_dev_secret() RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT 'dev-secret'::TEXT $$;
CREATE FUNCTION public.ican_is_dev_operator() RETURNS BOOLEAN LANGUAGE sql STABLE AS
  $$ SELECT COALESCE(current_setting('request.jwt.claim.email', true), '') = 'dev@example.com' $$;

-- CMMS: a company linked to a business, and who may edit its announcements
CREATE TABLE public.cmms_company_profiles (id UUID PRIMARY KEY, business_profile_id UUID, pichin_business_profile_id UUID);
CREATE TABLE public.cmms_grants (company_id UUID, user_id UUID, tool TEXT, action TEXT);
CREATE FUNCTION public.cmms_has_tool_action(p_company UUID, p_tool TEXT, p_action TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS
  $$ SELECT EXISTS (SELECT 1 FROM public.cmms_grants g WHERE g.company_id = p_company AND g.user_id = auth.uid() AND g.tool = p_tool AND g.action = p_action) $$;

-- the platform side of a payment: records the credit, or fails when the test says so
CREATE TABLE public.platform_credits (reference TEXT, amount NUMERIC, fee_type TEXT, actor UUID);
CREATE FUNCTION public.fn_credit_platform_fee_to_business(
  p_amount_ican NUMERIC, p_source_app TEXT, p_source_reference TEXT, p_fee_type TEXT, p_actor_user_id UUID,
  p_note TEXT DEFAULT '', p_metadata JSONB DEFAULT '{}'::JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF current_setting('test.fail_credit', true) = 'on' THEN RETURN jsonb_build_object('success', false, 'credited', false, 'error', 'Platform fee recipient business not configured'); END IF;
  INSERT INTO public.platform_credits VALUES (p_source_reference, p_amount_ican, p_fee_type, p_actor_user_id);
  RETURN jsonb_build_object('success', true, 'credited', true);
END $$;

-- the business website lookup (company id for a business)
CREATE FUNCTION public.get_store_public_website(p_supermarket_id UUID DEFAULT NULL, p_business_profile_id UUID DEFAULT NULL) RETURNS UUID
LANGUAGE sql STABLE AS $$ SELECT id FROM public.cmms_company_profiles WHERE business_profile_id = p_business_profile_id LIMIT 1 $$;
