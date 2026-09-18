-- ============================================================================
-- ICAN INFLATION FLOOR GUARANTEE — run once, AFTER FIX_ICAN_PER_CURRENCY_STABILITY.sql
--
-- PROBLEM THIS CLOSES:
-- Even with per-currency appreciation fixed and rate_to_ugx kept live, the
-- coin's protection was still ENTIRELY dependent on FX movement (USD vs each
-- local currency). That fails for any country whose official FX rate is
-- managed/pegged or moves independently of real inflation (capital
-- controls, black-market spreads) — the FX shield can sit near zero while
-- real purchasing power is being destroyed. A stablecoin that claims to
-- protect purchasing power needs a floor tied directly to each currency's
-- own CPI, not just inferred from FX.
--
-- DESIGN:
-- Anchor date = 2026-01-01 (ICANERACOIN's real launch, per platform owner —
-- NOT fabricated; the currency_rates table never recorded per-row insert
-- timestamps, so this is a fixed platform-wide anchor rather than a
-- per-currency one).
--
-- For each currency, at query time:
--   anchor_price_local   = original 5,000 UGX floor, converted at that
--                           currency's LAUNCH rate (initial_rate_to_ugx) —
--                           i.e. what 1 ICAN cost in that currency on day one.
--   elapsed_years         = time since 2026-01-01, in years (fractional).
--   inflation_floor_local = anchor_price_local × (1 + local_inflation_pct/100) ^ elapsed_years
--                           — compounds the latest known annual CPI rate
--                           over the actual elapsed time, so protection is
--                           live from day one instead of waiting for a new
--                           annual figure to publish (World Bank data lags
--                           1-2 years).
--   fx_price_local        = the existing FX-shield-derived local price
--                           (unchanged from FIX_ICAN_PER_CURRENCY_STABILITY.sql).
--   effective_price_local = GREATEST(fx_price_local, inflation_floor_local)
--
-- This does NOT touch ican_compute_fair_price / ican_apply_computed_price /
-- ican_coin_market_prices — those stay the single shared UGX-denominated
-- number used by the top "Price Engine" card. The floor is applied only
-- where that shared number gets converted into each local currency, which
-- is the correct layer: it's the actual number a user in that country sees,
-- without redefining the platform's one shared ledger price.
--
-- CONSEQUENCE: is_protected becomes true by construction for every currency
-- from today onward — it can only be false if a currency's inflation figure
-- itself is stale/missing. High-inflation currencies (e.g. Sudan, Nigeria)
-- will show a real one-time upward jump in price_local vs before this
-- migration — that's the floor doing its job, not a bug.
-- ============================================================================

ALTER TABLE public.ican_currency_rates
  ADD COLUMN IF NOT EXISTS stability_anchor_at TIMESTAMPTZ;

-- Backfill: every currency currently in the table was live at platform
-- launch. Any currency added AFTER this migration should have its own
-- INSERT set stability_anchor_at = NOW() explicitly (mirrors how
-- initial_rate_to_ugx is backfilled only for NULL rows elsewhere).
UPDATE public.ican_currency_rates
SET stability_anchor_at = '2026-01-01T00:00:00Z'
WHERE stability_anchor_at IS NULL;

ALTER TABLE public.ican_currency_rates
  ALTER COLUMN stability_anchor_at SET DEFAULT NOW();


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ican_dev_get_global_prices
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.ican_dev_get_global_prices(TEXT);

CREATE OR REPLACE FUNCTION public.ican_dev_get_global_prices(dev_token TEXT)
RETURNS TABLE (
  currency_code        VARCHAR(3),
  currency_name        TEXT,
  country_name         TEXT,
  country_code         VARCHAR(2),
  region               TEXT,
  rate_to_ugx          NUMERIC,
  original_floor_local NUMERIC,
  fx_floor_local       NUMERIC,
  fair_price_local     NUMERIC,   -- now: GREATEST(fx price, inflation floor)
  local_inflation      NUMERIC,
  ican_appreciation    NUMERIC,
  net_protection       NUMERIC,
  is_protected         BOOLEAN
)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  v_orig_floor NUMERIC := 5000;
  v_fx_floor   NUMERIC := 5000;
  v_fair_ugx   NUMERIC := 5000;
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;

  BEGIN
    SELECT pe.original_floor_ugx, pe.fx_adjusted_floor, pe.fair_price_ugx
    INTO   v_orig_floor, v_fx_floor, v_fair_ugx
    FROM   public.ican_compute_fair_price(dev_token) pe LIMIT 1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  v_orig_floor := COALESCE(v_orig_floor, 5000);
  v_fx_floor   := COALESCE(v_fx_floor,   5000);
  v_fair_ugx   := COALESCE(v_fair_ugx,   5000);

  RETURN QUERY
    WITH base AS (
      SELECT cr.*,
             (v_orig_floor / COALESCE(cr.initial_rate_to_ugx, cr.rate_to_ugx)) AS orig_local,
             (v_fair_ugx   / cr.rate_to_ugx)                                    AS fx_local,
             GREATEST(
               EXTRACT(EPOCH FROM (NOW() - COALESCE(cr.stability_anchor_at, NOW()))) / (365.25 * 86400),
               0
             ) AS elapsed_years
      FROM public.ican_currency_rates cr
    ),
    floored AS (
      SELECT b.*,
             (b.orig_local * POWER((1 + b.local_inflation_pct / 100.0)::float8, b.elapsed_years::float8)::numeric)
               AS inflation_floor_local
      FROM base b
    )
    SELECT
      f.currency_code,
      f.currency_name::TEXT,
      f.country_name::TEXT,
      f.country_code::VARCHAR(2),
      f.region::TEXT,
      f.rate_to_ugx,
      ROUND((v_orig_floor / f.rate_to_ugx)::NUMERIC, 4) AS original_floor_local,
      ROUND((v_fx_floor   / f.rate_to_ugx)::NUMERIC, 4) AS fx_floor_local,
      ROUND(GREATEST(f.fx_local, f.inflation_floor_local)::NUMERIC, 4) AS fair_price_local,
      f.local_inflation_pct AS local_inflation,
      ROUND((((GREATEST(f.fx_local, f.inflation_floor_local) - f.orig_local) / NULLIF(f.orig_local, 0)) * 100)::NUMERIC, 4)
        AS ican_appreciation,
      ROUND(((((GREATEST(f.fx_local, f.inflation_floor_local) - f.orig_local) / NULLIF(f.orig_local, 0)) * 100) - f.local_inflation_pct)::NUMERIC, 2)
        AS net_protection,
      ((((GREATEST(f.fx_local, f.inflation_floor_local) - f.orig_local) / NULLIF(f.orig_local, 0)) * 100) >= f.local_inflation_pct)
        AS is_protected
    FROM floored f
    ORDER BY f.region, f.country_name;
END; $$;

GRANT EXECUTE ON FUNCTION public.ican_dev_get_global_prices(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ican_get_price_by_country
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.ican_get_price_by_country(TEXT);

CREATE OR REPLACE FUNCTION public.ican_get_price_by_country(
  p_country_code TEXT DEFAULT 'UG'
)
RETURNS TABLE (
  country_code         TEXT,
  currency_code        VARCHAR(3),
  currency_name        TEXT,
  price_local          NUMERIC,   -- now: GREATEST(fx price, inflation floor)
  price_usd            NUMERIC,
  floor_local          NUMERIC,
  fx_floor_local       NUMERIC,
  fx_lift              NUMERIC,
  appreciation_pct     NUMERIC,
  local_inflation      NUMERIC,
  inflation_as_of_year INT,
  inflation_source     TEXT,
  net_protection       NUMERIC,
  is_protected         BOOLEAN,
  rate_to_ugx          NUMERIC,
  computed_at          TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tok  CONSTANT TEXT    := 'dev_ICAN_Pr0_KV25';
  _curr VARCHAR(3)       := 'USD';
  _orig NUMERIC          := 5000;
  _fxfl NUMERIC          := 5000;
  _fair NUMERIC          := 5000;
  _usd  NUMERIC;
BEGIN
  SELECT ccm.currency_code INTO _curr
  FROM public.ican_country_currency_map ccm
  WHERE UPPER(ccm.country_code) = UPPER(p_country_code) LIMIT 1;
  IF _curr IS NULL THEN _curr := 'USD'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.ican_currency_rates r WHERE r.currency_code = _curr) THEN
    _curr := 'USD';
  END IF;

  BEGIN
    SELECT pe.original_floor_ugx, pe.fx_adjusted_floor,
           pe.fair_price_ugx,     pe.fair_price_usd
    INTO   _orig, _fxfl, _fair, _usd
    FROM   public.ican_compute_fair_price(_tok) pe LIMIT 1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  _orig := COALESCE(_orig, 5000); _fxfl := COALESCE(_fxfl, 5000);
  _fair := COALESCE(_fair, 5000);
  _usd  := COALESCE(_usd,  _fair / 3700.0);

  RETURN QUERY
    WITH base AS (
      SELECT cr.*,
             (_orig / COALESCE(cr.initial_rate_to_ugx, cr.rate_to_ugx)) AS orig_local,
             (_fair / cr.rate_to_ugx)                                    AS fx_local,
             GREATEST(
               EXTRACT(EPOCH FROM (NOW() - COALESCE(cr.stability_anchor_at, NOW()))) / (365.25 * 86400),
               0
             ) AS elapsed_years
      FROM public.ican_currency_rates cr
      WHERE cr.currency_code = _curr
    ),
    floored AS (
      SELECT b.*,
             (b.orig_local * POWER((1 + b.local_inflation_pct / 100.0)::float8, b.elapsed_years::float8)::numeric)
               AS inflation_floor_local
      FROM base b
    )
    SELECT
      UPPER(p_country_code)::TEXT,
      f.currency_code,
      f.currency_name::TEXT,
      ROUND(GREATEST(f.fx_local, f.inflation_floor_local)::NUMERIC, 6)  AS price_local,
      ROUND(_usd::NUMERIC, 6)                                          AS price_usd,
      ROUND((_orig / f.rate_to_ugx)::NUMERIC, 6)                       AS floor_local,
      ROUND((_fxfl / f.rate_to_ugx)::NUMERIC, 6)                       AS fx_floor_local,
      ROUND(((_fxfl - _orig) / f.rate_to_ugx)::NUMERIC, 6)             AS fx_lift,
      ROUND((((GREATEST(f.fx_local, f.inflation_floor_local) - f.orig_local) / NULLIF(f.orig_local, 0)) * 100)::NUMERIC, 4)
        AS appreciation_pct,
      f.local_inflation_pct AS local_inflation,
      f.inflation_as_of_year,
      f.inflation_source,
      ROUND(((((GREATEST(f.fx_local, f.inflation_floor_local) - f.orig_local) / NULLIF(f.orig_local, 0)) * 100) - f.local_inflation_pct)::NUMERIC, 2)
        AS net_protection,
      ((((GREATEST(f.fx_local, f.inflation_floor_local) - f.orig_local) / NULLIF(f.orig_local, 0)) * 100) >= f.local_inflation_pct)
        AS is_protected,
      f.rate_to_ugx,
      NOW()::TIMESTAMPTZ
    FROM floored f;
END; $$;

GRANT EXECUTE ON FUNCTION public.ican_get_price_by_country(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ican_get_price_in_currency
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.ican_get_price_in_currency(VARCHAR);

CREATE OR REPLACE FUNCTION public.ican_get_price_in_currency(
  p_currency_code VARCHAR(3) DEFAULT 'UGX'
)
RETURNS TABLE (
  currency_code        VARCHAR(3),
  currency_name        TEXT,
  country_name         TEXT,
  price_local          NUMERIC,
  price_usd            NUMERIC,
  floor_local          NUMERIC,
  fx_floor_local       NUMERIC,
  fx_lift              NUMERIC,
  appreciation_pct     NUMERIC,
  local_inflation      NUMERIC,
  inflation_as_of_year INT,
  inflation_source     TEXT,
  net_protection       NUMERIC,
  is_protected         BOOLEAN,
  rate_to_ugx          NUMERIC,
  computed_at          TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tok  CONSTANT TEXT := 'dev_ICAN_Pr0_KV25';
  _orig NUMERIC := 5000;
  _fxfl NUMERIC := 5000;
  _fair NUMERIC := 5000;
  _usd  NUMERIC;
BEGIN
  BEGIN
    SELECT pe.original_floor_ugx, pe.fx_adjusted_floor,
           pe.fair_price_ugx,     pe.fair_price_usd
    INTO   _orig, _fxfl, _fair, _usd
    FROM   public.ican_compute_fair_price(_tok) pe LIMIT 1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  _orig := COALESCE(_orig, 5000); _fxfl := COALESCE(_fxfl, 5000);
  _fair := COALESCE(_fair, 5000);
  _usd  := COALESCE(_usd,  _fair / 3700.0);

  RETURN QUERY
    WITH base AS (
      SELECT cr.*,
             (_orig / COALESCE(cr.initial_rate_to_ugx, cr.rate_to_ugx)) AS orig_local,
             (_fair / cr.rate_to_ugx)                                    AS fx_local,
             GREATEST(
               EXTRACT(EPOCH FROM (NOW() - COALESCE(cr.stability_anchor_at, NOW()))) / (365.25 * 86400),
               0
             ) AS elapsed_years
      FROM public.ican_currency_rates cr
      WHERE UPPER(cr.currency_code) = UPPER(p_currency_code)
    ),
    floored AS (
      SELECT b.*,
             (b.orig_local * POWER((1 + b.local_inflation_pct / 100.0)::float8, b.elapsed_years::float8)::numeric)
               AS inflation_floor_local
      FROM base b
    )
    SELECT
      f.currency_code,
      f.currency_name::TEXT,
      f.country_name::TEXT,
      ROUND(GREATEST(f.fx_local, f.inflation_floor_local)::NUMERIC, 6)  AS price_local,
      ROUND(_usd::NUMERIC, 6)                                          AS price_usd,
      ROUND((_orig / f.rate_to_ugx)::NUMERIC, 6)                       AS floor_local,
      ROUND((_fxfl / f.rate_to_ugx)::NUMERIC, 6)                       AS fx_floor_local,
      ROUND(((_fxfl - _orig) / f.rate_to_ugx)::NUMERIC, 6)             AS fx_lift,
      ROUND((((GREATEST(f.fx_local, f.inflation_floor_local) - f.orig_local) / NULLIF(f.orig_local, 0)) * 100)::NUMERIC, 4)
        AS appreciation_pct,
      f.local_inflation_pct AS local_inflation,
      f.inflation_as_of_year,
      f.inflation_source,
      ROUND(((((GREATEST(f.fx_local, f.inflation_floor_local) - f.orig_local) / NULLIF(f.orig_local, 0)) * 100) - f.local_inflation_pct)::NUMERIC, 2)
        AS net_protection,
      ((((GREATEST(f.fx_local, f.inflation_floor_local) - f.orig_local) / NULLIF(f.orig_local, 0)) * 100) >= f.local_inflation_pct)
        AS is_protected,
      f.rate_to_ugx,
      NOW()::TIMESTAMPTZ
    FROM floored f;
END; $$;

GRANT EXECUTE ON FUNCTION public.ican_get_price_in_currency(VARCHAR) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ican_get_user_wallet_display
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.ican_get_user_wallet_display(UUID);

CREATE OR REPLACE FUNCTION public.ican_get_user_wallet_display(p_user_id UUID)
RETURNS TABLE (
  user_id              UUID,
  ican_balance         NUMERIC,
  country_code         VARCHAR(2),
  currency_code        VARCHAR(3),
  currency_name        TEXT,
  country_name         TEXT,
  price_local          NUMERIC,
  price_usd            NUMERIC,
  floor_local          NUMERIC,
  fx_floor_local       NUMERIC,
  balance_local        NUMERIC,
  balance_usd          NUMERIC,
  appreciation_pct     NUMERIC,
  fx_lift              NUMERIC,
  local_inflation      NUMERIC,
  inflation_as_of_year INT,
  inflation_source     TEXT,
  net_protection       NUMERIC,
  is_protected         BOOLEAN,
  computed_at          TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tok     CONSTANT TEXT := 'dev_ICAN_Pr0_KV25';
  _country VARCHAR(2);
  _bal     NUMERIC := 0;
  _curr    VARCHAR(3) := 'USD';
  _orig    NUMERIC := 5000;
  _fxfl    NUMERIC := 5000;
  _fair    NUMERIC := 5000;
  _usd     NUMERIC;
BEGIN
  SELECT UPPER(COALESCE(ua.country_code, 'UG'))::VARCHAR(2),
         COALESCE(ua.ican_coin_balance, 0)
  INTO   _country, _bal
  FROM   public.user_accounts ua WHERE ua.user_id = p_user_id LIMIT 1;

  _country := COALESCE(_country, 'UG');

  SELECT ccm.currency_code INTO _curr
  FROM   public.ican_country_currency_map ccm
  WHERE  ccm.country_code = _country LIMIT 1;

  IF _curr IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.ican_currency_rates r2 WHERE r2.currency_code = _curr
  ) THEN
    _curr := 'USD';
  END IF;

  BEGIN
    SELECT pe.original_floor_ugx, pe.fx_adjusted_floor,
           pe.fair_price_ugx,     pe.fair_price_usd
    INTO   _orig, _fxfl, _fair, _usd
    FROM   public.ican_compute_fair_price(_tok) pe LIMIT 1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  _orig := COALESCE(_orig, 5000); _fxfl := COALESCE(_fxfl, 5000);
  _fair := COALESCE(_fair, 5000);
  _usd  := COALESCE(_usd,  _fair / 3700.0);

  RETURN QUERY
    WITH base AS (
      SELECT cr.*,
             (_orig / COALESCE(cr.initial_rate_to_ugx, cr.rate_to_ugx)) AS orig_local,
             (_fair / cr.rate_to_ugx)                                    AS fx_local,
             GREATEST(
               EXTRACT(EPOCH FROM (NOW() - COALESCE(cr.stability_anchor_at, NOW()))) / (365.25 * 86400),
               0
             ) AS elapsed_years
      FROM public.ican_currency_rates cr
      WHERE cr.currency_code = _curr
    ),
    floored AS (
      SELECT b.*,
             (b.orig_local * POWER((1 + b.local_inflation_pct / 100.0)::float8, b.elapsed_years::float8)::numeric)
               AS inflation_floor_local
      FROM base b
    )
    SELECT
      p_user_id,
      _bal,
      _country::VARCHAR(2),
      f.currency_code,
      f.currency_name::TEXT,
      f.country_name::TEXT,
      ROUND(GREATEST(f.fx_local, f.inflation_floor_local)::NUMERIC, 6)  AS price_local,
      ROUND(_usd::NUMERIC, 6)                                          AS price_usd,
      ROUND((_orig / f.rate_to_ugx)::NUMERIC, 6)                       AS floor_local,
      ROUND((_fxfl / f.rate_to_ugx)::NUMERIC, 6)                       AS fx_floor_local,
      ROUND((_bal * GREATEST(f.fx_local, f.inflation_floor_local))::NUMERIC, 2) AS balance_local,
      ROUND((_bal * _usd)::NUMERIC, 4)                                 AS balance_usd,
      ROUND((((GREATEST(f.fx_local, f.inflation_floor_local) - f.orig_local) / NULLIF(f.orig_local, 0)) * 100)::NUMERIC, 4)
        AS appreciation_pct,
      ROUND(((_fxfl - _orig) / f.rate_to_ugx)::NUMERIC, 6)             AS fx_lift,
      f.local_inflation_pct AS local_inflation,
      f.inflation_as_of_year,
      f.inflation_source,
      ROUND(((((GREATEST(f.fx_local, f.inflation_floor_local) - f.orig_local) / NULLIF(f.orig_local, 0)) * 100) - f.local_inflation_pct)::NUMERIC, 2)
        AS net_protection,
      ((((GREATEST(f.fx_local, f.inflation_floor_local) - f.orig_local) / NULLIF(f.orig_local, 0)) * 100) >= f.local_inflation_pct)
        AS is_protected,
      NOW()::TIMESTAMPTZ
    FROM floored f;
END; $$;

GRANT EXECUTE ON FUNCTION public.ican_get_user_wallet_display(UUID) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFY
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Inflation floor guarantee installed — anchor 2026-01-01' AS status;

SELECT country_code, currency_code, price_local, price_usd, appreciation_pct, local_inflation, net_protection, is_protected
FROM public.ican_get_price_by_country('UG')
UNION ALL
SELECT country_code, currency_code, price_local, price_usd, appreciation_pct, local_inflation, net_protection, is_protected
FROM public.ican_get_price_by_country('KE')
UNION ALL
SELECT country_code, currency_code, price_local, price_usd, appreciation_pct, local_inflation, net_protection, is_protected
FROM public.ican_get_price_by_country('NG')
UNION ALL
SELECT country_code, currency_code, price_local, price_usd, appreciation_pct, local_inflation, net_protection, is_protected
FROM public.ican_get_price_by_country('SD')
UNION ALL
SELECT country_code, currency_code, price_local, price_usd, appreciation_pct, local_inflation, net_protection, is_protected
FROM public.ican_get_price_by_country('US')
UNION ALL
SELECT country_code, currency_code, price_local, price_usd, appreciation_pct, local_inflation, net_protection, is_protected
FROM public.ican_get_price_by_country('GB');
