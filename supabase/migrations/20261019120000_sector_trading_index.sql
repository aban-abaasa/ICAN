-- ============================================================================
-- IcanEra Sector Markets, part 3 of 4: the sector indices.
--
-- THE INDEX
--   For each sector, over a trailing window (24 h by default):
--     1. each contributing business's revenue is summed (UGX);
--     2. each business counts at most `contributor_cap_multiple` x the sector MEDIAN, so no single
--        business, honest or not, can move the sector by itself;
--     3. V = the mean of those capped figures = "revenue per active company", the hardened form of
--        Aggregate Sector Revenue / Active Sector Companies;
--     4. V is smoothed (a time-based EMA, so the result does not depend on how often this runs) and
--        expressed as a level, 100 on the day the sector first has enough contributors:
--        level = 100 x EMA(V) / V_base. A circuit breaker limits how fast the level may move per hour.
--   The price of one index unit is level / 100 ICEC. Buying at level 100 and selling at level 130 pays
--   1.30 ICEC per ICEC put in: a bet on a sector's growth, in ICEC, whatever ICEC does against the shilling.
--
--   A sector is `warming_up` until at least k_min businesses contribute (nothing is published and
--   nobody can trade), `live` after, and `halted` when an administrator says so.
--
-- HOW IT STAYS FAST
--   Same shape as the icaneracoin chart (20261018100000_icaneracoin_burst_safe_feed.sql): the money path
--   only appends to the outbox; ONE single-flight worker folds the outbox into 5-minute buckets,
--   recomputes the indices, and writes a small cache plus candles. However many callers ask, at most
--   one does the work per 2 seconds, and a viewer never waits behind it. Viewers read the cache.
--
-- Safe to run more than once. Run 20261019100000 and 20261019110000 first.
-- ============================================================================

DO $$ BEGIN
  IF to_regclass('icanera_trading.fold_state') IS NULL THEN
    RAISE EXCEPTION 'Apply supabase/migrations/20261019100000_sector_trading_core.sql first.';
  END IF;
END $$;


-- 1. Storage: one cache row per sector, and candles.
CREATE TABLE IF NOT EXISTS icanera_trading.sector_index_cache (
  ticker       TEXT PRIMARY KEY,
  status       TEXT          NOT NULL DEFAULT 'warming_up' CHECK (status IN ('warming_up', 'live', 'halted')),
  contributors INT           NOT NULL DEFAULT 0,
  v_raw        NUMERIC,                      -- capped mean revenue per contributor in the window, UGX
  v_ema        NUMERIC,
  ema_at       TIMESTAMPTZ,                  -- when v_ema was last advanced
  v_base       NUMERIC,                      -- fixed the first time the sector has k_min contributors
  level        NUMERIC(18,6),                -- 100 at launch; NULL until then
  price_icec   NUMERIC(18,6),                -- level / 100
  version      BIGINT        NOT NULL DEFAULT 1,
  computed_at  TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
  changed_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS icanera_trading.sector_index_candles (
  ticker      TEXT          NOT NULL,
  timeframe   TEXT          NOT NULL DEFAULT '5m',
  open_time   TIMESTAMPTZ   NOT NULL,
  open_level  NUMERIC(18,6) NOT NULL,
  high_level  NUMERIC(18,6) NOT NULL,
  low_level   NUMERIC(18,6) NOT NULL,
  close_level NUMERIC(18,6) NOT NULL,
  PRIMARY KEY (ticker, timeframe, open_time)
);

ALTER TABLE icanera_trading.sector_index_cache   ENABLE ROW LEVEL SECURITY;
ALTER TABLE icanera_trading.sector_index_candles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON icanera_trading.sector_index_cache   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON icanera_trading.sector_index_candles FROM PUBLIC, anon, authenticated;


-- 2. Optional push: tell open screens "something changed" (a version number only, never levels).
CREATE OR REPLACE FUNCTION icanera_trading.notify_sector_change(p_version BIGINT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public AS $$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
    EXECUTE 'SELECT realtime.send($1, $2, $3, $4)'
      USING jsonb_build_object('v', p_version), 'tick', 'icanera:sectors', FALSE;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;                                              -- a missing Realtime must never affect an index
END; $$;
REVOKE ALL ON FUNCTION icanera_trading.notify_sector_change(BIGINT) FROM PUBLIC, anon, authenticated;


-- 2b. The ledger caches. The vault balance and the units owed per sector are sums over insert-only ledgers
--     (vault_entries, sector_fills). A trade must read them exactly and cheaply, so they are kept as a cached
--     total plus a short tail: the cache covers every entry written by a transaction older than
--     fold_state.ledger_txid, and a reader adds the entries from that boundary on, in the same statement.
--     The boundary is the oldest still-running transaction (pg_snapshot_xmin), so no entry can ever be skipped
--     because it committed after a newer one. Run by the folder below; single-flight like everything else here.
CREATE OR REPLACE FUNCTION icanera_trading.fold_ledgers()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public SET jit = off AS $$
DECLARE
  v_bound xid8 := pg_snapshot_xmin(pg_current_snapshot());
  v_last  xid8;
BEGIN
  SELECT f.ledger_txid INTO v_last FROM icanera_trading.fold_state f WHERE f.id FOR UPDATE;
  IF v_bound <= v_last THEN RETURN; END IF;           -- nothing older has finished since last time

  UPDATE icanera_trading.vault_cache
     SET balance = balance + COALESCE((SELECT SUM(e.amount) FROM icanera_trading.vault_entries e
                                        WHERE e.txid >= v_last AND e.txid < v_bound), 0),
         refreshed_at = clock_timestamp()
   WHERE id;

  INSERT INTO icanera_trading.sector_exposure (sector, net_units)
  SELECT fl.sector, SUM(CASE fl.side WHEN 'buy' THEN fl.units ELSE -fl.units END)
    FROM icanera_trading.sector_fills fl
   WHERE fl.txid >= v_last AND fl.txid < v_bound
   GROUP BY fl.sector
  ON CONFLICT (sector) DO UPDATE SET net_units = icanera_trading.sector_exposure.net_units + EXCLUDED.net_units;

  UPDATE icanera_trading.fold_state SET ledger_txid = v_bound WHERE id;
END; $$;
REVOKE ALL ON FUNCTION icanera_trading.fold_ledgers() FROM PUBLIC, anon, authenticated;

-- What is in the vault right now, exactly. (Written as scalar subqueries on purpose: joining the one-row tables made
-- the planner multiply row estimates and JIT-compile a trivial query. JIT is off for everything on the trade path.)
CREATE OR REPLACE FUNCTION icanera_trading.vault_balance()
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = icanera_trading, public SET jit = off AS $$
  SELECT (SELECT c.balance FROM icanera_trading.vault_cache c WHERE c.id)
       + COALESCE((SELECT SUM(e.amount) FROM icanera_trading.vault_entries e
                    WHERE e.txid >= (SELECT f.ledger_txid FROM icanera_trading.fold_state f WHERE f.id)), 0)
$$;
REVOKE ALL ON FUNCTION icanera_trading.vault_balance() FROM PUBLIC, anon, authenticated;

-- Units of one sector that users hold (what the vault owes them, in index units).
CREATE OR REPLACE FUNCTION icanera_trading.sector_exposure_units(p_ticker TEXT)
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = icanera_trading, public SET jit = off AS $$
  SELECT COALESCE((SELECT x.net_units FROM icanera_trading.sector_exposure x WHERE x.sector = p_ticker), 0)
       + COALESCE((SELECT SUM(CASE fl.side WHEN 'buy' THEN fl.units ELSE -fl.units END)
                     FROM icanera_trading.sector_fills fl
                    WHERE fl.sector = p_ticker
                      AND fl.txid >= (SELECT f.ledger_txid FROM icanera_trading.fold_state f WHERE f.id)), 0)
$$;
REVOKE ALL ON FUNCTION icanera_trading.sector_exposure_units(TEXT) FROM PUBLIC, anon, authenticated;

-- What the vault owes users across all sectors, in ICEC, at today's index prices. One pass over the tail,
-- not one query per sector: a buy reads this on every trade.
CREATE OR REPLACE FUNCTION icanera_trading.exposure_icec()
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = icanera_trading, public SET jit = off AS $$
  SELECT COALESCE(SUM(GREATEST(COALESCE(x.net_units, 0) + COALESCE(t.tail, 0), 0) * c.price_icec), 0)
    FROM icanera_trading.sector_index_cache c
    LEFT JOIN icanera_trading.sector_exposure x ON x.sector = c.ticker
    LEFT JOIN (SELECT fl.sector, SUM(CASE fl.side WHEN 'buy' THEN fl.units ELSE -fl.units END) AS tail
                 FROM icanera_trading.sector_fills fl
                WHERE fl.txid >= (SELECT f.ledger_txid FROM icanera_trading.fold_state f WHERE f.id)
                GROUP BY fl.sector) t ON t.sector = c.ticker
   WHERE c.price_icec IS NOT NULL
$$;
REVOKE ALL ON FUNCTION icanera_trading.exposure_icec() FROM PUBLIC, anon, authenticated;


-- 3. The folder. Returns TRUE when THIS call did the work.
--    p_force : recompute even if it ran a moment ago (tests, settings changes).
--    p_wait  : if another call is already folding, wait for it instead of skipping.
CREATE OR REPLACE FUNCTION icanera_trading.fold_sector_indices(p_force BOOLEAN DEFAULT FALSE, p_wait BOOLEAN DEFAULT FALSE)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public SET jit = off AS $$
DECLARE
  v_fresh   CONSTANT INTERVAL := INTERVAL '2 seconds';
  v_lock    CONSTANT BIGINT   := hashtextextended('icanera_fold_sector_indices', 0);
  v_bucket  CONSTANT TIMESTAMPTZ := to_timestamp(floor(extract(epoch FROM clock_timestamp()) / 300) * 300);
  st        icanera_trading.fold_state;
  s         icanera_trading.sector_settings;
  prev      icanera_trading.sector_index_cache;
  c         RECORD;
  v_picked  BIGINT := 0;
  v_n       INT;
  v_raw     NUMERIC;
  v_base    NUMERIC;
  v_ema     NUMERIC;
  v_level   NUMERIC;
  v_target  NUMERIC;
  v_dt      NUMERIC;
  v_alpha   NUMERIC;
  v_f       NUMERIC;
  v_ema_at  TIMESTAMPTZ;
  v_status  TEXT;
  v_changed BOOLEAN;
  v_any     BOOLEAN := FALSE;
  v_version BIGINT;
BEGIN
  SELECT * INTO st FROM icanera_trading.fold_state WHERE id;
  IF NOT p_force AND st.folded_at IS NOT NULL AND clock_timestamp() - st.folded_at < v_fresh THEN
    RETURN FALSE;                                    -- somebody did this a moment ago
  END IF;

  IF p_wait THEN
    PERFORM pg_advisory_xact_lock(v_lock);
  ELSIF NOT pg_try_advisory_xact_lock(v_lock) THEN
    RETURN FALSE;                                    -- somebody is doing it right now
  END IF;

  SELECT * INTO st FROM icanera_trading.fold_state WHERE id;
  IF NOT p_force AND st.folded_at IS NOT NULL AND clock_timestamp() - st.folded_at < v_fresh THEN
    RETURN FALSE;                                    -- the one we waited for just finished
  END IF;
  SELECT * INTO s FROM icanera_trading.sector_settings WHERE id;

  -- (a) Count every committed, not-yet-counted event into its contributor's 5-minute bucket.
  --     A row whose transaction has not committed is invisible here and is taken by the next fold.
  WITH picked AS (
    UPDATE icanera_trading.telemetry_events e SET folded_at = clock_timestamp()
     WHERE e.id IN (SELECT x.id FROM icanera_trading.telemetry_events x
                     WHERE x.folded_at IS NULL ORDER BY x.id LIMIT 50000 FOR UPDATE SKIP LOCKED)
    RETURNING e.sector, e.contributor_key, e.event_time, e.amount_ugx
  ), agg AS (
    SELECT p.sector, p.contributor_key,
           to_timestamp(floor(extract(epoch FROM p.event_time) / 300) * 300) AS b,
           SUM(p.amount_ugx) AS a
      FROM picked p GROUP BY 1, 2, 3
  ), ins AS (
    INSERT INTO icanera_trading.contributor_buckets (sector, contributor_key, bucket_start, amount_ugx)
    SELECT sector, contributor_key, b, a FROM agg
    ON CONFLICT (sector, contributor_key, bucket_start) DO UPDATE
      SET amount_ugx = icanera_trading.contributor_buckets.amount_ugx + EXCLUDED.amount_ugx
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_picked FROM picked;

  DELETE FROM icanera_trading.contributor_buckets
   WHERE bucket_start < v_bucket - make_interval(hours => s.window_hours + 1);

  PERFORM icanera_trading.fold_ledgers();             -- vault balance and units owed, kept exact and cheap to read

  -- (b) Nothing new and the window has not slid: the indices cannot have changed.
  IF NOT p_force AND v_picked = 0 AND st.last_bucket IS NOT DISTINCT FROM v_bucket
     AND NOT EXISTS (SELECT 1 FROM icanera_trading.sector_catalog k WHERE k.enabled
                      AND NOT EXISTS (SELECT 1 FROM icanera_trading.sector_index_cache x WHERE x.ticker = k.ticker)) THEN
    UPDATE icanera_trading.sector_index_cache SET computed_at = clock_timestamp();
    UPDATE icanera_trading.fold_state SET folded_at = clock_timestamp() WHERE id;
    RETURN TRUE;
  END IF;

  -- (c) Recompute each sector.
  FOR c IN SELECT k.ticker, k.admin_halted FROM icanera_trading.sector_catalog k WHERE k.enabled ORDER BY k.ticker LOOP
    SELECT * INTO prev FROM icanera_trading.sector_index_cache WHERE ticker = c.ticker;

    WITH r AS (
      SELECT b.contributor_key, SUM(b.amount_ugx) AS rev
        FROM icanera_trading.contributor_buckets b
       WHERE b.sector = c.ticker AND b.bucket_start >= v_bucket - make_interval(hours => s.window_hours)
       GROUP BY b.contributor_key
      HAVING SUM(b.amount_ugx) > 0
    ), m AS (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY rev) AS med FROM r
    )
    SELECT COUNT(*), AVG(LEAST(r.rev, m.med * s.contributor_cap_multiple))
      INTO v_n, v_raw
      FROM r CROSS JOIN m;

    v_base := prev.v_base; v_ema := prev.v_ema; v_level := prev.level; v_ema_at := prev.ema_at;
    IF v_n >= s.k_min AND v_raw IS NOT NULL AND v_raw > 0 THEN
      IF v_base IS NULL THEN                         -- the sector's first day: it is 100 from here on
        v_base := v_raw; v_ema := v_raw; v_level := 100;
      ELSE
        -- Time-based: the same elapsed time gives the same result however many folds it was split into.
        -- (Capped at 6 hours so a long gap cannot unlock an unbounded jump.)
        v_dt     := LEAST(GREATEST(EXTRACT(EPOCH FROM clock_timestamp() - COALESCE(v_ema_at, clock_timestamp())), 0), 21600);
        v_alpha  := 1 - exp(-v_dt / (s.ema_minutes * 60));
        v_f      := power(1 + s.max_move_pct_per_hour / 100, v_dt / 3600);
        v_ema    := v_alpha * v_raw + (1 - v_alpha) * v_ema;
        v_target := 100 * v_ema / v_base;
        v_level  := LEAST(GREATEST(v_target, v_level / v_f), v_level * v_f);
      END IF;
      v_ema_at := clock_timestamp();
      v_level := GREATEST(v_level, 0.01);            -- an index never reaches zero: a price of 0 cannot be traded
      v_status := CASE WHEN c.admin_halted THEN 'halted' ELSE 'live' END;
    ELSE
      v_status := CASE WHEN c.admin_halted THEN 'halted' ELSE 'warming_up' END;
      -- too few contributors: whatever was published stays frozen, nothing is recomputed from a thin sample
    END IF;
    v_level := round(v_level, 6);

    v_changed := prev.ticker IS NULL OR prev.status IS DISTINCT FROM v_status
              OR prev.level IS DISTINCT FROM v_level OR prev.contributors IS DISTINCT FROM v_n;

    INSERT INTO icanera_trading.sector_index_cache
      (ticker, status, contributors, v_raw, v_ema, ema_at, v_base, level, price_icec, version, computed_at, changed_at)
    VALUES
      (c.ticker, v_status, v_n, v_raw, v_ema, v_ema_at, v_base, v_level, round(v_level / 100, 6), 1, clock_timestamp(), clock_timestamp())
    ON CONFLICT (ticker) DO UPDATE SET
      status = EXCLUDED.status, contributors = EXCLUDED.contributors, v_raw = EXCLUDED.v_raw, v_ema = EXCLUDED.v_ema,
      ema_at = EXCLUDED.ema_at, v_base = EXCLUDED.v_base, level = EXCLUDED.level, price_icec = EXCLUDED.price_icec, computed_at = EXCLUDED.computed_at,
      version    = icanera_trading.sector_index_cache.version + CASE WHEN v_changed THEN 1 ELSE 0 END,
      changed_at = CASE WHEN v_changed THEN EXCLUDED.changed_at ELSE icanera_trading.sector_index_cache.changed_at END;

    IF v_level IS NOT NULL THEN
      INSERT INTO icanera_trading.sector_index_candles (ticker, timeframe, open_time, open_level, high_level, low_level, close_level)
      VALUES (c.ticker, '5m', v_bucket, COALESCE(prev.level, v_level), GREATEST(COALESCE(prev.level, v_level), v_level),
              LEAST(COALESCE(prev.level, v_level), v_level), v_level)
      ON CONFLICT (ticker, timeframe, open_time) DO UPDATE SET
        high_level  = GREATEST(icanera_trading.sector_index_candles.high_level, EXCLUDED.close_level),
        low_level   = LEAST(icanera_trading.sector_index_candles.low_level, EXCLUDED.close_level),
        close_level = EXCLUDED.close_level;
    END IF;

    IF v_changed THEN v_any := TRUE; END IF;
  END LOOP;

  UPDATE icanera_trading.fold_state
     SET folded_at = clock_timestamp(), last_bucket = v_bucket,
         feed_version = feed_version + CASE WHEN v_any THEN 1 ELSE 0 END
   WHERE id RETURNING feed_version INTO v_version;
  IF v_any THEN PERFORM icanera_trading.notify_sector_change(v_version); END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION icanera_trading.fold_sector_indices(BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;


-- 4. The public feed: every sector's level and status in one round trip, and a sector's candles on request.
--    Only aggregates are ever returned: no business, no contributor key, and the number of contributors
--    only while a sector is still warming up (it has no published level then).
--    p_since_version : the version the caller already holds; if nothing changed, only {unchanged:true} comes back.
--    p_sector        : also return this sector's candles (newest first). p_after: only candles from 15 minutes
--                      before that time onward.
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
             (SELECT ROUND((c.level / NULLIF(o.close_level, 0) - 1) * 100, 2)
                FROM icanera_trading.sector_index_candles o
               WHERE o.ticker = k.ticker AND o.timeframe = '5m' AND o.open_time <= clock_timestamp() - INTERVAL '24 hours'
               ORDER BY o.open_time DESC LIMIT 1) AS change_24h_pct,
             c.computed_at AS updated_at,
             COALESCE(s.trading_enabled AND NOT k.admin_halted AND c.status = 'live'
                AND c.computed_at > clock_timestamp() - make_interval(secs => s.stale_s), FALSE) AS tradable
        FROM icanera_trading.sector_catalog k
        LEFT JOIN icanera_trading.sector_index_cache c ON c.ticker = k.ticker
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
    'sectors',         v_sectors,
    'candles_for',     v_tick,
    'candles',         v_candles
  );
END; $$;
REVOKE ALL ON FUNCTION public.ican_get_sector_feed(BIGINT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_get_sector_feed(BIGINT, TEXT, TIMESTAMPTZ) TO anon, authenticated;


-- 5. Keep the indices current with nobody watching: fold every 5 seconds (pg_cron >= 1.5), and tidy nightly.
--    Skipped quietly if pg_cron is absent: viewers and trades fold on demand.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('icanera-sector-fold', '5 seconds', 'SELECT icanera_trading.fold_sector_indices()');
    PERFORM cron.schedule('icanera-sector-prune', '23 3 * * *',
      $job$DELETE FROM icanera_trading.telemetry_events WHERE folded_at IS NOT NULL AND folded_at < now() - INTERVAL '45 days'$job$);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'sector trading: could not schedule the background fold (%): indices will refresh when viewers or trades ask.', SQLERRM;
END $$;


-- 6. Fill the cache right now.
SELECT icanera_trading.fold_sector_indices(TRUE, TRUE);

NOTIFY pgrst, 'reload schema';
