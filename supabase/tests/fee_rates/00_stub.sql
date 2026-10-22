-- Test stub. Not a migration: never run this against a real database.
-- Just enough Supabase (roles, auth.users, default grants) and wallet tables for the real mobile-money SQL.
\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT UNIQUE);
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID $$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
-- Supabase's default: every new public table and FUNCTION is granted straight to the API roles. This is exactly why the
-- repo's "REVOKE ... FROM PUBLIC; GRANT ... TO service_role" does not make a function server-only.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE FUNCTION public._ican_set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TABLE public.mbg_users (id UUID PRIMARY KEY, role_type TEXT, is_active BOOLEAN);
CREATE TABLE public.wallet_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, currency TEXT NOT NULL,
  balance NUMERIC(15, 2) NOT NULL DEFAULT 0, UNIQUE (user_id, currency));
