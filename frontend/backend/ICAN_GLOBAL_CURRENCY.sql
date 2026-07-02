-- ============================================================================
-- icaneracoin GLOBAL CURRENCY STABILITY SYSTEM
-- Run AFTER ICAN_PRICE_ENGINE.sql
--
-- Model:
--   ICAN's value is anchored in USD (5,000 UGX / launch-rate = $X.XX USD).
--   That USD value never changes. rate_to_ugx is the LIVE rate — update it
--   when markets move. initial_rate_to_ugx is the LAUNCH rate — never touch it.
--   When UGX depreciates vs USD (rate_to_ugx rises), ICAN's UGX price auto-
--   rises to maintain the same USD purchasing power for every holder worldwide.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Currency reference rates table
-- rate_to_ugx         = LIVE rate: how many UGX per 1 unit of this currency
-- initial_rate_to_ugx = LAUNCH rate (never updated — anchors USD value)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ican_currency_rates (
  id                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  currency_code        VARCHAR(3)  NOT NULL UNIQUE,
  currency_name        TEXT        NOT NULL,
  country_name         TEXT        NOT NULL,
  country_code         VARCHAR(2)  NOT NULL,
  region               TEXT        NOT NULL DEFAULT 'World',
  rate_to_ugx          NUMERIC     NOT NULL CHECK (rate_to_ugx > 0),
  initial_rate_to_ugx  NUMERIC,    -- set on first insert, never changed
  local_inflation_pct  NUMERIC     NOT NULL DEFAULT 5.0,
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Add column if table already exists from a previous run
ALTER TABLE public.ican_currency_rates
  ADD COLUMN IF NOT EXISTS initial_rate_to_ugx NUMERIC;

ALTER TABLE public.ican_currency_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ican_currency_public_read" ON public.ican_currency_rates;
CREATE POLICY "ican_currency_public_read"
  ON public.ican_currency_rates FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "ican_currency_dev_write" ON public.ican_currency_rates;
CREATE POLICY "ican_currency_dev_write"
  ON public.ican_currency_rates FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON public.ican_currency_rates TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed reference rates (approximate mid-2025 rates; update anytime via table)
-- Format: (code, name, country, iso2, region, UGX_per_1_unit, inflation_%)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.ican_currency_rates
  (currency_code, currency_name, country_name, country_code, region, rate_to_ugx, local_inflation_pct)
VALUES
  -- Africa (home continent)
  ('UGX', 'Ugandan Shilling',     'Uganda',           'UG', 'Africa',          1.00,    7.5),
  ('KES', 'Kenyan Shilling',      'Kenya',            'KE', 'Africa',         28.50,    7.2),
  ('TZS', 'Tanzanian Shilling',   'Tanzania',         'TZ', 'Africa',          1.43,    6.1),
  ('RWF', 'Rwandan Franc',        'Rwanda',           'RW', 'Africa',          2.60,    7.3),
  ('NGN', 'Nigerian Naira',       'Nigeria',          'NG', 'Africa',          2.40,   33.0),
  ('GHS', 'Ghanaian Cedi',        'Ghana',            'GH', 'Africa',        230.00,   22.0),
  ('ETB', 'Ethiopian Birr',       'Ethiopia',         'ET', 'Africa',         70.00,   28.0),
  ('ZAR', 'South African Rand',   'South Africa',     'ZA', 'Africa',        195.00,    5.5),
  ('EGP', 'Egyptian Pound',       'Egypt',            'EG', 'Africa',        117.00,   33.0),
  ('MAD', 'Moroccan Dirham',      'Morocco',          'MA', 'Africa',        370.00,    2.8),
  ('XOF', 'CFA Franc BCEAO',      'West Africa',      'SN', 'Africa',          6.10,    3.5),
  ('XAF', 'CFA Franc BEAC',       'Central Africa',   'CM', 'Africa',          6.10,    3.5),
  -- Americas
  ('USD', 'US Dollar',            'United States',    'US', 'Americas',     3700.00,    3.2),
  ('CAD', 'Canadian Dollar',      'Canada',           'CA', 'Americas',     2700.00,    2.9),
  ('BRL', 'Brazilian Real',       'Brazil',           'BR', 'Americas',      670.00,    4.8),
  ('MXN', 'Mexican Peso',         'Mexico',           'MX', 'Americas',      210.00,    4.7),
  -- Europe
  ('EUR', 'Euro',                 'European Union',   'EU', 'Europe',       4050.00,    2.9),
  ('GBP', 'British Pound',        'United Kingdom',   'GB', 'Europe',       4720.00,    4.0),
  ('CHF', 'Swiss Franc',          'Switzerland',      'CH', 'Europe',       4200.00,    1.5),
  ('SEK', 'Swedish Krona',        'Sweden',           'SE', 'Europe',        345.00,    3.4),
  ('NOK', 'Norwegian Krone',      'Norway',           'NO', 'Europe',        336.00,    3.7),
  -- Middle East
  ('AED', 'UAE Dirham',           'United Arab Emirates','AE','Middle East',1007.00,    1.5),
  ('SAR', 'Saudi Riyal',          'Saudi Arabia',     'SA', 'Middle East',   987.00,    1.9),
  -- Asia
  ('INR', 'Indian Rupee',         'India',            'IN', 'Asia',          44.00,    5.2),
  ('CNY', 'Chinese Yuan',         'China',            'CN', 'Asia',         510.00,    0.3),
  ('JPY', 'Japanese Yen',         'Japan',            'JP', 'Asia',          24.50,    2.8),
  ('KRW', 'South Korean Won',     'South Korea',      'KR', 'Asia',           2.75,    2.5),
  ('IDR', 'Indonesian Rupiah',    'Indonesia',        'ID', 'Asia',           0.23,    3.0),
  ('PHP', 'Philippine Peso',      'Philippines',      'PH', 'Asia',          64.00,    3.3),
  ('PKR', 'Pakistani Rupee',      'Pakistan',         'PK', 'Asia',          13.00,   26.0),
  -- Oceania
  ('AUD', 'Australian Dollar',    'Australia',        'AU', 'Oceania',      2380.00,    3.6),
  ('NZD', 'New Zealand Dollar',   'New Zealand',      'NZ', 'Oceania',      2200.00,    3.7)
ON CONFLICT (currency_code) DO UPDATE SET
  rate_to_ugx         = EXCLUDED.rate_to_ugx,   -- live rate — update when markets move
  local_inflation_pct = EXCLUDED.local_inflation_pct,
  updated_at          = NOW()
  -- initial_rate_to_ugx is NOT updated here — it stays fixed as the launch anchor

-- Seed initial_rate_to_ugx on first run (copy from rate_to_ugx where still null)
;
UPDATE public.ican_currency_rates
SET initial_rate_to_ugx = rate_to_ugx
WHERE initial_rate_to_ugx IS NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- GLOBAL PRICES function — returns ICAN price in every currency + protection
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
  -- Prices in local currency (derived from USD-anchored fair price in UGX)
  original_floor_local NUMERIC,   -- 5,000 UGX in local currency (launch value)
  fx_floor_local       NUMERIC,   -- FX-adjusted UGX floor in local currency
  fair_price_local     NUMERIC,   -- full fair price in local currency
  -- Protection metrics
  local_inflation      NUMERIC,
  ican_appreciation    NUMERIC,   -- % above original 5000 UGX floor
  net_protection       NUMERIC,   -- ican_appreciation - local_inflation
  is_protected         BOOLEAN
)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  v_orig_floor NUMERIC := 5000;
  v_fx_floor   NUMERIC := 5000;
  v_fair_ugx   NUMERIC := 5000;
  v_app_pct    NUMERIC := 0;
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;

  BEGIN
    SELECT pe.original_floor_ugx, pe.fx_adjusted_floor,
           pe.fair_price_ugx,     pe.appreciation_pct
    INTO   v_orig_floor, v_fx_floor, v_fair_ugx, v_app_pct
    FROM   public.ican_compute_fair_price(dev_token) pe LIMIT 1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  v_orig_floor := COALESCE(v_orig_floor, 5000);
  v_fx_floor   := COALESCE(v_fx_floor,   5000);
  v_fair_ugx   := COALESCE(v_fair_ugx,   5000);
  v_app_pct    := COALESCE(v_app_pct,       0);

  RETURN QUERY
    SELECT
      cr.currency_code,
      cr.currency_name::TEXT,
      cr.country_name::TEXT,
      cr.country_code::VARCHAR(2),
      cr.region::TEXT,
      cr.rate_to_ugx,
      -- Each price divided by UGX-per-local-unit = price in local currency
      ROUND((v_orig_floor / cr.rate_to_ugx)::NUMERIC, 4) AS original_floor_local,
      ROUND((v_fx_floor   / cr.rate_to_ugx)::NUMERIC, 4) AS fx_floor_local,
      ROUND((v_fair_ugx   / cr.rate_to_ugx)::NUMERIC, 4) AS fair_price_local,
      cr.local_inflation_pct                              AS local_inflation,
      v_app_pct                                           AS ican_appreciation,
      ROUND((v_app_pct - cr.local_inflation_pct)::NUMERIC, 2) AS net_protection,
      (v_app_pct > cr.local_inflation_pct)                AS is_protected
    FROM public.ican_currency_rates cr
    ORDER BY cr.region, cr.country_name;
END; $$;

GRANT EXECUTE ON FUNCTION public.ican_dev_get_global_prices(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- UPDATE RATES — lets dev panel update a specific currency rate
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.ican_dev_update_rate(TEXT, VARCHAR, NUMERIC);

CREATE OR REPLACE FUNCTION public.ican_dev_update_rate(
  dev_token     TEXT,
  p_currency    VARCHAR(3),
  p_rate_to_ugx NUMERIC
)
RETURNS VOID
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF dev_token != 'dev_ICAN_Pr0_KV25' THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_rate_to_ugx <= 0 THEN RAISE EXCEPTION 'rate must be positive'; END IF;
  UPDATE public.ican_currency_rates
  SET rate_to_ugx = p_rate_to_ugx, updated_at = NOW()
  WHERE currency_code = UPPER(p_currency);
END; $$;

GRANT EXECUTE ON FUNCTION public.ican_dev_update_rate(TEXT, VARCHAR, NUMERIC) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFY
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'icaneracoin Global Currency System installed' AS status,
       COUNT(*) AS currencies_seeded
FROM public.ican_currency_rates;

SELECT currency_code, country_name, rate_to_ugx,
       ROUND(5000 / rate_to_ugx, 4) AS ican_floor_in_local_currency
FROM public.ican_currency_rates
ORDER BY region, country_name;
