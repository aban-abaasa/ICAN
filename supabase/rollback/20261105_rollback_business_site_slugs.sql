-- ============================================================================
-- Rolls back 20261105100000_business_site_slugs.sql (icanera.space/<business-name> addresses).
--
-- Removes the addresses, their history and every function the feature added. Companies are left exactly as they are, and the old
-- icanera.space/notices/<company-id> links keep working (the app falls back to them when an address cannot be looked up).
-- NOTE: any address a business chose for itself is lost; running the migration again gives every business a fresh one from its name.
-- Safe to run more than once.
-- ============================================================================

DROP TRIGGER IF EXISTS cmms_company_site_slug ON public.cmms_company_profiles;
DROP FUNCTION IF EXISTS public.trg_cmms_company_site_slug();

DROP FUNCTION IF EXISTS public.fn_check_site_slug(TEXT, UUID);
DROP FUNCTION IF EXISTS public.fn_get_public_site_slugs(UUID[]);
DROP FUNCTION IF EXISTS public.fn_resolve_public_site_slug(TEXT);
DROP FUNCTION IF EXISTS public.fn_allocate_company_site_slug(TEXT, UUID);
DROP FUNCTION IF EXISTS public.fn_site_slug_problem(TEXT, UUID);
DROP FUNCTION IF EXISTS public.fn_site_slug_taken(TEXT, UUID);
DROP FUNCTION IF EXISTS public.fn_site_slug_base(TEXT);
DROP FUNCTION IF EXISTS public.fn_site_slug_is_reserved(TEXT);
DROP FUNCTION IF EXISTS public.fn_site_slug_is_brand(TEXT);
DROP FUNCTION IF EXISTS public.fn_site_slugify(TEXT);

DROP TABLE IF EXISTS public.cmms_company_site_slug_history;
DROP INDEX IF EXISTS public.uq_cmms_company_site_slug;
ALTER TABLE IF EXISTS public.cmms_company_profiles DROP COLUMN IF EXISTS site_slug;

NOTIFY pgrst, 'reload schema';

SELECT 'Business site addresses removed; companies untouched' AS status;
