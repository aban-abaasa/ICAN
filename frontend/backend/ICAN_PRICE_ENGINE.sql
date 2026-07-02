-- ============================================================================
-- icaneracoin PRICE ENGINE — USD-ANCHORED GLOBAL STABILITY MODEL
-- Run in Supabase SQL Editor AFTER ICAN_GLOBAL_CURRENCY.sql
--
-- ECONOMIC MODEL:
--
--   1. USD ANCHOR (fixed forever)
--      The coin's real value is expressed in USD.
--      At launch: 5,000 UGX / 3,700 (UGX per USD) = $1.3514 USD per ICAN.
--      This USD value is PERMANENT — it is the inflation shield.
--
--   2. LOCAL CURRENCY AUTO-ADJUSTMENT
--      If UGX loses value vs USD (e.g. rate goes from 3,700 → 4,500 UGX/USD),
--      the UGX price of ICAN automatically rises to maintain the USD value:
--          new UGX price = $1.3514 × 4,500 = 6,081 UGX
--      So the holder's money NEVER loses USD purchasing power just because
--      UGX devalued. The coin reprices itself upward in UGX automatically.
--
--   3. USAGE APPRECIATION
--      Every transaction, unit of volume, and new holder adds a premium
--      (computed in UGX, scales with the current UGX/USD rate):
--          premium = (tx_count × 0.50) + (ican_volume × 0.002) + (holders × 15)
--      This grows on top of the FX-adjusted floor — the more people use it,
--      the more valuable it becomes in every currency worldwide.
--
--   FORMULA:
--      base_usd        = 5000 / initial_ugx_per_usd        e.g. 1.3514 USD
--      fx_floor_ugx    = base_usd × current_ugx_per_usd   e.g. 6,081 UGX
--      usage_premium   = txn_contrib + vol_contrib + holder_contrib
--      fair_price_ugx  = fx_floor_ugx + usage_premium
--      fair_price_usd  = fair_price_ugx / current_ugx_per_usd  (always ≥ base_usd)
-- ============================================================================

DROP FUNCTION IF EXISTS public.ican_compute_fair_price(TEXT);

CREATE OR REPLACE FUNCTION public.ican_compute_fair_price(dev_token TEXT)
RETURNS TABLE (
  -- USD anchor (never changes)
  base_usd_value       NUMERIC,
  initial_ugx_rate     NUMERIC,
  -- Current FX
  current_ugx_rate     NUMERIC,
  ugx_depreciation_pct NUMERIC,   -- positive = UGX weakened vs USD
  -- Floor breakdown
  original_floor_ugx   NUMERIC,   -- always 5000
  fx_adjusted_floor    NUMERIC,   -- 5000 repriced at current UGX/USD rate
  fx_protection_ugx    NUMERIC,   -- extra UGX added due to UGX depreciation
  -- Usage premiums
  tx_contribution      NUMERIC,
  volume_contribution  NUMERIC,
  holder_contribution  NUMERIC,
  usage_premium        NUMERIC,
  -- Final prices
  fair_price_ugx       NUMERIC,
  fair_price_usd       NUMERIC,
  appreciation_pct     NUMERIC,   -- % above original 5000 UGX floor
  usd_gain_pct         NUMERIC,   -- % gain vs original USD anchor
  -- Network activity
  tx_count             BIGINT,
  active_holders       BIGINT,
  total_volume         NUMERIC,
  computed_at          TIMESTAMPTZ
)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  v_orig_floor   NUMERIC := 5000;
  v_init_rate    NUMERIC := 3700;  -- fallback launch rate
  v_curr_rate    NUMERIC := 3700;
  v_base_usd     NUMERIC;
  v_fx_floor     NUMERIC;
  v_fx_protect   NUMERIC;
  v_tx_count     BIGINT  := 0;
  v_tx_vol       NUMERIC := 0;
  v_holders      BIGINT  := 0;
  v_tx_c         NUMERIC;
  v_vol_c        NUMERIC;
  v_hold_c       NUMERIC;
  v_premium      NUMERIC;
  v_fair_ugx     NUMERIC;
  v_fair_usd     NUMERIC;
  v_depr_pct     NUMERIC;
  v_app_pct      NUMERIC;
  v_usd_gain     NUMERIC;
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;

  -- 1. Get USD/UGX rates from currency table
  BEGIN
    SELECT
      COALESCE(initial_rate_to_ugx, rate_to_ugx, 3700),
      COALESCE(rate_to_ugx, 3700)
    INTO v_init_rate, v_curr_rate
    FROM public.ican_currency_rates
    WHERE currency_code = 'USD'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_init_rate := 3700; v_curr_rate := 3700;
  END;
  IF v_init_rate IS NULL OR v_init_rate = 0 THEN v_init_rate := 3700; END IF;
  IF v_curr_rate IS NULL OR v_curr_rate = 0 THEN v_curr_rate := 3700; END IF;

  -- 2. Fixed USD anchor value
  v_base_usd   := v_orig_floor / v_init_rate;   -- e.g. 5000/3700 = 1.3514 USD

  -- 3. FX-adjusted floor in UGX
  v_fx_floor   := v_base_usd * v_curr_rate;     -- auto-reprices when UGX weakens
  v_fx_protect := GREATEST(v_fx_floor - v_orig_floor, 0);  -- extra UGX from FX

  -- 4. UGX depreciation %
  v_depr_pct   := ROUND(((v_curr_rate - v_init_rate) / v_init_rate * 100)::NUMERIC, 4);

  -- 5. Usage premiums (in UGX, scales with current rate)
  BEGIN
    SELECT COUNT(*), COALESCE(SUM(ican_amount), 0)
    INTO v_tx_count, v_tx_vol
    FROM public.ican_coin_transactions
    WHERE status IN ('completed', 'confirmed', 'success');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    SELECT COUNT(*) INTO v_holders
    FROM public.user_accounts
    WHERE COALESCE(ican_coin_balance, 0) > 0;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  v_tx_c    := COALESCE(v_tx_count, 0)  * 0.50;
  v_vol_c   := COALESCE(v_tx_vol, 0)   * 0.002;
  v_hold_c  := COALESCE(v_holders, 0)  * 15;
  v_premium := v_tx_c + v_vol_c + v_hold_c;

  -- 6. Final prices
  v_fair_ugx  := v_fx_floor + v_premium;
  v_fair_usd  := v_fair_ugx / v_curr_rate;
  v_app_pct   := ROUND(((v_fair_ugx - v_orig_floor) / v_orig_floor * 100)::NUMERIC, 4);
  v_usd_gain  := ROUND(((v_fair_usd  - v_base_usd)  / v_base_usd  * 100)::NUMERIC, 4);

  RETURN QUERY SELECT
    ROUND(v_base_usd,   6),
    ROUND(v_init_rate,  2),
    ROUND(v_curr_rate,  2),
    v_depr_pct,
    v_orig_floor,
    ROUND(v_fx_floor,   2),
    ROUND(v_fx_protect, 2),
    ROUND(v_tx_c,   2),
    ROUND(v_vol_c,  2),
    ROUND(v_hold_c, 2),
    ROUND(v_premium,2),
    ROUND(v_fair_ugx, 2),
    ROUND(v_fair_usd, 6),
    v_app_pct,
    v_usd_gain,
    COALESCE(v_tx_count, 0),
    COALESCE(v_holders,  0),
    COALESCE(v_tx_vol,   0),
    NOW()::TIMESTAMPTZ;
END; $$;

GRANT EXECUTE ON FUNCTION public.ican_compute_fair_price(TEXT) TO anon, authenticated;


-- ============================================================================
-- APPLY COMPUTED PRICE — write fair price back into market prices table
-- ============================================================================
DROP FUNCTION IF EXISTS public.ican_apply_computed_price(TEXT);

CREATE OR REPLACE FUNCTION public.ican_apply_computed_price(dev_token TEXT)
RETURNS TABLE (applied_price_ugx NUMERIC, applied_price_usd NUMERIC, appreciation_pct NUMERIC)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  v_ugx NUMERIC; v_usd NUMERIC; v_app NUMERIC; v_vol NUMERIC;
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT pe.fair_price_ugx, pe.fair_price_usd, pe.appreciation_pct
  INTO   v_ugx, v_usd, v_app
  FROM   public.ican_compute_fair_price(dev_token) pe LIMIT 1;

  BEGIN
    SELECT COALESCE(SUM(ican_amount), 0) INTO v_vol
    FROM public.ican_coin_transactions WHERE status IN ('completed','confirmed','success');
  EXCEPTION WHEN OTHERS THEN v_vol := 0; END;

  BEGIN
    INSERT INTO public.ican_coin_market_prices
      (price_ugx, percentage_change_24h, trading_volume_24h, market_cap)
    VALUES (v_ugx, v_app, v_vol, 0);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN QUERY SELECT v_ugx, v_usd, v_app;
END; $$;

GRANT EXECUTE ON FUNCTION public.ican_apply_computed_price(TEXT) TO anon, authenticated;


SELECT 'icaneracoin USD-Anchored Price Engine installed' AS status;
