-- Test stub for the sector-trading migrations. Not a migration: never run it against a real database.
--
-- run.sh applies ../icaneracoin_chart/00_stub.sql first (roles, auth.uid(), the wallets, the FX table and the
-- t.* test helpers) and the repo's own price engine and icaneracoin migrations on top of it. This file adds just
-- the business-side tables the sector code touches, with the live column names:
--   business_profiles / business_co_owners  (who runs a business, and its category in metadata->>'category_key')
--   ican_business_wallet_settlements        (UNIFIED_BUSINESS_WALLET_OPERATIONS.sql: one row per settled income)
--   fn_business_is_church                   (20261014100000_church_tithe_giving.sql, verbatim)
\set ON_ERROR_STOP on

CREATE TABLE public.business_profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,
  business_name VARCHAR(255) NOT NULL,
  business_type VARCHAR(100) NOT NULL,
  status        VARCHAR(50) DEFAULT 'active',
  metadata      JSONB DEFAULT '{}'
);
ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.business_co_owners (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  user_id             UUID,
  owner_email         TEXT,
  role                TEXT,
  ownership_share     NUMERIC DEFAULT 0,
  status              TEXT DEFAULT 'active'
);
ALTER TABLE public.business_co_owners ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.fn_business_is_church(p_type TEXT, p_name TEXT, p_metadata JSONB)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
AS $$
  SELECT COALESCE((p_metadata ->> 'accepts_tithe')::BOOLEAN, FALSE)
      OR COALESCE(p_type, '') ~* '(church|ministr|parish|cathedral|chapel|fellowship|assembl|congregation|temple|mosque|synagogue|faith|worship|gospel|pentecost|revival)'
      OR COALESCE(p_name, '') ~* '(church|ministr|parish|cathedral|chapel|fellowship|assembly|congregation|temple|mosque|synagogue|pentecost|revival)';
$$;

CREATE TABLE public.ican_business_wallet_settlements (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  source_app          TEXT NOT NULL,
  source_reference    TEXT NOT NULL,
  amount_ican         NUMERIC(18,8) NOT NULL CHECK (amount_ican > 0),
  settlement_type     TEXT NOT NULL CHECK (settlement_type IN ('pos_sale', 'investment', 'refund', 'other_income')),
  note                TEXT NOT NULL DEFAULT '',
  metadata            JSONB NOT NULL DEFAULT '{}'::JSONB,
  settled_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_by          UUID,
  UNIQUE (source_app, source_reference)
);
-- (No RLS here: in production the only writer is the SECURITY DEFINER ican_settle_business_wallet_income, which the
-- owner runs. The tests insert as an ordinary role on purpose, to prove the capture trigger works whoever writes.)
