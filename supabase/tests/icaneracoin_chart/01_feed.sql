\set ON_ERROR_STOP on
-- Live chart feed: who may call what, what a transaction costs, how ticks are folded into candles, the freshness
-- throttle, the public feed's shape / "unchanged" / delta answers, and bad input.

TRUNCATE t.results;
TRUNCATE public.ican_coin_transactions, public.ican_price_ohlc, public.ican_price_ticks;
DELETE FROM public.ican_price_cache;

-- ================================================================ 1. Grants
DO $t$
DECLARE e TEXT; f TEXT;
BEGIN
  -- The internal functions: nobody on the API may call them (the old tick function was open to everyone).
  FOREACH f IN ARRAY ARRAY[
    'public.ican_record_price_tick(numeric)', 'public.ican_flush_price_ticks(boolean,boolean)',
    'public.ican_current_price_ugx(numeric)', 'public.ican_notify_price_change(bigint)'] LOOP
    PERFORM t.check('1.1 anon cannot execute ' || f, NOT has_function_privilege('anon', f, 'EXECUTE'));
    PERFORM t.check('1.2 signed-in users cannot execute ' || f, NOT has_function_privilege('authenticated', f, 'EXECUTE'));
  END LOOP;
  -- The public surface keeps working for signed-out visitors.
  FOREACH f IN ARRAY ARRAY[
    'public.ican_get_public_feed(integer,bigint,timestamptz)', 'public.ican_get_market_snapshot()',
    'public.ican_ensure_current_candle()'] LOOP
    PERFORM t.check('1.3 anon can still execute ' || f, has_function_privilege('anon', f, 'EXECUTE'));
  END LOOP;

  PERFORM t.as_anon();
  e := t.err($$SELECT public.ican_record_price_tick(1000000)$$);
  PERFORM t.check('1.4 a visitor cannot inject trading volume', e LIKE 'permission denied%', e);
  e := t.err($$SELECT count(*) FROM public.ican_price_ticks$$);
  PERFORM t.check('1.5 a visitor cannot read the tick log', e LIKE 'permission denied%', e);
  e := t.err($$SELECT count(*) FROM public.ican_price_cache$$);
  PERFORM t.check('1.6 a visitor cannot read the price cache table directly', e LIKE 'permission denied%', e);
  e := t.err($$INSERT INTO public.ican_price_ticks (volume) VALUES (5)$$);
  PERFORM t.check('1.7 a visitor cannot write the tick log', e LIKE 'permission denied%', e);
  PERFORM t.reset();
END $t$;

-- ================================================================ 2. A money transaction only logs a tick
DO $t$
DECLARE n INT; v NUMERIC; c INT; pending INT; cache_rows INT;
BEGIN
  SELECT count(*) INTO c FROM public.ican_price_ohlc;
  INSERT INTO public.ican_coin_transactions (user_id, type, ican_amount, local_amount, status, transaction_type)
  VALUES (t.u(1), 'purchase', 2.5, 15000, 'completed', 'purchase');
  SELECT count(*) INTO pending FROM public.ican_price_ticks;
  PERFORM t.check('2.1 a completed transaction appends one tick', pending = 1, pending::TEXT);
  PERFORM t.check('2.2 ...and touches no candle (nothing recomputed on the money path)',
    (SELECT count(*) FROM public.ican_price_ohlc) = c, c::TEXT);
  SELECT count(*) INTO cache_rows FROM public.ican_price_cache;
  PERFORM t.check('2.3 ...and does not build the price cache either', cache_rows = 0, cache_rows::TEXT);

  INSERT INTO public.ican_coin_transactions (user_id, type, ican_amount, local_amount, status, transaction_type)
  VALUES (t.u(1), 'purchase', 4, 24000, 'pending', 'purchase');
  SELECT count(*) INTO pending FROM public.ican_price_ticks;
  PERFORM t.check('2.4 a pending transaction logs nothing', pending = 1, pending::TEXT);

  UPDATE public.ican_coin_transactions SET status = 'completed' WHERE ican_amount = 4;
  SELECT count(*) INTO pending FROM public.ican_price_ticks;
  PERFORM t.check('2.5 completing it later logs its tick', pending = 2, pending::TEXT);

  -- negative / null volume is clamped, never poisoning a candle
  PERFORM public.ican_record_price_tick(-50);
  PERFORM public.ican_record_price_tick(NULL);
  SELECT min(volume) INTO v FROM public.ican_price_ticks;
  PERFORM t.check('2.6 negative and null volume are clamped to zero', v = 0, v::TEXT);
END $t$;

-- ================================================================ 3. Folding ticks into candles
DO $t$
DECLARE did BOOLEAN; vol NUMERIC; cnt INT; left_ INT; r public.ican_price_ohlc; fair NUMERIC; cached NUMERIC; ver BIGINT;
BEGIN
  did := public.ican_flush_price_ticks(FALSE, FALSE);
  PERFORM t.check('3.1 the first flush does the work', did);
  SELECT * INTO r FROM public.ican_price_ohlc WHERE timeframe = '5m' ORDER BY open_time DESC LIMIT 1;
  PERFORM t.check('3.2 the current window has a 5-minute candle', r.id IS NOT NULL AND r.timeframe = '5m');
  PERFORM t.check('3.3 its volume is the sum of the real ticks (2.5 + 4)', r.trading_volume = 6.5, r.trading_volume::TEXT);
  PERFORM t.check('3.4 only ticks with volume count as transactions (zero-volume ticks do not)', r.transaction_count = 2, r.transaction_count::TEXT);
  SELECT count(*) INTO left_ FROM public.ican_price_ticks;
  PERFORM t.check('3.5 the tick log is emptied', left_ = 0, left_::TEXT);
  SELECT fair_price_ugx INTO fair FROM public.ican_compute_fair_price(public.ican_dev_secret());
  SELECT price_ugx, version INTO cached, ver FROM public.ican_price_cache WHERE id;
  PERFORM t.check('3.6 the candle closes on the engine''s fair price', r.close_price = fair, r.close_price || ' vs ' || fair);
  PERFORM t.check('3.7 the cache holds the same price', cached = fair);

  did := public.ican_flush_price_ticks(FALSE, FALSE);
  PERFORM t.check('3.8 a second call inside the freshness window does nothing', NOT did);
  did := public.ican_flush_price_ticks(TRUE, FALSE);
  PERFORM t.check('3.9 a forced flush still runs', did);
  PERFORM t.check('3.10 ...and with no change it does not bump the version', (SELECT version FROM public.ican_price_cache WHERE id) = ver,
    ver || ' -> ' || (SELECT version FROM public.ican_price_cache WHERE id));

  -- activity from an EARLIER window that was never flushed lands in that window, not the current one
  INSERT INTO public.ican_price_ticks (tick_time, volume) VALUES (now() - interval '2 hours', 7);
  PERFORM public.ican_flush_price_ticks(TRUE, FALSE);
  SELECT * INTO r FROM public.ican_price_ohlc WHERE open_time = to_timestamp(floor(extract(epoch FROM now() - interval '2 hours') / 300) * 300);
  PERFORM t.check('3.11 late activity creates its own earlier candle', r.id IS NOT NULL AND r.trading_volume = 7 AND r.transaction_count = 1,
    COALESCE(r.trading_volume::TEXT, 'none'));
  PERFORM t.check('3.12 ...opened flat (no invented price move)', r.open_price = r.close_price AND r.high_price = r.low_price);
  SELECT trading_volume INTO vol FROM public.ican_price_ohlc ORDER BY open_time DESC LIMIT 1;
  PERFORM t.check('3.13 ...and the current candle is not inflated by it', vol = 6.5, vol::TEXT);
END $t$;

-- ================================================================ 4. Snapshot (same shape as before)
DO $t$
DECLARE s RECORD; fair NUMERIC; n INT;
BEGIN
  PERFORM t.as_anon();
  SELECT * INTO s FROM public.ican_get_market_snapshot();
  PERFORM t.reset();
  SELECT fair_price_ugx INTO fair FROM public.ican_compute_fair_price(public.ican_dev_secret());
  PERFORM t.check('4.1 a visitor reads the snapshot', s.price_ugx IS NOT NULL);
  PERFORM t.check('4.2 its price is the engine''s', s.price_ugx = fair, s.price_ugx || ' vs ' || fair);
  PERFORM t.check('4.3 it carries every column the app reads',
    s.price_usd IS NOT NULL AND s.floor_ugx = 5000 AND s.fx_adjusted_ugx IS NOT NULL AND s.tx_count IS NOT NULL
    AND s.active_holders IS NOT NULL AND s.computed_at IS NOT NULL AND s.appreciation_pct IS NOT NULL AND s.ugx_depr_pct IS NOT NULL);
  -- if the cache is empty and cannot be built the snapshot still answers from the engine
  DELETE FROM public.ican_price_cache;
  PERFORM t.as_anon();
  SELECT * INTO s FROM public.ican_get_market_snapshot();
  PERFORM t.reset();
  PERFORM t.check('4.4 an empty cache is rebuilt on demand', s.price_ugx = fair, s.price_ugx::TEXT);
END $t$;

-- ================================================================ 5. The public feed
DO $t$
DECLARE f JSONB; f2 JSONB; ver BIGINT; n INT; e TEXT; newest TIMESTAMPTZ;
BEGIN
  -- enough history to make limits and deltas meaningful
  INSERT INTO public.ican_price_ohlc (open_price, high_price, low_price, close_price, trading_volume, transaction_count, timeframe, open_time, close_time)
  SELECT 6000, 6000, 6000, 6000, 0, 0, '5m', to_timestamp(floor(extract(epoch FROM now()) / 300) * 300) - (g * interval '5 minutes'), now()
  FROM generate_series(3, 700) g ON CONFLICT (timeframe, open_time) DO NOTHING;

  PERFORM t.as_anon();
  f := public.ican_get_public_feed(200, NULL, NULL);
  PERFORM t.reset();
  PERFORM t.check('5.1 anon gets the whole chart in one call', jsonb_array_length(f -> 'candles') = 200 AND f -> 'snapshot' ->> 'price_ugx' IS NOT NULL, f::TEXT);
  PERFORM t.check('5.2 candles come newest first',
    (f -> 'candles' -> 0 ->> 'open_time')::TIMESTAMPTZ > (f -> 'candles' -> 1 ->> 'open_time')::TIMESTAMPTZ);
  PERFORM t.check('5.3 candles carry prices and volume but nothing about users',
    f -> 'candles' -> 0 ?& ARRAY['open_price','high_price','low_price','close_price','trading_volume','open_time']
    AND NOT (f -> 'candles' -> 0 ? 'user_id') AND NOT (f -> 'candles' -> 0 ? 'wallet'));
  PERFORM t.check('5.4 it reports server time and a version', f ->> 'server_time' IS NOT NULL AND (f ->> 'version')::BIGINT >= 1);

  ver := (f ->> 'version')::BIGINT;
  f2 := public.ican_get_public_feed(200, ver, NULL);
  PERFORM t.check('5.5 asking again with the same version answers "unchanged" and sends no candles',
    (f2 ->> 'unchanged')::BOOLEAN AND NOT (f2 ? 'candles'), f2::TEXT);

  INSERT INTO public.ican_coin_transactions (user_id, type, ican_amount, local_amount, status, transaction_type)
  VALUES (t.u(2), 'purchase', 1, 6000, 'completed', 'purchase');
  PERFORM public.ican_flush_price_ticks(TRUE, FALSE);
  f2 := public.ican_get_public_feed(200, ver, NULL);
  PERFORM t.check('5.6 new activity bumps the version, so the caller gets fresh data', NOT COALESCE((f2 ->> 'unchanged')::BOOLEAN, FALSE) AND (f2 ->> 'version')::BIGINT > ver, f2 ->> 'version');

  newest := (f -> 'candles' -> 0 ->> 'open_time')::TIMESTAMPTZ;
  f2 := public.ican_get_public_feed(500, NULL, newest);
  n := jsonb_array_length(f2 -> 'candles');
  PERFORM t.check('5.7 a delta request returns only the last few candles', n BETWEEN 1 AND 5 AND (f2 ->> 'delta')::BOOLEAN, n::TEXT);

  f2 := public.ican_get_public_feed(100000, NULL, NULL);
  PERFORM t.check('5.8 the row limit is capped at 500', jsonb_array_length(f2 -> 'candles') = 500, jsonb_array_length(f2 -> 'candles')::TEXT);
  f2 := public.ican_get_public_feed(0, NULL, NULL);
  PERFORM t.check('5.9 a zero or negative limit still returns one candle', jsonb_array_length(f2 -> 'candles') = 1);
  f2 := public.ican_get_public_feed(NULL, NULL, NULL);
  PERFORM t.check('5.10 a NULL limit uses the default', jsonb_array_length(f2 -> 'candles') = 200);
END $t$;

-- ================================================================ 6. ensure_current_candle is cheap and harmless to hammer
DO $t$
DECLARE before_v BIGINT; after_v BIGINT; i INT;
BEGIN
  SELECT version INTO before_v FROM public.ican_price_cache WHERE id;
  PERFORM t.as_anon();
  FOR i IN 1..200 LOOP PERFORM public.ican_ensure_current_candle(); END LOOP;
  PERFORM t.reset();
  SELECT version INTO after_v FROM public.ican_price_cache WHERE id;
  PERFORM t.check('6.1 200 rapid calls from a visitor change nothing (no write amplification)', after_v = before_v, before_v || ' -> ' || after_v);
  PERFORM t.as_anon();
  PERFORM t.check('6.2 the older public ican_get_public_candles keeps working for visitors',
    (SELECT count(*) FROM public.ican_get_public_candles(5)) = 5);
  PERFORM t.reset();
END $t$;
