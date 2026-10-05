-- Rolls back the Era API: v1 (20261005100000_era_api.sql, ..100100_era_api_endpoints.sql) and v2, the business layer
-- (20261006100000_era_api_business.sql, ..100100_era_api_business_endpoints.sql). Run it once to remove both.
-- DESTRUCTIVE: deletes every registered developer app, key, usage count and the call log. Nothing else in the
-- platform depends on these objects. To pause the API without losing anything, use the master switch in the
-- developer panel's API tab instead.
-- Your own payment_requests / mbg_rides rows are never touched; only the API's link tables are dropped.
DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND (p.proname LIKE 'era\_api\_%' OR p.proname LIKE 'era\_h\_%' OR p.proname LIKE 'era\_p\_%' OR p.proname LIKE 'era\_\_%') LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', f.sig);
  END LOOP;
END $$;

DROP TABLE IF EXISTS public.era_api_idempotency CASCADE;
DROP TABLE IF EXISTS public.era_api_payment_links CASCADE;
DROP TABLE IF EXISTS public.era_api_booking_intents CASCADE;
DROP TABLE IF EXISTS public.era_api_chain_config CASCADE;
DROP TABLE IF EXISTS public.era_api_audit CASCADE;
DROP TABLE IF EXISTS public.era_api_log CASCADE;
DROP TABLE IF EXISTS public.era_api_usage CASCADE;
DROP TABLE IF EXISTS public.era_api_keys CASCADE;
DROP TABLE IF EXISTS public.era_api_clients CASCADE;
DROP TABLE IF EXISTS public.era_api_endpoints CASCADE;
DROP TABLE IF EXISTS public.era_api_admins CASCADE;
DROP TABLE IF EXISTS public.era_api_settings CASCADE;
