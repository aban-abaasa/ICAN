-- Chart history by period: "show me March 2025", "show me all of last year", for the icaneracoin chart AND the ICEC-S
-- (stable coin) chart. The earlier ican_get_public_candle_history only looks back from now; these take an explicit window
-- (p_from .. p_to) so a visitor can pick any year or month, and roll it into candles of the size the chart asks for so a
-- year never sends 100,000 rows to a phone. Read-only, granted to signed-out visitors, at most 2000 candles come back.
--
-- Both return the same columns as ican_get_public_candles, so the chart draws them with the one code path.
-- Safe to run more than once. Requires the ICEC-S migrations (20261024100000 ...) for the two ICEC-S functions.

-- icaneracoin: candles in a window ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ican_get_public_candle_range(
  p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL, p_bucket_seconds INT DEFAULT 3600)
RETURNS TABLE (
  open_price     NUMERIC,
  high_price     NUMERIC,
  low_price      NUMERIC,
  close_price    NUMERIC,
  trading_volume NUMERIC,
  open_time      TIMESTAMPTZ,
  close_time     TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH p AS (
    SELECT COALESCE(p_from, now() - INTERVAL '7 days') AS f,
           LEAST(COALESCE(p_to, now()), now() + INTERVAL '1 day') AS t,
           LEAST(GREATEST(COALESCE(p_bucket_seconds, 3600), 300), 604800) AS s
  ),
  b AS (
    SELECT to_timestamp(floor(extract(epoch FROM c.open_time) / p.s) * p.s) AS bucket,
           c.open_price, c.high_price, c.low_price, c.close_price, c.trading_volume, c.open_time, c.close_time
    FROM public.ican_price_ohlc c, p
    WHERE c.open_time >= p.f AND c.open_time < p.t
  )
  SELECT (array_agg(b.open_price  ORDER BY b.open_time ASC))[1],
         max(b.high_price),
         min(b.low_price),
         (array_agg(b.close_price ORDER BY b.open_time DESC))[1],
         COALESCE(sum(b.trading_volume), 0),
         b.bucket,
         max(b.close_time)
  FROM b
  GROUP BY b.bucket
  ORDER BY b.bucket DESC
  LIMIT 2000;
$$;
GRANT EXECUTE ON FUNCTION public.ican_get_public_candle_range(TIMESTAMPTZ, TIMESTAMPTZ, INT) TO anon, authenticated;

-- icaneracoin: the first and last candle ever stored (the chart offers only the years in between) ----------------------
CREATE OR REPLACE FUNCTION public.ican_get_public_candle_bounds()
RETURNS TABLE (first_time TIMESTAMPTZ, last_time TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT min(c.open_time), max(c.open_time) FROM public.ican_price_ohlc c;
$$;
GRANT EXECUTE ON FUNCTION public.ican_get_public_candle_bounds() TO anon, authenticated;

-- ICEC-S: the unit's recorded value rolled into candles over a window -------------------------------------------------
-- Minute rows are kept 7 days and the on-the-hour row for good, so a recent window can be drawn down to 5-minute candles and
-- an old one at hourly or coarser. Nothing is simulated: a candle is the real recorded values inside its bucket.
DO $$
BEGIN
  IF to_regclass('icanera_stable.price_history') IS NULL THEN
    RAISE NOTICE 'ICEC-S is not installed: skipping its chart range functions.';
    RETURN;
  END IF;

  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.ican_stable_history_range(
      p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL, p_bucket_seconds INT DEFAULT 3600)
    RETURNS TABLE (
      open_price     NUMERIC,
      high_price     NUMERIC,
      low_price      NUMERIC,
      close_price    NUMERIC,
      trading_volume NUMERIC,
      open_time      TIMESTAMPTZ,
      close_time     TIMESTAMPTZ
    )
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = icanera_stable, public AS $g$
      WITH p AS (
        SELECT COALESCE(p_from, now() - INTERVAL '7 days') AS f,
               LEAST(COALESCE(p_to, now()), now() + INTERVAL '1 day') AS t,
               LEAST(GREATEST(COALESCE(p_bucket_seconds, 3600), 60), 604800) AS s
      ),
      b AS (
        SELECT to_timestamp(floor(extract(epoch FROM h.taken_at) / p.s) * p.s) AS bucket,
               h.unit_ugx::NUMERIC AS v, h.taken_at
        FROM icanera_stable.price_history h, p
        WHERE h.taken_at >= p.f AND h.taken_at < p.t AND h.unit_ugx > 0
      )
      SELECT (array_agg(b.v ORDER BY b.taken_at ASC))[1],
             max(b.v),
             min(b.v),
             (array_agg(b.v ORDER BY b.taken_at DESC))[1],
             0::NUMERIC,
             b.bucket,
             max(b.taken_at)
      FROM b
      GROUP BY b.bucket
      ORDER BY b.bucket DESC
      LIMIT 2000;
    $g$
  $f$;
  EXECUTE 'REVOKE ALL ON FUNCTION public.ican_stable_history_range(TIMESTAMPTZ, TIMESTAMPTZ, INT) FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.ican_stable_history_range(TIMESTAMPTZ, TIMESTAMPTZ, INT) TO anon, authenticated';

  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.ican_stable_history_bounds()
    RETURNS TABLE (first_time TIMESTAMPTZ, last_time TIMESTAMPTZ)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = icanera_stable, public AS $g$
      SELECT min(h.taken_at), max(h.taken_at) FROM icanera_stable.price_history h;
    $g$
  $f$;
  EXECUTE 'REVOKE ALL ON FUNCTION public.ican_stable_history_bounds() FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.ican_stable_history_bounds() TO anon, authenticated';
END $$;

NOTIFY pgrst, 'reload schema';
