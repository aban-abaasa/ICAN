-- ============================================================
-- Business website Market tab: load the store's own products automatically
-- ============================================================
-- site_products_source used to default to 'resellers', so a business that IS a store
-- showed none of its own products on its website until an admin switched the setting.
-- The website now always has a Market tab, and a store's products should simply be in
-- it. New websites default to 'both' (reseller listings + the store's own products),
-- and websites still on the old default are moved to 'both'. A business with no store
-- is unaffected: 'both' only adds the store's products when there is a store.
-- Safe to run more than once.
-- ============================================================

ALTER TABLE public.cmms_company_profiles
  ALTER COLUMN site_products_source SET DEFAULT 'both';

UPDATE public.cmms_company_profiles
SET site_products_source = 'both'
WHERE site_products_source = 'resellers';

NOTIFY pgrst, 'reload schema';

SELECT 'Business website Market tab now loads store products by default' AS status;
