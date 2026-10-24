-- ============================================================
-- Business website: show the store's products on the owner-created company
-- ============================================================
-- A business can have two company profiles: the one its owner created (linked by
-- pichin_business_profile_id only) and one auto-created for its store (linked by
-- business_profile_id). get_cmms_site_products only read business_profile_id, so
-- the owner's own website (e.g. ALLEN'S BOUTIQUE MEN'S WEAR) found no store and its
-- Market showed no products. It now falls back to pichin_business_profile_id.
-- Same function as 20261012100000_site_products_source.sql, one line changed.
-- Safe to run more than once.
-- ============================================================

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
  SELECT COALESCE(cp.business_profile_id, cp.pichin_business_profile_id), cp.site_products_source
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

SELECT 'get_cmms_site_products ready' AS status;
