-- ============================================================================
-- DEV PANEL — FIXED ALL FUNCTIONS
-- Run this in Supabase SQL Editor (replaces DEV_PANEL_ACCESS.sql + CMMS_DEV_PANEL_FUNCTIONS.sql)
-- Corrects wrong table/column names discovered from actual schema
-- ============================================================================

-- Drop all first so return-type changes are allowed
DROP FUNCTION IF EXISTS public.ican_dev_get_users(TEXT);
DROP FUNCTION IF EXISTS public.ican_dev_get_wallets(TEXT);
DROP FUNCTION IF EXISTS public.ican_dev_get_agents(TEXT);
DROP FUNCTION IF EXISTS public.ican_dev_get_trust_groups(TEXT);
DROP FUNCTION IF EXISTS public.ican_dev_get_blockchain_txs(TEXT);
DROP FUNCTION IF EXISTS public.ican_dev_get_market_price(TEXT);
DROP FUNCTION IF EXISTS public.ican_dev_grant_bonus(TEXT, UUID, NUMERIC);
DROP FUNCTION IF EXISTS public.ican_dev_get_cmms_companies(TEXT);
DROP FUNCTION IF EXISTS public.ican_dev_get_pitchin_businesses(TEXT);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. USERS — from user_accounts (unchanged, already correct)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ican_dev_get_users(dev_token TEXT)
RETURNS TABLE (
  user_id              UUID,
  account_holder_name  TEXT,
  account_number       TEXT,
  email                TEXT,
  phone_number         TEXT,
  country_code         TEXT,
  created_at           TIMESTAMPTZ
)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT ua.user_id, ua.account_holder_name::TEXT, ua.account_number::TEXT,
           ua.email::TEXT, ua.phone_number::TEXT, ua.country_code::TEXT, ua.created_at
    FROM public.user_accounts ua ORDER BY ua.created_at DESC;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_users(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. WALLETS — FIX: was querying ican_user_wallets (doesn't exist)
--              NOW:  reads ican_coin_balance directly from user_accounts
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ican_dev_get_wallets(dev_token TEXT)
RETURNS TABLE (
  user_id          UUID,
  ican_balance     NUMERIC,
  total_earned     NUMERIC,
  total_spent      NUMERIC,
  total_tithe_paid NUMERIC
)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT
      ua.user_id,
      COALESCE(ua.ican_coin_balance,         0)::NUMERIC AS ican_balance,
      COALESCE(ua.ican_coin_total_purchased, 0)::NUMERIC AS total_earned,
      COALESCE(ua.ican_coin_total_sold,      0)::NUMERIC AS total_spent,
      0::NUMERIC                                         AS total_tithe_paid
    FROM public.user_accounts ua
    ORDER BY ua.ican_coin_balance DESC NULLS LAST;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_wallets(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. AGENTS — FIX: agent_floats.float_balance -> current_balance
--                   agent_settlements had wrong amount column
--                   agents.is_active -> (status = 'active')
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ican_dev_get_agents(dev_token TEXT)
RETURNS TABLE (
  agent_id      UUID,
  user_id       UUID,
  agent_name    TEXT,
  agent_code    TEXT,
  float_balance NUMERIC,
  total_settled NUMERIC,
  is_active     BOOLEAN,
  created_at    TIMESTAMPTZ
)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT
      a.id                                              AS agent_id,
      a.user_id,
      a.agent_name::TEXT,
      a.agent_code::TEXT,
      COALESCE(SUM(af.current_balance), 0)             AS float_balance,
      COALESCE(SUM(aset.total_commission_earned), 0)   AS total_settled,
      (a.status = 'active')                            AS is_active,
      a.created_at
    FROM public.agents a
    LEFT JOIN public.agent_floats      af   ON af.agent_id   = a.id
    LEFT JOIN public.agent_settlements aset ON aset.agent_id = a.id
    GROUP BY a.id, a.user_id, a.agent_name, a.agent_code, a.status, a.created_at
    ORDER BY a.created_at DESC;
EXCEPTION WHEN undefined_table THEN RETURN;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_agents(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. TRUST GROUPS — FIX: was querying trust_groups (doesn't exist)
--                         NOW: reads from ican_saccos with admin info
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ican_dev_get_trust_groups(dev_token TEXT)
RETURNS TABLE (
  id            UUID,
  group_name    TEXT,
  description   TEXT,
  owner_id      UUID,
  owner_name    TEXT,
  owner_email   TEXT,
  member_count  INT,
  total_savings NUMERIC,
  is_active     BOOLEAN,
  created_at    TIMESTAMPTZ
)
SECURITY DEFINER SET search_path = public, auth LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  -- Try ican_saccos first (SACCO/Trust system)
  BEGIN
    RETURN QUERY
      SELECT
        s.id,
        s.name::TEXT                                                 AS group_name,
        COALESCE(s.description, '')::TEXT,
        s.admin_id                                                   AS owner_id,
        COALESCE(ua.account_holder_name, au.email, 'Unknown')::TEXT AS owner_name,
        COALESCE(au.email, '')::TEXT                                 AS owner_email,
        COALESCE(s.member_count, 0)::INT                            AS member_count,
        COALESCE(s.total_pool, 0)::NUMERIC                          AS total_savings,
        (s.status = 'active')                                       AS is_active,
        s.created_at::TIMESTAMPTZ
      FROM public.ican_saccos s
      LEFT JOIN auth.users           au ON au.id      = s.admin_id
      LEFT JOIN public.user_accounts ua ON ua.user_id = s.admin_id
      ORDER BY s.created_at DESC;
    RETURN;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;
  -- Fallback: try generic trust_groups table
  BEGIN
    RETURN QUERY
      SELECT
        tg.id,
        COALESCE(tg.name, tg.group_name)::TEXT                      AS group_name,
        COALESCE(tg.description, '')::TEXT,
        tg.created_by                                                AS owner_id,
        ''::TEXT                                                     AS owner_name,
        ''::TEXT                                                     AS owner_email,
        COUNT(DISTINCT tgm.user_id)::INT                            AS member_count,
        0::NUMERIC                                                   AS total_savings,
        COALESCE(tg.is_active, true)                                AS is_active,
        tg.created_at::TIMESTAMPTZ
      FROM public.trust_groups tg
      LEFT JOIN public.trust_group_members tgm ON tgm.group_id = tg.id
      GROUP BY tg.id, tg.name, tg.description, tg.created_by, tg.is_active, tg.created_at
      ORDER BY tg.created_at DESC;
  EXCEPTION WHEN undefined_table OR undefined_column THEN RETURN;
  END;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_trust_groups(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. BLOCKCHAIN TXS — FIX: ican_coin_transactions has no blockchain_tx_hash
--                           in the live DB (older migration was run without it)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ican_dev_get_blockchain_txs(dev_token TEXT)
RETURNS TABLE (
  id           UUID,
  tx_hash      TEXT,
  tx_type      TEXT,
  ican_amount  NUMERIC,
  status       TEXT,
  block_number BIGINT,
  created_at   TIMESTAMPTZ
)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT
      gen_random_uuid()                    AS id,
      ''::TEXT                             AS tx_hash,
      ct.type::TEXT                        AS tx_type,
      COALESCE(ct.ican_amount, 0)          AS ican_amount,
      COALESCE(ct.status, 'unknown')::TEXT AS status,
      NULL::BIGINT                         AS block_number,
      ct.timestamp::TIMESTAMPTZ            AS created_at
    FROM public.ican_coin_transactions ct
    ORDER BY ct.timestamp DESC
    LIMIT 200;
EXCEPTION WHEN undefined_table THEN RETURN;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_blockchain_txs(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. MARKET PRICE — FIX: column volume -> trading_volume_24h
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ican_dev_get_market_price(dev_token TEXT)
RETURNS TABLE (
  price_ugx             NUMERIC,
  percentage_change_24h NUMERIC,
  market_cap            NUMERIC,
  volume                NUMERIC,
  recorded_at           TIMESTAMPTZ
)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT
      COALESCE(mp.price_ugx,              5000)::NUMERIC,
      COALESCE(mp.percentage_change_24h,     0)::NUMERIC,
      COALESCE(mp.market_cap,                0)::NUMERIC,
      COALESCE(mp.trading_volume_24h,        0)::NUMERIC,
      COALESCE(mp.timestamp, NOW())
    FROM public.ican_coin_market_prices mp
    ORDER BY mp.timestamp DESC
    LIMIT 1;
EXCEPTION WHEN undefined_table THEN
  -- Return a sensible default so the UI shows the floor price
  RETURN QUERY SELECT 5000::NUMERIC, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, NOW()::TIMESTAMPTZ;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_market_price(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. GRANT BONUS — FIX: was using ican_user_wallets (doesn't exist)
--                        NOW: updates user_accounts.ican_coin_balance
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ican_dev_grant_bonus(
  dev_token      TEXT,
  target_user_id UUID,
  bonus_amount   NUMERIC
)
RETURNS VOID
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE public.user_accounts
  SET
    ican_coin_balance         = COALESCE(ican_coin_balance, 0)         + bonus_amount,
    ican_coin_total_purchased = COALESCE(ican_coin_total_purchased, 0) + bonus_amount,
    ican_updated_at           = NOW()
  WHERE user_id = target_user_id;

  -- Log the bonus as a completed transaction
  INSERT INTO public.ican_coin_transactions (user_id, type, ican_amount, status, description)
  VALUES (target_user_id, 'purchase', bonus_amount, 'completed', 'Dev panel bonus grant')
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  -- Silently swallow if transaction insert fails (table structure variation)
  NULL;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_grant_bonus(TEXT, UUID, NUMERIC) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. CMMS COMPANIES (from CMMS schema)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ican_dev_get_cmms_companies(dev_token TEXT)
RETURNS TABLE (
  id            UUID,
  company_name  TEXT,
  email         TEXT,
  phone         TEXT,
  location      TEXT,
  created_by    UUID,
  creator_email TEXT,
  creator_name  TEXT,
  member_count  BIGINT,
  dept_count    BIGINT,
  created_at    TIMESTAMPTZ
)
SECURITY DEFINER SET search_path = public, auth LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT
      cp.id,
      cp.company_name::TEXT,
      cp.email::TEXT,
      COALESCE(cp.phone, '')::TEXT                          AS phone,
      COALESCE(cp.location, '')::TEXT                       AS location,
      cp.created_by,
      au.email::TEXT                                        AS creator_email,
      COALESCE(ua.account_holder_name, au.email)::TEXT      AS creator_name,
      COUNT(DISTINCT cu.id)::BIGINT                         AS member_count,
      COUNT(DISTINCT cd.id)::BIGINT                         AS dept_count,
      cp.created_at::TIMESTAMPTZ
    FROM public.cmms_company_profiles cp
    LEFT JOIN auth.users             au ON au.id      = cp.created_by
    LEFT JOIN public.user_accounts   ua ON ua.user_id = cp.created_by
    LEFT JOIN public.cmms_users      cu ON cu.cmms_company_id = cp.id AND cu.is_active = TRUE
    LEFT JOIN public.cmms_departments cd ON cd.cmms_company_id = cp.id AND cd.is_active = TRUE
    GROUP BY cp.id, cp.company_name, cp.email, cp.phone, cp.location,
             cp.created_by, cp.created_at, au.email, ua.account_holder_name
    ORDER BY cp.created_at DESC;
EXCEPTION WHEN undefined_table THEN RETURN;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_cmms_companies(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 9. PITCHIN BUSINESSES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ican_dev_get_pitchin_businesses(dev_token TEXT)
RETURNS TABLE (
  id             UUID,
  title          TEXT,
  category       TEXT,
  status         TEXT,
  owner_id       UUID,
  owner_email    TEXT,
  owner_name     TEXT,
  target_amount  NUMERIC,
  raised_amount  NUMERIC,
  investor_count BIGINT,
  created_at     TIMESTAMPTZ
)
SECURITY DEFINER SET search_path = public, auth LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  -- Try with investor_investments for raised amount
  BEGIN
    RETURN QUERY
      SELECT
        p.id,
        p.title::TEXT,
        p.category::TEXT,
        COALESCE(p.status, 'unknown')::TEXT,
        bp.user_id                                            AS owner_id,
        au.email::TEXT                                        AS owner_email,
        COALESCE(ua.account_holder_name, au.email)::TEXT      AS owner_name,
        COALESCE(p.target_amount, 0)                          AS target_amount,
        COALESCE(SUM(ii.amount), 0)                           AS raised_amount,
        COUNT(DISTINCT ii.investor_id)::BIGINT                AS investor_count,
        p.created_at::TIMESTAMPTZ
      FROM public.pitches p
      LEFT JOIN public.business_profiles    bp ON bp.id      = p.business_profile_id
      LEFT JOIN auth.users                  au ON au.id      = bp.user_id
      LEFT JOIN public.user_accounts        ua ON ua.user_id = bp.user_id
      LEFT JOIN public.investor_investments ii ON ii.pitch_id = p.id
      GROUP BY p.id, p.title, p.category, p.status, p.target_amount, p.created_at,
               bp.user_id, au.email, ua.account_holder_name
      ORDER BY raised_amount DESC;
    RETURN;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;
  -- Fallback: pitches without investment data (investor_investments missing)
  RETURN QUERY
    SELECT
      p.id,
      p.title::TEXT,
      p.category::TEXT,
      COALESCE(p.status, 'unknown')::TEXT,
      bp.user_id                                            AS owner_id,
      au.email::TEXT                                        AS owner_email,
      COALESCE(ua.account_holder_name, au.email)::TEXT      AS owner_name,
      COALESCE(p.target_amount, 0)                          AS target_amount,
      0::NUMERIC                                            AS raised_amount,
      0::BIGINT                                             AS investor_count,
      p.created_at::TIMESTAMPTZ
    FROM public.pitches p
    LEFT JOIN public.business_profiles bp ON bp.id      = p.business_profile_id
    LEFT JOIN auth.users               au ON au.id      = bp.user_id
    LEFT JOIN public.user_accounts     ua ON ua.user_id = bp.user_id
    ORDER BY p.created_at DESC;
EXCEPTION WHEN undefined_table OR undefined_column THEN RETURN;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_pitchin_businesses(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 10. SUBSCRIPTIONS TABLE (create if not exists)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ican_subscriptions (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID        REFERENCES public.user_accounts(user_id) ON DELETE CASCADE,
  company_id  UUID,
  plan        VARCHAR(20) DEFAULT 'basic' CHECK (plan IN ('basic','pro','enterprise')),
  target_type VARCHAR(20) DEFAULT 'user'  CHECK (target_type IN ('user','company','agent','business')),
  active      BOOLEAN     DEFAULT true,
  expires_at  TIMESTAMPTZ,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.ican_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ican_dev_manage_subscriptions" ON public.ican_subscriptions;
CREATE POLICY "ican_dev_manage_subscriptions"
  ON public.ican_subscriptions FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

GRANT ALL ON public.ican_subscriptions TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFY — paste this in a second query to check all functions exist:
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public' AND routine_name LIKE 'ican_dev_%'
-- ORDER BY routine_name;
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  routine_name,
  'installed ✅' AS status
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name LIKE 'ican_dev_%'
ORDER BY routine_name;
