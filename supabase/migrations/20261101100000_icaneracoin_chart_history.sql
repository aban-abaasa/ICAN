-- icaneracoin chart history: the whole of a week / month / year (or everything) rolled up into candles of a fitting
-- size, so the public chart can answer "show me last year" without sending 100,000 five-minute candles to a browser.
-- Read-only, granted to signed-out visitors like ican_get_public_candles. At most 2000 candles come back.

CREATE OR REPLACE FUNCTION public.ican_get_public_candle_history(p_days INT DEFAULT 7, p_bucket_seconds INT DEFAULT 3600)
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
    SELECT LEAST(GREATEST(COALESCE(p_days, 7), 1), 3650) AS d,
           LEAST(GREATEST(COALESCE(p_bucket_seconds, 3600), 300), 604800) AS s
  ),
  b AS (
    SELECT to_timestamp(floor(extract(epoch FROM c.open_time) / p.s) * p.s) AS bucket,
           c.open_price, c.high_price, c.low_price, c.close_price, c.trading_volume, c.open_time, c.close_time
    FROM public.ican_price_ohlc c, p
    WHERE c.open_time >= now() - make_interval(days => p.d)
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

GRANT EXECUTE ON FUNCTION public.ican_get_public_candle_history(INT, INT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
