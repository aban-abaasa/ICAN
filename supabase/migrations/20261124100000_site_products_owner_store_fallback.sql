-- ============================================================
-- Business website: show the owner's same-named store when the profile has none linked
-- ============================================================
-- A business can have its website created first and its store onboarded later (digital-city-era creates a SECOND
-- business profile for the store). The store is then linked only to the second profile, so the original, public
-- address (e.g. /godmindera-organisation-u-ltd) shows "This market has nothing listed yet" while the same
-- business's other addresses show everything.
-- get_cmms_site_products now falls back, ONLY for a business profile that has no store linked at all, to the store
-- its owner runs under the SAME business name. Read-only; nothing is relinked. A profile that has a linked store
-- behaves exactly as before. Same function as 20261123100000_site_products_bookable.sql otherwise.
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
        'is_bookable', COALESCE((to_jsonb(p) ->> 'is_bookable')::BOOLEAN, FALSE)
          AND (COALESCE(p.is_service, FALSE) OR COALESCE(p.inventory_mode = 'service_item', FALSE)),
        'booking_type', CASE WHEN (to_jsonb(p) ->> 'booking_type') IN ('slot', 'ticket', 'room') THEN to_jsonb(p) ->> 'booking_type' ELSE 'slot' END,
        'store_name', s.name
      ) AS item
      FROM public.business_profiles bp
      JOIN public.supermarkets s ON (
        s.id = bp.supermarket_id
        OR s.pichin_business_profile_id = bp.id
        OR (
          -- No store is linked to this business profile (e.g. the website was created first and the store was
          -- onboarded later under a second profile): use the one store its owner runs under the same name.
          NOT EXISTS (
            SELECT 1 FROM public.supermarkets l
            WHERE l.id = bp.supermarket_id OR l.pichin_business_profile_id = bp.id
          )
          AND s.owner_user_id = bp.user_id
          AND lower(btrim(s.name)) = lower(btrim(bp.business_name))
        )
      )
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
