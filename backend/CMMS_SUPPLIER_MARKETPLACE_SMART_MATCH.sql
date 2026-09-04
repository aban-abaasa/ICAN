-- ============================================================================
-- Supplier marketplace: smart matching + business-profile supplier auto-fill
-- ============================================================================
-- Run after: CMMS_SUPPLIER_PURCHASE_ORDERS.sql,
--            UNIFIED_BUSINESS_MANAGEMENT_AND_SUPPLIER_MARKETPLACE.sql
--
-- PROBLEM 1 (not "smart"): cmms_get_supplier_catalog()'s candidate_suppliers
-- CTE has two arms -- the real one (public.supplier_directory WHERE
-- is_published = TRUE, the same test search_global_suppliers_v2 and
-- cmms_create_supplier_purchase_order's is_published check use) and a second,
-- looser arm that just pattern-matches business_profiles.business_type
-- against '%wholesale%'/'%supplier%'/'%factory%'/'%hardware%'/'%raw
-- material%', with no regard for whether that business ever published to the
-- supplier_directory (including businesses UNIFIED_BUSINESS_MANAGEMENT's own
-- cleanup step deliberately set is_published = FALSE on). The CMMS "Order
-- from supplier" picker (CMSSupplierPurchasePanel.jsx) lists both arms, so a
-- buyer can select a business that only superficially looks like a supplier
-- and isn't actually one -- every genuine supplier is already covered by the
-- first arm via publish_supplier_business_profile_trigger (auto) or
-- publish_business_as_supplier() (manual opt-in), so the second arm adds
-- noise, not coverage. Drop it: only public.supplier_directory rows with
-- is_published = TRUE are "business with supplier services".
--
-- PROBLEM 2 (no auto-fill on profile creation): Business Profile creation
-- (BusinessProfileForm.jsx) has no way to know a signed-in user already runs
-- a Supermarketa supplier account (public.suppliers, or an existing
-- published business_profiles/supplier_directory row) before they fill out a
-- brand-new profile -- so they always retype the "we supply other
-- businesses" decision by hand, and nothing pre-checks it for them even when
-- it is already true elsewhere in the platform. cmms_get_my_supplier_hint()
-- gives the frontend a single, cheap, read-only call to auto-fill (never
-- auto-submit) the supplier toggle when it can already prove the person is
-- an existing supplier; anyone else still fills it in manually.
-- ============================================================================

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

  -- Browsing the catalog is a read: any active CMMS staff member with a
  -- "requisitions: view" grant needs it to work, and most employees never
  -- hold Pichin-level business membership (shareholder/business_member_roles)
  -- -- that's a separate, stronger authority CMMS role assignment doesn't
  -- imply. Accept either: the Pichin-level check (kept for admins managing
  -- the linked business directly) or plain active cmms_users membership.
  IF v_buyer_business_id IS NULL THEN
    RAISE EXCEPTION 'You are not an active member of this CMMS business';
  END IF;
  IF NOT public.unified_business_member(v_buyer_business_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.cmms_users u
       WHERE u.cmms_company_id = p_cmms_company_id
         AND u.is_active
         AND lower(u.email) = lower(auth.jwt() ->> 'email')
     ) THEN
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

  -- Smart match: a business only counts as "supplier services" once it is
  -- actually published in the shared supplier_directory -- the same source
  -- of truth search_global_suppliers_v2() and the order RPC's is_published
  -- check use. No separate business_type text-matching fallback: every
  -- genuine wholesale/factory/hardware/supplier business already lands here
  -- via publish_supplier_business_profile_trigger (automatic) or
  -- publish_business_as_supplier() (manual opt-in from Business Profile).
  RETURN QUERY
  SELECT sd.business_profile_id, bp.business_name::TEXT, sd.supplier_type,
         sci.id, sci.name, sci.category, sci.unit, sci.min_order_qty,
         sci.price_per_unit, sci.currency, sci.image_url,
         COALESCE(sci.currency, 'UGX') || ' ' ||
           to_char(COALESCE(sci.price_per_unit, 0), 'FM999G999G999G990D00') ||
           ' / ' || COALESCE(sci.unit, 'unit')
  FROM public.supplier_directory sd
  JOIN public.business_profiles bp ON bp.id = sd.business_profile_id
  LEFT JOIN public.supplier_catalog_items sci
    ON (sci.supplier_business_profile_id = sd.business_profile_id
        OR sci.supplier_user_id = bp.user_id)
    AND sci.is_available = TRUE
  WHERE sd.is_published = TRUE
    AND COALESCE(bp.status, 'active') = 'active'
  ORDER BY bp.business_name, sci.category, sci.name;
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_get_supplier_catalog(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_get_supplier_catalog(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- Business Profile creation auto-fill: tell the frontend, before the person
-- fills anything in, whether they already have proof of being a supplier
-- elsewhere on the platform -- a Supermarketa supplier account, or a
-- business profile already published to supplier_directory. The form uses
-- this only to pre-check/pre-fill the supplier toggle; it stays a normal,
-- editable field either way (manual fill for everyone else).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cmms_get_my_supplier_hint()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_existing RECORD;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('has_existing_supplier', false);
  END IF;

  -- Already a published supplier under one of this person's own business
  -- profiles (owner, or an active business-role member).
  SELECT sd.business_profile_id, sd.supplier_type, 'business_profile' AS source
    INTO v_existing
    FROM public.supplier_directory sd
    JOIN public.business_profiles bp ON bp.id = sd.business_profile_id
   WHERE sd.is_published = TRUE
     AND (bp.user_id = v_user
          OR EXISTS (
            SELECT 1 FROM public.business_member_roles bmr
             WHERE bmr.business_profile_id = bp.id
               AND bmr.auth_user_id = v_user
               AND bmr.status = 'active'
          ))
   LIMIT 1;

  IF v_existing.business_profile_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'has_existing_supplier', true,
      'source', v_existing.source,
      'supplier_type', v_existing.supplier_type,
      'business_profile_id', v_existing.business_profile_id
    );
  END IF;

  -- A Supermarketa supplier account, before any ICAN business profile for
  -- it has ever been created. Guarded: legacy Supermarketa tables may not
  -- exist in every deployment.
  IF to_regclass('public.suppliers') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.suppliers WHERE user_id = v_user) THEN
      RETURN jsonb_build_object(
        'has_existing_supplier', true,
        'source', 'supermarketa_supplier',
        'supplier_type', 'supplier',
        'business_profile_id', NULL
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('has_existing_supplier', false);
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_get_my_supplier_hint() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_get_my_supplier_hint() TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'cmms_get_supplier_catalog is now supplier_directory-only, and cmms_get_my_supplier_hint() is available for Business Profile auto-fill' AS status;
