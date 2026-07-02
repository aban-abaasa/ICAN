-- ============================================================================
-- DEV PANEL — Additional RPC functions for CMMS companies & PitchIn businesses
-- Run in Supabase SQL Editor (after DEV_PANEL_ACCESS.sql)
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- CMMS COMPANIES with creator info + member/dept counts
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ican_dev_get_cmms_companies(dev_token TEXT)
RETURNS TABLE (
  id             UUID,
  company_name   TEXT,
  email          TEXT,
  phone          TEXT,
  location       TEXT,
  created_by     UUID,
  creator_email  TEXT,
  creator_name   TEXT,
  member_count   BIGINT,
  dept_count     BIGINT,
  created_at     TIMESTAMPTZ
)
SECURITY DEFINER SET search_path = public, auth LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT
      cp.id,
      cp.company_name::TEXT,
      cp.email::TEXT,
      cp.phone::TEXT,
      cp.location::TEXT,
      cp.created_by,
      au.email::TEXT                                        AS creator_email,
      COALESCE(ua.account_holder_name, au.email)::TEXT      AS creator_name,
      COUNT(DISTINCT cu.id)                                 AS member_count,
      COUNT(DISTINCT cd.id)                                 AS dept_count,
      cp.created_at
    FROM public.cmms_company_profiles cp
    LEFT JOIN auth.users          au ON au.id  = cp.created_by
    LEFT JOIN public.user_accounts ua ON ua.user_id = cp.created_by
    LEFT JOIN public.cmms_users   cu ON cu.cmms_company_id = cp.id AND cu.is_active = TRUE
    LEFT JOIN public.cmms_departments cd ON cd.cmms_company_id = cp.id AND cd.is_active = TRUE
    GROUP BY cp.id, cp.company_name, cp.email, cp.phone, cp.location,
             cp.created_by, au.email, ua.account_holder_name
    ORDER BY cp.created_at DESC;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_cmms_companies(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- PITCHIN BUSINESSES — pitches with owner info + raised totals
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
  RETURN QUERY
    SELECT
      p.id,
      p.title::TEXT,
      p.category::TEXT,
      COALESCE(p.status, 'unknown')::TEXT,
      p.user_id                                            AS owner_id,
      au.email::TEXT                                       AS owner_email,
      COALESCE(ua.account_holder_name, au.email)::TEXT     AS owner_name,
      COALESCE(p.target_amount, 0)                         AS target_amount,
      COALESCE(SUM(ii.amount), 0)                          AS raised_amount,
      COUNT(DISTINCT ii.investor_id)                       AS investor_count,
      p.created_at
    FROM public.pitches p
    LEFT JOIN auth.users           au ON au.id     = p.user_id
    LEFT JOIN public.user_accounts ua ON ua.user_id = p.user_id
    LEFT JOIN public.investor_investments ii ON ii.pitch_id = p.id
    GROUP BY p.id, p.title, p.category, p.status,
             p.user_id, au.email, ua.account_holder_name, p.target_amount, p.created_at
    ORDER BY raised_amount DESC;
EXCEPTION WHEN undefined_table THEN RETURN;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_dev_get_pitchin_businesses(TEXT) TO anon, authenticated;


SELECT 'Dev panel CMMS + PitchIn functions installed' AS status;
