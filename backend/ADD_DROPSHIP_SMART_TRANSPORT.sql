-- ============================================================================
-- Dropship delivery fee: from a free-text number the CUSTOMER typed into the
-- storefront (PublicDropshipStorefront.jsx's old "Delivery fee (paid to the
-- BodaGoera rider on pickup)" input — literally trusted, min=0, nothing
-- stopped a customer setting it to 0) to the REAL fare BodaGoera's own ride
-- matching computes (mbg_find_available_riders' own formula: base_fare +
-- distance*per_km, floored at the minimum fare, scaled by the live
-- time-of-day multiplier, then the assigned rider's own mode surcharge), run
-- SERVER-SIDE inside dropship_checkout so nothing client-supplied can ever
-- set it.
--
-- Two more pieces the storefront was missing entirely:
--   1. A bike/car/van choice — mbg_find_available_riders already grew a
--      p_vehicle_types filter (ADD_VEHICLE_TYPE_FILTER_TO_RIDE_MATCHING.sql)
--      for BodaGoera's own ride screen; dropship_checkout's own internal
--      auto-match call never passed it through. Now it does.
--   2. A reseller-set delivery subsidy cap (dropship_listings.
--      max_delivery_subsidy, alongside the existing all-or-nothing
--      free_delivery flag) — the most the reseller lets be cut from THEIR
--      OWN margin leg to shrink what the customer pays for delivery, capped
--      so it can never exceed the real fare or the reseller's actual margin
--      on the order (never pushes them into paying out of pocket). The
--      rider is still paid the FULL real fare regardless — the subsidized
--      part is redirected to them straight out of the reseller's margin,
--      cut BEFORE whatever's left becomes the reseller's profit.
--
-- Run after ADD_DROPSHIP_RIDER_BOOKING_AND_ESCROW.sql.
-- ============================================================================

SET check_function_bodies = off;

-- ----------------------------------------------------------------------------
-- SECTION 1 — dropship_listings: reseller-set subsidy cap, dropship_orders:
-- record the real fare and how much of it the reseller actually covered.
-- ----------------------------------------------------------------------------

ALTER TABLE public.dropship_listings
  ADD COLUMN IF NOT EXISTS max_delivery_subsidy NUMERIC NOT NULL DEFAULT 0 CHECK (max_delivery_subsidy >= 0);

ALTER TABLE public.dropship_orders
  ADD COLUMN IF NOT EXISTS real_transport_fare NUMERIC,
  ADD COLUMN IF NOT EXISTS reseller_transport_subsidy NUMERIC NOT NULL DEFAULT 0;

-- ----------------------------------------------------------------------------
-- SECTION 2 — dropship_set_listing: + p_max_delivery_subsidy
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.dropship_set_listing(UUID, UUID, NUMERIC, BOOLEAN, BOOLEAN);

CREATE OR REPLACE FUNCTION public.dropship_set_listing(
  p_reseller_business_profile_id UUID,
  p_product_id  UUID,
  p_listed_price NUMERIC,
  p_is_active    BOOLEAN DEFAULT TRUE,
  p_free_delivery BOOLEAN DEFAULT FALSE,
  p_max_delivery_subsidy NUMERIC DEFAULT 0
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_listing_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required';
  END IF;
  IF NOT public.unified_business_member(p_reseller_business_profile_id) THEN
    RAISE EXCEPTION 'You do not have access to this business profile';
  END IF;
  IF COALESCE(p_max_delivery_subsidy, 0) < 0 THEN
    RAISE EXCEPTION 'Delivery subsidy cannot be negative';
  END IF;

  SELECT * INTO v_product FROM public.products p WHERE p.id = p_product_id;
  IF v_product.id IS NULL OR (v_product.is_active IS NOT NULL AND v_product.is_active = FALSE) THEN
    RAISE EXCEPTION 'Product not found or inactive';
  END IF;
  IF v_product.is_dropship_excluded THEN
    RAISE EXCEPTION 'This store has excluded this product from dropshipping';
  END IF;
  IF p_listed_price < v_product.selling_price THEN
    RAISE EXCEPTION 'Your price (%) cannot be below the store price (%)', p_listed_price, v_product.selling_price;
  END IF;

  INSERT INTO public.dropship_listings (reseller_business_profile_id, product_id, supermarket_id, listed_price, is_active, free_delivery, max_delivery_subsidy)
  VALUES (p_reseller_business_profile_id, p_product_id, v_product.supermarket_id, p_listed_price, p_is_active, COALESCE(p_free_delivery, FALSE), COALESCE(p_max_delivery_subsidy, 0))
  ON CONFLICT (reseller_business_profile_id, product_id) DO UPDATE
    SET listed_price = EXCLUDED.listed_price,
        is_active     = EXCLUDED.is_active,
        free_delivery = EXCLUDED.free_delivery,
        max_delivery_subsidy = EXCLUDED.max_delivery_subsidy,
        updated_at    = now()
  RETURNING id INTO v_listing_id;

  RETURN jsonb_build_object('success', true, 'listing_id', v_listing_id);
END;
$$;

REVOKE ALL ON FUNCTION public.dropship_set_listing(UUID, UUID, NUMERIC, BOOLEAN, BOOLEAN, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dropship_set_listing(UUID, UUID, NUMERIC, BOOLEAN, BOOLEAN, NUMERIC) TO authenticated;

-- ----------------------------------------------------------------------------
-- SECTION 3 — get_dropship_storefront: expose max_delivery_subsidy so the
-- storefront can show "up to UGX X off delivery, on us" per item.
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_dropship_storefront(UUID);

CREATE OR REPLACE FUNCTION public.get_dropship_storefront(p_reseller_business_profile_id UUID)
RETURNS TABLE (
  listing_id       UUID,
  product_id       UUID,
  name             TEXT,
  sku              TEXT,
  images           JSONB,
  brand            TEXT,
  listed_price     NUMERIC,
  available_stock  DECIMAL,
  in_stock         BOOLEAN,
  reseller_name    TEXT,
  free_delivery    BOOLEAN,
  max_delivery_subsidy NUMERIC,
  store_lat        NUMERIC,
  store_lng        NUMERIC
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    dl.id, p.id, p.name::TEXT, p.sku::TEXT, p.images, p.brand::TEXT,
    dl.listed_price,
    GREATEST(COALESCE(inv.current_stock - inv.reserved_stock, 0), 0) AS available_stock,
    GREATEST(COALESCE(inv.current_stock - inv.reserved_stock, 0), 0) > 0 AS in_stock,
    bp.business_name::TEXT,
    dl.free_delivery,
    dl.max_delivery_subsidy,
    s.latitude, s.longitude
  FROM public.dropship_listings dl
  JOIN public.products p ON p.id = dl.product_id
  JOIN public.business_profiles bp ON bp.id = dl.reseller_business_profile_id
  JOIN public.supermarkets s ON s.id = dl.supermarket_id
  LEFT JOIN public.inventory inv ON inv.product_id = p.id AND inv.supermarket_id = dl.supermarket_id
  WHERE dl.reseller_business_profile_id = p_reseller_business_profile_id
    AND dl.is_active = TRUE
    AND (p.is_active IS NULL OR p.is_active = TRUE)
    AND p.is_dropship_excluded = FALSE
  ORDER BY p.name;
$$;

REVOKE ALL ON FUNCTION public.get_dropship_storefront(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dropship_storefront(UUID) TO authenticated, anon;

-- ----------------------------------------------------------------------------
-- SECTION 3B — get_dropshippable_products: the reseller's own "browse
-- products to list" screen needs to see max_delivery_subsidy too, so an
-- already-listed product's row reflects what's actually saved.
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_dropshippable_products(UUID, TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.get_dropshippable_products(
  p_reseller_business_profile_id UUID,
  p_query    TEXT    DEFAULT '',
  p_limit    INTEGER DEFAULT 40,
  p_offset   INTEGER DEFAULT 0
) RETURNS TABLE (
  product_id       UUID,
  name             TEXT,
  sku              TEXT,
  images           JSONB,
  brand            TEXT,
  supermarket_id   UUID,
  supermarket_name TEXT,
  selling_price    DECIMAL,
  available_stock  DECIMAL,
  already_listed   BOOLEAN,
  listed_price     NUMERIC,
  free_delivery    BOOLEAN,
  max_delivery_subsidy NUMERIC
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required';
  END IF;
  IF NOT public.unified_business_member(p_reseller_business_profile_id) THEN
    RAISE EXCEPTION 'You do not have access to this business profile';
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.name::TEXT, p.sku::TEXT, p.images, p.brand::TEXT,
    p.supermarket_id, COALESCE(s.name, s.location)::TEXT,
    p.selling_price,
    GREATEST(COALESCE(inv.current_stock - inv.reserved_stock, 0), 0) AS available_stock,
    dl.id IS NOT NULL AS already_listed,
    dl.listed_price,
    COALESCE(dl.free_delivery, FALSE),
    COALESCE(dl.max_delivery_subsidy, 0)
  FROM public.products p
  JOIN public.supermarkets s ON s.id = p.supermarket_id
  LEFT JOIN public.inventory inv ON inv.product_id = p.id AND inv.supermarket_id = p.supermarket_id
  LEFT JOIN public.dropship_listings dl
    ON dl.product_id = p.id AND dl.reseller_business_profile_id = p_reseller_business_profile_id
  WHERE (p.is_active IS NULL OR p.is_active = TRUE)
    AND p.is_dropship_excluded = FALSE
    AND (p_query = '' OR p.name ILIKE '%' || p_query || '%' OR p.sku ILIKE '%' || p_query || '%')
  ORDER BY p.name
  LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_dropshippable_products(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dropshippable_products(UUID, TEXT, INTEGER, INTEGER) TO authenticated;

-- ----------------------------------------------------------------------------
-- SECTION 4 — dropship_checkout: real server-computed fare + vehicle-type
-- filter + margin-first-cut subsidy. Removing p_delivery_fee (client input)
-- changes the argument type list, so every existing overload must be
-- dropped by name first (plain CREATE OR REPLACE would just add a second,
-- ambiguous overload instead of replacing it — same overload trap
-- FIX_OPERATOR_APPLICATION_UPGRADE_PATH.sql and every mbg_find_available_
-- riders migration already had to work around).
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'dropship_checkout'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.dropship_checkout(%s)', fn.args);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.dropship_checkout(
  p_reseller_business_profile_id UUID,
  p_cart              JSONB,
  p_customer_name     TEXT DEFAULT NULL,
  p_customer_phone    TEXT DEFAULT NULL,
  p_delivery_address  TEXT DEFAULT NULL,
  p_store_location    TEXT DEFAULT NULL,
  p_delivery_lat      NUMERIC DEFAULT NULL,
  p_delivery_lng      NUMERIC DEFAULT NULL,
  p_max_delivery_hours NUMERIC DEFAULT NULL,
  p_rider_id          UUID DEFAULT NULL,
  p_vehicle_types     TEXT[] DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auth_id        UUID := auth.uid();
  v_tx_id          UUID;
  v_tx_record_id   TEXT;
  v_customer_receipt_no TEXT;
  v_store_receipt_no    TEXT;
  v_item           JSONB;
  v_listing        RECORD;
  v_qty            DECIMAL;
  v_tax_rate       DECIMAL;
  v_wholesale_line NUMERIC;
  v_margin_line    NUMERIC;
  v_customer_line  NUMERIC;
  v_tax_line       NUMERIC;
  v_wholesale_subtotal NUMERIC := 0;
  v_margin_total   NUMERIC := 0;
  v_tax_total      NUMERIC := 0;
  v_customer_total NUMERIC := 0;
  v_items_count    INTEGER := 0;
  v_supermarket_id UUID;
  v_customer_snapshot JSONB := '[]'::JSONB;
  v_store_snapshot    JSONB := '[]'::JSONB;
  v_store_owner_id    UUID;
  v_store_name        TEXT;
  v_store_address      TEXT;
  v_store_business_id UUID;
  v_store_lat         NUMERIC;
  v_store_lng         NUMERIC;
  v_reseller_owner_id UUID;
  v_reseller_name     TEXT;
  v_cust_name         TEXT;
  v_cust_phone        TEXT;
  v_dropship_order_id UUID;
  v_delivery_fee NUMERIC := 0;
  v_all_free_delivery BOOLEAN := TRUE;
  v_min_subsidy_cap NUMERIC;
  v_subsidy_cap    NUMERIC;
  v_subsidy_amount NUMERIC := 0;
  v_distance_km     NUMERIC;
  v_time_multiplier NUMERIC;
  v_base_fare NUMERIC;
  v_per_km    NUMERIC;
  v_min_fare  NUMERIC;
  v_raw_fare  NUMERIC;
  v_computed_fare NUMERIC;
  v_rider_mode TEXT;
  v_vip_pct NUMERIC;
  v_discount_pct NUMERIC;
  v_return_discount_pct NUMERIC;
  v_margin_ican_amount NUMERIC;
  v_debit_balance  NUMERIC;
  v_leg_ican_amount NUMERIC;
  v_customer_total_ican NUMERIC;
  v_receipt JSONB;
  v_settlement_legs JSONB := '[]'::JSONB;
  v_min_deadline_hours NUMERIC;
  v_max_deadline_hours NUMERIC;
  v_candidate RECORD;
  v_rider_id UUID;
  v_rider_user_id UUID;
  v_mbg_customer_id UUID;
  v_stage_id UUID;
  v_mbg_ride_id UUID;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sign in with your ICANera wallet to check out');
  END IF;
  IF p_cart IS NULL OR jsonb_array_length(p_cart) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cart is empty');
  END IF;
  IF p_delivery_lat IS NULL OR p_delivery_lng IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'A delivery location is required so a rider can be assigned');
  END IF;

  v_min_deadline_hours := public.mbg_get_setting_numeric('delivery.min_deadline_hours', 1);
  v_max_deadline_hours := public.mbg_get_setting_numeric('delivery.max_deadline_hours', 48);
  IF p_max_delivery_hours IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Choose a maximum delivery time for this order');
  END IF;
  IF p_max_delivery_hours < v_min_deadline_hours OR p_max_delivery_hours > v_max_deadline_hours THEN
    RETURN jsonb_build_object('success', false, 'error', format('Delivery window must be between %s and %s hours', v_min_deadline_hours, v_max_deadline_hours));
  END IF;

  SELECT business_name, user_id INTO v_reseller_name, v_reseller_owner_id
    FROM public.business_profiles WHERE id = p_reseller_business_profile_id;
  IF v_reseller_owner_id IS NULL THEN
    RAISE EXCEPTION 'Reseller storefront not found';
  END IF;

  PERFORM public.ensure_dce_customer_profile(v_auth_id);
  SELECT full_name, phone INTO v_cust_name, v_cust_phone FROM public.users WHERE id = v_auth_id LIMIT 1;

  v_tx_record_id := 'DROPSHIP_' || extract(epoch from now())::BIGINT::TEXT
                     || '_' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
  v_customer_receipt_no := 'RCP-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
  v_store_receipt_no    := 'RCP-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart) LOOP
    v_qty := (v_item->>'quantity')::DECIMAL;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid quantity for product %', v_item->>'product_id';
    END IF;

    SELECT dl.listed_price, dl.free_delivery, dl.max_delivery_subsidy, p.selling_price, p.tax_rate, p.supermarket_id,
           p.name AS product_name, p.sku AS product_sku, p.barcode AS product_barcode
      INTO v_listing
      FROM public.dropship_listings dl
      JOIN public.products p ON p.id = dl.product_id
     WHERE dl.reseller_business_profile_id = p_reseller_business_profile_id
       AND dl.product_id = (v_item->>'product_id')::UUID
       AND dl.is_active = TRUE
       AND (p.is_active IS NULL OR p.is_active = TRUE)
       AND p.is_dropship_excluded = FALSE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % is not available from this reseller', v_item->>'product_id';
    END IF;
    IF v_listing.tax_rate IS NULL THEN
      RAISE EXCEPTION 'Product % has no tax rate configured', v_item->>'product_id';
    END IF;
    IF v_listing.listed_price < v_listing.selling_price THEN
      RAISE EXCEPTION 'Listing for product % is priced below the store price', v_item->>'product_id';
    END IF;
    IF NOT COALESCE(v_listing.free_delivery, FALSE) THEN
      v_all_free_delivery := FALSE;
    END IF;
    v_min_subsidy_cap := CASE
      WHEN v_min_subsidy_cap IS NULL THEN COALESCE(v_listing.max_delivery_subsidy, 0)
      ELSE LEAST(v_min_subsidy_cap, COALESCE(v_listing.max_delivery_subsidy, 0))
    END;

    IF v_supermarket_id IS NULL THEN
      v_supermarket_id := v_listing.supermarket_id;
    ELSIF v_supermarket_id IS DISTINCT FROM v_listing.supermarket_id THEN
      RAISE EXCEPTION 'All items in one dropship checkout must come from the same store — check out each store separately';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.inventory inv
      WHERE inv.product_id = (v_item->>'product_id')::UUID
        AND inv.supermarket_id = v_supermarket_id
        AND GREATEST(inv.current_stock - COALESCE(inv.reserved_stock, 0), 0) >= v_qty
      FOR UPDATE
    ) THEN
      RAISE EXCEPTION 'Insufficient stock for product %', v_item->>'product_id';
    END IF;

    UPDATE public.inventory
       SET current_stock = current_stock - v_qty, updated_at = now()
     WHERE product_id = (v_item->>'product_id')::UUID AND supermarket_id = v_supermarket_id;

    v_tax_rate       := v_listing.tax_rate;
    v_wholesale_line := ROUND(v_listing.selling_price * v_qty, 2);
    v_margin_line    := ROUND((v_listing.listed_price - v_listing.selling_price) * v_qty, 2);
    v_tax_line       := ROUND(v_listing.listed_price * v_qty * (v_tax_rate / 100), 2);
    v_customer_line  := ROUND(v_listing.listed_price * v_qty + v_tax_line, 2);

    v_wholesale_subtotal := v_wholesale_subtotal + v_wholesale_line;
    v_margin_total        := v_margin_total + v_margin_line;
    v_tax_total            := v_tax_total + v_tax_line;
    v_customer_total       := v_customer_total + v_customer_line;
    v_items_count           := v_items_count + 1;

    v_customer_snapshot := v_customer_snapshot || jsonb_build_object(
      'product_id', v_item->>'product_id', 'product_name', v_listing.product_name,
      'product_sku', v_listing.product_sku, 'quantity', v_qty,
      'unit_price', v_listing.listed_price, 'tax_rate', v_tax_rate, 'line_total', v_customer_line
    );
    v_store_snapshot := v_store_snapshot || jsonb_build_object(
      'product_id', v_item->>'product_id', 'product_name', v_listing.product_name,
      'product_sku', v_listing.product_sku, 'quantity', v_qty,
      'unit_price', v_listing.selling_price, 'tax_rate', v_tax_rate,
      'line_total', v_wholesale_line + v_tax_line
    );
  END LOOP;

  SELECT owner_user_id, COALESCE(NULLIF(name, ''), NULLIF(location, ''), 'Store'),
         COALESCE(NULLIF(address, ''), NULLIF(location, '')), pichin_business_profile_id,
         latitude, longitude
    INTO v_store_owner_id, v_store_name, v_store_address, v_store_business_id, v_store_lat, v_store_lng
    FROM public.supermarkets WHERE id = v_supermarket_id;
  IF v_store_owner_id IS NULL THEN
    RAISE EXCEPTION 'The source store has no payment wallet configured';
  END IF;
  IF v_store_business_id IS NULL THEN
    RAISE EXCEPTION 'The source store has no business wallet configured for dropship settlement';
  END IF;
  IF v_store_lat IS NULL OR v_store_lng IS NULL THEN
    RAISE EXCEPTION 'This store has no delivery location configured yet — a rider cannot be routed to it';
  END IF;

  -- ── Rider: the storefront should let the customer see and pick a real
  -- rider/driver for the delivery — same as any other BodaGoera booking —
  -- by first calling mbg_find_available_riders(store_lat, store_lng,
  -- delivery_lat, delivery_lng, ...) itself (already GRANTed to
  -- authenticated) to render a picker, then passing that choice in here as
  -- p_rider_id. If the frontend doesn't offer that step (or the chosen
  -- rider stopped being available in the meantime), NULL falls back to
  -- auto-picking the nearest one, trying a few candidates in case the
  -- nearest already has an unanswered offer on another job (mirrors
  -- mbg_request_ride's own "don't stack a second pending offer" guard).
  -- p_vehicle_types narrows the auto-match to whichever bike/car/van the
  -- customer asked for, same filter mbg_find_available_riders already gives
  -- BodaGoera's own ride screen. Nothing has been charged yet — if no rider
  -- is found, checkout fails cleanly here, before any money moves (stock was
  -- already adjusted above, same pre-existing tradeoff this function has
  -- always had for the pricing loop). ────────────────────────────────────────
  IF p_rider_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.mbg_riders
      WHERE id = p_rider_id AND status = 'active' AND is_available = true
    ) AND NOT EXISTS (
      SELECT 1 FROM public.mbg_rides WHERE rider_id = p_rider_id AND status = 'pending'
    ) THEN
      v_rider_id := p_rider_id;
    ELSE
      RAISE EXCEPTION 'Your chosen rider is no longer available — pick another';
    END IF;
  ELSE
    FOR v_candidate IN
      SELECT rider_id FROM public.mbg_find_available_riders(
        v_store_lat, v_store_lng, p_delivery_lat, p_delivery_lng,
        NULL, NULL, false, ARRAY[]::UUID[], 5, p_vehicle_types
      )
    LOOP
      IF NOT EXISTS (SELECT 1 FROM public.mbg_rides WHERE rider_id = v_candidate.rider_id AND status = 'pending') THEN
        v_rider_id := v_candidate.rider_id;
        EXIT;
      END IF;
    END LOOP;
  END IF;
  IF v_rider_id IS NULL THEN
    RAISE EXCEPTION 'No delivery riders are available right now — try again shortly';
  END IF;
  SELECT user_id INTO v_rider_user_id FROM public.mbg_riders WHERE id = v_rider_id;

  -- ── Real transport fee — the exact same fare engine BodaGoera's own ride
  -- matching uses (mbg_find_available_riders): base_fare + distance*per_km,
  -- floored at the minimum fare, scaled by the live time-of-day multiplier,
  -- then the ASSIGNED rider's own mode surcharge/discount. Never a number
  -- the customer or storefront supplies. ─────────────────────────────────────
  v_distance_km     := public.mbg_haversine_km(v_store_lat, v_store_lng, p_delivery_lat, p_delivery_lng);
  v_time_multiplier := public.mbg_current_time_multiplier();
  v_base_fare := public.mbg_get_setting_numeric('ride.base_fare', 1000);
  v_per_km    := public.mbg_get_setting_numeric('ride.per_km_rate', 1000);
  v_min_fare  := public.mbg_get_setting_numeric('ride.minimum_fare', 2000);
  v_raw_fare  := GREATEST(v_min_fare, v_base_fare + COALESCE(v_distance_km, 0) * v_per_km) * v_time_multiplier;

  SELECT mode, vip_surcharge_pct, discount_pct, return_discount_pct
    INTO v_rider_mode, v_vip_pct, v_discount_pct, v_return_discount_pct
    FROM public.mbg_riders WHERE id = v_rider_id;

  v_computed_fare := ROUND((CASE
    WHEN v_rider_mode = 'vip' THEN v_raw_fare * (1 + COALESCE(v_vip_pct, 0) / 100)
    WHEN v_rider_mode = 'discount' THEN v_raw_fare * (1 - COALESCE(v_discount_pct, 0) / 100)
    WHEN v_rider_mode = 'return' THEN v_raw_fare * (1 - COALESCE(v_return_discount_pct, 0) / 100)
    ELSE v_raw_fare
  END) / 100) * 100;

  -- ── Reseller-capped subsidy: max_delivery_subsidy per listing (or
  -- unlimited when every item in the cart offers free_delivery) is the most
  -- the reseller lets be cut from THEIR OWN margin to shrink what the
  -- customer pays for delivery — capped so it can never exceed either the
  -- real fare itself or the reseller's actual margin on this order (a
  -- reseller can never be pushed into paying out of pocket). The rider is
  -- still paid the FULL real fare regardless: the subsidized part is simply
  -- redirected to them straight out of the reseller's margin leg below, cut
  -- BEFORE whatever's left becomes the reseller's profit. ────────────────────
  v_subsidy_cap    := CASE WHEN v_all_free_delivery THEN v_computed_fare ELSE COALESCE(v_min_subsidy_cap, 0) END;
  v_subsidy_amount := LEAST(v_subsidy_cap, v_computed_fare, v_margin_total);
  v_delivery_fee   := v_computed_fare - v_subsidy_amount;
  v_customer_total := v_customer_total + v_delivery_fee;

  -- ── Every leg below still debits the customer's personal ICAN wallet
  -- directly and records their own 'transfer_out' ledger row immediately
  -- (funds guaranteed at checkout, unchanged). What's NEW: the payee side is
  -- no longer credited here — it's queued as an unsettled settlement leg on
  -- the shared receipt, released only once the seal scan
  -- (icanera_confirm_pickup) proves the order actually left the store. ─────

  -- ── Store's wholesale + tax leg ──────────────────────────────────────────
  v_leg_ican_amount := GREATEST(ROUND((v_wholesale_subtotal + v_tax_total) / 5000, 8), 0.00000001);

  SELECT ican_balance INTO v_debit_balance
    FROM public.ican_user_wallets WHERE user_id = v_auth_id FOR UPDATE;
  IF v_debit_balance IS NULL THEN
    RAISE EXCEPTION 'Your ICAN wallet was not found';
  END IF;
  IF v_debit_balance < v_leg_ican_amount THEN
    RAISE EXCEPTION 'Insufficient ICAN balance for this purchase';
  END IF;

  UPDATE public.ican_user_wallets
     SET ican_balance = ican_balance - v_leg_ican_amount, total_spent = total_spent + v_leg_ican_amount
   WHERE user_id = v_auth_id;

  INSERT INTO public.ican_coin_transactions
    (sender_user_id, ican_amount, type, transaction_type, status, local_amount, local_currency,
     merchant_name, counterparty_type, expense_classification, source_app, reference_id, note, business_profile_id)
  VALUES
    (v_auth_id, v_leg_ican_amount, 'transfer_out', 'transfer_out', 'completed',
     v_wholesale_subtotal + v_tax_total, 'UGX', v_store_name, 'business', 'business_expense',
     'digital-city-era', v_tx_record_id || '_STORE',
     format('Dropship sale via %s | receipt %s (held until dispatch is confirmed)', COALESCE(v_reseller_name, 'reseller'), v_store_receipt_no),
     v_store_business_id);

  v_settlement_legs := v_settlement_legs || jsonb_build_array(jsonb_build_object(
    'payee_type', 'business', 'payee_id', v_store_business_id,
    'ican_amount', v_leg_ican_amount, 'ugx_amount', v_wholesale_subtotal + v_tax_total,
    'note', format('Dropship sale via %s | receipt %s', COALESCE(v_reseller_name, 'reseller'), v_store_receipt_no)
  ));

  -- ── Delivery fee: the discounted, customer-facing portion of the real
  -- fare — paid to the ASSIGNED RIDER's own wallet ('personal' leg). ────────
  IF v_delivery_fee > 0 THEN
    v_leg_ican_amount := GREATEST(ROUND(v_delivery_fee / 5000, 8), 0.00000001);

    SELECT ican_balance INTO v_debit_balance
      FROM public.ican_user_wallets WHERE user_id = v_auth_id FOR UPDATE;
    IF v_debit_balance < v_leg_ican_amount THEN
      RAISE EXCEPTION 'Insufficient ICAN balance for the delivery fee';
    END IF;

    UPDATE public.ican_user_wallets
       SET ican_balance = ican_balance - v_leg_ican_amount, total_spent = total_spent + v_leg_ican_amount
     WHERE user_id = v_auth_id;

    INSERT INTO public.ican_coin_transactions
      (sender_user_id, ican_amount, type, transaction_type, status, local_amount, local_currency,
       merchant_name, counterparty_type, expense_classification, source_app, reference_id, note, business_profile_id)
    VALUES
      (v_auth_id, v_leg_ican_amount, 'transfer_out', 'transfer_out', 'completed',
       v_delivery_fee, 'UGX', 'BodaGoera rider', 'business', 'business_expense',
       'digital-city-era', v_tx_record_id || '_DELIVERY',
       format('Dropship delivery fee | receipt %s (held until dispatch is confirmed)', v_store_receipt_no),
       NULL);

    v_settlement_legs := v_settlement_legs || jsonb_build_array(jsonb_build_object(
      'payee_type', 'personal', 'payee_id', v_rider_user_id,
      'ican_amount', v_leg_ican_amount, 'ugx_amount', v_delivery_fee,
      'note', format('Dropship delivery fee | receipt %s', v_store_receipt_no)
    ));
  END IF;

  -- ── Reseller's delivery subsidy: the gap between the real fare and what
  -- the customer was charged for it, paid straight to the rider as a
  -- top-up — funded by cutting it from the reseller's own margin leg below,
  -- BEFORE that leg is built, so it is never part of the reseller's profit
  -- in the first place. ───────────────────────────────────────────────────
  IF v_subsidy_amount > 0 THEN
    v_leg_ican_amount := GREATEST(ROUND(v_subsidy_amount / 5000, 8), 0.00000001);

    SELECT ican_balance INTO v_debit_balance
      FROM public.ican_user_wallets WHERE user_id = v_auth_id FOR UPDATE;
    IF v_debit_balance < v_leg_ican_amount THEN
      RAISE EXCEPTION 'Insufficient ICAN balance for the delivery fee';
    END IF;

    UPDATE public.ican_user_wallets
       SET ican_balance = ican_balance - v_leg_ican_amount, total_spent = total_spent + v_leg_ican_amount
     WHERE user_id = v_auth_id;

    INSERT INTO public.ican_coin_transactions
      (sender_user_id, ican_amount, type, transaction_type, status, local_amount, local_currency,
       merchant_name, counterparty_type, expense_classification, source_app, reference_id, note, business_profile_id)
    VALUES
      (v_auth_id, v_leg_ican_amount, 'transfer_out', 'transfer_out', 'completed',
       v_subsidy_amount, 'UGX', 'BodaGoera rider', 'business', 'business_expense',
       'digital-city-era', v_tx_record_id || '_DELIVERY_SUBSIDY',
       format('Dropship delivery subsidy from %s | receipt %s (held until dispatch is confirmed)', COALESCE(v_reseller_name, 'reseller'), v_store_receipt_no),
       NULL);

    v_settlement_legs := v_settlement_legs || jsonb_build_array(jsonb_build_object(
      'payee_type', 'personal', 'payee_id', v_rider_user_id,
      'ican_amount', v_leg_ican_amount, 'ugx_amount', v_subsidy_amount,
      'note', format('Dropship delivery subsidy from %s | receipt %s', COALESCE(v_reseller_name, 'reseller'), v_store_receipt_no)
    ));

    v_margin_total := v_margin_total - v_subsidy_amount;
  END IF;

  -- ── Reseller's markup leg (net of any subsidy cut above — this is the
  -- reseller's ACTUAL profit on the order, after transport was cut first) ──
  IF v_margin_total > 0 THEN
    v_margin_ican_amount := GREATEST(ROUND(v_margin_total / 5000, 8), 0.00000001);

    SELECT ican_balance INTO v_debit_balance
      FROM public.ican_user_wallets WHERE user_id = v_auth_id FOR UPDATE;
    IF v_debit_balance < v_margin_ican_amount THEN
      RAISE EXCEPTION 'Insufficient ICAN balance for this purchase';
    END IF;

    UPDATE public.ican_user_wallets
       SET ican_balance = ican_balance - v_margin_ican_amount, total_spent = total_spent + v_margin_ican_amount
     WHERE user_id = v_auth_id;

    INSERT INTO public.ican_coin_transactions
      (sender_user_id, ican_amount, type, transaction_type, status, local_amount, local_currency,
       merchant_name, counterparty_type, expense_classification, source_app, reference_id, note, business_profile_id)
    VALUES
      (v_auth_id, v_margin_ican_amount, 'transfer_out', 'transfer_out', 'completed',
       v_margin_total, 'UGX', v_reseller_name, 'business', 'business_expense',
       'digital-city-era', v_tx_record_id || '_RESELLER',
       format('Dropship commission | %s | receipt %s (held until dispatch is confirmed)', COALESCE(v_store_name, 'store'), v_customer_receipt_no),
       p_reseller_business_profile_id);

    v_settlement_legs := v_settlement_legs || jsonb_build_array(jsonb_build_object(
      'payee_type', 'business', 'payee_id', p_reseller_business_profile_id,
      'ican_amount', v_margin_ican_amount, 'ugx_amount', v_margin_total,
      'note', format('Dropship commission | %s | receipt %s', COALESCE(v_store_name, 'store'), v_customer_receipt_no)
    ));
  END IF;

  -- ── One transaction record for the sale ─────────────────────────────────────
  INSERT INTO public.transactions (
    transaction_id, receipt_number, cashier_id, cashier_name,
    register_number, store_location, supermarket_id, subtotal, tax_amount, tax_rate,
    total_amount, payment_method, customer_name, customer_phone,
    customer_user_id, items_count, items, status, created_at
  ) VALUES (
    v_tx_record_id, v_customer_receipt_no, v_auth_id, COALESCE(v_cust_name, 'Dropship Customer'),
    'DROPSHIP', COALESCE(p_store_location, v_reseller_name, 'Dropship'), v_supermarket_id,
    v_customer_total - v_tax_total, v_tax_total,
    CASE WHEN v_customer_total > v_tax_total THEN ROUND((v_tax_total / (v_customer_total - v_tax_total)) * 100, 2) ELSE NULL END,
    v_customer_total, 'ican', COALESCE(p_customer_name, v_cust_name, 'Dropship Customer'),
    COALESCE(p_customer_phone, v_cust_phone), v_auth_id, v_items_count, v_customer_snapshot, 'completed', now()
  ) RETURNING id INTO v_tx_id;

  INSERT INTO public.sales_transaction_items (
    transaction_id, product_id, product_name, product_sku, product_barcode,
    unit_price, quantity, line_total, tax_included, tax_amount
  )
  SELECT v_tx_id, (item->>'product_id')::UUID, p.name, p.sku, p.barcode,
         (item->>'unit_price')::DECIMAL, (item->>'quantity')::DECIMAL, (item->>'line_total')::DECIMAL,
         TRUE, (item->>'tax_rate')::DECIMAL / 100 * (item->>'unit_price')::DECIMAL * (item->>'quantity')::DECIMAL
  FROM jsonb_array_elements(v_customer_snapshot) item
  JOIN public.products p ON p.id = (item->>'product_id')::UUID;

  INSERT INTO public.receipts (
    receipt_number, transaction_id, cashier_id, cashier_name, customer_name,
    subtotal, tax_amount, total_amount, amount_paid, payment_method, items_json,
    status, register_id, store_location, created_at
  ) VALUES (
    v_customer_receipt_no, v_tx_record_id, v_reseller_owner_id, COALESCE(v_reseller_name, 'Reseller'),
    COALESCE(p_customer_name, v_cust_name, 'Dropship Customer'),
    v_customer_total - v_tax_total, v_tax_total, v_customer_total, v_customer_total,
    'ican', v_customer_snapshot, 'completed', 'DROPSHIP', COALESCE(v_reseller_name, 'Dropship'), now()
  );

  INSERT INTO public.receipts (
    receipt_number, transaction_id, cashier_id, cashier_name, customer_name,
    subtotal, tax_amount, total_amount, amount_paid, payment_method, items_json,
    status, register_id, store_location, created_at
  ) VALUES (
    v_store_receipt_no, v_tx_record_id, v_store_owner_id, COALESCE(v_store_name, 'Store'),
    format('Dropship via %s', COALESCE(v_reseller_name, 'reseller')),
    v_wholesale_subtotal, v_tax_total, v_wholesale_subtotal + v_tax_total + v_delivery_fee, v_wholesale_subtotal + v_tax_total + v_delivery_fee,
    'ican', v_store_snapshot, 'completed', 'DROPSHIP', COALESCE(v_store_name, 'Store'), now()
  );

  -- ── Real rider booking: ensure a customer profile exists on the
  -- mybodaguy side, pick the nearest active stage (same lookup
  -- mbg_request_ride uses), and create the ride itself. fare/rider_earning
  -- are 0 — the delivery fee is paid as a settlement leg above, not through
  -- the ordinary ride-fare mechanism, so nothing here double-charges or
  -- double-pays. wallet_charged_at_acceptance=true means mbg_complete_ride
  -- never tries to charge for this ride either. delivery_mode='dropship'
  -- keeps it out of mbg_respond_to_ride's supermarket goods-repricing
  -- branch (see file header). ─────────────────────────────────────────────
  SELECT id INTO v_mbg_customer_id FROM public.mbg_customers WHERE user_id = v_auth_id;
  IF v_mbg_customer_id IS NULL THEN
    INSERT INTO public.mbg_customers (user_id) VALUES (v_auth_id) RETURNING id INTO v_mbg_customer_id;
  END IF;

  SELECT id INTO v_stage_id FROM public.mbg_stages
  WHERE is_active = true AND location_lat IS NOT NULL AND location_lng IS NOT NULL
  ORDER BY public.mbg_haversine_km(location_lat, location_lng, v_store_lat, v_store_lng) ASC
  LIMIT 1;
  IF v_stage_id IS NULL THEN
    SELECT id INTO v_stage_id FROM public.mbg_stages WHERE is_active = true LIMIT 1;
  END IF;
  IF v_stage_id IS NULL THEN
    RAISE EXCEPTION 'No active stage is configured yet to route this delivery through';
  END IF;

  INSERT INTO public.mbg_rides (
    customer_id, rider_id, stage_id,
    pickup_location, pickup_lat, pickup_lng,
    dropoff_location, dropoff_lat, dropoff_lng,
    status, fare, service_type, delivery_mode, supermarket_id,
    time_multiplier, rider_earning, chairperson_commission_total,
    order_notes, payment_method, wallet_charged_at_acceptance, max_delivery_hours
  ) VALUES (
    v_mbg_customer_id, v_rider_id, v_stage_id,
    COALESCE(v_store_address, v_store_name), v_store_lat, v_store_lng,
    COALESCE(p_delivery_address, 'Delivery address'), p_delivery_lat, p_delivery_lng,
    'pending', 0, 'delivery', 'dropship', v_supermarket_id,
    1, 0, 0,
    format('%s item(s) via %s', v_items_count, COALESCE(v_reseller_name, 'reseller')), 'wallet', true, p_max_delivery_hours
  ) RETURNING id INTO v_mbg_ride_id;

  INSERT INTO public.mbg_ride_platform_fees (ride_id, platform_fee_ugx) VALUES (v_mbg_ride_id, 0);

  INSERT INTO public.dropship_orders (
    transaction_id, reseller_business_profile_id, supermarket_id,
    wholesale_amount, reseller_margin_amount, customer_paid_amount,
    customer_receipt_number, store_receipt_number,
    pickup_address, delivery_address, delivery_fee_amount,
    real_transport_fare, reseller_transport_subsidy, status,
    transport_status, bodago_delivery_request_id
  ) VALUES (
    v_tx_record_id, p_reseller_business_profile_id, v_supermarket_id,
    v_wholesale_subtotal + v_tax_total, v_margin_total, v_customer_total,
    v_customer_receipt_no, v_store_receipt_no,
    COALESCE(v_store_address, v_store_name), p_delivery_address, v_delivery_fee,
    v_computed_fare, v_subsidy_amount, 'pending_dispatch',
    'assigned', v_mbg_ride_id
  ) RETURNING id INTO v_dropship_order_id;

  -- ── 3-party QR verification receipt, now carrying the unsettled
  -- settlement legs + chosen delivery window. rider_user_id is finally
  -- real, not NULL. Best-effort: a missing/older shared table must never
  -- block a real checkout that already moved real money above.
  v_customer_total_ican := GREATEST(ROUND(v_customer_total / 5000, 8), 0.00000001);
  BEGIN
    v_receipt := public.icanera_create_delivery_receipt(
      'digital-city-era', 'dropship_order', v_dropship_order_id,
      v_auth_id, v_store_owner_id, v_rider_user_id,
      COALESCE(v_store_name, 'Store'),
      format('%s item(s) via %s', v_items_count, COALESCE(v_reseller_name, 'reseller')),
      v_customer_total_ican,
      NULL, v_settlement_legs, p_max_delivery_hours
    );
  EXCEPTION WHEN undefined_function THEN
    v_receipt := NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'dropship_order_id', v_dropship_order_id,
    'mbg_ride_id', v_mbg_ride_id,
    'transaction_id', v_tx_id,
    'customer_receipt_number', v_customer_receipt_no,
    'store_receipt_number', v_store_receipt_no,
    'customer_paid_total', v_customer_total,
    'store_wholesale_total', v_wholesale_subtotal + v_tax_total,
    'reseller_margin_total', v_margin_total,
    'delivery_fee', v_delivery_fee,
    'real_transport_fare', v_computed_fare,
    'reseller_transport_subsidy', v_subsidy_amount,
    'items_count', v_items_count,
    'delivery_address', p_delivery_address,
    'transport_provider', 'bodagoera',
    'rider_id', v_rider_id,
    'max_delivery_hours', p_max_delivery_hours,
    'verification_code', v_receipt ->> 'verification_code',
    'verify_url', v_receipt ->> 'verify_url'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dropship_checkout(UUID, JSONB, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dropship_checkout(UUID, JSONB, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, UUID, TEXT[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ dropship_checkout now computes the delivery fee itself (BodaGoera''s own base_fare+distance*per_km+time-multiplier+mode-surcharge formula, never a client-supplied number), accepts p_vehicle_types so customers can ask for a bike/car/van specifically, and lets resellers cap a per-listing delivery subsidy (dropship_listings.max_delivery_subsidy) that is cut from their OWN margin leg — never the rider''s — before whatever is left becomes their profit.';
END $$;
