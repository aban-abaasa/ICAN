-- Rolls back the Era API (supabase/migrations/20261005100000_era_api.sql and ..100100_era_api_endpoints.sql).
-- DESTRUCTIVE: deletes every registered developer app, key, usage count and the call log. Nothing else in the
-- platform depends on these objects. To pause the API without losing anything, use the master switch in the
-- developer panel's API tab instead.
DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND (p.proname LIKE 'era\_api\_%' OR p.proname LIKE 'era\_h\_%' OR p.proname LIKE 'era\_p\_%' OR p.proname LIKE 'era\_\_%') LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', f.sig);
  END LOOP;
END $$;

DROP TABLE IF EXISTS public.era_api_audit CASCADE;
DROP TABLE IF EXISTS public.era_api_log CASCADE;
DROP TABLE IF EXISTS public.era_api_usage CASCADE;
DROP TABLE IF EXISTS public.era_api_keys CASCADE;
DROP TABLE IF EXISTS public.era_api_clients CASCADE;
DROP TABLE IF EXISTS public.era_api_endpoints CASCADE;
DROP TABLE IF EXISTS public.era_api_admins CASCADE;
DROP TABLE IF EXISTS public.era_api_settings CASCADE;
