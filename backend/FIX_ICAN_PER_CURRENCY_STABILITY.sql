-- ============================================================================
-- FIX — per-currency stability metric (run once in Supabase SQL Editor)
--
-- BUG: ican_dev_get_global_prices, ican_get_price_by_country,
-- ican_get_price_in_currency and ican_get_user_wallet_display all computed
-- "appreciation_pct" ONCE from ican_compute_fair_price() — a UGX-only number
-- driven by UGX/USD movement + the global usage premium — then reused that
-- SAME number for every currency's net_protection (= appreciation - local
-- inflation). Every currency was being judged against Uganda's FX movement,
-- not its own. That's why net_protection tracked almost exactly with each
-- country's raw World Bank inflation figure regardless of that currency's
-- own behavior vs USD (confirmed against real ican_get_price_by_country
-- output: UG -0.22, KE -0.71, NG -19.65, US +0.41, IN +0.96, GB -0.52 — back-
-- solving shows a single ~3% global constant minus each country's own
-- inflation, nothing currency-specific).
--
-- FIX: compute each currency's OWN appreciation as
--   (price_local_now / price_local_at_launch - 1) * 100
-- using initial_rate_to_ugx (frozen at launch) vs rate_to_ugx (meant to be
-- live) — columns that already exist for exactly this purpose but weren't
-- being used this way. net_protection/is_protected now compare a currency
-- against ITS OWN launch-to-now move, not Uganda's.
--
-- NOTE: this fix alone won't change today's numbers, because rate_to_ugx is
-- still frozen at its seed value for every currency (a separate bug — see
-- FIX_ICAN_LIVE_FX_REFRESH.sql). Once rate_to_ugx is kept live per currency,
-- this formula is what makes net_protection actually reflect that currency's
-- real depreciation instead of Uganda's.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ican_dev_get_global_prices — dev panel's Global Currency Dashboard
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
  fair_price_local     NUMERIC,
  local_inflation      NUMERIC,
  ican_appreciation    NUMERIC,   -- now: THIS currency's own move since launch
  net_protection       NUMERIC,   -- ican_appreciation - local_inflation
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
             (v_fair_ugx   / cr.rate_to_ugx)                                    AS fair_local
      FROM public.ican_currency_rates cr
    )
    SELECT
      b.currency_code,
      b.currency_name::TEXT,
      b.country_name::TEXT,
      b.country_code::VARCHAR(2),
      b.region::TEXT,
      b.rate_to_ugx,
      ROUND((v_orig_floor / b.rate_to_ugx)::NUMERIC, 4) AS original_floor_local,
      ROUND((v_fx_floor   / b.rate_to_ugx)::NUMERIC, 4) AS fx_floor_local,
      ROUND(b.fair_local::NUMERIC, 4)                    AS fair_price_local,
      b.local_inflation_pct                              AS local_inflation,
      ROUND((((b.fair_local - b.orig_local) / NULLIF(b.orig_local, 0)) * 100)::NUMERIC, 4)
                                                          AS ican_appreciation,
      ROUND(((((b.fair_local - b.orig_local) / NULLIF(b.orig_local, 0)) * 100) - b.local_inflation_pct)::NUMERIC, 2)
                                                          AS net_protection,
      ((((b.fair_local - b.orig_local) / NULLIF(b.orig_local, 0)) * 100) > b.local_inflation_pct)
                                                          AS is_protected
    FROM base b
    ORDER BY b.region, b.country_name;
END; $$;

GRANT EXECUTE ON FUNCTION public.ican_dev_get_global_prices(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ican_get_price_by_country — public, keyed by sign-up country_code
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
  appreciation_pct     NUMERIC,   -- now: THIS currency's own move since launch
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
             (_fair / cr.rate_to_ugx)                                    AS fair_local
      FROM public.ican_currency_rates cr
      WHERE cr.currency_code = _curr
    )
    SELECT
      UPPER(p_country_code)::TEXT,
      b.currency_code,
      b.currency_name::TEXT,
      ROUND(b.fair_local::NUMERIC, 6)                     AS price_local,
      ROUND(_usd::NUMERIC, 6)                             AS price_usd,
      ROUND((_orig / b.rate_to_ugx)::NUMERIC, 6)          AS floor_local,
      ROUND((_fxfl / b.rate_to_ugx)::NUMERIC, 6)          AS fx_floor_local,
      ROUND(((_fxfl - _orig) / b.rate_to_ugx)::NUMERIC, 6) AS fx_lift,
      ROUND((((b.fair_local - b.orig_local) / NULLIF(b.orig_local, 0)) * 100)::NUMERIC, 4)
                                                            AS appreciation_pct,
      b.local_inflation_pct                                AS local_inflation,
      b.inflation_as_of_year,
      b.inflation_source,
      ROUND(((((b.fair_local - b.orig_local) / NULLIF(b.orig_local, 0)) * 100) - b.local_inflation_pct)::NUMERIC, 2)
                                                            AS net_protection,
      ((((b.fair_local - b.orig_local) / NULLIF(b.orig_local, 0)) * 100) > b.local_inflation_pct)
                                                            AS is_protected,
      b.rate_to_ugx,
      NOW()::TIMESTAMPTZ
    FROM base b;
END; $$;

GRANT EXECUTE ON FUNCTION public.ican_get_price_by_country(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ican_get_price_in_currency — public, keyed by currency_code
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
  appreciation_pct     NUMERIC,   -- now: THIS currency's own move since launch
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
             (_fair / cr.rate_to_ugx)                                    AS fair_local
      FROM public.ican_currency_rates cr
      WHERE UPPER(cr.currency_code) = UPPER(p_currency_code)
    )
    SELECT
      b.currency_code,
      b.currency_name::TEXT,
      b.country_name::TEXT,
      ROUND(b.fair_local::NUMERIC, 6)                     AS price_local,
      ROUND(_usd::NUMERIC, 6)                             AS price_usd,
      ROUND((_orig / b.rate_to_ugx)::NUMERIC, 6)          AS floor_local,
      ROUND((_fxfl / b.rate_to_ugx)::NUMERIC, 6)          AS fx_floor_local,
      ROUND(((_fxfl - _orig) / b.rate_to_ugx)::NUMERIC, 6) AS fx_lift,
      ROUND((((b.fair_local - b.orig_local) / NULLIF(b.orig_local, 0)) * 100)::NUMERIC, 4)
                                                            AS appreciation_pct,
      b.local_inflation_pct                                AS local_inflation,
      b.inflation_as_of_year,
      b.inflation_source,
      ROUND(((((b.fair_local - b.orig_local) / NULLIF(b.orig_local, 0)) * 100) - b.local_inflation_pct)::NUMERIC, 2)
                                                            AS net_protection,
      ((((b.fair_local - b.orig_local) / NULLIF(b.orig_local, 0)) * 100) > b.local_inflation_pct)
                                                            AS is_protected,
      b.rate_to_ugx,
      NOW()::TIMESTAMPTZ
    FROM base b;
END; $$;

GRANT EXECUTE ON FUNCTION public.ican_get_price_in_currency(VARCHAR) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ican_get_user_wallet_display — public, keyed by user_id
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
  appreciation_pct     NUMERIC,   -- now: THIS currency's own move since launch
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
             (_fair / cr.rate_to_ugx)                                    AS fair_local
      FROM public.ican_currency_rates cr
      WHERE cr.currency_code = _curr
    )
    SELECT
      p_user_id,
      _bal,
      _country::VARCHAR(2),
      b.currency_code,
      b.currency_name::TEXT,
      b.country_name::TEXT,
      ROUND(b.fair_local::NUMERIC, 6)                     AS price_local,
      ROUND(_usd::NUMERIC, 6)                             AS price_usd,
      ROUND((_orig / b.rate_to_ugx)::NUMERIC, 6)          AS floor_local,
      ROUND((_fxfl / b.rate_to_ugx)::NUMERIC, 6)          AS fx_floor_local,
      ROUND((_bal * b.fair_local)::NUMERIC, 2)            AS balance_local,
      ROUND((_bal * _usd)::NUMERIC, 4)                    AS balance_usd,
      ROUND((((b.fair_local - b.orig_local) / NULLIF(b.orig_local, 0)) * 100)::NUMERIC, 4)
                                                            AS appreciation_pct,
      ROUND(((_fxfl - _orig) / b.rate_to_ugx)::NUMERIC, 6) AS fx_lift,
      b.local_inflation_pct                                AS local_inflation,
      b.inflation_as_of_year,
      b.inflation_source,
      ROUND(((((b.fair_local - b.orig_local) / NULLIF(b.orig_local, 0)) * 100) - b.local_inflation_pct)::NUMERIC, 2)
                                                            AS net_protection,
      ((((b.fair_local - b.orig_local) / NULLIF(b.orig_local, 0)) * 100) > b.local_inflation_pct)
                                                            AS is_protected,
      NOW()::TIMESTAMPTZ
    FROM base b;
END; $$;

GRANT EXECUTE ON FUNCTION public.ican_get_user_wallet_display(UUID) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFY — same six-country spot check as before; appreciation_pct now
-- varies per currency (still ~flat today since rate_to_ugx hasn't moved
-- since seed — that's the separate live-refresh fix)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Per-currency stability metric fixed' AS status;

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
FROM public.ican_get_price_by_country('US')
UNION ALL
SELECT country_code, currency_code, price_local, price_usd, appreciation_pct, local_inflation, net_protection, is_protected
FROM public.ican_get_price_by_country('IN')
UNION ALL
SELECT country_code, currency_code, price_local, price_usd, appreciation_pct, local_inflation, net_protection, is_protected
FROM public.ican_get_price_by_country('GB');
