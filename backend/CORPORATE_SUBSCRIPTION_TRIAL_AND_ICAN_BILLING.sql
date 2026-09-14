-- ============================================================================
-- CORPORATE_SUBSCRIPTION_TRIAL_AND_ICAN_BILLING.sql
-- ============================================================================
-- Purpose:
--   1. Let a business start a 30-day free trial of a flat-priced corporate
--      plan (Team 0-10 / Business 11-30 / Corporate 31-100 employees — 101+
--      is a sales-negotiated Contract plan, never self-serve trialed).
--      Employee count only decides which TIER a business qualifies for —
--      the price itself is a flat monthly fee for that tier, not multiplied
--      by headcount.
--   2. Bill the trial's first charge, and every renewal after it, straight
--      out of the business's real IcanEra Coin wallet
--      (public.ican_business_wallets.ican_balance — the same wallet Pitchin
--      already uses; see PITCHIN_BUSINESS_PROFILE_ICAN_WALLET.sql).
--   3. Be smart about insufficient funds: never hard-cut a business the
--      moment a renewal fails. Mark it past_due, give a 5-day grace window
--      (Pitchin access stays on), and only auto-cancel if the wallet is
--      still short after that — mirroring the insufficient-balance handling
--      already used for tithes (see TITHE_CASH_WALLET_AND_NO_DOUBLE_TITHE.sql).
--   4. Never let the tier/price be client-supplied — it's derived server-side
--      from employee_count, so a business can't under-report headcount to
--      land on a cheaper tier than it actually qualifies for.
--   5. One trial per business, ever. business_profile_id is UNIQUE on the
--      subscription row, so a canceled trial can never be restarted for
--      free by signing up again.
--   6. Plans start at 10 IC/month flat (Team), rising to 20 (Business) and
--      30 (Corporate). The wallet must already hold that tier's price before
--      the trial can even start, so the first renewal in 30 days isn't a
--      guaranteed failure.
--
-- Run after PITCHIN_BUSINESS_PROFILE_ICAN_WALLET.sql (needs
-- ican_business_wallets + its access-check functions to already exist).
-- Safe to re-run. Additive only.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Subscription table — one row per business, ever
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ican_corporate_subscriptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL UNIQUE REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  tier                TEXT NOT NULL CHECK (tier IN ('team', 'business', 'corporate')),
  employee_count      INTEGER NOT NULL CHECK (employee_count >= 1),
  monthly_price_ic    NUMERIC(10,2) NOT NULL CHECK (monthly_price_ic > 0),
  storage_mb          INTEGER NOT NULL CHECK (storage_mb > 0),
  status              TEXT NOT NULL DEFAULT 'trialing'
    CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')),
  trial_ends_at       TIMESTAMPTZ NOT NULL,
  next_billing_at     TIMESTAMPTZ NOT NULL,
  past_due_since      TIMESTAMPTZ,
  canceled_at         TIMESTAMPTZ,
  cancel_reason       TEXT,
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ican_corp_subs_billing_due
  ON public.ican_corporate_subscriptions (next_billing_at)
  WHERE status IN ('trialing', 'active', 'past_due');

-- CREATE TABLE IF NOT EXISTS is a no-op once the table already exists, so an
-- installation that ran an earlier draft of this file (column named
-- rate_ic_per_employee, employee_count floor of 5) never actually picks up
-- these changes just by re-running the block above. Migrate it explicitly.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ican_corporate_subscriptions' AND column_name = 'rate_ic_per_employee'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ican_corporate_subscriptions' AND column_name = 'monthly_price_ic'
  ) THEN
    ALTER TABLE public.ican_corporate_subscriptions RENAME COLUMN rate_ic_per_employee TO monthly_price_ic;
  END IF;
END $$;

ALTER TABLE public.ican_corporate_subscriptions
  DROP CONSTRAINT IF EXISTS ican_corporate_subscriptions_employee_count_check;
ALTER TABLE public.ican_corporate_subscriptions
  ADD CONSTRAINT ican_corporate_subscriptions_employee_count_check
  CHECK (employee_count >= 1);

COMMENT ON TABLE public.ican_corporate_subscriptions IS
  'Flat-priced corporate plan state for one business (employee_count picks the tier, not the price). Grace-period billing comes out of ican_business_wallets, never a card — see fn_run_corporate_billing_cycle().';

-- Append-only billing history, separate from ican_business_wallet_transactions
-- (that table is shaped for shareholder-to-shareholder transfers with
-- approval workflows — a system subscription debit doesn't fit it).
CREATE TABLE IF NOT EXISTS public.ican_corporate_subscription_charges (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id      UUID NOT NULL REFERENCES public.ican_corporate_subscriptions(id) ON DELETE CASCADE,
  business_profile_id  UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  amount_ic            NUMERIC(18,8) NOT NULL,
  outcome              TEXT NOT NULL CHECK (outcome IN ('charged', 'insufficient_funds')),
  wallet_balance_after  NUMERIC(18,8),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ican_corp_charges_business
  ON public.ican_corporate_subscription_charges (business_profile_id, created_at DESC);

-- ------------------------------------------------------------
-- 2. Tier derivation — server-side only, never trust a client-sent tier.
--    Prices are flat per tier (10 / 20 / 30 IC), NOT multiplied by
--    employee_count — headcount only selects which row applies.
-- ------------------------------------------------------------
-- The OUT column was renamed (rate_ic_per_employee -> monthly_price_ic) from
-- an earlier draft of this file. CREATE OR REPLACE cannot change OUT-param
-- names/types, so drop first — same reasoning as fn_add_tithe's drop in
-- TITHE_CASH_WALLET_AND_NO_DOUBLE_TITHE.sql.
DROP FUNCTION IF EXISTS public.fn_corporate_tier_for_headcount(INTEGER);

CREATE OR REPLACE FUNCTION public.fn_corporate_tier_for_headcount(p_employee_count INTEGER)
RETURNS TABLE (tier TEXT, monthly_price_ic NUMERIC, storage_mb INTEGER)
LANGUAGE sql IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN p_employee_count <= 10  THEN 'team'
      WHEN p_employee_count <= 30  THEN 'business'
      WHEN p_employee_count <= 100 THEN 'corporate'
      ELSE NULL -- 101+: sales-negotiated contract, not self-serve
    END,
    CASE
      WHEN p_employee_count <= 10  THEN 10.00
      WHEN p_employee_count <= 30  THEN 20.00
      WHEN p_employee_count <= 100 THEN 30.00
      ELSE NULL
    END,
    CASE
      WHEN p_employee_count <= 10  THEN 2000
      WHEN p_employee_count <= 30  THEN 5000
      WHEN p_employee_count <= 100 THEN 15000
      ELSE NULL
    END;
$$;

-- ------------------------------------------------------------
-- 3. Start the one-time 30-day free trial
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_start_corporate_trial(
  p_business_profile_id UUID,
  p_employee_count INTEGER
)
RETURNS TABLE (success BOOLEAN, subscription_id UUID, trial_ends_at TIMESTAMPTZ, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tier   TEXT;
  v_price  NUMERIC;
  v_storage INTEGER;
  v_existing public.ican_corporate_subscriptions;
  v_new    public.ican_corporate_subscriptions;
  v_trial_end TIMESTAMPTZ;
  v_wallet_balance NUMERIC(18,8);
BEGIN
  IF NOT public.pitchin_business_wallet_operator(p_business_profile_id) THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TIMESTAMPTZ,
      'Only the highest-ownership shareholder may start a corporate subscription'::TEXT;
    RETURN;
  END IF;

  IF p_employee_count < 1 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TIMESTAMPTZ,
      'Corporate plans need at least 1 employee'::TEXT;
    RETURN;
  END IF;

  SELECT * INTO v_existing
  FROM public.ican_corporate_subscriptions
  WHERE business_profile_id = p_business_profile_id;

  IF v_existing.id IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, v_existing.id, v_existing.trial_ends_at,
      CASE
        WHEN v_existing.status = 'canceled'
          THEN 'This business already used its one free trial. Top up your IcanEra wallet and resubscribe directly — no new trial is available.'
        ELSE 'This business already has a corporate subscription (' || v_existing.status || ').'
      END::TEXT;
    RETURN;
  END IF;

  SELECT tier, monthly_price_ic, storage_mb
    INTO v_tier, v_price, v_storage
  FROM public.fn_corporate_tier_for_headcount(p_employee_count);

  IF v_tier IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TIMESTAMPTZ,
      'Teams over 100 employees need a negotiated Contract plan — contact sales for a custom quote, this plan is not self-serve.'::TEXT;
    RETURN;
  END IF;

  -- The trial itself is free, but require the wallet to already hold the
  -- tier's flat monthly price up front — otherwise the very first renewal
  -- in 30 days is guaranteed to fail. get_or_create_pitchin_business_wallet()
  -- already checks shareholder access, satisfied above by the operator check.
  v_wallet_balance := (public.get_or_create_pitchin_business_wallet(p_business_profile_id)).ican_balance;

  IF v_wallet_balance < v_price THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TIMESTAMPTZ,
      ('Top up your IcanEra wallet with at least ' || v_price || ' IC before starting your free trial on the ' || v_tier ||
       ' plan (current balance: ' || v_wallet_balance ||
       ' IC) — the trial itself is free, but this ensures your first renewal in 30 days doesn''t fail immediately.')::TEXT;
    RETURN;
  END IF;

  v_trial_end := now() + INTERVAL '30 days';

  INSERT INTO public.ican_corporate_subscriptions (
    business_profile_id, tier, employee_count, monthly_price_ic, storage_mb,
    status, trial_ends_at, next_billing_at, created_by
  ) VALUES (
    p_business_profile_id, v_tier, p_employee_count, v_price, v_storage,
    'trialing', v_trial_end, v_trial_end, auth.uid()
  ) RETURNING * INTO v_new;

  -- A trial costs nothing up front — first charge only happens at
  -- next_billing_at (= trial_ends_at), via fn_run_corporate_billing_cycle(),
  -- for the tier's flat monthly_price_ic (no employee_count multiplication).
  RETURN QUERY SELECT TRUE, v_new.id, v_new.trial_ends_at,
    ('Free 30-day trial started on the ' || v_tier || ' plan (' || v_price || ' IC/month flat, for teams up to ' ||
     p_employee_count || ' employees). Billing begins ' || to_char(v_trial_end, 'DD Mon YYYY') ||
     ', charged automatically from your IcanEra Coin wallet.')::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_start_corporate_trial(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_start_corporate_trial(UUID, INTEGER) TO authenticated;

-- ------------------------------------------------------------
-- 4. Charge one subscription — internal, no auth.uid() dependency so the
--    billing sweep (run by a scheduler / dev-panel button, not a logged-in
--    shareholder) can call it directly.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._fn_charge_corporate_subscription_row(
  p_subscription public.ican_corporate_subscriptions
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_charge   NUMERIC(18,8);
  v_wallet_id UUID;
  v_balance  NUMERIC(18,8);
  v_new_balance NUMERIC(18,8);
GRACE_DAYS CONSTANT INTEGER := 5;
BEGIN
  -- Flat tier price — NOT multiplied by employee_count.
  v_charge := p_subscription.monthly_price_ic;

  -- Auto-create the business wallet if it somehow doesn't exist yet (should
  -- already, from Pitchin onboarding) — mirrors get_or_create_pitchin_business_wallet
  -- but skips its auth.uid()-based access check, which has no meaning here.
  INSERT INTO public.ican_business_wallets (business_profile_id, created_by)
  VALUES (p_subscription.business_profile_id,
          (SELECT user_id FROM public.business_profiles WHERE id = p_subscription.business_profile_id))
  ON CONFLICT (business_profile_id) DO NOTHING;

  SELECT id, ican_balance INTO v_wallet_id, v_balance
  FROM public.ican_business_wallets
  WHERE business_profile_id = p_subscription.business_profile_id
  FOR UPDATE;

  IF v_balance >= v_charge THEN
    v_new_balance := v_balance - v_charge;

    UPDATE public.ican_business_wallets
       SET ican_balance = v_new_balance, total_spent = total_spent + v_charge, updated_at = now()
     WHERE id = v_wallet_id;

    UPDATE public.ican_corporate_subscriptions
       SET status = 'active',
           next_billing_at = p_subscription.next_billing_at + INTERVAL '1 month',
           past_due_since = NULL,
           updated_at = now()
     WHERE id = p_subscription.id;

    INSERT INTO public.ican_corporate_subscription_charges
      (subscription_id, business_profile_id, amount_ic, outcome, wallet_balance_after)
    VALUES (p_subscription.id, p_subscription.business_profile_id, v_charge, 'charged', v_new_balance);

    RETURN 'charged';
  END IF;

  -- Insufficient balance: never cut access immediately. Start (or continue)
  -- a grace window; Pitchin/CMS access stays on for GRACE_DAYS.
  IF p_subscription.past_due_since IS NOT NULL
     AND p_subscription.past_due_since <= now() - (GRACE_DAYS || ' days')::INTERVAL THEN
    UPDATE public.ican_corporate_subscriptions
       SET status = 'canceled', canceled_at = now(),
           cancel_reason = 'Wallet balance still insufficient after ' || GRACE_DAYS || '-day grace period',
           updated_at = now()
     WHERE id = p_subscription.id;

    INSERT INTO public.ican_corporate_subscription_charges
      (subscription_id, business_profile_id, amount_ic, outcome, wallet_balance_after)
    VALUES (p_subscription.id, p_subscription.business_profile_id, v_charge, 'insufficient_funds', v_balance);

    RETURN 'canceled_after_grace';
  END IF;

  UPDATE public.ican_corporate_subscriptions
     SET status = 'past_due',
         past_due_since = COALESCE(past_due_since, now()),
         updated_at = now()
   WHERE id = p_subscription.id;

  INSERT INTO public.ican_corporate_subscription_charges
    (subscription_id, business_profile_id, amount_ic, outcome, wallet_balance_after)
  VALUES (p_subscription.id, p_subscription.business_profile_id, v_charge, 'insufficient_funds', v_balance);

  RETURN 'past_due';
END;
$$;

-- ------------------------------------------------------------
-- 5. Billing sweep — call this on a daily schedule (pg_cron, or a
--    dev-panel "Run billing" button) to charge everything that's due.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_run_corporate_billing_cycle()
RETURNS TABLE (business_profile_id UUID, outcome TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sub public.ican_corporate_subscriptions;
BEGIN
  FOR v_sub IN
    SELECT * FROM public.ican_corporate_subscriptions
    WHERE status IN ('trialing', 'active', 'past_due')
      AND next_billing_at <= now()
  LOOP
    RETURN QUERY SELECT v_sub.business_profile_id, public._fn_charge_corporate_subscription_row(v_sub);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_run_corporate_billing_cycle() FROM PUBLIC;
-- Intentionally NOT granted to `authenticated` — this runs with system
-- authority over every business's wallet and belongs behind the
-- dev-panel token / a service-role cron job only.

-- ------------------------------------------------------------
-- 6. Read the caller's own subscription status (for the pricing/account UI)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_get_my_corporate_subscription(p_business_profile_id UUID)
RETURNS SETOF public.ican_corporate_subscriptions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.pitchin_business_shareholder_access(p_business_profile_id) THEN
    RAISE EXCEPTION 'You do not have access to this business profile';
  END IF;

  RETURN QUERY SELECT * FROM public.ican_corporate_subscriptions
    WHERE business_profile_id = p_business_profile_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_my_corporate_subscription(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_my_corporate_subscription(UUID) TO authenticated;

-- ============================================================================
-- VERIFY
-- ============================================================================
-- SELECT * FROM public.fn_corporate_tier_for_headcount(25);
-- SELECT * FROM public.fn_start_corporate_trial('<business_profile_id>', 25);
-- SELECT * FROM public.fn_run_corporate_billing_cycle(); -- run manually or via cron
-- ============================================================================
-- END
-- ============================================================================
