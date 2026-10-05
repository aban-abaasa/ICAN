-- Test stub. Not a migration: never run this against a real database.
-- Just enough Supabase (roles, auth.users, auth.uid(), default grants) and business tables for the card SQL.
\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE TABLE auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT UNIQUE,
  raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::JSONB);
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID $$;

GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role;
-- Supabase's default: new public objects are open to the API roles; RLS and REVOKEs must close what needs closing.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE public.business_profiles (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES auth.users(id),
  business_name TEXT NOT NULL);
CREATE TABLE public.business_co_owners (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id),
  user_id UUID, status TEXT NOT NULL DEFAULT 'active');
-- staff: may operate the business but are not shareholders
CREATE TABLE public.business_account_members (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id),
  auth_user_id UUID NOT NULL);
CREATE TABLE public.ican_business_wallet_settings (business_profile_id UUID PRIMARY KEY REFERENCES public.business_profiles(id),
  pin_hash TEXT, pin_failed_attempts INT NOT NULL DEFAULT 0, pin_locked_until TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT now());

-- Simplified twins of the real helpers (same names, same meaning): shareholders = owner + active co-owners;
-- operation access = shareholders + staff.
CREATE FUNCTION public.pitchin_business_shareholder_access(p_business_profile_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.business_profiles bp WHERE bp.id = p_business_profile_id AND bp.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.business_co_owners co WHERE co.business_profile_id = p_business_profile_id AND co.user_id = auth.uid() AND co.status = 'active')) $$;
CREATE FUNCTION public.ican_business_operation_access(p_business_profile_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.pitchin_business_shareholder_access(p_business_profile_id)
      OR EXISTS (SELECT 1 FROM public.business_account_members m WHERE m.business_profile_id = p_business_profile_id AND m.auth_user_id = auth.uid()) $$;
