\set ON_ERROR_STOP on
-- Fixed assets recorded in CMMS count in the sector index: only with consent to the asset clause, only for a business that
-- also has sales, capped like sales, never published, and switched off by asset_weight = 0.
-- CMMS is not part of the test stack, so the three objects the asset count reads are stood in here (same names and columns).

CREATE TABLE public.cmms_company_profiles (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pichin_business_profile_id UUID, currency VARCHAR(3) NOT NULL DEFAULT 'UGX');
CREATE TABLE public.cmms_inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), cmms_company_id UUID NOT NULL, item_kind VARCHAR(20) NOT NULL DEFAULT 'asset',
  quantity_in_stock NUMERIC DEFAULT 1, is_active BOOLEAN DEFAULT TRUE, acquisition_cost NUMERIC, acquisition_year INT, acquisition_date DATE,
  useful_life_years INT, salvage_value NUMERIC DEFAULT 0, depreciation_method VARCHAR(20), disposed_at TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION public.fn_cmms_accum_depreciation(
  p_cost NUMERIC, p_salvage NUMERIC, p_life INT, p_method TEXT, p_acq_year INT, p_as_of_year INT
) RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_method IS NULL OR p_method = 'none'
      OR p_life IS NULL OR p_life <= 0
      OR p_acq_year IS NULL OR p_as_of_year IS NULL OR p_as_of_year < p_acq_year
      OR COALESCE(p_cost, 0) <= 0 THEN 0
    WHEN p_method = 'declining_balance' THEN
      GREATEST(0, ROUND(LEAST(
        p_cost - COALESCE(p_salvage, 0),
        p_cost - p_cost * power(1 - LEAST(2.0 / p_life, 1.0),
                                LEAST(p_as_of_year - p_acq_year + 1, p_life))
      ), 2))
    ELSE
      GREATEST(0, ROUND(LEAST(
        p_cost - COALESCE(p_salvage, 0),
        (p_cost - COALESCE(p_salvage, 0)) / p_life * (p_as_of_year - p_acq_year + 1)
      ), 2))
  END;
$$;

-- (no wrapping transaction: a ROLLBACK would also discard the recorded results)
DELETE FROM public.business_profiles;
TRUNCATE icanera_trading.data_terms_acceptance, icanera_trading.telemetry_events, icanera_trading.contributor_buckets,
         icanera_trading.sector_index_cache, icanera_trading.sector_index_candles, icanera_trading.contributor_assets,
         icanera_trading.contributor_assets_meta;
UPDATE icanera_trading.fold_state SET folded_at = NULL, last_bucket = NULL;
UPDATE icanera_trading.sector_settings SET k_min = 3, trading_enabled = FALSE, ema_minutes = 30, max_move_pct_per_hour = 10,
       contributor_cap_multiple = 3, window_hours = 24, stale_s = 120, current_terms_version = 1, asset_terms_version = 2, asset_weight = 0.00001;

INSERT INTO public.business_profiles (id, user_id, business_name, business_type, status, metadata) VALUES
  ('a5000000-0000-0000-0000-000000000001', t.u(1), 'Shop 1', 'LLC', 'active', '{"category_key":"retail"}'),
  ('a5000000-0000-0000-0000-000000000002', t.u(2), 'Shop 2', 'LLC', 'active', '{"category_key":"retail"}'),
  ('a5000000-0000-0000-0000-000000000003', t.u(3), 'Shop 3', 'LLC', 'active', '{"category_key":"retail"}'),
  ('a5000000-0000-0000-0000-000000000004', t.u(4), 'Shop 4', 'LLC', 'active', '{"category_key":"retail"}');   -- assets, no sales
-- all four agreed to the v1 clause (sales); nobody has accepted the asset clause yet
INSERT INTO icanera_trading.data_terms_acceptance (business_id, terms_version, accepted_by)
  SELECT b.id, 1, b.user_id FROM public.business_profiles b;
-- sales: 100 each for businesses 1-3 (this is the whole sector, k_min = 3)
INSERT INTO icanera_trading.telemetry_events (source, source_ref, kind, sector, contributor_key, amount_ugx, event_time)
  SELECT 't', gen_random_uuid()::TEXT, 'sale', 'iRETL', icanera_trading.contributor_key(b.id), 100, clock_timestamp() - INTERVAL '1 minute'
    FROM public.business_profiles b WHERE b.business_name IN ('Shop 1', 'Shop 2', 'Shop 3');
-- one company per business; each carries one fixed asset: cost 10,000,000, 10-year straight line, bought this year => NBV 9,000,000
INSERT INTO public.cmms_company_profiles (id, pichin_business_profile_id)
  SELECT ('c5000000-0000-0000-0000-00000000000' || right(b.id::TEXT, 1))::UUID, b.id FROM public.business_profiles b;
INSERT INTO public.cmms_inventory_items (cmms_company_id, item_kind, quantity_in_stock, acquisition_cost, acquisition_year, useful_life_years, depreciation_method)
  SELECT c.id, 'asset', 1, 10000000, EXTRACT(YEAR FROM now())::INT, 10, 'straight_line' FROM public.cmms_company_profiles c;

CREATE FUNCTION pg_temp.fold_raw() RETURNS NUMERIC LANGUAGE sql AS $$
  SELECT icanera_trading.fold_sector_indices(TRUE, TRUE);
  SELECT v_raw FROM icanera_trading.sector_index_cache WHERE ticker = 'iRETL' $$;

DO $t$
DECLARE v NUMERIC; n INT; f JSONB;
BEGIN
  -- 5.1 no business has accepted the asset clause: the assets count for nothing
  PERFORM icanera_trading.refresh_contributor_assets(TRUE);
  PERFORM t.check('5.1 without the asset clause no asset is counted', (SELECT COUNT(*) FROM icanera_trading.contributor_assets) = 0);
  v := pg_temp.fold_raw();
  PERFORM t.check('5.2 ...and the index is sales only (mean 100)', v = 100, v::TEXT);

  -- 5.3 business 1 and 4 accept the asset clause (version 2)
  INSERT INTO icanera_trading.data_terms_acceptance (business_id, terms_version, accepted_by)
    SELECT b.id, 2, b.user_id FROM public.business_profiles b WHERE b.business_name IN ('Shop 1', 'Shop 4');
  PERFORM icanera_trading.refresh_contributor_assets(TRUE);
  PERFORM t.check('5.3 only businesses that accepted the asset clause are counted (1 and 4)', (SELECT COUNT(*) FROM icanera_trading.contributor_assets) = 2);
  PERFORM t.check('5.4 net book value is cost less depreciation: 9,000,000',
    (SELECT asset_value_ugx FROM icanera_trading.contributor_assets WHERE contributor_key = icanera_trading.contributor_key('a5000000-0000-0000-0000-000000000001')) = 9000000);
  v := pg_temp.fold_raw();
  PERFORM t.check('5.5 business 1 counts 100 + 0.00001 x 9,000,000 = 190; mean of 190, 100, 100 = 130', v = 130, v::TEXT);
  SELECT contributors INTO n FROM icanera_trading.sector_index_cache WHERE ticker = 'iRETL';
  PERFORM t.check('5.6 business 4 has assets but no sales: it is not a contributor', n = 3, n::TEXT);

  -- 5.7 the per-business cap applies to the combined figure: a huge asset cannot count for more than 3 x the median (300)
  UPDATE public.cmms_inventory_items SET acquisition_cost = 100000000000
   WHERE cmms_company_id = 'c5000000-0000-0000-0000-000000000001';
  PERFORM icanera_trading.refresh_contributor_assets(TRUE);
  v := pg_temp.fold_raw();
  PERFORM t.check('5.7 an enormous asset is capped like enormous sales: (300 + 100 + 100) / 3', round(v, 4) = round(500 / 3.0, 4), v::TEXT);
  UPDATE public.cmms_inventory_items SET acquisition_cost = 10000000 WHERE cmms_company_id = 'c5000000-0000-0000-0000-000000000001';

  -- 5.8 what does not count: disposed, inactive, a consumable, another currency, no purchase year, no cost
  INSERT INTO public.cmms_company_profiles (id, pichin_business_profile_id, currency) VALUES ('c5000000-0000-0000-0000-0000000000f1', 'a5000000-0000-0000-0000-000000000001', 'USD');
  INSERT INTO public.cmms_inventory_items (cmms_company_id, item_kind, quantity_in_stock, is_active, disposed_at, acquisition_cost, acquisition_year, useful_life_years, depreciation_method) VALUES
    ('c5000000-0000-0000-0000-000000000001', 'asset',      1, TRUE,  now(), 9000000, EXTRACT(YEAR FROM now())::INT, 10, 'straight_line'),   -- disposed
    ('c5000000-0000-0000-0000-000000000001', 'asset',      1, FALSE, NULL,  9000000, EXTRACT(YEAR FROM now())::INT, 10, 'straight_line'),   -- inactive
    ('c5000000-0000-0000-0000-000000000001', 'consumable', 1, TRUE,  NULL,  9000000, EXTRACT(YEAR FROM now())::INT, 10, 'straight_line'),   -- not an asset
    ('c5000000-0000-0000-0000-000000000001', 'asset',      1, TRUE,  NULL,  9000000, NULL, 10, 'straight_line'),                              -- no purchase year
    ('c5000000-0000-0000-0000-000000000001', 'asset',      1, TRUE,  NULL,  0,       EXTRACT(YEAR FROM now())::INT, 10, 'straight_line'),   -- no cost
    ('c5000000-0000-0000-0000-0000000000f1', 'asset',      1, TRUE,  NULL,  9000000, EXTRACT(YEAR FROM now())::INT, 10, 'straight_line');   -- company kept in USD
  PERFORM icanera_trading.refresh_contributor_assets(TRUE);
  PERFORM t.check('5.8 disposed, inactive, consumable, undated, free and foreign-currency items add nothing',
    (SELECT asset_value_ugx FROM icanera_trading.contributor_assets WHERE contributor_key = icanera_trading.contributor_key('a5000000-0000-0000-0000-000000000001')) = 9000000);

  -- 5.9 quantity multiplies
  UPDATE public.cmms_inventory_items SET quantity_in_stock = 2 WHERE cmms_company_id = 'c5000000-0000-0000-0000-000000000001' AND disposed_at IS NULL AND is_active AND item_kind = 'asset' AND acquisition_year IS NOT NULL AND acquisition_cost = 10000000;
  PERFORM icanera_trading.refresh_contributor_assets(TRUE);
  PERFORM t.check('5.9 two units are worth twice one', (SELECT asset_value_ugx FROM icanera_trading.contributor_assets WHERE contributor_key = icanera_trading.contributor_key('a5000000-0000-0000-0000-000000000001')) = 18000000);
  UPDATE public.cmms_inventory_items SET quantity_in_stock = 1 WHERE acquisition_cost = 10000000;
  PERFORM icanera_trading.refresh_contributor_assets(TRUE);

  -- 5.10 nothing about assets is public
  PERFORM t.as_anon();
  f := public.ican_get_sector_feed();
  PERFORM t.reset();
  PERFORM t.check('5.10 the public feed carries no asset figure, business or key',
    f::TEXT NOT LIKE '%9000000%' AND f::TEXT NOT LIKE '%asset%' AND f::TEXT NOT LIKE '%Shop _%' AND f::TEXT NOT LIKE '%a5000000%'
    AND f::TEXT NOT LIKE '%' || icanera_trading.contributor_key('a5000000-0000-0000-0000-000000000001') || '%');
  PERFORM t.check('5.11 the asset tables and refresh are closed to the API roles',
    NOT has_table_privilege('anon', 'icanera_trading.contributor_assets', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'icanera_trading.contributor_assets', 'SELECT')
    AND NOT has_function_privilege('anon', 'icanera_trading.refresh_contributor_assets(boolean)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'icanera_trading.refresh_contributor_assets(boolean)', 'EXECUTE'));

  -- 5.12 a fresh cache is not recounted on every call; a stale one is
  DELETE FROM public.cmms_inventory_items WHERE cmms_company_id = 'c5000000-0000-0000-0000-000000000004';
  PERFORM icanera_trading.refresh_contributor_assets(FALSE);
  PERFORM t.check('5.12 within 10 minutes the cache is kept', (SELECT COUNT(*) FROM icanera_trading.contributor_assets) = 2);
  UPDATE icanera_trading.contributor_assets_meta SET computed_at = clock_timestamp() - INTERVAL '11 minutes';
  PERFORM icanera_trading.refresh_contributor_assets(FALSE);
  PERFORM t.check('5.13 after 10 minutes it is recounted', (SELECT COUNT(*) FROM icanera_trading.contributor_assets) = 1);

  -- 5.14 asset_weight = 0 switches assets off
  UPDATE icanera_trading.sector_settings SET asset_weight = 0;
  PERFORM icanera_trading.refresh_contributor_assets(TRUE);
  PERFORM t.check('5.14 weight 0 stores nothing', (SELECT COUNT(*) FROM icanera_trading.contributor_assets) = 0);
  v := pg_temp.fold_raw();
  PERFORM t.check('5.15 ...and the index is back to sales only', v = 100, v::TEXT);
END $t$;

-- leave the stack as the next test expects it
DELETE FROM public.business_profiles;
TRUNCATE icanera_trading.data_terms_acceptance, icanera_trading.telemetry_events, icanera_trading.contributor_buckets,
         icanera_trading.sector_index_cache, icanera_trading.sector_index_candles, icanera_trading.contributor_assets,
         icanera_trading.contributor_assets_meta;
UPDATE icanera_trading.fold_state SET folded_at = NULL, last_bucket = NULL;
UPDATE icanera_trading.sector_settings SET asset_weight = 0.001, k_min = 10;

DROP FUNCTION public.fn_cmms_accum_depreciation(NUMERIC, NUMERIC, INT, TEXT, INT, INT);
DROP TABLE public.cmms_inventory_items, public.cmms_company_profiles;
