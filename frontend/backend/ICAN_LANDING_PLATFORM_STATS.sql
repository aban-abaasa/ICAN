-- ============================================================================
-- Real platform stats for the public landing page — replaces the hardcoded
-- "10K+ Active Users" / "$50M+ Volume Managed" placeholders in
-- LandingPage.jsx.
--
-- active_users is deliberately basic — every row in user_accounts, i.e.
-- anyone with an account, not just wallet-balance holders (that stricter
-- "active_holders" definition lives in ican_compute_fair_price/
-- ican_get_market_snapshot for pricing purposes; this landing-page figure
-- is intentionally the broader, simpler headcount).
--
-- volume_managed_usd reuses the same real economic engine
-- ican_get_market_snapshot() already relies on (ican_compute_fair_price)
-- instead of re-deriving transaction volume from scratch — total_volume
-- there already aggregates real activity across every real-money surface
-- on the platform (personal ICAN transfers/buys/sells, PitchIn
-- business-wallet transfers, TRUST contributions/payouts, and SACCO
-- contributions/repayments — see ICAN_PRICE_ENGINE.sql). We just convert
-- that coin-equivalent volume to USD at the current fair price.
--
-- Uptime (99.9%) is deliberately NOT sourced here — it's an
-- infrastructure/hosting metric (uptime monitor / status page), not
-- something derivable from application data, so LandingPage.jsx keeps
-- that figure as a static label.
--
-- Run after ICAN_PRICE_ENGINE.sql and ICAN_LIVE_PRICING.sql.
-- ============================================================================

DROP FUNCTION IF EXISTS public.ican_get_landing_stats();

CREATE OR REPLACE FUNCTION public.ican_get_landing_stats()
RETURNS TABLE (
  active_users       BIGINT,
  volume_managed_usd NUMERIC,
  computed_at        TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- Same internal token ican_get_market_snapshot() uses to call the
  -- token-gated engine — the client never sees or needs it.
  _tok CONSTANT TEXT := 'dev_ICAN_Pr0_KV25';
  v_user_count BIGINT := 0;
BEGIN
  BEGIN
    SELECT COUNT(*) INTO v_user_count FROM public.user_accounts;
  EXCEPTION WHEN OTHERS THEN v_user_count := 0; END;

  RETURN QUERY
    SELECT
      v_user_count,
      ROUND(COALESCE(pe.total_volume, 0) * COALESCE(pe.fair_price_usd, 0), 2),
      pe.computed_at
    FROM public.ican_compute_fair_price(_tok) pe
    LIMIT 1;
END; $$;

GRANT EXECUTE ON FUNCTION public.ican_get_landing_stats() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ ican_get_landing_stats() installed — public.LandingPage.jsx can now show real active-user and volume-managed figures.';
END $$;
