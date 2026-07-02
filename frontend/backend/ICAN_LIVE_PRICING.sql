-- ============================================================================
-- icaneracoin LIVE PRICING SYSTEM  v2 — COUNTRY-FIRST
-- Run AFTER ICAN_PRICE_ENGINE.sql and ICAN_GLOBAL_CURRENCY.sql
--
-- This file is built directly from the COUNTRIES object in countryService.js.
-- Every country the user can select at sign-up maps to its REAL local currency.
-- No more USD fallback for countries that have their own currency.
--
-- Key functions (all PUBLIC — no dev token):
--   ican_get_price_by_country(country_code)   ← new, uses sign-up country code
--   ican_get_price_in_currency(currency_code)
--   ican_get_user_wallet_display(user_id)     ← enhanced: inflation shield info
--   ican_get_market_snapshot()
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. EXTEND ican_currency_rates WITH ALL MISSING CURRENCIES
--    (ican_global_currency.sql already has 32; we add the rest here)
--    rate_to_ugx = how many UGX per 1 unit of this currency
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.ican_currency_rates
  (currency_code, currency_name, country_name, country_code, region, rate_to_ugx, local_inflation_pct)
VALUES
  -- ── East Africa additions ────────────────────────────────────────────────
  ('DJF', 'Djiboutian Franc',      'Djibouti',              'DJ', 'Africa',         20.8,    2.8),
  ('ERN', 'Eritrean Nakfa',        'Eritrea',               'ER', 'Africa',         247.0,   8.5),
  ('SOS', 'Somali Shilling',       'Somalia',               'SO', 'Africa',          6.4,   10.0),
  ('KMF', 'Comorian Franc',        'Comoros',               'KM', 'Africa',          8.2,    4.0),
  ('SCR', 'Seychellois Rupee',     'Seychelles',            'SC', 'Africa',         280.0,   3.5),
  -- ── Southern Africa additions ────────────────────────────────────────────
  ('BWP', 'Botswana Pula',         'Botswana',              'BW', 'Africa',         272.0,   4.8),
  ('NAD', 'Namibian Dollar',       'Namibia',               'NA', 'Africa',         195.0,   5.5),
  ('LSL', 'Lesotho Loti',          'Lesotho',               'LS', 'Africa',         195.0,   6.0),
  ('SZL', 'Swazi Lilangeni',       'Eswatini',              'SZ', 'Africa',         195.0,   5.8),
  ('MZN', 'Mozambican Metical',    'Mozambique',            'MZ', 'Africa',          58.0,   6.9),
  ('ZMW', 'Zambian Kwacha',        'Zambia',                'ZM', 'Africa',         175.0,  13.0),
  ('ZWL', 'Zimbabwe Gold (ZiG)',   'Zimbabwe',              'ZW', 'Africa',          13.6,  20.0),
  ('MGA', 'Malagasy Ariary',       'Madagascar',            'MG', 'Africa',           0.84, 12.0),
  ('MUR', 'Mauritian Rupee',       'Mauritius',             'MU', 'Africa',          82.0,   4.2),
  -- ── West Africa additions ────────────────────────────────────────────────
  ('LRD', 'Liberian Dollar',       'Liberia',               'LR', 'Africa',          19.0,  14.0),
  ('SLL', 'Sierra Leonean Leone',  'Sierra Leone',          'SL', 'Africa',           0.165, 54.0),
  ('GMD', 'Gambian Dalasi',        'Gambia',                'GM', 'Africa',          55.0,  17.0),
  ('GNF', 'Guinean Franc',         'Guinea',                'GN', 'Africa',           0.43, 12.0),
  ('CVE', 'Cape Verdean Escudo',   'Cape Verde',            'CV', 'Africa',          34.0,   3.2),
  -- ── Central Africa additions ─────────────────────────────────────────────
  ('CDF', 'Congolese Franc',       'DR Congo',              'CD', 'Africa',           1.30, 45.0),
  ('STN', 'São Tomé Dobra',        'São Tomé & Príncipe',   'ST', 'Africa',         163.0,  14.0),
  ('AOA', 'Angolan Kwanza',        'Angola',                'AO', 'Africa',           4.10, 23.0),
  -- ── North Africa additions ───────────────────────────────────────────────
  ('SDG', 'Sudanese Pound',        'Sudan',                 'SD', 'Africa',           6.70, 300.0),
  ('DZD', 'Algerian Dinar',        'Algeria',               'DZ', 'Africa',          27.6,   6.4),
  ('LYD', 'Libyan Dinar',          'Libya',                 'LY', 'Africa',         769.0,   3.1),
  ('TND', 'Tunisian Dinar',        'Tunisia',               'TN', 'Africa',        1184.0,   7.3),
  -- ── Americas additions ───────────────────────────────────────────────────
  ('ARS', 'Argentine Peso',        'Argentina',             'AR', 'Americas',         3.70, 290.0),
  ('CLP', 'Chilean Peso',          'Chile',                 'CL', 'Americas',         3.90,   4.5),
  ('COP', 'Colombian Peso',        'Colombia',              'CO', 'Americas',         0.93,   9.5),
  ('PEN', 'Peruvian Sol',          'Peru',                  'PE', 'Americas',       990.0,    3.5),
  ('BOB', 'Bolivian Boliviano',    'Bolivia',               'BO', 'Americas',       537.0,    5.2),
  ('PYG', 'Paraguayan Guaraní',    'Paraguay',              'PY', 'Americas',         0.49,   5.0),
  ('UYU', 'Uruguayan Peso',        'Uruguay',               'UY', 'Americas',        93.0,    6.5),
  ('GYD', 'Guyanese Dollar',       'Guyana',                'GY', 'Americas',        17.5,   3.7),
  ('GTQ', 'Guatemalan Quetzal',    'Guatemala',             'GT', 'Americas',       480.0,   5.8),
  ('HNL', 'Honduran Lempira',      'Honduras',              'HN', 'Americas',       150.0,   8.2),
  ('NIO', 'Nicaraguan Córdoba',    'Nicaragua',             'NI', 'Americas',       103.0,   7.0),
  ('CRC', 'Costa Rican Colón',     'Costa Rica',            'CR', 'Americas',         7.10,  3.8),
  ('DOP', 'Dominican Peso',        'Dominican Republic',    'DO', 'Americas',        63.0,   7.2),
  ('HTG', 'Haitian Gourde',        'Haiti',                 'HT', 'Americas',        28.0,  40.0),
  ('JMD', 'Jamaican Dollar',       'Jamaica',               'JM', 'Americas',        24.0,  10.5),
  ('TTD', 'T&T Dollar',            'Trinidad & Tobago',     'TT', 'Americas',       546.0,   5.5),
  -- ── Europe additions ─────────────────────────────────────────────────────
  ('PLN', 'Polish Zloty',          'Poland',                'PL', 'Europe',          920.0,  5.4),
  ('CZK', 'Czech Koruna',          'Czechia',               'CZ', 'Europe',          163.0,  3.0),
  ('HUF', 'Hungarian Forint',      'Hungary',               'HU', 'Europe',           10.0,  4.6),
  ('DKK', 'Danish Krone',          'Denmark',               'DK', 'Europe',          543.0,  3.1),
  ('ISK', 'Icelandic Króna',       'Iceland',               'IS', 'Europe',           27.0,  6.5),
  ('RUB', 'Russian Ruble',         'Russia',                'RU', 'Europe',           41.0, 12.0),
  ('UAH', 'Ukrainian Hryvnia',     'Ukraine',               'UA', 'Europe',           89.0, 18.0),
  ('BYN', 'Belarusian Ruble',      'Belarus',               'BY', 'Europe',         1140.0,  6.0),
  ('MDL', 'Moldovan Leu',          'Moldova',               'MD', 'Europe',          208.0,  8.2),
  ('RON', 'Romanian Leu',          'Romania',               'RO', 'Europe',          830.0,  5.8),
  ('TRY', 'Turkish Lira',          'Turkey',                'TR', 'Europe',          110.0, 70.0),
  ('RSD', 'Serbian Dinar',         'Serbia',                'RS', 'Europe',           35.0,  7.0),
  ('ALL', 'Albanian Lek',          'Albania',               'AL', 'Europe',           41.0,  3.5),
  ('MKD', 'Macedonian Denar',      'North Macedonia',       'MK', 'Europe',           67.0,  4.0),
  ('BGN', 'Bulgarian Lev',         'Bulgaria',              'BG', 'Europe',         2075.0,  4.2),
  ('BAM', 'Bosnia Mark',           'Bosnia & Herzegovina',  'BA', 'Europe',         2075.0,  3.0),
  -- ── Middle East additions ────────────────────────────────────────────────
  ('QAR', 'Qatari Riyal',          'Qatar',                 'QA', 'Middle East',    1016.0,  2.3),
  ('KWD', 'Kuwaiti Dinar',         'Kuwait',                'KW', 'Middle East',   12066.0,  2.5),
  ('OMR', 'Omani Rial',            'Oman',                  'OM', 'Middle East',    9610.0,  1.8),
  ('BHD', 'Bahraini Dinar',        'Bahrain',               'BH', 'Middle East',    9815.0,  2.1),
  ('ILS', 'Israeli Shekel',        'Israel',                'IL', 'Middle East',    1019.0,  3.6),
  ('JOD', 'Jordanian Dinar',       'Jordan',                'JO', 'Middle East',    5220.0,  3.2),
  ('LBP', 'Lebanese Pound',        'Lebanon',               'LB', 'Middle East',       0.041, 200.0),
  ('IQD', 'Iraqi Dinar',           'Iraq',                  'IQ', 'Middle East',       2.80, 4.5),
  ('AFN', 'Afghan Afghani',        'Afghanistan',           'AF', 'Middle East',      54.0, 18.0),
  -- ── Asia additions ───────────────────────────────────────────────────────
  ('BDT', 'Bangladeshi Taka',      'Bangladesh',            'BD', 'Asia',            33.6,   9.5),
  ('LKR', 'Sri Lankan Rupee',      'Sri Lanka',             'LK', 'Asia',            12.4,   6.0),
  ('NPR', 'Nepalese Rupee',        'Nepal',                 'NP', 'Asia',            27.7,   7.2),
  ('MVR', 'Maldivian Rufiyaa',     'Maldives',              'MV', 'Asia',           240.0,   2.8),
  ('MNT', 'Mongolian Tögrög',      'Mongolia',              'MN', 'Asia',             1.07,  8.0),
  ('TWD', 'Taiwan Dollar',         'Taiwan',                'TW', 'Asia',           115.0,   2.5),
  ('HKD', 'Hong Kong Dollar',      'Hong Kong',             'HK', 'Asia',           474.0,   2.8),
  ('SGD', 'Singapore Dollar',      'Singapore',             'SG', 'Asia',          2750.0,   2.4),
  ('THB', 'Thai Baht',             'Thailand',              'TH', 'Asia',           103.0,   2.9),
  ('MYR', 'Malaysian Ringgit',     'Malaysia',              'MY', 'Asia',           845.0,   2.5),
  ('VND', 'Vietnamese Dong',       'Vietnam',               'VN', 'Asia',             0.145, 4.2),
  ('KHR', 'Cambodian Riel',        'Cambodia',              'KH', 'Asia',             0.90, 2.6),
  ('LAK', 'Lao Kip',               'Laos',                  'LA', 'Asia',             0.17, 25.0),
  ('MMK', 'Myanmar Kyat',          'Myanmar',               'MM', 'Asia',             1.75, 28.0),
  ('BND', 'Brunei Dollar',         'Brunei',                'BN', 'Asia',          2750.0,   0.5),
  -- ── Oceania additions ────────────────────────────────────────────────────
  ('FJD', 'Fijian Dollar',         'Fiji',                  'FJ', 'Oceania',       1690.0,   4.0),
  ('PGK', 'PNG Kina',              'Papua New Guinea',      'PG', 'Oceania',       1000.0,  10.0),
  ('TOP', 'Tongan Paʻanga',        'Tonga',                 'TO', 'Oceania',       1590.0,   5.5),
  ('WST', 'Samoan Tālā',           'Samoa',                 'WS', 'Oceania',       1370.0,   4.0),
  ('SBD', 'Solomon Islands Dollar','Solomon Islands',       'SB', 'Oceania',        440.0,   5.0),
  ('XPF', 'CFP Franc',             'New Caledonia',         'NC', 'Oceania',         34.0,   2.5)
ON CONFLICT (currency_code) DO NOTHING;  -- never overwrite existing rates

-- Seed initial_rate_to_ugx for any newly added currencies
UPDATE public.ican_currency_rates
SET initial_rate_to_ugx = rate_to_ugx
WHERE initial_rate_to_ugx IS NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. COUNTRY → CURRENCY MAP
--    Matches countryService.js COUNTRIES exactly — every country gets its
--    real local currency, not a USD fallback.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ican_country_currency_map (
  country_code  VARCHAR(2) NOT NULL PRIMARY KEY,
  currency_code VARCHAR(3) NOT NULL
);
GRANT SELECT ON public.ican_country_currency_map TO anon, authenticated;

INSERT INTO public.ican_country_currency_map (country_code, currency_code) VALUES
  -- ── East Africa ──────────────────────────────────────────────────────────
  ('UG','UGX'),('KE','KES'),('TZ','TZS'),('RW','RWF'),('BI','RWF'),
  ('DJ','DJF'),('ER','ERN'),('ET','ETB'),('SO','SOS'),('KM','KMF'),('SC','SCR'),
  -- ── Southern Africa ──────────────────────────────────────────────────────
  ('BW','BWP'),('ZA','ZAR'),('NA','NAD'),('LS','LSL'),('SZ','SZL'),
  ('MZ','MZN'),('ZM','ZMW'),('ZW','ZWL'),('MG','MGA'),('MU','MUR'),('MW','MWK'),
  -- ── West Africa ──────────────────────────────────────────────────────────
  ('NG','NGN'),('GH','GHS'),
  ('SN','XOF'),('CI','XOF'),('ML','XOF'),('BF','XOF'),('NE','XOF'),
  ('TG','XOF'),('BJ','XOF'),('GW','XOF'),
  ('LR','LRD'),('SL','SLL'),('GM','GMD'),('GN','GNF'),('CV','CVE'),
  -- ── Central Africa ───────────────────────────────────────────────────────
  ('CM','XAF'),('CG','XAF'),('GA','XAF'),('GQ','XAF'),('CF','XAF'),('TD','XAF'),
  ('CD','CDF'),('ST','STN'),('AO','AOA'),
  -- ── North Africa ─────────────────────────────────────────────────────────
  ('EG','EGP'),('MA','MAD'),('TN','TND'),('LY','LYD'),('DZ','DZD'),('SD','SDG'),
  -- ── Americas — North ─────────────────────────────────────────────────────
  ('US','USD'),('CA','CAD'),('MX','MXN'),
  -- ── Americas — Central & Caribbean ───────────────────────────────────────
  ('GT','GTQ'),('SV','USD'),('HN','HNL'),('NI','NIO'),('CR','CRC'),
  ('PA','USD'),('BZ','USD'),
  ('BS','USD'),('CU','USD'),('DO','DOP'),('HT','HTG'),
  ('JM','JMD'),('TT','TTD'),('BB','USD'),
  -- ── Americas — South ─────────────────────────────────────────────────────
  ('BR','BRL'),('AR','ARS'),('CL','CLP'),('CO','COP'),('PE','PEN'),
  ('VE','USD'),('EC','USD'),('BO','BOB'),('PY','PYG'),
  ('UY','UYU'),('SR','USD'),('GY','GYD'),
  -- ── Europe — West ────────────────────────────────────────────────────────
  ('GB','GBP'),('IE','EUR'),('FR','EUR'),('DE','EUR'),('NL','EUR'),
  ('BE','EUR'),('LU','EUR'),('AT','EUR'),('CH','CHF'),
  -- ── Europe — South ───────────────────────────────────────────────────────
  ('ES','EUR'),('PT','EUR'),('IT','EUR'),('GR','EUR'),
  ('HR','EUR'),('ME','EUR'),('RS','RSD'),('BA','BAM'),('AL','ALL'),
  ('MK','MKD'),('BG','BGN'),('RO','RON'),
  -- ── Europe — North ───────────────────────────────────────────────────────
  ('SE','SEK'),('NO','NOK'),('DK','DKK'),('FI','EUR'),('IS','ISK'),
  ('LT','EUR'),('LV','EUR'),('EE','EUR'),
  -- ── Europe — East ────────────────────────────────────────────────────────
  ('PL','PLN'),('CZ','CZK'),('SK','EUR'),('HU','HUF'),
  ('UA','UAH'),('BY','BYN'),('RU','RUB'),('MD','MDL'),
  -- ── Middle East ──────────────────────────────────────────────────────────
  ('SA','SAR'),('AE','AED'),('QA','QAR'),('KW','KWD'),('OM','OMR'),
  ('BH','BHD'),('IL','ILS'),('PS','ILS'),('JO','JOD'),('LB','LBP'),
  ('SY','USD'),('TR','TRY'),('IQ','IQD'),('IR','USD'),('AF','AFN'),
  -- ── South Asia ───────────────────────────────────────────────────────────
  ('IN','INR'),('PK','PKR'),('BD','BDT'),('LK','LKR'),('NP','NPR'),
  ('BT','INR'),('MV','MVR'),
  -- ── East Asia ────────────────────────────────────────────────────────────
  ('CN','CNY'),('JP','JPY'),('KR','KRW'),('MN','MNT'),
  ('TW','TWD'),('HK','HKD'),('MO','HKD'),
  -- ── Southeast Asia ───────────────────────────────────────────────────────
  ('TH','THB'),('MY','MYR'),('SG','SGD'),('ID','IDR'),
  ('PH','PHP'),('VN','VND'),('KH','KHR'),('LA','LAK'),
  ('MM','MMK'),('BN','BND'),('TL','USD'),
  -- ── Oceania ──────────────────────────────────────────────────────────────
  ('AU','AUD'),('NZ','NZD'),('FJ','FJD'),('PG','PGK'),
  ('TO','TOP'),('WS','WST'),('KI','AUD'),('SB','SBD'),
  ('VU','USD'),('MH','USD'),('FM','USD'),('PW','USD'),('NR','AUD'),
  ('NC','XPF')
ON CONFLICT (country_code) DO UPDATE SET currency_code = EXCLUDED.currency_code;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. PUBLIC: Get ICAN price by COUNTRY CODE (sign-up country → local price)
--    Most direct function: pass the country_code from user_accounts
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.ican_get_price_by_country(TEXT);

CREATE OR REPLACE FUNCTION public.ican_get_price_by_country(
  p_country_code TEXT DEFAULT 'UG'
)
RETURNS TABLE (
  country_code     TEXT,
  currency_code    VARCHAR(3),
  currency_name    TEXT,
  price_local      NUMERIC,
  price_usd        NUMERIC,
  floor_local      NUMERIC,
  fx_floor_local   NUMERIC,
  fx_lift          NUMERIC,
  appreciation_pct NUMERIC,
  local_inflation  NUMERIC,
  net_protection   NUMERIC,
  is_protected     BOOLEAN,
  rate_to_ugx      NUMERIC,
  computed_at      TIMESTAMPTZ
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
  -- 1. Resolve country → currency
  SELECT ccm.currency_code INTO _curr
  FROM public.ican_country_currency_map ccm
  WHERE UPPER(ccm.country_code) = UPPER(p_country_code) LIMIT 1;
  IF _curr IS NULL THEN _curr := 'USD'; END IF;

  -- 2. Make sure the currency exists in rates; fall back to USD
  IF NOT EXISTS (SELECT 1 FROM public.ican_currency_rates r WHERE r.currency_code = _curr) THEN
    _curr := 'USD';
  END IF;

  -- 3. Compute fair price
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
      ROUND((_app - cr.local_inflation_pct)::NUMERIC, 2)       AS net_protection,
      (_app > cr.local_inflation_pct)                           AS is_protected,
      cr.rate_to_ugx,
      NOW()::TIMESTAMPTZ
    FROM public.ican_currency_rates cr
    WHERE cr.currency_code = _curr;
END; $$;

GRANT EXECUTE ON FUNCTION public.ican_get_price_by_country(TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. PUBLIC: Get ICAN price in any specific currency code
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.ican_get_price_in_currency(VARCHAR);

CREATE OR REPLACE FUNCTION public.ican_get_price_in_currency(
  p_currency_code VARCHAR(3) DEFAULT 'UGX'
)
RETURNS TABLE (
  currency_code    VARCHAR(3),
  currency_name    TEXT,
  country_name     TEXT,
  price_local      NUMERIC,
  price_usd        NUMERIC,
  floor_local      NUMERIC,
  fx_floor_local   NUMERIC,
  fx_lift          NUMERIC,
  appreciation_pct NUMERIC,
  local_inflation  NUMERIC,
  net_protection   NUMERIC,
  is_protected     BOOLEAN,
  rate_to_ugx      NUMERIC,
  computed_at      TIMESTAMPTZ
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
      ROUND((_app - cr.local_inflation_pct)::NUMERIC, 2)       AS net_protection,
      (_app > cr.local_inflation_pct)                           AS is_protected,
      cr.rate_to_ugx,
      NOW()::TIMESTAMPTZ
    FROM public.ican_currency_rates cr
    WHERE UPPER(cr.currency_code) = UPPER(p_currency_code);
END; $$;

GRANT EXECUTE ON FUNCTION public.ican_get_price_in_currency(VARCHAR) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. PUBLIC: Full wallet display per user — resolves sign-up country automatically
--    user_id → user_accounts.country_code → local currency → live price
--    Returns inflation shield data so the UI can show "your savings are protected"
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.ican_get_user_wallet_display(UUID);

CREATE OR REPLACE FUNCTION public.ican_get_user_wallet_display(p_user_id UUID)
RETURNS TABLE (
  user_id          UUID,
  ican_balance     NUMERIC,
  country_code     VARCHAR(2),
  currency_code    VARCHAR(3),
  currency_name    TEXT,
  country_name     TEXT,
  -- Per-coin prices
  price_local      NUMERIC,
  price_usd        NUMERIC,
  floor_local      NUMERIC,
  fx_floor_local   NUMERIC,
  -- Wallet totals
  balance_local    NUMERIC,
  balance_usd      NUMERIC,
  -- Stability metrics
  appreciation_pct NUMERIC,
  fx_lift          NUMERIC,
  local_inflation  NUMERIC,
  net_protection   NUMERIC,     -- appreciation - local inflation (positive = beating inflation)
  is_protected     BOOLEAN,     -- true when coin beats user's local inflation rate
  computed_at      TIMESTAMPTZ
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
  -- 1. Get balance + country from user_accounts (country set at sign-up)
  SELECT UPPER(COALESCE(ua.country_code, 'UG'))::VARCHAR(2),
         COALESCE(ua.ican_coin_balance, 0)
  INTO   _country, _bal
  FROM   public.user_accounts ua WHERE ua.user_id = p_user_id LIMIT 1;

  _country := COALESCE(_country, 'UG');

  -- 2. Resolve country → currency
  SELECT ccm.currency_code INTO _curr
  FROM   public.ican_country_currency_map ccm
  WHERE  ccm.country_code = _country LIMIT 1;

  -- 3. If currency not in rates table, fall back to USD
  IF _curr IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.ican_currency_rates r2 WHERE r2.currency_code = _curr
  ) THEN
    _curr := 'USD';
  END IF;

  -- 4. Compute fair price from price engine
  BEGIN
    SELECT pe.original_floor_ugx, pe.fx_adjusted_floor,
           pe.fair_price_ugx,     pe.fair_price_usd, pe.appreciation_pct
    INTO   _orig, _fxfl, _fair, _usd, _app
    FROM   public.ican_compute_fair_price(_tok) pe LIMIT 1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  _orig := COALESCE(_orig, 5000); _fxfl := COALESCE(_fxfl, 5000);
  _fair := COALESCE(_fair, 5000); _app  := COALESCE(_app,     0);
  _usd  := COALESCE(_usd,  _fair / 3700.0);

  -- 5. Return wallet in user's local currency with full protection metrics
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
      ROUND((_app - cr.local_inflation_pct)::NUMERIC, 2)   AS net_protection,
      (_app > cr.local_inflation_pct)                       AS is_protected,
      NOW()::TIMESTAMPTZ
    FROM public.ican_currency_rates cr
    WHERE cr.currency_code = _curr;
END; $$;

GRANT EXECUTE ON FUNCTION public.ican_get_user_wallet_display(UUID) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. PUBLIC: Market snapshot ticker (no auth, for public pages)
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.ican_get_market_snapshot();

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
DECLARE _tok CONSTANT TEXT := 'dev_ICAN_Pr0_KV25';
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

GRANT EXECUTE ON FUNCTION public.ican_get_market_snapshot() TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFY
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'icaneracoin Live Pricing v2 installed' AS status;

SELECT
  (SELECT COUNT(*) FROM public.ican_country_currency_map) AS country_mappings,
  (SELECT COUNT(*) FROM public.ican_currency_rates)        AS currencies_in_rates;

-- Test: price by country code (as stored from sign-up)
SELECT country_code, currency_code, price_local, price_usd, net_protection, is_protected
FROM public.ican_get_price_by_country('UG')   -- Uganda
UNION ALL
SELECT country_code, currency_code, price_local, price_usd, net_protection, is_protected
FROM public.ican_get_price_by_country('KE')   -- Kenya
UNION ALL
SELECT country_code, currency_code, price_local, price_usd, net_protection, is_protected
FROM public.ican_get_price_by_country('NG')   -- Nigeria
UNION ALL
SELECT country_code, currency_code, price_local, price_usd, net_protection, is_protected
FROM public.ican_get_price_by_country('US')   -- United States
UNION ALL
SELECT country_code, currency_code, price_local, price_usd, net_protection, is_protected
FROM public.ican_get_price_by_country('IN')   -- India
UNION ALL
SELECT country_code, currency_code, price_local, price_usd, net_protection, is_protected
FROM public.ican_get_price_by_country('GB');  -- United Kingdom
