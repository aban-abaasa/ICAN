\set ON_ERROR_STOP on
-- The "businesses on IcanEra" counts in the public sector feed: taken from the business profiles, anonymous, only while a
-- sector is warming up, and never a source of price. Everything runs in a transaction that is rolled back.

BEGIN;
DELETE FROM public.business_profiles;
TRUNCATE icanera_trading.data_terms_acceptance, icanera_trading.telemetry_events, icanera_trading.contributor_buckets,
         icanera_trading.sector_index_cache, icanera_trading.sector_index_candles, icanera_trading.sector_registered_cache;
UPDATE icanera_trading.fold_state SET folded_at = NULL, last_bucket = NULL;
UPDATE icanera_trading.sector_settings SET k_min = 3, trading_enabled = FALSE;

INSERT INTO public.business_profiles (id, user_id, business_name, business_type, status, metadata) VALUES
  ('c0000000-0000-0000-0000-000000000001', t.u(1), 'Shop A',    'LLC', 'active',   '{"category_key":"retail"}'),
  ('c0000000-0000-0000-0000-000000000002', t.u(1), 'Shop B',    'LLC', 'active',   '{"category_key":"retail"}'),
  ('c0000000-0000-0000-0000-000000000003', t.u(2), 'Farm C',    'LLC', 'active',   '{"category_key":"farm"}'),
  ('c0000000-0000-0000-0000-000000000004', t.u(2), 'Gov D',     'LLC', 'active',   '{"category_key":"government"}'),
  ('c0000000-0000-0000-0000-000000000005', t.u(2), 'Closed E',  'LLC', 'inactive', '{"category_key":"retail"}'),
  ('c0000000-0000-0000-0000-000000000006', t.u(3), 'Shop F',    'LLC', 'active',   '{"category_key":"retail"}');
-- Shop A has agreed to share its sales; the others have not
INSERT INTO icanera_trading.data_terms_acceptance (business_id, terms_version, accepted_by)
  SELECT 'c0000000-0000-0000-0000-000000000001', s.current_terms_version, t.u(1) FROM icanera_trading.sector_settings s WHERE s.id;

DO $t$
DECLARE f JSONB; retl JSONB; agri JSONB; tech JSONB;
BEGIN
  PERFORM icanera_trading.refresh_registered_businesses(TRUE);
  PERFORM t.as_anon();
  f := public.ican_get_sector_feed();
  PERFORM t.reset();
  SELECT x INTO retl FROM jsonb_array_elements(f -> 'sectors') x WHERE x ->> 'ticker' = 'iRETL';
  SELECT x INTO agri FROM jsonb_array_elements(f -> 'sectors') x WHERE x ->> 'ticker' = 'iAGRI';
  SELECT x INTO tech FROM jsonb_array_elements(f -> 'sectors') x WHERE x ->> 'ticker' = 'iTECH';

  PERFORM t.check('4.1 retail counts its 3 active businesses (the inactive one and the unmapped government one are left out)',
    (retl ->> 'registered')::INT = 3, retl::TEXT);
  PERFORM t.check('4.2 ...and 1 of them has agreed to share sales', (retl ->> 'sharing')::INT = 1, retl::TEXT);
  PERFORM t.check('4.3 agriculture counts its one farm, none sharing', (agri ->> 'registered')::INT = 1 AND (agri ->> 'sharing')::INT = 0, agri::TEXT);
  PERFORM t.check('4.4 a sector with no businesses says 0, not nothing', (tech ->> 'registered')::INT = 0, tech::TEXT);
  PERFORM t.check('4.5 only counts are published: no names, no ids',
    f::TEXT NOT LIKE '%Shop A%' AND f::TEXT NOT LIKE '%c0000000%', f::TEXT);
  PERFORM t.check('4.6 the profile counts never become a level or a price: the sector is still warming up with no level',
    retl ->> 'status' = 'warming_up' AND retl -> 'level' = 'null'::JSONB AND NOT (retl ->> 'tradable')::BOOLEAN, retl::TEXT);
  PERFORM t.check('4.7 the cache and its refresh are closed to the API roles',
    NOT has_table_privilege('anon', 'icanera_trading.sector_registered_cache', 'SELECT')
    AND NOT has_function_privilege('anon', 'icanera_trading.refresh_registered_businesses(boolean)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'icanera_trading.refresh_registered_businesses(boolean)', 'EXECUTE'));

  -- a business that joins is picked up by a refresh, and a stale cache is refreshed by the next viewer
  INSERT INTO public.business_profiles (id, user_id, business_name, business_type, status, metadata)
  VALUES ('c0000000-0000-0000-0000-000000000007', t.u(4), 'Shop G', 'LLC', 'active', '{"category_key":"retail"}');
  PERFORM icanera_trading.refresh_registered_businesses(FALSE);
  PERFORM t.check('4.8 a fresh cache is not recounted on every call',
    (SELECT registered FROM icanera_trading.sector_registered_cache WHERE ticker = 'iRETL') = 3);
  UPDATE icanera_trading.sector_registered_cache SET computed_at = clock_timestamp() - INTERVAL '11 minutes';
  PERFORM icanera_trading.refresh_registered_businesses(FALSE);
  PERFORM t.check('4.9 a stale cache is recounted and the new business appears',
    (SELECT registered FROM icanera_trading.sector_registered_cache WHERE ticker = 'iRETL') = 4);

  -- once a sector has a level it no longer shows the counts
  PERFORM t.check('4.10 a live sector publishes no business counts',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.ican_get_sector_feed() -> 'sectors') x
                 WHERE x ->> 'status' = 'live' AND (x -> 'registered') <> 'null'::JSONB));
END $t$;
ROLLBACK;
