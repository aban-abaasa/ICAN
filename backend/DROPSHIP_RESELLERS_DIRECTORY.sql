-- =============================================================================
-- DROPSHIP_RESELLERS_DIRECTORY.sql
-- Run after DROPSHIP_BROWSE_PRODUCTS.sql.
--
-- get_dropship_resellers: one row per reseller (business profile) that
-- currently has at least one live dropship listing -- powers the wallet's
-- "Resellers" tab. store_country is the source store owner's signup country (user_accounts.country_code, else supermarkets.country),
-- so prices can be shown in that country's currency. Same "no auth required to browse" posture as
-- get_dropship_storefront / get_dropship_browsable_products.
-- =============================================================================

SET check_function_bodies = off;

DROP FUNCTION IF EXISTS public.get_dropship_resellers(TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.get_dropship_resellers(
  p_query  TEXT    DEFAULT '',
  p_limit  INTEGER DEFAULT 60,
  p_offset INTEGER DEFAULT 0
) RETURNS TABLE (
  business_profile_id UUID,
  business_name       TEXT,
  product_count       BIGINT,
  min_price           NUMERIC,
  any_free_delivery   BOOLEAN,
  any_in_stock        BOOLEAN,
  store_country       TEXT
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    bp.id, bp.business_name::TEXT,
    COUNT(*) AS product_count,
    MIN(dl.listed_price) AS min_price,
    BOOL_OR(dl.free_delivery) AS any_free_delivery,
    BOOL_OR(GREATEST(COALESCE(inv.current_stock - inv.reserved_stock, 0), 0) > 0) AS any_in_stock,
    MIN(COALESCE(ua.country_code, s.country))::TEXT AS store_country
  FROM public.dropship_listings dl
  JOIN public.products p ON p.id = dl.product_id
  JOIN public.business_profiles bp ON bp.id = dl.reseller_business_profile_id
  LEFT JOIN public.inventory inv ON inv.product_id = p.id AND inv.supermarket_id = dl.supermarket_id
  LEFT JOIN public.supermarkets s ON s.id = dl.supermarket_id
  LEFT JOIN LATERAL (
    SELECT country_code FROM public.user_accounts
    WHERE user_id = s.owner_user_id AND country_code IS NOT NULL LIMIT 1
  ) ua ON TRUE
  WHERE dl.is_active = TRUE
    AND (p.is_active IS NULL OR p.is_active = TRUE)
    AND p.is_dropship_excluded = FALSE
    AND (p_query = '' OR bp.business_name ILIKE '%' || p_query || '%')
  GROUP BY bp.id, bp.business_name
  ORDER BY bp.business_name
  LIMIT p_limit OFFSET p_offset;
$$;

REVOKE ALL ON FUNCTION public.get_dropship_resellers(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dropship_resellers(TEXT, INTEGER, INTEGER) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';

SELECT 'dropship reseller directory installed' AS status, now() AS run_at;
