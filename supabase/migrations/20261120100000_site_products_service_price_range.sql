-- ============================================================
-- Business website: service price ranges, and services without a price
-- ============================================================
-- get_cmms_site_products now also returns, per item:
--   description -- what a service includes (shown on its row)
--   price_max   -- top of a service price range (products.price_max, see the
--                  digital-city-era migration ADD_SERVICE_PRICE_RANGE.sql);
--                  only for a service whose top is above its lowest price
-- and no longer hides a SERVICE just because it has no price: those show on the
-- website as "Ask for a quote". Goods still need a price to be listed.
-- Same function as 20261117100000_site_products_owner_company_link.sql otherwise.
-- Safe to run more than once. Needs products.price_max (run that migration first).
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
          WHEN COALESCE(p.is_service, FALSE)
            AND p.price_max > COALESCE(NULLIF(p.selling_price, 0), NULLIF(p.price, 0), 0)
          THEN p.price_max END,
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
        AND (
          COALESCE(p.is_service, FALSE)
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
