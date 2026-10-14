\set ON_ERROR_STOP on
-- The sector index: cohort threshold, the per-business cap, smoothing, the circuit breaker, the window, refunds,
-- the public feed (aggregates only) and the halt switches.

TRUNCATE icanera_trading.telemetry_events, icanera_trading.contributor_buckets, icanera_trading.sector_index_cache,
         icanera_trading.sector_index_candles;
UPDATE icanera_trading.fold_state SET folded_at = NULL, last_bucket = NULL;
UPDATE icanera_trading.sector_settings SET k_min = 3, trading_enabled = FALSE, ema_minutes = 30, max_move_pct_per_hour = 10,
                                           contributor_cap_multiple = 3, window_hours = 24, stale_s = 120;

-- one revenue event for a contributor, some minutes ago (negative = a refund)
CREATE FUNCTION t.ev(p_sector TEXT, p_key TEXT, p_amount NUMERIC, p_mins_ago NUMERIC DEFAULT 1) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO icanera_trading.telemetry_events (source, source_ref, kind, sector, contributor_key, amount_ugx, event_time)
  VALUES ('t', gen_random_uuid()::TEXT, CASE WHEN p_amount < 0 THEN 'void' ELSE 'sale' END, p_sector, p_key, p_amount,
          clock_timestamp() - p_mins_ago * INTERVAL '1 minute') $$;
CREATE FUNCTION t.fold() RETURNS BOOLEAN LANGUAGE sql AS $$ SELECT icanera_trading.fold_sector_indices(TRUE, TRUE) $$;
CREATE FUNCTION t.ix(p_ticker TEXT) RETURNS icanera_trading.sector_index_cache LANGUAGE sql AS $$ SELECT c FROM icanera_trading.sector_index_cache c WHERE c.ticker = p_ticker $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;

-- ================================================================ 1. Too few contributors: nothing is published
DO $t$
DECLARE c icanera_trading.sector_index_cache; f JSONB; sec JSONB;
BEGIN
  PERFORM t.ev('iAGRI', 'ka', 100); PERFORM t.ev('iAGRI', 'kb', 100);
  PERFORM t.fold();
  c := t.ix('iAGRI');
  PERFORM t.check('1.1 with 2 of 3 needed contributors the sector is warming up', c.status = 'warming_up' AND c.contributors = 2, c::TEXT);
  PERFORM t.check('1.2 ...and has no level and no price', c.level IS NULL AND c.price_icec IS NULL, c::TEXT);
  PERFORM t.check('1.3 ...and no candles', NOT EXISTS (SELECT 1 FROM icanera_trading.sector_index_candles WHERE ticker = 'iAGRI'));

  PERFORM t.as_anon();
  f := public.ican_get_sector_feed();
  PERFORM t.reset();
  SELECT x INTO sec FROM jsonb_array_elements(f -> 'sectors') x WHERE x ->> 'ticker' = 'iAGRI';
  PERFORM t.check('1.4 the feed shows progress (2 of 3) but no level', (sec ->> 'contributors')::INT = 2 AND (sec ->> 'contributors_needed')::INT = 3
    AND sec -> 'level' = 'null'::JSONB AND NOT (sec ->> 'tradable')::BOOLEAN, sec::TEXT);
  PERFORM t.check('1.5 the feed lists all ten sectors', jsonb_array_length(f -> 'sectors') = 10);
END $t$;

-- ================================================================ 2. The sector goes live at 100
DO $t$
DECLARE c icanera_trading.sector_index_cache; v0 BIGINT; k RECORD;
BEGIN
  PERFORM t.ev('iAGRI', 'kc', 100);
  PERFORM t.fold();
  c := t.ix('iAGRI');
  PERFORM t.check('2.1 the third contributor makes it live', c.status = 'live' AND c.contributors = 3, c::TEXT);
  PERFORM t.check('2.2 its first level is exactly 100 and the price 1 ICEC', c.level = 100 AND c.price_icec = 1, c::TEXT);
  PERFORM t.check('2.3 V is the mean revenue per contributor', c.v_raw = 100 AND c.v_base = 100, c::TEXT);
  v0 := c.version;
  PERFORM t.fold();
  c := t.ix('iAGRI');
  PERFORM t.check('2.4 folding again with nothing new changes nothing, not even the version', c.level = 100 AND c.version = v0, c::TEXT);
  SELECT * INTO k FROM icanera_trading.sector_index_candles WHERE ticker = 'iAGRI';
  PERFORM t.check('2.5 there is one 5-minute candle, flat at 100', k.open_level = 100 AND k.high_level = 100 AND k.low_level = 100 AND k.close_level = 100, k::TEXT);
END $t$;

-- ================================================================ 3. Smoothing and the circuit breaker
DO $t$
DECLARE c icanera_trading.sector_index_cache; v0 BIGINT;
BEGIN
  -- every contributor now sells 10% more in the window: V = 110
  PERFORM t.ev('iAGRI', 'ka', 10); PERFORM t.ev('iAGRI', 'kb', 10); PERFORM t.ev('iAGRI', 'kc', 10);
  v0 := (t.ix('iAGRI')).version;

  -- 30 minutes pass (= one time constant) and the breaker is wide open: EMA = 100 + 10 x (1 - 1/e) = 106.3212
  UPDATE icanera_trading.sector_settings SET max_move_pct_per_hour = 200;
  UPDATE icanera_trading.sector_index_cache SET ema_at = clock_timestamp() - INTERVAL '30 minutes' WHERE ticker = 'iAGRI';
  PERFORM t.fold();
  c := t.ix('iAGRI');
  PERFORM t.check('3.1 after one time constant the smoothed value has covered 63% of the way (106.3212)', abs(c.level - 106.3212056) < 0.001, c.level::TEXT);
  PERFORM t.check('3.2 the price is level / 100 and the version moved', c.price_icec = round(c.level / 100, 6) AND c.version > v0, c::TEXT);

  -- the same 30 minutes, V rises to 120, but the breaker allows only 10% an hour: half an hour allows 1.1^0.5 = 4.88%
  PERFORM t.ev('iAGRI', 'ka', 10); PERFORM t.ev('iAGRI', 'kb', 10); PERFORM t.ev('iAGRI', 'kc', 10);
  UPDATE icanera_trading.sector_settings SET max_move_pct_per_hour = 10;
  UPDATE icanera_trading.sector_index_cache SET ema_at = clock_timestamp() - INTERVAL '30 minutes' WHERE ticker = 'iAGRI';
  PERFORM t.fold();
  c := t.ix('iAGRI');
  PERFORM t.check('3.3 the circuit breaker caps the move (106.3212 x 1.1^0.5 = 111.5106, not the 114.97 the average asked for)',
    abs(c.level - 111.5106212) < 0.001, c.level::TEXT);
  PERFORM t.check('3.4 the smoothed value itself is not clamped (114.968): the level catches up on later folds', abs(c.v_ema - 114.9678528) < 0.001, c.v_ema::TEXT);

  -- no time has passed: nothing moves, however often it is folded
  PERFORM t.fold(); PERFORM t.fold(); PERFORM t.fold();
  PERFORM t.check('3.5 folding repeatedly in the same instant moves nothing (smoothing depends on time, not on how often it runs)',
    abs((t.ix('iAGRI')).level - c.level) < 0.01, ((t.ix('iAGRI')).level)::TEXT);

  -- candles follow the level
  PERFORM t.check('3.6 the current candle records the high and the close',
    (SELECT high_level FROM icanera_trading.sector_index_candles WHERE ticker = 'iAGRI' ORDER BY open_time DESC LIMIT 1) >= c.level - 0.01
    AND (SELECT low_level FROM icanera_trading.sector_index_candles WHERE ticker = 'iAGRI' ORDER BY open_time DESC LIMIT 1) <= 100.0001);
  UPDATE icanera_trading.sector_settings SET max_move_pct_per_hour = 10;
END $t$;

-- ================================================================ 4. One big business cannot move a sector
DO $t$
DECLARE c icanera_trading.sector_index_cache;
BEGIN
  PERFORM t.ev('iRETL', 'ra', 100); PERFORM t.ev('iRETL', 'rb', 100); PERFORM t.ev('iRETL', 'rc', 100); PERFORM t.ev('iRETL', 'rd', 100);
  PERFORM t.ev('iRETL', 'whale', 10000);                 -- 100 times the others
  PERFORM t.fold();
  c := t.ix('iRETL');
  PERFORM t.check('4.1 a business 100x the median counts as 3x the median: V = (4 x 100 + 300) / 5 = 140, not 2080',
    c.v_raw = 140 AND c.contributors = 5, c::TEXT);
END $t$;

-- ================================================================ 5. Refunds, the window, and a thinning cohort
DO $t$
DECLARE c icanera_trading.sector_index_cache; lvl NUMERIC;
BEGIN
  -- a refund that cancels a business's whole window removes it from the sector
  PERFORM t.ev('iRETL', 'rd', -100);
  PERFORM t.fold();
  c := t.ix('iRETL');
  PERFORM t.check('5.1 a contributor whose refunds cancel its sales no longer counts', c.contributors = 4, c::TEXT);

  -- sales older than the window do not count
  PERFORM t.ev('iRETL', 'old', 5000, 60 * 30);           -- 30 hours ago
  PERFORM t.fold();
  PERFORM t.check('5.2 revenue from 30 hours ago is outside a 24 hour window', (t.ix('iRETL')).contributors = 4);

  -- a wider window sees revenue that old (buckets are kept for the window plus an hour, so this applies going forward)
  UPDATE icanera_trading.sector_settings SET window_hours = 48;
  PERFORM t.ev('iRETL', 'old2', 5000, 60 * 30);
  PERFORM t.fold();
  PERFORM t.check('5.3 widening the window to 48 hours brings such revenue in', (t.ix('iRETL')).contributors = 5);
  UPDATE icanera_trading.sector_settings SET window_hours = 24;
  PERFORM t.fold();
  PERFORM t.check('5.3b and narrowing it again takes it out', (t.ix('iRETL')).contributors = 4);

  -- the cohort thins below k_min: the published level freezes and trading stops
  lvl := (t.ix('iRETL')).level;
  UPDATE icanera_trading.sector_settings SET k_min = 6;
  PERFORM t.fold();
  c := t.ix('iRETL');
  PERFORM t.check('5.4 with fewer contributors than k_min the sector goes back to warming up', c.status = 'warming_up', c::TEXT);
  PERFORM t.check('5.5 ...and its level is frozen, not recomputed from a thin sample', c.level = lvl, format('%s vs %s', c.level, lvl));
  UPDATE icanera_trading.sector_settings SET k_min = 3;
  PERFORM t.fold();
  PERFORM t.check('5.6 it comes back when the cohort is enough again', (t.ix('iRETL')).status = 'live');
END $t$;

-- ================================================================ 6. Halt, disable, floor
DO $t$
DECLARE c icanera_trading.sector_index_cache; f JSONB; sec JSONB; lvl NUMERIC;
BEGIN
  UPDATE icanera_trading.sector_catalog SET admin_halted = TRUE WHERE ticker = 'iAGRI';
  PERFORM t.fold();
  c := t.ix('iAGRI');
  PERFORM t.check('6.1 an administrator can halt a sector; it keeps its level but is halted', c.status = 'halted' AND c.level IS NOT NULL, c::TEXT);
  UPDATE icanera_trading.sector_settings SET trading_enabled = TRUE;
  f := public.ican_get_sector_feed();
  SELECT x INTO sec FROM jsonb_array_elements(f -> 'sectors') x WHERE x ->> 'ticker' = 'iAGRI';
  PERFORM t.check('6.2 a halted sector is not tradable even with trading on', NOT (sec ->> 'tradable')::BOOLEAN, sec::TEXT);
  SELECT x INTO sec FROM jsonb_array_elements(f -> 'sectors') x WHERE x ->> 'ticker' = 'iRETL';
  PERFORM t.check('6.3 a live sector is tradable with trading on', (sec ->> 'tradable')::BOOLEAN, sec::TEXT);
  UPDATE icanera_trading.fold_state SET folded_at = clock_timestamp() + INTERVAL '1 hour';   -- block the on-demand fold so the stale reading is real
  UPDATE icanera_trading.sector_index_cache SET computed_at = clock_timestamp() - INTERVAL '10 minutes' WHERE ticker = 'iRETL';
  f := public.ican_get_sector_feed();
  SELECT x INTO sec FROM jsonb_array_elements(f -> 'sectors') x WHERE x ->> 'ticker' = 'iRETL';
  PERFORM t.check('6.4 an index that has not been recomputed for longer than stale_s is not tradable', NOT (sec ->> 'tradable')::BOOLEAN, sec::TEXT);
  UPDATE icanera_trading.fold_state SET folded_at = NULL;
  PERFORM t.fold();
  UPDATE icanera_trading.sector_catalog SET admin_halted = FALSE WHERE ticker = 'iAGRI';
  PERFORM t.fold();
  UPDATE icanera_trading.sector_settings SET trading_enabled = FALSE;

  UPDATE icanera_trading.sector_catalog SET enabled = FALSE WHERE ticker = 'iHOSP';
  f := public.ican_get_sector_feed();
  PERFORM t.check('6.5 a disabled sector disappears from the feed', jsonb_array_length(f -> 'sectors') = 9 AND NOT f::TEXT LIKE '%iHOSP%');
  UPDATE icanera_trading.sector_catalog SET enabled = TRUE WHERE ticker = 'iHOSP';

  -- an index never reaches zero
  -- the sector's revenue has collapsed to a millionth of its launch level (modelled by a huge launch base)
  UPDATE icanera_trading.sector_index_cache SET level = 0.0105, v_base = 1000000000, ema_at = clock_timestamp() - INTERVAL '6 hours' WHERE ticker = 'iAGRI';
  PERFORM t.fold();
  lvl := (t.ix('iAGRI')).level;
  PERFORM t.check('6.6 a collapsing sector bottoms out at exactly 0.01, never at zero (a price of 0 cannot be traded)',
    lvl = 0.01 AND (t.ix('iAGRI')).price_icec = 0.0001, lvl::TEXT);
END $t$;

-- ================================================================ 7. The public feed: shape, cheapness, privacy
DO $t$
DECLARE f JSONB; f2 JSONB; v BIGINT; e TEXT; leaked INT;
BEGIN
  PERFORM t.as_anon();
  f := public.ican_get_sector_feed(NULL, 'iRETL');
  PERFORM t.reset();
  PERFORM t.check('7.1 anyone can read the feed, with a sector''s candles on request', jsonb_array_length(f -> 'candles') >= 1 AND f ->> 'candles_for' = 'iRETL', left(f::TEXT, 200));
  PERFORM t.check('7.2 candles carry only time and levels', (f -> 'candles' -> 0) ?& ARRAY['t','o','h','l','c'] AND (SELECT count(*) FROM jsonb_object_keys(f -> 'candles' -> 0)) = 5);
  v := (f ->> 'version')::BIGINT;
  PERFORM t.as_anon();
  f2 := public.ican_get_sector_feed(v);
  PERFORM t.reset();
  PERFORM t.check('7.3 a caller who already has this version gets only "unchanged"', (f2 ->> 'unchanged')::BOOLEAN AND f2 -> 'sectors' IS NULL, f2::TEXT);
  PERFORM t.ev('iRETL', 'ra', 50, 0);
  PERFORM t.fold();
  f2 := public.ican_get_sector_feed(v);
  PERFORM t.check('7.4 once something changes, the full feed comes back with a newer version', f2 ->> 'unchanged' IS NULL AND (f2 ->> 'version')::BIGINT > v, left(f2::TEXT, 200));

  SELECT count(*) INTO leaked FROM icanera_trading.telemetry_events x WHERE f2::TEXT LIKE '%"' || x.contributor_key || '"%';
  PERFORM t.check('7.5 no contributor key appears anywhere in the feed', leaked = 0, leaked::TEXT);
  PERFORM t.check('7.6 the feed has no business, user or amount fields', f2::TEXT !~* '(business_id|user_id|contributor_key|amount_ugx|v_raw|v_ema|v_base)');
  PERFORM t.check('7.7 a live sector shows no contributor count at all', (SELECT bool_and(x -> 'contributors' = 'null'::JSONB) FROM jsonb_array_elements(f2 -> 'sectors') x WHERE x ->> 'status' IN ('live','halted')));
  PERFORM t.as_anon();
  e := t.err($$SELECT count(*) FROM icanera_trading.sector_index_cache$$);
  PERFORM t.reset();
  PERFORM t.check('7.8 the cache table itself is still closed to a client, the feed is the only door', e LIKE 'permission denied%', e);
END $t$;

-- ================================================================ 8. Late-committing events are never lost
-- (The concurrent version of this is in run.sh; here the same property without a second session:
--  an event with a LOWER id that becomes visible after a higher one was folded is still counted.)
DO $t$
DECLARE c0 INT; c1 INT;
BEGIN
  INSERT INTO icanera_trading.telemetry_events (source, source_ref, sector, contributor_key, amount_ugx, folded_at)
  VALUES ('t', 'late-1', 'iFINC', 'fa', 100, NULL), ('t', 'late-2', 'iFINC', 'fb', 100, NULL), ('t', 'late-3', 'iFINC', 'fc', 100, NULL);
  SELECT count(*) INTO c0 FROM icanera_trading.telemetry_events WHERE folded_at IS NULL;
  PERFORM t.fold();
  SELECT count(*) INTO c1 FROM icanera_trading.telemetry_events WHERE folded_at IS NULL;
  PERFORM t.check('8.1 every committed, uncounted event is picked up and marked', c0 >= 3 AND c1 = 0, format('%s -> %s', c0, c1));
  PERFORM t.check('8.2 iFINC went live from those three', (t.ix('iFINC')).status = 'live');
  -- counted once: folding again must not count them twice
  PERFORM t.fold(); PERFORM t.fold();
  PERFORM t.check('8.3 events are counted exactly once, however often it folds',
    (SELECT sum(amount_ugx) FROM icanera_trading.contributor_buckets WHERE sector = 'iFINC') = 300);
END $t$;
