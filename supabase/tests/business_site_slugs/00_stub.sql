-- Test stub. Not a migration: never run this against a real database.
-- Just enough Supabase (roles, auth.uid(), default grants) and the company profile table for the site-slug migration.
\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID $$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
-- Supabase's default: new public objects are open to the API roles; RLS and REVOKEs must close what needs closing.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- The columns of the real table that matter here (same names, same types).
CREATE TABLE public.cmms_company_profiles (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name               VARCHAR(255) NOT NULL,
  email                      VARCHAR(255) UNIQUE NOT NULL,
  is_active                  BOOLEAN DEFAULT TRUE,
  business_profile_id        UUID,
  pichin_business_profile_id UUID,
  created_at                 TIMESTAMPTZ DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ DEFAULT NOW()
);
-- Companies are readable only through the public RPCs, like the real project.
ALTER TABLE public.cmms_company_profiles ENABLE ROW LEVEL SECURITY;

-- The platform fee business is GODMINDERA's (see ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql).
CREATE FUNCTION public.fn_get_platform_fee_business_id() RETURNS UUID LANGUAGE sql IMMUTABLE AS
  $$ SELECT 'e9dd3c93-65b0-469e-91e9-3aa10ca7a03c'::UUID $$;
