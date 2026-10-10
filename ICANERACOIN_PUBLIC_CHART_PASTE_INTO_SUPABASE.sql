-- ============================================================
-- Public icaneracoin chart (/icaneracoin and the landing-page chart)
--
-- public.ican_price_ohlc is only GRANTed SELECT to `authenticated`, so a signed-out visitor -- which is what
-- Google sends to the public chart page -- could not read a single candle. This adds ONE read-only function
-- that returns the most recent candles to anyone, instead of opening the table itself:
--   * only the price/volume/time columns of the candle are returned -- no user, wallet or transaction data
--   * the row count is capped (1..500) so it cannot be used to dump the whole table
--   * the table keeps its existing grants and RLS, so nothing else about it changes
--
-- The candles are the real ones written by the Real Candlestick Engine (ICAN_REAL_CANDLESTICK_ENGINE.sql);
-- nothing here creates or alters price data. The current price tick is painted by the already-public
-- ican_ensure_current_candle(), and the headline price comes from the already-public ican_get_market_snapshot().
--
-- Requires: ican_price_ohlc (create_missing_tables.sql). Safe to run more than once.
-- ============================================================

DROP FUNCTION IF EXISTS public.ican_get_public_candles(INT);

CREATE OR REPLACE FUNCTION public.ican_get_public_candles(p_limit INT DEFAULT 200)
RETURNS TABLE (
  id                BIGINT,
  open_price        NUMERIC,
  high_price        NUMERIC,
  low_price         NUMERIC,
  close_price       NUMERIC,
  trading_volume    NUMERIC,
  transaction_count INT,
  timeframe         TEXT,
  open_time         TIMESTAMPTZ,
  close_time        TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.open_price, c.high_price, c.low_price, c.close_price,
         c.trading_volume, c.transaction_count, c.timeframe, c.open_time, c.close_time
  FROM public.ican_price_ohlc c
  ORDER BY c.open_time DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
$$;

GRANT EXECUTE ON FUNCTION public.ican_get_public_candles(INT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
