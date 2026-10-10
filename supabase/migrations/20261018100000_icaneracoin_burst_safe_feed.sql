-- ============================================================================
-- icaneracoin live chart: safe when thousands of people trade, send or watch at
-- the same instant.
--
-- WHAT WAS WRONG (measured on the live project, not guessed)
--   1. Every money transaction ran ican_record_price_tick() inside its own
--      transaction, and that recomputed the whole fair price
--      (ican_compute_fair_price: ~45 ms of table scans even with 300 rows) and
--      then upserted ONE shared candle row. Concurrent transactions queued
--      behind that row lock, and each paid 45 ms+ while holding it. Under a
--      burst the wallet itself slowed to a crawl.
--   2. ican_ensure_current_candle() and ican_get_market_snapshot() are callable
--      by signed-out visitors and did the same recompute + write on EVERY call.
--      Every open chart polls both, so viewers multiplied the cost, and anyone
--      could loop them to hammer the database.
--   3. ican_record_price_tick(volume) was executable by PUBLIC (anon included),
--      so any visitor could add made-up trading volume to the chart.
--
-- WHAT THIS DOES
--   * A transaction now only appends one row to ican_price_ticks (an insert-only
--     log: no shared row, no lock, no recompute). The money path stays O(1).
--   * ican_flush_price_ticks() folds the log into the 5-minute candles and
--     refreshes a one-row price cache. It is single-flight (an advisory lock),
--     so however many callers ask, at most one does the work per freshness
--     window (2 s); the others return immediately. A burst of 10,000
--     transactions becomes ONE price computation and ONE candle write.
--   * The public RPCs read the cache. ican_get_market_snapshot() and
--     ican_ensure_current_candle() keep their names and shapes, so every
--     existing caller keeps working, but cost O(1) when the cache is fresh.
--   * ican_get_public_feed() returns candles + snapshot in ONE round trip and
--     can answer "nothing changed" or "only the newest candles" (p_since_version
--     / p_after), so a busy chart costs a few hundred bytes per poll.
--   * ican_record_price_tick / ican_flush_price_ticks / ican_current_price_ugx
--     are internal: PUBLIC, anon and authenticated can no longer execute them.
--   * pg_cron (if present) flushes every 5 s so candles stay current with no
--     viewers; a Realtime "ping" (version number only, no price data) lets open
--     charts refresh within ~a second. Both are optional and guarded.
--
-- Safe to run more than once. Rollback: supabase/rollback/20261018_rollback_burst_safe_feed.sql
-- Requires: ican_price_ohlc with unique (timeframe, open_time), ican_dev_secret(),
-- ican_compute_fair_price(TEXT) (ICAN_PRICE_ENGINE.sql, ICAN_REAL_CANDLESTICK_ENGINE.sql).
-- ============================================================================


-- 1. Storage: the tick log and the one-row price cache. Nobody reads or writes
--    these over the API; only the SECURITY DEFINER functions below touch them.
CREATE TABLE IF NOT EXISTS public.ican_price_ticks (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tick_time TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  volume    NUMERIC     NOT NULL DEFAULT 0 CHECK (volume >= 0)
);
ALTER TABLE public.ican_price_ticks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ican_price_ticks FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.ican_price_cache (
  id               BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  price_ugx        NUMERIC     NOT NULL,
  price_usd        NUMERIC,
  floor_ugx        NUMERIC,
  fx_adjusted_ugx  NUMERIC,
  appreciation_pct NUMERIC,
  ugx_depr_pct     NUMERIC,
  active_holders   BIGINT,
  tx_count         BIGINT,
  computed_at      TIMESTAMPTZ NOT NULL,                 -- when the engine produced this price
  refreshed_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), -- when the cache last re-checked it
  version          BIGINT      NOT NULL DEFAULT 1        -- bumps only when price or candles changed
);
ALTER TABLE public.ican_price_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ican_price_cache FROM PUBLIC, anon, authenticated;


-- 2. Optional push: tell open charts "something changed" (version number only --
--    never prices, so a spoofed message on a public channel can do no more than
--    make a chart re-read the authoritative feed). Silent if Realtime is absent.
CREATE OR REPLACE FUNCTION public.ican_notify_price_change(p_version BIGINT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
    EXECUTE 'SELECT realtime.send($1, $2, $3, $4)'
      USING jsonb_build_object('v', p_version), 'tick', 'icaneracoin:price', FALSE;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL; -- a missing or unavailable Realtime must never affect pricing
END; $$;
REVOKE ALL ON FUNCTION public.ican_notify_price_change(BIGINT) FROM PUBLIC, anon, authenticated;


-- 3. The flusher. Returns TRUE when THIS call did the work.
--    p_force : recompute even if the cache is fresh (the cron job and tests).
--    p_wait  : if another call is already flushing, wait for it instead of
--              skipping (used by trades, which need a fresh price, not a skip).
DROP FUNCTION IF EXISTS public.ican_flush_price_ticks();
CREATE OR REPLACE FUNCTION public.ican_flush_price_ticks(p_force BOOLEAN DEFAULT FALSE, p_wait BOOLEAN DEFAULT FALSE)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fresh   CONSTANT INTERVAL := INTERVAL '2 seconds';
  v_lock    CONSTANT BIGINT   := hashtextextended('ican_flush_price_ticks', 0);
  v_refreshed TIMESTAMPTZ;
  v_old_price NUMERIC;
  v_old_tx    BIGINT;
  v_ticks     INT := 0;
  v_changed   BOOLEAN := FALSE;
  v_rows      INT;
  v_version   BIGINT;
  v_cur       TIMESTAMPTZ := to_timestamp(floor(extract(epoch FROM clock_timestamp()) / 300) * 300);
  v_cur_vol   NUMERIC := 0;
  v_cur_n     INT := 0;
  v_prev      NUMERIC;
  s           RECORD;
  b           RECORD;
BEGIN
  SELECT refreshed_at INTO v_refreshed FROM public.ican_price_cache WHERE id;
  IF NOT p_force AND v_refreshed IS NOT NULL AND clock_timestamp() - v_refreshed < v_fresh THEN
    RETURN FALSE;                                  -- somebody did this a moment ago
  END IF;

  IF p_wait THEN
    PERFORM pg_advisory_xact_lock(v_lock);
  ELSIF NOT pg_try_advisory_xact_lock(v_lock) THEN
    RETURN FALSE;                                  -- somebody is doing it right now
  END IF;

  -- The one that just finished may have refreshed the cache while we waited.
  SELECT refreshed_at, price_ugx, tx_count INTO v_refreshed, v_old_price, v_old_tx
    FROM public.ican_price_cache WHERE id;
  IF NOT p_force AND v_refreshed IS NOT NULL AND clock_timestamp() - v_refreshed < v_fresh THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO s FROM public.ican_compute_fair_price(public.ican_dev_secret()) LIMIT 1;
  IF s.fair_price_ugx IS NULL THEN RETURN FALSE; END IF;

  -- Take every committed tick. A tick whose transaction has not committed yet is
  -- invisible to this DELETE and is picked up by the next flush, never lost.
  FOR b IN
    WITH taken AS (DELETE FROM public.ican_price_ticks RETURNING tick_time, volume)
    SELECT to_timestamp(floor(extract(epoch FROM tick_time) / 300) * 300) AS bucket,
           SUM(volume)                       AS vol,
           COUNT(*) FILTER (WHERE volume > 0) AS n,
           COUNT(*)                          AS ticks
      FROM taken GROUP BY 1 ORDER BY 1
  LOOP
    v_ticks := v_ticks + b.ticks;
    IF b.bucket >= v_cur THEN
      v_cur_vol := v_cur_vol + b.vol;
      v_cur_n   := v_cur_n + b.n;
    ELSE
      -- Activity from an earlier window (the flush was late): credit that
      -- window's volume and leave its prices alone, opening it flat at the last
      -- known close if it has no candle yet.
      SELECT close_price INTO v_prev FROM public.ican_price_ohlc
       WHERE timeframe = '5m' AND open_time < b.bucket ORDER BY open_time DESC LIMIT 1;
      v_prev := COALESCE(v_prev, s.fair_price_ugx);
      INSERT INTO public.ican_price_ohlc
        (open_price, high_price, low_price, close_price, trading_volume, transaction_count, timeframe, open_time, close_time)
      VALUES (v_prev, v_prev, v_prev, v_prev, b.vol, b.n, '5m', b.bucket, b.bucket + INTERVAL '5 minutes')
      ON CONFLICT (timeframe, open_time) DO UPDATE SET
        trading_volume    = public.ican_price_ohlc.trading_volume + EXCLUDED.trading_volume,
        transaction_count = public.ican_price_ohlc.transaction_count + EXCLUDED.transaction_count;
      v_changed := TRUE;
    END IF;
  END LOOP;

  -- The current window: it always exists and always carries the live price.
  INSERT INTO public.ican_price_ohlc
    (open_price, high_price, low_price, close_price, trading_volume, transaction_count, timeframe, open_time, close_time)
  VALUES (s.fair_price_ugx, s.fair_price_ugx, s.fair_price_ugx, s.fair_price_ugx, v_cur_vol, v_cur_n, '5m', v_cur, clock_timestamp())
  ON CONFLICT (timeframe, open_time) DO UPDATE SET
    high_price        = GREATEST(public.ican_price_ohlc.high_price, EXCLUDED.close_price),
    low_price         = LEAST(public.ican_price_ohlc.low_price, EXCLUDED.close_price),
    close_price       = EXCLUDED.close_price,
    trading_volume    = public.ican_price_ohlc.trading_volume + EXCLUDED.trading_volume,
    transaction_count = public.ican_price_ohlc.transaction_count + EXCLUDED.transaction_count,
    close_time        = clock_timestamp()
  WHERE public.ican_price_ohlc.close_price IS DISTINCT FROM EXCLUDED.close_price
     OR EXCLUDED.trading_volume > 0 OR EXCLUDED.transaction_count > 0;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows > 0 THEN v_changed := TRUE; END IF;

  IF v_old_price IS DISTINCT FROM s.fair_price_ugx OR v_old_tx IS DISTINCT FROM s.tx_count THEN
    v_changed := TRUE;
  END IF;

  INSERT INTO public.ican_price_cache
    (id, price_ugx, price_usd, floor_ugx, fx_adjusted_ugx, appreciation_pct, ugx_depr_pct,
     active_holders, tx_count, computed_at, refreshed_at, version)
  VALUES
    (TRUE, s.fair_price_ugx, s.fair_price_usd, s.original_floor_ugx, s.fx_adjusted_floor, s.appreciation_pct,
     s.ugx_depreciation_pct, s.active_holders, s.tx_count, s.computed_at, clock_timestamp(), 1)
  ON CONFLICT (id) DO UPDATE SET
    price_ugx = EXCLUDED.price_ugx, price_usd = EXCLUDED.price_usd, floor_ugx = EXCLUDED.floor_ugx,
    fx_adjusted_ugx = EXCLUDED.fx_adjusted_ugx, appreciation_pct = EXCLUDED.appreciation_pct,
    ugx_depr_pct = EXCLUDED.ugx_depr_pct, active_holders = EXCLUDED.active_holders,
    tx_count = EXCLUDED.tx_count, computed_at = EXCLUDED.computed_at, refreshed_at = EXCLUDED.refreshed_at,
    version = public.ican_price_cache.version + CASE WHEN v_changed THEN 1 ELSE 0 END
  RETURNING version INTO v_version;

  IF v_changed THEN PERFORM public.ican_notify_price_change(v_version); END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION public.ican_flush_price_ticks(BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;


-- 4. What a money transaction calls (the triggers already do, by this name and
--    signature): one insert, nothing else. Bookkeeping must never fail a
--    payment, and a client must never be able to call it.
CREATE OR REPLACE FUNCTION public.ican_record_price_tick(p_volume_contribution NUMERIC DEFAULT 0)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.ican_price_ticks (volume)
  VALUES (GREATEST(COALESCE(p_volume_contribution, 0), 0));
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ican_record_price_tick skipped: %', SQLERRM;
END; $$;
REVOKE ALL ON FUNCTION public.ican_record_price_tick(NUMERIC) FROM PUBLIC, anon, authenticated;


-- 5. The price a trade executes at: the cache, never older than p_max_age_s
--    seconds (it waits for an in-flight refresh instead of using a stale one).
CREATE OR REPLACE FUNCTION public.ican_current_price_ugx(p_max_age_s NUMERIC DEFAULT 3)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_price NUMERIC;
  v_at    TIMESTAMPTZ;
BEGIN
  SELECT price_ugx, refreshed_at INTO v_price, v_at FROM public.ican_price_cache WHERE id;
  IF v_price IS NULL OR clock_timestamp() - v_at > make_interval(secs => GREATEST(p_max_age_s, 0)) THEN
    PERFORM public.ican_flush_price_ticks(TRUE, TRUE);
    SELECT price_ugx INTO v_price FROM public.ican_price_cache WHERE id;
  END IF;
  RETURN v_price;
END; $$;
REVOKE ALL ON FUNCTION public.ican_current_price_ugx(NUMERIC) FROM PUBLIC, anon, authenticated;


-- 6. The public surface. Same names, same shapes as before.
CREATE OR REPLACE FUNCTION public.ican_ensure_current_candle()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ican_flush_price_ticks(FALSE, FALSE);
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_ensure_current_candle() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.ican_get_market_snapshot()
RETURNS TABLE (
  price_ugx        NUMERIC,
  price_usd        NUMERIC,
  floor_ugx        NUMERIC,
  fx_adjusted_ugx  NUMERIC,
  appreciation_pct NUMERIC,
  ugx_depr_pct     NUMERIC,
  active_holders   BIGINT,
  tx_count         BIGINT,
  computed_at      TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ican_flush_price_ticks(FALSE, FALSE);
  RETURN QUERY
    SELECT c.price_ugx, c.price_usd, c.floor_ugx, c.fx_adjusted_ugx, c.appreciation_pct,
           c.ugx_depr_pct, c.active_holders, c.tx_count, c.computed_at
      FROM public.ican_price_cache c WHERE c.id;
  IF NOT FOUND THEN                                 -- cache could not be filled: ask the engine directly
    RETURN QUERY
      SELECT pe.fair_price_ugx, pe.fair_price_usd, pe.original_floor_ugx, pe.fx_adjusted_floor,
             pe.appreciation_pct, pe.ugx_depreciation_pct, pe.active_holders, pe.tx_count, pe.computed_at
        FROM public.ican_compute_fair_price(public.ican_dev_secret()) pe LIMIT 1;
  END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_get_market_snapshot() TO anon, authenticated;

-- One round trip for the whole chart. p_since_version: the version the caller
-- already holds -- if nothing changed since, only {unchanged:true} comes back.
-- p_after: the newest candle time the caller holds -- only candles from 15
-- minutes before it onward are sent (the caller merges them over what it has and
-- re-reads everything now and then). Candles are newest first, like
-- ican_get_public_candles, and carry no user or wallet data.
CREATE OR REPLACE FUNCTION public.ican_get_public_feed(
  p_limit         INT         DEFAULT 200,
  p_since_version BIGINT      DEFAULT NULL,
  p_after         TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n       INT := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
  v_version BIGINT;
  v_snap    JSONB;
  v_candles JSONB;
BEGIN
  PERFORM public.ican_flush_price_ticks(FALSE, FALSE);

  SELECT c.version,
         jsonb_build_object(
           'price_ugx', c.price_ugx, 'price_usd', c.price_usd, 'floor_ugx', c.floor_ugx,
           'fx_adjusted_ugx', c.fx_adjusted_ugx, 'appreciation_pct', c.appreciation_pct,
           'ugx_depr_pct', c.ugx_depr_pct, 'active_holders', c.active_holders,
           'tx_count', c.tx_count, 'computed_at', c.computed_at)
    INTO v_version, v_snap
    FROM public.ican_price_cache c WHERE c.id;

  IF p_since_version IS NOT NULL AND v_version IS NOT NULL AND p_since_version = v_version THEN
    RETURN jsonb_build_object('server_time', clock_timestamp(), 'version', v_version, 'unchanged', TRUE);
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.open_time DESC), '[]'::jsonb) INTO v_candles
    FROM (
      SELECT o.id, o.open_price, o.high_price, o.low_price, o.close_price, o.trading_volume,
             o.transaction_count, o.timeframe, o.open_time, o.close_time
        FROM public.ican_price_ohlc o
       WHERE o.timeframe = '5m'
         AND (p_after IS NULL OR o.open_time >= p_after - INTERVAL '15 minutes')
       ORDER BY o.open_time DESC
       LIMIT v_n
    ) x;

  RETURN jsonb_build_object(
    'server_time', clock_timestamp(),
    'version',     v_version,
    'delta',       p_after IS NOT NULL,
    'snapshot',    v_snap,
    'candles',     v_candles
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.ican_get_public_feed(INT, BIGINT, TIMESTAMPTZ) TO anon, authenticated;


-- 7. Keep candles current with nobody watching: flush every 5 seconds.
--    Needs pg_cron >= 1.5 (second-level schedules). Skipped quietly otherwise --
--    the chart still works, because viewers and trades flush on demand.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('icaneracoin-flush-price-ticks', '5 seconds', 'SELECT public.ican_flush_price_ticks()');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'icaneracoin: could not schedule the 5-second flush (%): candles will refresh when viewers or trades ask.', SQLERRM;
END $$;


-- 8. Fill the cache and tick the current window right now.
SELECT public.ican_flush_price_ticks(TRUE, TRUE);

NOTIFY pgrst, 'reload schema';
