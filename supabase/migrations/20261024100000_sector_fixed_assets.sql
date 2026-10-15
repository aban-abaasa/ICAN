-- ============================================================================
-- IcanEra Sector Markets: fixed assets recorded in CMMS also count in the sector index.
--
-- Until now a sector level came from sales alone. A business's fixed assets (CMMS inventory items of kind 'asset':
-- equipment, vehicles, buildings, ...) are part of what it is worth, so they now feed the index too:
--
--     a contributor's figure = sales in the window  +  asset_weight x net book value of its fixed assets
--
--   net book value = (cost - accumulated depreciation, by the same maths CMMS uses) x quantity, for active, undisposed
--   assets of CMMS companies linked to the business (cmms_company_profiles.pichin_business_profile_id) and kept in UGX.
--
-- WHY IT IS SAFE TO LET SELF-REPORTED ASSETS MOVE A TRADABLE PRICE
--   * Sales are still required. Assets are added only to a business that ALSO has sales in the window, so a business can
--     never become a contributor (or open a sector) by typing in assets.
--   * The per-business cap in the index (contributor_cap_multiple x the sector median) applies to the combined figure.
--   * asset_weight is small and an administrator can set it to 0 to switch assets off: UPDATE sector_settings SET asset_weight = 0.
--   * Consent first. The v1 clause covers sales only, so assets count only for a business that has accepted a clause that
--     covers them (version >= asset_terms_version, v2 below). Nothing is used without that. v2 is a DRAFT for legal review,
--     and it is NOT made current by this file: an administrator flips sector_settings.current_terms_version to 2 when ready
--     (businesses are then asked on their next sign-in, as for any new version).
--   * Counts and totals only, like the rest of the index: no business, asset or amount is ever published.
--   * Values are cached (recounted at most every 10 minutes, single flight) so viewers never scan the inventory table.
--
-- Run 20261019100000..20261019130000 first. Safe to run more than once.
-- ============================================================================

DO $$ BEGIN
  IF to_regclass('icanera_trading.sector_index_cache') IS NULL THEN
    RAISE EXCEPTION 'Apply the sector trading migrations (20261019100000 to 20261019130000) first.';
  END IF;
END $$;

ALTER TABLE icanera_trading.sector_settings
  ADD COLUMN IF NOT EXISTS asset_weight        NUMERIC NOT NULL DEFAULT 0.001 CHECK (asset_weight >= 0 AND asset_weight <= 1),
  ADD COLUMN IF NOT EXISTS asset_terms_version INT     NOT NULL DEFAULT 2     CHECK (asset_terms_version >= 1);

-- The clause that lets fixed assets count. DRAFT: needs legal review. Not current until an administrator makes it so.
INSERT INTO icanera_trading.data_terms_text (version, title, body) VALUES (
  2,
  'Anonymous sector statistics',
  'When your business receives sales payments through ICAN, the amount is added to an anonymous total for your business sector (for example Retail, Transport or Health). '
  || 'The net value of the fixed assets recorded in your CMMS inventory (equipment, vehicles, buildings and similar) is added to the same anonymous sector figure, for a business that also has sales. '
  || 'Only combined sector figures are ever published, and only when enough businesses contribute that no single business can be identified. '
  || 'We never share your business name, your customers, who paid you, any individual transaction or any individual asset. '
  || 'These sector figures are used to calculate the sector index values that users can trade on IcanEra Sector Markets. '
  || 'Agreeing to this is part of the Terms & Conditions for creating a business account.'
) ON CONFLICT (version) DO NOTHING;

-- One row per business that has fixed assets: its sector (by key, never the id) and the value of the assets.
CREATE TABLE IF NOT EXISTS icanera_trading.contributor_assets (
  contributor_key TEXT        PRIMARY KEY,
  sector          TEXT        NOT NULL,
  asset_value_ugx NUMERIC     NOT NULL CHECK (asset_value_ugx >= 0),
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
-- when it was last counted (so an empty result is cached too)
CREATE TABLE IF NOT EXISTS icanera_trading.contributor_assets_meta (
  id          BOOLEAN     PRIMARY KEY DEFAULT TRUE CHECK (id),
  computed_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE icanera_trading.contributor_assets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE icanera_trading.contributor_assets_meta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON icanera_trading.contributor_assets      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON icanera_trading.contributor_assets_meta FROM PUBLIC, anon, authenticated;

-- Recount net book value from CMMS. Does nothing unless the cache is older than 10 minutes (or p_force); one caller at a time.
-- A missing CMMS schema, or any error, leaves the last counts in place: it must never take the sector feed down.
CREATE OR REPLACE FUNCTION icanera_trading.refresh_contributor_assets(p_force BOOLEAN DEFAULT FALSE)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = icanera_trading, public AS $$
DECLARE
  v_year  INT := EXTRACT(YEAR FROM clock_timestamp())::INT;
  v_terms INT;
BEGIN
  IF NOT p_force AND EXISTS (SELECT 1 FROM icanera_trading.contributor_assets_meta m WHERE m.id AND m.computed_at > clock_timestamp() - INTERVAL '10 minutes') THEN
    RETURN;
  END IF;
  IF to_regclass('public.cmms_inventory_items') IS NULL OR to_regclass('public.cmms_company_profiles') IS NULL
     OR to_regprocedure('public.fn_cmms_accum_depreciation(numeric,numeric,integer,text,integer,integer)') IS NULL THEN
    RETURN;
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('icanera_trading.refresh_contributor_assets')) THEN RETURN; END IF;

  SELECT w.asset_terms_version INTO v_terms FROM icanera_trading.sector_settings w WHERE w.id;
  DELETE FROM icanera_trading.contributor_assets WHERE TRUE;
  INSERT INTO icanera_trading.contributor_assets_meta (id, computed_at) VALUES (TRUE, clock_timestamp())
  ON CONFLICT (id) DO UPDATE SET computed_at = EXCLUDED.computed_at;

  -- weight 0 = assets switched off: nothing is stored, so nothing can count
  IF (SELECT w.asset_weight FROM icanera_trading.sector_settings w WHERE w.id) <= 0 THEN RETURN; END IF;

  INSERT INTO icanera_trading.contributor_assets (contributor_key, sector, asset_value_ugx, computed_at)
  SELECT icanera_trading.contributor_key(x.business_id), x.sector, SUM(x.nbv), clock_timestamp()
    FROM (
      SELECT c.pichin_business_profile_id AS business_id,
             icanera_trading.sector_for_business(c.pichin_business_profile_id) AS sector,
             GREATEST(i.acquisition_cost
                      - public.fn_cmms_accum_depreciation(i.acquisition_cost, COALESCE(i.salvage_value, 0), i.useful_life_years,
                                                          COALESCE(i.depreciation_method, 'straight_line'),
                                                          COALESCE(i.acquisition_year, EXTRACT(YEAR FROM i.acquisition_date)::INT), v_year),
                      0) * GREATEST(COALESCE(i.quantity_in_stock, 0), 0) AS nbv
        FROM public.cmms_inventory_items i
        JOIN public.cmms_company_profiles c ON c.id = i.cmms_company_id
       WHERE i.item_kind = 'asset' AND COALESCE(i.is_active, TRUE) AND i.disposed_at IS NULL
         AND c.pichin_business_profile_id IS NOT NULL
         AND COALESCE(c.currency, 'UGX') = 'UGX'                       -- no exchange rates here: other currencies are left out, not guessed
         AND COALESCE(i.acquisition_cost, 0) > 0
         AND COALESCE(i.acquisition_year, EXTRACT(YEAR FROM i.acquisition_date)::INT) IS NOT NULL   -- no date, no depreciation maths: left out
    ) x
   WHERE x.sector IS NOT NULL
     AND icanera_trading.business_has_consented(x.business_id)
     AND EXISTS (SELECT 1 FROM icanera_trading.data_terms_acceptance a                      -- ...and has accepted a clause that covers assets
                  WHERE a.business_id = x.business_id AND a.terms_version >= v_terms)
   GROUP BY x.business_id, x.sector
  HAVING SUM(x.nbv) > 0;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'refresh_contributor_assets: %', SQLERRM;
END; $$;
REVOKE ALL ON FUNCTION icanera_trading.refresh_contributor_assets(BOOLEAN) FROM PUBLIC, anon, authenticated;

-- The index folder, now adding the asset component to a contributor's figure. (Same function as before otherwise.)
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
  PERFORM icanera_trading.refresh_contributor_assets(FALSE);   -- fixed-asset values, recounted at most every 10 minutes

  -- (b) Nothing new and the window has not slid: the indices cannot have changed.
  IF NOT p_force AND v_picked = 0 AND st.last_bucket IS NOT DISTINCT FROM v_bucket
     AND NOT EXISTS (SELECT 1 FROM icanera_trading.sector_catalog k WHERE k.enabled
                      AND NOT EXISTS (SELECT 1 FROM icanera_trading.sector_index_cache x WHERE x.ticker = k.ticker)) THEN
    UPDATE icanera_trading.sector_index_cache SET computed_at = clock_timestamp() WHERE ticker IS NOT NULL;
    UPDATE icanera_trading.fold_state SET folded_at = clock_timestamp() WHERE id;
    RETURN TRUE;
  END IF;

  -- (c) Recompute each sector.
  FOR c IN SELECT k.ticker, k.admin_halted FROM icanera_trading.sector_catalog k WHERE k.enabled ORDER BY k.ticker LOOP
    SELECT * INTO prev FROM icanera_trading.sector_index_cache WHERE ticker = c.ticker;

    -- A contributor's figure is its sales in the window PLUS `asset_weight` x the net book value of its CMMS fixed assets
    -- (when it has accepted the asset clause). The assets are only ever added to a business that ALSO has sales in the
    -- window, so a business cannot become a contributor by typing in assets; and the median cap below limits what either part can do.
    WITH r AS (
      SELECT b.contributor_key,
             SUM(b.amount_ugx) + COALESCE(MAX(a.asset_value_ugx), 0) * s.asset_weight AS rev
        FROM icanera_trading.contributor_buckets b
        LEFT JOIN icanera_trading.contributor_assets a ON a.contributor_key = b.contributor_key AND a.sector = b.sector
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

-- Count once now, so the first fold already has the values.
SELECT icanera_trading.refresh_contributor_assets(TRUE);

NOTIFY pgrst, 'reload schema';
