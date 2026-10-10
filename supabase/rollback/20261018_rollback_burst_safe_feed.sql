-- Rolls back 20261018100000_icaneracoin_burst_safe_feed.sql.
--
-- Roll back 20261018110000_icaneracoin_atomic_trade.sql FIRST if you applied it (the trade functions read the
-- price cache this file removes).
--
-- It folds any ticks still waiting into the candles, stops the 5-second job, puts back the earlier bodies of
-- ican_record_price_tick / ican_ensure_current_candle / ican_get_market_snapshot, and drops the new objects.
-- ican_record_price_tick stays closed to clients: it was never meant to be callable from the API, and putting
-- that back would reopen the hole that let a visitor add made-up volume to the chart.

DO $$
BEGIN
  IF to_regprocedure('public.ican_flush_price_ticks(boolean,boolean)') IS NOT NULL THEN
    PERFORM public.ican_flush_price_ticks(TRUE, TRUE);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule('icaneracoin-flush-price-ticks');
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL; -- the job was never scheduled
END $$;

CREATE OR REPLACE FUNCTION public.ican_record_price_tick(p_volume_contribution NUMERIC DEFAULT 0)
RETURNS VOID
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  _tok         CONSTANT TEXT := public.ican_dev_secret();
  v_price_ugx  NUMERIC;
  v_bucket     TIMESTAMPTZ := to_timestamp(floor(extract(epoch FROM now()) / 300) * 300);
  v_vol        NUMERIC := GREATEST(COALESCE(p_volume_contribution, 0), 0);
BEGIN
  SELECT fair_price_ugx INTO v_price_ugx
  FROM public.ican_compute_fair_price(_tok) LIMIT 1;

  IF v_price_ugx IS NULL THEN RETURN; END IF;

  INSERT INTO public.ican_price_ohlc
    (open_price, high_price, low_price, close_price,
     trading_volume, transaction_count, timeframe, open_time, close_time)
  VALUES
    (v_price_ugx, v_price_ugx, v_price_ugx, v_price_ugx,
     v_vol, CASE WHEN v_vol > 0 THEN 1 ELSE 0 END, '5m', v_bucket, now())
  ON CONFLICT (timeframe, open_time) DO UPDATE SET
    high_price        = GREATEST(public.ican_price_ohlc.high_price, EXCLUDED.close_price),
    low_price          = LEAST(public.ican_price_ohlc.low_price, EXCLUDED.close_price),
    close_price        = EXCLUDED.close_price,
    trading_volume     = public.ican_price_ohlc.trading_volume + EXCLUDED.trading_volume,
    transaction_count  = public.ican_price_ohlc.transaction_count + EXCLUDED.transaction_count,
    close_time         = now();
END; $$;
REVOKE ALL ON FUNCTION public.ican_record_price_tick(NUMERIC) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ican_ensure_current_candle()
RETURNS VOID
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.ican_record_price_tick(0);
END; $$;

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
DECLARE _tok CONSTANT TEXT := public.ican_dev_secret();
BEGIN
  RETURN QUERY
    SELECT
      pe.fair_price_ugx,
      pe.fair_price_usd,
      pe.original_floor_ugx,
      pe.fx_adjusted_floor,
      pe.appreciation_pct,
      pe.ugx_depreciation_pct,
      pe.active_holders,
      pe.tx_count,
      pe.computed_at
    FROM public.ican_compute_fair_price(_tok) pe LIMIT 1;
END; $$;

DROP FUNCTION IF EXISTS public.ican_get_public_feed(INT, BIGINT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.ican_current_price_ugx(NUMERIC);
DROP FUNCTION IF EXISTS public.ican_flush_price_ticks(BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS public.ican_notify_price_change(BIGINT);
DROP TABLE IF EXISTS public.ican_price_ticks;
DROP TABLE IF EXISTS public.ican_price_cache;

NOTIFY pgrst, 'reload schema';
