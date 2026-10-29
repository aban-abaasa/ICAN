-- ============================================================
-- Business website: count every service as a service
-- ============================================================
-- A product is a service when products.is_service is set OR its inventory_mode is
-- 'service_item' (the admin's Services tab lists by inventory_mode). The two could
-- disagree -- e.g. an item switched to "Service item" in the editor -- and the website
-- then treated it as stock and hid it. get_cmms_site_products now accepts either.
-- Same function as 20261120100000_site_products_service_price_range.sql otherwise.
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
        'description', NULLIF(btrim(p.description), ''),
        'images', CASE
          WHEN jsonb_typeof(p.images) = 'array' AND jsonb_array_length(p.images) > 0 THEN p.images
          WHEN NULLIF(btrim(p.image_url), '') IS NOT NULL THEN jsonb_build_array(p.image_url)
          ELSE '[]'::jsonb END,
        'price', COALESCE(NULLIF(p.selling_price, 0), NULLIF(p.price, 0)),
        'price_max', CASE
          WHEN (COALESCE(p.is_service, FALSE) OR COALESCE(p.inventory_mode = 'service_item', FALSE))
            AND p.price_max > COALESCE(NULLIF(p.selling_price, 0), NULLIF(p.price, 0), 0)
          THEN p.price_max END,
        'currency', upper(COALESCE(NULLIF(btrim(s.price_currency), ''), 'UGX')),
        'is_service', (COALESCE(p.is_service, FALSE) OR COALESCE(p.inventory_mode = 'service_item', FALSE)),
        'in_stock', ((COALESCE(p.is_service, FALSE) OR COALESCE(p.inventory_mode = 'service_item', FALSE)) OR stock.qty > 0),
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
        AND (
          (COALESCE(p.is_service, FALSE) OR COALESCE(p.inventory_mode = 'service_item', FALSE))
          OR COALESCE(NULLIF(p.selling_price, 0), NULLIF(p.price, 0)) IS NOT NULL
        )
      ORDER BY p.name
      LIMIT 200
    ) q;
  END IF;

  RETURN jsonb_build_object('source', v_source, 'store_products', v_items);
END;
$$;

NOTIFY pgrst, 'reload schema';
