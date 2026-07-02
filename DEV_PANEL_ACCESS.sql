-- ============================================================================
-- ICAN DEV PANEL ACCESS — Run ONCE in Supabase SQL Editor
-- ============================================================================
-- Token:        dev_ICAN_Pr0_KV25   (must match DEV_TOKEN in ICANDevPanel.jsx)
-- Dev email:    icaneraera@gmail.com
-- Dev password: @1997God
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. GET ALL USER ACCOUNTS
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
    SELECT ua.user_id, ua.account_holder_name, ua.account_number,
           ua.email, ua.phone_number, ua.country_code, ua.created_at
    FROM public.user_accounts ua ORDER BY ua.created_at DESC;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_users(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. GET ALL ICAN WALLETS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ican_dev_get_wallets(dev_token TEXT)
RETURNS TABLE (
  user_id UUID, ican_balance NUMERIC, total_earned NUMERIC,
  total_spent NUMERIC, total_tithe_paid NUMERIC
)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT w.user_id, w.ican_balance, w.total_earned, w.total_spent, w.total_tithe_paid
    FROM public.ican_user_wallets w ORDER BY w.ican_balance DESC;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_wallets(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. GET ICAN TRANSACTION TOTALS PER USER
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ican_dev_get_tx_totals(dev_token TEXT)
RETURNS TABLE (recipient_user_id UUID, total_received NUMERIC, tx_count BIGINT)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT t.recipient_user_id, SUM(t.ican_amount), COUNT(*)
    FROM public.ican_coin_transactions t
    WHERE t.recipient_user_id IS NOT NULL
    GROUP BY t.recipient_user_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_tx_totals(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. GET TITHE OVERVIEW PER USER
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ican_dev_get_tithe(dev_token TEXT)
RETURNS TABLE (
  user_id UUID, total_tithe NUMERIC, tithe_paid NUMERIC,
  tithe_pending NUMERIC, last_tithe_date TIMESTAMPTZ
)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT t.user_id,
           COALESCE(SUM(t.tithe_amount), 0),
           COALESCE(SUM(CASE WHEN t.is_paid THEN t.tithe_amount ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN NOT t.is_paid THEN t.tithe_amount ELSE 0 END), 0),
           MAX(t.created_at)
    FROM public.ican_tithe_records t
    GROUP BY t.user_id;
EXCEPTION WHEN undefined_table THEN
  RETURN QUERY
    SELECT tt.user_id, COALESCE(tt.total_tithe_due,0),
           COALESCE(tt.total_tithe_paid,0),
           COALESCE(tt.total_tithe_due - tt.total_tithe_paid, 0), tt.updated_at
    FROM public.user_tithe_tracking tt;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_tithe(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. GET AGENTS + FLOAT + SETTLEMENT TOTALS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ican_dev_get_agents(dev_token TEXT)
RETURNS TABLE (
  agent_id UUID, user_id UUID, agent_name TEXT, agent_code TEXT,
  float_balance NUMERIC, total_settled NUMERIC, is_active BOOLEAN, created_at TIMESTAMPTZ
)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT a.id, a.user_id, a.agent_name, a.agent_code,
           COALESCE(af.float_balance, 0), COALESCE(SUM(aset.amount), 0),
           a.is_active, a.created_at
    FROM public.agents a
    LEFT JOIN public.agent_floats     af   ON af.agent_id   = a.id
    LEFT JOIN public.agent_settlements aset ON aset.agent_id = a.id
    GROUP BY a.id, a.user_id, a.agent_name, a.agent_code,
             af.float_balance, a.is_active, a.created_at
    ORDER BY a.created_at DESC;
EXCEPTION WHEN undefined_table THEN RETURN;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_agents(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. GET BUSINESS PROFILES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ican_dev_get_businesses(dev_token TEXT)
RETURNS TABLE (
  id UUID, user_id UUID, name TEXT, type TEXT,
  country TEXT, is_verified BOOLEAN, created_at TIMESTAMPTZ
)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT bp.id, bp.user_id, bp.name, bp.type, bp.country,
           COALESCE(bp.is_verified, false), bp.created_at
    FROM public.business_profiles bp ORDER BY bp.created_at DESC;
EXCEPTION WHEN undefined_column THEN
  RETURN QUERY
    SELECT bp.id, bp.user_id, bp.name, bp.type, bp.country, false, bp.created_at
    FROM public.business_profiles bp ORDER BY bp.created_at DESC;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_businesses(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. GET PITCHES + INVESTMENT SUMMARY
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ican_dev_get_pitches(dev_token TEXT)
RETURNS TABLE (
  id UUID, user_id UUID, title TEXT, category TEXT,
  target_amount NUMERIC, raised_amount NUMERIC, investor_count BIGINT,
  status TEXT, created_at TIMESTAMPTZ
)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT p.id, p.user_id, p.title, p.category,
           COALESCE(p.target_amount,0),
           COALESCE(SUM(ii.amount),0),
           COUNT(DISTINCT ii.investor_id),
           p.status, p.created_at
    FROM public.pitches p
    LEFT JOIN public.investor_investments ii ON ii.pitch_id = p.id
    GROUP BY p.id, p.user_id, p.title, p.category,
             p.target_amount, p.status, p.created_at
    ORDER BY raised_amount DESC;
EXCEPTION WHEN undefined_table THEN RETURN;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_pitches(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. GET TRUST GROUPS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ican_dev_get_trust_groups(dev_token TEXT)
RETURNS TABLE (
  id UUID, name TEXT, member_count BIGINT,
  total_saved NUMERIC, active_loans BIGINT, created_at TIMESTAMPTZ
)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT tg.id, tg.name,
           COUNT(DISTINCT tgm.user_id),
           COALESCE(SUM(tgt.amount) FILTER (WHERE tgt.type = 'savings'), 0),
           COUNT(DISTINCT tla.id)   FILTER (WHERE tla.status = 'active'),
           tg.created_at
    FROM public.trust_groups tg
    LEFT JOIN public.trust_group_members   tgm ON tgm.group_id = tg.id
    LEFT JOIN public.trust_transactions    tgt ON tgt.group_id = tg.id
    LEFT JOIN public.trust_loan_applications tla ON tla.group_id = tg.id
    GROUP BY tg.id, tg.name, tg.created_at ORDER BY member_count DESC;
EXCEPTION WHEN undefined_table THEN RETURN;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_trust_groups(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 9. SYSTEM TOTALS — country aggregate
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ican_dev_system_totals(dev_token TEXT)
RETURNS TABLE (
  country_code TEXT, user_count BIGINT, total_balance NUMERIC,
  total_earned NUMERIC, total_tithe NUMERIC, total_spent NUMERIC
)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT COALESCE(ua.country_code, 'unknown'),
           COUNT(DISTINCT ua.user_id),
           COALESCE(SUM(w.ican_balance),0),
           COALESCE(SUM(w.total_earned),0),
           COALESCE(SUM(w.total_tithe_paid),0),
           COALESCE(SUM(w.total_spent),0)
    FROM public.user_accounts ua
    LEFT JOIN public.ican_user_wallets w ON w.user_id = ua.user_id
    GROUP BY ua.country_code ORDER BY total_balance DESC;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_system_totals(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 10. GRANT ICAN BONUS (with 10% tithe)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ican_dev_grant_bonus(
  dev_token TEXT, target_user_id UUID, bonus_amount NUMERIC
)
RETURNS VOID
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE tithe NUMERIC; net NUMERIC;
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  tithe := ROUND(bonus_amount * 0.1, 6);
  net   := bonus_amount - tithe;
  INSERT INTO public.ican_user_wallets (user_id, ican_balance, total_earned, total_tithe_paid)
  VALUES (target_user_id, net, bonus_amount, tithe)
  ON CONFLICT (user_id) DO UPDATE SET
    ican_balance     = ican_user_wallets.ican_balance     + net,
    total_earned     = ican_user_wallets.total_earned     + bonus_amount,
    total_tithe_paid = ican_user_wallets.total_tithe_paid + tithe;
  INSERT INTO public.ican_coin_transactions (recipient_user_id, ican_amount)
  VALUES (target_user_id, net);
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_grant_bonus(TEXT, UUID, NUMERIC) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 11. GET COMPANIES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ican_dev_get_companies(dev_token TEXT)
RETURNS TABLE (
  id UUID, name TEXT, created_by UUID, member_count BIGINT,
  doc_count BIGINT, created_at TIMESTAMPTZ
)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT c.id, c.name, c.created_by,
           COUNT(DISTINCT bpm.user_id) AS member_count,
           COUNT(DISTINCT bd.id)       AS doc_count,
           c.created_at
    FROM public.companies c
    LEFT JOIN public.business_profile_members bpm ON bpm.company_id = c.id
    LEFT JOIN public.business_documents       bd  ON bd.company_id  = c.id
    GROUP BY c.id, c.name, c.created_by, c.created_at
    ORDER BY c.created_at DESC;
EXCEPTION WHEN undefined_table THEN RETURN;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_companies(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 12. GET BLOCKCHAIN TRANSACTIONS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ican_dev_get_blockchain_txs(dev_token TEXT)
RETURNS TABLE (
  id UUID, tx_hash TEXT, tx_type TEXT, ican_amount NUMERIC,
  status TEXT, block_number BIGINT, created_at TIMESTAMPTZ
)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT bt.id, bt.tx_hash, bt.tx_type,
           COALESCE(bt.ican_amount, 0),
           COALESCE(bt.status, 'unknown'),
           COALESCE(bt.block_number, 0),
           bt.created_at
    FROM public.ican_coin_blockchain_txs bt
    ORDER BY bt.created_at DESC LIMIT 200;
EXCEPTION WHEN undefined_table THEN RETURN;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_blockchain_txs(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 13. GET LIVE MARKET PRICE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ican_dev_get_market_price(dev_token TEXT)
RETURNS TABLE (
  price_ugx NUMERIC, percentage_change_24h NUMERIC,
  market_cap NUMERIC, volume NUMERIC, recorded_at TIMESTAMPTZ
)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT mp.price_ugx, COALESCE(mp.percentage_change_24h, 0),
           COALESCE(mp.market_cap, 0), COALESCE(mp.volume, 0),
           mp.timestamp
    FROM public.ican_coin_market_prices mp
    ORDER BY mp.timestamp DESC LIMIT 1;
EXCEPTION WHEN undefined_table THEN RETURN;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_market_price(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 14. GET USER NOTIFICATIONS / MESSAGES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ican_dev_get_notifications(dev_token TEXT)
RETURNS TABLE (
  id UUID, user_id UUID, notification_type TEXT,
  notification_title TEXT, notification_message TEXT,
  is_read BOOLEAN, created_at TIMESTAMPTZ
)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT n.id, n.user_id, n.notification_type,
           n.notification_title, n.notification_message,
           COALESCE(n.is_read, false), n.created_at
    FROM public.shareholder_notifications n
    ORDER BY n.created_at DESC LIMIT 200;
EXCEPTION WHEN undefined_table THEN RETURN;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_notifications(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 15. SUBSCRIPTIONS TABLE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ican_subscriptions (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID        REFERENCES public.user_accounts(user_id) ON DELETE CASCADE,
  company_id     UUID,
  plan           VARCHAR(20) DEFAULT 'basic' CHECK (plan IN ('basic','pro','enterprise')),
  target_type    VARCHAR(20) DEFAULT 'user'  CHECK (target_type IN ('user','company','agent','business')),
  active         BOOLEAN     DEFAULT true,
  expires_at     TIMESTAMPTZ,
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.ican_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ican_dev_manage_subscriptions" ON public.ican_subscriptions;
CREATE POLICY "ican_dev_manage_subscriptions"
  ON public.ican_subscriptions FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON public.ican_subscriptions TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- DONE — verify:
--   SELECT routine_name FROM information_schema.routines
--   WHERE routine_schema = 'public' AND routine_name LIKE 'ican_dev_%';
-- ─────────────────────────────────────────────────────────────────────────────
