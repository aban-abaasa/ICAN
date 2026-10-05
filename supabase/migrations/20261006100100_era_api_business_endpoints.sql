-- ============================================================================
-- ERA API v2, part 2: the new endpoints. Needs 20261006100000_era_api_business.sql first.
--
--   Public (any key)        coin valuation / supply / convert, network fee estimate, integrity-chain proofs,
--                           journey and delivery quotes (BodaGoEra's real fare formula), product catalogue, clearance deals
--   Private (business keys) payment requests, inventory with expiry tracking, CMMS, booking requests
--
-- Every handler follows the v1 rules (see 20261005100100): sandbox = fixtures, bad input = 22023, missing = P0002.
-- Business handlers add three more, and the tests prove them:
--   1. the business comes from the KEY (params._business_id), never from anything the caller sends
--   2. nothing about people: no staff, riders, customers, payers
--   3. nothing here moves money or dispatches anyone. A payment request waits for its payer's own PIN; a booking
--      intent waits for the customer's own booking.
-- Re-running refreshes descriptions but keeps whatever an administrator switched.
-- ============================================================================

DO $$ BEGIN
  IF to_regclass('public.era_api_booking_intents') IS NULL THEN
    RAISE EXCEPTION 'Apply supabase/migrations/20261006100000_era_api_business.sql first.';
  END IF;
END $$;

-- ============================================================================ helpers

-- BodaGoEra's time-of-day multiplier (mirrors mbg_current_time_multiplier, but at any moment so a quote can be for later).
CREATE OR REPLACE FUNCTION public.era__time_multiplier(p_at TIMESTAMPTZ) RETURNS NUMERIC
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN EXTRACT(HOUR FROM (p_at AT TIME ZONE 'Africa/Kampala')) IN (7, 8, 17, 18, 19) THEN 1.3
              WHEN EXTRACT(HOUR FROM (p_at AT TIME ZONE 'Africa/Kampala')) >= 22 OR EXTRACT(HOUR FROM (p_at AT TIME ZONE 'Africa/Kampala')) < 5 THEN 1.2
              ELSE 1.0 END
$$;

CREATE OR REPLACE FUNCTION public.era__multiplier_reason(p_at TIMESTAMPTZ) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN EXTRACT(HOUR FROM (p_at AT TIME ZONE 'Africa/Kampala')) IN (7, 8) THEN 'morning peak'
              WHEN EXTRACT(HOUR FROM (p_at AT TIME ZONE 'Africa/Kampala')) IN (17, 18, 19) THEN 'evening peak'
              WHEN EXTRACT(HOUR FROM (p_at AT TIME ZONE 'Africa/Kampala')) >= 22 OR EXTRACT(HOUR FROM (p_at AT TIME ZONE 'Africa/Kampala')) < 5 THEN 'late night'
              ELSE 'standard' END
$$;

CREATE OR REPLACE FUNCTION public.era__haversine_km(lat1 NUMERIC, lng1 NUMERIC, lat2 NUMERIC, lng2 NUMERIC) RETURNS NUMERIC
LANGUAGE sql IMMUTABLE AS $$
  SELECT 2 * 6371 * asin(sqrt(
           power(sin(radians((lat2 - lat1)::DOUBLE PRECISION) / 2), 2)
         + cos(radians(lat1::DOUBLE PRECISION)) * cos(radians(lat2::DOUBLE PRECISION))
         * power(sin(radians((lng2 - lng1)::DOUBLE PRECISION) / 2), 2)))::NUMERIC
$$;

-- UGX per one unit of a currency (UGX itself is 1). NULL when the platform has no rate.
CREATE OR REPLACE FUNCTION public.era__ugx_per(p_cur TEXT) RETURNS NUMERIC
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v NUMERIC;
BEGIN
  IF upper(p_cur) = 'UGX' THEN RETURN 1; END IF;
  SELECT rate_to_ugx INTO v FROM public.ican_currency_rates WHERE currency_code = upper(p_cur) AND rate_to_ugx > 0 LIMIT 1;
  RETURN v;
END;
$$;

-- UGX price of 1 ICAN (latest stored), NULL if unavailable.
CREATE OR REPLACE FUNCTION public.era__ican_price_ugx() RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT price_ugx FROM public.ican_coin_market_prices ORDER BY timestamp DESC LIMIT 1
$$;

-- "0.3476,32.5825" -> [lat, lng], validated.
CREATE OR REPLACE FUNCTION public.era__point(p_txt TEXT, p_name TEXT) RETURNS NUMERIC[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE m TEXT[]; la NUMERIC; ln NUMERIC;
BEGIN
  m := regexp_match(btrim(COALESCE(p_txt, '')), '^(-?[0-9]{1,3}(?:\.[0-9]{1,7})?)\s*[,;]\s*(-?[0-9]{1,3}(?:\.[0-9]{1,7})?)$');
  IF m IS NULL THEN
    RAISE EXCEPTION '% must look like "0.3476,32.5825" (latitude,longitude)', p_name USING ERRCODE = '22023';
  END IF;
  la := m[1]::NUMERIC; ln := m[2]::NUMERIC;
  IF la < -90 OR la > 90 OR ln < -180 OR ln > 180 THEN
    RAISE EXCEPTION '% is outside the valid latitude/longitude range', p_name USING ERRCODE = '22023';
  END IF;
  RETURN ARRAY[la, ln];
END;
$$;

-- A priced multi-leg ground journey. p_points is a JSON array of [lat, lng] pairs (2 to 5). Each leg is priced exactly the
-- way BodaGoEra's booking engine prices a ride: max(minimum, base + per-km x straight-line km) x time-of-day multiplier,
-- rounded to the nearest 100 UGX.
CREATE OR REPLACE FUNCTION public.era__quote(p_points JSONB, p_kind TEXT, p_at TIMESTAMPTZ) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n INTEGER := jsonb_array_length(p_points);
  v_pre TEXT := CASE WHEN p_kind = 'cargo' THEN 'cargo' ELSE 'ride' END;
  v_base NUMERIC; v_per NUMERIC; v_min NUMERIC;
  v_mult NUMERIC := public.era__time_multiplier(p_at);
  i INTEGER; v_km NUMERIC; v_fare NUMERIC; v_min_leg NUMERIC;
  v_legs JSONB := '[]'::JSONB; v_total NUMERIC := 0; v_dist NUMERIC := 0; v_dur INTEGER := 0;
  v_ican NUMERIC := public.era__ican_price_ugx();
BEGIN
  SELECT MAX(value::NUMERIC) FILTER (WHERE key = v_pre || '.base_fare'),
         MAX(value::NUMERIC) FILTER (WHERE key = v_pre || '.per_km_rate'),
         MAX(value::NUMERIC) FILTER (WHERE key = v_pre || '.minimum_fare')
    INTO v_base, v_per, v_min
    FROM public.mbg_platform_settings
   WHERE key IN (v_pre || '.base_fare', v_pre || '.per_km_rate', v_pre || '.minimum_fare') AND value ~ '^[0-9]+(\.[0-9]+)?$';
  -- the same defaults the booking engine falls back to
  v_base := COALESCE(v_base, CASE WHEN v_pre = 'cargo' THEN 5000 ELSE 1000 END);
  v_per  := COALESCE(v_per,  CASE WHEN v_pre = 'cargo' THEN 2000 ELSE 1000 END);
  v_min  := COALESCE(v_min,  CASE WHEN v_pre = 'cargo' THEN 0 ELSE 2000 END);

  FOR i IN 0..v_n - 2 LOOP
    v_km := public.era__haversine_km((p_points -> i ->> 0)::NUMERIC, (p_points -> i ->> 1)::NUMERIC,
                                     (p_points -> (i + 1) ->> 0)::NUMERIC, (p_points -> (i + 1) ->> 1)::NUMERIC);
    IF v_km > 300 THEN RAISE EXCEPTION 'Leg % is % km. A single ground leg can be at most 300 km.', i + 1, round(v_km) USING ERRCODE = '22023'; END IF;
    v_min_leg := v_min;
    v_fare := round(GREATEST(v_min_leg, v_base + v_km * v_per) * v_mult / 100) * 100;
    v_total := v_total + v_fare; v_dist := v_dist + v_km;
    v_legs := v_legs || jsonb_build_object(
      'leg', i + 1,
      'from', jsonb_build_object('lat', (p_points -> i ->> 0)::NUMERIC, 'lng', (p_points -> i ->> 1)::NUMERIC),
      'to', jsonb_build_object('lat', (p_points -> (i + 1) ->> 0)::NUMERIC, 'lng', (p_points -> (i + 1) ->> 1)::NUMERIC),
      'distance_km', round(v_km, 2), 'duration_min', GREATEST(2, round(v_km / 25 * 60)), 'fare_ugx', v_fare);
    v_dur := v_dur + GREATEST(2, round(v_km / 25 * 60))::INTEGER;
  END LOOP;

  RETURN jsonb_build_object(
    'kind', p_kind, 'currency', 'UGX', 'priced_for', p_at,
    'time_multiplier', v_mult, 'multiplier_reason', public.era__multiplier_reason(p_at),
    'legs', v_legs, 'distance_km', round(v_dist, 2), 'duration_min', v_dur,
    'total_ugx', v_total, 'total_ican', CASE WHEN v_ican > 0 THEN round(v_total / v_ican, 4) END, 'ican_price_ugx', v_ican,
    'valid_for_minutes', 15,
    'notes', jsonb_build_array(
      'Distances are straight-line, the same way the booking engine measures them.',
      'The final fare is set when a rider is chosen: VIP, discount and return-trip riders adjust it.',
      'Ground legs only. Flights and ship cargo are quoted inside the BodaGoEra app.'));
END;
$$;

-- Expiry bands and the clearance ladder.
CREATE OR REPLACE FUNCTION public.era__expiry_band(p_days INTEGER) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_days IS NULL THEN 'no_expiry' WHEN p_days < 0 THEN 'expired' WHEN p_days <= 7 THEN 'critical'
              WHEN p_days <= 30 THEN 'soon' ELSE 'ok' END
$$;

CREATE OR REPLACE FUNCTION public.era__clearance_pct(p_days INTEGER) RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_days IS NULL THEN 0 WHEN p_days < 0 THEN 100 WHEN p_days <= 3 THEN 50 WHEN p_days <= 7 THEN 30
              WHEN p_days <= 14 THEN 20 WHEN p_days <= 30 THEN 10 ELSE 0 END
$$;

-- Today in Kampala (expiry dates are calendar dates).
CREATE OR REPLACE FUNCTION public.era__today() RETURNS DATE
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Africa/Kampala')::DATE $$;

-- Straight-line or declining-balance book value of an asset.
CREATE OR REPLACE FUNCTION public.era__book_value(p_cost NUMERIC, p_salvage NUMERIC, p_life INTEGER, p_acquired DATE, p_method TEXT)
RETURNS NUMERIC LANGUAGE plpgsql STABLE AS $$
DECLARE v_age NUMERIC; v_salv NUMERIC := COALESCE(p_salvage, 0);
BEGIN
  IF p_cost IS NULL THEN RETURN NULL; END IF;
  IF p_life IS NULL OR p_life <= 0 OR p_acquired IS NULL THEN RETURN p_cost; END IF;
  v_age := GREATEST((public.era__today() - p_acquired) / 365.25, 0);
  IF lower(COALESCE(p_method, '')) LIKE '%declin%' THEN
    RETURN round(GREATEST(v_salv, p_cost * power(1 - LEAST(2.0 / p_life, 1), v_age)), 2);
  END IF;
  RETURN round(GREATEST(v_salv, p_cost - (p_cost - v_salv) * LEAST(v_age / p_life, 1)), 2);
END;
$$;

-- Products of the business's stores with stock and expiry worked out. All the inventory endpoints read this.
CREATE OR REPLACE FUNCTION public.era__biz_stock(p_business UUID)
RETURNS TABLE (product_id UUID, name TEXT, sku TEXT, barcode TEXT, category TEXT, unit TEXT, stock NUMERIC, reserved NUMERIC,
               available NUMERIC, reorder_at NUMERIC, low_stock BOOLEAN, out_of_stock BOOLEAN, expiry_date DATE,
               days_to_expiry INTEGER, expiry_status TEXT, selling_price NUMERIC, cost_price NUMERIC,
               stock_value_at_cost NUMERIC, batches INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH sm AS (SELECT s AS id FROM public.era__biz_supermarkets(p_business) s),
  batch AS (
    SELECT b.product_id AS pid,
           MIN(b.expiry_date) FILTER (WHERE b.current_stock > 0 AND COALESCE(b.status, 'active') NOT IN ('withdrawn', 'disposed')) AS next_expiry,
           SUM(b.current_stock) FILTER (WHERE COALESCE(b.status, 'active') NOT IN ('withdrawn', 'disposed')) AS batch_stock,
           COUNT(*) FILTER (WHERE b.current_stock > 0 AND COALESCE(b.status, 'active') NOT IN ('withdrawn', 'disposed')) AS live_batches
      FROM public.product_inventory_batches b WHERE b.supermarket_id IN (SELECT id FROM sm) GROUP BY b.product_id),
  base AS (
    SELECT p.id AS pid, p.name AS pname, p.sku::TEXT AS psku, p.barcode AS pbarcode, p.category AS pcat, p.unit AS punit,
           COALESCE(inv.cs, bt.batch_stock, 0) AS stk, COALESCE(inv.rs, 0) AS rsv,
           COALESCE(inv.rp, inv.ms, p.reorder_level) AS rorder,
           COALESCE(bt.next_expiry, p.expiry_date) AS exp, COALESCE(bt.live_batches, 0)::INTEGER AS nb,
           p.selling_price AS sp, p.cost_price AS cp
      FROM public.products p
      LEFT JOIN LATERAL (SELECT SUM(COALESCE(i.current_stock, i.quantity)) AS cs, SUM(i.reserved_stock) AS rs,
                                MAX(i.reorder_point) AS rp, MAX(i.minimum_stock) AS ms
                           FROM public.inventory i WHERE i.product_id = p.id AND i.supermarket_id = p.supermarket_id) inv ON TRUE
      LEFT JOIN batch bt ON bt.pid = p.id
     WHERE p.supermarket_id IN (SELECT id FROM sm) AND p.is_active IS NOT FALSE
       AND COALESCE(p.is_service, FALSE) = FALSE AND COALESCE(p.track_inventory, TRUE))
  SELECT pid, pname, psku, pbarcode, pcat, punit, stk, rsv, GREATEST(stk - rsv, 0),
         rorder, (rorder IS NOT NULL AND GREATEST(stk - rsv, 0) <= rorder AND stk > 0), (stk <= 0),
         exp, CASE WHEN exp IS NULL THEN NULL ELSE (exp - public.era__today()) END,
         public.era__expiry_band(CASE WHEN exp IS NULL THEN NULL ELSE (exp - public.era__today()) END),
         sp, cp, round(COALESCE(stk, 0) * COALESCE(cp, 0), 2), nb
    FROM base
$$;

-- Batch- and product-level lines that carry an expiry date, with clearance advice. FEFO order is the caller's ORDER BY.
CREATE OR REPLACE FUNCTION public.era__biz_expiring(p_business UUID)
RETURNS TABLE (product_id UUID, name TEXT, sku TEXT, category TEXT, unit TEXT, batch_number TEXT, expiry_date DATE, days_left INTEGER,
               expiry_status TEXT, stock NUMERIC, unit_cost NUMERIC, selling_price NUMERIC, value_at_risk NUMERIC,
               discount_pct INTEGER, suggested_price NUMERIC, action TEXT, clearance_published BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH sm AS (SELECT s AS id FROM public.era__biz_supermarkets(p_business) s),
  lines AS (
    SELECT p.id AS pid, p.name AS pname, p.sku::TEXT AS psku, p.category AS pcat, p.unit AS punit, b.batch_number AS bn,
           b.expiry_date AS ex, b.current_stock AS stk, COALESCE(b.purchase_price, p.cost_price) AS uc,
           COALESCE(b.selling_price, p.selling_price) AS sp, (p.clearance_published_at IS NOT NULL) AS pub
      FROM public.product_inventory_batches b JOIN public.products p ON p.id = b.product_id
     WHERE b.supermarket_id IN (SELECT id FROM sm) AND b.current_stock > 0 AND b.expiry_date IS NOT NULL
       AND COALESCE(b.status, 'active') NOT IN ('withdrawn', 'disposed') AND p.is_active IS NOT FALSE
    UNION ALL
    SELECT p.id, p.name, p.sku::TEXT, p.category, p.unit, NULL, p.expiry_date,
           COALESCE(inv.cs, 0), p.cost_price, p.selling_price, (p.clearance_published_at IS NOT NULL)
      FROM public.products p
      LEFT JOIN LATERAL (SELECT SUM(COALESCE(i.current_stock, i.quantity)) AS cs FROM public.inventory i
                          WHERE i.product_id = p.id AND i.supermarket_id = p.supermarket_id) inv ON TRUE
     WHERE p.supermarket_id IN (SELECT id FROM sm) AND p.expiry_date IS NOT NULL AND p.is_active IS NOT FALSE
       AND COALESCE(inv.cs, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM public.product_inventory_batches b2
                        WHERE b2.product_id = p.id AND b2.current_stock > 0 AND b2.expiry_date IS NOT NULL
                          AND COALESCE(b2.status, 'active') NOT IN ('withdrawn', 'disposed'))),
  calc AS (SELECT l.*, (l.ex - public.era__today()) AS dl FROM lines l)
  SELECT pid, pname, psku, pcat, punit, bn, ex, dl, public.era__expiry_band(dl), stk, uc, sp,
         round(stk * COALESCE(uc, 0), 2), public.era__clearance_pct(dl),
         CASE WHEN public.era__clearance_pct(dl) IN (0, 100) OR sp IS NULL THEN NULL
              ELSE GREATEST(COALESCE(uc, 0),
                            CASE WHEN sp >= 1000 THEN round(sp * (1 - public.era__clearance_pct(dl) / 100.0) / 100) * 100
                                 ELSE round(sp * (1 - public.era__clearance_pct(dl) / 100.0), 2) END) END,
         CASE WHEN dl < 0 THEN 'withdraw' WHEN public.era__clearance_pct(dl) > 0 THEN 'discount' ELSE 'monitor' END,
         pub
    FROM calc
$$;

-- ============================================================================ ICANERA: coin creation and valuation, chain

-- How the ICAN price is made, step by step. The same formula the platform's price engine uses, with its inputs shown.
CREATE OR REPLACE FUNCTION public.era_h_icanera_coin_valuation(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_floor NUMERIC := 5000;
  v_init NUMERIC := 3700; v_curr NUMERIC := 3700; v_usd_cpi NUMERIC := 0; v_ugx_cpi NUMERIC := 0;
  v_anchor TIMESTAMPTZ := '2026-01-01T00:00:00Z';
  v_years NUMERIC; v_base_usd NUMERIC; v_fx_floor NUMERIC; v_usd_leg NUMERIC; v_ugx_leg NUMERIC; v_fair NUMERIC;
  v_tx BIGINT := 0; v_vol NUMERIC := 0; v_holders BIGINT := 0;
  m RECORD;
BEGIN
  IF p_sandbox THEN
    RETURN jsonb_build_object(
      'asset', 'ICAN', 'method', 'floor + FX protection + inflation, whichever protects holders more',
      'floor_ugx', 5000, 'floor_usd_value', 1.351351, 'ugx_per_usd_at_launch', 3700, 'ugx_per_usd_now', 3987,
      'fx_adjusted_floor_ugx', 5387.84, 'usd_inflation_pct', 3.1, 'ugx_inflation_pct', 4.9, 'years_since_anchor', 0.76,
      'usd_leg_ugx', 5516.2, 'ugx_leg_ugx', 5185.9, 'fair_price_ugx', 5516.2, 'fair_price_usd', 1.3835,
      'market_price_ugx', 5508.42, 'market_vs_fair_pct', -0.14,
      'activity', jsonb_build_object('completed_transactions', 272, 'volume_ican', 1840.5, 'holders', 37),
      'as_of', now(), 'source', 'sandbox-fixture');
  END IF;

  SELECT COALESCE(initial_rate_to_ugx, rate_to_ugx, 3700) AS i, COALESCE(rate_to_ugx, 3700) AS c,
         GREATEST(COALESCE(local_inflation_pct, 0), 0) AS cpi, COALESCE(stability_anchor_at, v_anchor) AS a INTO m
    FROM public.ican_currency_rates WHERE currency_code = 'USD' LIMIT 1;
  IF FOUND THEN v_init := m.i; v_curr := m.c; v_usd_cpi := m.cpi; v_anchor := m.a; END IF;
  IF v_init <= 0 THEN v_init := 3700; END IF;
  IF v_curr <= 0 THEN v_curr := v_init; END IF;
  SELECT GREATEST(COALESCE(local_inflation_pct, 0), 0) INTO v_ugx_cpi FROM public.ican_currency_rates WHERE currency_code = 'UGX' LIMIT 1;

  v_years := GREATEST(0, extract(epoch FROM (now() - v_anchor)) / 31557600.0);
  v_base_usd := v_floor / v_init;
  v_fx_floor := v_base_usd * v_curr;
  v_usd_leg := v_fx_floor * power(1 + COALESCE(v_usd_cpi, 0) / 100.0, v_years);
  v_ugx_leg := v_floor * power(1 + COALESCE(v_ugx_cpi, 0) / 100.0, v_years);
  v_fair := GREATEST(v_usd_leg, v_ugx_leg);

  SELECT COUNT(*), COALESCE(SUM(ican_amount), 0) INTO v_tx, v_vol FROM public.ican_coin_transactions WHERE status IN ('completed', 'confirmed', 'success');
  SELECT COUNT(*) INTO v_holders FROM public.user_accounts WHERE COALESCE(ican_coin_balance, 0) > 0;

  RETURN jsonb_build_object(
    'asset', 'ICAN', 'method', 'floor + FX protection + inflation, whichever protects holders more',
    'floor_ugx', v_floor, 'floor_usd_value', round(v_base_usd, 6), 'ugx_per_usd_at_launch', round(v_init, 2), 'ugx_per_usd_now', round(v_curr, 2),
    'fx_adjusted_floor_ugx', round(v_fx_floor, 2), 'usd_inflation_pct', v_usd_cpi, 'ugx_inflation_pct', COALESCE(v_ugx_cpi, 0),
    'years_since_anchor', round(v_years, 4), 'usd_leg_ugx', round(v_usd_leg, 2), 'ugx_leg_ugx', round(v_ugx_leg, 2),
    'fair_price_ugx', round(v_fair, 2), 'fair_price_usd', round(v_fair / v_curr, 6),
    'market_price_ugx', public.era__ican_price_ugx(),
    'market_vs_fair_pct', CASE WHEN public.era__ican_price_ugx() IS NOT NULL THEN round((public.era__ican_price_ugx() - v_fair) / v_fair * 100, 3) END,
    'activity', jsonb_build_object('completed_transactions', v_tx, 'volume_ican', v_vol, 'holders', v_holders),
    'as_of', now(), 'source', 'derived');
END;
$$;

-- Aggregate supply: nothing per person.
CREATE OR REPLACE FUNCTION public.era_h_icanera_coin_supply(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  IF p_sandbox THEN
    RETURN jsonb_build_object('held_in_wallets', 4521.8, 'holders', 37, 'total_purchased', 5210.3, 'total_sold', 688.5,
      'net_issued_through_platform', 4521.8, 'transactions_30d', jsonb_build_object('purchase', 19, 'transfer', 9, 'sale', 1), 'as_of', now(), 'source', 'sandbox-fixture');
  END IF;
  SELECT COALESCE(SUM(ican_coin_balance), 0) AS held, COUNT(*) FILTER (WHERE COALESCE(ican_coin_balance, 0) > 0) AS holders,
         COALESCE(SUM(ican_coin_total_purchased), 0) AS bought, COALESCE(SUM(ican_coin_total_sold), 0) AS sold INTO r
    FROM public.user_accounts;
  RETURN jsonb_build_object(
    'held_in_wallets', r.held, 'holders', r.holders, 'total_purchased', r.bought, 'total_sold', r.sold,
    'net_issued_through_platform', r.bought - r.sold,
    'transactions_30d', COALESCE((SELECT jsonb_object_agg(t, n) FROM (
        SELECT COALESCE(type, transaction_type, 'other') AS t, COUNT(*) AS n FROM public.ican_coin_transactions
         WHERE status IN ('completed', 'confirmed', 'success') AND COALESCE(timestamp, created_at) > now() - INTERVAL '30 days' GROUP BY 1) x), '{}'::JSONB),
    'as_of', now(), 'source', 'derived');
END;
$$;

-- Convert between ICAN and a currency at the live price. Indicative: the platform's fee or spread applies when buying or selling.
CREATE OR REPLACE FUNCTION public.era_h_icanera_coin_convert(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from TEXT := upper(COALESCE(public.era_p_text(p, 'from', 12), ''));
  v_to TEXT := upper(COALESCE(public.era_p_text(p, 'to', 12), ''));
  v_amt NUMERIC := public.era_p_num(p, 'amount', 0.00000001, 1000000000, TRUE);
  v_cur TEXT; v_ugx_per NUMERIC; v_price_cur NUMERIC; v_ican_ugx NUMERIC; v_out NUMERIC;
  v_fx JSONB := '{"USD":3987.0,"EUR":4485.0,"GBP":5275.0,"KES":30.8,"UGX":1,"NGN":2.6,"ZAR":218.0,"JPY":25.3}';
BEGIN
  IF (v_from = 'ICAN') = (v_to = 'ICAN') THEN
    RAISE EXCEPTION 'Exactly one of from / to must be ICAN, and the other a 3-letter currency such as UGX.' USING ERRCODE = '22023';
  END IF;
  v_cur := CASE WHEN v_from = 'ICAN' THEN v_to ELSE v_from END;
  IF v_cur !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'The currency must be a 3-letter code such as UGX or USD.' USING ERRCODE = '22023'; END IF;

  IF p_sandbox THEN
    IF NOT (v_fx ? v_cur) THEN RAISE EXCEPTION 'No ICAN price for %. Sandbox knows USD, EUR, GBP, KES, UGX, NGN, ZAR, JPY.', v_cur USING ERRCODE = 'P0002'; END IF;
    v_ican_ugx := 5508.42; v_ugx_per := (v_fx ->> v_cur)::NUMERIC;
  ELSE
    v_ican_ugx := public.era__ican_price_ugx();
    v_ugx_per := public.era__ugx_per(v_cur);
    IF v_ican_ugx IS NULL OR v_ugx_per IS NULL THEN RAISE EXCEPTION 'No ICAN price for currency %.', v_cur USING ERRCODE = 'P0002'; END IF;
  END IF;
  v_price_cur := v_ican_ugx / v_ugx_per;
  v_out := CASE WHEN v_from = 'ICAN' THEN v_amt * v_price_cur ELSE v_amt / v_price_cur END;
  RETURN jsonb_build_object('from', v_from, 'to', v_to, 'amount', v_amt, 'result', round(v_out, 8),
    'price', jsonb_build_object('currency', v_cur, 'per_ican', round(v_price_cur, 6)), 'as_of', now(),
    'note', 'Indicative. A fee or spread applies when you actually buy or sell ICAN.');
END;
$$;

-- Network fee estimate. Honest by construction: gas UNITS are typical figures, the gas price and coin price are what an
-- administrator last entered (shown with their age). ICAN-to-ICAN transfers inside the platform do not pay gas.
CREATE OR REPLACE FUNCTION public.era_h_icanera_chain_gas(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_net TEXT := lower(COALESCE(public.era_p_text(p, 'network', 30), 'ethereum'));
  v_op TEXT := lower(public.era_p_text(p, 'operation', 30));
  v_ops JSONB; v_out JSONB := '[]'::JSONB; o RECORD; v_sym TEXT := 'ETH'; v_updated TIMESTAMPTZ;
  v_gwei NUMERIC; v_usd NUMERIC; v_ican_usd NUMERIC; v_native NUMERIC; v_fee_usd NUMERIC; v_state TEXT; v_age NUMERIC;
BEGIN
  v_ops := '[{"operation":"native_transfer","units":21000,"what":"Send the native coin (e.g. ETH)"},
             {"operation":"token_transfer","units":65000,"what":"Send an ERC-20 token such as ICAN"},
             {"operation":"token_approve","units":46000,"what":"Approve a contract to spend a token"},
             {"operation":"contract_call","units":120000,"what":"A typical contract interaction"},
             {"operation":"contract_deploy","units":1500000,"what":"Deploy a small contract"}]'::JSONB;
  IF v_op IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ops) e WHERE e ->> 'operation' = v_op) THEN
    RAISE EXCEPTION 'operation must be one of native_transfer, token_transfer, token_approve, contract_call, contract_deploy' USING ERRCODE = '22023';
  END IF;

  IF p_sandbox THEN
    v_gwei := 18; v_usd := 3100; v_ican_usd := 1.3815; v_state := 'configured'; v_age := 2.5;
  ELSE
    SELECT native_symbol, gas_price_gwei, native_usd, updated_at INTO v_sym, v_gwei, v_usd, v_updated
      FROM public.era_api_chain_config WHERE network = v_net;
    IF NOT FOUND THEN RAISE EXCEPTION 'No fee data for network %.', v_net USING ERRCODE = 'P0002'; END IF;
    v_age := round(extract(epoch FROM (now() - v_updated)) / 3600, 1);
    v_state := CASE WHEN v_gwei IS NULL OR v_usd IS NULL THEN 'unconfigured' WHEN v_age > 24 THEN 'stale' ELSE 'configured' END;
    SELECT price_usd INTO v_ican_usd FROM public.ican_coin_market_prices ORDER BY timestamp DESC LIMIT 1;
  END IF;

  FOR o IN SELECT e ->> 'operation' AS op, (e ->> 'units')::BIGINT AS units, e ->> 'what' AS what FROM jsonb_array_elements(v_ops) e
            WHERE v_op IS NULL OR e ->> 'operation' = v_op LOOP
    v_native := CASE WHEN v_gwei IS NULL THEN NULL ELSE o.units * v_gwei / 1e9 END;
    v_fee_usd := CASE WHEN v_native IS NULL OR v_usd IS NULL THEN NULL ELSE v_native * v_usd END;
    v_out := v_out || jsonb_build_object('operation', o.op, 'what', o.what, 'gas_units', o.units,
      'fee_native', CASE WHEN v_native IS NULL THEN NULL ELSE round(v_native, 8) END,
      'fee_usd', CASE WHEN v_fee_usd IS NULL THEN NULL ELSE round(v_fee_usd, 4) END,
      'fee_ican', CASE WHEN v_fee_usd IS NULL OR v_ican_usd IS NULL OR v_ican_usd <= 0 THEN NULL ELSE round(v_fee_usd / v_ican_usd, 6) END);
  END LOOP;

  RETURN jsonb_build_object('network', v_net, 'native_symbol', v_sym, 'state', v_state,
    'gas_price_gwei', v_gwei, 'native_usd', v_usd, 'inputs_age_hours', v_age, 'estimates', v_out,
    'confidence', 'estimate',
    'notes', jsonb_build_array(
      'An estimate: real gas depends on the network at the moment you send.',
      'ICAN-to-ICAN transfers inside the platform are ledger entries anchored in the integrity chain and pay no gas.',
      CASE WHEN v_state = 'unconfigured' THEN 'The platform team has not entered a gas price yet, so only the gas units are shown.'
           WHEN v_state = 'stale' THEN 'The gas price is more than 24 hours old.' ELSE 'Gas price entered by the platform team.' END));
END;
$$;

-- The integrity chain: every recorded ICAN event is hash-linked to the one before it, so tampering is detectable.
CREATE OR REPLACE FUNCTION public.era_h_icanera_chain_head(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  IF p_sandbox THEN
    RETURN jsonb_build_object('seq', 1358, 'chain_hash', repeat('ab', 32), 'events', 1239, 'created_at', now(), 'source', 'sandbox-fixture');
  END IF;
  SELECT seq, chain_hash, created_at INTO r FROM public.icaneracoin_integrity_chain ORDER BY seq DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'The integrity chain is empty.' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object('seq', r.seq, 'chain_hash', r.chain_hash, 'events', (SELECT COUNT(*) FROM public.icaneracoin_integrity_chain), 'created_at', r.created_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_icanera_chain_proof(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_seq BIGINT; r RECORD; v_prev RECORD;
BEGIN
  IF COALESCE(p ->> 'seq', '') !~ '^[0-9]{1,12}$' THEN RAISE EXCEPTION 'seq must be a whole number' USING ERRCODE = '22023'; END IF;
  v_seq := (p ->> 'seq')::BIGINT;
  IF p_sandbox THEN
    RETURN jsonb_build_object('seq', v_seq, 'event_type', 'transfer', 'created_at', now(), 'previous_seq', v_seq - 1,
      'previous_hash', repeat('cd', 32), 'chain_hash', repeat('ef', 32), 'links_to_previous', TRUE, 'source', 'sandbox-fixture');
  END IF;
  SELECT seq, event_type, created_at, previous_hash, chain_hash INTO r FROM public.icaneracoin_integrity_chain WHERE seq = v_seq;
  IF NOT FOUND THEN RAISE EXCEPTION 'No event with seq %.', v_seq USING ERRCODE = 'P0002'; END IF;
  SELECT seq, chain_hash INTO v_prev FROM public.icaneracoin_integrity_chain WHERE seq < v_seq ORDER BY seq DESC LIMIT 1;
  -- only the hashes and the event type are shown: never the underlying record
  RETURN jsonb_build_object('seq', r.seq, 'event_type', r.event_type, 'created_at', r.created_at,
    'previous_seq', v_prev.seq, 'previous_hash', r.previous_hash, 'chain_hash', r.chain_hash,
    'links_to_previous', v_prev.seq IS NULL OR v_prev.chain_hash = r.previous_hash);
END;
$$;

-- ============================================================================ BODAGOERA: journey and delivery quotes

-- Replaces the v1 fare estimate with the real formula (time-of-day multiplier, rounded to 100).
CREATE OR REPLACE FUNCTION public.era_h_bodagoera_fare_estimate(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_km NUMERIC := public.era_p_num(p, 'km', 0.1, 300, TRUE);
  v_kind TEXT := lower(COALESCE(public.era_p_text(p, 'kind', 12), 'ride'));
  v_at TIMESTAMPTZ := now();
  v_pre TEXT; v_base NUMERIC; v_per NUMERIC; v_min NUMERIC; v_mult NUMERIC; v_fare NUMERIC;
BEGIN
  IF v_kind NOT IN ('ride', 'cargo') THEN RAISE EXCEPTION 'kind must be ride or cargo' USING ERRCODE = '22023'; END IF;
  IF COALESCE(p ->> 'at', '') <> '' THEN
    BEGIN v_at := (p ->> 'at')::TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'at must be an ISO date-time such as 2026-10-06T08:30:00+03:00' USING ERRCODE = '22023'; END;
  END IF;
  v_pre := v_kind;
  IF p_sandbox THEN
    v_base := CASE v_kind WHEN 'ride' THEN 1000 ELSE 5000 END; v_per := CASE v_kind WHEN 'ride' THEN 1000 ELSE 2000 END;
    v_min := CASE v_kind WHEN 'ride' THEN 2000 ELSE 0 END;
  ELSE
    SELECT MAX(value::NUMERIC) FILTER (WHERE key = v_pre || '.base_fare'), MAX(value::NUMERIC) FILTER (WHERE key = v_pre || '.per_km_rate'),
           MAX(value::NUMERIC) FILTER (WHERE key = v_pre || '.minimum_fare')
      INTO v_base, v_per, v_min FROM public.mbg_platform_settings
     WHERE key IN (v_pre || '.base_fare', v_pre || '.per_km_rate', v_pre || '.minimum_fare') AND value ~ '^[0-9]+(\.[0-9]+)?$';
    v_base := COALESCE(v_base, CASE WHEN v_kind = 'cargo' THEN 5000 ELSE 1000 END);
    v_per := COALESCE(v_per, CASE WHEN v_kind = 'cargo' THEN 2000 ELSE 1000 END);
    v_min := COALESCE(v_min, CASE WHEN v_kind = 'cargo' THEN 0 ELSE 2000 END);
  END IF;
  v_mult := public.era__time_multiplier(v_at);
  v_fare := round(GREATEST(COALESCE(v_min, 0), v_base + v_per * v_km) * v_mult / 100) * 100;
  RETURN jsonb_build_object('kind', v_kind, 'distance_km', v_km, 'currency', 'UGX', 'estimated_fare', v_fare,
    'priced_for', v_at, 'time_multiplier', v_mult, 'multiplier_reason', public.era__multiplier_reason(v_at),
    'breakdown', jsonb_build_object('base_fare', v_base, 'per_km_rate', v_per, 'minimum_fare', v_min),
    'note', 'The booking engine''s own formula. VIP, discount and return-trip riders adjust the final fare.');
END;
$$;

-- A priced journey or delivery between two or more points.
CREATE OR REPLACE FUNCTION public.era_h_bodagoera_journey_quote(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kind TEXT := lower(COALESCE(public.era_p_text(p, 'kind', 12), 'ride'));
  v_pts JSONB := '[]'::JSONB; v_at TIMESTAMPTZ := now(); s TEXT; pt NUMERIC[];
BEGIN
  IF v_kind NOT IN ('ride', 'delivery', 'cargo') THEN RAISE EXCEPTION 'kind must be ride, delivery or cargo' USING ERRCODE = '22023'; END IF;
  pt := public.era__point(p ->> 'from', 'from'); v_pts := v_pts || jsonb_build_array(jsonb_build_array(pt[1], pt[2]));
  IF COALESCE(p ->> 'stops', '') <> '' THEN
    IF array_length(string_to_array(p ->> 'stops', '|'), 1) > 3 THEN RAISE EXCEPTION 'At most 3 stops are allowed.' USING ERRCODE = '22023'; END IF;
    FOREACH s IN ARRAY string_to_array(p ->> 'stops', '|') LOOP
      pt := public.era__point(s, 'stops'); v_pts := v_pts || jsonb_build_array(jsonb_build_array(pt[1], pt[2]));
    END LOOP;
  END IF;
  pt := public.era__point(p ->> 'to', 'to'); v_pts := v_pts || jsonb_build_array(jsonb_build_array(pt[1], pt[2]));
  IF COALESCE(p ->> 'at', '') <> '' THEN
    BEGIN v_at := (p ->> 'at')::TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'at must be an ISO date-time such as 2026-10-06T08:30:00+03:00' USING ERRCODE = '22023'; END;
    IF v_at < now() - INTERVAL '1 hour' OR v_at > now() + INTERVAL '14 days' THEN
      RAISE EXCEPTION 'at must be within the next 14 days.' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN public.era__quote(v_pts, v_kind, v_at);
END;
$$;

-- ============================================================================ SUPERMARKETERA: products across every category

CREATE OR REPLACE FUNCTION public.era_h_supermarketera_products(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_q TEXT := public.era_p_text(p, 'q', 60); v_cat TEXT := public.era_p_text(p, 'category', 60);
  v_store TEXT := public.era_p_text(p, 'store', 60);
  v_limit INTEGER := public.era_p_int(p, 'limit', 25, 1, 100); v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 100000);
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"id":"8e1d0000-0000-4000-8000-000000000001","name":"Sliced Bread 600g","category":"Bakery","brand":"Daily Loaf","unit":"loaf","price":4800,"currency":"UGX","barcode":"6001234567890","store":"Kampala Fresh Mart","city":"Kampala","expiry_date":null,"clearance":null},
        {"id":"8e1d0000-0000-4000-8000-000000000002","name":"Fresh Milk 1L","category":"Dairy","brand":"Farm Gold","unit":"litre","price":3200,"currency":"UGX","barcode":"6009988776655","store":"Kampala Fresh Mart","city":"Kampala","expiry_date":"2026-10-12","clearance":{"original_price":4000}},
        {"id":"8e1d0000-0000-4000-8000-000000000003","name":"Cooking Gas 6kg refill","category":"Household","brand":"SafeGas","unit":"cylinder","price":68000,"currency":"UGX","barcode":null,"store":"Entebbe Corner Shop","city":"Entebbe","expiry_date":null,"clearance":null}]'::JSONB)
        AS t(id UUID, name TEXT, category TEXT, brand TEXT, unit TEXT, price NUMERIC, currency TEXT, barcode TEXT, store TEXT, city TEXT, expiry_date DATE, clearance JSONB)
       WHERE (v_q IS NULL OR name ILIKE public.era_p_like(v_q)) AND (v_cat IS NULL OR category ILIKE v_cat) AND (v_store IS NULL OR store ILIKE public.era_p_like(v_store))) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT pr.id, pr.name, pr.category, pr.brand, pr.unit, pr.selling_price AS price, COALESCE(s.price_currency, 'UGX') AS currency,
           pr.barcode, pr.image_url, pr.expiry_date, s.name AS store, s.city,
           CASE WHEN pr.clearance_published_at IS NOT NULL THEN jsonb_build_object('original_price', pr.clearance_original_price, 'published_at', pr.clearance_published_at) END AS clearance
      FROM public.products pr JOIN public.supermarkets s ON s.id = pr.supermarket_id
     WHERE pr.is_active IS NOT FALSE AND COALESCE(pr.is_service, FALSE) = FALSE AND pr.selling_price IS NOT NULL
       AND s.is_active IS NOT FALSE AND COALESCE(s.status, 'active') NOT IN ('suspended', 'rejected', 'pending')
       AND (pr.expiry_date IS NULL OR pr.expiry_date >= public.era__today())
       AND (v_q IS NULL OR pr.name ILIKE public.era_p_like(v_q) OR pr.brand ILIKE public.era_p_like(v_q))
       AND (v_cat IS NULL OR pr.category ILIKE v_cat) AND (v_store IS NULL OR s.name ILIKE public.era_p_like(v_store))
     ORDER BY pr.name LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

-- Deals the stores have published: reduced prices on stock approaching its expiry date.
CREATE OR REPLACE FUNCTION public.era_h_supermarketera_clearance(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_city TEXT := public.era_p_text(p, 'city', 60); v_cat TEXT := public.era_p_text(p, 'category', 60);
  v_limit INTEGER := public.era_p_int(p, 'limit', 25, 1, 100); v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 100000);
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"name":"Fresh Milk 1L","category":"Dairy","store":"Kampala Fresh Mart","city":"Kampala","price":3200,"original_price":4000,"discount_pct":20,"expiry_date":"2026-10-12","days_to_expiry":6,"currency":"UGX"},
        {"name":"Yoghurt 500ml","category":"Dairy","store":"Entebbe Corner Shop","city":"Entebbe","price":1800,"original_price":2500,"discount_pct":28,"expiry_date":"2026-10-09","days_to_expiry":3,"currency":"UGX"}]'::JSONB)
        AS t(name TEXT, category TEXT, store TEXT, city TEXT, price NUMERIC, original_price NUMERIC, discount_pct INTEGER, expiry_date DATE, days_to_expiry INTEGER, currency TEXT)
       WHERE (v_city IS NULL OR city ILIKE v_city) AND (v_cat IS NULL OR category ILIKE v_cat)) x), '[]'::JSONB);
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT pr.name, pr.category, s.name AS store, s.city, pr.selling_price AS price, pr.clearance_original_price AS original_price,
           CASE WHEN pr.clearance_original_price > 0 THEN round((1 - pr.selling_price / pr.clearance_original_price) * 100)::INTEGER END AS discount_pct,
           pr.expiry_date, CASE WHEN pr.expiry_date IS NOT NULL THEN pr.expiry_date - public.era__today() END AS days_to_expiry,
           COALESCE(s.price_currency, 'UGX') AS currency
      FROM public.products pr JOIN public.supermarkets s ON s.id = pr.supermarket_id
     WHERE pr.clearance_published_at IS NOT NULL AND pr.is_active IS NOT FALSE AND pr.selling_price IS NOT NULL
       AND s.is_active IS NOT FALSE AND COALESCE(s.status, 'active') NOT IN ('suspended', 'rejected', 'pending')
       AND (pr.expiry_date IS NULL OR pr.expiry_date >= public.era__today())
       AND (v_city IS NULL OR s.city ILIKE v_city) AND (v_cat IS NULL OR pr.category ILIKE v_cat)
     ORDER BY pr.expiry_date NULLS LAST, pr.name LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

-- Every category on the platform, wholesale catalogue and storefront shelves together.
CREATE OR REPLACE FUNCTION public.era_h_supermarketera_categories(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_sandbox THEN
    RETURN '[{"category":"Bakery","catalogue_items":42,"shelf_products":18},{"category":"Dairy","catalogue_items":31,"shelf_products":26},
             {"category":"Household","catalogue_items":64,"shelf_products":40},{"category":"Personal Care","catalogue_items":88,"shelf_products":35}]'::JSONB;
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.catalogue_items + x.shelf_products DESC, x.category) FROM (
    SELECT COALESCE(c.category, s.category) AS category, COALESCE(c.n, 0) AS catalogue_items, COALESCE(s.n, 0) AS shelf_products
      FROM (SELECT initcap(btrim(category)) AS category, COUNT(*) AS n FROM public.supplier_catalog_items
             WHERE is_available AND category IS NOT NULL GROUP BY 1) c
      FULL JOIN (SELECT initcap(btrim(category)) AS category, COUNT(*) AS n FROM public.products
                  WHERE is_active IS NOT FALSE AND category IS NOT NULL GROUP BY 1) s ON s.category = c.category) x), '[]'::JSONB);
END;
$$;

-- ============================================================================ BUSINESS (private): helper to read the key's business

CREATE OR REPLACE FUNCTION public.era__biz(p JSONB, p_sandbox BOOLEAN) RETURNS UUID
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v UUID;
BEGIN
  IF p_sandbox THEN RETURN NULL; END IF;
  v := NULLIF(p ->> '_business_id', '')::UUID;
  IF v IS NULL THEN RAISE EXCEPTION 'This key is not bound to a business.' USING ERRCODE = '42501'; END IF;
  RETURN v;
END;
$$;

-- ============================================================================ BUSINESS: payment requests

-- Creates a PAYMENT REQUEST (a QR / code). It does not move money: the payer scans it in the ICAN app and approves with their own PIN.
CREATE OR REPLACE FUNCTION public.era_h_business_payment_create(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b JSONB := COALESCE(p -> '_body', '{}'::JSONB);
  v_amount NUMERIC := public.era_p_num(b, 'amount', 0.01, 1000000000, TRUE);
  v_cur TEXT := upper(COALESCE(public.era_p_text(b, 'currency', 8), 'UGX'));
  v_desc TEXT := public.era_p_text(b, 'description', 140);
  v_class TEXT := lower(COALESCE(public.era_p_text(b, 'classification', 12), 'business'));
  v_mins INTEGER := public.era_p_int(b, 'expires_in_minutes', 60, 5, 1440);
  v_ref TEXT := public.era_p_text(b, 'external_ref', 64);
  v_max NUMERIC := NULLIF(p ->> '_max_amount_ugx', '')::NUMERIC;
  v_daily NUMERIC := NULLIF(p ->> '_daily_cap_ugx', '')::NUMERIC;
  v_key UUID := NULLIF(p ->> '_key_id', '')::UUID;
  v_biz UUID; v_owner UUID; v_name TEXT; v_rate NUMERIC; v_ugx NUMERIC; v_code TEXT; v_id BIGINT; v_exp TIMESTAMPTZ;
BEGIN
  IF v_cur NOT IN ('UGX', 'USD', 'KES', 'TZS', 'RWF') THEN RAISE EXCEPTION 'currency must be UGX, USD, KES, TZS or RWF' USING ERRCODE = '22023'; END IF;
  IF v_class NOT IN ('business', 'personal') THEN RAISE EXCEPTION 'classification must be business or personal' USING ERRCODE = '22023'; END IF;
  IF v_ref IS NOT NULL AND v_ref !~ '^[A-Za-z0-9._:-]{1,64}$' THEN RAISE EXCEPTION 'external_ref may only contain letters, digits and . _ : -' USING ERRCODE = '22023'; END IF;
  v_exp := now() + make_interval(mins => v_mins);

  IF p_sandbox THEN
    v_code := 'PAY_SANDBOX' || upper(public.era__rand(8));
    RETURN jsonb_build_object('payment_code', v_code, 'qr_payload', 'ICANPAY:' || v_code, 'amount', v_amount, 'currency', v_cur,
      'status', 'pending', 'expires_at', v_exp, 'description', v_desc, 'external_ref', v_ref, 'recipient', jsonb_build_object('business_name', 'Sample Business Ltd'),
      'sandbox', TRUE, 'next', 'Sandbox request: nothing was created. In live mode the payer scans the QR in the ICAN app and approves with their own PIN.');
  END IF;

  v_biz := public.era__biz(p, FALSE);
  v_owner := NULLIF(p ->> '_owner_user_id', '')::UUID;
  SELECT business_name INTO v_name FROM public.business_profiles WHERE id = v_biz AND user_id = v_owner;
  IF v_name IS NULL THEN RAISE EXCEPTION 'This key is not bound to a valid business.' USING ERRCODE = '42501'; END IF;

  v_rate := public.era__ugx_per(v_cur);
  IF v_rate IS NULL THEN RAISE EXCEPTION 'No exchange rate is available for %, so the cap cannot be checked.', v_cur USING ERRCODE = '22023'; END IF;
  v_ugx := round(v_amount * v_rate, 2);
  IF v_max IS NULL OR v_daily IS NULL THEN RAISE EXCEPTION 'This key has no payment caps and cannot create payment requests.' USING ERRCODE = '42501'; END IF;
  IF v_ugx > v_max THEN
    RAISE EXCEPTION 'That is about % UGX, above this key''s per-request cap of % UGX.', round(v_ugx), round(v_max) USING ERRCODE = 'ERA22';
  END IF;
  IF COALESCE((SELECT SUM(amount_ugx) FROM public.era_api_payment_links WHERE key_id = v_key AND created_at > now() - INTERVAL '24 hours'), 0) + v_ugx > v_daily THEN
    RAISE EXCEPTION 'This key''s daily cap of % UGX would be exceeded.', round(v_daily) USING ERRCODE = 'ERA29';
  END IF;
  -- velocity brake: a leaked key cannot flood a business with requests
  IF (SELECT COUNT(*) FROM public.era_api_payment_links WHERE key_id = v_key AND created_at > now() - INTERVAL '10 minutes') >= 20 THEN
    RAISE EXCEPTION 'Too many payment requests in the last 10 minutes. Wait a little.' USING ERRCODE = 'ERA29';
  END IF;
  IF (SELECT COUNT(*) FROM public.era_api_payment_links l JOIN public.payment_requests r ON r.id = l.payment_request_id
       WHERE l.business_profile_id = v_biz AND r.status = 'pending' AND r.expires_at > now()) >= 100 THEN
    RAISE EXCEPTION 'This business already has 100 open payment requests.' USING ERRCODE = 'ERA29';
  END IF;

  v_code := 'PAY_' || upper(public.era__rand(16));
  INSERT INTO public.payment_requests (user_id, payment_code, amount, currency, description, status, expires_at, payment_method,
                                       recipient_classification, recipient_business_profile_id, recipient_name)
  VALUES (v_owner, v_code, v_amount, v_cur, v_desc, 'pending', v_exp, 'ican', v_class, v_biz, v_name)
  RETURNING id INTO v_id;
  INSERT INTO public.era_api_payment_links (key_id, business_profile_id, payment_request_id, payment_code, amount_ugx, external_ref)
  VALUES (v_key, v_biz, v_id, v_code, v_ugx, v_ref);

  RETURN jsonb_build_object('payment_code', v_code, 'qr_payload', 'ICANPAY:' || v_code, 'amount', v_amount, 'currency', v_cur,
    'status', 'pending', 'expires_at', v_exp, 'description', v_desc, 'external_ref', v_ref,
    'recipient', jsonb_build_object('business_name', v_name),
    'next', 'Show the QR (or the code) to the payer. They scan it in the ICAN app and approve with their own PIN. Nothing moves until they do.');
END;
$$;

CREATE OR REPLACE FUNCTION public.era__payment_row(p_request_id BIGINT, p_ref TEXT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('payment_code', r.payment_code, 'amount', r.amount, 'currency', r.currency, 'description', r.description,
           'status', CASE WHEN r.status = 'pending' AND r.expires_at <= now() THEN 'expired' ELSE r.status END,
           'created_at', r.created_at, 'expires_at', r.expires_at, 'paid_at', r.completed_at, 'external_ref', p_ref)
    FROM public.payment_requests r WHERE r.id = p_request_id
$$;

CREATE OR REPLACE FUNCTION public.era_h_business_payments(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status TEXT := lower(COALESCE(public.era_p_text(p, 'status', 12), 'all'));
  v_limit INTEGER := public.era_p_int(p, 'limit', 25, 1, 100); v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 100000);
  v_biz UUID;
BEGIN
  IF v_status NOT IN ('all', 'pending', 'completed', 'expired') THEN RAISE EXCEPTION 'status must be all, pending, completed or expired' USING ERRCODE = '22023'; END IF;
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"payment_code":"PAY_SANDBOX0000A1","amount":45000,"currency":"UGX","description":"Order #1042","status":"completed","external_ref":"order-1042"},
        {"payment_code":"PAY_SANDBOX0000B2","amount":120000,"currency":"UGX","description":"Invoice 77","status":"pending","external_ref":"inv-77"},
        {"payment_code":"PAY_SANDBOX0000C3","amount":9000,"currency":"UGX","description":"Order #1039","status":"expired","external_ref":"order-1039"}]'::JSONB)
        AS t(payment_code TEXT, amount NUMERIC, currency TEXT, description TEXT, status TEXT, external_ref TEXT)
       WHERE v_status = 'all' OR status = v_status) x), '[]'::JSONB);
  END IF;
  v_biz := public.era__biz(p, FALSE);
  RETURN COALESCE((SELECT jsonb_agg(public.era__payment_row(l.payment_request_id, l.external_ref) ORDER BY l.created_at DESC) FROM (
    SELECT l2.* FROM public.era_api_payment_links l2 JOIN public.payment_requests r ON r.id = l2.payment_request_id
     WHERE l2.business_profile_id = v_biz
       AND (v_status = 'all'
            OR (v_status = 'pending' AND r.status = 'pending' AND r.expires_at > now())
            OR (v_status = 'expired' AND (r.status = 'expired' OR (r.status = 'pending' AND r.expires_at <= now())))
            OR (v_status = 'completed' AND r.status = 'completed'))
     ORDER BY l2.created_at DESC LIMIT v_limit OFFSET v_offset) l), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_business_payment_get(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code TEXT := upper(COALESCE(public.era_p_text(p, 'code', 60), '')); v_biz UUID; l public.era_api_payment_links;
BEGIN
  IF v_code !~ '^PAY_[A-Z0-9_]{4,48}$' THEN RAISE EXCEPTION 'code must look like PAY_ABC123...' USING ERRCODE = '22023'; END IF;
  IF p_sandbox THEN
    RETURN jsonb_build_object('payment_code', v_code, 'amount', 120000, 'currency', 'UGX', 'description', 'Invoice 77', 'status', 'pending', 'external_ref', 'inv-77');
  END IF;
  v_biz := public.era__biz(p, FALSE);
  SELECT * INTO l FROM public.era_api_payment_links WHERE payment_code = v_code AND business_profile_id = v_biz;
  IF NOT FOUND THEN RAISE EXCEPTION 'No payment request % for this business.', v_code USING ERRCODE = 'P0002'; END IF;
  RETURN public.era__payment_row(l.payment_request_id, l.external_ref);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_business_payment_cancel(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code TEXT := upper(COALESCE(public.era_p_text(p, 'code', 60), '')); v_biz UUID; l public.era_api_payment_links; n INTEGER;
BEGIN
  IF v_code !~ '^PAY_[A-Z0-9_]{4,48}$' THEN RAISE EXCEPTION 'code must look like PAY_ABC123...' USING ERRCODE = '22023'; END IF;
  IF p_sandbox THEN RETURN jsonb_build_object('payment_code', v_code, 'status', 'expired', 'cancelled', TRUE, 'sandbox', TRUE); END IF;
  v_biz := public.era__biz(p, FALSE);
  SELECT * INTO l FROM public.era_api_payment_links WHERE payment_code = v_code AND business_profile_id = v_biz;
  IF NOT FOUND THEN RAISE EXCEPTION 'No payment request % for this business.', v_code USING ERRCODE = 'P0002'; END IF;
  UPDATE public.payment_requests SET status = 'expired', updated_at = now() WHERE id = l.payment_request_id AND status = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'Only a pending request can be cancelled. It is already paid or expired.' USING ERRCODE = 'ERA22'; END IF;
  RETURN jsonb_build_object('payment_code', v_code, 'status', 'expired', 'cancelled', TRUE);
END;
$$;

-- ============================================================================ BUSINESS: inventory with expiry tracking

CREATE OR REPLACE FUNCTION public.era_h_business_inventory(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_q TEXT := public.era_p_text(p, 'q', 60); v_cat TEXT := public.era_p_text(p, 'category', 60);
  v_status TEXT := lower(COALESCE(public.era_p_text(p, 'status', 12), 'all'));
  v_limit INTEGER := public.era_p_int(p, 'limit', 50, 1, 200); v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 100000);
  v_biz UUID;
BEGIN
  IF v_status NOT IN ('all', 'low', 'out', 'expiring', 'expired', 'ok') THEN
    RAISE EXCEPTION 'status must be all, low, out, expiring, expired or ok' USING ERRCODE = '22023';
  END IF;
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"name":"Fresh Milk 1L","sku":"MLK-1L","category":"Dairy","unit":"litre","stock":48,"available":44,"reorder_at":20,"low_stock":false,"out_of_stock":false,"expiry_date":"2026-10-12","days_to_expiry":6,"expiry_status":"critical","selling_price":4000,"cost_price":2900,"stock_value_at_cost":139200},
        {"name":"Paracetamol 500mg","sku":"PCM-500","category":"Pharmacy","unit":"strip","stock":12,"available":12,"reorder_at":15,"low_stock":true,"out_of_stock":false,"expiry_date":"2027-03-01","days_to_expiry":146,"expiry_status":"ok","selling_price":1500,"cost_price":900,"stock_value_at_cost":10800},
        {"name":"Yoghurt 500ml","sku":"YGT-500","category":"Dairy","unit":"cup","stock":30,"available":30,"reorder_at":10,"low_stock":false,"out_of_stock":false,"expiry_date":"2026-10-02","days_to_expiry":-4,"expiry_status":"expired","selling_price":2500,"cost_price":1700,"stock_value_at_cost":51000}]'::JSONB)
        AS t(name TEXT, sku TEXT, category TEXT, unit TEXT, stock NUMERIC, available NUMERIC, reorder_at NUMERIC, low_stock BOOLEAN, out_of_stock BOOLEAN,
             expiry_date DATE, days_to_expiry INTEGER, expiry_status TEXT, selling_price NUMERIC, cost_price NUMERIC, stock_value_at_cost NUMERIC)
       WHERE (v_q IS NULL OR name ILIKE public.era_p_like(v_q)) AND (v_cat IS NULL OR category ILIKE v_cat)
         AND (v_status = 'all' OR (v_status = 'low' AND low_stock) OR (v_status = 'out' AND out_of_stock)
              OR (v_status = 'expiring' AND expiry_status IN ('critical', 'soon')) OR (v_status = 'expired' AND expiry_status = 'expired')
              OR (v_status = 'ok' AND expiry_status IN ('ok', 'no_expiry')))) x), '[]'::JSONB);
  END IF;
  v_biz := public.era__biz(p, FALSE);
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT s.* FROM public.era__biz_stock(v_biz) s
     WHERE (v_q IS NULL OR s.name ILIKE public.era_p_like(v_q) OR s.sku ILIKE public.era_p_like(v_q)) AND (v_cat IS NULL OR s.category ILIKE v_cat)
       AND (v_status = 'all' OR (v_status = 'low' AND s.low_stock) OR (v_status = 'out' AND s.out_of_stock)
            OR (v_status = 'expiring' AND s.expiry_status IN ('critical', 'soon')) OR (v_status = 'expired' AND s.expiry_status = 'expired')
            OR (v_status = 'ok' AND s.expiry_status IN ('ok', 'no_expiry')))
     ORDER BY CASE s.expiry_status WHEN 'expired' THEN 0 WHEN 'critical' THEN 1 WHEN 'soon' THEN 2 ELSE 3 END, s.expiry_date NULLS LAST, s.name
     LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

-- First-expired-first-out: what to sell, discount or pull, with a suggested clearance price that never goes below cost.
CREATE OR REPLACE FUNCTION public.era_h_business_inventory_expiring(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days INTEGER := public.era_p_int(p, 'days', 30, 1, 365);
  v_expired BOOLEAN := lower(COALESCE(public.era_p_text(p, 'include_expired', 6), 'true')) NOT IN ('false', '0', 'no');
  v_limit INTEGER := public.era_p_int(p, 'limit', 50, 1, 200); v_biz UUID;
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"name":"Yoghurt 500ml","batch_number":"YG-2210","expiry_date":"2026-10-02","days_left":-4,"expiry_status":"expired","stock":30,"unit_cost":1700,"selling_price":2500,"value_at_risk":51000,"discount_pct":100,"suggested_price":null,"action":"withdraw","clearance_published":false},
        {"name":"Fresh Milk 1L","batch_number":"ML-0931","expiry_date":"2026-10-09","days_left":3,"expiry_status":"critical","stock":48,"unit_cost":2900,"selling_price":4000,"value_at_risk":139200,"discount_pct":50,"suggested_price":2900,"action":"discount","clearance_published":false},
        {"name":"Bread 600g","batch_number":"BR-554","expiry_date":"2026-10-20","days_left":14,"expiry_status":"soon","stock":60,"unit_cost":3100,"selling_price":4800,"value_at_risk":186000,"discount_pct":20,"suggested_price":3800,"action":"discount","clearance_published":true}]'::JSONB)
        AS t(name TEXT, batch_number TEXT, expiry_date DATE, days_left INTEGER, expiry_status TEXT, stock NUMERIC, unit_cost NUMERIC, selling_price NUMERIC,
             value_at_risk NUMERIC, discount_pct INTEGER, suggested_price NUMERIC, action TEXT, clearance_published BOOLEAN)
       WHERE days_left <= v_days AND (v_expired OR days_left >= 0)) x), '[]'::JSONB);
  END IF;
  v_biz := public.era__biz(p, FALSE);
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT e.* FROM public.era__biz_expiring(v_biz) e
     WHERE e.days_left <= v_days AND (v_expired OR e.days_left >= 0)
     ORDER BY e.expiry_date, e.name LIMIT v_limit) x), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_business_inventory_summary(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_biz UUID; r RECORD; v_risk NUMERIC;
BEGIN
  IF p_sandbox THEN
    RETURN jsonb_build_object('products', 124, 'in_stock', 117, 'out_of_stock', 7, 'low_stock', 11, 'stock_value_at_cost', 8420500,
      'expiry', jsonb_build_object('expired', 3, 'critical', 9, 'soon', 14, 'ok', 78, 'no_expiry', 20), 'value_at_risk', 612400,
      'next_to_expire', jsonb_build_array(jsonb_build_object('name', 'Yoghurt 500ml', 'expiry_date', '2026-10-02', 'days_left', -4)), 'as_of', now(), 'source', 'sandbox-fixture');
  END IF;
  v_biz := public.era__biz(p, FALSE);
  SELECT COUNT(*) AS products, COUNT(*) FILTER (WHERE NOT out_of_stock) AS in_stock, COUNT(*) FILTER (WHERE out_of_stock) AS oos,
         COUNT(*) FILTER (WHERE low_stock) AS low, COALESCE(SUM(stock_value_at_cost), 0) AS val,
         COUNT(*) FILTER (WHERE expiry_status = 'expired') AS ex, COUNT(*) FILTER (WHERE expiry_status = 'critical') AS cr,
         COUNT(*) FILTER (WHERE expiry_status = 'soon') AS so, COUNT(*) FILTER (WHERE expiry_status = 'ok') AS ok,
         COUNT(*) FILTER (WHERE expiry_status = 'no_expiry') AS ne INTO r
    FROM public.era__biz_stock(v_biz);
  SELECT COALESCE(SUM(value_at_risk), 0) INTO v_risk FROM public.era__biz_expiring(v_biz) WHERE days_left <= 30;
  RETURN jsonb_build_object('products', r.products, 'in_stock', r.in_stock, 'out_of_stock', r.oos, 'low_stock', r.low, 'stock_value_at_cost', r.val,
    'expiry', jsonb_build_object('expired', r.ex, 'critical', r.cr, 'soon', r.so, 'ok', r.ok, 'no_expiry', r.ne), 'value_at_risk', v_risk,
    'next_to_expire', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', n.name, 'expiry_date', n.expiry_date, 'days_left', n.days_left))
                                  FROM (SELECT name, expiry_date, days_left FROM public.era__biz_expiring(v_biz) ORDER BY expiry_date LIMIT 3) n), '[]'::JSONB),
    'as_of', now());
END;
$$;

-- ============================================================================ BUSINESS: CMMS (assets, stock, requisitions, work)

CREATE OR REPLACE FUNCTION public.era_h_business_cmms_overview(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_biz UUID; v_co UUID[]; a RECORD; st RECORD; rq RECORD; wk RECORD; d RECORD;
BEGIN
  IF p_sandbox THEN
    RETURN jsonb_build_object('companies', 2,
      'assets', jsonb_build_object('total', 48, 'by_status', jsonb_build_object('in_service', 41, 'under_repair', 5, 'retired', 2), 'warranty_expiring_60d', 4, 'warranty_expired', 9,
                                  'total_acquisition_cost', 182400000, 'total_book_value', 121300000),
      'stock', jsonb_build_object('consumables', 63, 'below_reorder', 6),
      'requisitions', jsonb_build_object('open', 5, 'by_status', jsonb_build_object('pending_finance', 3, 'approved', 2, 'completed', 41), 'open_estimated_cost', 3820000),
      'work', jsonb_build_object('open', 12, 'overdue', 2, 'by_status', jsonb_build_object('accepted', 3, 'in_progress', 9, 'completed', 88)),
      'departments', jsonb_build_object('count', 7, 'annual_budget', 96000000, 'budget_used', 41200000), 'as_of', now(), 'source', 'sandbox-fixture');
  END IF;
  v_biz := public.era__biz(p, FALSE);
  SELECT COALESCE(array_agg(c), '{}') INTO v_co FROM public.era__biz_cmms(v_biz) c;
  SELECT COUNT(*) AS n, COALESCE(jsonb_object_agg(COALESCE(s, 'unknown'), c) FILTER (WHERE TRUE), '{}'::JSONB) AS by_status,
         COALESCE(SUM(cost), 0) AS cost,
         COALESCE(SUM(public.era__book_value(cost, salv, life, acq, meth)), 0) AS book,
         COUNT(*) FILTER (WHERE wexp IS NOT NULL AND wexp >= public.era__today() AND wexp <= public.era__today() + 60) AS w60,
         COUNT(*) FILTER (WHERE wexp IS NOT NULL AND wexp < public.era__today()) AS wexp INTO a
    FROM (SELECT asset_status AS s, COUNT(*) OVER (PARTITION BY asset_status) AS c, acquisition_cost AS cost, salvage_value AS salv,
                 useful_life_years AS life, acquisition_date AS acq, depreciation_method AS meth, warranty_expiry AS wexp
            FROM public.cmms_inventory_items WHERE cmms_company_id = ANY (v_co) AND item_kind = 'asset' AND is_active IS NOT FALSE AND disposed_at IS NULL) q;
  SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE quantity_in_stock <= reorder_level) AS low INTO st
    FROM public.cmms_inventory_items WHERE cmms_company_id = ANY (v_co) AND item_kind = 'consumable' AND is_active IS NOT FALSE;
  SELECT COALESCE(SUM(n) FILTER (WHERE status NOT IN ('completed', 'closed') AND status NOT LIKE 'rejected%'), 0) AS open,
         COALESCE(SUM(total_estimated_cost) FILTER (WHERE status NOT IN ('completed', 'closed') AND status NOT LIKE 'rejected%'), 0) AS cost,
         COALESCE(jsonb_object_agg(status, n), '{}'::JSONB) AS by_status INTO rq
    FROM (SELECT status, COUNT(*) AS n, SUM(total_estimated_cost) AS total_estimated_cost FROM public.cmms_requisitions WHERE cmms_company_id = ANY (v_co) GROUP BY status) q;
  SELECT COUNT(*) FILTER (WHERE assignment_status <> 'completed') AS open,
         COUNT(*) FILTER (WHERE assignment_status <> 'completed' AND due_date < public.era__today()) AS overdue,
         COALESCE(jsonb_object_agg(assignment_status, n), '{}'::JSONB) AS by_status INTO wk
    FROM (SELECT assignment_status, due_date, COUNT(*) OVER (PARTITION BY assignment_status) AS n FROM public.cmms_job_assignments WHERE company_id = ANY (v_co)) q;
  SELECT COUNT(*) AS n, COALESCE(SUM(annual_budget), 0) AS b, COALESCE(SUM(budget_used), 0) AS u INTO d
    FROM public.cmms_departments WHERE cmms_company_id = ANY (v_co) AND is_active IS NOT FALSE;
  RETURN jsonb_build_object('companies', COALESCE(array_length(v_co, 1), 0),
    'assets', jsonb_build_object('total', a.n, 'by_status', a.by_status, 'warranty_expiring_60d', a.w60, 'warranty_expired', a.wexp,
                                 'total_acquisition_cost', a.cost, 'total_book_value', round(a.book, 2)),
    'stock', jsonb_build_object('consumables', st.n, 'below_reorder', st.low),
    'requisitions', jsonb_build_object('open', rq.open, 'by_status', rq.by_status, 'open_estimated_cost', rq.cost),
    'work', jsonb_build_object('open', wk.open, 'overdue', wk.overdue, 'by_status', wk.by_status),
    'departments', jsonb_build_object('count', d.n, 'annual_budget', d.b, 'budget_used', d.u), 'as_of', now());
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_business_cmms_assets(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_q TEXT := public.era_p_text(p, 'q', 60); v_status TEXT := public.era_p_text(p, 'status', 30); v_cond TEXT := public.era_p_text(p, 'condition', 30);
  v_limit INTEGER := public.era_p_int(p, 'limit', 50, 1, 200); v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 100000);
  v_biz UUID;
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"asset_tag":"GEN-001","name":"Diesel generator 20kVA","category":"Power","manufacturer":"Perkins","model":"20P","condition":"good","status":"in_service","acquisition_date":"2023-02-10","acquisition_cost":18500000,"useful_life_years":10,"book_value":14700000,"warranty_expiry":"2026-11-20","warranty_days_left":45},
        {"asset_tag":"CMP-014","name":"Air compressor","category":"Workshop","manufacturer":"Atlas Copco","model":"GX5","condition":"fair","status":"under_repair","acquisition_date":"2021-06-01","acquisition_cost":6400000,"useful_life_years":8,"book_value":3300000,"warranty_expiry":"2023-06-01","warranty_days_left":-1222}]'::JSONB)
        AS t(asset_tag TEXT, name TEXT, category TEXT, manufacturer TEXT, model TEXT, condition TEXT, status TEXT, acquisition_date DATE, acquisition_cost NUMERIC,
             useful_life_years INTEGER, book_value NUMERIC, warranty_expiry DATE, warranty_days_left INTEGER)
       WHERE (v_q IS NULL OR name ILIKE public.era_p_like(v_q) OR asset_tag ILIKE public.era_p_like(v_q)) AND (v_status IS NULL OR status ILIKE v_status)
         AND (v_cond IS NULL OR condition ILIKE v_cond)) x), '[]'::JSONB);
  END IF;
  v_biz := public.era__biz(p, FALSE);
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT i.asset_tag, i.item_name AS name, i.category, i.manufacturer, i.model, i.asset_condition AS condition,
           i.asset_status AS status, c.branch_name AS branch, i.acquisition_date, i.acquisition_cost, i.useful_life_years,
           public.era__book_value(i.acquisition_cost, i.salvage_value, i.useful_life_years, i.acquisition_date, i.depreciation_method) AS book_value,
           i.warranty_expiry, CASE WHEN i.warranty_expiry IS NOT NULL THEN i.warranty_expiry - public.era__today() END AS warranty_days_left
      FROM public.cmms_inventory_items i LEFT JOIN public.cmms_company_profiles c ON c.id = i.cmms_company_id
     WHERE i.cmms_company_id IN (SELECT public.era__biz_cmms(v_biz)) AND i.item_kind = 'asset' AND i.is_active IS NOT FALSE AND i.disposed_at IS NULL
       AND (v_q IS NULL OR i.item_name ILIKE public.era_p_like(v_q) OR i.asset_tag ILIKE public.era_p_like(v_q))
       AND (v_status IS NULL OR i.asset_status ILIKE v_status) AND (v_cond IS NULL OR i.asset_condition ILIKE v_cond)
     ORDER BY i.item_name LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

-- Consumables at or under their reorder level, with days of cover from the last 30 days of use and when to reorder by.
CREATE OR REPLACE FUNCTION public.era_h_business_cmms_stock_alerts(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_biz UUID; v_limit INTEGER := public.era_p_int(p, 'limit', 50, 1, 200);
BEGIN
  IF p_sandbox THEN
    RETURN '[{"item_code":"OIL-15W40","name":"Engine oil 15W-40 (20L)","category":"Lubricants","quantity_in_stock":3,"reorder_level":5,"unit":"drum","daily_use":0.4,"days_of_cover":7.5,"lead_time_days":5,"reorder_by":"2026-10-08","suggested_reorder_qty":10,"supplier":"Kampala Lubes"},
             {"item_code":"FLT-A22","name":"Air filter A22","category":"Spares","quantity_in_stock":1,"reorder_level":4,"unit":"pc","daily_use":null,"days_of_cover":null,"lead_time_days":14,"reorder_by":null,"suggested_reorder_qty":7,"supplier":"AutoParts Ltd"}]'::JSONB;
  END IF;
  v_biz := public.era__biz(p, FALSE);
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT i.item_code, i.item_name AS name, i.category, i.quantity_in_stock, i.reorder_level, i.unit_of_measure AS unit,
           round(u.daily, 3) AS daily_use,
           CASE WHEN u.daily > 0 THEN round(i.quantity_in_stock / u.daily, 1) END AS days_of_cover, i.lead_time_days,
           CASE WHEN u.daily > 0 THEN public.era__today() + GREATEST(floor(i.quantity_in_stock / u.daily - COALESCE(i.lead_time_days, 0))::INTEGER, 0) END AS reorder_by,
           COALESCE(i.reorder_quantity, GREATEST(i.reorder_level * 2 - i.quantity_in_stock, 1)) AS suggested_reorder_qty,
           i.supplier_name AS supplier
      FROM public.cmms_inventory_items i
      LEFT JOIN LATERAL (SELECT SUM(abs(t.quantity)) / 30.0 AS daily FROM public.cmms_inventory_transactions t
                          WHERE t.item_id = i.id AND t.txn_date > now() - INTERVAL '30 days'
                            AND (t.quantity < 0 OR t.txn_type ~* '(issue|consum|usage|out)')) u ON TRUE
     WHERE i.cmms_company_id IN (SELECT public.era__biz_cmms(v_biz)) AND i.item_kind = 'consumable' AND i.is_active IS NOT FALSE
       AND i.reorder_level IS NOT NULL AND i.quantity_in_stock <= i.reorder_level
     ORDER BY (i.quantity_in_stock / NULLIF(i.reorder_level, 0)), i.item_name LIMIT v_limit) x), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_business_cmms_requisitions(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status TEXT := public.era_p_text(p, 'status', 40); v_limit INTEGER := public.era_p_int(p, 'limit', 50, 1, 200);
        v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 100000); v_biz UUID;
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"requisition_number":"REQ-2026-0112","requisition_date":"2026-10-01","department":"Workshop","purpose":"Replace compressor seals","urgency_level":"high","status":"pending_finance","total_estimated_cost":850000,"budget_sufficient":true,"required_by_date":"2026-10-10"},
        {"requisition_number":"REQ-2026-0107","requisition_date":"2026-09-24","department":"Facilities","purpose":"Generator service kit","urgency_level":"normal","status":"completed","total_estimated_cost":420000,"budget_sufficient":true,"required_by_date":"2026-10-01"}]'::JSONB)
        AS t(requisition_number TEXT, requisition_date DATE, department TEXT, purpose TEXT, urgency_level TEXT, status TEXT, total_estimated_cost NUMERIC, budget_sufficient BOOLEAN, required_by_date DATE)
       WHERE v_status IS NULL OR status ILIKE v_status) x), '[]'::JSONB);
  END IF;
  v_biz := public.era__biz(p, FALSE);
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT r.requisition_number, r.requisition_date::DATE AS requisition_date, d.department_name AS department, r.purpose, r.urgency_level, r.status,
           r.total_estimated_cost, r.budget_sufficient, r.required_by_date, r.expected_delivery_date::DATE AS expected_delivery_date,
           r.actual_delivery_date::DATE AS actual_delivery_date
      FROM public.cmms_requisitions r LEFT JOIN public.cmms_departments d ON d.id = r.department_id
     WHERE r.cmms_company_id IN (SELECT public.era__biz_cmms(v_biz)) AND (v_status IS NULL OR r.status ILIKE v_status)
     ORDER BY r.requisition_date DESC LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_business_cmms_work(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status TEXT := public.era_p_text(p, 'status', 30); v_limit INTEGER := public.era_p_int(p, 'limit', 50, 1, 200);
        v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 100000); v_biz UUID;
BEGIN
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"job_title":"Service generator GEN-001","assignment_status":"in_progress","priority":"high","due_date":"2026-10-09","progress_percentage":60,"overdue":false},
        {"job_title":"Inspect compressor CMP-014","assignment_status":"accepted","priority":"normal","due_date":"2026-10-03","progress_percentage":0,"overdue":true}]'::JSONB)
        AS t(job_title TEXT, assignment_status TEXT, priority TEXT, due_date DATE, progress_percentage INTEGER, overdue BOOLEAN)
       WHERE v_status IS NULL OR assignment_status ILIKE v_status) x), '[]'::JSONB);
  END IF;
  v_biz := public.era__biz(p, FALSE);
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT j.job_title, j.job_description, j.assignment_status, j.priority, j.due_date, j.progress_percentage,
           (j.assignment_status <> 'completed' AND j.due_date IS NOT NULL AND j.due_date < public.era__today()) AS overdue, j.last_progress_update
      FROM public.cmms_job_assignments j
     WHERE j.company_id IN (SELECT public.era__biz_cmms(v_biz)) AND (v_status IS NULL OR j.assignment_status ILIKE v_status)
     ORDER BY (j.assignment_status = 'completed'), j.due_date NULLS LAST LIMIT v_limit OFFSET v_offset) x), '[]'::JSONB);
END;
$$;

-- ============================================================================ BUSINESS: booking requests (journeys and deliveries)

-- Creates a BOOKING INTENT, never a booking. The price is worked out here (a client-supplied fare is ignored); a rider is
-- not dispatched and no wallet is charged. The customer opens the confirm link in BodaGoEra and books it with their own session.
CREATE OR REPLACE FUNCTION public.era_h_business_booking_create(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b JSONB := COALESCE(p -> '_body', '{}'::JSONB);
  v_kind TEXT := lower(COALESCE(public.era_p_text(b, 'kind', 12), 'ride'));
  v_notes TEXT := public.era_p_text(b, 'notes', 200);
  v_ref TEXT := public.era_p_text(b, 'external_ref', 64);
  v_pts JSONB := '[]'::JSONB; v_at TIMESTAMPTZ := now(); pt NUMERIC[]; s JSONB; v_quote JSONB;
  v_biz UUID; v_key UUID := NULLIF(p ->> '_key_id', '')::UUID; v_code TEXT;
  v_exp TIMESTAMPTZ := now() + INTERVAL '30 minutes';
  v_name TEXT; v_from NUMERIC[]; v_to NUMERIC[];
BEGIN
  IF v_kind NOT IN ('ride', 'delivery') THEN RAISE EXCEPTION 'kind must be ride or delivery' USING ERRCODE = '22023'; END IF;
  IF v_ref IS NOT NULL AND v_ref !~ '^[A-Za-z0-9._:-]{1,64}$' THEN RAISE EXCEPTION 'external_ref may only contain letters, digits and . _ : -' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(b -> 'from') IS DISTINCT FROM 'object' OR jsonb_typeof(b -> 'to') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'from and to must be objects like {"lat":0.3476,"lng":32.5825,"label":"Wandegeya"}' USING ERRCODE = '22023';
  END IF;
  v_from := public.era__point((b -> 'from' ->> 'lat') || ',' || (b -> 'from' ->> 'lng'), 'from');
  v_to := public.era__point((b -> 'to' ->> 'lat') || ',' || (b -> 'to' ->> 'lng'), 'to');
  v_pts := jsonb_build_array(jsonb_build_array(v_from[1], v_from[2]));
  IF jsonb_typeof(COALESCE(b -> 'stops', '[]'::JSONB)) <> 'array' OR jsonb_array_length(COALESCE(b -> 'stops', '[]'::JSONB)) > 3 THEN
    RAISE EXCEPTION 'stops must be a list of at most 3 points' USING ERRCODE = '22023';
  END IF;
  FOR s IN SELECT * FROM jsonb_array_elements(COALESCE(b -> 'stops', '[]'::JSONB)) LOOP
    pt := public.era__point((s ->> 'lat') || ',' || (s ->> 'lng'), 'stops');
    v_pts := v_pts || jsonb_build_array(jsonb_build_array(pt[1], pt[2]));
  END LOOP;
  v_pts := v_pts || jsonb_build_array(jsonb_build_array(v_to[1], v_to[2]));
  IF COALESCE(b ->> 'at', '') <> '' THEN
    BEGIN v_at := (b ->> 'at')::TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'at must be an ISO date-time such as 2026-10-06T08:30:00+03:00' USING ERRCODE = '22023'; END;
    IF v_at < now() - INTERVAL '1 hour' OR v_at > now() + INTERVAL '14 days' THEN RAISE EXCEPTION 'at must be within the next 14 days.' USING ERRCODE = '22023'; END IF;
  END IF;
  v_quote := public.era__quote(v_pts, v_kind, v_at);   -- the price is ours; any "fare" in the body is ignored
  v_code := 'BK' || upper(public.era__rand(20));

  IF p_sandbox THEN
    RETURN jsonb_build_object('code', v_code, 'status', 'awaiting_confirmation', 'kind', v_kind, 'quote', v_quote, 'expires_at', v_exp,
      'confirm_path', '/book/' || v_code, 'external_ref', v_ref, 'requested_by', 'Sample Business Ltd', 'sandbox', TRUE,
      'next', 'Sandbox intent: nothing was stored. In live mode send the customer the confirm link; they book it in BodaGoEra with their own session.');
  END IF;

  v_biz := public.era__biz(p, FALSE);
  SELECT business_name INTO v_name FROM public.business_profiles WHERE id = v_biz;
  IF (SELECT COUNT(*) FROM public.era_api_booking_intents WHERE key_id = v_key AND status = 'awaiting_confirmation' AND expires_at > now()) >= 30 THEN
    RAISE EXCEPTION 'This key already has 30 booking links waiting for a customer.' USING ERRCODE = 'ERA29';
  END IF;
  INSERT INTO public.era_api_booking_intents (code, key_id, business_profile_id, kind, pickup_label, pickup_lat, pickup_lng,
                                              dropoff_label, dropoff_lat, dropoff_lng, notes, external_ref, quote, expires_at)
  VALUES (v_code, v_key, v_biz, v_kind, public.era_p_text(b -> 'from', 'label', 120), v_from[1], v_from[2],
          public.era_p_text(b -> 'to', 'label', 120), v_to[1], v_to[2], v_notes, v_ref, v_quote, v_exp);
  RETURN jsonb_build_object('code', v_code, 'status', 'awaiting_confirmation', 'kind', v_kind, 'quote', v_quote, 'expires_at', v_exp,
    'confirm_path', '/book/' || v_code, 'external_ref', v_ref, 'requested_by', v_name,
    'next', 'Send the customer the confirm link. They open it in BodaGoEra, pick a rider and book with their own session and PIN. You cannot book or charge on their behalf.');
END;
$$;

CREATE OR REPLACE FUNCTION public.era__booking_row(p_id UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('code', i.code, 'kind', i.kind,
           'status', CASE WHEN i.status = 'awaiting_confirmation' AND i.expires_at <= now() THEN 'expired' ELSE i.status END,
           'pickup', i.pickup_label, 'dropoff', i.dropoff_label, 'total_ugx', i.quote -> 'total_ugx', 'total_ican', i.quote -> 'total_ican',
           'external_ref', i.external_ref, 'created_at', i.created_at, 'expires_at', i.expires_at, 'booked_at', i.booked_at,
           -- only the ride's state: never who the customer or the rider is
           'ride', (SELECT jsonb_build_object('status', r.status::TEXT, 'fare_ugx', r.fare, 'distance_km', r.distance_km, 'requested_at', r.requested_at,
                                              'accepted_at', r.accepted_at, 'started_at', r.started_at, 'completed_at', r.completed_at, 'cancelled_at', r.cancelled_at)
                      FROM public.mbg_rides r WHERE r.id = i.ride_id))
    FROM public.era_api_booking_intents i WHERE i.id = p_id
$$;

CREATE OR REPLACE FUNCTION public.era_h_business_bookings(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status TEXT := lower(COALESCE(public.era_p_text(p, 'status', 24), 'all')); v_limit INTEGER := public.era_p_int(p, 'limit', 25, 1, 100);
        v_offset INTEGER := public.era_p_int(p, 'offset', 0, 0, 100000); v_biz UUID;
BEGIN
  IF v_status NOT IN ('all', 'awaiting_confirmation', 'booked', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'status must be all, awaiting_confirmation, booked, cancelled or expired' USING ERRCODE = '22023';
  END IF;
  IF p_sandbox THEN
    RETURN COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_to_recordset('[
        {"code":"BKFADE0000000000000001","kind":"delivery","status":"booked","pickup":"Kampala Fresh Mart","dropoff":"Ntinda, Plot 12","total_ugx":6500,"external_ref":"order-1042","ride":{"status":"completed","fare_ugx":6500}},
        {"code":"BKFADE0000000000000002","kind":"ride","status":"awaiting_confirmation","pickup":"Wandegeya","dropoff":"Makerere Hill","total_ugx":3000,"external_ref":"order-1043","ride":null}]'::JSONB)
        AS t(code TEXT, kind TEXT, status TEXT, pickup TEXT, dropoff TEXT, total_ugx NUMERIC, external_ref TEXT, ride JSONB)
       WHERE v_status = 'all' OR status = v_status) x), '[]'::JSONB);
  END IF;
  v_biz := public.era__biz(p, FALSE);
  RETURN COALESCE((SELECT jsonb_agg(public.era__booking_row(i.id) ORDER BY i.created_at DESC) FROM (
    SELECT * FROM public.era_api_booking_intents WHERE business_profile_id = v_biz
       AND (v_status = 'all' OR (v_status = 'expired' AND (status = 'expired' OR (status = 'awaiting_confirmation' AND expires_at <= now())))
            OR (v_status = 'awaiting_confirmation' AND status = 'awaiting_confirmation' AND expires_at > now())
            OR (v_status IN ('booked', 'cancelled') AND status = v_status))
     ORDER BY created_at DESC LIMIT v_limit OFFSET v_offset) i), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.era_h_business_booking_get(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code TEXT := upper(COALESCE(public.era_p_text(p, 'code', 40), '')); v_biz UUID; i public.era_api_booking_intents;
BEGIN
  IF v_code !~ '^BK[0-9A-F]{20}$' THEN RAISE EXCEPTION 'code must look like BK followed by 20 letters/digits' USING ERRCODE = '22023'; END IF;
  IF p_sandbox THEN
    RETURN jsonb_build_object('code', v_code, 'kind', 'delivery', 'status', 'booked', 'pickup', 'Kampala Fresh Mart', 'dropoff', 'Ntinda, Plot 12', 'total_ugx', 6500,
      'ride', jsonb_build_object('status', 'completed', 'fare_ugx', 6500, 'distance_km', 2.4));
  END IF;
  v_biz := public.era__biz(p, FALSE);
  SELECT * INTO i FROM public.era_api_booking_intents WHERE code = v_code AND business_profile_id = v_biz;
  IF NOT FOUND THEN RAISE EXCEPTION 'No booking request % for this business.', v_code USING ERRCODE = 'P0002'; END IF;
  RETURN public.era__booking_row(i.id);
END;
$$;

-- ============================================================================ PLATFORM: who am I (now aware of business keys)
CREATE OR REPLACE FUNCTION public.era_h_platform_whoami(p JSONB, p_sandbox BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.era_api_clients;
  v_key UUID := NULLIF(p ->> '_key_id', '')::UUID;
  v_biz UUID := NULLIF(p ->> '_business_id', '')::UUID;
  v_used INTEGER; v_bname TEXT;
BEGIN
  SELECT * INTO c FROM public.era_api_clients WHERE id = (p ->> '_client_id')::UUID;
  SELECT COALESCE(SUM(calls), 0) INTO v_used FROM public.era_api_usage
   WHERE key_id = v_key AND period = 'd' AND bucket = public.era__bucket(86400);
  IF v_biz IS NOT NULL THEN SELECT business_name INTO v_bname FROM public.business_profiles WHERE id = v_biz; END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'app_name', c.app_name,
    'mode', p ->> '_mode',
    'status', c.status,
    'apps', p -> '_apps',
    'limits', jsonb_build_object('per_minute', (p ->> '_rate')::INTEGER, 'per_day', (p ->> '_quota')::INTEGER),
    'used_today', v_used,
    'business', CASE WHEN p ->> '_mode' IN ('business', 'business-test') THEN jsonb_build_object(
        'name', COALESCE(v_bname, 'Sample Business Ltd'), 'scopes', p -> '_scopes', 'expires_at', p -> '_expires_at',
        'max_amount_ugx', NULLIF(p ->> '_max_amount_ugx', '')::NUMERIC, 'daily_cap_ugx', NULLIF(p ->> '_daily_cap_ugx', '')::NUMERIC) END,
    'hint', CASE WHEN p ->> '_mode' = 'sandbox' THEN 'Sandbox key: responses are realistic fixtures. Ask for live access at /developers.'
                 WHEN p ->> '_mode' = 'business-test' THEN 'Business test key: private endpoints answer with fixtures and nothing is created.'
                 WHEN p ->> '_mode' = 'business' THEN 'Business key: you can read and write only this business, within the scopes its owner chose.'
                 ELSE 'Live key: responses are real.' END));
END;
$$;

-- ============================================================================ the registry
INSERT INTO public.era_api_endpoints (id, app, method, path, summary, description, params, body, example_path, handler, access, scope, cache_seconds, sort) VALUES
 -- ICANERA
 ('icanera.coin_valuation', 'icanera', 'GET', '/icanera/coin/valuation', 'How the ICAN price is made',
  'The valuation step by step: the 5,000 UGX floor, FX protection, the USD and UGX inflation legs, the fair price, and how the market price compares. Plus aggregate activity.',
  '[]', '[]', '/icanera/coin/valuation', 'public.era_h_icanera_coin_valuation', 'app', NULL, 60, 26),
 ('icanera.coin_supply', 'icanera', 'GET', '/icanera/coin/supply', 'ICAN supply',
  'Coins held in wallets, holders, coins bought and sold through the platform, and 30-day activity by type. Aggregates only, nothing per person.',
  '[]', '[]', '/icanera/coin/supply', 'public.era_h_icanera_coin_supply', 'app', NULL, 120, 27),
 ('icanera.coin_convert', 'icanera', 'GET', '/icanera/coin/convert', 'Convert ICAN and a currency',
  'At the live price, either way. Indicative: a fee or spread applies when you actually buy or sell.',
  '[{"name":"from","in":"query","type":"string","required":true,"example":"UGX","description":"ICAN or a 3-letter currency code."},
    {"name":"to","in":"query","type":"string","required":true,"example":"ICAN","description":"ICAN or a 3-letter currency code. Exactly one side is ICAN."},
    {"name":"amount","in":"query","type":"number","required":true,"example":100000,"description":"The amount to convert."}]',
  '[]', '/icanera/coin/convert?from=UGX&to=ICAN&amount=100000', 'public.era_h_icanera_coin_convert', 'app', NULL, 30, 28),
 ('icanera.chain_gas', 'icanera', 'GET', '/icanera/chain/gas', 'Blockchain network fee estimate',
  'What a transaction would cost in gas, in the network coin, in USD and in ICAN. An estimate from typical gas units and the gas price the platform team last entered (its age is shown).',
  '[{"name":"network","in":"query","type":"string","required":false,"default":"ethereum","description":"The network."},
    {"name":"operation","in":"query","type":"string","required":false,"example":"token_transfer","description":"native_transfer, token_transfer, token_approve, contract_call or contract_deploy. Omit for all."}]',
  '[]', '/icanera/chain/gas?operation=token_transfer', 'public.era_h_icanera_chain_gas', 'app', NULL, 60, 29),
 ('icanera.chain_head', 'icanera', 'GET', '/icanera/chain/head', 'Integrity chain: latest block',
  'The latest sequence number and chain hash of the hash-linked record of ICAN events.',
  '[]', '[]', '/icanera/chain/head', 'public.era_h_icanera_chain_head', 'app', NULL, 15, 29),
 ('icanera.chain_proof', 'icanera', 'GET', '/icanera/chain/proof/{seq}', 'Integrity chain: proof for one event',
  'The event type, its hash and the previous hash, so you can check it links to the event before it. Never the underlying record.',
  '[{"name":"seq","in":"path","type":"integer","required":true,"example":1358,"description":"The sequence number."}]',
  '[]', '/icanera/chain/proof/1358', 'public.era_h_icanera_chain_proof', 'app', NULL, 600, 29),
 -- BodaGoEra
 ('bodagoera.journey_quote', 'bodagoera', 'GET', '/bodagoera/journeys/quote', 'Quote a journey or delivery',
  'Prices a ride, a delivery or cargo between two points, with up to 3 stops. Uses the booking engine''s own formula, including the time-of-day multiplier, and can price for a later time.',
  '[{"name":"from","in":"query","type":"string","required":true,"example":"0.3318,32.5728","description":"Pickup as latitude,longitude."},
    {"name":"to","in":"query","type":"string","required":true,"example":"0.3476,32.6025","description":"Drop-off as latitude,longitude."},
    {"name":"stops","in":"query","type":"string","required":false,"example":"0.3400,32.5900","description":"Up to 3 stops, separated by |."},
    {"name":"kind","in":"query","type":"string","required":false,"default":"ride","example":"delivery","description":"ride, delivery or cargo."},
    {"name":"at","in":"query","type":"string","required":false,"description":"Price for this ISO date-time (next 14 days). Default: now."}]',
  '[]', '/bodagoera/journeys/quote?from=0.3318,32.5728&to=0.3476,32.6025&kind=delivery', 'public.era_h_bodagoera_journey_quote', 'app', NULL, 0, 35),
 -- SupermarketEra
 ('supermarketera.products', 'supermarketera', 'GET', '/supermarketera/products', 'Products on store shelves',
  'Products across every category and store: price, brand, barcode, expiry date and any published clearance price. No cost prices, no stock levels.',
  '[{"name":"q","in":"query","type":"string","required":false,"example":"milk","description":"Search name or brand."},
    {"name":"category","in":"query","type":"string","required":false,"example":"Dairy","description":"Filter by category."},
    {"name":"store","in":"query","type":"string","required":false,"description":"Search by store name."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":25,"description":"1 to 100."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '[]', '/supermarketera/products?category=Dairy', 'public.era_h_supermarketera_products', 'app', NULL, 60, 44),
 ('supermarketera.clearance', 'supermarketera', 'GET', '/supermarketera/clearance', 'Clearance deals',
  'Reduced prices that stores published on stock nearing its expiry date: original price, price now, discount and days left.',
  '[{"name":"city","in":"query","type":"string","required":false,"example":"Kampala","description":"Only this city."},
    {"name":"category","in":"query","type":"string","required":false,"description":"Only this category."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":25,"description":"1 to 100."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '[]', '/supermarketera/clearance', 'public.era_h_supermarketera_clearance', 'app', NULL, 60, 45),
 -- BUSINESS: payments
 ('business.payment_create', 'business', 'POST', '/business/payments', 'Create a payment request',
  'Creates a payment request (a QR code). It does NOT move money: the payer scans it in the ICAN app and approves with their own PIN. Capped per request and per day by the key; needs an Idempotency-Key.',
  '[]',
  '[{"name":"amount","type":"number","required":true,"example":45000,"description":"Amount to collect."},
    {"name":"currency","type":"string","required":false,"example":"UGX","description":"UGX (default), USD, KES, TZS or RWF."},
    {"name":"description","type":"string","required":false,"example":"Order #1042","description":"Shown to the payer. Up to 140 characters."},
    {"name":"expires_in_minutes","type":"integer","required":false,"example":60,"description":"5 to 1440. Default 60."},
    {"name":"classification","type":"string","required":false,"example":"business","description":"business (default) or personal."},
    {"name":"external_ref","type":"string","required":false,"example":"order-1042","description":"Your own reference, returned on every read."}]',
  NULL, 'public.era_h_business_payment_create', 'business', 'payments:request', 0, 60),
 ('business.payments', 'business', 'GET', '/business/payments', 'List payment requests',
  'The payment requests this business created through the API, with status (pending, completed, expired) and when each was paid. Never who paid.',
  '[{"name":"status","in":"query","type":"string","required":false,"default":"all","example":"pending","description":"all, pending, completed or expired."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":25,"description":"1 to 100."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '[]', '/business/payments?status=pending', 'public.era_h_business_payments', 'business', 'payments:read', 0, 61),
 ('business.payment_get', 'business', 'GET', '/business/payments/{code}', 'Check one payment request',
  'Status of one payment request: poll this until it says completed.',
  '[{"name":"code","in":"path","type":"string","required":true,"example":"PAY_SANDBOX0000B2","description":"The payment code."}]',
  '[]', '/business/payments/PAY_SANDBOX0000B2', 'public.era_h_business_payment_get', 'business', 'payments:read', 0, 62),
 ('business.payment_cancel', 'business', 'POST', '/business/payments/{code}/cancel', 'Cancel a pending payment request',
  'Expires a payment request that has not been paid. A paid request cannot be cancelled here.',
  '[{"name":"code","in":"path","type":"string","required":true,"example":"PAY_SANDBOX0000B2","description":"The payment code."}]',
  '[]', NULL, 'public.era_h_business_payment_cancel', 'business', 'payments:request', 0, 63),
 -- BUSINESS: inventory
 ('business.inventory', 'business', 'GET', '/business/inventory', 'Inventory with expiry tracking',
  'Every tracked product in your stores: stock, reorder level, nearest expiry date, days left and an expiry status (expired, critical within 7 days, soon within 30, ok).',
  '[{"name":"status","in":"query","type":"string","required":false,"default":"all","example":"expiring","description":"all, low, out, expiring, expired or ok."},
    {"name":"q","in":"query","type":"string","required":false,"description":"Search name or SKU."},
    {"name":"category","in":"query","type":"string","required":false,"description":"Filter by category."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":50,"description":"1 to 200."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '[]', '/business/inventory?status=expiring', 'public.era_h_business_inventory', 'business', 'inventory:read', 0, 64),
 ('business.inventory_expiring', 'business', 'GET', '/business/inventory/expiring', 'What to sell, discount or pull',
  'Batches and products by expiry date, first-expired-first-out, with the value at risk, a suggested clearance discount and a price that never falls below cost, and whether you already published it.',
  '[{"name":"days","in":"query","type":"integer","required":false,"default":30,"example":14,"description":"Look ahead this many days (1 to 365)."},
    {"name":"include_expired","in":"query","type":"string","required":false,"default":"true","description":"false to hide already-expired stock."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":50,"description":"1 to 200."}]',
  '[]', '/business/inventory/expiring?days=14', 'public.era_h_business_inventory_expiring', 'business', 'inventory:read', 0, 65),
 ('business.inventory_summary', 'business', 'GET', '/business/inventory/summary', 'Inventory at a glance',
  'Product counts, low and out-of-stock, stock value at cost, how much sits in each expiry band, the value at risk and the next three to expire.',
  '[]', '[]', '/business/inventory/summary', 'public.era_h_business_inventory_summary', 'business', 'inventory:read', 0, 66),
 -- BUSINESS: CMMS
 ('business.cmms_overview', 'business', 'GET', '/business/cmms/overview', 'CMMS overview',
  'Assets (by status, warranties expiring, cost and book value), consumables below reorder, open requisitions, open and overdue work, department budgets.',
  '[]', '[]', '/business/cmms/overview', 'public.era_h_business_cmms_overview', 'business', 'cmms:read', 0, 67),
 ('business.cmms_assets', 'business', 'GET', '/business/cmms/assets', 'CMMS assets',
  'Equipment with condition, status, acquisition cost, a computed book value (straight-line or declining balance) and warranty days left.',
  '[{"name":"q","in":"query","type":"string","required":false,"description":"Search name or asset tag."},
    {"name":"status","in":"query","type":"string","required":false,"example":"in_service","description":"Filter by status."},
    {"name":"condition","in":"query","type":"string","required":false,"example":"good","description":"Filter by condition."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":50,"description":"1 to 200."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '[]', '/business/cmms/assets', 'public.era_h_business_cmms_assets', 'business', 'cmms:read', 0, 68),
 ('business.cmms_stock_alerts', 'business', 'GET', '/business/cmms/stock-alerts', 'CMMS reorder alerts',
  'Consumables at or below their reorder level, with days of cover from the last 30 days of use, the date to reorder by (allowing for lead time) and a suggested quantity.',
  '[{"name":"limit","in":"query","type":"integer","required":false,"default":50,"description":"1 to 200."}]',
  '[]', '/business/cmms/stock-alerts', 'public.era_h_business_cmms_stock_alerts', 'business', 'cmms:read', 0, 69),
 ('business.cmms_requisitions', 'business', 'GET', '/business/cmms/requisitions', 'CMMS requisitions',
  'Requisitions with purpose, urgency, status, estimated cost and delivery dates. No names of requesters.',
  '[{"name":"status","in":"query","type":"string","required":false,"description":"Filter by status."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":50,"description":"1 to 200."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '[]', '/business/cmms/requisitions', 'public.era_h_business_cmms_requisitions', 'business', 'cmms:read', 0, 70),
 ('business.cmms_work', 'business', 'GET', '/business/cmms/work', 'CMMS work assignments',
  'Jobs with status, priority, due date, progress and an overdue flag. Nobody''s name or contact is returned.',
  '[{"name":"status","in":"query","type":"string","required":false,"example":"in_progress","description":"Filter by status."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":50,"description":"1 to 200."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '[]', '/business/cmms/work', 'public.era_h_business_cmms_work', 'business', 'cmms:read', 0, 71),
 -- BUSINESS: bookings
 ('business.booking_create', 'business', 'POST', '/business/bookings', 'Request a ride or delivery',
  'Prices a journey or delivery and creates a booking REQUEST with a confirm link. It does not book, dispatch or charge: the customer opens the link in BodaGoEra, picks a rider and books with their own session and PIN.',
  '[]',
  '[{"name":"kind","type":"string","required":false,"example":"delivery","description":"ride (default) or delivery."},
    {"name":"from","type":"object","required":true,"example":{"lat":0.3318,"lng":32.5728,"label":"Kampala Fresh Mart"},"description":"Pickup: lat, lng and an optional label."},
    {"name":"to","type":"object","required":true,"example":{"lat":0.3476,"lng":32.6025,"label":"Ntinda, Plot 12"},"description":"Drop-off: lat, lng and an optional label."},
    {"name":"stops","type":"array","required":false,"description":"Up to 3 intermediate points, each {lat, lng}."},
    {"name":"at","type":"string","required":false,"description":"Price for this ISO date-time (next 14 days)."},
    {"name":"notes","type":"string","required":false,"description":"Up to 200 characters for the rider."},
    {"name":"external_ref","type":"string","required":false,"example":"order-1042","description":"Your own reference."}]',
  NULL, 'public.era_h_business_booking_create', 'business', 'bookings:request', 0, 72),
 ('business.bookings', 'business', 'GET', '/business/bookings', 'List booking requests',
  'The booking requests this business created, with status (awaiting_confirmation, booked, cancelled, expired) and, once booked, the ride''s state.',
  '[{"name":"status","in":"query","type":"string","required":false,"default":"all","example":"booked","description":"all, awaiting_confirmation, booked, cancelled or expired."},
    {"name":"limit","in":"query","type":"integer","required":false,"default":25,"description":"1 to 100."},
    {"name":"offset","in":"query","type":"integer","required":false,"default":0,"description":"For paging."}]',
  '[]', '/business/bookings', 'public.era_h_business_bookings', 'business', 'bookings:read', 0, 73),
 ('business.booking_get', 'business', 'GET', '/business/bookings/{code}', 'Track one booking request',
  'Status of one booking request and, once booked, the ride: accepted, started, completed. Never the rider''s or customer''s identity.',
  '[{"name":"code","in":"path","type":"string","required":true,"example":"BKFADE0000000000000001","description":"The booking code."}]',
  '[]', '/business/bookings/BKFADE0000000000000001', 'public.era_h_business_booking_get', 'business', 'bookings:read', 0, 74)
ON CONFLICT (id) DO UPDATE SET
  app = EXCLUDED.app, method = EXCLUDED.method, path = EXCLUDED.path, summary = EXCLUDED.summary, description = EXCLUDED.description,
  params = EXCLUDED.params, body = EXCLUDED.body, example_path = EXCLUDED.example_path, handler = EXCLUDED.handler,
  access = EXCLUDED.access, scope = EXCLUDED.scope, sort = EXCLUDED.sort;

-- v1 endpoints that changed meaning keep their registry rows; refresh the descriptions that moved
UPDATE public.era_api_endpoints SET
  summary = 'Fare estimate',
  description = 'Estimate a ride or cargo fare with the booking engine''s own formula: max(minimum, base + per-km x distance) x the time-of-day multiplier, rounded to 100 UGX. Can price for a later time.',
  params = '[{"name":"km","in":"query","type":"number","required":true,"example":7.5,"description":"Distance in kilometres (0.1 to 300)."},
    {"name":"kind","in":"query","type":"string","required":false,"default":"ride","example":"cargo","description":"ride or cargo."},
    {"name":"at","in":"query","type":"string","required":false,"description":"Price for this ISO date-time. Default: now."}]'::JSONB
 WHERE id = 'bodagoera.fare_estimate';
UPDATE public.era_api_endpoints SET
  description = 'Every category on the platform: how many wholesale catalogue items and how many shelf products each holds.'
 WHERE id = 'supermarketera.categories';

-- Handlers and helpers are internal: only era_api_call (SECURITY DEFINER) reaches them.
DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND (p.proname LIKE 'era\_h\_%' OR p.proname LIKE 'era\_p\_%' OR p.proname LIKE 'era\_\_%') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;
