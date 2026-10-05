-- ============================================================================
-- ERA API v1: the endpoint handlers and their registry rows. Needs 20261005100000_era_api.sql first.
--
-- Rules every handler follows (they are the privacy promise of this API):
--   * read-only, and only fields that are already public in the apps, or aggregates
--   * never anything about a person's money, wallet, messages, contact details or identity documents
--   * `p_sandbox = TRUE` returns fixture data and never touches a real table
--   * bad input raises SQLSTATE 22023 (-> HTTP 400), a missing thing raises P0002 (-> 404); other errors are logged
--     privately and the caller only sees a generic 500
--
-- Each endpoint can be switched off on its own in the developer panel's API tab (the kill switch).
-- Re-running this file refreshes the descriptions but keeps whatever an administrator toggled.
-- ============================================================================

DO $$ BEGIN
  IF to_regclass('public.era_api_endpoints') IS NULL THEN
    RAISE EXCEPTION 'Apply supabase/migrations/20261005100000_era_api.sql first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------- parameter helpers
CREATE OR REPLACE FUNCTION public.era_p_text(p JSONB, k TEXT, p_max INTEGER DEFAULT 80) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT NULLIF(left(btrim(p ->> k), p_max), '') $$;

CREATE OR REPLACE FUNCTION public.era_p_int(p JSONB, k TEXT, p_default INTEGER, p_min INTEGER, p_max INTEGER)
RETURNS INTEGER LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v TEXT := NULLIF(btrim(p ->> k), '');
BEGIN
  IF v IS NULL THEN RETURN p_default; END IF;
  IF v !~ '^-?[0-9]{1,9}$' THEN
    RAISE EXCEPTION '% must be a whole number', k USING ERRCODE = '22023';
  END IF;
  RETURN LEAST(GREATEST(v::INTEGER, p_min), p_max);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_p_num(p JSONB, k TEXT, p_min NUMERIC, p_max NUMERIC, p_required BOOLEAN DEFAULT FALSE)
RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v TEXT := NULLIF(btrim(p ->> k), '');
BEGIN
  IF v IS NULL THEN
    IF p_required THEN RAISE EXCEPTION '% is required', k USING ERRCODE = '22023'; END IF;
    RETURN NULL;
  END IF;
  IF v !~ '^-?[0-9]{1,9}(\.[0-9]{1,6})?$' THEN
    RAISE EXCEPTION '% must be a number', k USING ERRCODE = '22023';
  END IF;
  IF v::NUMERIC < p_min OR v::NUMERIC > p_max THEN
    RAISE EXCEPTION '% must be between % and %', k, p_min, p_max USING ERRCODE = '22023';
  END IF;
  RETURN v::NUMERIC;
END;
$$;

-- a LIKE pattern from user text: wildcards neutralised
CREATE OR REPLACE FUNCTION public.era_p_like(p_text TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT '%' || replace(replace(replace(p_text, '\', '\\'), '%', '\%'), '_', '\_') || '%' $$;

-- ============================================================================ PLATFORM

-- Who am I, and how much is left?
CREATE OR REPLACE FUNCTION public.era_h_platform_whoami(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.era_api_clients;
  v_key UUID := NULLIF(p ->> '_key_id', '')::UUID;
  v_used INTEGER;
BEGIN
  SELECT * INTO c FROM public.era_api_clients WHERE id = (p ->> '_client_id')::UUID;
  SELECT COALESCE(SUM(calls), 0) INTO v_used FROM public.era_api_usage
   WHERE key_id = v_key AND period = 'd' AND bucket = public.era__bucket(86400);
  RETURN jsonb_build_object(
    'app_name', c.app_name,
    'mode', p ->> '_mode',
    'status', c.status,
    'apps', p -> '_apps',
    'limits', jsonb_build_object('per_minute', (p ->> '_rate')::INTEGER, 'per_day', (p ->> '_quota')::INTEGER),
    'used_today', v_used,
    'hint', CASE WHEN p ->> '_mode' = 'sandbox'
                 THEN 'Sandbox key: responses are realistic fixtures. Ask for live access at /developers.'
                 ELSE 'Live key: responses are real.' END);
END;
$$;

-- One call that sees the whole family (only the apps your key is approved for).
CREATE OR REPLACE FUNCTION public.era_h_platform_pulse(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_apps JSONB := COALESCE(p -> '_apps', '[]'::JSONB);
  v_out JSONB := '{}'::JSONB;
  c RECORD;
BEGIN
  IF v_apps ? 'icanera' THEN
    IF p_sandbox THEN
      v_out := v_out || jsonb_build_object('icanera', jsonb_build_object('ican_usd', 1.3815, 'ican_ugx', 5508.42, 'change_24h_pct', 0.15));
    ELSE
      SELECT price_usd, price_ugx, percentage_change_24h INTO c
        FROM public.ican_coin_market_prices ORDER BY timestamp DESC LIMIT 1;
      v_out := v_out || jsonb_build_object('icanera', jsonb_build_object(
        'ican_usd', c.price_usd, 'ican_ugx', c.price_ugx, 'change_24h_pct', c.percentage_change_24h));
    END IF;
  END IF;
  IF v_apps ? 'bodagoera' THEN
    IF p_sandbox THEN
      v_out := v_out || jsonb_build_object('bodagoera', jsonb_build_object('districts', 4, 'stages', 37));
    ELSE
      v_out := v_out || jsonb_build_object('bodagoera', jsonb_build_object(
        'districts', (SELECT COUNT(*) FROM public.mbg_districts WHERE is_active),
        'stages', (SELECT COUNT(*) FROM public.mbg_stages WHERE is_active)));
    END IF;
  END IF;
  IF v_apps ? 'supermarketera' THEN
    IF p_sandbox THEN
      v_out := v_out || jsonb_build_object('supermarketera', jsonb_build_object('stores', 7, 'catalog_items', 638));
    ELSE
      v_out := v_out || jsonb_build_object('supermarketera', jsonb_build_object(
        'stores', (SELECT COUNT(*) FROM public.supermarkets
                    WHERE is_active IS NOT FALSE AND COALESCE(status, 'active') NOT IN ('suspended', 'rejected', 'pending')),
        'catalog_items', (SELECT COUNT(*) FROM public.supplier_catalog_items WHERE is_available)));
    END IF;
  END IF;
  IF v_apps ? 'farmagentera' THEN
    IF p_sandbox THEN
      v_out := v_out || jsonb_build_object('farmagentera', jsonb_build_object('active_listings', 21, 'produce_listings', 14));
    ELSE
      v_out := v_out || jsonb_build_object('farmagentera', jsonb_build_object(
        'active_listings', (SELECT COUNT(*) FROM public.marketplace_listings
                             WHERE status = 'active' AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)),
        'produce_listings', (SELECT COUNT(*) FROM public.marketplace_listings
                              WHERE status = 'active' AND type = 'produce' AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE))));
    END IF;
  END IF;
  RETURN v_out || jsonb_build_object('as_of', now());
END;
$$;

-- ============================================================================ ICANERA

-- Price of 1 ICAN in a currency. USD, UGX, EUR, GBP and JPY are stored; every other currency is derived from the UGX
-- price and the stored FX table (UGX per unit of that currency), so any of ~170 currencies works.
CREATE OR REPLACE FUNCTION public.era_h_icanera_coin_price(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cur TEXT := upper(COALESCE(public.era_p_text(p, 'currency', 12), 'USD'));
  c RECORD; v_rate NUMERIC; v_price NUMERIC; v_src TEXT := 'stored';
  v_fx JSONB := '{"USD":3987.0,"EUR":4485.0,"GBP":5275.0,"KES":30.8,"UGX":1,"NGN":2.6,"ZAR":218.0,"JPY":25.3}';
BEGIN
  IF v_cur !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'currency must be a 3-letter code such as USD or UGX' USING ERRCODE = '22023'; END IF;

  IF p_sandbox THEN
    IF NOT (v_fx ? v_cur) THEN RAISE EXCEPTION 'No ICAN price for %. Sandbox knows USD, EUR, GBP, KES, UGX, NGN, ZAR, JPY.', v_cur USING ERRCODE = 'P0002'; END IF;
    RETURN jsonb_build_object('asset', 'ICAN', 'currency', v_cur, 'price', round(5508.42 / (v_fx ->> v_cur)::NUMERIC, 6),
      'change_24h_pct', 0.15, 'change_7d_pct', 0, 'updated_at', now(), 'source', 'sandbox-fixture');
  END IF;

  SELECT price_usd, price_ugx, price_eur, price_gbp, price_jpy, percentage_change_24h AS ch24, percentage_change_7d AS ch7, last_updated INTO c
    FROM public.ican_coin_market_prices ORDER BY timestamp DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'The ICAN price is not available right now.' USING ERRCODE = 'P0002'; END IF;

  v_price := CASE v_cur WHEN 'USD' THEN c.price_usd WHEN 'UGX' THEN c.price_ugx WHEN 'EUR' THEN c.price_eur
                        WHEN 'GBP' THEN c.price_gbp WHEN 'JPY' THEN c.price_jpy END;
  IF v_price IS NULL THEN
    SELECT rate_to_ugx INTO v_rate FROM public.ican_currency_rates WHERE currency_code = v_cur AND rate_to_ugx > 0 LIMIT 1;
    IF v_rate IS NULL THEN RAISE EXCEPTION 'No ICAN price for currency %.', v_cur USING ERRCODE = 'P0002'; END IF;
    v_price := c.price_ugx / v_rate; v_src := 'derived-from-fx';
  END IF;
  RETURN jsonb_build_object('asset', 'ICAN', 'currency', v_cur, 'price', round(v_price, 6),
    'change_24h_pct', c.ch24, 'change_7d_pct', c.ch7, 'updated_at', c.last_updated, 'source', v_src);
END;
$$;

-- OHLC candles in UGX, re-binned from the stored 5-minute candles.
CREATE OR REPLACE FUNCTION public.era_h_icanera_coin_candles(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tf TEXT := COALESCE(public.era_p_text(p, 'interval', 12), '1h');
  v_limit INTEGER := public.era_p_int(p, 'limit', 48, 1, 288);
  v_bin INTERVAL;
BEGIN
  v_bin := CASE v_tf WHEN '5m' THEN '5 minutes' WHEN '15m' THEN '15 minutes' WHEN '1h' THEN '1 hour'
                     WHEN '4h' THEN '4 hours' WHEN '1d' THEN '1 day' END;
  IF v_bin IS NULL THEN RAISE EXCEPTION 'interval must be one of 5m, 15m, 1h, 4h, 1d' USING ERRCODE = '22023'; END IF;

  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(row ORDER BY (row ->> 'open_time')) FROM (
      SELECT jsonb_build_object('open_time', t, 'open', round((5500 + 20 * sin(n / 3.0))::NUMERIC, 2),
               'high', round((5500 + 20 * sin(n / 3.0) + 6)::NUMERIC, 2), 'low', round((5500 + 20 * sin(n / 3.0) - 6)::NUMERIC, 2),
               'close', round((5500 + 20 * sin((n + 1) / 3.0))::NUMERIC, 2), 'volume', 100 + n * 7) AS row
        FROM (SELECT g AS n, date_trunc('hour', now()) - (g * v_bin) AS t FROM generate_series(0, v_limit - 1) g) s) x), '[]'::JSONB);
  END IF;

  RETURN COALESCE((SELECT jsonb_agg(row ORDER BY (row ->> 'open_time')) FROM (
    SELECT jsonb_build_object('open_time', b.bin, 'open', b.o, 'high', b.h, 'low', b.l, 'close', b.c, 'volume', b.v) AS row
      FROM (SELECT date_bin(v_bin, open_time, TIMESTAMPTZ '2000-01-01') AS bin,
                   (array_agg(open_price ORDER BY open_time ASC))[1]   AS o,
                   MAX(high_price) AS h, MIN(low_price) AS l,
                   (array_agg(close_price ORDER BY open_time DESC))[1] AS c,
                   SUM(trading_volume) AS v
              FROM public.ican_price_ohlc WHERE timeframe = '5m'
             GROUP BY 1 ORDER BY 1 DESC LIMIT v_limit) b) x), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_icanera_fx_rates(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cur TEXT := upper(public.era_p_text(p, 'currency', 12));
  v_country TEXT := upper(public.era_p_text(p, 'country', 12));
  v_region TEXT := public.era_p_text(p, 'region', 40);
  v_limit INTEGER := public.era_p_int(p, 'limit', 50, 1, 250);
  v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 100000);
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"currency_code":"USD","currency_name":"US Dollar","country_code":"US","region":"Americas","rate_to_ugx":3987.0,"local_inflation_pct":3.1},
        {"currency_code":"EUR","currency_name":"Euro","country_code":"DE","region":"Europe","rate_to_ugx":4485.0,"local_inflation_pct":2.4},
        {"currency_code":"GBP","currency_name":"Pound Sterling","country_code":"GB","region":"Europe","rate_to_ugx":5275.0,"local_inflation_pct":3.4},
        {"currency_code":"KES","currency_name":"Kenyan Shilling","country_code":"KE","region":"Africa","rate_to_ugx":30.8,"local_inflation_pct":5.1},
        {"currency_code":"NGN","currency_name":"Nigerian Naira","country_code":"NG","region":"Africa","rate_to_ugx":2.6,"local_inflation_pct":22.0},
        {"currency_code":"ZAR","currency_name":"South African Rand","country_code":"ZA","region":"Africa","rate_to_ugx":218.0,"local_inflation_pct":4.6}]'::JSONB)
        AS t(currency_code TEXT, currency_name TEXT, country_code TEXT, region TEXT, rate_to_ugx NUMERIC, local_inflation_pct NUMERIC)
       WHERE (v_cur IS NULL OR currency_code = v_cur) AND (v_country IS NULL OR country_code = v_country)
         AND (v_region IS NULL OR region ILIKE v_region)) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT currency_code, currency_name, country_code, region, round(rate_to_ugx, 6) AS rate_to_ugx,
           local_inflation_pct, updated_at
      FROM public.ican_currency_rates
     WHERE (v_cur IS NULL OR currency_code = v_cur) AND (v_country IS NULL OR country_code = v_country)
       AND (v_region IS NULL OR region ILIKE v_region)
     ORDER BY currency_code, country_code LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_icanera_countries(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cur TEXT := upper(public.era_p_text(p, 'currency', 12));
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[{"country_code":"UG","currency_code":"UGX"},{"country_code":"KE","currency_code":"KES"},
        {"country_code":"TZ","currency_code":"TZS"},{"country_code":"RW","currency_code":"RWF"},{"country_code":"NG","currency_code":"NGN"},
        {"country_code":"ZA","currency_code":"ZAR"}]'::JSONB) AS t(country_code TEXT, currency_code TEXT)
       WHERE v_cur IS NULL OR currency_code = v_cur) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT country_code, currency_code FROM public.ican_country_currency_map
     WHERE v_cur IS NULL OR currency_code = v_cur ORDER BY country_code) x), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_icanera_tax_rules(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cc TEXT := upper(public.era_p_text(p, 'country', 12)); r RECORD;
BEGIN
  IF v_cc IS NULL OR v_cc !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'country must be a 2-letter ISO code such as UG' USING ERRCODE = '22023'; END IF;
  IF p_sandbox THEN
    IF v_cc <> 'UG' THEN RAISE EXCEPTION 'Sandbox only has Uganda (UG).' USING ERRCODE = 'P0002'; END IF;
    RETURN jsonb_build_object('country_code', 'UG', 'country_name', 'Uganda', 'currency', 'UGX',
      'personal_tax_period', 'annual', 'corporate_tax_rate', 30, 'vat_rate', 18, 'capital_gains_rate', 30,
      'regulatory_body', 'Uganda Revenue Authority', 'filing_date', '30 June',
      'personal_tax_brackets', '[{"up_to":2820000,"rate":0},{"up_to":4020000,"rate":10},{"up_to":4920000,"rate":20},{"up_to":null,"rate":30}]'::JSONB,
      'informational_only', TRUE);
  END IF;
  SELECT country_code, country_name, currency, personal_tax_period, corporate_tax_rate, vat_rate, capital_gains_rate,
         regulatory_body, filing_date, personal_tax_brackets, last_verified_at, source INTO r
    FROM public.country_tax_rules WHERE upper(country_code) = v_cc LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'No tax rules on file for %.', v_cc USING ERRCODE = 'P0002'; END IF;
  RETURN to_jsonb(r) || jsonb_build_object('informational_only', TRUE);
END;
$$;

-- The public business directory (the same list the landing page search shows).
CREATE OR REPLACE FUNCTION public.era_h_icanera_businesses(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_q TEXT := public.era_p_text(p, 'q', 60);
  v_limit INTEGER := public.era_p_int(p, 'limit', 20, 1, 50);
  v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 10000);
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"id":"7d1c0000-0000-4000-8000-000000000001","name":"Kampala Fresh Mart","industry":"Retail","location":"Kampala, Uganda","tagline":"Fresh every morning","website":"https://example.com","open_jobs":2,"notices":5},
        {"id":"7d1c0000-0000-4000-8000-000000000002","name":"Nile Logistics","industry":"Transport","location":"Jinja, Uganda","tagline":"Moving East Africa","website":"https://example.org","open_jobs":0,"notices":1},
        {"id":"7d1c0000-0000-4000-8000-000000000003","name":"Savanna Agro Supplies","industry":"Agriculture","location":"Mbarara, Uganda","tagline":"Seeds, tools, advice","website":null,"open_jobs":1,"notices":3}]'::JSONB)
        AS t(id UUID, name TEXT, industry TEXT, location TEXT, tagline TEXT, website TEXT, open_jobs INTEGER, notices INTEGER)
       WHERE v_q IS NULL OR name ILIKE public.era_p_like(v_q) OR industry ILIKE public.era_p_like(v_q)) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT id, company_name AS name, industry, location, tagline, website, logo_url, open_jobs, notices
      FROM public.fn_search_public_cmms_businesses(v_q, v_limit, v_offset)) x), '[]'::JSONB);
END;
$$;

-- ============================================================================ BODAGOERA

CREATE OR REPLACE FUNCTION public.era_h_bodagoera_stages(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_q TEXT := public.era_p_text(p, 'q', 60);
  v_limit INTEGER := public.era_p_int(p, 'limit', 50, 1, 200);
  v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 10000);
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"id":"5a6e0000-0000-4000-8000-000000000001","name":"Wandegeya Stage","location_name":"Wandegeya Market, Kampala","latitude":0.3318,"longitude":32.5728,"description":"Busy student stage"},
        {"id":"5a6e0000-0000-4000-8000-000000000002","name":"Jinja Road Stage","location_name":"Jinja Road, Kampala","latitude":0.3173,"longitude":32.6020,"description":"Opposite the roundabout"}]'::JSONB)
        AS t(id UUID, name TEXT, location_name TEXT, latitude NUMERIC, longitude NUMERIC, description TEXT)
       WHERE v_q IS NULL OR name ILIKE public.era_p_like(v_q) OR location_name ILIKE public.era_p_like(v_q)) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT id, name, location_name, location_lat AS latitude, location_lng AS longitude, description
      FROM public.mbg_stages
     WHERE is_active AND (v_q IS NULL OR name ILIKE public.era_p_like(v_q) OR location_name ILIKE public.era_p_like(v_q))
     ORDER BY name LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_bodagoera_districts(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_sandbox THEN
    RETURN '[{"name":"Kampala","code":"KLA","description":"Capital city"},{"name":"Wakiso","code":"WAK","description":"Greater Kampala"},
             {"name":"Jinja","code":"JJA","description":"Source of the Nile"}]'::JSONB;
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT name, code, description FROM public.mbg_districts WHERE is_active ORDER BY name) x), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_bodagoera_ports(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_country TEXT := public.era_p_text(p, 'country', 60);
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"country":"Kenya","city":"Mombasa","port_name":"Port of Mombasa","latitude":-4.0435,"longitude":39.6682,"un_locode":"KEMBA"},
        {"country":"Tanzania","city":"Dar es Salaam","port_name":"Port of Dar es Salaam","latitude":-6.8235,"longitude":39.2695,"un_locode":"TZDAR"}]'::JSONB)
        AS t(country TEXT, city TEXT, port_name TEXT, latitude NUMERIC, longitude NUMERIC, un_locode TEXT)
       WHERE v_country IS NULL OR country ILIKE v_country) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT country, city, port_name, latitude, longitude, un_locode FROM public.mbg_ports
     WHERE is_active AND (v_country IS NULL OR country ILIKE v_country) ORDER BY country, city) x), '[]'::JSONB);
END;
$$;

-- A fare ESTIMATE from the platform's public price settings: max(minimum, base + per_km x distance).
CREATE OR REPLACE FUNCTION public.era_h_bodagoera_fare_estimate(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_km NUMERIC := public.era_p_num(p, 'km', 0.1, 500, TRUE);
  v_kind TEXT := lower(COALESCE(public.era_p_text(p, 'kind', 12), 'ride'));
  v_base NUMERIC; v_per NUMERIC; v_min NUMERIC; v_fare NUMERIC;
BEGIN
  IF v_kind NOT IN ('ride', 'cargo') THEN RAISE EXCEPTION 'kind must be ride or cargo' USING ERRCODE = '22023'; END IF;
  IF p_sandbox THEN
    v_base := CASE v_kind WHEN 'ride' THEN 1000 ELSE 5000 END; v_per := CASE v_kind WHEN 'ride' THEN 1000 ELSE 2000 END;
    v_min := CASE v_kind WHEN 'ride' THEN 2000 ELSE 0 END;
  ELSE
    SELECT MAX(value::NUMERIC) FILTER (WHERE key = v_kind || '.base_fare'),
           MAX(value::NUMERIC) FILTER (WHERE key = v_kind || '.per_km_rate'),
           MAX(value::NUMERIC) FILTER (WHERE key = v_kind || '.minimum_fare')
      INTO v_base, v_per, v_min
      FROM public.mbg_platform_settings
     WHERE is_public AND key IN (v_kind || '.base_fare', v_kind || '.per_km_rate', v_kind || '.minimum_fare')
       AND value ~ '^[0-9]+(\.[0-9]+)?$';
    IF v_base IS NULL OR v_per IS NULL THEN RAISE EXCEPTION 'Fares are not published for %.', v_kind USING ERRCODE = 'P0002'; END IF;
  END IF;
  v_fare := GREATEST(COALESCE(v_min, 0), v_base + v_per * v_km);
  RETURN jsonb_build_object('kind', v_kind, 'distance_km', v_km, 'currency', 'UGX', 'estimated_fare', round(v_fare),
    'breakdown', jsonb_build_object('base_fare', v_base, 'per_km_rate', v_per, 'minimum_fare', v_min),
    'note', 'An estimate from the published rates. The final fare is set by the ride.');
END;
$$;

-- Is this rider card genuine? Wraps the public verifier and returns only what a passenger needs to know.
CREATE OR REPLACE FUNCTION public.era_h_bodagoera_verify_rider(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code TEXT := public.era_p_text(p, 'code', 64); v JSONB;
BEGIN
  IF v_code IS NULL OR v_code !~ '^[A-Za-z0-9]{4,64}$' THEN
    RAISE EXCEPTION 'code must be the 16 to 64 letter-or-digit code printed on the rider card QR' USING ERRCODE = '22023';
  END IF;
  IF p_sandbox THEN
    IF lower(v_code) LIKE '%valid' THEN
      RETURN '{"is_valid":true,"state":"valid","card_number":"BGE-0001","full_name":"Sample Rider","vehicle_type":"motorcycle",
               "vehicle_model":"Bajaj Boxer","vehicle_color":"Red","plate_number":"UAA 123B","rating":4.8,"completed_rides":412,
               "stage":"Wandegeya Stage","district":"Kampala","permit_status":"valid"}'::JSONB;
    END IF;
    RETURN '{"is_valid":false}'::JSONB;
  END IF;
  v := public.mbg_verify_rider_card(v_code);
  -- minimal: no phone numbers, no licence details, no money
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'is_valid', COALESCE((v ->> 'is_valid')::BOOLEAN, FALSE), 'state', v ->> 'state', 'card_number', v ->> 'card_number',
    'full_name', v ->> 'full_name', 'vehicle_type', v ->> 'vehicle_type', 'vehicle_model', v ->> 'vehicle_model',
    'vehicle_color', v ->> 'vehicle_color', 'plate_number', v ->> 'plate_number', 'rating', v -> 'rating',
    'completed_rides', v -> 'completed_rides', 'stage', v ->> 'stage', 'district', v ->> 'district',
    'permit_status', v ->> 'permit_status'));
END;
$$;

-- ============================================================================ SUPERMARKETERA

CREATE OR REPLACE FUNCTION public.era_h_supermarketera_stores(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_q TEXT := public.era_p_text(p, 'q', 60);
  v_city TEXT := public.era_p_text(p, 'city', 60);
  v_country TEXT := public.era_p_text(p, 'country', 60);
  v_limit INTEGER := public.era_p_int(p, 'limit', 25, 1, 100);
  v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 10000);
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"id":"3c4f0000-0000-4000-8000-000000000001","name":"Kampala Fresh Mart","slug":"kampala-fresh-mart","city":"Kampala","country":"Uganda","business_type":"supermarket","latitude":0.3476,"longitude":32.5825,"offers_products":true,"offers_services":false},
        {"id":"3c4f0000-0000-4000-8000-000000000002","name":"Entebbe Corner Shop","slug":"entebbe-corner-shop","city":"Entebbe","country":"Uganda","business_type":"minimart","latitude":0.0512,"longitude":32.4637,"offers_products":true,"offers_services":true}]'::JSONB)
        AS t(id UUID, name TEXT, slug TEXT, city TEXT, country TEXT, business_type TEXT, latitude NUMERIC, longitude NUMERIC, offers_products BOOLEAN, offers_services BOOLEAN)
       WHERE (v_q IS NULL OR name ILIKE public.era_p_like(v_q)) AND (v_city IS NULL OR city ILIKE v_city)
         AND (v_country IS NULL OR country ILIKE v_country)) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT id, name, slug, city, country, location, description, logo_url, business_type, latitude, longitude,
           offers_products, offers_services, price_currency
      FROM public.supermarkets
     WHERE is_active IS NOT FALSE AND COALESCE(status, 'active') NOT IN ('suspended', 'rejected', 'pending')
       AND (v_q IS NULL OR name ILIKE public.era_p_like(v_q))
       AND (v_city IS NULL OR city ILIKE v_city) AND (v_country IS NULL OR country ILIKE v_country)
     ORDER BY name LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

-- Supplier catalogue. Never returns cost prices, stock levels or who the supplier is.
CREATE OR REPLACE FUNCTION public.era_h_supermarketera_catalog(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_q TEXT := public.era_p_text(p, 'q', 60);
  v_cat TEXT := public.era_p_text(p, 'category', 60);
  v_brand TEXT := public.era_p_text(p, 'brand', 60);
  v_limit INTEGER := public.era_p_int(p, 'limit', 25, 1, 100);
  v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 100000);
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"id":"9b2a0000-0000-4000-8000-000000000001","name":"Sliced Bread 600g","category":"Bakery","brand":"Daily Loaf","unit":"loaf","price_per_unit":4500,"currency":"UGX","sku":"BRD-600","barcode":"6001234567890","min_order_qty":12},
        {"id":"9b2a0000-0000-4000-8000-000000000002","name":"Bath Soap 200g","category":"Personal Care","brand":"Pure","unit":"bar","price_per_unit":2800,"currency":"UGX","sku":"SOP-200","barcode":"6009876543210","min_order_qty":24}]'::JSONB)
        AS t(id UUID, name TEXT, category TEXT, brand TEXT, unit TEXT, price_per_unit NUMERIC, currency TEXT, sku TEXT, barcode TEXT, min_order_qty NUMERIC)
       WHERE (v_q IS NULL OR name ILIKE public.era_p_like(v_q) OR brand ILIKE public.era_p_like(v_q))
         AND (v_cat IS NULL OR category ILIKE v_cat) AND (v_brand IS NULL OR brand ILIKE v_brand)) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT id, name, category, brand, description, unit, min_order_qty, price_per_unit, currency, image_url, sku, barcode
      FROM public.supplier_catalog_items
     WHERE is_available AND (v_q IS NULL OR name ILIKE public.era_p_like(v_q) OR brand ILIKE public.era_p_like(v_q))
       AND (v_cat IS NULL OR category ILIKE v_cat) AND (v_brand IS NULL OR brand ILIKE v_brand)
     ORDER BY name LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_supermarketera_barcode(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code TEXT := public.era_p_text(p, 'code', 32); r RECORD;
BEGIN
  IF v_code IS NULL OR v_code !~ '^[A-Za-z0-9-]{3,32}$' THEN
    RAISE EXCEPTION 'code must be a barcode or SKU (3 to 32 letters, digits or dashes)' USING ERRCODE = '22023';
  END IF;
  IF p_sandbox THEN
    IF v_code IN ('6001234567890', 'BRD-600') THEN
      RETURN '{"id":"9b2a0000-0000-4000-8000-000000000001","name":"Sliced Bread 600g","category":"Bakery","brand":"Daily Loaf","unit":"loaf","price_per_unit":4500,"currency":"UGX","sku":"BRD-600","barcode":"6001234567890"}'::JSONB;
    END IF;
    RAISE EXCEPTION 'No product with code %. In the sandbox try 6001234567890.', v_code USING ERRCODE = 'P0002';
  END IF;
  SELECT id, name, category, brand, description, unit, min_order_qty, price_per_unit, currency, image_url, sku, barcode INTO r
    FROM public.supplier_catalog_items WHERE is_available AND (barcode = v_code OR upper(sku) = upper(v_code)) LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'No product with code %.', v_code USING ERRCODE = 'P0002'; END IF;
  RETURN to_jsonb(r);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_supermarketera_categories(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_sandbox THEN
    RETURN '[{"category":"Bakery","items":42},{"category":"Personal Care","items":88},{"category":"Grains","items":120}]'::JSONB;
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT category, COUNT(*) AS items FROM public.supplier_catalog_items
     WHERE is_available AND category IS NOT NULL GROUP BY category ORDER BY COUNT(*) DESC, category) x), '[]'::JSONB);
END;
$$;

-- ============================================================================ FARMAGENTERA

-- Marketplace listings. No seller identity, no phone, email or WhatsApp, no exact coordinates.
CREATE OR REPLACE FUNCTION public.era_h_farmagentera_listings(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_type TEXT := lower(COALESCE(public.era_p_text(p, 'type', 12), 'all'));
  v_q TEXT := public.era_p_text(p, 'q', 60);
  v_district TEXT := public.era_p_text(p, 'district', 60);
  v_limit INTEGER := public.era_p_int(p, 'limit', 25, 1, 100);
  v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 10000);
BEGIN
  IF v_type NOT IN ('all', 'produce', 'land', 'service') THEN
    RAISE EXCEPTION 'type must be all, produce, land or service' USING ERRCODE = '22023';
  END IF;
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"id":101,"type":"produce","title":"Fresh matooke, 40 bunches","price":180000,"is_negotiable":true,"district":"Mbarara","location":"Kakoba","featured":true,
         "details":{"crop_name":"Matooke","quantity":40,"unit":"bunches","is_organic":true,"availability":"available"}},
        {"id":102,"type":"land","title":"5 acres, road access, near water","price":25000000,"is_negotiable":true,"district":"Wakiso","location":"Kasanje","featured":false,
         "details":{"size_acres":5,"land_type":"agricultural","is_for_sale":true,"has_road_access":true,"water_source":"borehole"}},
        {"id":103,"type":"service","title":"Tractor ploughing, per acre","price":120000,"is_negotiable":false,"district":"Masaka","location":"Nyendo","featured":false,
         "details":{"service_type":"equipment rental","price_unit":"per acre","experience_years":8}}]'::JSONB)
        AS t(id INTEGER, type TEXT, title TEXT, price NUMERIC, is_negotiable BOOLEAN, district TEXT, location TEXT, featured BOOLEAN, details JSONB)
       WHERE (v_type = 'all' OR type = v_type) AND (v_q IS NULL OR title ILIKE public.era_p_like(v_q))
         AND (v_district IS NULL OR district ILIKE v_district)) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT m.id, m.type, m.title, m.description, m.price, m.is_negotiable, m.location, m.district, m.thumbnail, m.images,
           m.featured, m.created_at,
           CASE m.type
             WHEN 'produce' THEN (SELECT jsonb_build_object('crop_name', pl.crop_name, 'produce_type', pl.produce_type, 'quantity', pl.quantity,
                    'unit', pl.unit, 'harvest_date', pl.harvest_date, 'is_organic', pl.is_organic, 'availability', pl.availability,
                    'min_order_quantity', pl.min_order_quantity) FROM public.produce_listings pl WHERE pl.listing_id = m.id LIMIT 1)
             WHEN 'land' THEN (SELECT jsonb_build_object('size_acres', ll.size_acres, 'land_type', ll.land_type, 'ownership_type', ll.ownership_type,
                    'is_for_sale', ll.is_for_sale, 'lease_term', ll.lease_term, 'soil_type', ll.soil_type, 'water_source', ll.water_source,
                    'has_road_access', ll.has_road_access, 'has_electricity', ll.has_electricity) FROM public.land_listings ll WHERE ll.listing_id = m.id LIMIT 1)
             WHEN 'service' THEN (SELECT jsonb_build_object('service_type', sl.service_type, 'price_unit', sl.price_unit,
                    'experience_years', sl.experience_years, 'skills', sl.skills, 'equipment', sl.equipment, 'service_area', sl.service_area)
                    FROM public.service_listings sl WHERE sl.listing_id = m.id LIMIT 1)
           END AS details
      FROM public.marketplace_listings m
     WHERE m.status = 'active' AND (m.expiry_date IS NULL OR m.expiry_date >= CURRENT_DATE)
       AND (v_type = 'all' OR m.type = v_type)
       AND (v_q IS NULL OR m.title ILIKE public.era_p_like(v_q) OR m.description ILIKE public.era_p_like(v_q))
       AND (v_district IS NULL OR m.district ILIKE v_district)
     ORDER BY m.featured DESC, m.created_at DESC LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

-- A live produce price board: what each crop is asking right now, from the marketplace.
CREATE OR REPLACE FUNCTION public.era_h_farmagentera_price_board(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_district TEXT := public.era_p_text(p, 'district', 60);
  v_limit INTEGER := public.era_p_int(p, 'limit', 30, 1, 100);
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"crop_name":"Matooke","listings":9,"min_price":120000,"avg_price":165000,"max_price":210000,"total_quantity":310,"unit":"bunches"},
        {"crop_name":"Maize","listings":6,"min_price":900000,"avg_price":1050000,"max_price":1200000,"total_quantity":48,"unit":"bags"},
        {"crop_name":"Beans","listings":4,"min_price":300000,"avg_price":340000,"max_price":380000,"total_quantity":22,"unit":"bags"}]'::JSONB)
        AS t(crop_name TEXT, listings INTEGER, min_price NUMERIC, avg_price NUMERIC, max_price NUMERIC, total_quantity NUMERIC, unit TEXT)) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT initcap(btrim(pl.crop_name)) AS crop_name, COUNT(*) AS listings,
           MIN(m.price) AS min_price, round(AVG(m.price), 2) AS avg_price, MAX(m.price) AS max_price,
           SUM(pl.quantity) AS total_quantity, MIN(pl.unit) AS unit
      FROM public.marketplace_listings m JOIN public.produce_listings pl ON pl.listing_id = m.id
     WHERE m.status = 'active' AND m.type = 'produce' AND m.price IS NOT NULL AND pl.crop_name IS NOT NULL
       AND (m.expiry_date IS NULL OR m.expiry_date >= CURRENT_DATE) AND (v_district IS NULL OR m.district ILIKE v_district)
     GROUP BY initcap(btrim(pl.crop_name)) ORDER BY COUNT(*) DESC, 1 LIMIT v_limit) x), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_farmagentera_crops(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_q TEXT := public.era_p_text(p, 'q', 60);
  v_season TEXT := public.era_p_text(p, 'season', 30);
  v_type TEXT := public.era_p_text(p, 'type', 40);
  v_limit INTEGER := public.era_p_int(p, 'limit', 25, 1, 100);
  v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 10000);
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"name":"Maize (Longe 5)","scientific_name":"Zea mays","crop_type":"cereal","season":"first rains","maturity_days":110,"expected_yield_per_hectare":5.2,"soil_ph_min":5.8,"soil_ph_max":7.0,"water_requirements":"medium"},
        {"name":"Climbing beans (NABE 4)","scientific_name":"Phaseolus vulgaris","crop_type":"legume","season":"second rains","maturity_days":75,"expected_yield_per_hectare":2.1,"soil_ph_min":6.0,"soil_ph_max":7.5,"water_requirements":"medium"}]'::JSONB)
        AS t(name TEXT, scientific_name TEXT, crop_type TEXT, season TEXT, maturity_days INTEGER, expected_yield_per_hectare NUMERIC, soil_ph_min NUMERIC, soil_ph_max NUMERIC, water_requirements TEXT)
       WHERE (v_q IS NULL OR name ILIKE public.era_p_like(v_q)) AND (v_season IS NULL OR season ILIKE v_season)
         AND (v_type IS NULL OR crop_type ILIKE v_type)) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT name, scientific_name, crop_type, season, maturity_days, expected_yield_per_hectare, soil_ph_min, soil_ph_max,
           water_requirements, description
      FROM public.crop_varieties
     WHERE (v_q IS NULL OR name ILIKE public.era_p_like(v_q) OR scientific_name ILIKE public.era_p_like(v_q))
       AND (v_season IS NULL OR season ILIKE v_season) AND (v_type IS NULL OR crop_type ILIKE v_type)
     ORDER BY name LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

-- ============================================================================ the registry
-- (Re-running refreshes the text and handlers but keeps `enabled` and `cache_seconds` as an administrator left them.)
INSERT INTO public.era_api_endpoints (id, app, path, summary, description, params, example_path, handler, cache_seconds, sort) VALUES
 ('platform.whoami', 'platform', '/whoami', 'Who am I?',
  'Your app, key mode, approved apps, limits and how much of today''s quota is used. The first call to make.',
  '[]', '/whoami', 'public.era_h_platform_whoami', 0, 10),
 ('platform.pulse', 'platform', '/pulse', 'The whole family in one call',
  'A snapshot across every app your key is approved for: the ICAN price, BodaGoEra stages, SupermarketEra stores and FarmAgentEra listings.',
  '[]', '/pulse', 'public.era_h_platform_pulse', 30, 11),

 ('icanera.coin_price', 'icanera', '/icanera/coin/price', 'ICAN coin price',
  'The live price of 1 ICAN in any of ~170 currencies, with 24h and 7d change.',
  '[{"name":"currency","in":"query","type":"string","required":false,"default":"USD","example":"UGX","description":"3-letter currency code."}]',
  '/icanera/coin/price?currency=UGX', 'public.era_h_icanera_coin_price', 30, 20),
 ('icanera.coin_candles', 'icanera', '/icanera/coin/candles', 'ICAN price candles',
  'OHLC candles in UGX, newest bins last, ready for a chart.',
  '[{"name":"interval","in":"query","type":"string","required":false,"default":"1h","example":"15m","description":"One of 5m, 15m, 1h, 4h, 1d."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":48,"example":24,"description":"How many candles (1 to 288)."}]',
  '/icanera/coin/candles?interval=1h&limit=24', 'public.era_h_icanera_coin_candles', 60, 21),
 ('icanera.fx_rates', 'icanera', '/icanera/fx/rates', 'FX rates and inflation',
  'Exchange rates against the Ugandan shilling, with each country''s latest inflation.',
  '[{"name":"currency","in":"query","type":"string","required":false,"example":"KES","description":"Filter by currency code."},
    {"name":"country","in":"query","type":"string","required":false,"example":"KE","description":"Filter by 2-letter country code."},
    {"name":"region","in":"query","type":"string","required":false,"example":"Africa","description":"Filter by region."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":50,"description":"1 to 250."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '/icanera/fx/rates?region=Africa&limit=10', 'public.era_h_icanera_fx_rates', 300, 22),
 ('icanera.countries', 'icanera', '/icanera/countries', 'Countries and currencies',
  'Which currency each supported country uses.',
  '[{"name":"currency","in":"query","type":"string","required":false,"example":"UGX","description":"Only countries using this currency."}]',
  '/icanera/countries', 'public.era_h_icanera_countries', 3600, 23),
 ('icanera.tax_rules', 'icanera', '/icanera/tax/{country}', 'Tax rules by country',
  'Published tax brackets and rates for a country. Informational, never tax advice.',
  '[{"name":"country","in":"path","type":"string","required":true,"example":"UG","description":"2-letter ISO country code."}]',
  '/icanera/tax/UG', 'public.era_h_icanera_tax_rules', 3600, 24),
 ('icanera.businesses', 'icanera', '/icanera/businesses', 'Public business directory',
  'Businesses that chose to be listed publicly, with open jobs and notices counts.',
  '[{"name":"q","in":"query","type":"string","required":false,"example":"agro","description":"Search by name or industry."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":20,"description":"1 to 50."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '/icanera/businesses?q=agro', 'public.era_h_icanera_businesses', 120, 25),

 ('bodagoera.stages', 'bodagoera', '/bodagoera/stages', 'Boda stages',
  'Where riders gather: names, areas and coordinates.',
  '[{"name":"q","in":"query","type":"string","required":false,"example":"wandegeya","description":"Search by stage or area."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":50,"description":"1 to 200."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '/bodagoera/stages', 'public.era_h_bodagoera_stages', 120, 30),
 ('bodagoera.districts', 'bodagoera', '/bodagoera/districts', 'Districts served',
  'The districts BodaGoEra operates in.', '[]', '/bodagoera/districts', 'public.era_h_bodagoera_districts', 600, 31),
 ('bodagoera.ports', 'bodagoera', '/bodagoera/ports', 'Ports',
  'Sea ports used for cross-border journeys, with UN/LOCODE.',
  '[{"name":"country","in":"query","type":"string","required":false,"example":"Kenya","description":"Filter by country name."}]',
  '/bodagoera/ports?country=Kenya', 'public.era_h_bodagoera_ports', 600, 32),
 ('bodagoera.fare_estimate', 'bodagoera', '/bodagoera/fare/estimate', 'Fare estimate',
  'Estimate a ride or cargo fare from the published rates: max(minimum, base + per-km x distance).',
  '[{"name":"km","in":"query","type":"number","required":true,"example":7.5,"description":"Distance in kilometres (0.1 to 500)."},
    {"name":"kind","in":"query","type":"string","required":false,"default":"ride","example":"cargo","description":"ride or cargo."}]',
  '/bodagoera/fare/estimate?km=7.5', 'public.era_h_bodagoera_fare_estimate', 60, 33),
 ('bodagoera.verify_rider', 'bodagoera', '/bodagoera/riders/verify', 'Verify a rider card',
  'Is this the rider the card says? Pass the code from the card''s QR. Returns only what a passenger needs.',
  '[{"name":"code","in":"query","type":"string","required":true,"example":"SAMPLE0000000000valid","description":"The verification code on the rider card. In the sandbox, any code ending in ''valid'' passes."}]',
  '/bodagoera/riders/verify?code=SAMPLE0000000000valid', 'public.era_h_bodagoera_verify_rider', 0, 34),

 ('supermarketera.stores', 'supermarketera', '/supermarketera/stores', 'Stores',
  'Stores on SupermarketEra with their city and what they offer.',
  '[{"name":"q","in":"query","type":"string","required":false,"example":"fresh","description":"Search by store name."},
    {"name":"city","in":"query","type":"string","required":false,"example":"Kampala","description":"Filter by city."},
    {"name":"country","in":"query","type":"string","required":false,"example":"Uganda","description":"Filter by country."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":25,"description":"1 to 100."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '/supermarketera/stores?city=Kampala', 'public.era_h_supermarketera_stores', 120, 40),
 ('supermarketera.catalog', 'supermarketera', '/supermarketera/catalog', 'Product catalogue',
  'Wholesale catalogue items: names, brands, units and prices. No stock levels, cost prices or supplier identities.',
  '[{"name":"q","in":"query","type":"string","required":false,"example":"soap","description":"Search by name or brand."},
    {"name":"category","in":"query","type":"string","required":false,"example":"Bakery","description":"Filter by category."},
    {"name":"brand","in":"query","type":"string","required":false,"description":"Filter by brand."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":25,"description":"1 to 100."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '/supermarketera/catalog?q=bread', 'public.era_h_supermarketera_catalog', 60, 41),
 ('supermarketera.barcode', 'supermarketera', '/supermarketera/barcode/{code}', 'Look up a barcode',
  'Find a catalogue item by barcode or SKU.',
  '[{"name":"code","in":"path","type":"string","required":true,"example":"6001234567890","description":"Barcode or SKU. In the sandbox try 6001234567890."}]',
  '/supermarketera/barcode/6001234567890', 'public.era_h_supermarketera_barcode', 300, 42),
 ('supermarketera.categories', 'supermarketera', '/supermarketera/categories', 'Catalogue categories',
  'Every category with how many items it holds.', '[]', '/supermarketera/categories', 'public.era_h_supermarketera_categories', 300, 43),

 ('farmagentera.listings', 'farmagentera', '/farmagentera/listings', 'Marketplace listings',
  'Produce, land and services for sale or hire. No seller identity or contact details: people connect inside the app.',
  '[{"name":"type","in":"query","type":"string","required":false,"default":"all","example":"produce","description":"all, produce, land or service."},
    {"name":"q","in":"query","type":"string","required":false,"example":"matooke","description":"Search titles and descriptions."},
    {"name":"district","in":"query","type":"string","required":false,"example":"Mbarara","description":"Filter by district."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":25,"description":"1 to 100."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '/farmagentera/listings?type=produce', 'public.era_h_farmagentera_listings', 60, 50),
 ('farmagentera.price_board', 'farmagentera', '/farmagentera/price-board', 'Produce price board',
  'What each crop is asking right now: listing count, lowest, average and highest price, total quantity.',
  '[{"name":"district","in":"query","type":"string","required":false,"example":"Masaka","description":"Only listings in this district."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":30,"description":"1 to 100."}]',
  '/farmagentera/price-board', 'public.era_h_farmagentera_price_board', 120, 51),
 ('farmagentera.crops', 'farmagentera', '/farmagentera/crops', 'Crop varieties',
  'Reference data: season, maturity days, expected yield, soil pH and water needs.',
  '[{"name":"q","in":"query","type":"string","required":false,"example":"maize","description":"Search by name."},
    {"name":"season","in":"query","type":"string","required":false,"description":"Filter by season."},
    {"name":"type","in":"query","type":"string","required":false,"example":"cereal","description":"Filter by crop type."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":25,"description":"1 to 100."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '/farmagentera/crops?q=maize', 'public.era_h_farmagentera_crops', 3600, 52)
ON CONFLICT (id) DO UPDATE SET
  app = EXCLUDED.app, path = EXCLUDED.path, summary = EXCLUDED.summary, description = EXCLUDED.description,
  params = EXCLUDED.params, example_path = EXCLUDED.example_path, handler = EXCLUDED.handler, sort = EXCLUDED.sort;

-- Handlers and helpers are internal: only era_api_call (SECURITY DEFINER) reaches them.
DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND (p.proname LIKE 'era\_h\_%' OR p.proname LIKE 'era\_p\_%') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;
