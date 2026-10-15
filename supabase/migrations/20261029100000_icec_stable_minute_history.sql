-- ============================================================================
-- ICEC-S chart history: one point EVERY MINUTE (was one an hour).
--
-- WHY
--   The unit's price is already live to the minute: the backend refreshes public.ican_currency_rates every minute from the
--   Google Sheet (GOOGLEFINANCE). But the chart's history (icanera_stable.price_history) was written at most once an hour,
--   so a day showed a flat dash while the same rate on Google moved all day.
--
-- WHAT CHANGES
--   1. snapshot_price() writes one row per minute (taken_at = the minute), at most one per minute however many callers.
--   2. pg_cron runs it every minute. Without pg_cron the screen's own calls still take the point, as before.
--   3. ican_stable_history() returns the last 24 hours at minute resolution, then one point per hour before that
--      (p_limit now caps those older hourly points). The chart groups the points into 5m / 15m / 1H / 4H / 1D itself.
--   4. A nightly job keeps minute rows for 7 days, and the first (on-the-hour) row of every hour for good, so the
--      table stays small and the hourly history already recorded is untouched.
--
-- Nothing is simulated: a row is the unit's real value (live rate or inflation floor) at that minute. A minute nobody
-- recorded (job down, nobody watching) is simply absent and the chart joins the two neighbours.
-- Safe to run more than once. Requires 20261024100000_icec_stable_in_system.sql.
-- ============================================================================

DO $$ BEGIN
  IF to_regclass('icanera_stable.price_history') IS NULL THEN
    RAISE EXCEPTION 'Run 20261024100000_icec_stable_in_system.sql first.';
  END IF;
END $$;

-- 1. One point per minute. A cheap existence check first, so a busy screen that calls this on every poll does no more work
--    than one index lookup once the minute is recorded.
CREATE OR REPLACE FUNCTION icanera_stable.snapshot_price() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_stable, public AS $$
DECLARE
  v RECORD;
  v_minute TIMESTAMPTZ := date_trunc('minute', now());
BEGIN
  IF EXISTS (SELECT 1 FROM icanera_stable.price_history h WHERE h.taken_at = v_minute) THEN RETURN; END IF;
  SELECT * INTO v FROM icanera_stable.unit_value();
  IF v.unit_ugx IS NULL THEN RETURN; END IF;
  INSERT INTO icanera_stable.price_history (taken_at, unit_ugx, fx_ugx, floor_ugx)
  VALUES (v_minute, v.unit_ugx, v.fx_ugx, v.floor_ugx) ON CONFLICT (taken_at) DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END; $$;
REVOKE ALL ON FUNCTION icanera_stable.snapshot_price() FROM PUBLIC, anon, authenticated;


-- 3. The chart's history (newest first): every minute of the last 24 hours, then one point an hour (the on-the-hour row)
--    for as far back as p_limit allows (default 500, at most 2000).
CREATE OR REPLACE FUNCTION public.ican_stable_history(p_limit INT DEFAULT 500)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_stable, public AS $$
DECLARE v_cut TIMESTAMPTZ := date_trunc('minute', now()) - INTERVAL '24 hours';
BEGIN
  PERFORM icanera_stable.snapshot_price();
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('t', h.taken_at, 'v', h.unit_ugx, 'fx', h.fx_ugx, 'floor', h.floor_ugx) ORDER BY h.taken_at DESC)
      FROM (
        SELECT m.taken_at, m.unit_ugx, m.fx_ugx, m.floor_ugx
          FROM icanera_stable.price_history m WHERE m.taken_at >= v_cut
        UNION ALL
        (SELECT o.taken_at, o.unit_ugx, o.fx_ugx, o.floor_ugx
           FROM icanera_stable.price_history o
          WHERE o.taken_at < v_cut AND o.taken_at = date_trunc('hour', o.taken_at)
          ORDER BY o.taken_at DESC
          LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 500), 2000)))
      ) h), '[]'::JSONB);
END; $$;
REVOKE ALL ON FUNCTION public.ican_stable_history(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_stable_history(INT) TO anon, authenticated;


-- 2 + 4. The jobs: a point every minute, and a nightly trim of old minute rows. Re-scheduling a job by name replaces it, so
--        the old hourly 'icec-stable-snapshot' (minute 6 of every hour) becomes the per-minute one.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('icec-stable-snapshot', '* * * * *', 'SELECT icanera_stable.snapshot_price()');
    PERFORM cron.schedule('icec-stable-prune-history', '47 3 * * *',
      $job$DELETE FROM icanera_stable.price_history
            WHERE taken_at < now() - INTERVAL '7 days' AND taken_at <> date_trunc('hour', taken_at)$job$);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'icec-stable: could not schedule the per-minute history (%): the screen will record it instead.', SQLERRM;
END $$;

SELECT icanera_stable.snapshot_price();
NOTIFY pgrst, 'reload schema';
