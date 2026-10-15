-- ============================================================================
-- The Supabase API runs every request through the "safeupdate" guard, which refuses a DELETE (or UPDATE) with no WHERE clause:
--     ERROR: DELETE requires a WHERE clause
-- Three functions deleted a whole table without one. That is legal SQL and works in the SQL editor, so it was never noticed, but called
-- from the app it fails:
--
--   * public.ican_flush_price_ticks  : the icaneracoin price-tick flush. ican_get_public_feed, ican_ensure_current_candle and
--                                      ican_get_market_snapshot call it, so the coin's chart feed answered HTTP 400 whenever there were
--                                      ticks to flush: every chart that reads it showed "The live chart could not be loaded".
--   * icanera_trading.refresh_contributor_assets / refresh_registered_businesses : both swallow errors on purpose (they must never break
--                                      the sector feed), so the failed DELETE was silent and they simply never refreshed.
--
-- The fix is `WHERE TRUE`: exactly the same rows, and the guard is satisfied. Nothing else in these functions changes.
-- Safe to run more than once.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ican_flush_price_ticks(p_force boolean DEFAULT false, p_wait boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- (WHERE TRUE: the same rows as before; the API's safeupdate guard refuses a DELETE without a WHERE.)
  FOR b IN
    WITH taken AS (DELETE FROM public.ican_price_ticks WHERE TRUE RETURNING tick_time, volume)
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
END; $function$;


CREATE OR REPLACE FUNCTION icanera_trading.refresh_contributor_assets(p_force boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'icanera_trading', 'public'
AS $function$
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
END; $function$;


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

NOTIFY pgrst, 'reload schema';
