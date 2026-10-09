-- ============================================================================
-- ADD_INSURANCE_PLATFORM.sql — "IcanEra Cover": insurance companies on ICANera
-- ============================================================================
-- One shared backend for ICANera and BodaGoEra (same database). Insurance
-- companies register as ICANera businesses, publish plans, and sell them to
-- people, riders and businesses, who pay with their ICAN wallet, their
-- business wallet, or reward points. Everything is managed from the apps; the
-- insurer verification and programme settings live in the ICAN dev panel.
--
--   WHO              WHAT
--   Insurer          registers a business as an insurer (licence number + expiry),
--                    is VERIFIED from the dev panel, then publishes plans, sees
--                    policyholders and business clients, handles claims, chats with
--                    holders and reads the data each holder chose to share.
--   Person / rider   buys a plan for themselves. BodaGoEra riders see their cover on
--                    the live QR rider card.
--   Business         buys cover for the business itself or for its drivers (one
--                    payment, one policy per insured driver) from its business
--                    wallet, with the business-wallet PIN.
--
-- MONEY (follows the platform's fee rules, see ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql)
--   * The insurer sets the premium it TAKES HOME per period (premium_ican). That
--     number is final: the insurer is credited it in full, tithe-free (a premium is
--     payment for a service, like a ride fare).
--   * The customer pays that premium plus the platform commission
--     (ins_settings.platform_fee_pct). The commission is folded silently into the
--     one price the customer sees — never itemised to them — and is credited for
--     real through fn_credit_platform_fee_to_business, or the purchase is refused.
--   * Cover limits are priced in ICAN (currency stability); the apps show them in the
--     user's own currency at the live ICAN price.
--   * Reward points (BodaGoEra loyalty): a plan may accept them. Points pay at the same
--     rate the rewards programme already redeems at (ins_settings.points_per_ican,
--     default 100 points = 1 ICAN). The insurer is credited the same ICAN either way.
--
-- DATA SHARING: nothing about a holder is visible to an insurer unless the holder
-- ticked it (identity / activity / compliance / finances; a paying business can
-- additionally share business_activity / business_finances). Finances are monthly
-- totals only, never line items. Every read by an insurer is written to
-- ins_data_access_log, which the holder can see. A plan can give a discount to
-- holders who share the scopes it asks for.
--
-- All tables have RLS on and NO policies: the browser never touches them
-- directly, only the SECURITY DEFINER functions below.
--
-- Run after: ICAN_CROSS_APP_WALLET_MIGRATION.sql, ICAN_TRANSACTION_CONTEXT_MIGRATION.sql,
--   PITCHIN_BUSINESS_PROFILE_ICAN_WALLET.sql, SHARED_BUSINESS_AUTHORITY_AND_PAYROLL.sql,
--   ICAN_BUSINESS_WALLET_TRANSFERS.sql, ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql
--   (and ADD_REFERRAL_SYSTEM.sql if the dev panel should log in with its token).
-- Then, for the BodaGoEra card: mybodaguy/backend/database/ADD_INSURANCE_ON_RIDER_CARD.sql.
-- Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Settings (one row, edited from the dev panel)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ins_settings (
  id                    BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  enabled               BOOLEAN NOT NULL DEFAULT true,
  -- Commission added silently on top of the insurer's premium. Developer-editable.
  platform_fee_pct      NUMERIC(5,2) NOT NULL DEFAULT 5 CHECK (platform_fee_pct >= 0 AND platform_fee_pct <= 25),
  points_per_ican       NUMERIC(12,4) NOT NULL DEFAULT 100 CHECK (points_per_ican > 0),
  grace_days            INT NOT NULL DEFAULT 3 CHECK (grace_days BETWEEN 0 AND 30),
  group_min_members     INT NOT NULL DEFAULT 5 CHECK (group_min_members >= 2),
  max_data_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 30 CHECK (max_data_discount_pct >= 0 AND max_data_discount_pct <= 50),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.ins_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE SEQUENCE IF NOT EXISTS public.ins_policy_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.ins_claim_seq  START 1;

-- ----------------------------------------------------------------------------
-- 2. Tables
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ins_insurers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL UNIQUE REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  display_name        TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 80),
  licence_number      TEXT NOT NULL CHECK (char_length(licence_number) BETWEEN 3 AND 60),
  licence_expiry      DATE NOT NULL,
  regulator           TEXT NOT NULL DEFAULT 'IRA' CHECK (char_length(regulator) BETWEEN 2 AND 60),
  country_code        TEXT NOT NULL DEFAULT 'UG' CHECK (country_code ~ '^[A-Za-z]{2}$'),
  contact_email       TEXT CHECK (contact_email IS NULL OR char_length(contact_email) <= 120),
  contact_phone       TEXT CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 30),
  claims_phone        TEXT CHECK (claims_phone IS NULL OR char_length(claims_phone) <= 30),
  description         TEXT CHECK (description IS NULL OR char_length(description) <= 500),
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'suspended', 'rejected')),
  review_note         TEXT,
  reviewed_at         TIMESTAMPTZ,
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ins_plans (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id           UUID NOT NULL REFERENCES public.ins_insurers(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  summary              TEXT CHECK (summary IS NULL OR char_length(summary) <= 300),
  benefits             TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(benefits) <= 8),
  cover_type           TEXT NOT NULL CHECK (cover_type IN (
                         'accident', 'third_party', 'comprehensive', 'medical', 'life',
                         'goods_in_transit', 'property', 'liability', 'fleet')),
  audience             TEXT[] NOT NULL DEFAULT ARRAY['person'] CHECK (
                         cardinality(audience) >= 1 AND audience <@ ARRAY['person', 'rider', 'business']),
  vehicle_types        TEXT[],
  period_days          INT NOT NULL CHECK (period_days IN (7, 30, 90, 365)),
  -- What the INSURER takes home per insured person per period. Final, never reduced later.
  premium_ican         NUMERIC(18,8) NOT NULL CHECK (premium_ican > 0),
  cover_limit_ican     NUMERIC(18,8) NOT NULL CHECK (cover_limit_ican > 0),
  waiting_days         INT NOT NULL DEFAULT 0 CHECK (waiting_days BETWEEN 0 AND 90),
  points_enabled       BOOLEAN NOT NULL DEFAULT true,
  data_discount_pct    NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (data_discount_pct >= 0 AND data_discount_pct <= 50),
  data_discount_scopes TEXT[] NOT NULL DEFAULT ARRAY['activity', 'compliance']
                         CHECK (data_discount_scopes <@ ARRAY['identity', 'activity', 'compliance', 'finances']),
  group_discount_pct   NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (group_discount_pct >= 0 AND group_discount_pct <= 50),
  terms_url            TEXT CHECK (terms_url IS NULL OR (terms_url ~* '^https://' AND char_length(terms_url) <= 300)),
  active               BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ins_plans_insurer_idx ON public.ins_plans (insurer_id);
CREATE INDEX IF NOT EXISTS ins_plans_live_idx    ON public.ins_plans (cover_type) WHERE active;

CREATE TABLE IF NOT EXISTS public.ins_policies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_number       TEXT NOT NULL UNIQUE,
  plan_id             UUID NOT NULL REFERENCES public.ins_plans(id) ON DELETE RESTRICT,
  insurer_id          UUID NOT NULL REFERENCES public.ins_insurers(id) ON DELETE RESTRICT,
  cover_type          TEXT NOT NULL,
  insured_kind        TEXT NOT NULL CHECK (insured_kind IN ('person', 'rider', 'business')),
  insured_user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- BodaGoEra rider registration (mbg_riders.id). No FK: that table belongs to the other app.
  insured_rider_id    UUID,
  insured_business_id UUID REFERENCES public.business_profiles(id) ON DELETE SET NULL,
  insured_label       TEXT,
  subject_key         TEXT NOT NULL,
  payer_kind          TEXT NOT NULL CHECK (payer_kind IN ('user', 'business')),
  payer_user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  payer_business_id   UUID REFERENCES public.business_profiles(id) ON DELETE SET NULL,
  group_size          INT NOT NULL DEFAULT 1 CHECK (group_size >= 1),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  cover_starts_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  auto_renew          BOOLEAN NOT NULL DEFAULT false,
  renew_with          TEXT NOT NULL DEFAULT 'wallet' CHECK (renew_with IN ('wallet', 'points_first', 'points_only')),
  last_renewal_attempt_at TIMESTAMPTZ,
  last_renewal_error  TEXT,
  cancelled_at        TIMESTAMPTZ,
  cancelled_reason    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One live policy per insured subject and kind of cover.
CREATE UNIQUE INDEX IF NOT EXISTS ins_policies_one_live
  ON public.ins_policies (insured_kind, subject_key, cover_type) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS ins_policies_insured_user_idx  ON public.ins_policies (insured_user_id);
CREATE INDEX IF NOT EXISTS ins_policies_payer_user_idx    ON public.ins_policies (payer_user_id);
CREATE INDEX IF NOT EXISTS ins_policies_payer_biz_idx     ON public.ins_policies (payer_business_id);
CREATE INDEX IF NOT EXISTS ins_policies_insured_biz_idx   ON public.ins_policies (insured_business_id);
CREATE INDEX IF NOT EXISTS ins_policies_rider_idx         ON public.ins_policies (insured_rider_id);
CREATE INDEX IF NOT EXISTS ins_policies_insurer_idx       ON public.ins_policies (insurer_id, status);
CREATE INDEX IF NOT EXISTS ins_policies_renewal_idx       ON public.ins_policies (ends_at) WHERE status = 'active' AND auto_renew;

CREATE TABLE IF NOT EXISTS public.ins_payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id         UUID NOT NULL REFERENCES public.ins_policies(id) ON DELETE CASCADE,
  insurer_id        UUID NOT NULL REFERENCES public.ins_insurers(id) ON DELETE RESTRICT,
  plan_id           UUID NOT NULL REFERENCES public.ins_plans(id) ON DELETE RESTRICT,
  kind              TEXT NOT NULL CHECK (kind IN ('purchase', 'renewal')),
  payer_kind        TEXT NOT NULL,
  payer_user_id     UUID,
  payer_business_id UUID,
  -- What the payer was charged (ICAN-equivalent: wallet part + points value).
  total_ican        NUMERIC(18,8) NOT NULL,
  -- What the insurer was credited / what the platform was credited.
  net_ican          NUMERIC(18,8) NOT NULL,
  fee_ican          NUMERIC(18,8) NOT NULL,
  wallet_ican       NUMERIC(18,8) NOT NULL DEFAULT 0,
  points_used       NUMERIC NOT NULL DEFAULT 0,
  discount_pct      NUMERIC(5,2) NOT NULL DEFAULT 0,
  period_start      TIMESTAMPTZ NOT NULL,
  period_end        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ins_payments_policy_idx  ON public.ins_payments (policy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ins_payments_insurer_idx ON public.ins_payments (insurer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ins_claims (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_number        TEXT NOT NULL UNIQUE,
  policy_id           UUID NOT NULL REFERENCES public.ins_policies(id) ON DELETE CASCADE,
  insurer_id          UUID NOT NULL REFERENCES public.ins_insurers(id) ON DELETE RESTRICT,
  filed_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  incident_date       DATE NOT NULL,
  description         TEXT NOT NULL CHECK (char_length(description) BETWEEN 10 AND 2000),
  amount_claimed_ican NUMERIC(18,8) CHECK (amount_claimed_ican IS NULL OR amount_claimed_ican > 0),
  related_ride_id     UUID,
  evidence_urls       TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(evidence_urls) <= 6),
  status              TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN (
                        'submitted', 'in_review', 'info_needed', 'approved', 'rejected', 'paid', 'closed')),
  insurer_note        TEXT CHECK (insurer_note IS NULL OR char_length(insurer_note) <= 1000),
  approved_amount_ican NUMERIC(18,8) CHECK (approved_amount_ican IS NULL OR approved_amount_ican > 0),
  decided_at          TIMESTAMPTZ,
  decided_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  paid_at             TIMESTAMPTZ,
  paid_ref            TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ins_claims_policy_idx  ON public.ins_claims (policy_id);
CREATE INDEX IF NOT EXISTS ins_claims_insurer_idx ON public.ins_claims (insurer_id, status);

CREATE TABLE IF NOT EXISTS public.ins_messages (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id          UUID NOT NULL REFERENCES public.ins_policies(id) ON DELETE CASCADE,
  claim_id           UUID REFERENCES public.ins_claims(id) ON DELETE CASCADE,
  sender_user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  side               TEXT NOT NULL CHECK (side IN ('holder', 'insurer', 'system')),
  body               TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  read_by_holder_at  TIMESTAMPTZ,
  read_by_insurer_at TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ins_messages_policy_idx ON public.ins_messages (policy_id, created_at);

CREATE TABLE IF NOT EXISTS public.ins_data_consents (
  policy_id           UUID PRIMARY KEY REFERENCES public.ins_policies(id) ON DELETE CASCADE,
  holder_scopes       TEXT[] NOT NULL DEFAULT '{}'
                        CHECK (holder_scopes <@ ARRAY['identity', 'activity', 'compliance', 'finances']),
  business_scopes     TEXT[] NOT NULL DEFAULT '{}'
                        CHECK (business_scopes <@ ARRAY['business_activity', 'business_finances']),
  holder_updated_at   TIMESTAMPTZ,
  business_updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.ins_data_access_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id   UUID NOT NULL REFERENCES public.ins_policies(id) ON DELETE CASCADE,
  insurer_id  UUID NOT NULL REFERENCES public.ins_insurers(id) ON DELETE CASCADE,
  accessed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  scopes      TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ins_access_log_policy_idx ON public.ins_data_access_log (policy_id, created_at DESC);

ALTER TABLE public.ins_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ins_insurers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ins_plans           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ins_policies        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ins_payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ins_claims          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ins_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ins_data_consents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ins_data_access_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ins_settings, public.ins_insurers, public.ins_plans, public.ins_policies,
              public.ins_payments, public.ins_claims, public.ins_messages,
              public.ins_data_consents, public.ins_data_access_log
  FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Internal helpers (not callable from the API)
-- ----------------------------------------------------------------------------

-- Dev panel / BodaGo developer gate. Reuses the referral system's check so the panel
-- token is not copied into yet another file.
CREATE OR REPLACE FUNCTION public.ins_is_manager(p_dev_token TEXT DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF to_regprocedure('public.ican_referral_is_manager(text)') IS NOT NULL THEN
    RETURN public.ican_referral_is_manager(p_dev_token);
  END IF;
  IF auth.uid() IS NOT NULL AND to_regclass('public.mbg_users') IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM public.mbg_users mu
       WHERE mu.id = auth.uid() AND mu.role_type::TEXT = 'developer' AND mu.is_active = TRUE
    );
  END IF;
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.ins_cfg()
RETURNS public.ins_settings LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.* FROM public.ins_settings s WHERE s.id = true;
$$;

CREATE OR REPLACE FUNCTION public.ins_display_name(p_user_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(u.raw_user_meta_data->>'name'), ''),
    NULLIF(split_part(u.email, '@', 1), ''),
    'Customer')
  FROM auth.users u WHERE u.id = p_user_id;
$$;

-- Live ICAN price in a user's own currency (their sign-up country), as the wallet shows it.
CREATE OR REPLACE FUNCTION public.ins_live_price_for_user(p_user_id UUID)
RETURNS TABLE (currency_code TEXT, price_local NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.currency_code::TEXT, p.price_local
    FROM public.ican_get_price_by_country(
           COALESCE((SELECT NULLIF(TRIM(ua.country_code), '')
                       FROM public.user_accounts ua WHERE ua.user_id = p_user_id LIMIT 1), 'US')
         ) p
   LIMIT 1;
$$;

-- Cover state, worked out live from the dates (nothing needs a cron to flip it).
CREATE OR REPLACE FUNCTION public.ins_policy_state(p_status TEXT, p_cover_starts TIMESTAMPTZ, p_ends TIMESTAMPTZ)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_status = 'cancelled'  THEN 'cancelled'
    WHEN now() < p_cover_starts  THEN 'waiting'
    WHEN now() <= p_ends         THEN 'active'
    WHEN now() <= p_ends + make_interval(days => (SELECT s.grace_days FROM public.ins_settings s WHERE s.id = true))
                                 THEN 'grace'
    ELSE 'expired'
  END;
$$;

-- The one place prices are computed. net = what the insurer takes home; fee = the
-- platform's silent commission on top; total = what the payer is charged.
CREATE OR REPLACE FUNCTION public.ins_amounts(
  p_premium NUMERIC, p_data_disc NUMERIC, p_group_disc NUMERIC, p_group_size INT
) RETURNS TABLE (net_ican NUMERIC, fee_ican NUMERIC, total_ican NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg public.ins_settings := public.ins_cfg();
  v_net NUMERIC;
  v_fee NUMERIC;
  v_group NUMERIC := 0;
BEGIN
  IF COALESCE(p_group_size, 1) >= v_cfg.group_min_members THEN
    v_group := COALESCE(p_group_disc, 0);
  END IF;
  v_net := ROUND(p_premium * (1 - COALESCE(p_data_disc, 0) / 100.0) * (1 - v_group / 100.0), 8);
  v_fee := ROUND(v_net * v_cfg.platform_fee_pct / 100.0, 8);
  RETURN QUERY SELECT v_net, v_fee, v_net + v_fee;
END;
$$;

-- Reward points live in BodaGoEra's tables, so they are reached dynamically: without
-- that app installed, points simply count as zero.
CREATE OR REPLACE FUNCTION public.ins_points_balance(p_user_id UUID, p_lock BOOLEAN DEFAULT false)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bal NUMERIC;
BEGIN
  IF to_regclass('public.mbg_reward_points') IS NULL THEN
    RETURN 0;
  END IF;
  IF p_lock THEN
    EXECUTE 'SELECT points_balance FROM public.mbg_reward_points WHERE user_id = $1 FOR UPDATE' INTO v_bal USING p_user_id;
  ELSE
    EXECUTE 'SELECT points_balance FROM public.mbg_reward_points WHERE user_id = $1' INTO v_bal USING p_user_id;
  END IF;
  RETURN COALESCE(v_bal, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.ins_points_spend(p_user_id UUID, p_points NUMERIC, p_reference TEXT, p_note TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n INT;
BEGIN
  IF p_points IS NULL OR p_points <= 0 THEN
    RETURN;
  END IF;
  EXECUTE 'UPDATE public.mbg_reward_points SET points_balance = points_balance - $2, updated_at = now() '
          'WHERE user_id = $1 AND points_balance >= $2' USING p_user_id, p_points;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Not enough reward points';
  END IF;
  EXECUTE 'INSERT INTO public.mbg_reward_transactions (user_id, points, direction, source, reference_id, note) '
          'VALUES ($1, $2, ''redeem'', ''redeem_insurance'', $3, $4)' USING p_user_id, p_points, p_reference, p_note;
END;
$$;

-- Business-wallet PIN, with the same 5-tries / 15-minute lock the wallet itself uses.
-- Returns NULL when the PIN is right, otherwise the message to show. It must be called
-- OUTSIDE any exception block, so a failed try is still counted.
CREATE OR REPLACE FUNCTION public.ins_check_business_pin(p_business_id UUID, p_pin TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hash   TEXT;
  v_failed INT;
  v_locked TIMESTAMPTZ;
BEGIN
  SELECT s.pin_hash, s.pin_failed_attempts, s.pin_locked_until
    INTO v_hash, v_failed, v_locked
    FROM public.ican_business_wallet_settings s
   WHERE s.business_profile_id = p_business_id
   FOR UPDATE;
  IF v_hash IS NULL THEN
    RETURN 'Set the business-wallet PIN before making transactions';
  END IF;
  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN 'Business-wallet PIN is temporarily locked';
  END IF;
  IF p_pin IS NULL OR extensions.crypt(p_pin, v_hash) <> v_hash THEN
    v_failed := COALESCE(v_failed, 0) + 1;
    UPDATE public.ican_business_wallet_settings
       SET pin_failed_attempts = v_failed,
           pin_locked_until = CASE WHEN v_failed >= 5 THEN now() + interval '15 minutes' ELSE NULL END,
           updated_at = now()
     WHERE business_profile_id = p_business_id;
    RETURN 'Invalid business-wallet PIN';
  END IF;
  UPDATE public.ican_business_wallet_settings
     SET pin_failed_attempts = 0, pin_locked_until = NULL, updated_at = now()
   WHERE business_profile_id = p_business_id;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.ins_business_wallet_credit(
  p_business_id UUID, p_amount NUMERIC, p_actor UUID, p_reference TEXT,
  p_note TEXT, p_operation TEXT, p_metadata JSONB DEFAULT '{}'::JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.ican_business_wallets (business_profile_id, created_by)
  SELECT bp.id, bp.user_id FROM public.business_profiles bp WHERE bp.id = p_business_id
  ON CONFLICT (business_profile_id) DO NOTHING;

  UPDATE public.ican_business_wallets
     SET ican_balance = ican_balance + p_amount,
         total_earned = total_earned + p_amount,
         updated_at = now()
   WHERE business_profile_id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business wallet not found';
  END IF;

  INSERT INTO public.ican_business_wallet_transactions
    (business_profile_id, initiated_by, amount_ican, note, reference_id,
     status, executed_at, direction, source_app, operation_type, metadata)
  VALUES
    (p_business_id, p_actor, p_amount, COALESCE(p_note, ''), p_reference,
     'completed', now(), 'in', 'ican', p_operation, COALESCE(p_metadata, '{}'::JSONB));
END;
$$;

CREATE OR REPLACE FUNCTION public.ins_business_wallet_debit(
  p_business_id UUID, p_amount NUMERIC, p_actor UUID, p_reference TEXT,
  p_note TEXT, p_operation TEXT, p_recipient_business UUID DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_balance NUMERIC;
BEGIN
  UPDATE public.ican_business_wallets
     SET ican_balance = ican_balance - p_amount,
         total_spent = total_spent + p_amount,
         updated_at = now()
   WHERE business_profile_id = p_business_id
     AND status = 'active'
     AND ican_balance >= p_amount;
  IF NOT FOUND THEN
    SELECT w.ican_balance INTO v_balance FROM public.ican_business_wallets w WHERE w.business_profile_id = p_business_id;
    RAISE EXCEPTION 'Insufficient ICAN. Have: %, Need: %', COALESCE(v_balance, 0), p_amount;
  END IF;

  INSERT INTO public.ican_business_wallet_transactions
    (business_profile_id, initiated_by, amount_ican, note, reference_id,
     status, executed_at, direction, source_app, operation_type, recipient_business_profile_id)
  VALUES
    (p_business_id, p_actor, p_amount, COALESCE(p_note, ''), p_reference,
     'completed', now(), 'out', 'ican', p_operation, p_recipient_business);
END;
$$;

-- One row in the shared coin ledger, valued at the live ICAN price in the given user's currency.
CREATE OR REPLACE FUNCTION public.ins_ledger(
  p_kind TEXT, p_sender UUID, p_recipient UUID, p_amount NUMERIC,
  p_business_id UUID, p_price_user UUID, p_reference TEXT, p_note TEXT,
  p_classification TEXT, p_merchant TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cur   TEXT;
  v_price NUMERIC;
  v_id    UUID;
BEGIN
  SELECT lp.currency_code, lp.price_local INTO v_cur, v_price
    FROM public.ins_live_price_for_user(p_price_user) lp LIMIT 1;
  IF v_price IS NULL OR v_price <= 0 THEN
    RAISE EXCEPTION 'Current ICAN price unavailable';
  END IF;

  INSERT INTO public.ican_coin_transactions
    (sender_user_id, recipient_user_id, ican_amount, type, transaction_type, status,
     local_amount, local_currency, source_app, reference_id, note, business_profile_id,
     merchant_name, counterparty_type, expense_classification)
  VALUES
    (p_sender, p_recipient, p_amount, p_kind, p_kind, 'completed',
     ROUND(p_amount * v_price, 2), v_cur, 'ican', p_reference, p_note, p_business_id,
     p_merchant, CASE WHEN p_merchant IS NOT NULL THEN 'business' ELSE 'person' END, p_classification)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Who the caller is to a policy: insured / payer / business (member of the paying or insured
-- business) / insurer (member of the insurance company).
-- Never NULL: an unknown policy or a signed-out caller has no roles (an empty array), so every
-- "NOT (roles && ...)" permission check below fails closed instead of evaluating to NULL.
CREATE OR REPLACE FUNCTION public.ins_policy_roles(p_policy_id UUID)
RETURNS TEXT[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT array_remove(ARRAY[
             CASE WHEN p.insured_user_id = auth.uid() THEN 'insured' END,
             CASE WHEN p.payer_kind = 'user' AND p.payer_user_id = auth.uid() THEN 'payer' END,
             CASE WHEN (p.payer_business_id IS NOT NULL AND public.ican_business_member(p.payer_business_id))
                    OR (p.insured_business_id IS NOT NULL AND public.ican_business_member(p.insured_business_id))
                  THEN 'business' END,
             CASE WHEN public.ican_business_member(i.business_profile_id) THEN 'insurer' END
           ], NULL)
      FROM public.ins_policies p
      JOIN public.ins_insurers i ON i.id = p.insurer_id
     WHERE p.id = p_policy_id AND auth.uid() IS NOT NULL
  ), ARRAY[]::TEXT[]);
$$;

-- Everything a holder sees about one policy.
CREATE OR REPLACE FUNCTION public.ins_policy_json(p_policy_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg  public.ins_settings := public.ins_cfg();
  v_p    public.ins_policies%ROWTYPE;
  v_pl   public.ins_plans%ROWTYPE;
  v_i    public.ins_insurers%ROWTYPE;
  v_c    public.ins_data_consents%ROWTYPE;
  v_disc NUMERIC := 0;
  v_tot  NUMERIC;
  v_state TEXT;
BEGIN
  SELECT * INTO v_p FROM public.ins_policies WHERE id = p_policy_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_pl FROM public.ins_plans WHERE id = v_p.plan_id;
  SELECT * INTO v_i  FROM public.ins_insurers WHERE id = v_p.insurer_id;
  SELECT * INTO v_c  FROM public.ins_data_consents WHERE policy_id = p_policy_id;

  IF v_pl.data_discount_pct > 0 AND COALESCE(v_c.holder_scopes, '{}') @> v_pl.data_discount_scopes THEN
    v_disc := LEAST(v_pl.data_discount_pct, v_cfg.max_data_discount_pct);
  END IF;
  SELECT a.total_ican INTO v_tot
    FROM public.ins_amounts(v_pl.premium_ican, v_disc, v_pl.group_discount_pct, v_p.group_size) a;
  v_state := public.ins_policy_state(v_p.status, v_p.cover_starts_at, v_p.ends_at);

  RETURN jsonb_build_object(
    'policy_id',      v_p.id,
    'policy_number',  v_p.policy_number,
    'state',          v_state,
    'cover_type',     v_p.cover_type,
    'insured_kind',   v_p.insured_kind,
    'insured_label',  v_p.insured_label,
    'insured_name',   CASE WHEN v_p.insured_kind = 'business'
                           THEN (SELECT bp.business_name FROM public.business_profiles bp WHERE bp.id = v_p.insured_business_id)
                           ELSE public.ins_display_name(v_p.insured_user_id) END,
    'payer_kind',     v_p.payer_kind,
    'payer_name',     CASE WHEN v_p.payer_kind = 'business'
                           THEN (SELECT bp.business_name FROM public.business_profiles bp WHERE bp.id = v_p.payer_business_id)
                           ELSE public.ins_display_name(v_p.payer_user_id) END,
    'payer_business_id',   v_p.payer_business_id,
    'insured_business_id', v_p.insured_business_id,
    'insured_rider_id',    v_p.insured_rider_id,
    'group_size',     v_p.group_size,
    'started_at',     v_p.started_at,
    'cover_starts_at', v_p.cover_starts_at,
    'ends_at',        v_p.ends_at,
    'days_left',      GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_p.ends_at - now())) / 86400.0))::INT,
    'auto_renew',     v_p.auto_renew,
    'renew_with',     v_p.renew_with,
    'last_renewal_error', v_p.last_renewal_error,
    'renewal_price_ican', v_tot,
    'renewal_points_cost', CASE WHEN v_pl.points_enabled THEN CEIL(v_tot * v_cfg.points_per_ican) END,
    'data_discount_pct',   v_disc,
    'plan', jsonb_build_object(
      'plan_id', v_pl.id, 'name', v_pl.name, 'summary', v_pl.summary, 'period_days', v_pl.period_days,
      'cover_limit_ican', v_pl.cover_limit_ican, 'waiting_days', v_pl.waiting_days,
      'points_enabled', v_pl.points_enabled, 'active', v_pl.active, 'terms_url', v_pl.terms_url,
      'benefits', to_jsonb(v_pl.benefits),
      'data_discount_pct', LEAST(v_pl.data_discount_pct, v_cfg.max_data_discount_pct),
      'data_discount_scopes', to_jsonb(v_pl.data_discount_scopes)),
    'insurer', jsonb_build_object(
      'insurer_id', v_i.id, 'name', v_i.display_name, 'status', v_i.status,
      'claims_phone', v_i.claims_phone, 'contact_phone', v_i.contact_phone, 'contact_email', v_i.contact_email),
    'holder_scopes',   to_jsonb(COALESCE(v_c.holder_scopes, '{}')),
    'business_scopes', to_jsonb(COALESCE(v_c.business_scopes, '{}')),
    'unread_from_insurer', (SELECT count(*) FROM public.ins_messages m
                             WHERE m.policy_id = v_p.id AND m.side = 'insurer' AND m.read_by_holder_at IS NULL),
    'open_claims', (SELECT count(*) FROM public.ins_claims c
                     WHERE c.policy_id = v_p.id AND c.status IN ('submitted', 'in_review', 'info_needed', 'approved'))
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Charging a policy (purchase and renewal share one path)
--
-- Internal: the callers decide WHO may charge. Returns {success:false,error} for the
-- things a person can fix (not enough funds or points); anything unexpected raises, and
-- the caller's exception block rolls the whole purchase back.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ins_charge_policy(
  p_policy_id UUID, p_kind TEXT, p_actor UUID,
  p_use_points BOOLEAN DEFAULT false, p_points_only BOOLEAN DEFAULT false
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg     public.ins_settings := public.ins_cfg();
  v_pol     public.ins_policies%ROWTYPE;
  v_plan    public.ins_plans%ROWTYPE;
  v_ins     public.ins_insurers%ROWTYPE;
  v_c       public.ins_data_consents%ROWTYPE;
  v_disc    NUMERIC := 0;
  v_net     NUMERIC;
  v_fee     NUMERIC;
  v_total   NUMERIC;
  v_pts_avail NUMERIC := 0;
  v_pts_cost  NUMERIC := 0;
  v_pts_used  NUMERIC := 0;
  v_pts_value NUMERIC := 0;
  v_wallet    NUMERIC := 0;
  v_balance   NUMERIC;
  v_payment   UUID := gen_random_uuid();
  v_ref       TEXT;
  v_actor     UUID;
  v_note      TEXT;
  v_start     TIMESTAMPTZ;
  v_end       TIMESTAMPTZ;
  v_ins_owner UUID;
  v_pay_owner UUID;
  v_fee_res   JSONB;
BEGIN
  SELECT * INTO v_pol FROM public.ins_policies WHERE id = p_policy_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Policy not found');
  END IF;
  SELECT * INTO v_plan FROM public.ins_plans WHERE id = v_pol.plan_id;
  SELECT * INTO v_ins  FROM public.ins_insurers WHERE id = v_pol.insurer_id;
  IF NOT v_cfg.enabled THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insurance is switched off right now');
  END IF;
  IF NOT v_plan.active OR v_ins.status <> 'verified' OR v_ins.licence_expiry < current_date THEN
    RETURN jsonb_build_object('success', false, 'error', 'This plan is no longer on sale');
  END IF;

  v_actor := COALESCE(p_actor, v_pol.payer_user_id);
  SELECT * INTO v_c FROM public.ins_data_consents WHERE policy_id = p_policy_id;
  IF v_plan.data_discount_pct > 0 AND COALESCE(v_c.holder_scopes, '{}') @> v_plan.data_discount_scopes THEN
    v_disc := LEAST(v_plan.data_discount_pct, v_cfg.max_data_discount_pct);
  END IF;
  SELECT a.net_ican, a.fee_ican, a.total_ican INTO v_net, v_fee, v_total
    FROM public.ins_amounts(v_plan.premium_ican, v_disc, v_plan.group_discount_pct, v_pol.group_size) a;

  IF p_kind = 'purchase' THEN
    v_start := now();
  ELSE
    v_start := GREATEST(now(), v_pol.ends_at);
  END IF;
  v_end := v_start + make_interval(days => v_plan.period_days);

  -- ---- work out the funding BEFORE moving anything -------------------------
  IF v_pol.payer_kind = 'user' THEN
    IF p_points_only AND NOT v_plan.points_enabled THEN
      RETURN jsonb_build_object('success', false, 'error', 'This plan cannot be paid with reward points');
    END IF;
    IF (p_use_points OR p_points_only) AND v_plan.points_enabled THEN
      v_pts_avail := FLOOR(public.ins_points_balance(v_pol.payer_user_id, true));
      v_pts_cost  := CEIL(v_total * v_cfg.points_per_ican);
      v_pts_used  := LEAST(v_pts_avail, v_pts_cost);
      IF p_points_only AND v_pts_used < v_pts_cost THEN
        RETURN jsonb_build_object('success', false,
          'error', format('Not enough reward points: you have %s, this cover needs %s', v_pts_avail, v_pts_cost));
      END IF;
      v_pts_value := LEAST(v_total, ROUND(v_pts_used / v_cfg.points_per_ican, 8));
    END IF;
    v_wallet := GREATEST(ROUND(v_total - v_pts_value, 8), 0);
    IF v_wallet > 0 THEN
      PERFORM public.get_or_create_ican_wallet(v_pol.payer_user_id);
      SELECT w.ican_balance INTO v_balance
        FROM public.ican_user_wallets w WHERE w.user_id = v_pol.payer_user_id FOR UPDATE;
      IF COALESCE(v_balance, 0) < v_wallet THEN
        RETURN jsonb_build_object('success', false,
          'error', format('Insufficient ICAN. Have: %s, Need: %s', COALESCE(v_balance, 0), v_wallet));
      END IF;
    END IF;
  ELSE
    v_wallet := v_total;
    SELECT w.ican_balance INTO v_balance
      FROM public.ican_business_wallets w
     WHERE w.business_profile_id = v_pol.payer_business_id AND w.status = 'active' FOR UPDATE;
    IF COALESCE(v_balance, 0) < v_wallet THEN
      RETURN jsonb_build_object('success', false,
        'error', format('Insufficient ICAN. Have: %s, Need: %s', COALESCE(v_balance, 0), v_wallet));
    END IF;
  END IF;

  -- ---- move the money ------------------------------------------------------
  v_ref  := 'ins:' || v_payment::TEXT;
  v_note := format('Insurance %s: %s (policy %s)', CASE WHEN p_kind = 'purchase' THEN 'premium' ELSE 'renewal' END,
                   v_plan.name, v_pol.policy_number);

  IF v_pol.payer_kind = 'user' THEN
    IF v_pts_used > 0 THEN
      PERFORM public.ins_points_spend(v_pol.payer_user_id, v_pts_used, v_ref, 'Paid for cover: ' || v_plan.name);
    END IF;
    IF v_wallet > 0 THEN
      UPDATE public.ican_user_wallets
         SET ican_balance = ican_balance - v_wallet, total_spent = total_spent + v_wallet
       WHERE user_id = v_pol.payer_user_id;
      -- A personal expense paid to the insurer: not tagged to the insurer's business, so the
      -- insurer's own ledger never shows the payer's total (which includes the commission).
      PERFORM public.ins_ledger('transfer_out', v_pol.payer_user_id, NULL, v_wallet, NULL,
                                v_pol.payer_user_id, v_ref, v_note, 'personal_expense', v_ins.display_name);
    END IF;
  ELSE
    SELECT bp.user_id INTO v_pay_owner FROM public.business_profiles bp WHERE bp.id = v_pol.payer_business_id;
    PERFORM public.ins_business_wallet_debit(v_pol.payer_business_id, v_wallet, v_actor, v_ref, v_note,
                                             'insurance_premium', v_ins.business_profile_id);
    PERFORM public.ins_ledger('transfer_out', v_actor, NULL, v_wallet, v_pol.payer_business_id,
                              v_pay_owner, v_ref, v_note, 'business_expense', v_ins.display_name);
  END IF;

  -- The insurer is credited its full premium, tithe-free.
  SELECT bp.user_id INTO v_ins_owner FROM public.business_profiles bp WHERE bp.id = v_ins.business_profile_id;
  PERFORM public.ins_business_wallet_credit(
    v_ins.business_profile_id, v_net, v_actor, v_ref,
    format('Premium for policy %s (%s)', v_pol.policy_number, v_plan.name), 'insurance_premium',
    jsonb_build_object('policy_id', v_pol.id, 'payment_id', v_payment));
  PERFORM public.ins_ledger('transfer_in', NULL, NULL, v_net, v_ins.business_profile_id, v_ins_owner, v_ref,
                            format('Premium for policy %s (%s)', v_pol.policy_number, v_plan.name), 'income', NULL);

  -- The platform commission is credited for real, or the purchase does not happen.
  IF v_fee > 0 THEN
    IF to_regprocedure('public.fn_credit_platform_fee_to_business(numeric,text,text,text,uuid,text,jsonb)') IS NULL THEN
      RAISE EXCEPTION 'Platform fee routing is not installed (run ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql first)';
    END IF;
    v_fee_res := public.fn_credit_platform_fee_to_business(
      v_fee, 'ican', 'ins-fee:' || v_payment::TEXT, 'insurance_commission', v_actor,
      format('Insurance commission on policy %s', v_pol.policy_number),
      jsonb_build_object('policy_id', v_pol.id, 'plan_id', v_plan.id, 'payment_id', v_payment));
    IF NOT COALESCE((v_fee_res ->> 'success')::BOOLEAN, false) THEN
      RAISE EXCEPTION 'Platform fee could not be credited: %', COALESCE(v_fee_res ->> 'error', 'unknown error');
    END IF;
  END IF;

  UPDATE public.ins_policies
     SET ends_at = v_end,
         cover_starts_at = CASE WHEN p_kind = 'purchase'
                                THEN v_start + make_interval(days => v_plan.waiting_days)
                                ELSE cover_starts_at END,
         status = 'active',
         last_renewal_attempt_at = now(),
         last_renewal_error = NULL,
         updated_at = now()
   WHERE id = v_pol.id;

  INSERT INTO public.ins_payments
    (id, policy_id, insurer_id, plan_id, kind, payer_kind, payer_user_id, payer_business_id,
     total_ican, net_ican, fee_ican, wallet_ican, points_used, discount_pct, period_start, period_end)
  VALUES
    (v_payment, v_pol.id, v_pol.insurer_id, v_plan.id, p_kind, v_pol.payer_kind, v_pol.payer_user_id,
     v_pol.payer_business_id, v_total, v_net, v_fee, v_wallet, v_pts_used, v_disc, v_start, v_end);

  -- Deliberately no fee/net in the answer: the payer only ever sees the one price.
  RETURN jsonb_build_object(
    'success', true, 'payment_id', v_payment, 'policy_id', v_pol.id, 'policy_number', v_pol.policy_number,
    'total_ican', v_total, 'wallet_ican', v_wallet, 'points_used', v_pts_used, 'ends_at', v_end);
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Insurers: register, edit, list
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ins_register_insurer(
  p_business_id    UUID,
  p_display_name   TEXT,
  p_licence_number TEXT,
  p_licence_expiry DATE,
  p_regulator      TEXT DEFAULT 'IRA',
  p_country_code   TEXT DEFAULT 'UG',
  p_contact_email  TEXT DEFAULT NULL,
  p_contact_phone  TEXT DEFAULT NULL,
  p_claims_phone   TEXT DEFAULT NULL,
  p_description    TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name  TEXT := NULLIF(btrim(p_display_name), '');
  v_lic   TEXT := NULLIF(btrim(p_licence_number), '');
  v_reg   TEXT := COALESCE(NULLIF(btrim(p_regulator), ''), 'IRA');
  v_cc    TEXT := upper(COALESCE(NULLIF(btrim(p_country_code), ''), 'UG'));
  v_email TEXT := NULLIF(btrim(p_contact_email), '');
  v_existing public.ins_insurers%ROWTYPE;
  v_id    UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please sign in');
  END IF;
  IF NOT public.ican_business_admin(p_business_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only an owner or administrator of the business can register it as an insurer');
  END IF;
  IF v_name IS NULL OR char_length(v_name) NOT BETWEEN 2 AND 80 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter the company name (2 to 80 characters)');
  END IF;
  IF v_lic IS NULL OR char_length(v_lic) NOT BETWEEN 3 AND 60 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter your insurance licence number');
  END IF;
  IF p_licence_expiry IS NULL OR p_licence_expiry < current_date OR p_licence_expiry > current_date + 3660 THEN
    RETURN jsonb_build_object('success', false, 'error', 'The licence expiry must be a future date. An expired licence cannot be registered');
  END IF;
  IF v_cc !~ '^[A-Z]{2}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Use a two-letter country code, for example UG');
  END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter a valid contact email');
  END IF;

  SELECT * INTO v_existing FROM public.ins_insurers WHERE business_profile_id = p_business_id;
  IF FOUND THEN
    IF v_existing.status <> 'rejected' THEN
      RETURN jsonb_build_object('success', false, 'error', 'This business is already registered as an insurer');
    END IF;
    UPDATE public.ins_insurers
       SET display_name = v_name, licence_number = v_lic, licence_expiry = p_licence_expiry,
           regulator = v_reg, country_code = v_cc, contact_email = v_email,
           contact_phone = NULLIF(btrim(p_contact_phone), ''), claims_phone = NULLIF(btrim(p_claims_phone), ''),
           description = NULLIF(btrim(p_description), ''),
           status = 'pending', review_note = NULL, reviewed_at = NULL, updated_at = now()
     WHERE id = v_existing.id
     RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.ins_insurers
      (business_profile_id, display_name, licence_number, licence_expiry, regulator, country_code,
       contact_email, contact_phone, claims_phone, description, created_by)
    VALUES
      (p_business_id, v_name, v_lic, p_licence_expiry, v_reg, v_cc, v_email,
       NULLIF(btrim(p_contact_phone), ''), NULLIF(btrim(p_claims_phone), ''),
       NULLIF(btrim(p_description), ''), auth.uid())
    RETURNING id INTO v_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'insurer_id', v_id, 'status', 'pending');
END;
$$;

CREATE OR REPLACE FUNCTION public.ins_update_insurer(p_insurer_id UUID, p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_i public.ins_insurers%ROWTYPE;
  v_lic TEXT;
  v_exp DATE;
  v_email TEXT;
BEGIN
  SELECT * INTO v_i FROM public.ins_insurers WHERE id = p_insurer_id;
  IF NOT FOUND OR NOT public.ican_business_admin(v_i.business_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insurer not found');
  END IF;

  v_lic   := COALESCE(NULLIF(btrim(p_payload ->> 'licence_number'), ''), v_i.licence_number);
  v_exp   := COALESCE(NULLIF(p_payload ->> 'licence_expiry', '')::DATE, v_i.licence_expiry);
  v_email := CASE WHEN p_payload ? 'contact_email' THEN NULLIF(btrim(p_payload ->> 'contact_email'), '') ELSE v_i.contact_email END;
  IF char_length(v_lic) NOT BETWEEN 3 AND 60 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter your insurance licence number');
  END IF;
  IF v_exp < current_date OR v_exp > current_date + 3660 THEN
    RETURN jsonb_build_object('success', false, 'error', 'The licence expiry must be a future date');
  END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter a valid contact email');
  END IF;

  UPDATE public.ins_insurers SET
    display_name   = COALESCE(NULLIF(btrim(p_payload ->> 'display_name'), ''), display_name),
    licence_number = v_lic,
    licence_expiry = v_exp,
    regulator      = COALESCE(NULLIF(btrim(p_payload ->> 'regulator'), ''), regulator),
    contact_email  = v_email,
    contact_phone  = CASE WHEN p_payload ? 'contact_phone' THEN NULLIF(btrim(p_payload ->> 'contact_phone'), '') ELSE contact_phone END,
    claims_phone   = CASE WHEN p_payload ? 'claims_phone'  THEN NULLIF(btrim(p_payload ->> 'claims_phone'), '')  ELSE claims_phone END,
    description    = CASE WHEN p_payload ? 'description'   THEN NULLIF(btrim(p_payload ->> 'description'), '')   ELSE description END,
    -- A different licence number is a different licence: it has to be checked again.
    status         = CASE WHEN v_lic <> v_i.licence_number AND status = 'verified' THEN 'pending' ELSE status END,
    reviewed_at    = CASE WHEN v_lic <> v_i.licence_number AND status = 'verified' THEN NULL ELSE reviewed_at END,
    updated_at     = now()
  WHERE id = p_insurer_id;
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- The insurance companies the caller works for (owner, co-owner admin or active staff member).
CREATE OR REPLACE FUNCTION public.ins_my_insurers()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'insurer_id',     i.id,
           'business_id',    i.business_profile_id,
           'business_name',  bp.business_name,
           'display_name',   i.display_name,
           'licence_number', i.licence_number,
           'licence_expiry', i.licence_expiry,
           'licence_state',  CASE WHEN i.licence_expiry < current_date THEN 'expired'
                                  WHEN i.licence_expiry <= current_date + 30 THEN 'expiring_soon'
                                  ELSE 'valid' END,
           'regulator',      i.regulator,
           'country_code',   i.country_code,
           'contact_email',  i.contact_email,
           'contact_phone',  i.contact_phone,
           'claims_phone',   i.claims_phone,
           'description',    i.description,
           'status',         i.status,
           'review_note',    i.review_note,
           'is_admin',       public.ican_business_admin(i.business_profile_id)
         ) ORDER BY i.created_at), '[]'::JSONB)
    FROM public.ins_insurers i
    JOIN public.business_profiles bp ON bp.id = i.business_profile_id
   WHERE auth.uid() IS NOT NULL AND public.ican_business_member(i.business_profile_id);
$$;

-- ----------------------------------------------------------------------------
-- 6. Plans: save, list for the insurer
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ins_save_plan(p_insurer_id UUID, p_plan_id UUID, p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg  public.ins_settings := public.ins_cfg();
  v_i    public.ins_insurers%ROWTYPE;
  v_name TEXT := NULLIF(btrim(p_payload ->> 'name'), '');
  v_sum  TEXT := NULLIF(btrim(p_payload ->> 'summary'), '');
  v_type TEXT := p_payload ->> 'cover_type';
  v_ben  TEXT[];
  v_aud  TEXT[];
  v_veh  TEXT[];
  v_dsc  TEXT[];
  v_period INT := NULLIF(p_payload ->> 'period_days', '')::INT;
  v_prem NUMERIC := NULLIF(p_payload ->> 'premium_ican', '')::NUMERIC;
  v_lim  NUMERIC := NULLIF(p_payload ->> 'cover_limit_ican', '')::NUMERIC;
  v_wait INT := COALESCE(NULLIF(p_payload ->> 'waiting_days', '')::INT, 0);
  v_pts  BOOLEAN := COALESCE((p_payload ->> 'points_enabled')::BOOLEAN, true);
  v_dpct NUMERIC := COALESCE(NULLIF(p_payload ->> 'data_discount_pct', '')::NUMERIC, 0);
  v_gpct NUMERIC := COALESCE(NULLIF(p_payload ->> 'group_discount_pct', '')::NUMERIC, 0);
  v_url  TEXT := NULLIF(btrim(p_payload ->> 'terms_url'), '');
  v_act  BOOLEAN := COALESCE((p_payload ->> 'active')::BOOLEAN, true);
  v_id   UUID;
BEGIN
  SELECT * INTO v_i FROM public.ins_insurers WHERE id = p_insurer_id;
  IF NOT FOUND OR NOT public.ican_business_admin(v_i.business_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only an owner or administrator of the insurance company can edit plans');
  END IF;
  IF v_i.status IN ('suspended', 'rejected') THEN
    RETURN jsonb_build_object('success', false, 'error', 'This insurer is ' || v_i.status || ' and cannot change plans');
  END IF;

  v_ben := ARRAY(SELECT btrim(x) FROM jsonb_array_elements_text(COALESCE(p_payload -> 'benefits', '[]'::JSONB)) x WHERE btrim(x) <> '');
  v_aud := ARRAY(SELECT DISTINCT x FROM jsonb_array_elements_text(COALESCE(p_payload -> 'audience', '["person"]'::JSONB)) x ORDER BY x);
  v_dsc := ARRAY(SELECT DISTINCT x FROM jsonb_array_elements_text(COALESCE(p_payload -> 'data_discount_scopes', '["activity","compliance"]'::JSONB)) x ORDER BY x);
  IF p_payload -> 'vehicle_types' IS NULL OR jsonb_typeof(p_payload -> 'vehicle_types') <> 'array'
     OR jsonb_array_length(p_payload -> 'vehicle_types') = 0 THEN
    v_veh := NULL;
  ELSE
    v_veh := ARRAY(SELECT DISTINCT x FROM jsonb_array_elements_text(p_payload -> 'vehicle_types') x ORDER BY x);
  END IF;

  IF v_name IS NULL OR char_length(v_name) NOT BETWEEN 2 AND 80 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Give the plan a name (2 to 80 characters)');
  END IF;
  IF v_sum IS NOT NULL AND char_length(v_sum) > 300 THEN
    RETURN jsonb_build_object('success', false, 'error', 'The summary can be at most 300 characters');
  END IF;
  IF v_type IS NULL OR v_type NOT IN ('accident', 'third_party', 'comprehensive', 'medical', 'life',
                                      'goods_in_transit', 'property', 'liability', 'fleet') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Choose what the plan covers');
  END IF;
  IF cardinality(v_ben) > 8 THEN
    RETURN jsonb_build_object('success', false, 'error', 'List at most 8 benefits');
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_ben) b WHERE char_length(b) > 120) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Each benefit can be at most 120 characters');
  END IF;
  IF cardinality(v_aud) = 0 OR NOT (v_aud <@ ARRAY['person', 'rider', 'business']) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Choose who the plan is for');
  END IF;
  IF v_veh IS NOT NULL AND NOT (v_veh <@ ARRAY['motorcycle', 'bicycle', 'tuktuk', 'car', 'van', 'truck']) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown vehicle type');
  END IF;
  IF v_period IS NULL OR v_period NOT IN (7, 30, 90, 365) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Choose a cover period: weekly, monthly, quarterly or yearly');
  END IF;
  IF v_prem IS NULL OR v_prem <= 0 OR v_prem > 10000000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter the premium you take home per period, in ICAN');
  END IF;
  IF v_lim IS NULL OR v_lim <= 0 OR v_lim > 1000000000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter the cover limit in ICAN');
  END IF;
  IF v_wait NOT BETWEEN 0 AND 90 THEN
    RETURN jsonb_build_object('success', false, 'error', 'The waiting period is 0 to 90 days');
  END IF;
  IF v_dpct < 0 OR v_dpct > v_cfg.max_data_discount_pct THEN
    RETURN jsonb_build_object('success', false, 'error', format('The data-sharing discount can be 0 to %s%%', v_cfg.max_data_discount_pct));
  END IF;
  IF v_dpct > 0 AND (cardinality(v_dsc) = 0 OR NOT (v_dsc <@ ARRAY['identity', 'activity', 'compliance', 'finances'])) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Choose which shared data earns the discount');
  END IF;
  IF v_gpct < 0 OR v_gpct > 50 THEN
    RETURN jsonb_build_object('success', false, 'error', 'The group discount can be 0 to 50%');
  END IF;
  IF v_url IS NOT NULL AND (v_url !~* '^https://' OR char_length(v_url) > 300) THEN
    RETURN jsonb_build_object('success', false, 'error', 'The policy terms link must start with https://');
  END IF;

  IF p_plan_id IS NULL THEN
    INSERT INTO public.ins_plans
      (insurer_id, name, summary, benefits, cover_type, audience, vehicle_types, period_days, premium_ican,
       cover_limit_ican, waiting_days, points_enabled, data_discount_pct, data_discount_scopes,
       group_discount_pct, terms_url, active)
    VALUES
      (p_insurer_id, v_name, v_sum, v_ben, v_type, v_aud, v_veh, v_period, v_prem,
       v_lim, v_wait, v_pts, v_dpct, v_dsc, v_gpct, v_url, v_act)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.ins_plans SET
      name = v_name, summary = v_sum, benefits = v_ben, cover_type = v_type, audience = v_aud,
      vehicle_types = v_veh, period_days = v_period, premium_ican = v_prem, cover_limit_ican = v_lim,
      waiting_days = v_wait, points_enabled = v_pts, data_discount_pct = v_dpct, data_discount_scopes = v_dsc,
      group_discount_pct = v_gpct, terms_url = v_url, active = v_act, updated_at = now()
    WHERE id = p_plan_id AND insurer_id = p_insurer_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Plan not found');
    END IF;
  END IF;
  RETURN jsonb_build_object('success', true, 'plan_id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.ins_insurer_plans(p_insurer_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg public.ins_settings := public.ins_cfg();
  v_i   public.ins_insurers%ROWTYPE;
BEGIN
  SELECT * INTO v_i FROM public.ins_insurers WHERE id = p_insurer_id;
  IF NOT FOUND OR NOT public.ican_business_member(v_i.business_profile_id) THEN
    RETURN '[]'::JSONB;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'plan_id', pl.id, 'name', pl.name, 'summary', pl.summary, 'benefits', to_jsonb(pl.benefits),
             'cover_type', pl.cover_type, 'audience', to_jsonb(pl.audience), 'vehicle_types', to_jsonb(pl.vehicle_types),
             'period_days', pl.period_days,
             -- "You take home": exactly what is credited for every insured person, every period.
             'premium_ican', pl.premium_ican,
             'customer_price_ican', a.total_ican,
             'cover_limit_ican', pl.cover_limit_ican, 'waiting_days', pl.waiting_days,
             'points_enabled', pl.points_enabled, 'data_discount_pct', pl.data_discount_pct,
             'data_discount_scopes', to_jsonb(pl.data_discount_scopes),
             'group_discount_pct', pl.group_discount_pct, 'terms_url', pl.terms_url, 'active', pl.active,
             'active_policies', (SELECT count(*) FROM public.ins_policies p
                                  WHERE p.plan_id = pl.id AND p.status = 'active' AND p.ends_at >= now()),
             'max_data_discount_pct', v_cfg.max_data_discount_pct
           ) ORDER BY pl.created_at DESC)
      FROM public.ins_plans pl
      CROSS JOIN LATERAL public.ins_amounts(pl.premium_ican, 0, pl.group_discount_pct, 1) a
     WHERE pl.insurer_id = p_insurer_id
  ), '[]'::JSONB);
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. The marketplace and quotes (what customers see: one price, no fee line)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ins_list_plans(
  p_audience TEXT DEFAULT NULL, p_cover_type TEXT DEFAULT NULL, p_vehicle_type TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg public.ins_settings := public.ins_cfg();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Please sign in';
  END IF;
  IF NOT v_cfg.enabled THEN
    RETURN '[]'::JSONB;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(t.row_json ORDER BY t.sort_price)
      FROM (
        SELECT a_plain.total_ican AS sort_price,
               jsonb_build_object(
                 'plan_id', pl.id, 'name', pl.name, 'summary', pl.summary, 'benefits', to_jsonb(pl.benefits),
                 'cover_type', pl.cover_type, 'audience', to_jsonb(pl.audience),
                 'vehicle_types', to_jsonb(pl.vehicle_types), 'period_days', pl.period_days,
                 'price_ican', a_plain.total_ican,
                 'price_with_data_ican', CASE WHEN pl.data_discount_pct > 0 THEN a_disc.total_ican END,
                 'data_discount_pct', LEAST(pl.data_discount_pct, v_cfg.max_data_discount_pct),
                 'data_discount_scopes', to_jsonb(pl.data_discount_scopes),
                 'group_price_ican', CASE WHEN pl.group_discount_pct > 0 THEN a_grp.total_ican END,
                 'group_discount_pct', pl.group_discount_pct, 'group_min_members', v_cfg.group_min_members,
                 'points_enabled', pl.points_enabled,
                 'points_cost', CASE WHEN pl.points_enabled THEN CEIL(a_plain.total_ican * v_cfg.points_per_ican) END,
                 'cover_limit_ican', pl.cover_limit_ican, 'waiting_days', pl.waiting_days, 'terms_url', pl.terms_url,
                 'insurer', jsonb_build_object(
                   'insurer_id', i.id, 'name', i.display_name, 'regulator', i.regulator,
                   'licence_number', i.licence_number, 'licence_expiry', i.licence_expiry,
                   'country', i.country_code, 'claims_phone', i.claims_phone)
               ) AS row_json
          FROM public.ins_plans pl
          JOIN public.ins_insurers i ON i.id = pl.insurer_id
          CROSS JOIN LATERAL public.ins_amounts(pl.premium_ican, 0, pl.group_discount_pct, 1) a_plain
          CROSS JOIN LATERAL public.ins_amounts(pl.premium_ican, LEAST(pl.data_discount_pct, v_cfg.max_data_discount_pct), pl.group_discount_pct, 1) a_disc
          CROSS JOIN LATERAL public.ins_amounts(pl.premium_ican, 0, pl.group_discount_pct, v_cfg.group_min_members) a_grp
         WHERE pl.active
           AND i.status = 'verified'
           AND i.licence_expiry >= current_date
           AND (p_audience IS NULL OR p_audience = ANY (pl.audience))
           AND (p_cover_type IS NULL OR pl.cover_type = p_cover_type)
           AND (p_vehicle_type IS NULL OR pl.vehicle_types IS NULL OR p_vehicle_type = ANY (pl.vehicle_types))
      ) t
  ), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.ins_quote(
  p_plan_id UUID, p_members INT DEFAULT 1, p_share_scopes TEXT[] DEFAULT ARRAY[]::TEXT[]
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg  public.ins_settings := public.ins_cfg();
  v_pl   public.ins_plans%ROWTYPE;
  v_n    INT := GREATEST(1, LEAST(COALESCE(p_members, 1), 500));
  v_disc NUMERIC := 0;
  v_per  NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please sign in');
  END IF;
  SELECT pl.* INTO v_pl FROM public.ins_plans pl
    JOIN public.ins_insurers i ON i.id = pl.insurer_id
   WHERE pl.id = p_plan_id AND pl.active AND i.status = 'verified';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'This plan is not available');
  END IF;
  -- The sharing discount belongs to the person being insured, so it is only offered on a personal purchase.
  IF v_n = 1 AND v_pl.data_discount_pct > 0 AND COALESCE(p_share_scopes, '{}') @> v_pl.data_discount_scopes THEN
    v_disc := LEAST(v_pl.data_discount_pct, v_cfg.max_data_discount_pct);
  END IF;
  SELECT a.total_ican INTO v_per FROM public.ins_amounts(v_pl.premium_ican, v_disc, v_pl.group_discount_pct, v_n) a;
  RETURN jsonb_build_object(
    'success', true, 'members', v_n, 'per_member_ican', v_per, 'total_ican', ROUND(v_per * v_n, 8),
    'discount_pct', v_disc,
    'group_discount_applied', (v_n >= v_cfg.group_min_members AND v_pl.group_discount_pct > 0),
    'points_enabled', v_pl.points_enabled,
    'points_cost', CASE WHEN v_pl.points_enabled THEN CEIL(v_per * v_cfg.points_per_ican) END,
    'period_days', v_pl.period_days);
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. Subscribing
-- ----------------------------------------------------------------------------

-- A person (or a rider, when p_rider_id is given) buys cover for themselves.
-- The transaction PIN is checked by the app before this is called, like every other
-- wallet payment in the family of apps.
CREATE OR REPLACE FUNCTION public.ins_subscribe_personal(
  p_plan_id      UUID,
  p_rider_id     UUID DEFAULT NULL,
  p_use_points   BOOLEAN DEFAULT false,
  p_points_only  BOOLEAN DEFAULT false,
  p_share_scopes TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_auto_renew   BOOLEAN DEFAULT false,
  p_renew_with   TEXT DEFAULT 'wallet'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_cfg     public.ins_settings := public.ins_cfg();
  v_plan    public.ins_plans%ROWTYPE;
  v_ins     public.ins_insurers%ROWTYPE;
  v_existing public.ins_policies%ROWTYPE;
  v_kind    TEXT;
  v_label   TEXT;
  v_subject TEXT;
  v_rj      JSONB;
  v_vtype   TEXT;
  v_scopes  TEXT[];
  v_policy  UUID;
  v_res     JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please sign in');
  END IF;
  IF NOT v_cfg.enabled THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insurance is switched off right now');
  END IF;
  IF p_renew_with NOT IN ('wallet', 'points_first', 'points_only') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown renewal method');
  END IF;
  SELECT * INTO v_plan FROM public.ins_plans WHERE id = p_plan_id AND active;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'This plan is not available');
  END IF;
  SELECT * INTO v_ins FROM public.ins_insurers WHERE id = v_plan.insurer_id;
  IF v_ins.status <> 'verified' OR v_ins.licence_expiry < current_date THEN
    RETURN jsonb_build_object('success', false, 'error', 'This insurer cannot sell cover right now');
  END IF;

  IF p_rider_id IS NOT NULL THEN
    IF NOT ('rider' = ANY (v_plan.audience)) THEN
      RETURN jsonb_build_object('success', false, 'error', 'This plan is not for riders');
    END IF;
    IF to_regclass('public.mbg_riders') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Rider cover needs BodaGoEra');
    END IF;
    EXECUTE 'SELECT to_jsonb(r) FROM public.mbg_riders r WHERE r.id = $1 AND r.user_id = $2'
      INTO v_rj USING p_rider_id, v_uid;
    IF v_rj IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Rider registration not found');
    END IF;
    v_vtype := v_rj ->> 'vehicle_type';
    v_label := COALESCE(NULLIF(upper(v_rj ->> 'plate_number'), ''), initcap(v_vtype));
    IF v_plan.vehicle_types IS NOT NULL AND NOT (v_vtype = ANY (v_plan.vehicle_types)) THEN
      RETURN jsonb_build_object('success', false, 'error', 'This plan does not cover a ' || COALESCE(v_vtype, 'vehicle of that type'));
    END IF;
    v_kind := 'rider';
    v_subject := p_rider_id::TEXT;
  ELSE
    IF NOT ('person' = ANY (v_plan.audience)) THEN
      RETURN jsonb_build_object('success', false, 'error', 'This plan is not for individuals');
    END IF;
    v_kind := 'person';
    v_label := public.ins_display_name(v_uid);
    v_subject := v_uid::TEXT;
  END IF;

  v_scopes := ARRAY(SELECT DISTINCT s FROM unnest(COALESCE(p_share_scopes, ARRAY[]::TEXT[])) s
                     WHERE s IN ('identity', 'activity', 'compliance', 'finances') ORDER BY s);

  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('ins:' || v_subject || ':' || v_plan.cover_type));

    SELECT * INTO v_existing FROM public.ins_policies
     WHERE insured_kind = v_kind AND subject_key = v_subject
       AND cover_type = v_plan.cover_type AND status = 'active' LIMIT 1;
    IF FOUND THEN
      IF public.ins_policy_state(v_existing.status, v_existing.cover_starts_at, v_existing.ends_at) = 'expired' THEN
        UPDATE public.ins_policies
           SET status = 'cancelled', cancelled_at = now(), cancelled_reason = 'Replaced by a new policy', updated_at = now()
         WHERE id = v_existing.id;
      ELSE
        RETURN jsonb_build_object('success', false, 'error',
          format('You already have this kind of cover until %s. Renew it from My cover instead.',
                 to_char(v_existing.ends_at, 'DD Mon YYYY')));
      END IF;
    END IF;

    INSERT INTO public.ins_policies
      (policy_number, plan_id, insurer_id, cover_type, insured_kind, insured_user_id, insured_rider_id,
       insured_label, subject_key, payer_kind, payer_user_id, group_size, started_at, cover_starts_at, ends_at,
       auto_renew, renew_with)
    VALUES
      ('ICV-' || lpad(nextval('public.ins_policy_seq')::TEXT, 8, '0'), v_plan.id, v_plan.insurer_id,
       v_plan.cover_type, v_kind, v_uid, p_rider_id, v_label, v_subject, 'user', v_uid, 1, now(), now(), now(),
       COALESCE(p_auto_renew, false), p_renew_with)
    RETURNING id INTO v_policy;

    INSERT INTO public.ins_data_consents (policy_id, holder_scopes, holder_updated_at)
    VALUES (v_policy, v_scopes, now());

    v_res := public.ins_charge_policy(v_policy, 'purchase', v_uid, p_use_points, p_points_only);
    IF NOT COALESCE((v_res ->> 'success')::BOOLEAN, false) THEN
      RAISE EXCEPTION '%', COALESCE(v_res ->> 'error', 'Payment failed');
    END IF;
    RETURN v_res || jsonb_build_object('policy_id', v_policy);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  END;
END;
$$;

-- A business buys cover for itself (p_insured_kind 'business') or for some of its BodaGoEra
-- drivers (p_insured_kind 'rider'), from its business wallet, with the business-wallet PIN.
-- One payment run, one policy per insured driver. Riders already covered are skipped.
CREATE OR REPLACE FUNCTION public.ins_subscribe_business(
  p_plan_id      UUID,
  p_business_id  UUID,
  p_insured_kind TEXT,
  p_rider_ids    UUID[] DEFAULT NULL,
  p_pin          TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_cfg     public.ins_settings := public.ins_cfg();
  v_plan    public.ins_plans%ROWTYPE;
  v_ins     public.ins_insurers%ROWTYPE;
  v_existing public.ins_policies%ROWTYPE;
  v_bname   TEXT;
  v_rid     UUID;
  v_rj      JSONB;
  v_vtype   TEXT;
  v_eligible JSONB := '[]'::JSONB;   -- [{rider_id, user_id, label}]
  v_skipped INT := 0;
  v_item    JSONB;
  v_n       INT;
  v_per     NUMERIC;
  v_total   NUMERIC;
  v_threshold NUMERIC;
  v_balance NUMERIC;
  v_pin_err TEXT;
  v_policy  UUID;
  v_res     JSONB;
  v_ids     UUID[] := ARRAY[]::UUID[];
  v_subject TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please sign in');
  END IF;
  IF NOT v_cfg.enabled THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insurance is switched off right now');
  END IF;
  IF NOT public.ican_business_admin(p_business_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only an owner or administrator of the business can buy cover for it');
  END IF;
  IF p_insured_kind NOT IN ('business', 'rider') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Choose whether the cover is for the business or for its drivers');
  END IF;
  SELECT * INTO v_plan FROM public.ins_plans WHERE id = p_plan_id AND active;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'This plan is not available');
  END IF;
  SELECT * INTO v_ins FROM public.ins_insurers WHERE id = v_plan.insurer_id;
  IF v_ins.status <> 'verified' OR v_ins.licence_expiry < current_date THEN
    RETURN jsonb_build_object('success', false, 'error', 'This insurer cannot sell cover right now');
  END IF;
  IF v_ins.business_profile_id = p_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'An insurer cannot buy its own plan');
  END IF;
  IF NOT (p_insured_kind = ANY (v_plan.audience)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This plan is not for ' ||
      CASE p_insured_kind WHEN 'business' THEN 'businesses' ELSE 'riders' END);
  END IF;
  SELECT bp.business_name INTO v_bname FROM public.business_profiles bp WHERE bp.id = p_business_id;

  -- Who exactly is insured.
  IF p_insured_kind = 'business' THEN
    IF EXISTS (SELECT 1 FROM public.ins_policies p
                WHERE p.insured_kind = 'business' AND p.subject_key = p_business_id::TEXT
                  AND p.cover_type = v_plan.cover_type AND p.status = 'active'
                  AND public.ins_policy_state(p.status, p.cover_starts_at, p.ends_at) <> 'expired') THEN
      RETURN jsonb_build_object('success', false, 'error', 'The business already has this kind of cover. Renew it from the Cover tab instead.');
    END IF;
    v_eligible := jsonb_build_array(jsonb_build_object('label', v_bname));
  ELSE
    IF to_regclass('public.mbg_riders') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Driver cover needs BodaGoEra');
    END IF;
    IF p_rider_ids IS NULL OR cardinality(p_rider_ids) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Choose at least one driver');
    END IF;
    IF cardinality(p_rider_ids) > 200 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Insure at most 200 drivers at a time');
    END IF;
    FOREACH v_rid IN ARRAY (SELECT ARRAY(SELECT DISTINCT x FROM unnest(p_rider_ids) x)) LOOP
      EXECUTE 'SELECT to_jsonb(r) FROM public.mbg_riders r WHERE r.id = $1 AND r.business_profile_id = $2'
        INTO v_rj USING v_rid, p_business_id;
      IF v_rj IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'One of the drivers does not belong to this business');
      END IF;
      v_vtype := v_rj ->> 'vehicle_type';
      IF v_plan.vehicle_types IS NOT NULL AND NOT (v_vtype = ANY (v_plan.vehicle_types)) THEN
        RETURN jsonb_build_object('success', false, 'error',
          format('This plan does not cover a %s (%s)', COALESCE(v_vtype, 'vehicle'), COALESCE(v_rj ->> 'plate_number', 'driver')));
      END IF;
      IF EXISTS (SELECT 1 FROM public.ins_policies p
                  WHERE p.insured_kind = 'rider' AND p.subject_key = v_rid::TEXT
                    AND p.cover_type = v_plan.cover_type AND p.status = 'active'
                    AND public.ins_policy_state(p.status, p.cover_starts_at, p.ends_at) <> 'expired') THEN
        v_skipped := v_skipped + 1;
      ELSE
        v_eligible := v_eligible || jsonb_build_array(jsonb_build_object(
          'rider_id', v_rid, 'user_id', v_rj ->> 'user_id',
          'label', COALESCE(NULLIF(upper(v_rj ->> 'plate_number'), ''), initcap(v_vtype))));
      END IF;
    END LOOP;
    IF jsonb_array_length(v_eligible) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Every chosen driver already has this cover');
    END IF;
  END IF;

  v_n := jsonb_array_length(v_eligible);
  SELECT a.total_ican INTO v_per FROM public.ins_amounts(v_plan.premium_ican, 0, v_plan.group_discount_pct, v_n) a;
  v_total := ROUND(v_per * v_n, 8);

  -- A big payment is a shareholder decision: the business-wallet approval limit is never bypassed here.
  SELECT s.large_transaction_threshold_ican INTO v_threshold
    FROM public.ican_business_wallet_settings s WHERE s.business_profile_id = p_business_id;
  IF v_threshold IS NOT NULL AND v_total >= v_threshold THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('This payment is above your business-wallet approval limit of %s ICAN. Insure fewer drivers at a time, or ask your shareholders to raise the limit.', v_threshold));
  END IF;
  SELECT w.ican_balance INTO v_balance
    FROM public.ican_business_wallets w WHERE w.business_profile_id = p_business_id AND w.status = 'active';
  IF COALESCE(v_balance, 0) < v_total THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('Insufficient ICAN. Have: %s, Need: %s', COALESCE(v_balance, 0), v_total));
  END IF;

  v_pin_err := public.ins_check_business_pin(p_business_id, p_pin);
  IF v_pin_err IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', v_pin_err);
  END IF;

  BEGIN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_eligible) LOOP
      v_subject := CASE WHEN p_insured_kind = 'business' THEN p_business_id::TEXT ELSE v_item ->> 'rider_id' END;
      PERFORM pg_advisory_xact_lock(hashtext('ins:' || v_subject || ':' || v_plan.cover_type));

      -- An expired policy of the same kind is retired so the new one can take its place.
      SELECT * INTO v_existing FROM public.ins_policies
       WHERE insured_kind = p_insured_kind AND subject_key = v_subject
         AND cover_type = v_plan.cover_type AND status = 'active' LIMIT 1;
      IF FOUND THEN
        UPDATE public.ins_policies
           SET status = 'cancelled', cancelled_at = now(), cancelled_reason = 'Replaced by a new policy', updated_at = now()
         WHERE id = v_existing.id;
      END IF;

      INSERT INTO public.ins_policies
        (policy_number, plan_id, insurer_id, cover_type, insured_kind, insured_user_id, insured_rider_id,
         insured_business_id, insured_label, subject_key, payer_kind, payer_business_id, group_size,
         started_at, cover_starts_at, ends_at, auto_renew, renew_with)
      VALUES
        ('ICV-' || lpad(nextval('public.ins_policy_seq')::TEXT, 8, '0'), v_plan.id, v_plan.insurer_id,
         v_plan.cover_type, p_insured_kind,
         CASE WHEN p_insured_kind = 'rider' THEN (v_item ->> 'user_id')::UUID END,
         CASE WHEN p_insured_kind = 'rider' THEN (v_item ->> 'rider_id')::UUID END,
         CASE WHEN p_insured_kind = 'business' THEN p_business_id END,
         v_item ->> 'label', v_subject, 'business', p_business_id, v_n, now(), now(), now(), false, 'wallet')
      RETURNING id INTO v_policy;

      INSERT INTO public.ins_data_consents (policy_id) VALUES (v_policy);

      v_res := public.ins_charge_policy(v_policy, 'purchase', v_uid, false, false);
      IF NOT COALESCE((v_res ->> 'success')::BOOLEAN, false) THEN
        RAISE EXCEPTION '%', COALESCE(v_res ->> 'error', 'Payment failed');
      END IF;
      v_ids := v_ids || v_policy;
    END LOOP;
    RETURN jsonb_build_object('success', true, 'policy_ids', to_jsonb(v_ids), 'insured', v_n,
                              'skipped', v_skipped, 'total_ican', v_total);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  END;
END;
$$;

-- Renew now, early or late. The payer only.
CREATE OR REPLACE FUNCTION public.ins_renew_policy(
  p_policy_id UUID, p_use_points BOOLEAN DEFAULT false, p_points_only BOOLEAN DEFAULT false, p_pin TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pol   public.ins_policies%ROWTYPE;
  v_plan  public.ins_plans%ROWTYPE;
  v_roles TEXT[];
  v_pin_err TEXT;
  v_threshold NUMERIC;
  v_json  JSONB;
  v_res   JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please sign in');
  END IF;
  SELECT * INTO v_pol FROM public.ins_policies WHERE id = p_policy_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Policy not found');
  END IF;
  SELECT * INTO v_plan FROM public.ins_plans WHERE id = v_pol.plan_id;
  v_roles := public.ins_policy_roles(p_policy_id);
  IF v_pol.payer_kind = 'user' THEN
    IF NOT ('payer' = ANY (v_roles)) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Only the person who pays for this cover can renew it');
    END IF;
  ELSE
    IF NOT public.ican_business_admin(v_pol.payer_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Only an owner or administrator of the paying business can renew this cover');
    END IF;
  END IF;
  IF v_pol.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This policy was cancelled. Buy a new plan instead.');
  END IF;
  -- Renewing opens in the last half of a period (30 days at most). That keeps a double tap, or an
  -- over-eager renewal, from charging twice for cover that is already paid for.
  IF v_pol.ends_at > now() + interval '1 day' * LEAST(v_plan.period_days / 2.0, 30)::DOUBLE PRECISION THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('You are covered until %s. You can renew in the last %s days of your cover.',
             to_char(v_pol.ends_at, 'DD Mon YYYY'), CEIL(LEAST(v_plan.period_days / 2.0, 30))::INT));
  END IF;

  IF v_pol.payer_kind = 'business' THEN
    v_json := public.ins_policy_json(p_policy_id);
    SELECT s.large_transaction_threshold_ican INTO v_threshold
      FROM public.ican_business_wallet_settings s WHERE s.business_profile_id = v_pol.payer_business_id;
    IF v_threshold IS NOT NULL AND (v_json ->> 'renewal_price_ican')::NUMERIC >= v_threshold THEN
      RETURN jsonb_build_object('success', false, 'error',
        format('This payment is above your business-wallet approval limit of %s ICAN', v_threshold));
    END IF;
    v_pin_err := public.ins_check_business_pin(v_pol.payer_business_id, p_pin);
    IF v_pin_err IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', v_pin_err);
    END IF;
  END IF;

  BEGIN
    -- A business never pays with points; a failure comes back as {success:false,error}.
    v_res := public.ins_charge_policy(p_policy_id, 'renewal', auth.uid(),
                                      p_use_points AND v_pol.payer_kind = 'user',
                                      p_points_only AND v_pol.payer_kind = 'user');
    RETURN v_res;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.ins_set_auto_renew(p_policy_id UUID, p_auto_renew BOOLEAN, p_renew_with TEXT DEFAULT 'wallet')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pol public.ins_policies%ROWTYPE;
BEGIN
  SELECT * INTO v_pol FROM public.ins_policies WHERE id = p_policy_id;
  IF NOT FOUND OR v_pol.payer_kind <> 'user' OR NOT ('payer' = ANY (public.ins_policy_roles(p_policy_id))) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only the person who pays for this cover can change renewal. Businesses renew with their wallet PIN.');
  END IF;
  IF p_renew_with NOT IN ('wallet', 'points_first', 'points_only') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown renewal method');
  END IF;
  UPDATE public.ins_policies
     SET auto_renew = COALESCE(p_auto_renew, false), renew_with = p_renew_with,
         last_renewal_error = NULL, last_renewal_attempt_at = NULL, updated_at = now()
   WHERE id = p_policy_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- Stop renewing. Cover that is already paid for runs to its end date.
CREATE OR REPLACE FUNCTION public.ins_cancel_policy(p_policy_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pol public.ins_policies%ROWTYPE;
  v_roles TEXT[];
BEGIN
  SELECT * INTO v_pol FROM public.ins_policies WHERE id = p_policy_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Policy not found');
  END IF;
  v_roles := public.ins_policy_roles(p_policy_id);
  IF NOT (v_roles && ARRAY['payer', 'business']) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only the person or business that pays for this cover can stop it');
  END IF;
  UPDATE public.ins_policies
     SET auto_renew = false, cancelled_at = now(),
         cancelled_reason = NULLIF(left(btrim(COALESCE(p_reason, '')), 200), ''), updated_at = now()
   WHERE id = p_policy_id;
  RETURN jsonb_build_object('success', true, 'ends_at', v_pol.ends_at);
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. Policies as the holder sees them
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ins_my_policies()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::JSONB;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(public.ins_policy_json(x.id) || jsonb_build_object(
             'role', CASE WHEN x.insured_user_id = auth.uid() AND x.payer_user_id = auth.uid() THEN 'both'
                          WHEN x.insured_user_id = auth.uid() THEN 'insured' ELSE 'payer' END)
           ORDER BY x.ends_at DESC)
      FROM (
        SELECT p.id, p.ends_at, p.insured_user_id, p.payer_user_id
          FROM public.ins_policies p
         WHERE p.insured_user_id = auth.uid() OR (p.payer_kind = 'user' AND p.payer_user_id = auth.uid())
         ORDER BY p.ends_at DESC
         LIMIT 100
      ) x
  ), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.ins_business_policies(p_business_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.ican_business_member(p_business_id) THEN
    RETURN '[]'::JSONB;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(public.ins_policy_json(x.id) ORDER BY x.ends_at DESC)
      FROM (
        SELECT p.id, p.ends_at FROM public.ins_policies p
         WHERE p.payer_business_id = p_business_id OR p.insured_business_id = p_business_id
         ORDER BY p.ends_at DESC LIMIT 300
      ) x
  ), '[]'::JSONB);
END;
$$;

-- Payments on one policy, as the payer sees them: one total per period.
CREATE OR REPLACE FUNCTION public.ins_policy_payments(p_policy_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.ins_policy_roles(p_policy_id) && ARRAY['payer', 'business']) THEN
    RETURN '[]'::JSONB;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'at', pm.created_at, 'kind', pm.kind, 'total_ican', pm.total_ican, 'points_used', pm.points_used,
             'period_start', pm.period_start, 'period_end', pm.period_end) ORDER BY pm.created_at DESC)
      FROM public.ins_payments pm WHERE pm.policy_id = p_policy_id
  ), '[]'::JSONB);
END;
$$;

-- The covers the caller (and optionally one business they belong to) currently holds.
-- This is what the Compliance tab ticks off its insurance requirements from.
CREATE OR REPLACE FUNCTION public.ins_my_cover_status(p_business_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::JSONB;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'policy_id', p.id, 'cover_type', p.cover_type, 'insured_kind', p.insured_kind,
             'state', public.ins_policy_state(p.status, p.cover_starts_at, p.ends_at),
             'plan', pl.name, 'insurer', i.display_name, 'ends_at', p.ends_at))
      FROM public.ins_policies p
      JOIN public.ins_plans pl ON pl.id = p.plan_id
      JOIN public.ins_insurers i ON i.id = p.insurer_id
     WHERE p.status = 'active' AND p.ends_at > now() - interval '90 days'
       AND (
         (p_business_id IS NULL AND (p.insured_user_id = auth.uid() OR (p.payer_kind = 'user' AND p.payer_user_id = auth.uid())))
         OR (p_business_id IS NOT NULL AND public.ican_business_member(p_business_id)
             AND (p.payer_business_id = p_business_id OR p.insured_business_id = p_business_id))
       )
  ), '[]'::JSONB);
END;
$$;

-- What the public QR rider card may show about a person's cover: insurer, plan and dates only.
-- Internal: BodaGoEra's card functions call it (see ADD_INSURANCE_ON_RIDER_CARD.sql).
CREATE OR REPLACE FUNCTION public.ins_policy_public_summary(p_user_id UUID, p_rider_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH c AS (
    SELECT p.id, p.cover_type, p.policy_number, p.ends_at,
           i.display_name AS insurer_name, pl.name AS plan_name,
           public.ins_policy_state(p.status, p.cover_starts_at, p.ends_at) AS st,
           CASE public.ins_policy_state(p.status, p.cover_starts_at, p.ends_at)
             WHEN 'active' THEN 1 WHEN 'grace' THEN 2 WHEN 'waiting' THEN 3 WHEN 'expired' THEN 4 ELSE 5 END AS rnk,
           CASE WHEN p.cover_type IN ('third_party', 'comprehensive', 'accident') THEN 0 ELSE 1 END AS pri
      FROM public.ins_policies p
      JOIN public.ins_plans pl ON pl.id = p.plan_id
      JOIN public.ins_insurers i ON i.id = p.insurer_id
     WHERE p.status = 'active'
       AND p.ends_at > now() - interval '90 days'
       AND ((p_rider_id IS NOT NULL AND p.insured_rider_id = p_rider_id)
            OR (p.insured_kind = 'person' AND p.insured_user_id = p_user_id))
  ), ranked AS (
    SELECT * FROM c WHERE st <> 'cancelled' ORDER BY rnk, pri, ends_at DESC LIMIT 3
  )
  SELECT CASE
           WHEN NOT EXISTS (SELECT 1 FROM ranked) THEN jsonb_build_object('state', 'none', 'policies', '[]'::JSONB)
           ELSE jsonb_build_object(
                  'state', (SELECT r.st FROM ranked r ORDER BY r.rnk, r.pri, r.ends_at DESC LIMIT 1),
                  'policies', (SELECT jsonb_agg(jsonb_build_object(
                                 'state', r.st, 'insurer', r.insurer_name, 'plan', r.plan_name,
                                 'cover_type', r.cover_type, 'ref', 'ICV-••••' || right(r.policy_number, 4),
                                 'valid_until', r.ends_at::DATE) ORDER BY r.rnk, r.pri, r.ends_at DESC)
                                 FROM ranked r))
         END;
$$;

-- ----------------------------------------------------------------------------
-- 10. Data sharing: consent, the insurer's data room, and the audit trail
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ins_set_data_consent(p_policy_id UUID, p_scopes TEXT[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_scopes TEXT[];
BEGIN
  IF NOT ('insured' = ANY (public.ins_policy_roles(p_policy_id))) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only the insured person decides what of theirs is shared');
  END IF;
  v_scopes := ARRAY(SELECT DISTINCT s FROM unnest(COALESCE(p_scopes, ARRAY[]::TEXT[])) s
                     WHERE s IN ('identity', 'activity', 'compliance', 'finances') ORDER BY s);
  INSERT INTO public.ins_data_consents (policy_id, holder_scopes, holder_updated_at)
  VALUES (p_policy_id, v_scopes, now())
  ON CONFLICT (policy_id) DO UPDATE SET holder_scopes = EXCLUDED.holder_scopes, holder_updated_at = now();
  RETURN jsonb_build_object('success', true, 'scopes', to_jsonb(v_scopes));
END;
$$;

CREATE OR REPLACE FUNCTION public.ins_set_business_data_consent(p_policy_id UUID, p_scopes TEXT[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pol public.ins_policies%ROWTYPE;
  v_scopes TEXT[];
BEGIN
  SELECT * INTO v_pol FROM public.ins_policies WHERE id = p_policy_id;
  IF NOT FOUND
     OR NOT ((v_pol.payer_business_id IS NOT NULL AND public.ican_business_admin(v_pol.payer_business_id))
          OR (v_pol.insured_business_id IS NOT NULL AND public.ican_business_admin(v_pol.insured_business_id))) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only an owner or administrator of the business decides what of the business is shared');
  END IF;
  v_scopes := ARRAY(SELECT DISTINCT s FROM unnest(COALESCE(p_scopes, ARRAY[]::TEXT[])) s
                     WHERE s IN ('business_activity', 'business_finances') ORDER BY s);
  INSERT INTO public.ins_data_consents (policy_id, business_scopes, business_updated_at)
  VALUES (p_policy_id, v_scopes, now())
  ON CONFLICT (policy_id) DO UPDATE SET business_scopes = EXCLUDED.business_scopes, business_updated_at = now();
  RETURN jsonb_build_object('success', true, 'scopes', to_jsonb(v_scopes));
END;
$$;

-- Who looked at what, for the holder.
CREATE OR REPLACE FUNCTION public.ins_policy_access_log(p_policy_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.ins_policy_roles(p_policy_id) && ARRAY['insured', 'payer', 'business']) THEN
    RETURN '[]'::JSONB;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('at', x.created_at, 'insurer', x.display_name, 'scopes', to_jsonb(x.scopes))
                     ORDER BY x.created_at DESC)
      FROM (
        SELECT l.created_at, i.display_name, l.scopes
          FROM public.ins_data_access_log l JOIN public.ins_insurers i ON i.id = l.insurer_id
         WHERE l.policy_id = p_policy_id ORDER BY l.created_at DESC LIMIT 50
      ) x
  ), '[]'::JSONB);
END;
$$;

-- The insurer's view of one policyholder: only what was ticked, always logged.
-- BodaGoEra tables are read dynamically, so this also works where that app is not installed.
CREATE OR REPLACE FUNCTION public.ins_insurer_policy_data(p_policy_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pol   public.ins_policies%ROWTYPE;
  v_ins   public.ins_insurers%ROWTYPE;
  v_pl    public.ins_plans%ROWTYPE;
  v_c     public.ins_data_consents%ROWTYPE;
  v_out   JSONB := '{}'::JSONB;
  v_x     JSONB;
  v_tmp   JSONB;
  v_shared TEXT[] := ARRAY[]::TEXT[];
  v_u     UUID;
  v_rider UUID;
  v_biz   UUID;
BEGIN
  SELECT * INTO v_pol FROM public.ins_policies WHERE id = p_policy_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Policy not found');
  END IF;
  SELECT * INTO v_ins FROM public.ins_insurers WHERE id = v_pol.insurer_id;
  IF NOT public.ican_business_member(v_ins.business_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not allowed');
  END IF;
  SELECT * INTO v_pl FROM public.ins_plans WHERE id = v_pol.plan_id;
  SELECT * INTO v_c  FROM public.ins_data_consents WHERE policy_id = p_policy_id;
  v_u := v_pol.insured_user_id;
  v_rider := v_pol.insured_rider_id;
  v_biz := COALESCE(v_pol.payer_business_id, v_pol.insured_business_id);

  -- identity
  IF 'identity' = ANY (COALESCE(v_c.holder_scopes, '{}')) AND v_u IS NOT NULL THEN
    v_shared := array_append(v_shared, 'identity');
    v_tmp := jsonb_build_object('email', (SELECT u.email FROM auth.users u WHERE u.id = v_u));
    IF v_rider IS NOT NULL AND to_regclass('public.mbg_riders') IS NOT NULL THEN
      EXECUTE $q$
        SELECT jsonb_build_object(
                 'vehicle_type', r.vehicle_type::TEXT, 'plate_number', r.plate_number,
                 'model', r.vehicle_model, 'colour', r.vehicle_color,
                 'licence_masked', CASE WHEN length(btrim(COALESCE(r.license_number, ''))) >= 5
                                        THEN repeat('•', length(btrim(r.license_number)) - 3) || right(btrim(r.license_number), 3) END)
          FROM public.mbg_riders r WHERE r.id = $1
      $q$ INTO v_x USING v_rider;
      v_tmp := v_tmp || COALESCE(v_x, '{}'::JSONB);
    END IF;
    v_out := v_out || jsonb_build_object('identity', v_tmp);
  END IF;

  -- activity
  IF 'activity' = ANY (COALESCE(v_c.holder_scopes, '{}')) AND v_u IS NOT NULL THEN
    v_shared := array_append(v_shared, 'activity');
    v_tmp := '{}'::JSONB;
    IF v_rider IS NOT NULL AND to_regclass('public.mbg_rides') IS NOT NULL AND to_regclass('public.mbg_riders') IS NOT NULL THEN
      EXECUTE $q$
        SELECT jsonb_build_object(
                 'rides_completed_30d',   count(*) FILTER (WHERE rd.status::TEXT = 'completed' AND rd.created_at >= now() - interval '30 days'),
                 'rides_completed_90d',   count(*) FILTER (WHERE rd.status::TEXT = 'completed' AND rd.created_at >= now() - interval '90 days'),
                 'rides_completed_total', count(*) FILTER (WHERE rd.status::TEXT = 'completed'),
                 'rides_cancelled_90d',   count(*) FILTER (WHERE rd.status::TEXT = 'cancelled' AND rd.created_at >= now() - interval '90 days'),
                 'rating',       (SELECT r.rating FROM public.mbg_riders r WHERE r.id = $1),
                 'member_since', (SELECT r.created_at FROM public.mbg_riders r WHERE r.id = $1))
          FROM public.mbg_rides rd WHERE rd.rider_id = $1
      $q$ INTO v_x USING v_rider;
      v_tmp := COALESCE(v_x, '{}'::JSONB);
    ELSIF to_regclass('public.mbg_rides') IS NOT NULL AND to_regclass('public.mbg_customers') IS NOT NULL THEN
      EXECUTE $q$
        SELECT jsonb_build_object(
                 'rides_as_passenger_90d', count(*) FILTER (WHERE rd.status::TEXT = 'completed' AND rd.created_at >= now() - interval '90 days'),
                 'rides_as_passenger_total', count(*) FILTER (WHERE rd.status::TEXT = 'completed'))
          FROM public.mbg_rides rd
          JOIN public.mbg_customers cu ON cu.id = rd.customer_id
         WHERE cu.user_id = $1
      $q$ INTO v_x USING v_u;
      v_tmp := COALESCE(v_x, '{}'::JSONB);
    END IF;
    v_out := v_out || jsonb_build_object('activity', v_tmp);
  END IF;

  -- compliance (riders): permit, ID card, fees
  IF 'compliance' = ANY (COALESCE(v_c.holder_scopes, '{}')) AND v_u IS NOT NULL THEN
    v_shared := array_append(v_shared, 'compliance');
    v_tmp := '{}'::JSONB;
    IF v_rider IS NOT NULL AND to_regclass('public.mbg_riders') IS NOT NULL THEN
      EXECUTE $q$
        SELECT jsonb_build_object(
                 'permit_status', CASE WHEN r.license_expiry IS NULL THEN 'not_recorded'
                                       WHEN r.license_expiry < current_date THEN 'expired'
                                       WHEN r.license_expiry <= current_date + 30 THEN 'expiring_soon'
                                       ELSE 'valid' END,
                 'permit_expiry', r.license_expiry,
                 'rider_status', r.status::TEXT,
                 'commission_owed_ugx', COALESCE((to_jsonb(r) ->> 'cash_commission_debt_ugx')::NUMERIC, 0))
          FROM public.mbg_riders r WHERE r.id = $1
      $q$ INTO v_x USING v_rider;
      v_tmp := COALESCE(v_x, '{}'::JSONB);
      IF to_regclass('public.mbg_rider_cards') IS NOT NULL THEN
        EXECUTE $q$
          SELECT jsonb_build_object('id_card', (
                   SELECT c.status FROM public.mbg_rider_cards c
                    WHERE c.rider_id = $1 AND c.status IN ('pending_payment', 'active')
                    ORDER BY c.issued_at DESC LIMIT 1))
        $q$ INTO v_x USING v_rider;
        v_tmp := v_tmp || COALESCE(v_x, '{}'::JSONB);
      END IF;
    END IF;
    v_out := v_out || jsonb_build_object('compliance', v_tmp);
  END IF;

  -- finances (personal): monthly totals for six months, never line items
  IF 'finances' = ANY (COALESCE(v_c.holder_scopes, '{}')) AND v_u IS NOT NULL THEN
    v_shared := array_append(v_shared, 'finances');
    SELECT COALESCE(jsonb_agg(m.j ORDER BY m.mon), '[]'::JSONB) INTO v_tmp
      FROM (
        SELECT to_char(date_trunc('month', t.created_at), 'YYYY-MM') AS mon,
               jsonb_build_object(
                 'month', to_char(date_trunc('month', t.created_at), 'YYYY-MM'),
                 'in_ican',  COALESCE(sum(t.ican_amount) FILTER (WHERE t.recipient_user_id = v_u), 0),
                 'out_ican', COALESCE(sum(t.ican_amount) FILTER (WHERE t.sender_user_id = v_u), 0),
                 'transactions', count(*)) AS j
          FROM public.ican_coin_transactions t
         WHERE (t.sender_user_id = v_u OR t.recipient_user_id = v_u)
           AND t.status = 'completed'
           AND t.created_at >= date_trunc('month', now()) - interval '5 months'
         GROUP BY date_trunc('month', t.created_at)
      ) m;
    v_out := v_out || jsonb_build_object('finances', v_tmp);
  END IF;

  -- business scopes, shared by the paying/insured business
  IF v_biz IS NOT NULL AND 'business_activity' = ANY (COALESCE(v_c.business_scopes, '{}')) THEN
    v_shared := array_append(v_shared, 'business_activity');
    v_tmp := '{}'::JSONB;
    IF to_regclass('public.mbg_riders') IS NOT NULL THEN
      EXECUTE $q$
        SELECT jsonb_build_object(
                 'drivers', count(*),
                 'drivers_active', count(*) FILTER (WHERE r.status::TEXT = 'active'))
          FROM public.mbg_riders r WHERE r.business_profile_id = $1
      $q$ INTO v_x USING v_biz;
      v_tmp := COALESCE(v_x, '{}'::JSONB);
      IF to_regclass('public.mbg_rides') IS NOT NULL THEN
        EXECUTE $q$
          SELECT jsonb_build_object(
                   'rides_completed_90d', count(*) FILTER (WHERE rd.status::TEXT = 'completed' AND rd.created_at >= now() - interval '90 days'),
                   'rides_cancelled_90d', count(*) FILTER (WHERE rd.status::TEXT = 'cancelled' AND rd.created_at >= now() - interval '90 days'))
            FROM public.mbg_rides rd
            JOIN public.mbg_riders r ON r.id = rd.rider_id
           WHERE r.business_profile_id = $1
        $q$ INTO v_x USING v_biz;
        v_tmp := v_tmp || COALESCE(v_x, '{}'::JSONB);
      END IF;
    END IF;
    v_out := v_out || jsonb_build_object('business_activity', v_tmp);
  END IF;

  IF v_biz IS NOT NULL AND 'business_finances' = ANY (COALESCE(v_c.business_scopes, '{}')) THEN
    v_shared := array_append(v_shared, 'business_finances');
    SELECT COALESCE(jsonb_agg(m.j ORDER BY m.mon), '[]'::JSONB) INTO v_tmp
      FROM (
        SELECT to_char(date_trunc('month', w.created_at), 'YYYY-MM') AS mon,
               jsonb_build_object(
                 'month', to_char(date_trunc('month', w.created_at), 'YYYY-MM'),
                 'in_ican',  COALESCE(sum(w.amount_ican) FILTER (WHERE w.direction = 'in'), 0),
                 'out_ican', COALESCE(sum(w.amount_ican) FILTER (WHERE w.direction = 'out'), 0),
                 'transactions', count(*)) AS j
          FROM public.ican_business_wallet_transactions w
         WHERE w.business_profile_id = v_biz AND w.status = 'completed'
           AND w.created_at >= date_trunc('month', now()) - interval '5 months'
         GROUP BY date_trunc('month', w.created_at)
      ) m;
    v_out := v_out || jsonb_build_object('business_finances', v_tmp);
  END IF;

  -- Audit trail: one entry per person per policy per 10 minutes, and only when something was actually shared.
  IF cardinality(v_shared) > 0 AND NOT EXISTS (
       SELECT 1 FROM public.ins_data_access_log l
        WHERE l.policy_id = p_policy_id AND l.accessed_by = auth.uid() AND l.created_at > now() - interval '10 minutes') THEN
    INSERT INTO public.ins_data_access_log (policy_id, insurer_id, accessed_by, scopes)
    VALUES (p_policy_id, v_pol.insurer_id, auth.uid(), v_shared);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'policy', jsonb_build_object(
      'policy_number', v_pol.policy_number, 'plan', v_pl.name, 'cover_type', v_pol.cover_type,
      'state', public.ins_policy_state(v_pol.status, v_pol.cover_starts_at, v_pol.ends_at),
      'insured_kind', v_pol.insured_kind, 'insured_label', v_pol.insured_label,
      'insured_name', CASE WHEN v_pol.insured_kind = 'business'
                           THEN (SELECT bp.business_name FROM public.business_profiles bp WHERE bp.id = v_pol.insured_business_id)
                           ELSE public.ins_display_name(v_pol.insured_user_id) END,
      'started_at', v_pol.started_at, 'ends_at', v_pol.ends_at),
    'shared_scopes', to_jsonb(v_shared),
    'holder_scopes', to_jsonb(COALESCE(v_c.holder_scopes, '{}')),
    'business_scopes', to_jsonb(COALESCE(v_c.business_scopes, '{}')),
    'data', v_out);
END;
$$;

-- ----------------------------------------------------------------------------
-- 11. Messages (holder <-> insurer, per policy, optionally about one claim)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ins_list_messages(p_policy_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_roles TEXT[] := public.ins_policy_roles(p_policy_id);
  v_insurer_side BOOLEAN;
  v_name TEXT;
BEGIN
  IF cardinality(v_roles) = 0 THEN
    RETURN '[]'::JSONB;
  END IF;
  v_insurer_side := 'insurer' = ANY (v_roles) AND NOT (v_roles && ARRAY['insured', 'payer', 'business']);
  SELECT i.display_name INTO v_name FROM public.ins_policies p JOIN public.ins_insurers i ON i.id = p.insurer_id WHERE p.id = p_policy_id;

  IF v_insurer_side THEN
    UPDATE public.ins_messages SET read_by_insurer_at = now()
     WHERE policy_id = p_policy_id AND side = 'holder' AND read_by_insurer_at IS NULL;
  ELSE
    UPDATE public.ins_messages SET read_by_holder_at = now()
     WHERE policy_id = p_policy_id AND side = 'insurer' AND read_by_holder_at IS NULL;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', m.id, 'side', m.side, 'body', m.body, 'created_at', m.created_at, 'claim_id', m.claim_id,
             'mine', (m.sender_user_id = auth.uid()),
             'sender_name', CASE m.side WHEN 'insurer' THEN v_name WHEN 'system' THEN 'IcanEra'
                                        ELSE public.ins_display_name(m.sender_user_id) END)
           ORDER BY m.created_at)
      FROM (SELECT * FROM public.ins_messages WHERE policy_id = p_policy_id ORDER BY created_at DESC LIMIT 200) m
  ), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.ins_post_message(p_policy_id UUID, p_body TEXT, p_claim_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_roles TEXT[] := public.ins_policy_roles(p_policy_id);
  v_body  TEXT := NULLIF(btrim(p_body), '');
  v_side  TEXT;
BEGIN
  IF cardinality(v_roles) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Policy not found');
  END IF;
  IF v_body IS NULL OR char_length(v_body) > 2000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Write a message of up to 2000 characters');
  END IF;
  IF p_claim_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ins_claims c WHERE c.id = p_claim_id AND c.policy_id = p_policy_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Claim not found on this policy');
  END IF;
  IF (SELECT count(*) FROM public.ins_messages m
       WHERE m.sender_user_id = auth.uid() AND m.created_at > now() - interval '1 hour') >= 30 THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are sending messages too quickly. Please wait a little.');
  END IF;

  v_side := CASE WHEN v_roles && ARRAY['insured', 'payer', 'business'] THEN 'holder' ELSE 'insurer' END;
  INSERT INTO public.ins_messages (policy_id, claim_id, sender_user_id, side, body, read_by_holder_at, read_by_insurer_at)
  VALUES (p_policy_id, p_claim_id, auth.uid(), v_side, v_body,
          CASE WHEN v_side = 'holder'  THEN now() END,
          CASE WHEN v_side = 'insurer' THEN now() END);

  -- The holder answering a request for information puts the claim back in the insurer's queue.
  IF v_side = 'holder' AND p_claim_id IS NOT NULL THEN
    UPDATE public.ins_claims SET status = 'in_review', updated_at = now()
     WHERE id = p_claim_id AND status = 'info_needed';
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ----------------------------------------------------------------------------
-- 12. Claims
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ins_file_claim(
  p_policy_id UUID, p_incident_date DATE, p_description TEXT,
  p_amount_claimed_ican NUMERIC DEFAULT NULL, p_ride_id UUID DEFAULT NULL,
  p_evidence_urls TEXT[] DEFAULT ARRAY[]::TEXT[]
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg  public.ins_settings := public.ins_cfg();
  v_pol  public.ins_policies%ROWTYPE;
  v_plan public.ins_plans%ROWTYPE;
  v_desc TEXT := NULLIF(btrim(p_description), '');
  v_urls TEXT[];
  v_id   UUID;
  v_num  TEXT;
BEGIN
  IF NOT (public.ins_policy_roles(p_policy_id) && ARRAY['insured', 'payer', 'business']) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Policy not found');
  END IF;
  SELECT * INTO v_pol FROM public.ins_policies WHERE id = p_policy_id;
  SELECT * INTO v_plan FROM public.ins_plans WHERE id = v_pol.plan_id;
  IF v_pol.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This policy was cancelled');
  END IF;
  IF p_incident_date IS NULL OR p_incident_date > current_date THEN
    RETURN jsonb_build_object('success', false, 'error', 'Choose the date it happened (not in the future)');
  END IF;
  IF p_incident_date < v_pol.cover_starts_at::DATE THEN
    RETURN jsonb_build_object('success', false, 'error', 'That happened before your cover started (' ||
      to_char(v_pol.cover_starts_at, 'DD Mon YYYY') || '), so it cannot be claimed');
  END IF;
  IF p_incident_date > (v_pol.ends_at + make_interval(days => v_cfg.grace_days))::DATE THEN
    RETURN jsonb_build_object('success', false, 'error', 'That date is after your cover ended');
  END IF;
  IF v_desc IS NULL OR char_length(v_desc) NOT BETWEEN 10 AND 2000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Describe what happened (10 to 2000 characters)');
  END IF;
  IF p_amount_claimed_ican IS NOT NULL AND (p_amount_claimed_ican <= 0 OR p_amount_claimed_ican > v_plan.cover_limit_ican) THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('The amount must be more than 0 and at most the cover limit of %s ICAN', v_plan.cover_limit_ican));
  END IF;
  v_urls := ARRAY(SELECT btrim(x) FROM unnest(COALESCE(p_evidence_urls, ARRAY[]::TEXT[])) x WHERE btrim(x) <> '');
  IF cardinality(v_urls) > 6 OR EXISTS (SELECT 1 FROM unnest(v_urls) u WHERE u !~* '^https://' OR char_length(u) > 500) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Add up to 6 evidence links, each starting with https://');
  END IF;
  IF (SELECT count(*) FROM public.ins_claims c
       WHERE c.policy_id = p_policy_id AND c.status IN ('submitted', 'in_review', 'info_needed', 'approved')) >= 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'This policy already has 10 open claims');
  END IF;

  v_num := 'CLM-' || lpad(nextval('public.ins_claim_seq')::TEXT, 8, '0');
  INSERT INTO public.ins_claims
    (claim_number, policy_id, insurer_id, filed_by, incident_date, description,
     amount_claimed_ican, related_ride_id, evidence_urls)
  VALUES
    (v_num, p_policy_id, v_pol.insurer_id, auth.uid(), p_incident_date, v_desc,
     p_amount_claimed_ican, p_ride_id, v_urls)
  RETURNING id INTO v_id;
  INSERT INTO public.ins_messages (policy_id, claim_id, side, body)
  VALUES (p_policy_id, v_id, 'system', 'Claim ' || v_num || ' was submitted.');
  RETURN jsonb_build_object('success', true, 'claim_id', v_id, 'claim_number', v_num);
END;
$$;

CREATE OR REPLACE FUNCTION public.ins_my_claims(p_policy_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::JSONB;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'claim_id', c.id, 'claim_number', c.claim_number, 'policy_id', c.policy_id,
             'policy_number', p.policy_number, 'plan', pl.name, 'insurer', i.display_name,
             'incident_date', c.incident_date, 'description', c.description,
             'amount_claimed_ican', c.amount_claimed_ican, 'evidence_urls', to_jsonb(c.evidence_urls),
             'status', c.status, 'insurer_note', c.insurer_note, 'approved_amount_ican', c.approved_amount_ican,
             'decided_at', c.decided_at, 'paid_at', c.paid_at, 'created_at', c.created_at)
           ORDER BY c.created_at DESC)
      FROM public.ins_claims c
      JOIN public.ins_policies p ON p.id = c.policy_id
      JOIN public.ins_plans pl ON pl.id = p.plan_id
      JOIN public.ins_insurers i ON i.id = c.insurer_id
     WHERE (p_policy_id IS NULL OR c.policy_id = p_policy_id)
       AND (p.insured_user_id = auth.uid()
            OR (p.payer_kind = 'user' AND p.payer_user_id = auth.uid())
            OR (p.payer_business_id IS NOT NULL AND public.ican_business_member(p.payer_business_id))
            OR (p.insured_business_id IS NOT NULL AND public.ican_business_member(p.insured_business_id)))
  ), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.ins_insurer_claims(p_insurer_id UUID, p_status TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_i public.ins_insurers%ROWTYPE;
BEGIN
  SELECT * INTO v_i FROM public.ins_insurers WHERE id = p_insurer_id;
  IF NOT FOUND OR NOT public.ican_business_member(v_i.business_profile_id) THEN
    RETURN '[]'::JSONB;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'claim_id', c.id, 'claim_number', c.claim_number, 'policy_id', c.policy_id,
             'policy_number', p.policy_number, 'plan', pl.name, 'cover_limit_ican', pl.cover_limit_ican,
             'insured_name', CASE WHEN p.insured_kind = 'business'
                                  THEN (SELECT bp.business_name FROM public.business_profiles bp WHERE bp.id = p.insured_business_id)
                                  ELSE public.ins_display_name(p.insured_user_id) END,
             'insured_label', p.insured_label,
             'incident_date', c.incident_date, 'description', c.description,
             'amount_claimed_ican', c.amount_claimed_ican, 'evidence_urls', to_jsonb(c.evidence_urls),
             'status', c.status, 'insurer_note', c.insurer_note, 'approved_amount_ican', c.approved_amount_ican,
             'decided_at', c.decided_at, 'paid_at', c.paid_at, 'created_at', c.created_at,
             'age_days', GREATEST(0, (current_date - c.created_at::DATE)))
           ORDER BY (c.status IN ('submitted', 'in_review', 'info_needed', 'approved')) DESC, c.created_at DESC)
      FROM public.ins_claims c
      JOIN public.ins_policies p ON p.id = c.policy_id
      JOIN public.ins_plans pl ON pl.id = p.plan_id
     WHERE c.insurer_id = p_insurer_id AND (p_status IS NULL OR c.status = p_status)
  ), '[]'::JSONB);
END;
$$;

-- Review a claim. Asking for information and moving to review is any staff member's job;
-- approving or rejecting is an owner/administrator's.
CREATE OR REPLACE FUNCTION public.ins_insurer_update_claim(
  p_claim_id UUID, p_status TEXT, p_note TEXT DEFAULT NULL, p_approved_amount NUMERIC DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_c    public.ins_claims%ROWTYPE;
  v_i    public.ins_insurers%ROWTYPE;
  v_pl   public.ins_plans%ROWTYPE;
  v_note TEXT := NULLIF(btrim(p_note), '');
  v_body TEXT;
BEGIN
  SELECT * INTO v_c FROM public.ins_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Claim not found');
  END IF;
  SELECT * INTO v_i FROM public.ins_insurers WHERE id = v_c.insurer_id;
  IF NOT public.ican_business_member(v_i.business_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Claim not found');
  END IF;
  IF p_status NOT IN ('in_review', 'info_needed', 'approved', 'rejected', 'closed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown claim status');
  END IF;
  IF v_c.status IN ('paid', 'rejected', 'closed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'This claim is already ' || v_c.status);
  END IF;
  IF p_status IN ('approved', 'rejected') AND NOT public.ican_business_admin(v_i.business_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only an owner or administrator can approve or reject a claim');
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 1000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'The note can be at most 1000 characters');
  END IF;

  IF p_status = 'rejected' AND (v_note IS NULL OR char_length(v_note) < 5) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Say why the claim is rejected');
  END IF;
  IF p_status = 'info_needed' AND v_note IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Say what information you need');
  END IF;
  IF p_status = 'approved' THEN
    SELECT pl.* INTO v_pl FROM public.ins_policies p JOIN public.ins_plans pl ON pl.id = p.plan_id WHERE p.id = v_c.policy_id;
    IF p_approved_amount IS NULL OR p_approved_amount <= 0 OR p_approved_amount > v_pl.cover_limit_ican THEN
      RETURN jsonb_build_object('success', false, 'error',
        format('Enter the approved amount: more than 0 and at most the cover limit of %s ICAN', v_pl.cover_limit_ican));
    END IF;
  END IF;

  UPDATE public.ins_claims SET
    status = p_status,
    insurer_note = COALESCE(v_note, insurer_note),
    approved_amount_ican = CASE WHEN p_status = 'approved' THEN ROUND(p_approved_amount, 8) ELSE approved_amount_ican END,
    decided_at = CASE WHEN p_status IN ('approved', 'rejected', 'closed') THEN now() ELSE decided_at END,
    decided_by = CASE WHEN p_status IN ('approved', 'rejected', 'closed') THEN auth.uid() ELSE decided_by END,
    updated_at = now()
  WHERE id = p_claim_id;

  v_body := format('Claim %s: %s%s.', v_c.claim_number,
    CASE p_status WHEN 'in_review' THEN 'under review' WHEN 'info_needed' THEN 'more information needed'
                  WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE 'closed' END,
    CASE WHEN v_note IS NOT NULL THEN ' — ' || v_note ELSE '' END);
  INSERT INTO public.ins_messages (policy_id, claim_id, side, body, read_by_insurer_at)
  VALUES (v_c.policy_id, p_claim_id, 'insurer', v_body, now());
  RETURN jsonb_build_object('success', true);
END;
$$;

-- Pay an approved claim: from the insurer's business wallet straight to the insured person's
-- (or insured business's) wallet, tithe-free. Or, for a claim paid another way, record it.
CREATE OR REPLACE FUNCTION public.ins_insurer_pay_claim(
  p_claim_id UUID, p_pin TEXT DEFAULT NULL, p_offline_reference TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_c    public.ins_claims%ROWTYPE;
  v_i    public.ins_insurers%ROWTYPE;
  v_pol  public.ins_policies%ROWTYPE;
  v_amt  NUMERIC;
  v_ref  TEXT;
  v_offline TEXT := NULLIF(btrim(p_offline_reference), '');
  v_threshold NUMERIC;
  v_balance NUMERIC;
  v_pin_err TEXT;
  v_note TEXT;
  v_owner UUID;
BEGIN
  SELECT * INTO v_c FROM public.ins_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Claim not found');
  END IF;
  SELECT * INTO v_i FROM public.ins_insurers WHERE id = v_c.insurer_id;
  IF NOT public.ican_business_admin(v_i.business_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only an owner or administrator can pay a claim');
  END IF;
  IF v_c.status <> 'approved' OR v_c.approved_amount_ican IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only an approved claim can be paid');
  END IF;
  SELECT * INTO v_pol FROM public.ins_policies WHERE id = v_c.policy_id;
  v_amt := v_c.approved_amount_ican;
  v_ref := 'ins-claim:' || v_c.id::TEXT;
  v_note := format('Insurance claim %s paid (policy %s)', v_c.claim_number, v_pol.policy_number);

  IF v_offline IS NOT NULL THEN
    IF char_length(v_offline) < 3 OR char_length(v_offline) > 120 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Enter the payment reference (3 to 120 characters)');
    END IF;
    UPDATE public.ins_claims SET status = 'paid', paid_at = now(), paid_ref = 'offline:' || v_offline, updated_at = now()
     WHERE id = v_c.id;
    INSERT INTO public.ins_messages (policy_id, claim_id, side, body, read_by_insurer_at)
    VALUES (v_c.policy_id, v_c.id, 'insurer',
            format('Claim %s was paid outside the wallet (reference %s).', v_c.claim_number, v_offline), now());
    RETURN jsonb_build_object('success', true, 'paid_ican', v_amt, 'offline', true);
  END IF;

  SELECT s.large_transaction_threshold_ican INTO v_threshold
    FROM public.ican_business_wallet_settings s WHERE s.business_profile_id = v_i.business_profile_id;
  IF v_threshold IS NOT NULL AND v_amt >= v_threshold THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('This payout is above your business-wallet approval limit of %s ICAN. Pay it another way and record the reference instead.', v_threshold));
  END IF;
  SELECT w.ican_balance INTO v_balance
    FROM public.ican_business_wallets w WHERE w.business_profile_id = v_i.business_profile_id AND w.status = 'active';
  IF COALESCE(v_balance, 0) < v_amt THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('Insufficient ICAN. Have: %s, Need: %s', COALESCE(v_balance, 0), v_amt));
  END IF;
  v_pin_err := public.ins_check_business_pin(v_i.business_profile_id, p_pin);
  IF v_pin_err IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', v_pin_err);
  END IF;

  BEGIN
    SELECT bp.user_id INTO v_owner FROM public.business_profiles bp WHERE bp.id = v_i.business_profile_id;
    PERFORM public.ins_business_wallet_debit(v_i.business_profile_id, v_amt, auth.uid(), v_ref, v_note,
                                             'insurance_claim', v_pol.insured_business_id);
    PERFORM public.ins_ledger('transfer_out', auth.uid(), NULL, v_amt, v_i.business_profile_id, v_owner, v_ref,
                              v_note, 'business_expense', NULL);

    IF v_pol.insured_kind = 'business' AND v_pol.insured_business_id IS NOT NULL THEN
      PERFORM public.ins_business_wallet_credit(v_pol.insured_business_id, v_amt, auth.uid(), v_ref, v_note,
                                                'insurance_claim',
                                                jsonb_build_object('claim_id', v_c.id, 'policy_id', v_pol.id));
      PERFORM public.ins_ledger('transfer_in', NULL, NULL, v_amt, v_pol.insured_business_id,
                                (SELECT bp.user_id FROM public.business_profiles bp WHERE bp.id = v_pol.insured_business_id),
                                v_ref, v_note, 'income', v_i.display_name);
    ELSE
      PERFORM public.get_or_create_ican_wallet(v_pol.insured_user_id);
      UPDATE public.ican_user_wallets
         SET ican_balance = ican_balance + v_amt, total_earned = total_earned + v_amt
       WHERE user_id = v_pol.insured_user_id;
      PERFORM public.ins_ledger('earn', NULL, v_pol.insured_user_id, v_amt, NULL, v_pol.insured_user_id,
                                v_ref, v_note, 'income', v_i.display_name);
    END IF;

    UPDATE public.ins_claims SET status = 'paid', paid_at = now(), paid_ref = v_ref, updated_at = now() WHERE id = v_c.id;
    INSERT INTO public.ins_messages (policy_id, claim_id, side, body, read_by_insurer_at)
    VALUES (v_c.policy_id, v_c.id, 'insurer', format('Claim %s was paid into your wallet.', v_c.claim_number), now());
    RETURN jsonb_build_object('success', true, 'paid_ican', v_amt);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  END;
END;
$$;

-- ----------------------------------------------------------------------------
-- 13. The insurer's desk: policyholders, business clients, KPIs and compliance
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ins_insurer_policies(p_insurer_id UUID, p_state TEXT DEFAULT NULL, p_limit INT DEFAULT 300)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_i public.ins_insurers%ROWTYPE;
BEGIN
  SELECT * INTO v_i FROM public.ins_insurers WHERE id = p_insurer_id;
  IF NOT FOUND OR NOT public.ican_business_member(v_i.business_profile_id) THEN
    RETURN '[]'::JSONB;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_json ORDER BY sort_end DESC)
      FROM (
        SELECT p.ends_at AS sort_end,
               jsonb_build_object(
                 'policy_id', p.id, 'policy_number', p.policy_number,
                 'state', public.ins_policy_state(p.status, p.cover_starts_at, p.ends_at),
                 'cover_type', p.cover_type, 'plan', pl.name,
                 'insured_kind', p.insured_kind, 'insured_label', p.insured_label,
                 'insured_name', CASE WHEN p.insured_kind = 'business'
                                      THEN (SELECT bp.business_name FROM public.business_profiles bp WHERE bp.id = p.insured_business_id)
                                      ELSE public.ins_display_name(p.insured_user_id) END,
                 'payer_kind', p.payer_kind,
                 'payer_name', CASE WHEN p.payer_kind = 'business'
                                    THEN (SELECT bp.business_name FROM public.business_profiles bp WHERE bp.id = p.payer_business_id)
                                    ELSE public.ins_display_name(p.payer_user_id) END,
                 'payer_business_id', p.payer_business_id,
                 'started_at', p.started_at, 'ends_at', p.ends_at, 'auto_renew', p.auto_renew,
                 'shared_scopes', to_jsonb(COALESCE(c.holder_scopes, '{}') || COALESCE(c.business_scopes, '{}')),
                 -- Contact details only where the holder chose to share their identity.
                 'email', CASE WHEN 'identity' = ANY (COALESCE(c.holder_scopes, '{}'))
                               THEN (SELECT u.email FROM auth.users u WHERE u.id = p.insured_user_id) END,
                 'unread_from_holder', (SELECT count(*) FROM public.ins_messages m
                                         WHERE m.policy_id = p.id AND m.side = 'holder' AND m.read_by_insurer_at IS NULL),
                 'open_claims', (SELECT count(*) FROM public.ins_claims cl
                                  WHERE cl.policy_id = p.id AND cl.status IN ('submitted', 'in_review', 'info_needed', 'approved'))
               ) AS row_json
          FROM public.ins_policies p
          JOIN public.ins_plans pl ON pl.id = p.plan_id
          LEFT JOIN public.ins_data_consents c ON c.policy_id = p.id
         WHERE p.insurer_id = p_insurer_id
           AND (p_state IS NULL OR public.ins_policy_state(p.status, p.cover_starts_at, p.ends_at) = p_state)
         ORDER BY p.ends_at DESC
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 300), 1), 1000)
      ) t
  ), '[]'::JSONB);
END;
$$;

-- Business clients: every company that pays for cover with this insurer.
CREATE OR REPLACE FUNCTION public.ins_insurer_clients(p_insurer_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_i public.ins_insurers%ROWTYPE;
BEGIN
  SELECT * INTO v_i FROM public.ins_insurers WHERE id = p_insurer_id;
  IF NOT FOUND OR NOT public.ican_business_member(v_i.business_profile_id) THEN
    RETURN '[]'::JSONB;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'business_id', g.business_id, 'business_name', g.business_name,
             'policies', g.policies, 'active', g.active, 'expiring_30d', g.expiring,
             'next_renewal', g.next_renewal, 'shared_business_data', g.shared,
             'open_claims', g.open_claims) ORDER BY g.active DESC, g.business_name)
      FROM (
        SELECT p.payer_business_id AS business_id,
               max(bp.business_name) AS business_name,
               count(*) AS policies,
               count(*) FILTER (WHERE public.ins_policy_state(p.status, p.cover_starts_at, p.ends_at) IN ('active', 'waiting', 'grace')) AS active,
               count(*) FILTER (WHERE p.status = 'active' AND p.ends_at BETWEEN now() AND now() + interval '30 days') AS expiring,
               min(p.ends_at) FILTER (WHERE p.status = 'active' AND p.ends_at > now()) AS next_renewal,
               bool_or(cardinality(COALESCE(c.business_scopes, '{}')) > 0) AS shared,
               (SELECT count(*) FROM public.ins_claims cl JOIN public.ins_policies p2 ON p2.id = cl.policy_id
                 WHERE p2.insurer_id = p_insurer_id AND p2.payer_business_id = p.payer_business_id
                   AND cl.status IN ('submitted', 'in_review', 'info_needed', 'approved')) AS open_claims
          FROM public.ins_policies p
          JOIN public.business_profiles bp ON bp.id = p.payer_business_id
          LEFT JOIN public.ins_data_consents c ON c.policy_id = p.id
         WHERE p.insurer_id = p_insurer_id AND p.payer_kind = 'business'
         GROUP BY p.payer_business_id
      ) g
  ), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.ins_insurer_stats(p_insurer_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_i public.ins_insurers%ROWTYPE;
BEGIN
  SELECT * INTO v_i FROM public.ins_insurers WHERE id = p_insurer_id;
  IF NOT FOUND OR NOT public.ican_business_member(v_i.business_profile_id) THEN
    RETURN '{}'::JSONB;
  END IF;
  RETURN jsonb_build_object(
    'status', v_i.status,
    'licence_expiry', v_i.licence_expiry,
    'licence_state', CASE WHEN v_i.licence_expiry < current_date THEN 'expired'
                          WHEN v_i.licence_expiry <= current_date + 30 THEN 'expiring_soon' ELSE 'valid' END,
    'licence_days_left', (v_i.licence_expiry - current_date),
    'plans_live', (SELECT count(*) FROM public.ins_plans pl WHERE pl.insurer_id = p_insurer_id AND pl.active),
    'policies_active', (SELECT count(*) FROM public.ins_policies p
                         WHERE p.insurer_id = p_insurer_id
                           AND public.ins_policy_state(p.status, p.cover_starts_at, p.ends_at) IN ('active', 'waiting', 'grace')),
    'expiring_30d', (SELECT count(*) FROM public.ins_policies p
                      WHERE p.insurer_id = p_insurer_id AND p.status = 'active'
                        AND p.ends_at BETWEEN now() AND now() + interval '30 days'),
    'premiums_30d_ican', COALESCE((SELECT sum(pm.net_ican) FROM public.ins_payments pm
                                    WHERE pm.insurer_id = p_insurer_id AND pm.created_at > now() - interval '30 days'), 0),
    'premiums_total_ican', COALESCE((SELECT sum(pm.net_ican) FROM public.ins_payments pm WHERE pm.insurer_id = p_insurer_id), 0),
    'claims_open', (SELECT count(*) FROM public.ins_claims c
                     WHERE c.insurer_id = p_insurer_id AND c.status IN ('submitted', 'in_review', 'info_needed', 'approved')),
    'claims_waiting_14d', (SELECT count(*) FROM public.ins_claims c
                            WHERE c.insurer_id = p_insurer_id AND c.status IN ('submitted', 'in_review')
                              AND c.created_at < now() - interval '14 days'),
    'claims_paid_ican', COALESCE((SELECT sum(c.approved_amount_ican) FROM public.ins_claims c
                                   WHERE c.insurer_id = p_insurer_id AND c.status = 'paid'), 0),
    'avg_decision_days', (SELECT round(avg(EXTRACT(EPOCH FROM (c.decided_at - c.created_at)) / 86400.0)::NUMERIC, 1)
                            FROM public.ins_claims c WHERE c.insurer_id = p_insurer_id AND c.decided_at IS NOT NULL),
    'data_views_30d', (SELECT count(*) FROM public.ins_data_access_log l
                        WHERE l.insurer_id = p_insurer_id AND l.created_at > now() - interval '30 days'),
    'unread_messages', (SELECT count(*) FROM public.ins_messages m JOIN public.ins_policies p ON p.id = m.policy_id
                         WHERE p.insurer_id = p_insurer_id AND m.side = 'holder' AND m.read_by_insurer_at IS NULL)
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 14. Auto-renewal (personal policies; a business always renews with its wallet PIN)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ins_run_renewals()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r      RECORD;
  v_res  JSONB;
  v_err  TEXT;
  v_n    INT := 0;
  v_grace INT := (SELECT s.grace_days FROM public.ins_settings s WHERE s.id = true);
BEGIN
  FOR r IN
    SELECT p.id, p.renew_with, p.last_renewal_error
      FROM public.ins_policies p
     WHERE p.status = 'active' AND p.auto_renew AND p.payer_kind = 'user'
       AND p.ends_at <= now() + interval '1 day'
       AND p.ends_at > now() - make_interval(days => v_grace + 5)
       AND (p.last_renewal_attempt_at IS NULL OR p.last_renewal_attempt_at < now() - interval '20 hours')
     ORDER BY p.ends_at
     LIMIT 500
  LOOP
    v_err := NULL;
    BEGIN
      v_res := public.ins_charge_policy(r.id, 'renewal', NULL, r.renew_with <> 'wallet', r.renew_with = 'points_only');
      IF COALESCE((v_res ->> 'success')::BOOLEAN, false) THEN
        v_n := v_n + 1;
      ELSE
        v_err := COALESCE(v_res ->> 'error', 'Renewal failed');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
    END;

    IF v_err IS NOT NULL THEN
      UPDATE public.ins_policies SET last_renewal_attempt_at = now(), last_renewal_error = v_err, updated_at = now() WHERE id = r.id;
      -- Tell the holder once per distinct problem, not every day.
      IF r.last_renewal_error IS DISTINCT FROM v_err THEN
        INSERT INTO public.ins_messages (policy_id, side, body)
        VALUES (r.id, 'system', 'Automatic renewal did not go through: ' || v_err || ' Top up and renew from My cover to keep your cover.');
      END IF;
    END IF;
  END LOOP;

  -- Housekeeping so this feature never makes the database grow without bound.
  DELETE FROM public.ins_data_access_log WHERE created_at < now() - interval '400 days';
  BEGIN
    DELETE FROM cron.job_run_details
     WHERE end_time < now() - interval '2 days'
       AND jobid IN (SELECT j.jobid FROM cron.job j WHERE j.jobname = 'ins-renewals');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN v_n;
END;
$$;

-- ----------------------------------------------------------------------------
-- 15. Dev panel: verify insurers, see the numbers, edit the settings
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ins_dev_overview(p_dev_token TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.ins_is_manager(p_dev_token) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN jsonb_build_object(
    'settings', (SELECT to_jsonb(s) FROM public.ins_settings s WHERE s.id),
    'insurers', jsonb_build_object(
      'pending',   (SELECT count(*) FROM public.ins_insurers WHERE status = 'pending'),
      'verified',  (SELECT count(*) FROM public.ins_insurers WHERE status = 'verified'),
      'suspended', (SELECT count(*) FROM public.ins_insurers WHERE status = 'suspended'),
      'rejected',  (SELECT count(*) FROM public.ins_insurers WHERE status = 'rejected')),
    'plans_live', (SELECT count(*) FROM public.ins_plans WHERE active),
    'policies_active', (SELECT count(*) FROM public.ins_policies p
                         WHERE public.ins_policy_state(p.status, p.cover_starts_at, p.ends_at) IN ('active', 'waiting', 'grace')),
    'policies_total', (SELECT count(*) FROM public.ins_policies),
    'premiums_30d_ican', COALESCE((SELECT sum(total_ican) FROM public.ins_payments WHERE created_at > now() - interval '30 days'), 0),
    'commission_30d_ican', COALESCE((SELECT sum(fee_ican) FROM public.ins_payments WHERE created_at > now() - interval '30 days'), 0),
    'commission_total_ican', COALESCE((SELECT sum(fee_ican) FROM public.ins_payments), 0),
    'paid_with_points_30d', COALESCE((SELECT sum(points_used) FROM public.ins_payments WHERE created_at > now() - interval '30 days'), 0),
    'claims_open', (SELECT count(*) FROM public.ins_claims WHERE status IN ('submitted', 'in_review', 'info_needed', 'approved')),
    'claims_paid_ican', COALESCE((SELECT sum(approved_amount_ican) FROM public.ins_claims WHERE status = 'paid'), 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.ins_dev_list_insurers(p_status TEXT DEFAULT NULL, p_dev_token TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.ins_is_manager(p_dev_token) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'insurer_id', i.id, 'display_name', i.display_name, 'business_name', bp.business_name,
             'owner_email', u.email, 'licence_number', i.licence_number, 'licence_expiry', i.licence_expiry,
             'licence_expired', (i.licence_expiry < current_date), 'regulator', i.regulator,
             'country_code', i.country_code, 'contact_email', i.contact_email, 'contact_phone', i.contact_phone,
             'description', i.description, 'status', i.status, 'review_note', i.review_note,
             'created_at', i.created_at, 'reviewed_at', i.reviewed_at,
             'plans', (SELECT count(*) FROM public.ins_plans pl WHERE pl.insurer_id = i.id AND pl.active),
             'policies', (SELECT count(*) FROM public.ins_policies p WHERE p.insurer_id = i.id AND p.status = 'active'
                            AND p.ends_at >= now()),
             'claims_open', (SELECT count(*) FROM public.ins_claims c WHERE c.insurer_id = i.id
                              AND c.status IN ('submitted', 'in_review', 'info_needed', 'approved')))
           ORDER BY (i.status = 'pending') DESC, i.created_at DESC)
      FROM public.ins_insurers i
      JOIN public.business_profiles bp ON bp.id = i.business_profile_id
      LEFT JOIN auth.users u ON u.id = bp.user_id
     WHERE p_status IS NULL OR i.status = p_status
  ), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.ins_dev_review_insurer(
  p_insurer_id UUID, p_decision TEXT, p_note TEXT DEFAULT NULL, p_dev_token TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status TEXT;
  v_note   TEXT := NULLIF(btrim(p_note), '');
BEGIN
  IF NOT public.ins_is_manager(p_dev_token) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  v_status := CASE p_decision
    WHEN 'verify' THEN 'verified' WHEN 'reinstate' THEN 'verified'
    WHEN 'suspend' THEN 'suspended' WHEN 'reject' THEN 'rejected' END;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown decision');
  END IF;
  IF v_status IN ('suspended', 'rejected') AND v_note IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Give a reason; the insurer will see it');
  END IF;
  IF v_status = 'verified' AND EXISTS (SELECT 1 FROM public.ins_insurers WHERE id = p_insurer_id AND licence_expiry < current_date) THEN
    RETURN jsonb_build_object('success', false, 'error', 'The licence has expired. Ask the insurer to update it first.');
  END IF;
  UPDATE public.ins_insurers
     SET status = v_status, review_note = v_note, reviewed_at = now(), updated_at = now()
   WHERE id = p_insurer_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insurer not found');
  END IF;
  RETURN jsonb_build_object('success', true, 'status', v_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.ins_dev_update_settings(p_patch JSONB, p_dev_token TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_s public.ins_settings%ROWTYPE;
BEGIN
  IF NOT public.ins_is_manager(p_dev_token) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  UPDATE public.ins_settings SET
    enabled               = COALESCE((p_patch ->> 'enabled')::BOOLEAN, enabled),
    platform_fee_pct      = COALESCE((p_patch ->> 'platform_fee_pct')::NUMERIC, platform_fee_pct),
    points_per_ican       = COALESCE((p_patch ->> 'points_per_ican')::NUMERIC, points_per_ican),
    grace_days            = COALESCE((p_patch ->> 'grace_days')::INT, grace_days),
    group_min_members     = COALESCE((p_patch ->> 'group_min_members')::INT, group_min_members),
    max_data_discount_pct = COALESCE((p_patch ->> 'max_data_discount_pct')::NUMERIC, max_data_discount_pct),
    updated_at = now()
  WHERE id = true
  RETURNING * INTO v_s;
  RETURN jsonb_build_object('success', true, 'settings', to_jsonb(v_s));
EXCEPTION WHEN check_violation OR invalid_text_representation THEN
  RETURN jsonb_build_object('success', false, 'error', 'One of the values is out of range. Fee 0-25%, points per ICAN above 0, grace 0-30 days, group size 2 or more, data discount 0-50%.');
END;
$$;

-- ----------------------------------------------------------------------------
-- 16. Grants
-- ----------------------------------------------------------------------------
-- Internal helpers: nobody calls these from the API.
REVOKE ALL ON FUNCTION public.ins_cfg() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ins_is_manager(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ins_display_name(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ins_live_price_for_user(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ins_policy_state(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ins_amounts(NUMERIC, NUMERIC, NUMERIC, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ins_points_balance(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ins_points_spend(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ins_check_business_pin(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ins_business_wallet_credit(UUID, NUMERIC, UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ins_business_wallet_debit(UUID, NUMERIC, UUID, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ins_ledger(TEXT, UUID, UUID, NUMERIC, UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ins_policy_roles(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ins_policy_json(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ins_charge_policy(UUID, TEXT, UUID, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ins_policy_public_summary(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ins_run_renewals() FROM PUBLIC, anon, authenticated;

-- Signed-in users.
DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'ins_register_insurer(UUID, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)',
    'ins_update_insurer(UUID, JSONB)',
    'ins_my_insurers()',
    'ins_save_plan(UUID, UUID, JSONB)',
    'ins_insurer_plans(UUID)',
    'ins_list_plans(TEXT, TEXT, TEXT)',
    'ins_quote(UUID, INT, TEXT[])',
    'ins_subscribe_personal(UUID, UUID, BOOLEAN, BOOLEAN, TEXT[], BOOLEAN, TEXT)',
    'ins_subscribe_business(UUID, UUID, TEXT, UUID[], TEXT)',
    'ins_renew_policy(UUID, BOOLEAN, BOOLEAN, TEXT)',
    'ins_set_auto_renew(UUID, BOOLEAN, TEXT)',
    'ins_cancel_policy(UUID, TEXT)',
    'ins_my_policies()',
    'ins_business_policies(UUID)',
    'ins_policy_payments(UUID)',
    'ins_my_cover_status(UUID)',
    'ins_set_data_consent(UUID, TEXT[])',
    'ins_set_business_data_consent(UUID, TEXT[])',
    'ins_policy_access_log(UUID)',
    'ins_insurer_policy_data(UUID)',
    'ins_list_messages(UUID)',
    'ins_post_message(UUID, TEXT, UUID)',
    'ins_file_claim(UUID, DATE, TEXT, NUMERIC, UUID, TEXT[])',
    'ins_my_claims(UUID)',
    'ins_insurer_claims(UUID, TEXT)',
    'ins_insurer_update_claim(UUID, TEXT, TEXT, NUMERIC)',
    'ins_insurer_pay_claim(UUID, TEXT, TEXT)',
    'ins_insurer_policies(UUID, TEXT, INT)',
    'ins_insurer_clients(UUID)',
    'ins_insurer_stats(UUID)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- Dev panel: the function itself is the gate (same convention as the other ican_dev_* functions).
REVOKE ALL ON FUNCTION public.ins_dev_overview(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ins_dev_list_insurers(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ins_dev_review_insurer(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ins_dev_update_settings(JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ins_dev_overview(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ins_dev_list_insurers(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ins_dev_review_insurer(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ins_dev_update_settings(JSONB, TEXT) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 17. Daily auto-renewal (one cron row a day: the Free Plan log stays tiny)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule('ins-renewals');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
DO $$
BEGIN
  PERFORM cron.schedule('ins-renewals', '17 3 * * *', 'SELECT public.ins_run_renewals();');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron is not available here, so auto-renewal is not scheduled: %', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ IcanEra Cover installed. Insurers register in the Compliance > Insurance tab and are verified from the ICAN dev panel (Insurance tab). Commission and points rate are editable there.';
END $$;
