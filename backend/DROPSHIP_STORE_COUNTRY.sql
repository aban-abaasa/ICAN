-- =============================================================================
-- DROPSHIP_STORE_COUNTRY.sql
-- Run after DROPSHIP_BROWSE_PRODUCTS.sql (and DROPSHIP_RESELLERS_DIRECTORY.sql).
--
-- Adds `store_country` (the country the store owner chose at signup --
-- user_accounts.country_code -- falling back to the store's own supermarkets.country) to the two public shop RPCs so each product is priced in
-- its store's own country currency. Prices stay stored in UGX; the app converts
-- for display. Same signatures otherwise, same anon-readable posture.
-- =============================================================================

SET check_function_bodies = off;

DROP FUNCTION IF EXISTS public.get_dropship_browsable_products(TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.get_dropship_browsable_products(
  p_query  TEXT    DEFAULT '',
  p_limit  INTEGER DEFAULT 40,
  p_offset INTEGER DEFAULT 0
) RETURNS TABLE (
  product_id        UUID,
  name              TEXT,
  sku               TEXT,
  images            JSONB,
  brand             TEXT,
  min_price         NUMERIC,
  reseller_count    BIGINT,
  any_free_delivery BOOLEAN,
  any_in_stock      BOOLEAN,
  store_country     TEXT
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.id, p.name::TEXT, p.sku::TEXT, p.images, p.brand::TEXT,
    MIN(dl.listed_price) AS min_price,
    COUNT(*) AS reseller_count,
    BOOL_OR(dl.free_delivery) AS any_free_delivery,
    BOOL_OR(GREATEST(COALESCE(inv.current_stock - inv.reserved_stock, 0), 0) > 0) AS any_in_stock,
    MIN(COALESCE(ua.country_code, s.country))::TEXT AS store_country
  FROM public.dropship_listings dl
  JOIN public.products p ON p.id = dl.product_id
  LEFT JOIN public.inventory inv ON inv.product_id = p.id AND inv.supermarket_id = dl.supermarket_id
  LEFT JOIN public.supermarkets s ON s.id = dl.supermarket_id
  LEFT JOIN LATERAL (
    SELECT country_code FROM public.user_accounts
    WHERE user_id = s.owner_user_id AND country_code IS NOT NULL LIMIT 1
  ) ua ON TRUE
  WHERE dl.is_active = TRUE
    AND (p.is_active IS NULL OR p.is_active = TRUE)
    AND p.is_dropship_excluded = FALSE
    AND (p_query = '' OR p.name ILIKE '%' || p_query || '%' OR p.sku ILIKE '%' || p_query || '%' OR p.brand ILIKE '%' || p_query || '%')
  GROUP BY p.id, p.name, p.sku, p.images, p.brand
  ORDER BY p.name
  LIMIT p_limit OFFSET p_offset;
$$;

REVOKE ALL ON FUNCTION public.get_dropship_browsable_products(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dropship_browsable_products(TEXT, INTEGER, INTEGER) TO authenticated, anon;

DROP FUNCTION IF EXISTS public.get_dropship_product_offers(UUID);

CREATE OR REPLACE FUNCTION public.get_dropship_product_offers(p_product_id UUID)
RETURNS TABLE (
  listing_id                   UUID,
  reseller_business_profile_id UUID,
  reseller_name                TEXT,
  listed_price                 NUMERIC,
  free_delivery                BOOLEAN,
  available_stock              DECIMAL,
  in_stock                     BOOLEAN,
  store_country                TEXT
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    dl.id, dl.reseller_business_profile_id, bp.business_name::TEXT,
    dl.listed_price, dl.free_delivery,
    GREATEST(COALESCE(inv.current_stock - inv.reserved_stock, 0), 0) AS available_stock,
    GREATEST(COALESCE(inv.current_stock - inv.reserved_stock, 0), 0) > 0 AS in_stock,
    COALESCE(ua.country_code, s.country)::TEXT AS store_country
  FROM public.dropship_listings dl
  JOIN public.products p ON p.id = dl.product_id
  JOIN public.business_profiles bp ON bp.id = dl.reseller_business_profile_id
  LEFT JOIN public.inventory inv ON inv.product_id = p.id AND inv.supermarket_id = dl.supermarket_id
  LEFT JOIN public.supermarkets s ON s.id = dl.supermarket_id
  LEFT JOIN LATERAL (
    SELECT country_code FROM public.user_accounts
    WHERE user_id = s.owner_user_id AND country_code IS NOT NULL LIMIT 1
  ) ua ON TRUE
  WHERE dl.product_id = p_product_id
    AND dl.is_active = TRUE
    AND (p.is_active IS NULL OR p.is_active = TRUE)
    AND p.is_dropship_excluded = FALSE
  ORDER BY dl.listed_price ASC;
$$;

REVOKE ALL ON FUNCTION public.get_dropship_product_offers(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dropship_product_offers(UUID) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';

SELECT 'dropship store_country added to shop RPCs' AS status, now() AS run_at;
