-- ============================================================
-- Business website: choose where the Shop tab's products come from
-- ============================================================
-- The public business website (/notices/<companyId>) only ever read Dropship
-- listings (get_dropship_storefront), so a business that is a STORE with its own
-- products showed no Shop tab at all. The CMMS "Products & services" settings now
-- choose the source:
--
--   resellers  the linked business's Dropship listings (what it always showed; default)
--   store      the products of the store linked to that business
--   both       the two together
--
-- A business "has a store" when business_profiles.supermarket_id points at it or
-- supermarkets.pichin_business_profile_id points back at the business. A store that
-- merely shares the same owner is NOT included: it belongs to another business.
--
-- Store products are shown as a catalog (name, photo, price, stock). They are not
-- added to a cart here; this file adds no payment logic. Run after
-- CMMS_NOTICE_BOARD_PRODUCTS.sql. Safe to run more than once.
-- ============================================================

ALTER TABLE public.cmms_company_profiles
  ADD COLUMN IF NOT EXISTS site_products_source TEXT NOT NULL DEFAULT 'resellers';

ALTER TABLE public.cmms_company_profiles
  DROP CONSTRAINT IF EXISTS cmms_company_site_products_source_chk;
ALTER TABLE public.cmms_company_profiles
  ADD CONSTRAINT cmms_company_site_products_source_chk
  CHECK (site_products_source IN ('resellers', 'store', 'both'));

-- Same permission as linking the storefront (edit on the announcements tool).
CREATE OR REPLACE FUNCTION public.fn_set_cmms_company_site_products_source(
  p_company_id UUID,
  p_source TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('resellers', 'store', 'both') THEN
    RAISE EXCEPTION 'Products source must be resellers, store or both';
  END IF;
  IF NOT public.cmms_has_tool_action(p_company_id, 'announcements', 'edit') THEN
    RAISE EXCEPTION 'You do not have permission to manage this company''s products';
  END IF;

  UPDATE public.cmms_company_profiles
  SET site_products_source = p_source, updated_at = NOW()
  WHERE id = p_company_id;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_set_cmms_company_site_products_source(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_set_cmms_company_site_products_source(UUID, TEXT) TO authenticated;

-- Public read for the website: the chosen source plus, when it includes the store,
-- that store's products. Nothing is returned for 'resellers' beyond the source.
CREATE OR REPLACE FUNCTION public.get_cmms_site_products(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id UUID;
  v_source TEXT;
  v_items JSONB := '[]'::jsonb;
BEGIN
  SELECT cp.business_profile_id, cp.site_products_source
    INTO v_business_id, v_source
  FROM public.cmms_company_profiles cp
  WHERE cp.id = p_company_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('source', 'resellers', 'store_products', '[]'::jsonb);
  END IF;

  IF v_business_id IS NOT NULL AND v_source IN ('store', 'both') THEN
    SELECT COALESCE(jsonb_agg(item ORDER BY item->>'name'), '[]'::jsonb) INTO v_items
    FROM (
      SELECT jsonb_build_object(
        'product_id', p.id,
        'name', p.name,
        'brand', p.brand,
        'images', CASE
          WHEN jsonb_typeof(p.images) = 'array' AND jsonb_array_length(p.images) > 0 THEN p.images
          WHEN NULLIF(btrim(p.image_url), '') IS NOT NULL THEN jsonb_build_array(p.image_url)
          ELSE '[]'::jsonb END,
        'price', COALESCE(NULLIF(p.selling_price, 0), NULLIF(p.price, 0)),
        'currency', upper(COALESCE(NULLIF(btrim(s.price_currency), ''), 'UGX')),
        'is_service', COALESCE(p.is_service, FALSE),
        'in_stock', (COALESCE(p.is_service, FALSE) OR stock.qty > 0),
        'store_name', s.name
      ) AS item
      FROM public.business_profiles bp
      JOIN public.supermarkets s ON s.id = bp.supermarket_id OR s.pichin_business_profile_id = bp.id
      JOIN public.products p ON p.supermarket_id = s.id
      LEFT JOIN LATERAL (
        SELECT GREATEST(COALESCE(SUM(i.current_stock - COALESCE(i.reserved_stock, 0)), 0), 0) AS qty
        FROM public.inventory i
        WHERE i.product_id = p.id AND i.supermarket_id = s.id
      ) stock ON TRUE
      WHERE bp.id = v_business_id
        AND COALESCE(s.is_active, TRUE)
        AND COALESCE(p.is_active, TRUE)
        AND COALESCE(NULLIF(p.selling_price, 0), NULLIF(p.price, 0)) IS NOT NULL
      ORDER BY p.name
      LIMIT 200
    ) q;
  END IF;

  RETURN jsonb_build_object('source', v_source, 'store_products', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.get_cmms_site_products(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cmms_site_products(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'Business website products source ready (resellers / store / both)' AS status;
