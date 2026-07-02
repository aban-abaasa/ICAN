-- ============================================================================
-- LIVE WORLD BANK INFLATION — run once in Supabase SQL Editor
--
-- local_inflation_pct in ican_currency_rates was a one-time hardcoded guess.
-- This adds freshness tracking (which year the figure actually reports, and
-- where it came from) and updates the 3 price RPCs to return it, so the
-- frontend can show "as of 2025" instead of implying a live tick.
--
-- The actual numbers get refreshed by backend/services/inflationRefreshService.js
-- (World Bank API, indicator FP.CPI.TOTL.ZG) — run once manually via
-- backend/refresh_global_inflation.js, then kept fresh by a daily cron job
-- inside backend/server.js.
-- ============================================================================

ALTER TABLE public.ican_currency_rates
  ADD COLUMN IF NOT EXISTS inflation_as_of_year INT,
  ADD COLUMN IF NOT EXISTS inflation_source TEXT DEFAULT 'seed';


-- ─────────────────────────────────────────────────────────────────────────────
-- ican_get_price_by_country — add inflation_as_of_year + inflation_source
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.ican_get_price_by_country(TEXT);

CREATE OR REPLACE FUNCTION public.ican_get_price_by_country(
  p_country_code TEXT DEFAULT 'UG'
)
RETURNS TABLE (
  country_code         TEXT,
  currency_code        VARCHAR(3),
  currency_name        TEXT,
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
  _tok  CONSTANT TEXT    := 'dev_ICAN_Pr0_KV25';
  _curr VARCHAR(3)       := 'USD';
  _orig NUMERIC          := 5000;
  _fxfl NUMERIC          := 5000;
  _fair NUMERIC          := 5000;
  _usd  NUMERIC;
  _app  NUMERIC          := 0;
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
           pe.fair_price_ugx,     pe.fair_price_usd, pe.appreciation_pct
    INTO   _orig, _fxfl, _fair, _usd, _app
    FROM   public.ican_compute_fair_price(_tok) pe LIMIT 1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  _orig := COALESCE(_orig, 5000); _fxfl := COALESCE(_fxfl, 5000);
  _fair := COALESCE(_fair, 5000); _app  := COALESCE(_app,     0);
  _usd  := COALESCE(_usd,  _fair / 3700.0);

  RETURN QUERY
    SELECT
      UPPER(p_country_code)::TEXT,
      cr.currency_code,
      cr.currency_name::TEXT,
      ROUND((_fair / cr.rate_to_ugx)::NUMERIC, 6)             AS price_local,
      ROUND(_usd::NUMERIC, 6)                                   AS price_usd,
      ROUND((_orig / cr.rate_to_ugx)::NUMERIC, 6)             AS floor_local,
      ROUND((_fxfl / cr.rate_to_ugx)::NUMERIC, 6)             AS fx_floor_local,
      ROUND(((_fxfl - _orig) / cr.rate_to_ugx)::NUMERIC, 6)   AS fx_lift,
      _app                                                       AS appreciation_pct,
      cr.local_inflation_pct                                     AS local_inflation,
      cr.inflation_as_of_year,
      cr.inflation_source,
      ROUND((_app - cr.local_inflation_pct)::NUMERIC, 2)       AS net_protection,
      (_app > cr.local_inflation_pct)                           AS is_protected,
      cr.rate_to_ugx,
      NOW()::TIMESTAMPTZ
    FROM public.ican_currency_rates cr
    WHERE cr.currency_code = _curr;
END; $$;

GRANT EXECUTE ON FUNCTION public.ican_get_price_by_country(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- ican_get_price_in_currency — add inflation_as_of_year + inflation_source
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
  _app  NUMERIC := 0;
BEGIN
  BEGIN
    SELECT pe.original_floor_ugx, pe.fx_adjusted_floor,
           pe.fair_price_ugx,     pe.fair_price_usd, pe.appreciation_pct
    INTO   _orig, _fxfl, _fair, _usd, _app
    FROM   public.ican_compute_fair_price(_tok) pe LIMIT 1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  _orig := COALESCE(_orig, 5000); _fxfl := COALESCE(_fxfl, 5000);
  _fair := COALESCE(_fair, 5000); _app  := COALESCE(_app,     0);
  _usd  := COALESCE(_usd,  _fair / 3700.0);

  RETURN QUERY
    SELECT
      cr.currency_code,
      cr.currency_name::TEXT,
      cr.country_name::TEXT,
      ROUND((_fair / cr.rate_to_ugx)::NUMERIC, 6)             AS price_local,
      ROUND(_usd::NUMERIC, 6)                                   AS price_usd,
      ROUND((_orig / cr.rate_to_ugx)::NUMERIC, 6)             AS floor_local,
      ROUND((_fxfl / cr.rate_to_ugx)::NUMERIC, 6)             AS fx_floor_local,
      ROUND(((_fxfl - _orig) / cr.rate_to_ugx)::NUMERIC, 6)   AS fx_lift,
      _app                                                       AS appreciation_pct,
      cr.local_inflation_pct                                     AS local_inflation,
      cr.inflation_as_of_year,
      cr.inflation_source,
      ROUND((_app - cr.local_inflation_pct)::NUMERIC, 2)       AS net_protection,
      (_app > cr.local_inflation_pct)                           AS is_protected,
      cr.rate_to_ugx,
      NOW()::TIMESTAMPTZ
    FROM public.ican_currency_rates cr
    WHERE UPPER(cr.currency_code) = UPPER(p_currency_code);
END; $$;

GRANT EXECUTE ON FUNCTION public.ican_get_price_in_currency(VARCHAR) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- ican_get_user_wallet_display — add inflation_as_of_year + inflation_source
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
  _app     NUMERIC := 0;
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
           pe.fair_price_ugx,     pe.fair_price_usd, pe.appreciation_pct
    INTO   _orig, _fxfl, _fair, _usd, _app
    FROM   public.ican_compute_fair_price(_tok) pe LIMIT 1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  _orig := COALESCE(_orig, 5000); _fxfl := COALESCE(_fxfl, 5000);
  _fair := COALESCE(_fair, 5000); _app  := COALESCE(_app,     0);
  _usd  := COALESCE(_usd,  _fair / 3700.0);

  RETURN QUERY
    SELECT
      p_user_id,
      _bal,
      _country::VARCHAR(2),
      cr.currency_code,
      cr.currency_name::TEXT,
      cr.country_name::TEXT,
      ROUND((_fair / cr.rate_to_ugx)::NUMERIC,       6) AS price_local,
      ROUND(_usd::NUMERIC,                             6) AS price_usd,
      ROUND((_orig / cr.rate_to_ugx)::NUMERIC,        6) AS floor_local,
      ROUND((_fxfl / cr.rate_to_ugx)::NUMERIC,        6) AS fx_floor_local,
      ROUND((_bal * _fair / cr.rate_to_ugx)::NUMERIC, 2) AS balance_local,
      ROUND((_bal * _usd)::NUMERIC,                    4) AS balance_usd,
      _app                                                  AS appreciation_pct,
      ROUND(((_fxfl - _orig) / cr.rate_to_ugx)::NUMERIC, 6) AS fx_lift,
      cr.local_inflation_pct                                AS local_inflation,
      cr.inflation_as_of_year,
      cr.inflation_source,
      ROUND((_app - cr.local_inflation_pct)::NUMERIC, 2)   AS net_protection,
      (_app > cr.local_inflation_pct)                       AS is_protected,
      NOW()::TIMESTAMPTZ
    FROM public.ican_currency_rates cr
    WHERE cr.currency_code = _curr;
END; $$;

GRANT EXECUTE ON FUNCTION public.ican_get_user_wallet_display(UUID) TO anon, authenticated;


SELECT 'Live inflation tracking installed — run backend/refresh_global_inflation.js next' AS status;
