-- =============================================================================
-- DROPSHIP_BROWSE_PRODUCTS.sql
-- Run after DROPSHIP_BUSINESS_WALLET_AND_DELIVERY.sql.
--
-- Lets ordinary ICAN users (with no reseller storefront of their own)
-- discover dropship-listed products directly, and lets Pichin/Pitchin
-- content posted by a reseller carry a "Buy Now" / "Order Now" tag back to
-- that reseller's storefront.
--
-- 1. get_dropship_browsable_products / get_dropship_product_offers
--    A global, cross-reseller product browse: one row per distinct product
--    currently listed by at least one active reseller (get_dropship_browsable_products),
--    expanding on click into that product's individual reseller offers
--    (get_dropship_product_offers) -- price, free delivery, stock. Same
--    "no auth required to browse" posture as get_dropship_storefront.
--
-- 2. get_business_storefronts / get_user_storefronts
--    Batched lookups so a feed of Pitchin pitches (which already carry
--    business_profile_id) or Status updates (which only carry user_id) can
--    resolve, in one round trip, which of the accounts in view currently
--    have a live dropship storefront to link a "Buy Now" tag to.
-- =============================================================================

SET check_function_bodies = off;

-- -----------------------------------------------------------------------------
-- SECTION 1 — get_dropship_browsable_products
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_dropship_browsable_products(TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.get_dropship_browsable_products(
  p_query  TEXT    DEFAULT '',
  p_limit  INTEGER DEFAULT 40,
  p_offset INTEGER DEFAULT 0
) RETURNS TABLE (
  product_id      UUID,
  name            TEXT,
  sku             TEXT,
  images          JSONB,
  brand           TEXT,
  min_price       NUMERIC,
  reseller_count  BIGINT,
  any_free_delivery BOOLEAN,
  any_in_stock    BOOLEAN
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.id, p.name::TEXT, p.sku::TEXT, p.images, p.brand::TEXT,
    MIN(dl.listed_price) AS min_price,
    COUNT(*) AS reseller_count,
    BOOL_OR(dl.free_delivery) AS any_free_delivery,
    BOOL_OR(GREATEST(COALESCE(inv.current_stock - inv.reserved_stock, 0), 0) > 0) AS any_in_stock
  FROM public.dropship_listings dl
  JOIN public.products p ON p.id = dl.product_id
  LEFT JOIN public.inventory inv ON inv.product_id = p.id AND inv.supermarket_id = dl.supermarket_id
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

-- -----------------------------------------------------------------------------
-- SECTION 2 — get_dropship_product_offers
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_dropship_product_offers(UUID);

CREATE OR REPLACE FUNCTION public.get_dropship_product_offers(p_product_id UUID)
RETURNS TABLE (
  listing_id       UUID,
  reseller_business_profile_id UUID,
  reseller_name    TEXT,
  listed_price     NUMERIC,
  free_delivery    BOOLEAN,
  available_stock  DECIMAL,
  in_stock         BOOLEAN
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    dl.id, dl.reseller_business_profile_id, bp.business_name::TEXT,
    dl.listed_price, dl.free_delivery,
    GREATEST(COALESCE(inv.current_stock - inv.reserved_stock, 0), 0) AS available_stock,
    GREATEST(COALESCE(inv.current_stock - inv.reserved_stock, 0), 0) > 0 AS in_stock
  FROM public.dropship_listings dl
  JOIN public.products p ON p.id = dl.product_id
  JOIN public.business_profiles bp ON bp.id = dl.reseller_business_profile_id
  LEFT JOIN public.inventory inv ON inv.product_id = p.id AND inv.supermarket_id = dl.supermarket_id
  WHERE dl.product_id = p_product_id
    AND dl.is_active = TRUE
    AND (p.is_active IS NULL OR p.is_active = TRUE)
    AND p.is_dropship_excluded = FALSE
  ORDER BY dl.listed_price ASC;
$$;

REVOKE ALL ON FUNCTION public.get_dropship_product_offers(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dropship_product_offers(UUID) TO authenticated, anon;

-- -----------------------------------------------------------------------------
-- SECTION 3 — get_business_storefronts (for Pitchin's business_profile_id)
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_business_storefronts(UUID[]);

CREATE OR REPLACE FUNCTION public.get_business_storefronts(p_business_profile_ids UUID[])
RETURNS TABLE (
  business_profile_id UUID,
  business_name        TEXT
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT bp.id, bp.business_name::TEXT
  FROM public.business_profiles bp
  WHERE bp.id = ANY(p_business_profile_ids)
    AND EXISTS (
      SELECT 1 FROM public.dropship_listings dl
      JOIN public.products p ON p.id = dl.product_id
      WHERE dl.reseller_business_profile_id = bp.id
        AND dl.is_active = TRUE
        AND (p.is_active IS NULL OR p.is_active = TRUE)
        AND p.is_dropship_excluded = FALSE
    );
$$;

REVOKE ALL ON FUNCTION public.get_business_storefronts(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_business_storefronts(UUID[]) TO authenticated, anon;

-- -----------------------------------------------------------------------------
-- SECTION 4 — get_user_storefronts (for Status updates' user_id)
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_user_storefronts(UUID[]);

CREATE OR REPLACE FUNCTION public.get_user_storefronts(p_user_ids UUID[])
RETURNS TABLE (
  user_id              UUID,
  business_profile_id  UUID,
  business_name        TEXT
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ON (bp.user_id)
    bp.user_id, bp.id, bp.business_name::TEXT
  FROM public.business_profiles bp
  JOIN public.dropship_listings dl ON dl.reseller_business_profile_id = bp.id
  JOIN public.products p ON p.id = dl.product_id
  WHERE bp.user_id = ANY(p_user_ids)
    AND dl.is_active = TRUE
    AND (p.is_active IS NULL OR p.is_active = TRUE)
    AND p.is_dropship_excluded = FALSE
  ORDER BY bp.user_id, dl.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_user_storefronts(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_storefronts(UUID[]) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- VERIFY
-- -----------------------------------------------------------------------------
SELECT 'dropship browse + storefront-tag lookups installed' AS status, now() AS run_at;
