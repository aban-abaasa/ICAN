-- ============================================================================
-- Business website Market: a business can offer DELIVERY on its own store products
--
-- THE GAP
--   A business website's Market tab shows two kinds of product:
--     * dropship listings   - these go in a cart and are DELIVERED by a BodaGoEra rider (dropship_checkout: the real rider fare,
--                             a delivery window, payment held in escrow until the rider scans the order out of the store);
--     * the business's OWN store products ("Our products") - these could only be picked up and paid on the Pay tab.
--   So a shop with its own stock had no way to say "we deliver".
--
-- THE IDEA - the same delivery, the products stay the store's own
--   No second delivery system and no copies of the products. Store products are NOT turned into dropship listings: the store's
--   `products` stay the one and only record (nothing new appears in the Dropship dashboard, in the reseller directory or in
--   the dropship product browse).
--
--   When a customer orders with delivery, the order is handed to the very same dropship_checkout that every other delivery
--   uses - rider matching, the real BodaGoEra fare, the delivery window, escrow until the rider scans the order out of the
--   store, refund rights, receipts, settlement. For the length of that one database transaction the store's products are
--   "lent" to it as a listing owned by the business itself (price = the store price, no markup), and the loan is taken back
--   before the transaction ends. A loan can never outlive its transaction: it is either handed back below, or rolled back
--   with the rest if anything fails. Nobody else ever sees it.
--
--   Because the delivery is dropship's own: the customer pays the real rider fare, dropship adds the product's tax the way it
--   does for every dropship order (the website shows the server's exact total before anyone pays), and a visitor without a
--   wallet can pay with Mobile Money / card / bank through guest checkout, which is patched below to lend the same way.
--
--   Smart parts:
--     * One switch, no listing work: the owner turns delivery on and every store product that can be delivered is on offer.
--     * Readiness is checked before the switch moves, in plain words: the store must be linked, have its pickup location on
--       the map (a rider is routed to it), have its business wallet (the store is paid through it) and sell in UGX (rider
--       delivery is priced in UGX). Products that cannot be delivered are counted with the reason (no tax rate, excluded from
--       dropshipping, no price, a service).
--     * It follows the store by itself: a new product, a price change, a deactivated product - the website always reads the
--       store's current products, never a snapshot.
--     * A product the owner already listed by hand in the Dropship dashboard keeps working exactly as before; delivery never
--       touches it.
--
-- WHAT IT ADDS
--   cmms_site_delivery               one row per business: delivery on / off
--   dropship_listings.site_managed   marks a loaned listing (always gone again before the transaction ends)
--   _site_delivery_store / _state / _lend / _return          internal helpers
--   get_cmms_site_delivery(company)                          the checklist (company team)
--   fn_set_cmms_site_delivery(company, on)                   the switch (company team who are members of the business)
--   get_site_delivery_storefront(business)                   public: what the website may offer for delivery
--   site_find_delivery_riders(business, lat, lng, ...)       the rider picker (dropship_ranked_riders: the store's own riders first)
--   site_checkout_with_pin(...)                              wallet checkout = lend + dropship_checkout_with_pin
--   site_guest_checkout_start(...)                           Mobile Money / card / bank quote + order = lend + guest_checkout_start
--   guest_checkout_fulfil                                    patched IN PLACE to lend before it runs dropship_checkout
--
-- WHO MAY turn it on: the company's team with edit rights on the website tool (same as the Products source setting) AND a
-- member of the business. Visitors can only read the storefront and order.
--
-- Run after: DROPSHIP_RESELLER_SYSTEM.sql, ADD_DROPSHIP_SMART_TRANSPORT.sql, ADD_GUEST_CHECKOUT_MOBILE_MONEY.sql,
--            DROPSHIP_CHECKOUT_REQUIRE_PIN.sql, CMMS_ANNOUNCEMENTS_AND_JOBS.sql, 20261012100000_site_products_source.sql.
-- Safe to run more than once. Roll back with supabase/rollback/20261113_rollback_site_delivery.sql.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('public.cmms_company_profiles') IS NULL
     OR to_regclass('public.dropship_listings') IS NULL
     OR to_regclass('public.products') IS NULL
     OR to_regclass('public.supermarkets') IS NULL
     OR to_regclass('public.business_profiles') IS NULL
     OR to_regclass('public.inventory') IS NULL THEN
    RAISE EXCEPTION 'Run the dropship SQL (DROPSHIP_RESELLER_SYSTEM.sql, ADD_DROPSHIP_SMART_TRANSPORT.sql) and the CMMS website SQL first - this builds on their tables.';
  END IF;
  IF to_regprocedure('public.dropship_checkout_with_pin(text,uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])') IS NULL THEN
    RAISE EXCEPTION 'Run DROPSHIP_CHECKOUT_REQUIRE_PIN.sql first - delivery orders are paid through dropship_checkout_with_pin.';
  END IF;
  IF to_regprocedure('public.dropship_ranked_riders(uuid,numeric,numeric,numeric,numeric,text[],integer)') IS NULL
     OR to_regprocedure('public.guest_checkout_start(uuid,jsonb,text,text,text,numeric,numeric,numeric,text[],boolean)') IS NULL THEN
    RAISE EXCEPTION 'Run ADD_GUEST_CHECKOUT_MOBILE_MONEY.sql first - the rider picker and the guest quote come from it.';
  END IF;
  IF to_regprocedure('public.cmms_has_tool_action(uuid,text,text)') IS NULL
     OR to_regprocedure('public.unified_business_member(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Run CMMS_ANNOUNCEMENTS_AND_JOBS.sql and UNIFIED_BUSINESS_MANAGEMENT_AND_SUPPLIER_MARKETPLACE.sql first - this uses their permission checks.';
  END IF;
END $guard$;

-- ─── 1. The switch (one row per business) and the marker on a loaned listing ─

CREATE TABLE IF NOT EXISTS public.cmms_site_delivery (
  business_profile_id UUID PRIMARY KEY REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  enabled             BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by          UUID,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cmms_site_delivery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cmms_site_delivery FROM PUBLIC, anon, authenticated;

ALTER TABLE public.dropship_listings
  ADD COLUMN IF NOT EXISTS site_managed BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── 2. Helpers (internal: nothing here is callable from the browser) ───────

-- The store a business delivers from: the store linked on the business profile, else the oldest active store whose business
-- wallet is this business. One store only - a dropship order is single-store, so a cart must never mix two.
CREATE OR REPLACE FUNCTION public._site_delivery_store(p_business UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT bp.supermarket_id FROM public.business_profiles bp WHERE bp.id = p_business AND bp.supermarket_id IS NOT NULL),
    (SELECT s.id FROM public.supermarkets s
      WHERE s.pichin_business_profile_id = p_business AND COALESCE(s.is_active, TRUE)
      ORDER BY s.created_at NULLS LAST, s.id
      LIMIT 1));
$$;

-- Can this product be delivered? 'ok', or the first reason it cannot. (Dropship checkout refuses a product with no tax rate
-- and one excluded from dropshipping; a service has no stock to carry; no price means nothing to charge.)
CREATE OR REPLACE FUNCTION public._site_delivery_state(p public.products)
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN COALESCE(p.is_service, FALSE)                  THEN 'service'
    WHEN COALESCE(p.is_dropship_excluded, FALSE)        THEN 'excluded'
    WHEN COALESCE(p.selling_price, 0) <= 0              THEN 'no_price'
    WHEN p.tax_rate IS NULL                             THEN 'no_tax'
    ELSE 'ok' END;
$$;

-- Is delivery on for this business AND able to work (store, location, wallet, UGX)? The one definition every caller shares.
CREATE OR REPLACE FUNCTION public._site_delivery_ready(p_business UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.cmms_site_delivery d
      JOIN public.supermarkets s ON s.id = public._site_delivery_store(d.business_profile_id)
     WHERE d.business_profile_id = p_business
       AND d.enabled
       AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
       AND s.pichin_business_profile_id IS NOT NULL AND s.owner_user_id IS NOT NULL
       AND upper(COALESCE(NULLIF(btrim(s.price_currency), ''), 'UGX')) = 'UGX');
$$;

-- Lend the store's products named in a cart to dropship_checkout as listings owned by the business itself, at the store price.
-- Only products that are deliverable, belong to the delivery store and have no listing yet (a hand-made listing is never
-- touched). Does nothing for any other cart. Returns how many were lent. MUST be paired with _site_delivery_return in the
-- same transaction.
CREATE OR REPLACE FUNCTION public._site_delivery_lend(p_business UUID, p_cart JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_store UUID;
  v_n     INTEGER;
BEGIN
  IF p_cart IS NULL OR jsonb_typeof(p_cart) <> 'array' OR NOT public._site_delivery_ready(p_business) THEN
    RETURN 0;
  END IF;
  v_store := public._site_delivery_store(p_business);

  INSERT INTO public.dropship_listings
    (reseller_business_profile_id, product_id, supermarket_id, listed_price, is_active, free_delivery, max_delivery_subsidy, site_managed)
  SELECT p_business, p.id, p.supermarket_id, p.selling_price, TRUE, FALSE, 0, TRUE
    FROM public.products p
   WHERE p.supermarket_id = v_store
     AND COALESCE(p.is_active, TRUE)
     AND public._site_delivery_state(p) = 'ok'
     AND p.id IN (SELECT (e ->> 'product_id')::UUID
                    FROM jsonb_array_elements(p_cart) e
                   WHERE jsonb_typeof(e) = 'object'
                     AND e ->> 'product_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  ON CONFLICT (reseller_business_profile_id, product_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Take the loan back. Every loaned listing of the business, nothing else.
CREATE OR REPLACE FUNCTION public._site_delivery_return(p_business UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.dropship_listings WHERE reseller_business_profile_id = p_business AND site_managed;
$$;

REVOKE ALL ON FUNCTION public._site_delivery_store(UUID)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._site_delivery_state(public.products)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._site_delivery_ready(UUID)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._site_delivery_lend(UUID, JSONB)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._site_delivery_return(UUID)            FROM PUBLIC, anon, authenticated;

-- ─── 3. For the company's team: the checklist, and the switch ───────────────

-- Who may manage delivery for this company, or why not. Raises with a plain message; returns the business id.
CREATE OR REPLACE FUNCTION public._site_delivery_manager(p_company_id UUID, p_require_member BOOLEAN)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_business UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required';
  END IF;
  IF NOT COALESCE(public.cmms_has_tool_action(p_company_id, 'announcements', 'edit'), FALSE) THEN
    RAISE EXCEPTION 'You do not have permission to manage this company''s website';
  END IF;
  SELECT cp.business_profile_id INTO v_business FROM public.cmms_company_profiles cp WHERE cp.id = p_company_id;
  IF v_business IS NULL THEN
    RAISE EXCEPTION 'Link this website to your business under Products & services first';
  END IF;
  IF p_require_member AND NOT COALESCE(public.unified_business_member(v_business), FALSE) THEN
    RAISE EXCEPTION 'Only a member of the business can change its delivery - the orders are paid into the business''s store';
  END IF;
  RETURN v_business;
END;
$$;
REVOKE ALL ON FUNCTION public._site_delivery_manager(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_cmms_site_delivery(p_company_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_business UUID := public._site_delivery_manager(p_company_id, FALSE);
  v_enabled  BOOLEAN;
  v_store    UUID := public._site_delivery_store(v_business);
  s          public.supermarkets%ROWTYPE;
  v_checks   JSONB;
  v_counts   JSONB;
BEGIN
  SELECT d.enabled INTO v_enabled FROM public.cmms_site_delivery d WHERE d.business_profile_id = v_business;
  IF v_store IS NOT NULL THEN
    SELECT * INTO s FROM public.supermarkets WHERE id = v_store;
  END IF;

  v_checks := jsonb_build_object(
    'store',    v_store IS NOT NULL,
    'location', v_store IS NOT NULL AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL,
    'wallet',   v_store IS NOT NULL AND s.pichin_business_profile_id IS NOT NULL AND s.owner_user_id IS NOT NULL,
    'ugx',      v_store IS NOT NULL AND upper(COALESCE(NULLIF(btrim(s.price_currency), ''), 'UGX')) = 'UGX');

  SELECT jsonb_build_object(
           'deliverable', count(*) FILTER (WHERE st = 'ok'),
           'no_tax',      count(*) FILTER (WHERE st = 'no_tax'),
           'excluded',    count(*) FILTER (WHERE st = 'excluded'),
           'no_price',    count(*) FILTER (WHERE st = 'no_price'),
           'services',    count(*) FILTER (WHERE st = 'service'))
    INTO v_counts
    FROM (SELECT public._site_delivery_state(p) AS st
            FROM public.products p
           WHERE p.supermarket_id = v_store AND COALESCE(p.is_active, TRUE)) q;

  RETURN jsonb_build_object(
    'success', TRUE,
    'business_profile_id', v_business,
    'can_change', COALESCE(public.unified_business_member(v_business), FALSE),
    'enabled', COALESCE(v_enabled, FALSE),
    'store_name', CASE WHEN v_store IS NOT NULL THEN COALESCE(NULLIF(btrim(s.name), ''), NULLIF(btrim(s.location), ''), 'Store') END,
    'checks', v_checks,
    'ready', (v_checks ->> 'store')::BOOLEAN AND (v_checks ->> 'location')::BOOLEAN
             AND (v_checks ->> 'wallet')::BOOLEAN AND (v_checks ->> 'ugx')::BOOLEAN,
    'products', COALESCE(v_counts, '{}'::JSONB));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_set_cmms_site_delivery(p_company_id UUID, p_enabled BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_business UUID := public._site_delivery_manager(p_company_id, TRUE);
  v_info     JSONB;
BEGIN
  IF COALESCE(p_enabled, FALSE) THEN
    v_info := public.get_cmms_site_delivery(p_company_id);
    IF NOT (v_info -> 'checks' ->> 'store')::BOOLEAN THEN
      RAISE EXCEPTION 'This business has no store linked yet - delivery is for the products of your store';
    END IF;
    IF NOT (v_info -> 'checks' ->> 'location')::BOOLEAN THEN
      RAISE EXCEPTION 'Set your store''s pickup location on the map first - a rider has to know where to collect the order';
    END IF;
    IF NOT (v_info -> 'checks' ->> 'wallet')::BOOLEAN THEN
      RAISE EXCEPTION 'Your store has no business wallet yet - delivery orders are paid into it';
    END IF;
    IF NOT (v_info -> 'checks' ->> 'ugx')::BOOLEAN THEN
      RAISE EXCEPTION 'Rider delivery is priced in UGX - it is only available for stores that sell in UGX';
    END IF;
  END IF;

  INSERT INTO public.cmms_site_delivery (business_profile_id, enabled, updated_by, updated_at)
  VALUES (v_business, COALESCE(p_enabled, FALSE), auth.uid(), now())
  ON CONFLICT (business_profile_id) DO UPDATE
    SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;

  RETURN public.get_cmms_site_delivery(p_company_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_cmms_site_delivery(UUID)                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_set_cmms_site_delivery(UUID, BOOLEAN)     FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cmms_site_delivery(UUID)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_set_cmms_site_delivery(UUID, BOOLEAN) TO authenticated;

-- ─── 4. For visitors: what can be delivered, the rider picker, and the two ways to pay ──

-- What the website may offer for delivery: { enabled, guest_ok, store: { name, lat, lng }, products: [...] }.
-- Nothing is returned unless delivery is on AND able to work. A product that already has a listing of the business (made by
-- hand in the Dropship dashboard) is left out: it is delivered as that listing, as before.
CREATE OR REPLACE FUNCTION public.get_site_delivery_storefront(p_business_profile_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_store    UUID;
  s          public.supermarkets%ROWTYPE;
  v_products JSONB;
  v_fulfil   OID := to_regprocedure('public.guest_checkout_fulfil(text,text,numeric)');
BEGIN
  IF p_business_profile_id IS NULL OR NOT public._site_delivery_ready(p_business_profile_id) THEN
    RETURN jsonb_build_object('enabled', FALSE);
  END IF;
  v_store := public._site_delivery_store(p_business_profile_id);
  SELECT * INTO s FROM public.supermarkets WHERE id = v_store;

  SELECT COALESCE(jsonb_agg(item ORDER BY item ->> 'name'), '[]'::JSONB) INTO v_products
  FROM (
    SELECT jsonb_build_object(
      'product_id', p.id,
      'name', p.name,
      'sku', p.sku,
      'brand', p.brand,
      'images', CASE
        WHEN jsonb_typeof(p.images) = 'array' AND jsonb_array_length(p.images) > 0 THEN p.images
        WHEN NULLIF(btrim(p.image_url), '') IS NOT NULL THEN jsonb_build_array(p.image_url)
        ELSE '[]'::JSONB END,
      'price', p.selling_price,
      'tax_rate', p.tax_rate,
      'available_stock', stock.qty,
      'in_stock', stock.qty > 0
    ) AS item
    FROM public.products p
    LEFT JOIN LATERAL (
      SELECT GREATEST(COALESCE(SUM(i.current_stock - COALESCE(i.reserved_stock, 0)), 0), 0) AS qty
        FROM public.inventory i WHERE i.product_id = p.id AND i.supermarket_id = p.supermarket_id
    ) stock ON TRUE
    WHERE p.supermarket_id = v_store
      AND COALESCE(p.is_active, TRUE)
      AND public._site_delivery_state(p) = 'ok'
      AND NOT EXISTS (SELECT 1 FROM public.dropship_listings dl
                       WHERE dl.reseller_business_profile_id = p_business_profile_id AND dl.product_id = p.id AND NOT dl.site_managed)
    ORDER BY p.name
    LIMIT 200
  ) q;

  RETURN jsonb_build_object(
    'enabled', TRUE,
    -- Paying without a wallet needs guest checkout to lend as well (patched below); offer it only when it does.
    'guest_ok', v_fulfil IS NOT NULL AND position('_site_delivery_lend' IN pg_get_functiondef(v_fulfil)) > 0,
    'store', jsonb_build_object('name', COALESCE(NULLIF(btrim(s.name), ''), NULLIF(btrim(s.location), ''), 'Store'),
                                'lat', s.latitude, 'lng', s.longitude),
    'products', v_products);
END;
$$;

-- The rider picker: the store's own nearby riders first, then the nearest others, each with the real fare - dropship's own
-- ranking. Signed-in customers only, like dropship_find_delivery_riders.
CREATE OR REPLACE FUNCTION public.site_find_delivery_riders(
  p_business_profile_id UUID, p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC, p_vehicle_types TEXT[] DEFAULT NULL, p_limit INTEGER DEFAULT 8
) RETURNS TABLE (
  rider_id UUID, full_name TEXT, rating NUMERIC, vehicle_type TEXT,
  distance_to_pickup_km NUMERIC, estimated_arrival_min INTEGER, fare NUMERIC, is_store_rider BOOLEAN
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.supermarkets%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_dropoff_lat IS NULL OR p_dropoff_lng IS NULL OR NOT public._site_delivery_ready(p_business_profile_id) THEN
    RETURN;
  END IF;
  SELECT * INTO s FROM public.supermarkets WHERE id = public._site_delivery_store(p_business_profile_id);
  RETURN QUERY
    SELECT * FROM public.dropship_ranked_riders(
      s.pichin_business_profile_id, s.latitude, s.longitude, p_dropoff_lat, p_dropoff_lng, p_vehicle_types, p_limit);
END;
$$;

-- Wallet checkout (PIN checked by dropship_checkout_with_pin): lend, run dropship's checkout, take the loan back.
CREATE OR REPLACE FUNCTION public.site_checkout_with_pin(
  p_pin_hash           TEXT,
  p_business_profile_id UUID,
  p_cart               JSONB,
  p_customer_name      TEXT DEFAULT NULL,
  p_customer_phone     TEXT DEFAULT NULL,
  p_delivery_address   TEXT DEFAULT NULL,
  p_store_location     TEXT DEFAULT NULL,
  p_delivery_lat       NUMERIC DEFAULT NULL,
  p_delivery_lng       NUMERIC DEFAULT NULL,
  p_max_delivery_hours NUMERIC DEFAULT NULL,
  p_rider_id           UUID DEFAULT NULL,
  p_vehicle_types      TEXT[] DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_res JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Sign in to pay with your IcanEra wallet');
  END IF;
  PERFORM public._site_delivery_lend(p_business_profile_id, p_cart);
  v_res := public.dropship_checkout_with_pin(
    p_pin_hash, p_business_profile_id, p_cart, p_customer_name, p_customer_phone, p_delivery_address,
    p_store_location, p_delivery_lat, p_delivery_lng, p_max_delivery_hours, p_rider_id, p_vehicle_types);
  PERFORM public._site_delivery_return(p_business_profile_id);
  RETURN v_res;
END;
$$;

-- Mobile Money / card / bank (no wallet): the quote and the pending order, exactly as guest_checkout_start makes them.
CREATE OR REPLACE FUNCTION public.site_guest_checkout_start(
  p_business_profile_id UUID,
  p_cart               JSONB,
  p_customer_name      TEXT,
  p_customer_phone     TEXT,
  p_delivery_address   TEXT,
  p_delivery_lat       NUMERIC,
  p_delivery_lng       NUMERIC,
  p_max_delivery_hours NUMERIC,
  p_vehicle_types      TEXT[] DEFAULT NULL,
  p_dry_run            BOOLEAN DEFAULT FALSE
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_res JSONB;
BEGIN
  PERFORM public._site_delivery_lend(p_business_profile_id, p_cart);
  v_res := public.guest_checkout_start(
    p_business_profile_id, p_cart, p_customer_name, p_customer_phone, p_delivery_address,
    p_delivery_lat, p_delivery_lng, p_max_delivery_hours, p_vehicle_types, p_dry_run);
  PERFORM public._site_delivery_return(p_business_profile_id);
  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.get_site_delivery_storefront(UUID)                       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.site_find_delivery_riders(UUID, NUMERIC, NUMERIC, TEXT[], INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.site_checkout_with_pin(TEXT, UUID, JSONB, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, UUID, TEXT[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.site_guest_checkout_start(UUID, JSONB, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT[], BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_site_delivery_storefront(UUID)                       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.site_find_delivery_riders(UUID, NUMERIC, NUMERIC, TEXT[], INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.site_checkout_with_pin(TEXT, UUID, JSONB, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, UUID, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.site_guest_checkout_start(UUID, JSONB, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT[], BOOLEAN) TO anon, authenticated;

-- ─── 5. Guest checkout: lend while it places a paid order ──────────────────
-- guest_checkout_fulfil runs dropship_checkout for a guest once Flutterwave has confirmed the payment. For a store product it
-- must lend first and hand the loan back right after, like the wrappers above. Patched IN PLACE (the way
-- 20261108100000_shop_checkout_tax_included.sql patches customer_self_checkout) so everything else in it stays exactly as
-- deployed. Each anchor must be found exactly once; if the function is not the version this was written for, NOTHING is
-- changed - store-product delivery then simply stays wallet-only (get_site_delivery_storefront reports guest_ok = false).
DO $patch$
DECLARE
  v_oid OID := to_regprocedure('public.guest_checkout_fulfil(text,text,numeric)');
  v_def TEXT;
  v_call CONSTANT TEXT := $re$v_res\s*:=\s*public\.dropship_checkout\($re$;
  v_back CONSTANT TEXT := $re$PERFORM\s+set_config\('request\.jwt\.claim\.sub',\s*'',\s*TRUE\);$re$;
BEGIN
  IF v_oid IS NULL THEN
    RAISE NOTICE 'Guest checkout is not installed - delivery on store products is for signed-in wallet payers';
    RETURN;
  END IF;
  v_def := replace(pg_get_functiondef(v_oid), E'\r\n', E'\n');
  IF position('_site_delivery_lend' IN v_def) > 0 THEN
    RAISE NOTICE 'guest_checkout_fulfil already lends store products - left as it is';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, v_call, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, v_back, 'g')) <> 1 THEN
    RAISE WARNING 'guest_checkout_fulfil is not the version this migration was written for - NOT changed. Store-product delivery stays wallet-only.';
    RETURN;
  END IF;
  v_def := regexp_replace(v_def, '(' || v_call || ')',
                          E'PERFORM public._site_delivery_lend(v_o.reseller_business_profile_id, v_o.cart);\n    ' || '\1');
  v_def := regexp_replace(v_def, '(' || v_back || ')',
                          E'PERFORM public._site_delivery_return(v_o.reseller_business_profile_id);\n    ' || '\1');
  EXECUTE v_def;
  RAISE NOTICE 'guest_checkout_fulfil now lends store products while it places the order';
END $patch$;

NOTIFY pgrst, 'reload schema';

SELECT 'Delivery on the business website Market is ready (turn it on in CMMS > Products & services)' AS status;
