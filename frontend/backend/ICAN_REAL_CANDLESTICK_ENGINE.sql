-- ============================================================================
-- icaneracoin REAL CANDLESTICK ENGINE
-- Run in Supabase SQL Editor AFTER ICAN_PRICE_ENGINE.sql (needs the
-- updated ican_compute_fair_price from that file — re-run it first if
-- you're applying this later).
--
-- PROBLEM THIS FIXES:
--   ican_price_ohlc has only ever held one hand-written 10-row sample
--   insert (see create_missing_tables.sql). Nothing ever wrote a real
--   candle into it, so every chart reading from that table was showing
--   the same fake sawtooth of volume bars on a flat price line, repeated
--   every time that migration was re-run.
--
-- WHAT THIS INSTALLS:
--   A trigger on every REAL money-moving event — personal ICAN transfers,
--   PitchIn business-wallet transfers, trust-group contributions/payouts,
--   SACCO contributions/loan repayments — that recomputes the live fair
--   price and folds it into the currently-open 5-minute candle (or opens
--   a new one). No synthetic data, no cron job required: the candle
--   history grows exactly as fast as real activity happens, starting from
--   zero today and compounding into real years of trend as the platform
--   is used.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────
-- 1. Wipe the fake seed candles. Confirmed: this table has never held
--    anything except the hardcoded sample insert, re-appended on every
--    migration re-run (no unique constraint stopped it). Safe to clear.
-- ─────────────────────────────────────────────────────────────────────────
TRUNCATE TABLE public.ican_price_ohlc;

-- One (timeframe, open_time) bucket = one candle, so a real trigger firing
-- many times within the same 5-minute window updates that candle instead
-- of creating duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ican_ohlc_bucket
  ON public.ican_price_ohlc(timeframe, open_time);


-- ─────────────────────────────────────────────────────────────────────────
-- 2. Record one real price tick — called by triggers below, never
--    directly by clients.
-- ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.ican_record_price_tick(NUMERIC);

CREATE OR REPLACE FUNCTION public.ican_record_price_tick(p_volume_contribution NUMERIC DEFAULT 0)
RETURNS VOID
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  _tok         CONSTANT TEXT := 'dev_ICAN_Pr0_KV25';
  v_price_ugx  NUMERIC;
  -- 5-minute buckets, not hourly: squashing a whole hour into one candle
  -- means real activity only ever produces one flat dash on the chart at a
  -- time — real price ticks need to spread across enough distinct candles
  -- to actually look like a candlestick series instead of a single point.
  v_bucket     TIMESTAMPTZ := to_timestamp(floor(extract(epoch FROM now()) / 300) * 300);
  v_vol        NUMERIC := GREATEST(COALESCE(p_volume_contribution, 0), 0);
BEGIN
  SELECT fair_price_ugx INTO v_price_ugx
  FROM public.ican_compute_fair_price(_tok) LIMIT 1;

  IF v_price_ugx IS NULL THEN RETURN; END IF;

  -- transaction_count only advances for a real transaction (v_vol > 0).
  -- A 0-volume tick (see ican_ensure_current_candle below) still refreshes
  -- high/low/close/close_time to the live price without pretending a
  -- transaction happened.
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


-- ─────────────────────────────────────────────────────────────────────────
-- PUBLIC: ensure the current 5-minute window has a candle reflecting the
-- LIVE real price. Self-healing — closes exactly the gap where real
-- historical activity (already baked into ican_compute_fair_price, e.g. a
-- price already sitting above the floor from real business/trust/SACCO
-- usage) had never been "ticked" into a candle because it all happened
-- before this engine was installed, or because a window passed with no
-- new transaction. Safe to expose to clients: it always ticks 0 volume, so it
-- can only paint the current real price onto the chart — it can never be
-- used to fake trading activity or inflate transaction_count.
-- ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.ican_ensure_current_candle();

CREATE OR REPLACE FUNCTION public.ican_ensure_current_candle()
RETURNS VOID
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.ican_record_price_tick(0);
END; $$;

GRANT EXECUTE ON FUNCTION public.ican_ensure_current_candle() TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 3. One trigger function per source table — each converts its own row
--    shape into an icaneracoin-equivalent volume contribution, then calls
--    ican_record_price_tick(). Only fires on rows that represent real,
--    completed economic activity (matching the same status/type filters
--    ican_compute_fair_price uses), so a pending or rejected transaction
--    never moves the chart.
-- ─────────────────────────────────────────────────────────────────────────

-- Personal icaneracoin transfers/buys/sells
CREATE OR REPLACE FUNCTION public.ican_tick_on_coin_transaction()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('completed', 'confirmed', 'success') THEN
    PERFORM public.ican_record_price_tick(COALESCE(NEW.ican_amount, 0));
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS ican_price_tick_coin_tx ON public.ican_coin_transactions;
CREATE TRIGGER ican_price_tick_coin_tx
  AFTER INSERT OR UPDATE OF status ON public.ican_coin_transactions
  FOR EACH ROW EXECUTE FUNCTION public.ican_tick_on_coin_transaction();

-- PitchIn business-wallet transfers
CREATE OR REPLACE FUNCTION public.ican_tick_on_business_wallet_transaction()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    PERFORM public.ican_record_price_tick(COALESCE(NEW.amount_ican, 0));
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS ican_price_tick_business_wallet ON public.ican_business_wallet_transactions;
CREATE TRIGGER ican_price_tick_business_wallet
  AFTER INSERT OR UPDATE OF status ON public.ican_business_wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.ican_tick_on_business_wallet_transaction();

-- Trust-group contributions and payouts
CREATE OR REPLACE FUNCTION public.ican_tick_on_trust_transaction()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vol NUMERIC;
BEGIN
  IF NEW.transaction_type IN ('contribution', 'payout') THEN
    IF UPPER(COALESCE(NEW.currency, 'ICAN')) = 'ICAN' THEN
      v_vol := NEW.amount;
    ELSE
      -- Resolve the contributor's REAL currency rate (ican_currency_rates
      -- carries 100+ real country currencies, seeded in
      -- ICAN_LIVE_PRICING.sql). If a currency code genuinely isn't found,
      -- fall back to 1:1 UGX rather than assuming USD — UGX is the
      -- system's actual internal base currency, so this is a neutral
      -- fallback instead of quietly mislabeling an unknown currency as USD.
      SELECT (NEW.amount * COALESCE(r.rate_to_ugx, 1)) / NULLIF(fx.fx_adjusted_floor, 0)
      INTO v_vol
      FROM public.ican_compute_fair_price('dev_ICAN_Pr0_KV25') fx
      LEFT JOIN public.ican_currency_rates r ON r.currency_code = UPPER(NEW.currency)
      LIMIT 1;
    END IF;
    PERFORM public.ican_record_price_tick(COALESCE(v_vol, 0));
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS ican_price_tick_trust_tx ON public.trust_transactions;
CREATE TRIGGER ican_price_tick_trust_tx
  AFTER INSERT ON public.trust_transactions
  FOR EACH ROW EXECUTE FUNCTION public.ican_tick_on_trust_transaction();

-- SACCO contributions (native icaneracoin amounts, no currency column)
CREATE OR REPLACE FUNCTION public.ican_tick_on_sacco_contribution()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ican_record_price_tick(COALESCE(NEW.amount, 0));
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS ican_price_tick_sacco_contribution ON public.ican_sacco_contributions;
CREATE TRIGGER ican_price_tick_sacco_contribution
  AFTER INSERT ON public.ican_sacco_contributions
  FOR EACH ROW EXECUTE FUNCTION public.ican_tick_on_sacco_contribution();

-- SACCO loan repayments
CREATE OR REPLACE FUNCTION public.ican_tick_on_sacco_repayment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ican_record_price_tick(COALESCE(NEW.amount, 0));
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS ican_price_tick_sacco_repayment ON public.ican_sacco_repayments;
CREATE TRIGGER ican_price_tick_sacco_repayment
  AFTER INSERT ON public.ican_sacco_repayments
  FOR EACH ROW EXECUTE FUNCTION public.ican_tick_on_sacco_repayment();


-- ─────────────────────────────────────────────────────────────────────────
-- 4. Bootstrap today's candle right now. Real business/trust/SACCO/coin
--    activity that happened BEFORE this engine was installed never fired
--    these triggers (triggers only fire on new rows going forward), even
--    though ican_compute_fair_price already reflects it (e.g. the price
--    already sitting above the floor). This paints that already-real
--    price onto the chart immediately instead of waiting for the next
--    transaction.
-- ─────────────────────────────────────────────────────────────────────────
SELECT public.ican_ensure_current_candle();


-- ─────────────────────────────────────────────────────────────────────────
-- VERIFY
-- ─────────────────────────────────────────────────────────────────────────
SELECT 'icaneracoin Real Candlestick Engine installed — ican_price_ohlc is now driven entirely by real transactions' AS status;
SELECT COUNT(*) AS existing_real_candles FROM public.ican_price_ohlc;
