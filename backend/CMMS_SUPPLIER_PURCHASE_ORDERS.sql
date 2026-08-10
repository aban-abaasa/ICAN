-- Allow CMMS buyers to place supplier marketplace orders from a requisition.
-- Run after UNIFIED_BUSINESS_MANAGEMENT_AND_SUPPLIER_MARKETPLACE.sql and the
-- CMMS requisition schema.

ALTER TABLE IF EXISTS public.supplier_marketplace_orders
  ADD COLUMN IF NOT EXISTS cmms_company_id UUID
    REFERENCES public.cmms_company_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cmms_requisition_id UUID
    REFERENCES public.cmms_requisitions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_cmms_user_id UUID
    REFERENCES public.cmms_users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.supplier_catalog_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  unit TEXT NOT NULL DEFAULT 'unit',
  min_order_qty NUMERIC(18,4) NOT NULL DEFAULT 1 CHECK (min_order_qty > 0),
  price_per_unit NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (price_per_unit >= 0),
  currency TEXT NOT NULL DEFAULT 'UGX',
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_catalog_items
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS supplier_user_id UUID,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS price_tag TEXT;

CREATE INDEX IF NOT EXISTS idx_supplier_orders_cmms_company
  ON public.supplier_marketplace_orders(cmms_company_id, created_at DESC)
  WHERE cmms_company_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.cmms_get_supplier_catalog(UUID);

CREATE OR REPLACE FUNCTION public.cmms_get_supplier_catalog(
  p_cmms_company_id UUID
)
RETURNS TABLE (
  supplier_business_profile_id UUID,
  supplier_business_name TEXT,
  supplier_type TEXT,
  catalog_item_id UUID,
  item_name TEXT,
  category TEXT,
  unit TEXT,
  min_order_qty NUMERIC,
  price_per_unit NUMERIC,
  currency TEXT,
  image_url TEXT,
  price_tag TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_buyer_business_id UUID;
BEGIN
  SELECT pichin_business_profile_id INTO v_buyer_business_id
  FROM public.cmms_company_profiles
  WHERE id = p_cmms_company_id AND is_active = TRUE;

  IF v_buyer_business_id IS NULL OR NOT public.unified_business_member(v_buyer_business_id) THEN
    RAISE EXCEPTION 'You are not an active member of this CMMS business';
  END IF;

  -- Supermarketa managers create live products in products/suppliers. Keep
  -- the shared catalogue synchronized when CMMS opens the supplier picker so
  -- newly added or updated supplier products are available without rerunning
  -- a migration.
  IF to_regclass('public.products') IS NOT NULL
     AND to_regclass('public.suppliers') IS NOT NULL
     AND to_regclass('public.categories') IS NOT NULL THEN
    EXECUTE $sync$
      INSERT INTO public.supplier_catalog_items
        (supplier_business_profile_id, name, category, unit, min_order_qty,
         price_per_unit, currency, is_available, image_url, metadata, updated_at)
      SELECT bp.id,
             p.name,
             COALESCE(NULLIF(trim(c.name), ''), 'general'),
             'unit',
             1,
             COALESCE(p.cost_price, 0),
             'UGX',
             COALESCE(p.is_active, TRUE),
             CASE WHEN jsonb_typeof(p.images) = 'array' THEN p.images ->> 0 ELSE NULL END,
             jsonb_build_object('source', 'supermarketa_products', 'source_product_id', p.id),
             now()
        FROM public.products p
        JOIN public.suppliers s ON s.id = p.supplier_id
        LEFT JOIN public.categories c ON c.id = p.category_id
        JOIN public.business_profiles bp ON bp.user_id = s.user_id
       WHERE p.supplier_id IS NOT NULL
         AND COALESCE(bp.status, 'active') = 'active'
         AND NOT EXISTS (
           SELECT 1
             FROM public.supplier_catalog_items existing
            WHERE existing.supplier_business_profile_id = bp.id
              AND existing.metadata ->> 'source' = 'supermarketa_products'
              AND existing.metadata ->> 'source_product_id' = p.id::TEXT
         )
    $sync$;

    EXECUTE $refresh$
      UPDATE public.supplier_catalog_items sci
         SET name = p.name,
             price_per_unit = COALESCE(p.cost_price, 0),
             is_available = COALESCE(p.is_active, TRUE),
             image_url = CASE WHEN jsonb_typeof(p.images) = 'array' THEN p.images ->> 0 ELSE sci.image_url END,
             updated_at = now()
        FROM public.products p
       WHERE sci.metadata ->> 'source' = 'supermarketa_products'
         AND sci.metadata ->> 'source_product_id' = p.id::TEXT
    $refresh$;
  END IF;

  -- Match the Supermarketa manager's live POS offering lookup. Products
  -- entered by a wholesale/factory/supermarket manager are owned by the
  -- supermarket account, not necessarily by legacy products.supplier_id.
  IF to_regclass('public.products') IS NOT NULL
     AND to_regclass('public.supermarkets') IS NOT NULL THEN
    EXECUTE $pos_sync$
      INSERT INTO public.supplier_catalog_items
        (supplier_business_profile_id, supplier_user_id, name, description,
         category, unit, min_order_qty, price_per_unit, currency,
         is_available, image_url, metadata, updated_at)
      SELECT bp.id,
             sm.owner_user_id,
             p.name,
             'POS product' || CASE WHEN p.sku IS NOT NULL THEN ' · SKU ' || p.sku ELSE '' END,
             'POS inventory',
             'unit',
             1,
             COALESCE(p.wholesale_price, p.cost_price, p.selling_price, p.price, 0),
             'UGX',
             COALESCE(p.is_active, TRUE),
             CASE WHEN jsonb_typeof(p.images) = 'array' THEN p.images ->> 0 ELSE NULL END,
             jsonb_build_object('source', 'supermarketa_pos', 'source_product_id', p.id, 'supermarket_id', sm.id),
             now()
        FROM public.products p
        JOIN public.supermarkets sm ON sm.id = p.supermarket_id
        JOIN public.business_profiles bp ON bp.user_id = sm.owner_user_id
       WHERE COALESCE(sm.is_active, TRUE) = TRUE
         AND COALESCE(p.is_active, TRUE) = TRUE
         AND COALESCE(bp.status, 'active') = 'active'
         AND NOT EXISTS (
           SELECT 1
             FROM public.supplier_catalog_items existing
            WHERE existing.supplier_business_profile_id = bp.id
              AND existing.metadata ->> 'source' = 'supermarketa_pos'
              AND existing.metadata ->> 'source_product_id' = p.id::TEXT
         )
    $pos_sync$;

    EXECUTE $pos_refresh$
      UPDATE public.supplier_catalog_items sci
         SET name = p.name,
             description = 'POS product' || CASE WHEN p.sku IS NOT NULL THEN ' · SKU ' || p.sku ELSE '' END,
             price_per_unit = COALESCE(p.wholesale_price, p.cost_price, p.selling_price, p.price, 0),
             is_available = COALESCE(p.is_active, TRUE),
             image_url = CASE WHEN jsonb_typeof(p.images) = 'array' THEN p.images ->> 0 ELSE sci.image_url END,
             updated_at = now()
        FROM public.products p
        JOIN public.supermarkets sm ON sm.id = p.supermarket_id
       WHERE sci.metadata ->> 'source' = 'supermarketa_pos'
         AND sci.metadata ->> 'source_product_id' = p.id::TEXT
    $pos_refresh$;
  END IF;

  -- Normalize legacy manager catalogue rows so the CMMS order RPC can use
  -- the durable Pichin business-profile identity.
  UPDATE public.supplier_catalog_items sci
     SET supplier_business_profile_id = bp.id,
         updated_at = now()
    FROM public.business_profiles bp
   WHERE sci.supplier_business_profile_id IS NULL
     AND sci.supplier_user_id = bp.user_id;

  RETURN QUERY
  WITH candidate_suppliers AS (
    SELECT sd.business_profile_id, sd.supplier_type
    FROM public.supplier_directory sd
    WHERE sd.is_published = TRUE
    UNION
    SELECT bp.id,
           CASE
             WHEN lower(COALESCE(bp.business_type, '')) LIKE '%wholesale%' THEN 'wholesaler'
             WHEN lower(COALESCE(bp.business_type, '')) LIKE '%hardware%' THEN 'hardware'
             WHEN lower(COALESCE(bp.business_type, '')) LIKE '%factory%' THEN 'factory'
             ELSE 'supplier'
           END
    FROM public.business_profiles bp
    WHERE COALESCE(bp.status, 'active') = 'active'
      AND bp.user_id IS NOT NULL
      AND (
        lower(COALESCE(bp.business_type, '')) LIKE '%wholesale%'
        OR lower(COALESCE(bp.business_type, '')) LIKE '%supplier%'
        OR lower(COALESCE(bp.business_type, '')) LIKE '%factory%'
        OR lower(COALESCE(bp.business_type, '')) LIKE '%hardware%'
        OR lower(COALESCE(bp.business_type, '')) LIKE '%raw material%'
      )
  )
  SELECT cs.business_profile_id, bp.business_name::TEXT, cs.supplier_type,
         sci.id, sci.name, sci.category, sci.unit, sci.min_order_qty,
         sci.price_per_unit, sci.currency, sci.image_url,
         COALESCE(sci.currency, 'UGX') || ' ' ||
           to_char(COALESCE(sci.price_per_unit, 0), 'FM999G999G999G990D00') ||
           ' / ' || COALESCE(sci.unit, 'unit')
  FROM candidate_suppliers cs
  JOIN public.business_profiles bp ON bp.id = cs.business_profile_id
  LEFT JOIN public.supplier_catalog_items sci
    ON (sci.supplier_business_profile_id = cs.business_profile_id
        OR sci.supplier_user_id = bp.user_id)
    AND sci.is_available = TRUE
  WHERE COALESCE(bp.status, 'active') = 'active'
  ORDER BY bp.business_name, sci.category, sci.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.cmms_create_supplier_purchase_order(
  p_cmms_company_id UUID,
  p_supplier_business_profile_id UUID,
  p_catalog_item_id UUID,
  p_quantity NUMERIC,
  p_delivery_details JSONB DEFAULT '{}'::JSONB,
  p_cmms_requisition_id UUID DEFAULT NULL
)
RETURNS public.supplier_marketplace_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_company public.cmms_company_profiles;
  v_cmms_user_id UUID;
  v_buyer_business_id UUID;
  v_supplier_business_id UUID;
  v_item public.supplier_catalog_items;
  v_order public.supplier_marketplace_orders;
BEGIN
  IF auth.uid() IS NULL OR p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Authenticated user and a positive quantity are required';
  END IF;

  SELECT * INTO v_company FROM public.cmms_company_profiles
  WHERE id = p_cmms_company_id AND is_active = TRUE;
  SELECT id INTO v_cmms_user_id FROM public.cmms_users
  WHERE cmms_company_id = p_cmms_company_id
    AND lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
    AND is_active = TRUE LIMIT 1;

  IF v_company.id IS NULL OR v_cmms_user_id IS NULL THEN
    RAISE EXCEPTION 'You are not an active CMMS company member';
  END IF;

  v_buyer_business_id := v_company.pichin_business_profile_id;
  IF v_buyer_business_id IS NULL OR NOT public.unified_business_member(v_buyer_business_id) THEN
    RAISE EXCEPTION 'CMMS company is not linked to an active business profile';
  END IF;

  SELECT * INTO v_item FROM public.supplier_catalog_items
  WHERE id = p_catalog_item_id
    AND supplier_business_profile_id = p_supplier_business_profile_id
    AND is_available = TRUE;
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'Supplier catalog item was not found'; END IF;
  IF p_quantity < COALESCE(v_item.min_order_qty, 1) THEN
    RAISE EXCEPTION 'Quantity is below the supplier minimum order quantity';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.supplier_directory
    WHERE business_profile_id = p_supplier_business_profile_id AND is_published = TRUE
  ) THEN
    RAISE EXCEPTION 'Supplier is not currently published';
  END IF;

  INSERT INTO public.supplier_marketplace_orders (
    buyer_business_profile_id, supplier_business_profile_id, supplier_catalog_item_id,
    order_number, quantity, unit_price, currency, status, delivery_details, metadata,
    created_by, cmms_company_id, cmms_requisition_id, created_by_cmms_user_id
  ) VALUES (
    v_buyer_business_id, p_supplier_business_profile_id, p_catalog_item_id,
    'CMMS-PO-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 12)),
    p_quantity, v_item.price_per_unit, COALESCE(v_item.currency, 'UGX'), 'submitted',
    COALESCE(p_delivery_details, '{}'::JSONB),
    jsonb_build_object('source_app', 'cmms', 'cmms_company_id', p_cmms_company_id),
    auth.uid(), p_cmms_company_id, p_cmms_requisition_id, v_cmms_user_id
  ) RETURNING * INTO v_order;

  RETURN v_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.cmms_get_supplier_orders(p_cmms_company_id UUID)
RETURNS SETOF public.supplier_marketplace_orders
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT o.* FROM public.supplier_marketplace_orders o
  JOIN public.cmms_users cu ON cu.cmms_company_id = o.cmms_company_id
  WHERE o.cmms_company_id = p_cmms_company_id
    AND cu.is_active = TRUE
    AND lower(cu.email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
  ORDER BY o.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.cmms_get_supplier_received_orders(
  p_supplier_business_profile_id UUID
)
RETURNS SETOF public.supplier_marketplace_orders
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT o.*
  FROM public.supplier_marketplace_orders o
  WHERE o.supplier_business_profile_id = p_supplier_business_profile_id
    AND public.unified_business_member(p_supplier_business_profile_id)
  ORDER BY o.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.cmms_get_supplier_catalog(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_create_supplier_purchase_order(UUID, UUID, UUID, NUMERIC, JSONB, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_get_supplier_orders(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_get_supplier_received_orders(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_get_supplier_catalog(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_create_supplier_purchase_order(UUID, UUID, UUID, NUMERIC, JSONB, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_get_supplier_orders(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_get_supplier_received_orders(UUID) TO authenticated;
