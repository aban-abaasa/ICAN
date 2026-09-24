-- ============================================================
-- CMMS supplier ordering: nearest supplier + BodaGoera delivery
-- ============================================================
-- Adds what the "Order from supplier" panel needs to search every supplier's
-- products at once, suggest the closest supplier, and recommend a BodaGoera
-- delivery with a real quote:
--
--   1. Locations. A supplier's coordinates come from supplier_directory
--      (new columns) or, failing that, the Supermarketa suppliers row
--      (suppliers.latitude/longitude, added by digital-city-era's
--      ADD_GEOCODING_TO_SUPPLIERS_AND_SUPERMARKETS.sql). A company's saved
--      delivery point lives on cmms_company_profiles.
--   2. cmms_quote_delivery: a live BodaGoera quote for a pickup -> drop-off
--      pair, taken from BodaGoera's own matching functions so the number
--      shown is the number BodaGoera charges (boda = ride fare formula,
--      car/van/truck = cargo fare formula) plus how many vehicles are free
--      right now and how close the nearest one is.
--   3. cmms_request_supplier_order_delivery: books that delivery for a
--      supplier order as a request in the company's BodaGoera CORPORATE
--      transport contract queue (the same bridge CMMS requisitions already
--      use -- CMMS_AUTOMATIC_BODAGO_ORDER_MONITOR.sql). It is billed through
--      the contract, never through the goods payment request, and the
--      estimate is recomputed on the server, not trusted from the browser.
--
-- Money: the goods are still paid exactly as before (business-wallet payment
-- request, approved with the wallet PIN). Delivery is a separate BodaGoera
-- charge on the company's transport contract; no fee is added or deducted
-- from the goods payment.
--
-- Run after: CMMS_SUPPLIER_PURCHASE_ORDERS.sql,
-- CMMS_SUPPLIER_MARKETPLACE_SMART_MATCH.sql,
-- CMMS_ANNOUNCEMENTS_AND_JOBS.sql (cmms_has_tool_action), and BodaGoera's
-- SHARED_CORPORATE_TRANSPORT_AND_MONTHLY_RIDERS.sql,
-- CREATE_REAL_RIDE_MATCHING_ENGINE.sql, ADD_VEHICLE_TYPE_FILTER_TO_RIDE_MATCHING.sql,
-- CREATE_JOURNEY_BOOKING_ENGINE.sql (mbg_find_available_vehicles).
-- Safe to run more than once.
-- ============================================================

-- ============================================================
-- 1. Locations
-- ============================================================

ALTER TABLE IF EXISTS public.suppliers
  ADD COLUMN IF NOT EXISTS latitude  DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8);

ALTER TABLE public.supplier_directory
  ADD COLUMN IF NOT EXISTS latitude  DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;

ALTER TABLE public.cmms_company_profiles
  ADD COLUMN IF NOT EXISTS delivery_latitude  DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS delivery_longitude DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS delivery_address TEXT;

-- Any active member of the company, same rule as cmms_get_supplier_catalog.
CREATE OR REPLACE FUNCTION public.cmms_is_company_member(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cmms_company_profiles cp
    WHERE cp.id = p_company_id AND cp.is_active
      AND cp.pichin_business_profile_id IS NOT NULL
      AND (
        public.unified_business_member(cp.pichin_business_profile_id)
        OR EXISTS (
          SELECT 1 FROM public.cmms_users u
          WHERE u.cmms_company_id = p_company_id AND u.is_active
            AND lower(u.email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
        )
      )
  );
$$;

-- Same people who can place a supplier order (matches the panel's canOrder).
CREATE OR REPLACE FUNCTION public.cmms_can_order_from_suppliers(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.cmms_is_company_member(p_company_id)
     AND (
       public.cmms_has_tool_action(p_company_id, 'requisitions', 'purchase')
       OR public.cmms_has_tool_action(p_company_id, 'requisitions', 'create')
       OR public.cmms_has_tool_action(p_company_id, 'inventory', 'edit')
     );
$$;

-- A supplier pins its own location (from its portal or business profile).
CREATE OR REPLACE FUNCTION public.cmms_set_supplier_location(
  p_business_profile_id UUID,
  p_latitude NUMERIC,
  p_longitude NUMERIC,
  p_address TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;
  IF NOT public.unified_business_member(p_business_profile_id) THEN
    RAISE EXCEPTION 'You are not an active member of this business.';
  END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL
     OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Invalid coordinates.';
  END IF;

  UPDATE public.supplier_directory
     SET latitude = p_latitude, longitude = p_longitude,
         address = COALESCE(NULLIF(TRIM(COALESCE(p_address, '')), ''), address),
         city = COALESCE(NULLIF(TRIM(COALESCE(p_city, '')), ''), city),
         location_updated_at = NOW(), updated_at = NOW()
   WHERE business_profile_id = p_business_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This business is not listed as a supplier.';
  END IF;

  -- Keep the Supermarketa supplier row in step, so its own BodaGo dispatch
  -- (deliveryDispatchService.js) uses the same pin.
  UPDATE public.suppliers su
     SET latitude = p_latitude, longitude = p_longitude
    FROM public.business_profiles bp
   WHERE bp.id = p_business_profile_id AND su.user_id = bp.user_id;
END;
$$;

-- The company's saved delivery point (where supplier orders are delivered).
CREATE OR REPLACE FUNCTION public.cmms_set_company_delivery_point(
  p_company_id UUID,
  p_latitude NUMERIC,
  p_longitude NUMERIC,
  p_address TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;
  IF NOT public.cmms_can_order_from_suppliers(p_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to set the delivery point.';
  END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL
     OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Invalid coordinates.';
  END IF;

  UPDATE public.cmms_company_profiles
     SET delivery_latitude = p_latitude, delivery_longitude = p_longitude,
         delivery_address = COALESCE(NULLIF(TRIM(COALESCE(p_address, '')), ''), delivery_address),
         updated_at = NOW()
   WHERE id = p_company_id;
END;
$$;

-- Where every published supplier is, plus the company's saved delivery point.
-- Suppliers without coordinates are returned too (latitude/longitude NULL) so
-- the panel can say "location not set" instead of hiding them.
CREATE OR REPLACE FUNCTION public.cmms_get_supplier_locations(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.cmms_is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'You are not an active member of this CMMS business';
  END IF;

  RETURN jsonb_build_object(
    'company', (
      SELECT jsonb_build_object(
               'latitude', cp.delivery_latitude, 'longitude', cp.delivery_longitude,
               'address', cp.delivery_address)
      FROM public.cmms_company_profiles cp WHERE cp.id = p_company_id
    ),
    'suppliers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'business_profile_id', sd.business_profile_id,
               'latitude', COALESCE(sd.latitude, s.latitude),
               'longitude', COALESCE(sd.longitude, s.longitude),
               'address', COALESCE(NULLIF(sd.address, ''), s.address),
               'city', COALESCE(NULLIF(sd.city, ''), s.city),
               'transport_enabled', sd.transport_enabled))
      FROM public.supplier_directory sd
      JOIN public.business_profiles bp ON bp.id = sd.business_profile_id
      LEFT JOIN LATERAL (
        SELECT su.latitude, su.longitude, su.address, su.city
        FROM public.suppliers su WHERE su.user_id = bp.user_id LIMIT 1
      ) s ON TRUE
      WHERE sd.is_published AND COALESCE(bp.status, 'active') = 'active'
    ), '[]'::JSONB)
  );
END;
$$;

-- ============================================================
-- 2. Live BodaGoera quote
-- ============================================================
-- p_vehicle_type: 'motorcycle' (a boda), 'car', 'van' or 'truck'.
-- A boda is priced like a BodaGoera ride (mbg_find_available_riders: base +
-- distance, minimum fare, live time-of-day multiplier); a car/van/truck like
-- BodaGoera cargo (cargo.base_fare + distance x cargo.per_km_rate). When no
-- vehicle is free right now the same formula gives the estimate and
-- 'available_count' is 0, so the buyer still sees a price.

CREATE OR REPLACE FUNCTION public.cmms_quote_delivery(
  p_pickup_lat NUMERIC, p_pickup_lng NUMERIC,
  p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC,
  p_vehicle_type TEXT DEFAULT 'motorcycle',
  p_country TEXT DEFAULT 'Uganda'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_type TEXT := CASE lower(COALESCE(p_vehicle_type, 'motorcycle'))
                   WHEN 'boda' THEN 'motorcycle' ELSE lower(COALESCE(p_vehicle_type, 'motorcycle')) END;
  v_distance NUMERIC;
  v_fare NUMERIC;
  v_count INTEGER := 0;
  v_nearest NUMERIC;
  v_eta INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;
  IF v_type NOT IN ('motorcycle', 'car', 'van', 'truck') THEN
    RAISE EXCEPTION 'Unknown vehicle type.';
  END IF;

  v_distance := public.mbg_haversine_km(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);
  IF v_distance IS NULL THEN
    RAISE EXCEPTION 'Invalid pickup or drop-off coordinates.';
  END IF;

  IF v_type = 'motorcycle' THEN
    SELECT r.fare, r.distance_to_pickup_km, r.estimated_arrival_min
      INTO v_fare, v_nearest, v_eta
      FROM public.mbg_find_available_riders(
             p_pickup_lat => p_pickup_lat, p_pickup_lng => p_pickup_lng,
             p_dropoff_lat => p_dropoff_lat, p_dropoff_lng => p_dropoff_lng,
             p_limit => 1, p_vehicle_types => ARRAY['motorcycle']) r
     LIMIT 1;
    SELECT COUNT(*) INTO v_count
      FROM public.mbg_find_available_riders(
             p_pickup_lat => p_pickup_lat, p_pickup_lng => p_pickup_lng,
             p_dropoff_lat => p_dropoff_lat, p_dropoff_lng => p_dropoff_lng,
             p_limit => 50, p_vehicle_types => ARRAY['motorcycle']);

    IF v_fare IS NULL THEN
      v_fare := ROUND((GREATEST(public.mbg_get_setting_numeric('ride.minimum_fare', 2000),
                                public.mbg_get_setting_numeric('ride.base_fare', 1000)
                                + v_distance * public.mbg_get_setting_numeric('ride.per_km_rate', 1000))
                       * public.mbg_current_time_multiplier()) / 100) * 100;
    END IF;
  ELSE
    SELECT v.fare, v.distance_to_pickup_km
      INTO v_fare, v_nearest
      FROM public.mbg_find_available_vehicles(
             p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng,
             p_country, ARRAY[v_type],
             CASE WHEN v_type = 'car' THEN 'passenger' ELSE 'cargo' END,
             NULL, ARRAY[]::UUID[], 1) v
     LIMIT 1;
    SELECT COUNT(*) INTO v_count
      FROM public.mbg_find_available_vehicles(
             p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng,
             p_country, ARRAY[v_type],
             CASE WHEN v_type = 'car' THEN 'passenger' ELSE 'cargo' END,
             NULL, ARRAY[]::UUID[], 50);

    IF v_fare IS NULL THEN
      v_fare := ROUND((public.mbg_get_setting_numeric('cargo.base_fare', 5000)
                       + v_distance * public.mbg_get_setting_numeric('cargo.per_km_rate', 2000)) / 100) * 100;
    END IF;
    v_eta := CASE WHEN v_nearest IS NULL THEN NULL ELSE GREATEST(2, ROUND(v_nearest / 30 * 60))::INTEGER END;
  END IF;

  RETURN jsonb_build_object(
    'vehicle_type', v_type,
    'distance_km', ROUND(v_distance, 1),
    'fare', v_fare,
    'currency', 'UGX',
    'available_count', v_count,
    'nearest_vehicle_km', ROUND(v_nearest, 1),
    'eta_min', v_eta
  );
END;
$$;

-- ============================================================
-- 3. Book the delivery for a supplier order
-- ============================================================

ALTER TABLE public.mbg_corporate_ride_requests
  ADD COLUMN IF NOT EXISTS pickup_lat NUMERIC,
  ADD COLUMN IF NOT EXISTS pickup_lng NUMERIC,
  ADD COLUMN IF NOT EXISTS dropoff_lat NUMERIC,
  ADD COLUMN IF NOT EXISTS dropoff_lng NUMERIC,
  ADD COLUMN IF NOT EXISTS supplier_order_id UUID REFERENCES public.supplier_marketplace_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mbg_ride_requests_supplier_order
  ON public.mbg_corporate_ride_requests(supplier_order_id) WHERE supplier_order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.cmms_request_supplier_order_delivery(
  p_order_id UUID,
  p_vehicle_type TEXT,
  p_dropoff_lat NUMERIC,
  p_dropoff_lng NUMERIC,
  p_dropoff_address TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_order public.supplier_marketplace_orders;
  v_company public.cmms_company_profiles;
  v_type TEXT := CASE lower(COALESCE(p_vehicle_type, 'motorcycle'))
                   WHEN 'boda' THEN 'motorcycle' ELSE lower(COALESCE(p_vehicle_type, 'motorcycle')) END;
  v_contract_id UUID;
  v_pickup_lat NUMERIC;
  v_pickup_lng NUMERIC;
  v_pickup_address TEXT;
  v_quote JSONB;
  v_fare NUMERIC := 0;
  v_request_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  SELECT * INTO v_order FROM public.supplier_marketplace_orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL OR v_order.cmms_company_id IS NULL THEN
    RAISE EXCEPTION 'Supplier order not found.';
  END IF;
  IF NOT public.cmms_can_order_from_suppliers(v_order.cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to arrange delivery for this order.';
  END IF;
  IF v_order.status IN ('rejected', 'cancelled', 'fulfilled') THEN
    RAISE EXCEPTION 'This order is % and cannot be delivered.', v_order.status;
  END IF;
  IF COALESCE(v_order.transport_status, 'not_requested') NOT IN ('not_requested', 'cancelled') THEN
    RAISE EXCEPTION 'A delivery has already been requested for this order.';
  END IF;
  IF v_type NOT IN ('motorcycle', 'car', 'van', 'truck') THEN
    RAISE EXCEPTION 'Unknown vehicle type.';
  END IF;
  IF p_dropoff_lat IS NULL OR p_dropoff_lng IS NULL
     OR NULLIF(TRIM(COALESCE(p_dropoff_address, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A delivery address and map point are required.';
  END IF;

  SELECT * INTO v_company FROM public.cmms_company_profiles WHERE id = v_order.cmms_company_id;

  -- BodaGoera bills a company through its active transport contract.
  SELECT c.id INTO v_contract_id
  FROM public.mbg_corporate_transport_contracts c
  WHERE c.business_profile_id = v_company.pichin_business_profile_id AND c.status = 'active'
    AND c.starts_on <= CURRENT_DATE AND (c.ends_on IS NULL OR c.ends_on >= CURRENT_DATE)
  ORDER BY c.created_at DESC LIMIT 1;
  IF v_contract_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false, 'code', 'no_contract',
      'message', 'Your company has no active BodaGoera transport contract yet. Create one in Book Transport, then request delivery again.');
  END IF;

  -- Pickup = the supplier's pinned location (or its Supermarketa address).
  SELECT COALESCE(sd.latitude, s.latitude), COALESCE(sd.longitude, s.longitude),
         COALESCE(NULLIF(sd.address, ''), s.address, bp.business_name)
    INTO v_pickup_lat, v_pickup_lng, v_pickup_address
  FROM public.supplier_directory sd
  JOIN public.business_profiles bp ON bp.id = sd.business_profile_id
  LEFT JOIN LATERAL (
    SELECT su.latitude, su.longitude, su.address FROM public.suppliers su WHERE su.user_id = bp.user_id LIMIT 1
  ) s ON TRUE
  WHERE sd.business_profile_id = v_order.supplier_business_profile_id;

  -- The estimate is recomputed here; nothing the browser sends sets the fare.
  IF v_pickup_lat IS NOT NULL AND v_pickup_lng IS NOT NULL THEN
    v_quote := public.cmms_quote_delivery(v_pickup_lat, v_pickup_lng, p_dropoff_lat, p_dropoff_lng, v_type);
    v_fare := COALESCE((v_quote ->> 'fare')::NUMERIC, 0);
  END IF;

  INSERT INTO public.mbg_corporate_ride_requests (
    contract_id, business_profile_id, requested_by, ride_count, requested_vehicle_type,
    recurrence, pickup_location, dropoff_location, status, estimated_total,
    pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, supplier_order_id
  ) VALUES (
    v_contract_id, v_company.pichin_business_profile_id, auth.uid(), 1, v_type,
    'once', COALESCE(v_pickup_address, 'Supplier'), TRIM(p_dropoff_address), 'pending', v_fare,
    v_pickup_lat, v_pickup_lng, p_dropoff_lat, p_dropoff_lng, v_order.id
  ) RETURNING id INTO v_request_id;

  UPDATE public.supplier_marketplace_orders
     SET transport_provider = 'bodagoera',
         transport_method = 'bodagoera',
         transport_status = 'requested',
         preferred_vehicle_type = v_type,
         bodago_delivery_request_id = v_request_id,
         pickup_address = v_pickup_address,
         delivery_address = TRIM(p_dropoff_address),
         delivery_details = COALESCE(delivery_details, '{}'::JSONB) || jsonb_build_object(
           'dropoff_lat', p_dropoff_lat, 'dropoff_lng', p_dropoff_lng, 'delivery_fare_estimate', v_fare),
         updated_at = NOW()
   WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'success', true, 'request_id', v_request_id, 'vehicle_type', v_type,
    'estimated_fare', v_fare, 'quote', v_quote);
END;
$$;

-- Keep the order's delivery status in step with BodaGoera's dispatch queue.
CREATE OR REPLACE FUNCTION public.cmms_sync_order_transport_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.supplier_order_id IS NOT NULL THEN
    UPDATE public.supplier_marketplace_orders
       SET transport_status = CASE NEW.status
             WHEN 'pending' THEN 'requested'
             WHEN 'approved' THEN 'requested'
             WHEN 'dispatched' THEN 'dispatched'
             WHEN 'completed' THEN 'delivered'
             ELSE 'cancelled' END,
           updated_at = NOW()
     WHERE id = NEW.supplier_order_id AND bodago_delivery_request_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cmms_sync_order_transport_status ON public.mbg_corporate_ride_requests;
CREATE TRIGGER trg_cmms_sync_order_transport_status
  AFTER UPDATE OF status ON public.mbg_corporate_ride_requests
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.cmms_sync_order_transport_status();

-- ============================================================
-- 4. Grants
-- ============================================================

REVOKE ALL ON FUNCTION public.cmms_is_company_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_can_order_from_suppliers(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_set_supplier_location(UUID, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_set_company_delivery_point(UUID, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_get_supplier_locations(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_quote_delivery(NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_request_supplier_order_delivery(UUID, TEXT, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.cmms_is_company_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_can_order_from_suppliers(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_set_supplier_location(UUID, NUMERIC, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_set_company_delivery_point(UUID, NUMERIC, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_get_supplier_locations(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_quote_delivery(NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_request_supplier_order_delivery(UUID, TEXT, NUMERIC, NUMERIC, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS nearest-supplier search + BodaGoera delivery installed' AS status;
