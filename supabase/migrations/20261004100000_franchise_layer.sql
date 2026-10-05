-- ============================================================================
-- Franchise layer: Country Masters, Authorized Agencies and Referral Partners
-- sharing platform revenue across IcanEra, SupermarketEra and BodaGoEra.
-- ============================================================================
-- All three apps share one Postgres, and every platform fee already lands in
-- one HQ business wallet through fn_credit_platform_fee_to_business(), which
-- writes exactly one 'platform_fee' row to ican_business_wallet_settlements
-- (and one 'platform_fee_reversal' row if the fee is later reversed). This
-- layer hangs off that table with a trigger, so NO existing money function is
-- edited and every fee path (sell/payout/corporate billing, supermarket
-- orders, BodaGoEra rides) is covered at once.
--
--   HQ is paid exactly as today (100% into the platform-fee wallet). The
--   partners' shares are ACCRUED LIABILITIES in ican_franchise_payable_lines,
--   settled through HQ-approved statements. Nothing here moves wallet money.
--
-- Model
--   territory      a country (tier 1/2/3, open/reserved/active/paused). Every country the app supports at
--                  sign-up is open from day one; a territory row only configures it (tier, reserve, pause)
--   partner        country_master | agency | referral, licensed per product
--                  (icanera | supermarketera | bodagoera); agencies sit under a
--                  country master or directly under HQ
--   assignment     which partner serves which customer. Customers CLAIM an
--                  agency themselves (consent); the link survives the agency
--                  leaving: HQ reassigns, the customer is never orphaned
--   split rule     per stream x structure x agency tier: HQ / master / agency %
--   revenue event  immutable, append-only snapshot of one fee and how it was
--                  split (UPDATE only touches voided_at/void_reason, no DELETE)
--   payable line   one row per payee per event. A reversal after a line was
--                  already put on a statement writes a NEGATIVE line (clawback)
--   statement      draft -> approved -> paid (with a unique payment reference)
--
-- Safeguards built in
--   * wallet_fee (sell/payout/referral fees: the regulated asset side) is never
--     shared unless HQ flips share_wallet_fees on. A rule for it is ignored.
--   * A partner only earns on products it is licensed for, and only while
--     status = 'active' (and the territory is not 'paused').
--   * The allocation trigger can never fail or alter a fee credit: it swallows
--     its own errors into ican_franchise_allocation_errors for HQ to retry.
--   * HQ admin = signed-in developer (mbg_users.role_type = 'developer') or the
--     service role. No static dev token, and nothing here is granted to anon.
--   * Writes only through SECURITY DEFINER functions; tables are read-only to
--     the browser and every read is scoped by RLS to the caller's own partner
--     rows (a country master also sees its downline).
--
-- Additive only, safe to re-run. Rollback: supabase/rollback/20261004_rollback_franchise_layer.sql
-- Deploy notes: FRANCHISE_LAYER_DEPLOY.md
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1. TABLES
-- ============================================================================

-- 1a. Singleton program settings ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.ican_franchise_settings (
  id                    BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  enabled               BOOLEAN NOT NULL DEFAULT true,
  silver_min_accounts   INTEGER NOT NULL DEFAULT 0   CHECK (silver_min_accounts >= 0),
  gold_min_accounts     INTEGER NOT NULL DEFAULT 50  CHECK (gold_min_accounts >= 0),
  platinum_min_accounts INTEGER NOT NULL DEFAULT 200 CHECK (platinum_min_accounts >= 0),
  active_window_days    INTEGER NOT NULL DEFAULT 45  CHECK (active_window_days BETWEEN 1 AND 365),
  hq_share_floor_pct    NUMERIC(5,2) NOT NULL DEFAULT 37 CHECK (hq_share_floor_pct BETWEEN 0 AND 100),
  max_kicker_pts        NUMERIC(5,2) NOT NULL DEFAULT 3  CHECK (max_kicker_pts >= 0),
  max_penalty_pts       NUMERIC(5,2) NOT NULL DEFAULT 5  CHECK (max_penalty_pts >= 0),
  share_wallet_fees     BOOLEAN NOT NULL DEFAULT false,
  updated_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (silver_min_accounts <= gold_min_accounts AND gold_min_accounts <= platinum_min_accounts)
);
INSERT INTO public.ican_franchise_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- 1b. Territories --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ican_franchise_territories (
  country_code VARCHAR(2) PRIMARY KEY CHECK (country_code = upper(country_code)),
  country_name TEXT NOT NULL,
  tier         SMALLINT NOT NULL DEFAULT 2 CHECK (tier IN (1, 2, 3)),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reserved', 'active', 'paused')),
  currency     VARCHAR(10),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1c. Partners ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ican_franchise_partners (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_code             TEXT NOT NULL UNIQUE,
  partner_type             TEXT NOT NULL CHECK (partner_type IN ('country_master', 'agency', 'referral')),
  parent_partner_id        UUID REFERENCES public.ican_franchise_partners(id) ON DELETE SET NULL,
  country_code             VARCHAR(2) NOT NULL REFERENCES public.ican_franchise_territories(country_code),
  region                   TEXT,
  display_name             TEXT NOT NULL CHECK (length(btrim(display_name)) BETWEEN 2 AND 120),
  -- A partner must be a REGISTERED COMPANY. HQ checks the registry before the partner can go active.
  company_name             TEXT NOT NULL CHECK (length(btrim(company_name)) BETWEEN 2 AND 160),
  company_reg_number       TEXT NOT NULL CHECK (company_reg_number ~ '^[A-Za-z0-9][A-Za-z0-9 ./\-]{2,59}$'),
  company_reg_country      VARCHAR(2) NOT NULL CHECK (company_reg_country = upper(company_reg_country)),
  company_document_url     TEXT CHECK (company_document_url IS NULL OR (length(company_document_url) <= 500 AND company_document_url ~* '^https://')),
  company_status           TEXT NOT NULL DEFAULT 'pending' CHECK (company_status IN ('pending', 'verified', 'rejected')),
  company_verified_at      TIMESTAMPTZ,
  company_verified_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_user_id            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  business_profile_id      UUID REFERENCES public.business_profiles(id) ON DELETE SET NULL,
  products                 TEXT[] NOT NULL DEFAULT ARRAY['icanera']::TEXT[],
  tier                     TEXT NOT NULL DEFAULT 'silver' CHECK (tier IN ('silver', 'gold', 'platinum')),
  status                   TEXT NOT NULL DEFAULT 'applied'
                             CHECK (status IN ('applied', 'approved', 'active', 'suspended', 'terminated')),
  exclusive                BOOLEAN NOT NULL DEFAULT false,
  share_adjust_pts         NUMERIC(5,2) NOT NULL DEFAULT 0,
  upfront_fee_ican         NUMERIC(18,8) NOT NULL DEFAULT 0 CHECK (upfront_fee_ican >= 0),
  upfront_fee_paid_at      TIMESTAMPTZ,
  min_annual_royalty_ican  NUMERIC(18,8) NOT NULL DEFAULT 0 CHECK (min_annual_royalty_ican >= 0),
  contract_start           DATE,
  contract_end             DATE,
  referral_window_months   INTEGER NOT NULL DEFAULT 12 CHECK (referral_window_months BETWEEN 1 AND 60),
  kyc_status               TEXT NOT NULL DEFAULT 'pending' CHECK (kyc_status IN ('pending', 'verified', 'rejected')),
  notes                    TEXT,
  approved_by              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at              TIMESTAMPTZ,
  terminated_at            TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ican_franchise_products_valid
    CHECK (products <@ ARRAY['icanera', 'supermarketera', 'bodagoera']::TEXT[] AND cardinality(products) >= 1),
  CONSTRAINT ican_franchise_contract_dates CHECK (contract_end IS NULL OR contract_start IS NULL OR contract_end >= contract_start)
);
CREATE INDEX IF NOT EXISTS idx_ican_franchise_partners_country ON public.ican_franchise_partners (country_code, partner_type, status);
CREATE INDEX IF NOT EXISTS idx_ican_franchise_partners_parent  ON public.ican_franchise_partners (parent_partner_id);
CREATE INDEX IF NOT EXISTS idx_ican_franchise_partners_owner   ON public.ican_franchise_partners (owner_user_id);
-- One live partner seat per person per country per type (a terminated seat can be re-applied for).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ican_franchise_partner_seat
  ON public.ican_franchise_partners (owner_user_id, country_code, partner_type)
  WHERE owner_user_id IS NOT NULL AND status <> 'terminated';
-- One live seat per REGISTERED COMPANY per type per country: the same registration cannot sit
-- under two accounts (punctuation and case in the number are ignored).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ican_franchise_company_seat
  ON public.ican_franchise_partners (company_reg_country, upper(regexp_replace(company_reg_number, '[^A-Za-z0-9]', '', 'g')), partner_type, country_code)
  WHERE status <> 'terminated';

-- 1d. Split rules (the rate card, as data) ----------------------------------------
CREATE TABLE IF NOT EXISTS public.ican_franchise_split_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream      TEXT NOT NULL CHECK (stream IN ('subscription', 'marketplace_fee', 'ride_commission', 'wallet_fee')),
  structure   TEXT NOT NULL CHECK (structure IN ('with_master', 'master_direct', 'hq_direct', 'referral')),
  agency_tier TEXT NOT NULL DEFAULT 'any' CHECK (agency_tier IN ('silver', 'gold', 'platinum', 'any')),
  hq_pct      NUMERIC(6,3) NOT NULL CHECK (hq_pct BETWEEN 0 AND 100),
  master_pct  NUMERIC(6,3) NOT NULL CHECK (master_pct BETWEEN 0 AND 100),
  agency_pct  NUMERIC(6,3) NOT NULL CHECK (agency_pct BETWEEN 0 AND 100),
  active      BOOLEAN NOT NULL DEFAULT true,
  note        TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stream, structure, agency_tier),
  CONSTRAINT ican_franchise_split_sums_to_100 CHECK (hq_pct + master_pct + agency_pct = 100)
);

-- 1e. Customer assignments ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ican_franchise_customer_assignments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  user_id             UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  partner_id          UUID REFERENCES public.ican_franchise_partners(id) ON DELETE SET NULL,
  country_code        VARCHAR(2),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  source              TEXT NOT NULL DEFAULT 'claim_code' CHECK (source IN ('claim_code', 'hq_assigned', 'reassigned', 'import')),
  assigned_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at            TIMESTAMPTZ,
  end_reason          TEXT,
  CONSTRAINT ican_franchise_assignment_has_customer CHECK (business_profile_id IS NOT NULL OR user_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ican_franchise_assignment_business
  ON public.ican_franchise_customer_assignments (business_profile_id)
  WHERE status = 'active' AND business_profile_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ican_franchise_assignment_user
  ON public.ican_franchise_customer_assignments (user_id)
  WHERE status = 'active' AND business_profile_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_ican_franchise_assignment_partner
  ON public.ican_franchise_customer_assignments (partner_id) WHERE status = 'active';

-- 1f. Revenue events: immutable snapshot of one fee and its split --------------------
CREATE TABLE IF NOT EXISTS public.ican_franchise_revenue_events (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_app           TEXT NOT NULL,
  source_reference     TEXT NOT NULL,
  settlement_id        UUID,
  stream               TEXT NOT NULL,
  product              TEXT NOT NULL,
  fee_type             TEXT,
  country_code         VARCHAR(2),
  structure            TEXT NOT NULL,
  agency_tier          TEXT,
  gross_ican           NUMERIC(18,8) NOT NULL CHECK (gross_ican > 0),
  hq_pct               NUMERIC(6,3) NOT NULL,
  master_pct           NUMERIC(6,3) NOT NULL,
  agency_pct           NUMERIC(6,3) NOT NULL,
  hq_ican              NUMERIC(18,8) NOT NULL,
  master_ican          NUMERIC(18,8) NOT NULL,
  agency_ican          NUMERIC(18,8) NOT NULL,
  master_partner_id    UUID REFERENCES public.ican_franchise_partners(id) ON DELETE RESTRICT,
  agency_partner_id    UUID REFERENCES public.ican_franchise_partners(id) ON DELETE RESTRICT,
  customer_business_id UUID,
  customer_user_id     UUID,
  voided_at            TIMESTAMPTZ,
  void_reason          TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_app, source_reference),
  CONSTRAINT ican_franchise_event_sums CHECK (hq_ican + master_ican + agency_ican = gross_ican)
);
CREATE INDEX IF NOT EXISTS idx_ican_franchise_events_master  ON public.ican_franchise_revenue_events (master_partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ican_franchise_events_agency  ON public.ican_franchise_revenue_events (agency_partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ican_franchise_events_country ON public.ican_franchise_revenue_events (country_code, created_at DESC);

-- 1g. Statements (declared before lines, which point at them) ------------------------
CREATE TABLE IF NOT EXISTS public.ican_franchise_statements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id        UUID NOT NULL REFERENCES public.ican_franchise_partners(id) ON DELETE RESTRICT,
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,
  total_ican        NUMERIC(18,8) NOT NULL,
  line_count        INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid', 'void')),
  payment_reference TEXT,
  approved_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at       TIMESTAMPTZ,
  paid_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  paid_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);
-- The same external transfer can never be recorded against two statements.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ican_franchise_statement_payref
  ON public.ican_franchise_statements (payment_reference) WHERE payment_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ican_franchise_statements_partner ON public.ican_franchise_statements (partner_id, created_at DESC);

-- 1h. Payable lines: one per payee per event (negative = clawback) -------------------
CREATE TABLE IF NOT EXISTS public.ican_franchise_payable_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID NOT NULL REFERENCES public.ican_franchise_revenue_events(id) ON DELETE RESTRICT,
  partner_id       UUID NOT NULL REFERENCES public.ican_franchise_partners(id) ON DELETE RESTRICT,
  role             TEXT NOT NULL CHECK (role IN ('master', 'agency')),
  amount_ican      NUMERIC(18,8) NOT NULL CHECK (amount_ican <> 0),
  status           TEXT NOT NULL DEFAULT 'accrued' CHECK (status IN ('accrued', 'statemented', 'paid', 'void')),
  statement_id     UUID REFERENCES public.ican_franchise_statements(id) ON DELETE SET NULL,
  reverses_line_id UUID REFERENCES public.ican_franchise_payable_lines(id) ON DELETE RESTRICT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ican_franchise_line_reversal
  ON public.ican_franchise_payable_lines (reverses_line_id) WHERE reverses_line_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ican_franchise_line_event_partner_role
  ON public.ican_franchise_payable_lines (event_id, partner_id, role) WHERE reverses_line_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_ican_franchise_lines_partner ON public.ican_franchise_payable_lines (partner_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ican_franchise_lines_statement ON public.ican_franchise_payable_lines (statement_id);

-- 1i. Audit log, allocation errors, demand signals ------------------------------------
CREATE TABLE IF NOT EXISTS public.ican_franchise_audit_log (
  id        BIGSERIAL PRIMARY KEY,
  actor_id  UUID,
  action    TEXT NOT NULL,
  entity    TEXT NOT NULL,
  entity_id TEXT,
  detail    JSONB NOT NULL DEFAULT '{}'::JSONB,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ican_franchise_audit_at ON public.ican_franchise_audit_log (at DESC);

CREATE TABLE IF NOT EXISTS public.ican_franchise_allocation_errors (
  id               BIGSERIAL PRIMARY KEY,
  source_app       TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'allocate' CHECK (kind IN ('allocate', 'reverse')),
  error            TEXT NOT NULL,
  settlement_id    UUID,
  resolved         BOOLEAN NOT NULL DEFAULT false,
  at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ican_franchise_errors_open ON public.ican_franchise_allocation_errors (resolved, at DESC);

-- Where fees are earned but no partner covers it: the "recruit here next" signal.
CREATE TABLE IF NOT EXISTS public.ican_franchise_demand_signals (
  country_code VARCHAR(2) NOT NULL,
  stream       TEXT NOT NULL,
  month        DATE NOT NULL,
  events       INTEGER NOT NULL DEFAULT 0,
  gross_ican   NUMERIC(18,8) NOT NULL DEFAULT 0,
  PRIMARY KEY (country_code, stream, month)
);

-- 1i-b. HQ admin allowlist. The developer panel's own login is a hidden token that ships in the
-- public JavaScript, so it can never guard money-affecting controls. Franchise administration
-- instead requires a REAL signed-in account that is a developer (mbg_users.role_type) or is listed here.
-- First admin (run once, as the project owner, in the SQL editor):
--   INSERT INTO public.ican_franchise_admins (user_id, note)
--   SELECT id, 'founder' FROM auth.users WHERE lower(email) = lower('YOUR-EMAIL');
CREATE TABLE IF NOT EXISTS public.ican_franchise_admins (
  user_id  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note     TEXT,
  added_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1j. Enquiries: the landing page's "Request a franchise" form. Open to visitors with no
-- account, so it is written ONLY by ican_franchise_submit_enquiry() (validated, rate limited).
CREATE TABLE IF NOT EXISTS public.ican_franchise_enquiries (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name            TEXT NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 120),
  email                TEXT NOT NULL CHECK (length(email) <= 254 AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone                TEXT CHECK (phone IS NULL OR length(phone) <= 40),
  company_name         TEXT NOT NULL CHECK (length(btrim(company_name)) BETWEEN 2 AND 160),
  company_reg_number   TEXT NOT NULL CHECK (company_reg_number ~ '^[A-Za-z0-9][A-Za-z0-9 ./\-]{2,59}$'),
  company_reg_country  VARCHAR(2) NOT NULL,
  country_code         VARCHAR(2) NOT NULL,
  partner_type         TEXT NOT NULL DEFAULT 'agency' CHECK (partner_type IN ('country_master', 'agency', 'referral')),
  products             TEXT[] NOT NULL DEFAULT ARRAY['icanera']::TEXT[],
  clients_estimate     INTEGER CHECK (clients_estimate IS NULL OR clients_estimate BETWEEN 0 AND 1000000),
  message              TEXT CHECK (message IS NULL OR length(message) <= 2000),
  user_id              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source               TEXT NOT NULL DEFAULT 'landing',
  status               TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'converted', 'declined', 'spam')),
  admin_note           TEXT,
  converted_partner_id UUID REFERENCES public.ican_franchise_partners(id) ON DELETE SET NULL,
  handled_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  handled_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ican_franchise_enquiry_products_valid
    CHECK (products <@ ARRAY['icanera', 'supermarketera', 'bodagoera']::TEXT[] AND cardinality(products) >= 1)
);
CREATE INDEX IF NOT EXISTS idx_ican_franchise_enquiries_status ON public.ican_franchise_enquiries (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ican_franchise_enquiries_email  ON public.ican_franchise_enquiries (lower(email), created_at DESC);

-- ============================================================================
-- 2. SMALL HELPERS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ican_franchise_is_service()
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
           NULLIF(current_setting('request.jwt.claim.role', true), ''),
           NULLIF(current_setting('request.jwt.claims', true), '')::JSONB ->> 'role',
           '') = 'service_role';
$$;

-- HQ admin = a real signed-in account that is on the allowlist or is a developer, or the service role.
CREATE OR REPLACE FUNCTION public.ican_franchise_is_hq_admin()
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.ican_franchise_is_service() THEN RETURN TRUE; END IF;
  IF auth.uid() IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.ican_franchise_admins a WHERE a.user_id = auth.uid()) THEN RETURN TRUE; END IF;
    IF to_regclass('public.mbg_users') IS NOT NULL THEN
      RETURN EXISTS (
        SELECT 1 FROM public.mbg_users mu
         WHERE mu.id = auth.uid() AND mu.role_type::TEXT = 'developer' AND mu.is_active = TRUE);
    END IF;
  END IF;
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.ican_franchise_require_admin()
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.ican_franchise_is_hq_admin() THEN
    RAISE EXCEPTION 'Franchise administration is restricted to the platform developers' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Partner ids the caller owns / the agencies under the masters the caller owns /
-- the businesses the caller owns. SECURITY DEFINER so RLS policies can use them
-- without recursing into the table they protect.
CREATE OR REPLACE FUNCTION public.ican_franchise_my_partner_ids()
RETURNS UUID[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[]) FROM public.ican_franchise_partners WHERE owner_user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.ican_franchise_downline_ids()
RETURNS UUID[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(c.id), ARRAY[]::UUID[])
    FROM public.ican_franchise_partners c
    JOIN public.ican_franchise_partners p ON p.id = c.parent_partner_id
   WHERE p.owner_user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.ican_franchise_my_business_ids()
RETURNS UUID[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[]) FROM public.business_profiles WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.ican_franchise_audit(p_action TEXT, p_entity TEXT, p_entity_id TEXT, p_detail JSONB DEFAULT '{}'::JSONB)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.ican_franchise_audit_log (actor_id, action, entity, entity_id, detail)
  VALUES (auth.uid(), p_action, p_entity, p_entity_id, COALESCE(p_detail, '{}'::JSONB));
$$;

-- Which revenue stream a fee belongs to, and which licensed product earns it.
--   mybodaguy         -> ride_commission    (bodagoera)
--   digital-city-era  -> marketplace_fee    (supermarketera)
--   corporate billing -> subscription       (icanera)
--   everything else (sell/payout/referral fees: the wallet and asset side) -> wallet_fee
CREATE OR REPLACE FUNCTION public.ican_franchise_stream_for(p_source_app TEXT, p_fee_type TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN lower(COALESCE(p_source_app, '')) = 'mybodaguy'        THEN 'ride_commission'
    WHEN lower(COALESCE(p_source_app, '')) = 'digital-city-era' THEN 'marketplace_fee'
    WHEN lower(COALESCE(p_fee_type, ''))   = 'corporate_subscription' THEN 'subscription'
    ELSE 'wallet_fee'
  END;
$$;

CREATE OR REPLACE FUNCTION public.ican_franchise_product_for(p_stream TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_stream
    WHEN 'ride_commission' THEN 'bodagoera'
    WHEN 'marketplace_fee' THEN 'supermarketera'
    ELSE 'icanera'
  END;
$$;

-- Country names (BodaGoEra stores 'Uganda') to ISO codes, via the territories table
-- first, then the tax-rules reference table when it exists.
CREATE OR REPLACE FUNCTION public.ican_franchise_country_from_name(p_name TEXT)
RETURNS VARCHAR LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code VARCHAR;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN RETURN NULL; END IF;
  IF length(btrim(p_name)) = 2 THEN RETURN upper(btrim(p_name)); END IF;
  SELECT country_code INTO v_code FROM public.ican_franchise_territories WHERE lower(country_name) = lower(btrim(p_name)) LIMIT 1;
  IF v_code IS NULL AND to_regclass('public.country_tax_rules') IS NOT NULL THEN
    EXECUTE 'SELECT country_code FROM public.country_tax_rules WHERE lower(country_name) = lower($1) LIMIT 1'
      INTO v_code USING btrim(p_name);
  END IF;
  RETURN v_code;
END;
$$;

-- Best-known country for a user/business: the business's own registration first, then the user's
-- account country, then their BodaGoEra profile. Each source is optional and read defensively: a column
-- or table that does not exist on this database (they come from separate migrations) is skipped, never an
-- error, so a missing optional column can never stop a fee from being shared.
CREATE OR REPLACE FUNCTION public.ican_franchise_country_of(p_user UUID, p_business UUID)
RETURNS VARCHAR LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code VARCHAR;
BEGIN
  IF p_business IS NOT NULL THEN
    BEGIN
      SELECT NULLIF(upper(btrim(to_jsonb(bp) ->> 'country')), '') INTO v_code FROM public.business_profiles bp WHERE bp.id = p_business;
      v_code := public.ican_franchise_country_from_name(v_code);
    EXCEPTION WHEN OTHERS THEN v_code := NULL;
    END;
  END IF;
  IF v_code IS NULL AND p_user IS NOT NULL AND to_regclass('public.user_accounts') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT upper(country_code) FROM public.user_accounts WHERE user_id = $1 AND country_code IS NOT NULL ORDER BY 1 LIMIT 1'
        INTO v_code USING p_user;
    EXCEPTION WHEN OTHERS THEN v_code := NULL;
    END;
  END IF;
  IF v_code IS NULL AND p_user IS NOT NULL AND to_regclass('public.mbg_user_profiles') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT country FROM public.mbg_user_profiles WHERE user_id = $1 LIMIT 1' INTO v_code USING p_user;
      v_code := public.ican_franchise_country_from_name(v_code);
    EXCEPTION WHEN OTHERS THEN v_code := NULL;
    END;
  END IF;
  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.ican_franchise_make_code(p_country TEXT, p_type TEXT)
RETURNS TEXT LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_alphabet CONSTANT TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- no 0/O/1/I/L
  v_code TEXT; v_try INT := 0; v_tag TEXT;
BEGIN
  v_tag := CASE p_type WHEN 'country_master' THEN 'MS' WHEN 'agency' THEN 'AG' ELSE 'RF' END;
  LOOP
    v_code := upper(p_country) || '-' || v_tag || '-' ||
              (SELECT string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::INT, 1), '')
                 FROM generate_series(1, 5));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.ican_franchise_partners WHERE partner_code = v_code);
    v_try := v_try + 1;
    IF v_try > 25 THEN RAISE EXCEPTION 'Could not generate a unique partner code'; END IF;
  END LOOP;
  RETURN v_code;
END;
$$;

-- ============================================================================
-- 3. INTEGRITY TRIGGERS
-- ============================================================================

-- Partners: hierarchy, exclusivity, terminal status, code, timestamps.
CREATE OR REPLACE FUNCTION public.ican_franchise_validate_partner()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_parent public.ican_franchise_partners;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'terminated' AND NEW.status <> 'terminated' THEN
    RAISE EXCEPTION 'A terminated partner cannot be reinstated; create a new partner seat instead';
  END IF;

  IF NEW.partner_code IS NULL OR btrim(NEW.partner_code) = '' THEN
    NEW.partner_code := public.ican_franchise_make_code(NEW.country_code, NEW.partner_type);
  END IF;

  IF NEW.partner_type = 'country_master' THEN
    IF NEW.parent_partner_id IS NOT NULL THEN
      RAISE EXCEPTION 'A country master cannot have a parent partner';
    END IF;
  ELSIF NEW.parent_partner_id IS NOT NULL THEN
    SELECT * INTO v_parent FROM public.ican_franchise_partners WHERE id = NEW.parent_partner_id;
    IF NOT FOUND OR v_parent.partner_type <> 'country_master' THEN
      RAISE EXCEPTION 'An agency or referral partner can only sit under a country master';
    END IF;
    IF v_parent.country_code <> NEW.country_code THEN
      RAISE EXCEPTION 'Parent country master (%) is in a different country than this partner (%)', v_parent.country_code, NEW.country_code;
    END IF;
  END IF;

  IF NEW.partner_type = 'country_master' AND NEW.status IN ('approved', 'active') THEN
    IF NEW.exclusive AND EXISTS (
         SELECT 1 FROM public.ican_franchise_partners o
          WHERE o.id <> NEW.id AND o.partner_type = 'country_master'
            AND o.country_code = NEW.country_code AND o.status IN ('approved', 'active')) THEN
      RAISE EXCEPTION 'Country % already has an approved country master; an exclusive licence needs the territory to itself', NEW.country_code;
    END IF;
    IF NOT NEW.exclusive AND EXISTS (
         SELECT 1 FROM public.ican_franchise_partners o
          WHERE o.id <> NEW.id AND o.partner_type = 'country_master' AND o.exclusive
            AND o.country_code = NEW.country_code AND o.status IN ('approved', 'active')) THEN
      RAISE EXCEPTION 'Country % is held by an exclusive country master', NEW.country_code;
    END IF;
  END IF;

  IF NEW.share_adjust_pts < -50 OR NEW.share_adjust_pts > 50 THEN
    RAISE EXCEPTION 'share_adjust_pts out of range';
  END IF;

  NEW.company_reg_country := upper(btrim(NEW.company_reg_country));
  NEW.company_name := btrim(NEW.company_name);
  NEW.company_reg_number := btrim(NEW.company_reg_number);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ican_franchise_validate_partner ON public.ican_franchise_partners;
CREATE TRIGGER trg_ican_franchise_validate_partner
  BEFORE INSERT OR UPDATE ON public.ican_franchise_partners
  FOR EACH ROW EXECUTE FUNCTION public.ican_franchise_validate_partner();

-- Revenue events are append-only: only the void markers may ever change.
CREATE OR REPLACE FUNCTION public.ican_franchise_events_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Franchise revenue events are append-only and cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - 'voided_at' - 'void_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'voided_at' - 'void_reason') THEN
    RAISE EXCEPTION 'Franchise revenue events are append-only: only voided_at / void_reason may change';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ican_franchise_events_immutable ON public.ican_franchise_revenue_events;
CREATE TRIGGER trg_ican_franchise_events_immutable
  BEFORE UPDATE OR DELETE ON public.ican_franchise_revenue_events
  FOR EACH ROW EXECUTE FUNCTION public.ican_franchise_events_immutable();

-- A payable line's money fields are fixed at creation; only status/statement may move.
CREATE OR REPLACE FUNCTION public.ican_franchise_lines_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payable lines cannot be deleted; void or reverse them instead';
  END IF;
  IF NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.partner_id IS DISTINCT FROM OLD.partner_id
     OR NEW.role IS DISTINCT FROM OLD.role OR NEW.amount_ican IS DISTINCT FROM OLD.amount_ican
     OR NEW.reverses_line_id IS DISTINCT FROM OLD.reverses_line_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Payable line amounts and ownership are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ican_franchise_lines_immutable ON public.ican_franchise_payable_lines;
CREATE TRIGGER trg_ican_franchise_lines_immutable
  BEFORE UPDATE OR DELETE ON public.ican_franchise_payable_lines
  FOR EACH ROW EXECUTE FUNCTION public.ican_franchise_lines_immutable();

-- ============================================================================
-- 4. THE ALLOCATION ENGINE
-- ============================================================================

-- Split one platform fee. Idempotent on (source_app, source_reference). Returns a
-- JSON verdict instead of raising for the expected "HQ keeps it all" outcomes.
CREATE OR REPLACE FUNCTION public.ican_franchise_allocate(
  p_source_app       TEXT,
  p_source_reference TEXT,
  p_amount_ican      NUMERIC,
  p_fee_type         TEXT,
  p_actor_user       UUID,
  p_settlement_id    UUID  DEFAULT NULL,
  p_metadata         JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s            public.ican_franchise_settings;
  v_stream     TEXT;
  v_product    TEXT;
  v_biz        UUID;
  v_country    VARCHAR;
  v_assign     public.ican_franchise_customer_assignments;
  v_agency     public.ican_franchise_partners;
  v_master     public.ican_franchise_partners;
  v_rule       public.ican_franchise_split_rules;
  v_structure  TEXT;
  v_tier       TEXT;
  v_have       BOOLEAN := FALSE;
  v_territory  public.ican_franchise_territories;
  v_delta      NUMERIC := 0;
  v_hq_pct     NUMERIC; v_master_pct NUMERIC; v_agency_pct NUMERIC;
  v_master_amt NUMERIC := 0; v_agency_amt NUMERIC := 0; v_hq_amt NUMERIC;
  v_event_id   UUID;
BEGIN
  SELECT * INTO s FROM public.ican_franchise_settings WHERE id;
  IF NOT FOUND OR NOT s.enabled THEN
    RETURN jsonb_build_object('allocated', false, 'reason', 'disabled');
  END IF;
  IF p_amount_ican IS NULL OR p_amount_ican <= 0 THEN
    RETURN jsonb_build_object('allocated', false, 'reason', 'no_amount');
  END IF;
  IF EXISTS (SELECT 1 FROM public.ican_franchise_revenue_events WHERE source_app = p_source_app AND source_reference = p_source_reference) THEN
    RETURN jsonb_build_object('allocated', false, 'reason', 'already_allocated');
  END IF;

  v_stream  := public.ican_franchise_stream_for(p_source_app, p_fee_type);
  v_product := public.ican_franchise_product_for(v_stream);

  -- The regulated asset/wallet side is never shared unless HQ explicitly allows it.
  IF v_stream = 'wallet_fee' AND NOT s.share_wallet_fees THEN
    RETURN jsonb_build_object('allocated', false, 'reason', 'wallet_fees_not_shared', 'stream', v_stream);
  END IF;

  -- Who is the customer? An explicit business id wins; else the actor's first business.
  v_biz := NULLIF(p_metadata ->> 'business_profile_id', '')::UUID;
  IF v_biz IS NULL AND p_actor_user IS NOT NULL THEN
    SELECT id INTO v_biz FROM public.business_profiles WHERE user_id = p_actor_user ORDER BY created_at ASC LIMIT 1;
  END IF;

  v_country := upper(NULLIF(p_metadata ->> 'country_code', ''));
  IF v_country IS NULL THEN v_country := public.ican_franchise_country_of(p_actor_user, v_biz); END IF;

  -- Candidate 1: the partner that serves this customer.
  SELECT a.* INTO v_assign
    FROM public.ican_franchise_customer_assignments a
   WHERE a.status = 'active' AND a.partner_id IS NOT NULL
     AND ((v_biz IS NOT NULL AND a.business_profile_id = v_biz)
          OR (a.business_profile_id IS NULL AND p_actor_user IS NOT NULL AND a.user_id = p_actor_user))
   ORDER BY a.assigned_at DESC LIMIT 1;

  IF FOUND THEN
    SELECT * INTO v_agency FROM public.ican_franchise_partners
     WHERE id = v_assign.partner_id AND status = 'active' AND v_product = ANY (products);
    IF FOUND THEN
      IF v_agency.partner_type = 'agency' THEN
        SELECT * INTO v_master FROM public.ican_franchise_partners
         WHERE id = v_agency.parent_partner_id AND status = 'active' AND v_product = ANY (products);
        IF FOUND THEN v_structure := 'with_master'; ELSE v_structure := 'hq_direct'; v_master := NULL; END IF;
        v_tier := v_agency.tier;
        v_have := TRUE;
      ELSIF v_agency.partner_type = 'referral'
            AND v_assign.assigned_at + make_interval(months => v_agency.referral_window_months) > now() THEN
        v_structure := 'referral'; v_tier := 'any'; v_master := NULL; v_have := TRUE;
      END IF;
      IF v_have THEN
        v_country := v_agency.country_code;  -- the serving partner's territory governs
        SELECT * INTO v_rule FROM public.ican_franchise_split_rules
         WHERE active AND stream = v_stream AND structure = v_structure AND agency_tier IN (v_tier, 'any')
         ORDER BY (agency_tier = v_tier) DESC LIMIT 1;
        IF NOT FOUND THEN v_have := FALSE; END IF;
      END IF;
    END IF;
  END IF;

  -- Candidate 2: the country master sells/serves directly.
  IF NOT v_have AND v_country IS NOT NULL THEN
    v_agency := NULL;
    SELECT * INTO v_master FROM public.ican_franchise_partners
     WHERE partner_type = 'country_master' AND status = 'active'
       AND country_code = v_country AND v_product = ANY (products)
     ORDER BY exclusive DESC, approved_at ASC NULLS LAST LIMIT 1;
    IF FOUND THEN
      v_structure := 'master_direct'; v_tier := 'any';
      SELECT * INTO v_rule FROM public.ican_franchise_split_rules
       WHERE active AND stream = v_stream AND structure = 'master_direct' AND agency_tier = 'any' LIMIT 1;
      IF FOUND THEN v_have := TRUE; END IF;
    END IF;
  END IF;

  IF v_have AND v_country IS NOT NULL THEN
    SELECT * INTO v_territory FROM public.ican_franchise_territories WHERE country_code = v_country;
    IF FOUND AND v_territory.status = 'paused' THEN v_have := FALSE; END IF;
  END IF;

  IF NOT v_have THEN
    -- HQ keeps everything. Remember the geography so HQ can see where to recruit.
    IF v_country IS NOT NULL THEN
      INSERT INTO public.ican_franchise_demand_signals (country_code, stream, month, events, gross_ican)
      VALUES (v_country, v_stream, date_trunc('month', now())::DATE, 1, p_amount_ican)
      ON CONFLICT (country_code, stream, month)
      DO UPDATE SET events = ican_franchise_demand_signals.events + 1,
                    gross_ican = ican_franchise_demand_signals.gross_ican + EXCLUDED.gross_ican;
    END IF;
    RETURN jsonb_build_object('allocated', false, 'reason', 'hq_direct', 'stream', v_stream, 'country', v_country);
  END IF;

  v_hq_pct := v_rule.hq_pct; v_master_pct := v_rule.master_pct; v_agency_pct := v_rule.agency_pct;

  -- Quality kicker / penalty moves points between HQ and the serving agency, never
  -- pushing HQ under its floor and never beyond the configured bounds.
  IF v_agency.id IS NOT NULL AND v_agency.partner_type = 'agency' AND v_structure IN ('with_master', 'hq_direct') THEN
    v_delta := GREATEST(-s.max_penalty_pts, LEAST(s.max_kicker_pts, v_agency.share_adjust_pts));
    IF v_delta > 0 THEN
      v_delta := LEAST(v_delta, GREATEST(v_hq_pct - s.hq_share_floor_pct, 0));
    END IF;
    v_hq_pct := v_hq_pct - v_delta;
    v_agency_pct := v_agency_pct + v_delta;
  END IF;

  IF v_master.id IS NOT NULL THEN v_master_amt := ROUND(p_amount_ican * v_master_pct / 100, 8); END IF;
  IF v_agency.id IS NOT NULL THEN v_agency_amt := ROUND(p_amount_ican * v_agency_pct / 100, 8); END IF;
  v_hq_amt := p_amount_ican - v_master_amt - v_agency_amt;   -- rounding remainder stays with HQ

  INSERT INTO public.ican_franchise_revenue_events
    (source_app, source_reference, settlement_id, stream, product, fee_type, country_code, structure, agency_tier,
     gross_ican, hq_pct, master_pct, agency_pct, hq_ican, master_ican, agency_ican,
     master_partner_id, agency_partner_id, customer_business_id, customer_user_id)
  VALUES
    (p_source_app, p_source_reference, p_settlement_id, v_stream, v_product, p_fee_type, v_country, v_structure, v_tier,
     p_amount_ican, v_hq_pct, v_master_pct, v_agency_pct, v_hq_amt, v_master_amt, v_agency_amt,
     v_master.id, v_agency.id, v_biz, p_actor_user)
  ON CONFLICT (source_app, source_reference) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('allocated', false, 'reason', 'already_allocated');
  END IF;

  IF v_master.id IS NOT NULL AND v_master_amt > 0 THEN
    INSERT INTO public.ican_franchise_payable_lines (event_id, partner_id, role, amount_ican)
    VALUES (v_event_id, v_master.id, 'master', v_master_amt);
  END IF;
  IF v_agency.id IS NOT NULL AND v_agency_amt > 0 THEN
    INSERT INTO public.ican_franchise_payable_lines (event_id, partner_id, role, amount_ican)
    VALUES (v_event_id, v_agency.id, 'agency', v_agency_amt);
  END IF;

  RETURN jsonb_build_object('allocated', true, 'event_id', v_event_id, 'stream', v_stream, 'structure', v_structure,
                            'hq_ican', v_hq_amt, 'master_ican', v_master_amt, 'agency_ican', v_agency_amt);
END;
$$;

-- Undo an allocation when the underlying fee is reversed. Accrued lines are voided;
-- lines already on a statement or paid get a NEGATIVE line that nets off next statement.
CREATE OR REPLACE FUNCTION public.ican_franchise_reverse(
  p_source_app TEXT, p_original_reference TEXT, p_reason TEXT DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e public.ican_franchise_revenue_events;
  l public.ican_franchise_payable_lines;
  v_voided INT := 0; v_clawed INT := 0;
BEGIN
  SELECT * INTO e FROM public.ican_franchise_revenue_events
   WHERE source_app = p_source_app AND source_reference = p_original_reference;
  IF NOT FOUND THEN RETURN jsonb_build_object('reversed', false, 'reason', 'nothing_to_reverse'); END IF;
  IF e.voided_at IS NOT NULL THEN RETURN jsonb_build_object('reversed', false, 'reason', 'already_reversed'); END IF;

  UPDATE public.ican_franchise_revenue_events
     SET voided_at = now(), void_reason = COALESCE(NULLIF(btrim(p_reason), ''), 'fee reversed')
   WHERE id = e.id;

  FOR l IN SELECT * FROM public.ican_franchise_payable_lines WHERE event_id = e.id AND reverses_line_id IS NULL LOOP
    IF l.status = 'accrued' THEN
      UPDATE public.ican_franchise_payable_lines SET status = 'void' WHERE id = l.id;
      v_voided := v_voided + 1;
    ELSIF l.status IN ('statemented', 'paid') THEN
      INSERT INTO public.ican_franchise_payable_lines (event_id, partner_id, role, amount_ican, reverses_line_id)
      VALUES (l.event_id, l.partner_id, l.role, -l.amount_ican, l.id)
      ON CONFLICT DO NOTHING;
      v_clawed := v_clawed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('reversed', true, 'voided_lines', v_voided, 'clawback_lines', v_clawed);
END;
$$;

-- The trigger body: never allowed to fail the fee credit that fired it.
CREATE OR REPLACE FUNCTION public.ican_franchise_on_fee_settlement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_kind TEXT;
BEGIN
  BEGIN
    IF NEW.settlement_type = 'platform_fee' THEN
      v_kind := 'allocate';
      PERFORM public.ican_franchise_allocate(
        NEW.source_app, NEW.source_reference, NEW.amount_ican,
        NEW.metadata ->> 'fee_type', NEW.settled_by, NEW.id, COALESCE(NEW.metadata, '{}'::JSONB));
    ELSIF NEW.settlement_type = 'platform_fee_reversal' THEN
      v_kind := 'reverse';
      PERFORM public.ican_franchise_reverse(
        NEW.source_app, NEW.metadata ->> 'reverses', NULLIF(btrim(COALESCE(NEW.note, '')), ''));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.ican_franchise_allocation_errors (source_app, source_reference, kind, error, settlement_id)
      VALUES (NEW.source_app,
              CASE WHEN v_kind = 'reverse' THEN COALESCE(NEW.metadata ->> 'reverses', NEW.source_reference) ELSE NEW.source_reference END,
              COALESCE(v_kind, 'allocate'), left(SQLERRM, 500), NEW.id);
    EXCEPTION WHEN OTHERS THEN
      NULL; -- even the error log must not break a fee credit
    END;
  END;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.ican_business_wallet_settlements') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ican_franchise_on_fee_settlement ON public.ican_business_wallet_settlements;
    CREATE TRIGGER trg_ican_franchise_on_fee_settlement
      AFTER INSERT ON public.ican_business_wallet_settlements
      FOR EACH ROW
      WHEN (NEW.settlement_type IN ('platform_fee', 'platform_fee_reversal'))
      EXECUTE FUNCTION public.ican_franchise_on_fee_settlement();
  ELSE
    RAISE NOTICE 'ican_business_wallet_settlements is missing: apply ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql, then re-run this migration to attach the franchise trigger.';
  END IF;
END $$;

-- ============================================================================
-- 5. TIERS
-- ============================================================================

-- Accounts that produced fee revenue for this agency inside the activity window.
CREATE OR REPLACE FUNCTION public.ican_franchise_active_accounts(p_partner UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(DISTINCT COALESCE(e.customer_business_id, e.customer_user_id))::INT
    FROM public.ican_franchise_revenue_events e, public.ican_franchise_settings s
   WHERE s.id AND e.agency_partner_id = p_partner AND e.voided_at IS NULL
     AND e.created_at > now() - make_interval(days => s.active_window_days);
$$;

CREATE OR REPLACE FUNCTION public.ican_franchise_tier_for(p_accounts INTEGER)
RETURNS TEXT LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN p_accounts >= s.platinum_min_accounts THEN 'platinum'
              WHEN p_accounts >= s.gold_min_accounts     THEN 'gold'
              ELSE 'silver' END
    FROM public.ican_franchise_settings s WHERE s.id;
$$;

-- Callable by pg_cron (no JWT), the service role, or an HQ admin.
CREATE OR REPLACE FUNCTION public.ican_franchise_refresh_tiers()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; v_new TEXT; v_changed INT := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.ican_franchise_is_hq_admin() THEN
    RAISE EXCEPTION 'Franchise administration is restricted to the platform developers' USING ERRCODE = '42501';
  END IF;
  FOR r IN SELECT id, tier FROM public.ican_franchise_partners WHERE partner_type = 'agency' AND status = 'active' LOOP
    v_new := public.ican_franchise_tier_for(public.ican_franchise_active_accounts(r.id));
    IF v_new IS DISTINCT FROM r.tier THEN
      UPDATE public.ican_franchise_partners SET tier = v_new WHERE id = r.id;
      PERFORM public.ican_franchise_audit('tier_changed', 'partner', r.id::TEXT, jsonb_build_object('from', r.tier, 'to', v_new));
      v_changed := v_changed + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('changed', v_changed);
END;
$$;

-- ============================================================================
-- 6. PARTNER-FACING RPCs (signed-in users)
-- ============================================================================

-- Anyone signed in may apply, but only on behalf of a REGISTERED COMPANY; HQ verifies the
-- registration and vets the application before the partner can go active.
CREATE OR REPLACE FUNCTION public.ican_franchise_apply(
  p_partner_type         TEXT,
  p_country              TEXT,
  p_company_name         TEXT,
  p_company_reg_number   TEXT,
  p_company_reg_country  TEXT   DEFAULT NULL,
  p_company_document_url TEXT   DEFAULT NULL,
  p_trading_name         TEXT   DEFAULT NULL,
  p_region               TEXT   DEFAULT NULL,
  p_products             TEXT[] DEFAULT ARRAY['icanera']::TEXT[],
  p_business_profile_id  UUID   DEFAULT NULL,
  p_notes                TEXT   DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_country VARCHAR := upper(btrim(COALESCE(p_country, '')));
  v_reg_country VARCHAR := upper(btrim(COALESCE(NULLIF(p_company_reg_country, ''), p_country, '')));
  v_name TEXT := btrim(COALESCE(p_company_name, ''));
  v_row public.ican_franchise_partners;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  IF p_partner_type NOT IN ('country_master', 'agency', 'referral') THEN RAISE EXCEPTION 'Unknown partner type'; END IF;
  IF length(v_name) < 2 OR length(v_name) > 160 THEN
    RAISE EXCEPTION 'A franchise partner must be a registered company: enter the company''s registered name';
  END IF;
  IF COALESCE(p_company_reg_number, '') !~ '^[A-Za-z0-9][A-Za-z0-9 ./\-]{2,59}$' THEN
    RAISE EXCEPTION 'A franchise partner must be a registered company: enter its company registration number';
  END IF;
  IF length(v_reg_country) <> 2 THEN RAISE EXCEPTION 'Choose the country where the company is registered'; END IF;
  IF p_company_document_url IS NOT NULL AND btrim(p_company_document_url) <> ''
     AND (length(p_company_document_url) > 500 OR p_company_document_url !~* '^https://') THEN
    RAISE EXCEPTION 'The certificate link must be a secure (https) link';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ican_franchise_territories WHERE country_code = v_country AND status <> 'paused') THEN
    RAISE EXCEPTION 'Country % is not open for partners yet', v_country;
  END IF;
  IF p_business_profile_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.business_profiles WHERE id = p_business_profile_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'That business does not belong to you';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ican_franchise_partners
              WHERE owner_user_id = auth.uid() AND country_code = v_country AND partner_type = p_partner_type AND status <> 'terminated') THEN
    RAISE EXCEPTION 'You already have a % application or seat in %', p_partner_type, v_country;
  END IF;

  BEGIN
    INSERT INTO public.ican_franchise_partners
      (partner_code, partner_type, country_code, region, display_name, company_name, company_reg_number, company_reg_country,
       company_document_url, owner_user_id, business_profile_id, products, notes)
    VALUES ('', p_partner_type, v_country, NULLIF(btrim(COALESCE(p_region, '')), ''),
            left(COALESCE(NULLIF(btrim(COALESCE(p_trading_name, '')), ''), v_name), 120),
            v_name, btrim(p_company_reg_number), v_reg_country, NULLIF(btrim(COALESCE(p_company_document_url, '')), ''),
            auth.uid(), p_business_profile_id, COALESCE(p_products, ARRAY['icanera']::TEXT[]), left(p_notes, 1000))
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'That company registration already holds a % seat in %', p_partner_type, v_country;
  END;

  PERFORM public.ican_franchise_audit('partner_applied', 'partner', v_row.id::TEXT,
    jsonb_build_object('type', p_partner_type, 'country', v_country, 'company', v_name));
  RETURN jsonb_build_object('id', v_row.id, 'partner_code', v_row.partner_code, 'status', v_row.status, 'company_status', v_row.company_status);
END;
$$;

-- The caller's partner seats with live numbers. A country master also gets its downline totals.
CREATE OR REPLACE FUNCTION public.ican_franchise_my_summary()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.ican_franchise_settings;
  r public.ican_franchise_partners;
  v_out JSONB := '[]'::JSONB; v_item JSONB;
  v_active INT; v_next_tier TEXT; v_next_min INT; v_assigned INT;
  v_royalty NUMERIC; v_agencies INT; v_downline_accounts INT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN v_out; END IF;
  SELECT * INTO s FROM public.ican_franchise_settings WHERE id;

  FOR r IN SELECT * FROM public.ican_franchise_partners WHERE owner_user_id = auth.uid() ORDER BY created_at LOOP
    v_active := 0; v_next_tier := NULL; v_next_min := NULL;
    SELECT COUNT(*)::INT INTO v_assigned FROM public.ican_franchise_customer_assignments a
     WHERE a.partner_id = r.id AND a.status = 'active';

    IF r.partner_type = 'agency' THEN
      v_active := public.ican_franchise_active_accounts(r.id);
      IF r.tier = 'silver' THEN v_next_tier := 'gold'; v_next_min := s.gold_min_accounts;
      ELSIF r.tier = 'gold' THEN v_next_tier := 'platinum'; v_next_min := s.platinum_min_accounts; END IF;
    END IF;

    v_item := jsonb_build_object(
      'id', r.id, 'partner_code', r.partner_code, 'partner_type', r.partner_type, 'display_name', r.display_name,
      'country_code', r.country_code, 'region', r.region, 'products', to_jsonb(r.products),
      'tier', r.tier, 'status', r.status, 'exclusive', r.exclusive, 'kyc_status', r.kyc_status,
      'company_name', r.company_name, 'company_reg_number', r.company_reg_number,
      'company_reg_country', r.company_reg_country, 'company_status', r.company_status,
      'parent_partner_id', r.parent_partner_id, 'contract_start', r.contract_start, 'contract_end', r.contract_end,
      'assigned_accounts', v_assigned, 'active_accounts', v_active,
      'next_tier', v_next_tier, 'next_tier_min_accounts', v_next_min,
      'accounts_to_next_tier', CASE WHEN v_next_min IS NULL THEN NULL ELSE GREATEST(v_next_min - v_active, 0) END,
      'accrued_ican',     COALESCE((SELECT SUM(amount_ican) FROM public.ican_franchise_payable_lines WHERE partner_id = r.id AND status = 'accrued'), 0),
      'statemented_ican', COALESCE((SELECT SUM(amount_ican) FROM public.ican_franchise_payable_lines WHERE partner_id = r.id AND status = 'statemented'), 0),
      'paid_ican',        COALESCE((SELECT SUM(amount_ican) FROM public.ican_franchise_payable_lines WHERE partner_id = r.id AND status = 'paid'), 0),
      'earned_12m_ican',  COALESCE((SELECT SUM(amount_ican) FROM public.ican_franchise_payable_lines
                                      WHERE partner_id = r.id AND status <> 'void' AND created_at > now() - INTERVAL '12 months'), 0),
      'share_adjust_pts', r.share_adjust_pts
    );

    IF r.partner_type = 'country_master' THEN
      SELECT COUNT(*)::INT INTO v_agencies FROM public.ican_franchise_partners c WHERE c.parent_partner_id = r.id AND c.status <> 'terminated';
      SELECT COUNT(*)::INT INTO v_downline_accounts FROM public.ican_franchise_customer_assignments a
       WHERE a.status = 'active' AND a.partner_id IN (SELECT id FROM public.ican_franchise_partners WHERE parent_partner_id = r.id OR id = r.id);
      SELECT COALESCE(SUM(hq_ican), 0) INTO v_royalty FROM public.ican_franchise_revenue_events
       WHERE master_partner_id = r.id AND voided_at IS NULL AND created_at > now() - INTERVAL '12 months';
      v_item := v_item || jsonb_build_object(
        'agencies', v_agencies, 'downline_accounts', v_downline_accounts,
        'hq_royalty_12m_ican', v_royalty, 'min_annual_royalty_ican', r.min_annual_royalty_ican,
        'mar_shortfall_ican', GREATEST(r.min_annual_royalty_ican - v_royalty, 0));
    END IF;

    v_out := v_out || jsonb_build_array(v_item);
  END LOOP;
  RETURN v_out;
END;
$$;

-- Monthly earnings by stream for one partner the caller owns (or HQ for any).
CREATE OR REPLACE FUNCTION public.ican_franchise_my_earnings(p_partner_id UUID, p_months INTEGER DEFAULT 12)
RETURNS TABLE (month DATE, stream TEXT, role TEXT, events BIGINT, amount_ican NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.ican_franchise_is_hq_admin()
          OR EXISTS (SELECT 1 FROM public.ican_franchise_partners p WHERE p.id = p_partner_id AND p.owner_user_id = auth.uid())) THEN
    RAISE EXCEPTION 'Not your partner account' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT date_trunc('month', l.created_at)::DATE, e.stream, l.role, COUNT(*), SUM(l.amount_ican)
      FROM public.ican_franchise_payable_lines l
      JOIN public.ican_franchise_revenue_events e ON e.id = l.event_id
     WHERE l.partner_id = p_partner_id AND l.status <> 'void'
       AND l.created_at >= date_trunc('month', now()) - make_interval(months => GREATEST(LEAST(COALESCE(p_months, 12), 36), 1) - 1)
     GROUP BY 1, 2, 3
     ORDER BY 1 DESC, 2;
END;
$$;

-- The customers a partner serves (a country master sees its downline's, names only).
CREATE OR REPLACE FUNCTION public.ican_franchise_my_customers(p_partner_id UUID, p_limit INTEGER DEFAULT 200)
RETURNS TABLE (assignment_id UUID, business_profile_id UUID, business_name TEXT, serving_partner_id UUID,
               serving_partner_name TEXT, assigned_at TIMESTAMPTZ, last_revenue_at TIMESTAMPTZ, earned_30d_ican NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.ican_franchise_is_hq_admin() OR EXISTS (
            SELECT 1 FROM public.ican_franchise_partners p
             WHERE p.id = p_partner_id AND p.owner_user_id = auth.uid())) THEN
    RAISE EXCEPTION 'Not your partner account' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT a.id, a.business_profile_id, bp.business_name::TEXT, a.partner_id, sp.display_name, a.assigned_at,
           (SELECT MAX(e.created_at) FROM public.ican_franchise_revenue_events e
             WHERE e.voided_at IS NULL AND e.customer_business_id = a.business_profile_id),
           COALESCE((SELECT SUM(e.agency_ican + e.master_ican) FROM public.ican_franchise_revenue_events e
                      WHERE e.voided_at IS NULL AND e.customer_business_id = a.business_profile_id
                        AND e.created_at > now() - INTERVAL '30 days'
                        AND (e.agency_partner_id = p_partner_id OR e.master_partner_id = p_partner_id)), 0)
      FROM public.ican_franchise_customer_assignments a
      JOIN public.ican_franchise_partners sp ON sp.id = a.partner_id
      LEFT JOIN public.business_profiles bp ON bp.id = a.business_profile_id
     WHERE a.status = 'active'
       AND (a.partner_id = p_partner_id OR sp.parent_partner_id = p_partner_id)
     ORDER BY a.assigned_at DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
END;
$$;

-- A business owner chooses their agency by its code: consent is the customer's.
CREATE OR REPLACE FUNCTION public.ican_franchise_claim_agency(p_code TEXT, p_business_profile_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_partner public.ican_franchise_partners; v_biz_country VARCHAR; v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_profiles WHERE id = p_business_profile_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'That business does not belong to you';
  END IF;
  SELECT * INTO v_partner FROM public.ican_franchise_partners
   WHERE partner_code = upper(btrim(COALESCE(p_code, ''))) AND status = 'active' AND partner_type IN ('agency', 'referral');
  IF NOT FOUND THEN RAISE EXCEPTION 'No active agency has that code'; END IF;

  SELECT NULLIF(upper(btrim(to_jsonb(bp) ->> 'country')), '') INTO v_biz_country FROM public.business_profiles bp WHERE bp.id = p_business_profile_id;
  IF v_biz_country IS NOT NULL AND v_biz_country <> v_partner.country_code THEN
    RAISE EXCEPTION 'That agency serves %, but this business is registered in %', v_partner.country_code, v_biz_country;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ican_franchise_customer_assignments
              WHERE business_profile_id = p_business_profile_id AND status = 'active') THEN
    RAISE EXCEPTION 'This business already has an agency. Release it first to switch.';
  END IF;

  INSERT INTO public.ican_franchise_customer_assignments (business_profile_id, user_id, partner_id, country_code, source)
  VALUES (p_business_profile_id, auth.uid(), v_partner.id, v_partner.country_code, 'claim_code')
  RETURNING id INTO v_id;

  PERFORM public.ican_franchise_audit('customer_claimed', 'assignment', v_id::TEXT,
    jsonb_build_object('partner', v_partner.id, 'business', p_business_profile_id));
  RETURN jsonb_build_object('assignment_id', v_id, 'agency', v_partner.display_name, 'partner_code', v_partner.partner_code);
END;
$$;

-- Customers can always leave their agency (their data and relationship are theirs).
CREATE OR REPLACE FUNCTION public.ican_franchise_release_agency(p_business_profile_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_profiles WHERE id = p_business_profile_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'That business does not belong to you';
  END IF;
  UPDATE public.ican_franchise_customer_assignments
     SET status = 'ended', ended_at = now(), end_reason = 'customer_release'
   WHERE business_profile_id = p_business_profile_id AND status = 'active';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    PERFORM public.ican_franchise_audit('customer_released', 'business', p_business_profile_id::TEXT, '{}'::JSONB);
  END IF;
  RETURN v_n > 0;
END;
$$;

-- The agency a business currently has (so the business can show and change it).
CREATE OR REPLACE FUNCTION public.ican_franchise_my_agency(p_business_profile_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT jsonb_build_object('partner_code', p.partner_code, 'display_name', p.display_name,
                              'country_code', p.country_code, 'assigned_at', a.assigned_at)
      FROM public.ican_franchise_customer_assignments a
      JOIN public.ican_franchise_partners p ON p.id = a.partner_id
     WHERE a.business_profile_id = p_business_profile_id AND a.status = 'active'
       AND EXISTS (SELECT 1 FROM public.business_profiles b WHERE b.id = p_business_profile_id AND b.user_id = auth.uid())
     LIMIT 1), 'null'::JSONB);
$$;

-- What the public landing page may know: that every country is open, which ones already have a live
-- or reserved partner, where an exclusive Country Master seat is taken, and the headline share.
-- Deliberately NOT the whole rate card (HQ / master percentages stay partner-only).
CREATE OR REPLACE FUNCTION public.ican_franchise_public_overview()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'countries_open', (SELECT COUNT(*) FROM public.ican_franchise_territories WHERE status <> 'paused'),
    'live', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('country_code', country_code, 'country_name', country_name) ORDER BY country_name)
        FROM public.ican_franchise_territories WHERE status = 'active'), '[]'::JSONB),
    'reserved', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('country_code', country_code, 'country_name', country_name) ORDER BY country_name)
        FROM public.ican_franchise_territories WHERE status = 'reserved'), '[]'::JSONB),
    'exclusive_masters', COALESCE((
      SELECT jsonb_agg(DISTINCT country_code) FROM public.ican_franchise_partners
       WHERE partner_type = 'country_master' AND exclusive AND status IN ('approved', 'active')), '[]'::JSONB),
    'max_agency_share_pct', COALESCE((
      SELECT MAX(agency_pct) FROM public.ican_franchise_split_rules
       WHERE active AND stream = 'subscription' AND structure IN ('with_master', 'hq_direct')), 0),
    'active_masters',  (SELECT COUNT(*) FROM public.ican_franchise_partners WHERE status = 'active' AND partner_type = 'country_master'),
    'active_agencies', (SELECT COUNT(*) FROM public.ican_franchise_partners WHERE status = 'active' AND partner_type = 'agency'),
    'enabled',         COALESCE((SELECT enabled FROM public.ican_franchise_settings WHERE id), false)
  );
$$;

-- The landing page form. Anyone may call it (no account needed), so it is the ONLY write path
-- visitors have: validated, length limited, flood controlled, with a honeypot field that real
-- people never fill in. Only REGISTERED COMPANIES may ask: the company name and registration
-- number are required. A signed-in caller is linked to their account automatically.
CREATE OR REPLACE FUNCTION public.ican_franchise_submit_enquiry(
  p_full_name           TEXT,
  p_email               TEXT,
  p_country             TEXT,
  p_company_name        TEXT,
  p_company_reg_number  TEXT,
  p_company_reg_country TEXT    DEFAULT NULL,
  p_partner_type        TEXT    DEFAULT 'agency',
  p_products            TEXT[]  DEFAULT ARRAY['icanera']::TEXT[],
  p_phone               TEXT    DEFAULT NULL,
  p_clients_estimate    INTEGER DEFAULT NULL,
  p_message             TEXT    DEFAULT NULL,
  p_website             TEXT    DEFAULT NULL    -- honeypot
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email    TEXT := lower(btrim(COALESCE(p_email, '')));
  v_country  VARCHAR;
  v_reg_country VARCHAR;
  v_company  TEXT := btrim(COALESCE(p_company_name, ''));
  v_reg_no   TEXT := btrim(COALESCE(p_company_reg_number, ''));
  v_products TEXT[] := COALESCE(p_products, ARRAY['icanera']::TEXT[]);
  v_id       UUID;
BEGIN
  IF NULLIF(btrim(COALESCE(p_website, '')), '') IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true);               -- a bot: look successful, store nothing
  END IF;
  IF length(btrim(COALESCE(p_full_name, ''))) < 2 OR length(p_full_name) > 120 THEN
    RAISE EXCEPTION 'Please enter your name';
  END IF;
  IF length(v_email) > 254 OR v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Please enter a valid email address';
  END IF;
  v_country := public.ican_franchise_country_from_name(p_country);
  IF v_country IS NULL OR length(v_country) <> 2
     OR NOT EXISTS (SELECT 1 FROM public.ican_franchise_territories WHERE country_code = v_country) THEN
    RAISE EXCEPTION 'Please choose your country';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ican_franchise_territories WHERE country_code = v_country AND status = 'paused') THEN
    RAISE EXCEPTION 'We are not taking franchise requests for that country right now';
  END IF;
  IF length(v_company) < 2 OR length(v_company) > 160 THEN
    RAISE EXCEPTION 'Franchises are for registered companies: please enter your company''s registered name';
  END IF;
  IF v_reg_no !~ '^[A-Za-z0-9][A-Za-z0-9 ./\-]{2,59}$' THEN
    RAISE EXCEPTION 'Franchises are for registered companies: please enter your company registration number';
  END IF;
  v_reg_country := COALESCE(public.ican_franchise_country_from_name(NULLIF(p_company_reg_country, '')), v_country);
  IF NOT EXISTS (SELECT 1 FROM public.ican_franchise_territories WHERE country_code = v_reg_country) THEN
    RAISE EXCEPTION 'Please choose the country where the company is registered';
  END IF;
  IF p_partner_type NOT IN ('country_master', 'agency', 'referral') THEN
    RAISE EXCEPTION 'Please choose what you would like to become';
  END IF;
  IF cardinality(v_products) < 1 OR NOT (v_products <@ ARRAY['icanera', 'supermarketera', 'bodagoera']::TEXT[]) THEN
    RAISE EXCEPTION 'Please choose at least one product';
  END IF;
  IF length(COALESCE(p_message, '')) > 2000 OR length(COALESCE(p_phone, '')) > 40 THEN
    RAISE EXCEPTION 'One of the fields is too long';
  END IF;
  IF p_clients_estimate IS NOT NULL AND (p_clients_estimate < 0 OR p_clients_estimate > 1000000) THEN
    RAISE EXCEPTION 'Please enter a sensible number of clients';
  END IF;

  -- Flood control: a global ceiling per hour, a few per person per day.
  IF (SELECT COUNT(*) FROM public.ican_franchise_enquiries WHERE created_at > now() - INTERVAL '1 hour') >= 100 THEN
    RAISE EXCEPTION 'We are getting a lot of requests right now. Please try again a little later.';
  END IF;
  -- The same person asking the same thing again is simply acknowledged, never piled up.
  IF EXISTS (SELECT 1 FROM public.ican_franchise_enquiries
              WHERE lower(email) = v_email AND partner_type = p_partner_type AND country_code = v_country
                AND created_at > now() - INTERVAL '24 hours') THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;
  IF (SELECT COUNT(*) FROM public.ican_franchise_enquiries
       WHERE lower(email) = v_email AND created_at > now() - INTERVAL '24 hours') >= 3 THEN
    RAISE EXCEPTION 'You have already sent a few requests today. We will be in touch.';
  END IF;

  INSERT INTO public.ican_franchise_enquiries
    (full_name, email, phone, company_name, company_reg_number, company_reg_country, country_code, partner_type, products,
     clients_estimate, message, user_id)
  VALUES (btrim(p_full_name), v_email, NULLIF(btrim(COALESCE(p_phone, '')), ''), v_company, v_reg_no, v_reg_country,
          v_country, p_partner_type, v_products, p_clients_estimate, NULLIF(btrim(COALESCE(p_message, '')), ''), auth.uid())
  RETURNING id INTO v_id;

  PERFORM public.ican_franchise_audit('enquiry_received', 'enquiry', v_id::TEXT,
    jsonb_build_object('country', v_country, 'type', p_partner_type));
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

-- ============================================================================
-- 7. HQ ADMIN RPCs (every one begins with ican_franchise_require_admin())
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ican_franchise_admin_overview()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.ican_franchise_settings;
BEGIN
  PERFORM public.ican_franchise_require_admin();
  SELECT * INTO s FROM public.ican_franchise_settings WHERE id;
  RETURN jsonb_build_object(
    'settings', to_jsonb(s),
    'partners', jsonb_build_object(
      'applied',    (SELECT COUNT(*) FROM public.ican_franchise_partners WHERE status = 'applied'),
      'approved',   (SELECT COUNT(*) FROM public.ican_franchise_partners WHERE status = 'approved'),
      'active',     (SELECT COUNT(*) FROM public.ican_franchise_partners WHERE status = 'active'),
      'suspended',  (SELECT COUNT(*) FROM public.ican_franchise_partners WHERE status = 'suspended'),
      'masters',    (SELECT COUNT(*) FROM public.ican_franchise_partners WHERE partner_type = 'country_master' AND status = 'active'),
      'agencies',   (SELECT COUNT(*) FROM public.ican_franchise_partners WHERE partner_type = 'agency' AND status = 'active'),
      'referrals',  (SELECT COUNT(*) FROM public.ican_franchise_partners WHERE partner_type = 'referral' AND status = 'active')),
    'assigned_accounts', (SELECT COUNT(*) FROM public.ican_franchise_customer_assignments WHERE status = 'active'),
    'liability', jsonb_build_object(
      'accrued_ican',     COALESCE((SELECT SUM(amount_ican) FROM public.ican_franchise_payable_lines WHERE status = 'accrued'), 0),
      'statemented_ican', COALESCE((SELECT SUM(amount_ican) FROM public.ican_franchise_payable_lines WHERE status = 'statemented'), 0),
      'paid_ican',        COALESCE((SELECT SUM(amount_ican) FROM public.ican_franchise_payable_lines WHERE status = 'paid'), 0)),
    'last_30d', jsonb_build_object(
      'events',       (SELECT COUNT(*) FROM public.ican_franchise_revenue_events WHERE voided_at IS NULL AND created_at > now() - INTERVAL '30 days'),
      'gross_ican',   COALESCE((SELECT SUM(gross_ican)  FROM public.ican_franchise_revenue_events WHERE voided_at IS NULL AND created_at > now() - INTERVAL '30 days'), 0),
      'hq_ican',      COALESCE((SELECT SUM(hq_ican)     FROM public.ican_franchise_revenue_events WHERE voided_at IS NULL AND created_at > now() - INTERVAL '30 days'), 0),
      'master_ican',  COALESCE((SELECT SUM(master_ican) FROM public.ican_franchise_revenue_events WHERE voided_at IS NULL AND created_at > now() - INTERVAL '30 days'), 0),
      'agency_ican',  COALESCE((SELECT SUM(agency_ican) FROM public.ican_franchise_revenue_events WHERE voided_at IS NULL AND created_at > now() - INTERVAL '30 days'), 0)),
    'by_country_30d', COALESCE((SELECT jsonb_agg(x ORDER BY (x ->> 'gross_ican')::NUMERIC DESC) FROM (
        SELECT jsonb_build_object('country_code', COALESCE(country_code, '??'), 'gross_ican', SUM(gross_ican),
                                  'hq_ican', SUM(hq_ican), 'partners_ican', SUM(master_ican + agency_ican)) AS x
          FROM public.ican_franchise_revenue_events
         WHERE voided_at IS NULL AND created_at > now() - INTERVAL '30 days' GROUP BY country_code) t), '[]'::JSONB),
    'by_stream_30d', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('stream', stream, 'gross_ican', SUM(gross_ican), 'events', COUNT(*)) AS x
          FROM public.ican_franchise_revenue_events
         WHERE voided_at IS NULL AND created_at > now() - INTERVAL '30 days' GROUP BY stream) t), '[]'::JSONB),
    'demand_gaps', COALESCE((SELECT jsonb_agg(x ORDER BY (x ->> 'gross_ican')::NUMERIC DESC) FROM (
        SELECT jsonb_build_object('country_code', d.country_code, 'stream', d.stream, 'events', SUM(d.events),
                                  'gross_ican', SUM(d.gross_ican)) AS x
          FROM public.ican_franchise_demand_signals d
         WHERE d.month >= (date_trunc('month', now()) - INTERVAL '3 months')::DATE
         GROUP BY d.country_code, d.stream ORDER BY SUM(d.gross_ican) DESC LIMIT 15) t), '[]'::JSONB),
    'open_errors', (SELECT COUNT(*) FROM public.ican_franchise_allocation_errors WHERE NOT resolved),
    'enquiries_new', (SELECT COUNT(*) FROM public.ican_franchise_enquiries WHERE status = 'new'),
    'companies_to_verify', (SELECT COUNT(*) FROM public.ican_franchise_partners WHERE company_status = 'pending' AND status IN ('applied', 'approved'))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ican_franchise_admin_list_partners(
  p_status TEXT DEFAULT NULL, p_type TEXT DEFAULT NULL, p_country TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  PERFORM public.ican_franchise_require_admin();
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(p) || jsonb_build_object(
             'owner_email', u.email,
             'parent_name', par.display_name,
             'active_accounts', CASE WHEN p.partner_type = 'agency' THEN public.ican_franchise_active_accounts(p.id) ELSE NULL END,
             'assigned_accounts', (SELECT COUNT(*) FROM public.ican_franchise_customer_assignments a WHERE a.partner_id = p.id AND a.status = 'active'),
             'accrued_ican', COALESCE((SELECT SUM(amount_ican) FROM public.ican_franchise_payable_lines l WHERE l.partner_id = p.id AND l.status IN ('accrued', 'statemented')), 0),
             'hq_royalty_12m_ican', COALESCE((SELECT SUM(hq_ican) FROM public.ican_franchise_revenue_events e
                                               WHERE e.master_partner_id = p.id AND e.voided_at IS NULL AND e.created_at > now() - INTERVAL '12 months'), 0))
           ORDER BY p.created_at DESC)
      FROM public.ican_franchise_partners p
      LEFT JOIN auth.users u ON u.id = p.owner_user_id
      LEFT JOIN public.ican_franchise_partners par ON par.id = p.parent_partner_id
     WHERE (p_status IS NULL OR p.status = p_status)
       AND (p_type IS NULL OR p.partner_type = p_type)
       AND (p_country IS NULL OR p.country_code = upper(p_country))), '[]'::JSONB);
END;
$$;

-- Create a partner on HQ's initiative (a signed deal) or edit one. Whitelisted fields only.
-- Setting company_status to 'verified' stamps who verified the registration and when.
CREATE OR REPLACE FUNCTION public.ican_franchise_admin_save_partner(p_partner_id UUID, p_patch JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_row public.ican_franchise_partners; v_owner UUID; v_email TEXT; v_old_company TEXT;
BEGIN
  PERFORM public.ican_franchise_require_admin();
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'patch must be an object'; END IF;

  v_email := NULLIF(btrim(p_patch ->> 'owner_email'), '');
  IF v_email IS NOT NULL THEN
    SELECT id INTO v_owner FROM auth.users WHERE lower(email) = lower(v_email) LIMIT 1;
    IF v_owner IS NULL THEN RAISE EXCEPTION 'No account has the email %', v_email; END IF;
  END IF;

  IF p_partner_id IS NULL THEN
    IF COALESCE(btrim(p_patch ->> 'company_name'), '') = '' OR COALESCE(btrim(p_patch ->> 'company_reg_number'), '') = '' THEN
      RAISE EXCEPTION 'A partner must be a registered company: company_name and company_reg_number are required';
    END IF;
    INSERT INTO public.ican_franchise_partners
      (partner_code, partner_type, country_code, display_name, company_name, company_reg_number, company_reg_country,
       owner_user_id, parent_partner_id, status)
    VALUES ('', p_patch ->> 'partner_type', upper(p_patch ->> 'country_code'),
            left(COALESCE(NULLIF(btrim(p_patch ->> 'display_name'), ''), btrim(p_patch ->> 'company_name')), 120),
            btrim(p_patch ->> 'company_name'), btrim(p_patch ->> 'company_reg_number'),
            upper(COALESCE(NULLIF(p_patch ->> 'company_reg_country', ''), p_patch ->> 'country_code')),
            v_owner, NULLIF(p_patch ->> 'parent_partner_id', '')::UUID, 'approved')
    RETURNING * INTO v_row;
    p_partner_id := v_row.id;
  END IF;

  UPDATE public.ican_franchise_partners p SET
    display_name            = COALESCE(NULLIF(btrim(p_patch ->> 'display_name'), ''), p.display_name),
    company_name            = COALESCE(NULLIF(btrim(p_patch ->> 'company_name'), ''), p.company_name),
    company_reg_number      = COALESCE(NULLIF(btrim(p_patch ->> 'company_reg_number'), ''), p.company_reg_number),
    company_reg_country     = COALESCE(NULLIF(btrim(p_patch ->> 'company_reg_country'), ''), p.company_reg_country),
    company_document_url    = CASE WHEN p_patch ? 'company_document_url' THEN NULLIF(btrim(p_patch ->> 'company_document_url'), '') ELSE p.company_document_url END,
    company_status          = COALESCE(NULLIF(p_patch ->> 'company_status', ''), p.company_status),
    company_verified_at     = CASE WHEN p_patch ->> 'company_status' = 'verified' AND p.company_status <> 'verified' THEN now()
                                   WHEN p_patch ->> 'company_status' IN ('pending', 'rejected') THEN NULL ELSE p.company_verified_at END,
    company_verified_by     = CASE WHEN p_patch ->> 'company_status' = 'verified' AND p.company_status <> 'verified' THEN auth.uid()
                                   WHEN p_patch ->> 'company_status' IN ('pending', 'rejected') THEN NULL ELSE p.company_verified_by END,
    region                  = CASE WHEN p_patch ? 'region' THEN NULLIF(btrim(p_patch ->> 'region'), '') ELSE p.region END,
    owner_user_id           = COALESCE(v_owner, p.owner_user_id),
    business_profile_id     = CASE WHEN p_patch ? 'business_profile_id' THEN NULLIF(p_patch ->> 'business_profile_id', '')::UUID ELSE p.business_profile_id END,
    parent_partner_id       = CASE WHEN p_patch ? 'parent_partner_id' THEN NULLIF(p_patch ->> 'parent_partner_id', '')::UUID ELSE p.parent_partner_id END,
    products                = CASE WHEN p_patch ? 'products' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch -> 'products')) ELSE p.products END,
    exclusive               = COALESCE((p_patch ->> 'exclusive')::BOOLEAN, p.exclusive),
    share_adjust_pts        = COALESCE((p_patch ->> 'share_adjust_pts')::NUMERIC, p.share_adjust_pts),
    upfront_fee_ican        = COALESCE((p_patch ->> 'upfront_fee_ican')::NUMERIC, p.upfront_fee_ican),
    upfront_fee_paid_at     = CASE WHEN p_patch ? 'upfront_fee_paid_at' THEN NULLIF(p_patch ->> 'upfront_fee_paid_at', '')::TIMESTAMPTZ ELSE p.upfront_fee_paid_at END,
    min_annual_royalty_ican = COALESCE((p_patch ->> 'min_annual_royalty_ican')::NUMERIC, p.min_annual_royalty_ican),
    contract_start          = CASE WHEN p_patch ? 'contract_start' THEN NULLIF(p_patch ->> 'contract_start', '')::DATE ELSE p.contract_start END,
    contract_end            = CASE WHEN p_patch ? 'contract_end' THEN NULLIF(p_patch ->> 'contract_end', '')::DATE ELSE p.contract_end END,
    referral_window_months  = COALESCE((p_patch ->> 'referral_window_months')::INT, p.referral_window_months),
    kyc_status              = COALESCE(NULLIF(p_patch ->> 'kyc_status', ''), p.kyc_status),
    notes                   = CASE WHEN p_patch ? 'notes' THEN left(p_patch ->> 'notes', 2000) ELSE p.notes END
  WHERE p.id = p_partner_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Partner not found'; END IF;

  PERFORM public.ican_franchise_audit('partner_saved', 'partner', p_partner_id::TEXT, p_patch);
  RETURN to_jsonb(v_row);
END;
$$;

-- applied -> approved -> active, suspend/resume, terminate. Going active needs KYC verified.
CREATE OR REPLACE FUNCTION public.ican_franchise_admin_set_status(p_partner_id UUID, p_status TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.ican_franchise_partners;
BEGIN
  PERFORM public.ican_franchise_require_admin();
  IF p_status NOT IN ('approved', 'active', 'suspended', 'terminated') THEN RAISE EXCEPTION 'Unsupported status %', p_status; END IF;
  SELECT * INTO v_row FROM public.ican_franchise_partners WHERE id = p_partner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Partner not found'; END IF;
  IF p_status = 'active' AND v_row.kyc_status <> 'verified' THEN
    RAISE EXCEPTION 'KYC must be verified before a partner can go active';
  END IF;
  IF p_status = 'active' AND v_row.company_status <> 'verified' THEN
    RAISE EXCEPTION 'The company registration must be verified before a partner can go active';
  END IF;
  IF p_status = 'terminated' THEN
    RAISE EXCEPTION 'Use ican_franchise_admin_terminate_partner so the partner''s customers are reassigned';
  END IF;

  UPDATE public.ican_franchise_partners
     SET status = p_status,
         approved_by = CASE WHEN p_status IN ('approved', 'active') AND approved_by IS NULL THEN auth.uid() ELSE approved_by END,
         approved_at = CASE WHEN p_status IN ('approved', 'active') AND approved_at IS NULL THEN now() ELSE approved_at END,
         contract_start = CASE WHEN p_status = 'active' AND contract_start IS NULL THEN CURRENT_DATE ELSE contract_start END,
         notes = CASE WHEN p_note IS NOT NULL THEN left(p_note, 2000) ELSE notes END
   WHERE id = p_partner_id RETURNING * INTO v_row;

  PERFORM public.ican_franchise_audit('partner_status', 'partner', p_partner_id::TEXT, jsonb_build_object('status', p_status, 'note', p_note));
  RETURN to_jsonb(v_row);
END;
$$;

-- Terminate a partner. Its customers are never orphaned: they move to p_reassign_to
-- (another active partner in the same country) or fall back to the HQ / country-master pool.
CREATE OR REPLACE FUNCTION public.ican_franchise_admin_terminate_partner(
  p_partner_id UUID, p_reassign_to UUID DEFAULT NULL, p_reason TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_p public.ican_franchise_partners; v_t public.ican_franchise_partners; v_moved INT := 0; v_children INT := 0;
BEGIN
  PERFORM public.ican_franchise_require_admin();
  SELECT * INTO v_p FROM public.ican_franchise_partners WHERE id = p_partner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Partner not found'; END IF;
  IF v_p.status = 'terminated' THEN RAISE EXCEPTION 'Partner is already terminated'; END IF;

  IF p_reassign_to IS NOT NULL THEN
    SELECT * INTO v_t FROM public.ican_franchise_partners WHERE id = p_reassign_to;
    IF NOT FOUND OR v_t.status <> 'active' OR v_t.country_code <> v_p.country_code OR v_t.partner_type = 'country_master' THEN
      RAISE EXCEPTION 'Reassign target must be an active agency/referral partner in %', v_p.country_code;
    END IF;
  END IF;

  -- Customers: move them, or end the link so fees fall back to the country master / HQ.
  WITH moved AS (
    UPDATE public.ican_franchise_customer_assignments
       SET status = 'ended', ended_at = now(), end_reason = 'partner_terminated'
     WHERE partner_id = p_partner_id AND status = 'active'
    RETURNING business_profile_id, user_id, country_code)
  INSERT INTO public.ican_franchise_customer_assignments (business_profile_id, user_id, partner_id, country_code, source)
  SELECT business_profile_id, user_id, p_reassign_to, country_code, 'reassigned' FROM moved WHERE p_reassign_to IS NOT NULL;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  -- Agencies under a terminated master keep operating directly under HQ until HQ re-parents them.
  UPDATE public.ican_franchise_partners SET parent_partner_id = NULL WHERE parent_partner_id = p_partner_id;
  GET DIAGNOSTICS v_children = ROW_COUNT;

  UPDATE public.ican_franchise_partners
     SET status = 'terminated', terminated_at = now(),
         notes = COALESCE(left(p_reason, 2000), notes)
   WHERE id = p_partner_id;

  PERFORM public.ican_franchise_audit('partner_terminated', 'partner', p_partner_id::TEXT,
    jsonb_build_object('reassign_to', p_reassign_to, 'customers_moved', v_moved, 'agencies_detached', v_children, 'reason', p_reason));
  RETURN jsonb_build_object('terminated', true, 'customers_moved', v_moved, 'agencies_detached', v_children);
END;
$$;

CREATE OR REPLACE FUNCTION public.ican_franchise_admin_assign_customer(
  p_business_profile_id UUID, p_partner_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_p public.ican_franchise_partners; v_id UUID; v_owner UUID;
BEGIN
  PERFORM public.ican_franchise_require_admin();
  IF p_partner_id IS NOT NULL THEN
    SELECT * INTO v_p FROM public.ican_franchise_partners WHERE id = p_partner_id;
    IF NOT FOUND OR v_p.status <> 'active' OR v_p.partner_type = 'country_master' THEN
      RAISE EXCEPTION 'Target must be an active agency or referral partner';
    END IF;
  END IF;
  SELECT user_id INTO v_owner FROM public.business_profiles WHERE id = p_business_profile_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Business not found'; END IF;

  UPDATE public.ican_franchise_customer_assignments
     SET status = 'ended', ended_at = now(), end_reason = 'hq_reassigned'
   WHERE business_profile_id = p_business_profile_id AND status = 'active';

  IF p_partner_id IS NULL THEN
    RETURN jsonb_build_object('assigned', false, 'note', 'Customer returned to the country master / HQ pool');
  END IF;
  INSERT INTO public.ican_franchise_customer_assignments (business_profile_id, user_id, partner_id, country_code, source)
  VALUES (p_business_profile_id, v_owner, p_partner_id, v_p.country_code, 'hq_assigned') RETURNING id INTO v_id;

  PERFORM public.ican_franchise_audit('customer_assigned', 'assignment', v_id::TEXT,
    jsonb_build_object('partner', p_partner_id, 'business', p_business_profile_id));
  RETURN jsonb_build_object('assigned', true, 'assignment_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.ican_franchise_admin_save_territory(
  p_country TEXT, p_name TEXT DEFAULT NULL, p_tier INTEGER DEFAULT NULL, p_status TEXT DEFAULT NULL,
  p_currency TEXT DEFAULT NULL, p_notes TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code VARCHAR := upper(btrim(COALESCE(p_country, ''))); v_row public.ican_franchise_territories;
BEGIN
  PERFORM public.ican_franchise_require_admin();
  IF length(v_code) <> 2 THEN RAISE EXCEPTION 'Country must be a 2-letter ISO code'; END IF;
  INSERT INTO public.ican_franchise_territories (country_code, country_name, tier, status, currency, notes)
  VALUES (v_code, COALESCE(NULLIF(btrim(p_name), ''), v_code), COALESCE(p_tier, 2), COALESCE(p_status, 'open'),
          NULLIF(btrim(p_currency), ''), p_notes)
  ON CONFLICT (country_code) DO UPDATE SET
    country_name = COALESCE(NULLIF(btrim(p_name), ''), ican_franchise_territories.country_name),
    tier         = COALESCE(p_tier, ican_franchise_territories.tier),
    status       = COALESCE(p_status, ican_franchise_territories.status),
    currency     = COALESCE(NULLIF(btrim(p_currency), ''), ican_franchise_territories.currency),
    notes        = COALESCE(p_notes, ican_franchise_territories.notes),
    updated_at   = now()
  RETURNING * INTO v_row;
  PERFORM public.ican_franchise_audit('territory_saved', 'territory', v_code,
    jsonb_build_object('tier', p_tier, 'status', p_status));
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.ican_franchise_admin_save_rule(
  p_stream TEXT, p_structure TEXT, p_agency_tier TEXT,
  p_hq_pct NUMERIC, p_master_pct NUMERIC, p_agency_pct NUMERIC,
  p_active BOOLEAN DEFAULT TRUE, p_note TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.ican_franchise_split_rules;
BEGIN
  PERFORM public.ican_franchise_require_admin();
  IF ROUND(COALESCE(p_hq_pct, 0) + COALESCE(p_master_pct, 0) + COALESCE(p_agency_pct, 0), 3) <> 100 THEN
    RAISE EXCEPTION 'HQ + master + agency must add up to exactly 100 (got %)',
      COALESCE(p_hq_pct, 0) + COALESCE(p_master_pct, 0) + COALESCE(p_agency_pct, 0);
  END IF;
  INSERT INTO public.ican_franchise_split_rules (stream, structure, agency_tier, hq_pct, master_pct, agency_pct, active, note)
  VALUES (p_stream, p_structure, COALESCE(p_agency_tier, 'any'), p_hq_pct, p_master_pct, p_agency_pct, COALESCE(p_active, TRUE), p_note)
  ON CONFLICT (stream, structure, agency_tier) DO UPDATE SET
    hq_pct = EXCLUDED.hq_pct, master_pct = EXCLUDED.master_pct, agency_pct = EXCLUDED.agency_pct,
    active = EXCLUDED.active, note = COALESCE(EXCLUDED.note, ican_franchise_split_rules.note), updated_at = now()
  RETURNING * INTO v_row;
  PERFORM public.ican_franchise_audit('rule_saved', 'rule', v_row.id::TEXT, to_jsonb(v_row));
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.ican_franchise_admin_save_settings(p_patch JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.ican_franchise_settings;
BEGIN
  PERFORM public.ican_franchise_require_admin();
  UPDATE public.ican_franchise_settings SET
    enabled               = COALESCE((p_patch ->> 'enabled')::BOOLEAN, enabled),
    silver_min_accounts   = COALESCE((p_patch ->> 'silver_min_accounts')::INT, silver_min_accounts),
    gold_min_accounts     = COALESCE((p_patch ->> 'gold_min_accounts')::INT, gold_min_accounts),
    platinum_min_accounts = COALESCE((p_patch ->> 'platinum_min_accounts')::INT, platinum_min_accounts),
    active_window_days    = COALESCE((p_patch ->> 'active_window_days')::INT, active_window_days),
    hq_share_floor_pct    = COALESCE((p_patch ->> 'hq_share_floor_pct')::NUMERIC, hq_share_floor_pct),
    max_kicker_pts        = COALESCE((p_patch ->> 'max_kicker_pts')::NUMERIC, max_kicker_pts),
    max_penalty_pts       = COALESCE((p_patch ->> 'max_penalty_pts')::NUMERIC, max_penalty_pts),
    share_wallet_fees     = COALESCE((p_patch ->> 'share_wallet_fees')::BOOLEAN, share_wallet_fees),
    updated_by = auth.uid(), updated_at = now()
  WHERE id RETURNING * INTO v_row;
  PERFORM public.ican_franchise_audit('settings_saved', 'settings', 'singleton', p_patch);
  RETURN to_jsonb(v_row);
END;
$$;

-- Statements ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ican_franchise_admin_generate_statements(p_start DATE, p_end DATE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; v_id UUID; v_made INT := 0; v_total NUMERIC := 0;
BEGIN
  PERFORM public.ican_franchise_require_admin();
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN RAISE EXCEPTION 'Choose a valid period'; END IF;

  -- Partners whose net accrued total is zero or negative (a clawback bigger than new
  -- earnings) are skipped: their lines stay accrued and carry into a later statement.
  FOR r IN
    SELECT l.partner_id, SUM(l.amount_ican) AS total, COUNT(*) AS n
      FROM public.ican_franchise_payable_lines l
     WHERE l.status = 'accrued' AND l.created_at >= p_start AND l.created_at < (p_end + 1)
     GROUP BY l.partner_id HAVING SUM(l.amount_ican) > 0
  LOOP
    INSERT INTO public.ican_franchise_statements (partner_id, period_start, period_end, total_ican, line_count)
    VALUES (r.partner_id, p_start, p_end, r.total, r.n) RETURNING id INTO v_id;

    UPDATE public.ican_franchise_payable_lines
       SET status = 'statemented', statement_id = v_id
     WHERE partner_id = r.partner_id AND status = 'accrued'
       AND created_at >= p_start AND created_at < (p_end + 1);

    v_made := v_made + 1; v_total := v_total + r.total;
  END LOOP;

  PERFORM public.ican_franchise_audit('statements_generated', 'statement', NULL,
    jsonb_build_object('period_start', p_start, 'period_end', p_end, 'statements', v_made, 'total_ican', v_total));
  RETURN jsonb_build_object('statements', v_made, 'total_ican', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.ican_franchise_admin_approve_statement(p_statement_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.ican_franchise_statements;
BEGIN
  PERFORM public.ican_franchise_require_admin();
  UPDATE public.ican_franchise_statements
     SET status = 'approved', approved_by = auth.uid(), approved_at = now()
   WHERE id = p_statement_id AND status = 'draft' RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a draft statement can be approved'; END IF;
  PERFORM public.ican_franchise_audit('statement_approved', 'statement', p_statement_id::TEXT, '{}'::JSONB);
  RETURN to_jsonb(v_row);
END;
$$;

-- Record that HQ has actually sent the money, with the external transfer reference.
-- Idempotent: only an 'approved' statement can be marked paid, and a reference is single-use.
CREATE OR REPLACE FUNCTION public.ican_franchise_admin_mark_statement_paid(p_statement_id UUID, p_reference TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.ican_franchise_statements;
BEGIN
  PERFORM public.ican_franchise_require_admin();
  IF p_reference IS NULL OR length(btrim(p_reference)) < 4 THEN
    RAISE EXCEPTION 'Enter the transfer reference (at least 4 characters) so the payment can be traced';
  END IF;
  UPDATE public.ican_franchise_statements
     SET status = 'paid', payment_reference = btrim(p_reference), paid_by = auth.uid(), paid_at = now()
   WHERE id = p_statement_id AND status = 'approved' RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only an approved statement can be marked paid'; END IF;
  UPDATE public.ican_franchise_payable_lines SET status = 'paid' WHERE statement_id = p_statement_id AND status = 'statemented';
  PERFORM public.ican_franchise_audit('statement_paid', 'statement', p_statement_id::TEXT,
    jsonb_build_object('reference', btrim(p_reference), 'total_ican', v_row.total_ican));
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.ican_franchise_admin_void_statement(p_statement_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.ican_franchise_statements;
BEGIN
  PERFORM public.ican_franchise_require_admin();
  UPDATE public.ican_franchise_statements SET status = 'void'
   WHERE id = p_statement_id AND status IN ('draft', 'approved') RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a draft or approved statement can be voided (a paid one cannot)'; END IF;
  UPDATE public.ican_franchise_payable_lines SET status = 'accrued', statement_id = NULL
   WHERE statement_id = p_statement_id AND status = 'statemented';
  PERFORM public.ican_franchise_audit('statement_voided', 'statement', p_statement_id::TEXT, '{}'::JSONB);
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.ican_franchise_admin_list_statements(p_status TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 100)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ican_franchise_require_admin();
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC) FROM (
      SELECT st.*, p.display_name AS partner_name, p.partner_code, p.country_code
        FROM public.ican_franchise_statements st
        JOIN public.ican_franchise_partners p ON p.id = st.partner_id
       WHERE (p_status IS NULL OR st.status = p_status)
       ORDER BY st.created_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)) t), '[]'::JSONB);
END;
$$;

-- Manually void one allocation (e.g. a fee later refunded outside the normal reversal path).
CREATE OR REPLACE FUNCTION public.ican_franchise_admin_void_event(p_event_id UUID, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.ican_franchise_revenue_events; v_res JSONB;
BEGIN
  PERFORM public.ican_franchise_require_admin();
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT * INTO e FROM public.ican_franchise_revenue_events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;
  v_res := public.ican_franchise_reverse(e.source_app, e.source_reference, p_reason);
  PERFORM public.ican_franchise_audit('event_voided', 'event', p_event_id::TEXT, jsonb_build_object('reason', p_reason) || v_res);
  RETURN v_res;
END;
$$;

-- Re-run allocations that failed (each is idempotent, so retrying is always safe).
CREATE OR REPLACE FUNCTION public.ican_franchise_admin_retry_errors()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; v_ok INT := 0; v_fail INT := 0; st public.ican_business_wallet_settlements;
BEGIN
  PERFORM public.ican_franchise_require_admin();
  IF to_regclass('public.ican_business_wallet_settlements') IS NULL THEN RAISE EXCEPTION 'Settlements table is missing'; END IF;
  FOR r IN SELECT * FROM public.ican_franchise_allocation_errors WHERE NOT resolved ORDER BY id LIMIT 500 LOOP
    BEGIN
      IF r.kind = 'allocate' THEN
        SELECT * INTO st FROM public.ican_business_wallet_settlements
         WHERE source_app = r.source_app AND source_reference = r.source_reference AND settlement_type = 'platform_fee';
        IF FOUND THEN
          PERFORM public.ican_franchise_allocate(st.source_app, st.source_reference, st.amount_ican,
            st.metadata ->> 'fee_type', st.settled_by, st.id, COALESCE(st.metadata, '{}'::JSONB));
        END IF;
      ELSE
        PERFORM public.ican_franchise_reverse(r.source_app, r.source_reference, 'retry');
      END IF;
      UPDATE public.ican_franchise_allocation_errors SET resolved = true WHERE id = r.id;
      v_ok := v_ok + 1;
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail + 1;
    END;
  END LOOP;
  RETURN jsonb_build_object('resolved', v_ok, 'still_failing', v_fail);
END;
$$;

-- Pick up fees credited BEFORE this migration (or while it was off): allocates any
-- 'platform_fee' settlement from p_since that has no franchise event yet. Idempotent.
CREATE OR REPLACE FUNCTION public.ican_franchise_admin_backfill(p_since TIMESTAMPTZ DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st public.ican_business_wallet_settlements; v_n INT := 0; v_alloc INT := 0; v_res JSONB;
BEGIN
  PERFORM public.ican_franchise_require_admin();
  IF to_regclass('public.ican_business_wallet_settlements') IS NULL THEN RAISE EXCEPTION 'Settlements table is missing'; END IF;
  FOR st IN
    SELECT s.* FROM public.ican_business_wallet_settlements s
     WHERE s.settlement_type = 'platform_fee'
       AND s.settled_at >= COALESCE(p_since, now() - INTERVAL '30 days')
       AND NOT EXISTS (SELECT 1 FROM public.ican_franchise_revenue_events e WHERE e.source_app = s.source_app AND e.source_reference = s.source_reference)
       AND NOT EXISTS (SELECT 1 FROM public.ican_business_wallet_settlements rv
                        WHERE rv.settlement_type = 'platform_fee_reversal' AND rv.source_app = s.source_app AND rv.metadata ->> 'reverses' = s.source_reference)
     ORDER BY s.settled_at
     LIMIT 5000
  LOOP
    v_n := v_n + 1;
    v_res := public.ican_franchise_allocate(st.source_app, st.source_reference, st.amount_ican,
               st.metadata ->> 'fee_type', st.settled_by, st.id, COALESCE(st.metadata, '{}'::JSONB));
    IF (v_res ->> 'allocated')::BOOLEAN THEN v_alloc := v_alloc + 1; END IF;
  END LOOP;
  PERFORM public.ican_franchise_audit('backfill', 'settlements', NULL, jsonb_build_object('scanned', v_n, 'allocated', v_alloc));
  RETURN jsonb_build_object('scanned', v_n, 'allocated', v_alloc);
END;
$$;

-- Enquiries: the developer's inbox for landing-page requests ----------------------------
CREATE OR REPLACE FUNCTION public.ican_franchise_admin_list_enquiries(p_status TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 200)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  PERFORM public.ican_franchise_require_admin();
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC) FROM (
      SELECT q.*,
             EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = lower(q.email)) AS has_account,
             (SELECT tr.status FROM public.ican_franchise_territories tr WHERE tr.country_code = q.country_code) AS territory_status
        FROM public.ican_franchise_enquiries q
       WHERE (p_status IS NULL OR q.status = p_status)
       ORDER BY q.created_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500)) t), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.ican_franchise_admin_set_enquiry_status(p_id UUID, p_status TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.ican_franchise_enquiries;
BEGIN
  PERFORM public.ican_franchise_require_admin();
  IF p_status NOT IN ('new', 'contacted', 'declined', 'spam') THEN
    RAISE EXCEPTION 'Use convert to turn a request into a partner application';
  END IF;
  UPDATE public.ican_franchise_enquiries
     SET status = p_status, admin_note = CASE WHEN p_note IS NOT NULL THEN left(p_note, 1000) ELSE admin_note END,
         handled_by = auth.uid(), handled_at = now()
   WHERE id = p_id AND status <> 'converted' RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found, or already converted'; END IF;
  PERFORM public.ican_franchise_audit('enquiry_status', 'enquiry', p_id::TEXT, jsonb_build_object('status', p_status));
  RETURN to_jsonb(v_row);
END;
$$;

-- Turn a request into a real partner application (status 'applied') owned by the requester's
-- IcanEra account, carrying the company registration across; HQ then verifies it like any other.
CREATE OR REPLACE FUNCTION public.ican_franchise_admin_convert_enquiry(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE q public.ican_franchise_enquiries; v_owner UUID; v_pid UUID;
BEGIN
  PERFORM public.ican_franchise_require_admin();
  SELECT * INTO q FROM public.ican_franchise_enquiries WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF q.status = 'converted' THEN RAISE EXCEPTION 'This request has already been converted'; END IF;

  SELECT id INTO v_owner FROM auth.users WHERE lower(email) = lower(q.email) LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'No IcanEra account uses %. Ask them to sign up with that email, then convert this request.', q.email;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ican_franchise_territories WHERE country_code = q.country_code AND status <> 'paused') THEN
    RAISE EXCEPTION '% is paused for franchises. Un-pause it under Countries & rates, then convert this request.', q.country_code;
  END IF;

  BEGIN
    INSERT INTO public.ican_franchise_partners
      (partner_code, partner_type, country_code, display_name, company_name, company_reg_number, company_reg_country,
       owner_user_id, products, notes)
    VALUES ('', q.partner_type, q.country_code, left(q.company_name, 120), q.company_name, q.company_reg_number,
            q.company_reg_country, v_owner, q.products,
            left('From landing-page request. ' || COALESCE(q.message, ''), 1000))
    RETURNING id INTO v_pid;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'That account, or that company registration, already holds a % seat in %', q.partner_type, q.country_code;
  END;

  UPDATE public.ican_franchise_enquiries
     SET status = 'converted', converted_partner_id = v_pid, handled_by = auth.uid(), handled_at = now()
   WHERE id = p_id;
  PERFORM public.ican_franchise_audit('enquiry_converted', 'enquiry', p_id::TEXT, jsonb_build_object('partner_id', v_pid));
  RETURN jsonb_build_object('partner_id', v_pid);
END;
$$;

-- HQ admins (the allowlist; developers are admins by role and are not listed here) -------
CREATE OR REPLACE FUNCTION public.ican_franchise_admin_list_admins()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  PERFORM public.ican_franchise_require_admin();
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', a.user_id, 'email', u.email, 'note', a.note, 'added_at', a.added_at)
                                    ORDER BY a.added_at)
                     FROM public.ican_franchise_admins a LEFT JOIN auth.users u ON u.id = a.user_id), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.ican_franchise_admin_grant_admin(p_email TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_uid UUID;
BEGIN
  PERFORM public.ican_franchise_require_admin();
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = lower(btrim(COALESCE(p_email, ''))) LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No account has the email %', p_email; END IF;
  INSERT INTO public.ican_franchise_admins (user_id, note, added_by) VALUES (v_uid, left(p_note, 200), auth.uid())
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM public.ican_franchise_audit('admin_granted', 'admin', v_uid::TEXT, jsonb_build_object('email', p_email));
  RETURN jsonb_build_object('user_id', v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.ican_franchise_admin_revoke_admin(p_user_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INT;
BEGIN
  PERFORM public.ican_franchise_require_admin();
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'You cannot remove your own admin access'; END IF;
  DELETE FROM public.ican_franchise_admins WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN PERFORM public.ican_franchise_audit('admin_revoked', 'admin', p_user_id::TEXT, '{}'::JSONB); END IF;
  RETURN v_n > 0;
END;
$$;

-- ============================================================================
-- 8. ROW LEVEL SECURITY: read-only to the browser, scoped to the caller
-- ============================================================================

ALTER TABLE public.ican_franchise_settings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_franchise_territories          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_franchise_partners             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_franchise_split_rules          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_franchise_customer_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_franchise_revenue_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_franchise_payable_lines        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_franchise_statements           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_franchise_audit_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_franchise_allocation_errors    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_franchise_demand_signals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_franchise_enquiries            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_franchise_admins               ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ican_franchise_settings, public.ican_franchise_territories, public.ican_franchise_partners,
              public.ican_franchise_split_rules, public.ican_franchise_customer_assignments,
              public.ican_franchise_revenue_events, public.ican_franchise_payable_lines,
              public.ican_franchise_statements, public.ican_franchise_audit_log,
              public.ican_franchise_allocation_errors, public.ican_franchise_demand_signals,
              public.ican_franchise_enquiries, public.ican_franchise_admins
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ican_franchise_territories, public.ican_franchise_partners,
                public.ican_franchise_split_rules, public.ican_franchise_customer_assignments,
                public.ican_franchise_revenue_events, public.ican_franchise_payable_lines,
                public.ican_franchise_statements, public.ican_franchise_audit_log,
                public.ican_franchise_allocation_errors, public.ican_franchise_demand_signals,
                public.ican_franchise_enquiries
  TO authenticated;
-- ican_franchise_settings: no direct grant at all (read through ican_franchise_admin_overview()).

-- Open reference data: any signed-in user may see the territories and the rate card.
DROP POLICY IF EXISTS franchise_territories_read ON public.ican_franchise_territories;
CREATE POLICY franchise_territories_read ON public.ican_franchise_territories FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS franchise_rules_read ON public.ican_franchise_split_rules;
CREATE POLICY franchise_rules_read ON public.ican_franchise_split_rules FOR SELECT TO authenticated USING (active OR public.ican_franchise_is_hq_admin());

-- Partners: yours, your downline's (if you are a master), or everything for HQ.
DROP POLICY IF EXISTS franchise_partners_read ON public.ican_franchise_partners;
CREATE POLICY franchise_partners_read ON public.ican_franchise_partners FOR SELECT TO authenticated
  USING (id = ANY (public.ican_franchise_my_partner_ids())
         OR parent_partner_id = ANY (public.ican_franchise_my_partner_ids())
         OR public.ican_franchise_is_hq_admin());

DROP POLICY IF EXISTS franchise_assignments_read ON public.ican_franchise_customer_assignments;
CREATE POLICY franchise_assignments_read ON public.ican_franchise_customer_assignments FOR SELECT TO authenticated
  USING (partner_id = ANY (public.ican_franchise_my_partner_ids())
         OR partner_id = ANY (public.ican_franchise_downline_ids())
         OR business_profile_id = ANY (public.ican_franchise_my_business_ids())
         OR public.ican_franchise_is_hq_admin());

DROP POLICY IF EXISTS franchise_events_read ON public.ican_franchise_revenue_events;
CREATE POLICY franchise_events_read ON public.ican_franchise_revenue_events FOR SELECT TO authenticated
  USING (master_partner_id = ANY (public.ican_franchise_my_partner_ids())
         OR agency_partner_id = ANY (public.ican_franchise_my_partner_ids())
         OR public.ican_franchise_is_hq_admin());

DROP POLICY IF EXISTS franchise_lines_read ON public.ican_franchise_payable_lines;
CREATE POLICY franchise_lines_read ON public.ican_franchise_payable_lines FOR SELECT TO authenticated
  USING (partner_id = ANY (public.ican_franchise_my_partner_ids()) OR public.ican_franchise_is_hq_admin());

DROP POLICY IF EXISTS franchise_statements_read ON public.ican_franchise_statements;
CREATE POLICY franchise_statements_read ON public.ican_franchise_statements FOR SELECT TO authenticated
  USING (partner_id = ANY (public.ican_franchise_my_partner_ids()) OR public.ican_franchise_is_hq_admin());

DROP POLICY IF EXISTS franchise_audit_read ON public.ican_franchise_audit_log;
CREATE POLICY franchise_audit_read ON public.ican_franchise_audit_log FOR SELECT TO authenticated USING (public.ican_franchise_is_hq_admin());
DROP POLICY IF EXISTS franchise_errors_read ON public.ican_franchise_allocation_errors;
CREATE POLICY franchise_errors_read ON public.ican_franchise_allocation_errors FOR SELECT TO authenticated USING (public.ican_franchise_is_hq_admin());
DROP POLICY IF EXISTS franchise_demand_read ON public.ican_franchise_demand_signals;
CREATE POLICY franchise_demand_read ON public.ican_franchise_demand_signals FOR SELECT TO authenticated USING (public.ican_franchise_is_hq_admin());
-- A signed-in requester can follow their own request; HQ sees all.
DROP POLICY IF EXISTS franchise_enquiries_read ON public.ican_franchise_enquiries;
CREATE POLICY franchise_enquiries_read ON public.ican_franchise_enquiries FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.ican_franchise_is_hq_admin());

-- ============================================================================
-- 9. FUNCTION GRANTS
-- ============================================================================
-- Internal engine pieces and helpers: no browser access at all.
REVOKE ALL ON FUNCTION public.ican_franchise_allocate(TEXT, TEXT, NUMERIC, TEXT, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ican_franchise_reverse(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ican_franchise_on_fee_settlement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ican_franchise_audit(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ican_franchise_make_code(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ican_franchise_country_of(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ican_franchise_country_from_name(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ican_franchise_active_accounts(UUID) FROM PUBLIC, anon, authenticated;
-- Trigger bodies and pure helpers are only ever called from inside the engine.
REVOKE ALL ON FUNCTION public.ican_franchise_validate_partner() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ican_franchise_events_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ican_franchise_lines_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ican_franchise_stream_for(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ican_franchise_product_for(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ican_franchise_tier_for(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ican_franchise_allocate(TEXT, TEXT, NUMERIC, TEXT, UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.ican_franchise_reverse(TEXT, TEXT, TEXT) TO service_role;

-- Policy helpers must be callable by the role evaluating the policies.
REVOKE ALL ON FUNCTION public.ican_franchise_is_service() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ican_franchise_is_hq_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ican_franchise_require_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ican_franchise_my_partner_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ican_franchise_downline_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ican_franchise_my_business_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_franchise_is_service() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ican_franchise_is_hq_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ican_franchise_require_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ican_franchise_my_partner_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ican_franchise_downline_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ican_franchise_my_business_ids() TO authenticated, service_role;

-- Public RPCs: signed-in users only (admin RPCs re-check the developer role inside).
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'ican_franchise_apply(text,text,text,text,text,text,text,text,text[],uuid,text)',
    'ican_franchise_my_summary()',
    'ican_franchise_my_earnings(uuid,integer)',
    'ican_franchise_my_customers(uuid,integer)',
    'ican_franchise_claim_agency(text,uuid)',
    'ican_franchise_release_agency(uuid)',
    'ican_franchise_my_agency(uuid)',
    'ican_franchise_refresh_tiers()',
    'ican_franchise_admin_overview()',
    'ican_franchise_admin_list_partners(text,text,text)',
    'ican_franchise_admin_save_partner(uuid,jsonb)',
    'ican_franchise_admin_set_status(uuid,text,text)',
    'ican_franchise_admin_terminate_partner(uuid,uuid,text)',
    'ican_franchise_admin_assign_customer(uuid,uuid)',
    'ican_franchise_admin_save_territory(text,text,integer,text,text,text)',
    'ican_franchise_admin_save_rule(text,text,text,numeric,numeric,numeric,boolean,text)',
    'ican_franchise_admin_save_settings(jsonb)',
    'ican_franchise_admin_generate_statements(date,date)',
    'ican_franchise_admin_approve_statement(uuid)',
    'ican_franchise_admin_mark_statement_paid(uuid,text)',
    'ican_franchise_admin_void_statement(uuid)',
    'ican_franchise_admin_list_statements(text,integer)',
    'ican_franchise_admin_void_event(uuid,text)',
    'ican_franchise_admin_retry_errors()',
    'ican_franchise_admin_backfill(timestamptz)',
    'ican_franchise_admin_list_enquiries(text,integer)',
    'ican_franchise_admin_set_enquiry_status(uuid,text,text)',
    'ican_franchise_admin_convert_enquiry(uuid)',
    'ican_franchise_admin_list_admins()',
    'ican_franchise_admin_grant_admin(text,text)',
    'ican_franchise_admin_revoke_admin(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- The ONLY two things a visitor with no account may call: the landing page's read-only overview
-- and the validated, rate-limited request form.
REVOKE ALL ON FUNCTION public.ican_franchise_public_overview() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ican_franchise_submit_enquiry(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_franchise_public_overview() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ican_franchise_submit_enquiry(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, INTEGER, TEXT, TEXT) TO anon, authenticated, service_role;

-- ============================================================================
-- 10. SEED DATA: territories and the default rate card (all editable by HQ)
-- ============================================================================

INSERT INTO public.ican_franchise_territories (country_code, country_name, tier, status, currency) VALUES
  ('UG', 'Uganda',       2, 'active', 'UGX'),
  ('KE', 'Kenya',        2, 'open',   'KES'),
  ('TZ', 'Tanzania',     2, 'open',   'TZS'),
  ('RW', 'Rwanda',       2, 'open',   'RWF'),
  ('GH', 'Ghana',        2, 'open',   'GHS'),
  ('NG', 'Nigeria',      1, 'open',   'NGN'),
  ('ZA', 'South Africa', 1, 'open',   'ZAR'),
  ('EG', 'Egypt',        1, 'open',   'EGP')
ON CONFLICT (country_code) DO NOTHING;

-- Every country the app supports at sign-up (frontend/src/constants/countries.js, the app's single list of
-- countries): open to registered companies from day one. HQ only configures a country (tier, reserve, pause);
-- it never has to open one. frontend/tests/franchise.test.js fails if this list and that file drift apart.
-- The rows above keep their tier/status/currency (ON CONFLICT DO NOTHING).
INSERT INTO public.ican_franchise_territories (country_code, country_name) VALUES
  ('AF', 'Afghanistan'),
  ('AL', 'Albania'),
  ('DZ', 'Algeria'),
  ('AD', 'Andorra'),
  ('AO', 'Angola'),
  ('AG', 'Antigua and Barbuda'),
  ('AR', 'Argentina'),
  ('AM', 'Armenia'),
  ('AU', 'Australia'),
  ('AT', 'Austria'),
  ('AZ', 'Azerbaijan'),
  ('BS', 'Bahamas'),
  ('BH', 'Bahrain'),
  ('BD', 'Bangladesh'),
  ('BB', 'Barbados'),
  ('BY', 'Belarus'),
  ('BE', 'Belgium'),
  ('BZ', 'Belize'),
  ('BJ', 'Benin'),
  ('BT', 'Bhutan'),
  ('BO', 'Bolivia'),
  ('BA', 'Bosnia and Herzegovina'),
  ('BW', 'Botswana'),
  ('BR', 'Brazil'),
  ('BN', 'Brunei'),
  ('BG', 'Bulgaria'),
  ('BF', 'Burkina Faso'),
  ('BI', 'Burundi'),
  ('CV', 'Cabo Verde'),
  ('KH', 'Cambodia'),
  ('CM', 'Cameroon'),
  ('CA', 'Canada'),
  ('CF', 'Central African Republic'),
  ('TD', 'Chad'),
  ('CL', 'Chile'),
  ('CN', 'China'),
  ('CO', 'Colombia'),
  ('KM', 'Comoros'),
  ('CG', 'Congo (Congo-Brazzaville)'),
  ('CD', 'Congo (DRC)'),
  ('CR', 'Costa Rica'),
  ('CI', 'Cote d''Ivoire'),
  ('HR', 'Croatia'),
  ('CU', 'Cuba'),
  ('CY', 'Cyprus'),
  ('CZ', 'Czechia'),
  ('DK', 'Denmark'),
  ('DJ', 'Djibouti'),
  ('DM', 'Dominica'),
  ('DO', 'Dominican Republic'),
  ('EC', 'Ecuador'),
  ('EG', 'Egypt'),
  ('SV', 'El Salvador'),
  ('GQ', 'Equatorial Guinea'),
  ('ER', 'Eritrea'),
  ('EE', 'Estonia'),
  ('SZ', 'Eswatini'),
  ('ET', 'Ethiopia'),
  ('FJ', 'Fiji'),
  ('FI', 'Finland'),
  ('FR', 'France'),
  ('GA', 'Gabon'),
  ('GM', 'Gambia'),
  ('GE', 'Georgia'),
  ('DE', 'Germany'),
  ('GH', 'Ghana'),
  ('GR', 'Greece'),
  ('GD', 'Grenada'),
  ('GT', 'Guatemala'),
  ('GN', 'Guinea'),
  ('GW', 'Guinea-Bissau'),
  ('GY', 'Guyana'),
  ('HT', 'Haiti'),
  ('HN', 'Honduras'),
  ('HU', 'Hungary'),
  ('IS', 'Iceland'),
  ('IN', 'India'),
  ('ID', 'Indonesia'),
  ('IR', 'Iran'),
  ('IQ', 'Iraq'),
  ('IE', 'Ireland'),
  ('IL', 'Israel'),
  ('IT', 'Italy'),
  ('JM', 'Jamaica'),
  ('JP', 'Japan'),
  ('JO', 'Jordan'),
  ('KZ', 'Kazakhstan'),
  ('KE', 'Kenya'),
  ('KI', 'Kiribati'),
  ('KW', 'Kuwait'),
  ('KG', 'Kyrgyzstan'),
  ('LA', 'Laos'),
  ('LV', 'Latvia'),
  ('LB', 'Lebanon'),
  ('LS', 'Lesotho'),
  ('LR', 'Liberia'),
  ('LY', 'Libya'),
  ('LI', 'Liechtenstein'),
  ('LT', 'Lithuania'),
  ('LU', 'Luxembourg'),
  ('MG', 'Madagascar'),
  ('MW', 'Malawi'),
  ('MY', 'Malaysia'),
  ('MV', 'Maldives'),
  ('ML', 'Mali'),
  ('MT', 'Malta'),
  ('MR', 'Mauritania'),
  ('MU', 'Mauritius'),
  ('MX', 'Mexico'),
  ('MD', 'Moldova'),
  ('MC', 'Monaco'),
  ('MN', 'Mongolia'),
  ('ME', 'Montenegro'),
  ('MA', 'Morocco'),
  ('MZ', 'Mozambique'),
  ('MM', 'Myanmar'),
  ('NA', 'Namibia'),
  ('NP', 'Nepal'),
  ('NL', 'Netherlands'),
  ('NZ', 'New Zealand'),
  ('NI', 'Nicaragua'),
  ('NE', 'Niger'),
  ('NG', 'Nigeria'),
  ('MK', 'North Macedonia'),
  ('NO', 'Norway'),
  ('OM', 'Oman'),
  ('PK', 'Pakistan'),
  ('PA', 'Panama'),
  ('PG', 'Papua New Guinea'),
  ('PY', 'Paraguay'),
  ('PE', 'Peru'),
  ('PH', 'Philippines'),
  ('PL', 'Poland'),
  ('PT', 'Portugal'),
  ('QA', 'Qatar'),
  ('RO', 'Romania'),
  ('RU', 'Russia'),
  ('RW', 'Rwanda'),
  ('KN', 'Saint Kitts and Nevis'),
  ('LC', 'Saint Lucia'),
  ('VC', 'Saint Vincent and the Grenadines'),
  ('WS', 'Samoa'),
  ('SM', 'San Marino'),
  ('ST', 'Sao Tome and Principe'),
  ('SA', 'Saudi Arabia'),
  ('SN', 'Senegal'),
  ('RS', 'Serbia'),
  ('SC', 'Seychelles'),
  ('SL', 'Sierra Leone'),
  ('SG', 'Singapore'),
  ('SK', 'Slovakia'),
  ('SI', 'Slovenia'),
  ('SB', 'Solomon Islands'),
  ('SO', 'Somalia'),
  ('ZA', 'South Africa'),
  ('SS', 'South Sudan'),
  ('ES', 'Spain'),
  ('LK', 'Sri Lanka'),
  ('SD', 'Sudan'),
  ('SR', 'Suriname'),
  ('SE', 'Sweden'),
  ('CH', 'Switzerland'),
  ('SY', 'Syria'),
  ('TW', 'Taiwan'),
  ('TJ', 'Tajikistan'),
  ('TZ', 'Tanzania'),
  ('TH', 'Thailand'),
  ('TL', 'Timor-Leste'),
  ('TG', 'Togo'),
  ('TO', 'Tonga'),
  ('TT', 'Trinidad and Tobago'),
  ('TN', 'Tunisia'),
  ('TR', 'Turkey'),
  ('TM', 'Turkmenistan'),
  ('TV', 'Tuvalu'),
  ('UG', 'Uganda'),
  ('UA', 'Ukraine'),
  ('AE', 'United Arab Emirates'),
  ('GB', 'United Kingdom'),
  ('US', 'United States'),
  ('UY', 'Uruguay'),
  ('UZ', 'Uzbekistan'),
  ('VU', 'Vanuatu'),
  ('VA', 'Vatican City'),
  ('VE', 'Venezuela'),
  ('VN', 'Vietnam'),
  ('YE', 'Yemen'),
  ('ZM', 'Zambia'),
  ('ZW', 'Zimbabwe')
ON CONFLICT (country_code) DO NOTHING;

-- Rate card. agency_pct is the serving partner's share (agency or referral partner).
INSERT INTO public.ican_franchise_split_rules (stream, structure, agency_tier, hq_pct, master_pct, agency_pct, note) VALUES
  -- Software subscriptions (IcanEra core, corporate billing)
  ('subscription', 'with_master',   'silver',   40, 20, 40, 'Agency under a country master: override shrinks as the agency grows'),
  ('subscription', 'with_master',   'gold',     40, 15, 45, NULL),
  ('subscription', 'with_master',   'platinum', 40, 10, 50, NULL),
  ('subscription', 'master_direct', 'any',      40, 60,  0, 'Country master sells and serves directly'),
  ('subscription', 'hq_direct',     'silver',   60,  0, 40, 'No country master in the market: HQ carries the master''s work'),
  ('subscription', 'hq_direct',     'gold',     55,  0, 45, NULL),
  ('subscription', 'hq_direct',     'platinum', 50,  0, 50, NULL),
  ('subscription', 'referral',      'any',      80,  0, 20, 'Referral partner: share for referral_window_months, no support duty'),
  -- SupermarketEra platform / marketplace fees
  ('marketplace_fee', 'with_master',   'any',   30, 20, 50, NULL),
  ('marketplace_fee', 'master_direct', 'any',   30, 70,  0, NULL),
  ('marketplace_fee', 'hq_direct',     'any',   50,  0, 50, NULL),
  ('marketplace_fee', 'referral',      'any',   80,  0, 20, NULL),
  -- BodaGoEra ride commission: an operator licence held by a country master
  ('ride_commission', 'master_direct', 'any',   30, 70,  0, 'Licensed country operator carries permits, insurance, rider safety and liability')
ON CONFLICT (stream, structure, agency_tier) DO NOTHING;

-- ============================================================================
-- 11. SCHEDULE + RELOAD
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('ican-franchise-tiers', '15 2 * * *', 'SELECT public.ican_franchise_refresh_tiers()');
  ELSE
    RAISE NOTICE 'pg_cron is not enabled: schedule SELECT public.ican_franchise_refresh_tiers() daily to keep agency tiers current.';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not schedule the tier refresh (%). Run ican_franchise_refresh_tiers() daily by hand.', SQLERRM;
END $$;

COMMENT ON TABLE public.ican_franchise_revenue_events IS 'Append-only snapshot of one platform fee and how it was split between HQ, a country master and an agency.';
COMMENT ON TABLE public.ican_franchise_payable_lines  IS 'One payable amount per payee per revenue event. Negative lines are clawbacks of fees reversed after payout.';
COMMENT ON TABLE public.ican_franchise_split_rules    IS 'The franchise rate card: HQ / master / agency percentages per stream, structure and agency tier. Edited by HQ only.';

NOTIFY pgrst, 'reload schema';
