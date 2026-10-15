-- ============================================================================
-- IcanEra Sector Markets: show the REAL businesses behind a sector that is still "Opening soon".
--
-- Until now a sector counted a business only once it had sales in the trailing window AND had accepted the data clause,
-- so a sector full of businesses that had just joined read "0 of 10 businesses". This adds two honest, anonymous counts
-- to each warming sector in the public feed, taken from the Pitchin business profiles (public.business_profiles):
--
--   registered : businesses on IcanEra whose profile belongs to this sector (same mapping the revenue feed uses)
--   sharing    : how many of those have accepted the sector-statistics clause (their sales will count)
--
-- WHAT THIS DOES NOT DO: it does not price anything from profile data. A sector's level still comes only from real
-- settled sales of businesses that agreed to share them, so nobody can move a tradable price by editing their profile.
-- Counts only, never names or ids, and only while a sector is warming up (like `contributors`).
--
-- The counts are cached (refreshed at most every 10 minutes, by whoever asks first) so a crowd of viewers never scans
-- the business table. Run 20261019100000..20261019130000 first. Safe to run more than once.
-- ============================================================================

DO $$ BEGIN
  IF to_regclass('icanera_trading.sector_index_cache') IS NULL THEN
    RAISE EXCEPTION 'Apply the sector trading migrations (20261019100000 to 20261019130000) first.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS icanera_trading.sector_registered_cache (
  ticker      TEXT        PRIMARY KEY,
  registered  INT         NOT NULL DEFAULT 0,
  sharing     INT         NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE icanera_trading.sector_registered_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON icanera_trading.sector_registered_cache FROM PUBLIC, anon, authenticated;

-- Recount from the business profiles. Cheap to call: it does nothing unless the cache is older than 10 minutes (or p_force),
-- and only one caller at a time does the work.
CREATE OR REPLACE FUNCTION icanera_trading.refresh_registered_businesses(p_force BOOLEAN DEFAULT FALSE)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public AS $$
BEGIN
  IF NOT p_force AND EXISTS (
       SELECT 1 FROM icanera_trading.sector_registered_cache r WHERE r.computed_at > clock_timestamp() - INTERVAL '10 minutes') THEN
    RETURN;
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('icanera_trading.refresh_registered_businesses')) THEN RETURN; END IF;

  DELETE FROM icanera_trading.sector_registered_cache WHERE TRUE;
  INSERT INTO icanera_trading.sector_registered_cache (ticker, registered, sharing, computed_at)
  SELECT x.ticker, COUNT(*)::INT, (COUNT(*) FILTER (WHERE x.agreed))::INT, clock_timestamp()
    FROM (
      SELECT icanera_trading.sector_for_business(b.id) AS ticker,
             icanera_trading.business_has_consented(b.id) AS agreed
        FROM public.business_profiles b
    ) x
   WHERE x.ticker IS NOT NULL
   GROUP BY x.ticker;
EXCEPTION WHEN OTHERS THEN
  -- a counting problem must never take the sector feed down: the cards just show what was counted last time
  RAISE WARNING 'refresh_registered_businesses: %', SQLERRM;
END; $$;
REVOKE ALL ON FUNCTION icanera_trading.refresh_registered_businesses(BOOLEAN) FROM PUBLIC, anon, authenticated;

-- The public feed, now with `registered` and `sharing` on warming sectors. (Same function as before otherwise.)
CREATE OR REPLACE FUNCTION public.ican_get_sector_feed(
  p_since_version BIGINT      DEFAULT NULL,
  p_sector        TEXT        DEFAULT NULL,
  p_after         TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public SET jit = off AS $$
DECLARE
  v_version BIGINT;
  s         icanera_trading.sector_settings;
  v_sectors JSONB;
  v_candles JSONB := NULL;
  v_tick    TEXT := NULLIF(btrim(p_sector), '');
BEGIN
  PERFORM icanera_trading.fold_sector_indices(FALSE, FALSE);
  PERFORM icanera_trading.refresh_registered_businesses(FALSE);
  SELECT f.feed_version INTO v_version FROM icanera_trading.fold_state f WHERE f.id;
  SELECT * INTO s FROM icanera_trading.sector_settings WHERE id;

  IF p_since_version IS NOT NULL AND p_since_version = v_version THEN
    RETURN jsonb_build_object('server_time', clock_timestamp(), 'version', v_version, 'unchanged', TRUE,
                              'trading_enabled', s.trading_enabled);
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::JSONB ORDER BY x.sort_order), '[]'::JSONB) INTO v_sectors
    FROM (
      SELECT k.ticker, k.name, k.description, k.sort_order,
             COALESCE(c.status, 'warming_up') AS status,
             c.level, c.price_icec,
             CASE WHEN COALESCE(c.status, 'warming_up') = 'warming_up' THEN COALESCE(c.contributors, 0) END AS contributors,
             s.k_min AS contributors_needed,
             CASE WHEN COALESCE(c.status, 'warming_up') = 'warming_up' THEN COALESCE(rb.registered, 0) END AS registered,
             CASE WHEN COALESCE(c.status, 'warming_up') = 'warming_up' THEN COALESCE(rb.sharing, 0) END AS sharing,
             (SELECT ROUND((c.level / NULLIF(o.close_level, 0) - 1) * 100, 2)
                FROM icanera_trading.sector_index_candles o
               WHERE o.ticker = k.ticker AND o.timeframe = '5m' AND o.open_time <= clock_timestamp() - INTERVAL '24 hours'
               ORDER BY o.open_time DESC LIMIT 1) AS change_24h_pct,
             c.computed_at AS updated_at,
             COALESCE(s.trading_enabled AND NOT k.admin_halted AND c.status = 'live'
                AND c.computed_at > clock_timestamp() - make_interval(secs => s.stale_s), FALSE) AS tradable
        FROM icanera_trading.sector_catalog k
        LEFT JOIN icanera_trading.sector_index_cache c ON c.ticker = k.ticker
        LEFT JOIN icanera_trading.sector_registered_cache rb ON rb.ticker = k.ticker
       WHERE k.enabled
    ) x;

  IF v_tick IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('t', y.open_time, 'o', y.open_level, 'h', y.high_level,
                                                 'l', y.low_level, 'c', y.close_level) ORDER BY y.open_time DESC), '[]'::JSONB)
      INTO v_candles
      FROM (
        SELECT o.* FROM icanera_trading.sector_index_candles o
         WHERE o.ticker = v_tick AND o.timeframe = '5m'
           AND (p_after IS NULL OR o.open_time >= p_after - INTERVAL '15 minutes')
         ORDER BY o.open_time DESC LIMIT 288
      ) y;
  END IF;

  RETURN jsonb_build_object(
    'server_time',     clock_timestamp(),
    'version',         v_version,
    'trading_enabled', s.trading_enabled,
    'fee_bps',         s.fee_bps,
    'max_trade_icec',  s.max_trade_icec,
    'sectors',         v_sectors,
    'candles_for',     v_tick,
    'candles',         v_candles
  );
END; $$;
REVOKE ALL ON FUNCTION public.ican_get_sector_feed(BIGINT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_get_sector_feed(BIGINT, TEXT, TIMESTAMPTZ) TO anon, authenticated;

-- Count once now, so the first screen already shows the businesses that are on IcanEra.
SELECT icanera_trading.refresh_registered_businesses(TRUE);

NOTIFY pgrst, 'reload schema';
