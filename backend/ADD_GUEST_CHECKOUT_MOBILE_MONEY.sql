-- ============================================================================
-- GUEST CHECKOUT — pay a dropship / business-website order with Mobile Money,
-- card or bank, WITHOUT an IcanEra wallet.
-- ============================================================================
-- Until now the public storefront (/store/<id>) and the business website's
-- Products & Services tab (/notices/<id>) both called dropship_checkout(),
-- which debits the signed-in customer's ICAN wallet. A visitor with no wallet
-- had to sign up first.
--
-- This adds a second way to pay that reuses dropship_checkout() unchanged, so
-- stock, the store/reseller/rider settlement legs, the escrow, the rider
-- booking and the QR delivery receipt behave exactly as they do for a wallet
-- customer:
--
--   1. guest_checkout_start()  (anon)  prices the order server-side (same
--      maths as dropship_checkout, including the real BodaGoera fare for the
--      rider who will be assigned), adds the payment-processing fee, and
--      stores a pending order carrying a unique tx_ref. dry_run=true only
--      returns the quote.
--   2. The browser opens Flutterwave inline checkout for charge_ugx
--      (Mobile Money / card / bank — see flutterwaveClient.js).
--   3. The Edge Function guest-checkout-pay verifies the payment with
--      Flutterwave, then calls guest_checkout_fulfil() (service_role only),
--      which funds a designated "guest payer" wallet with exactly the order
--      total and runs dropship_checkout() as that account. If anything fails
--      the whole step rolls back and the function refunds the payment.
--
-- WALLET IS STILL THE RECOMMENDED WAY: a wallet customer pays only the order
-- total. A guest pays the order total PLUS the payment-processing fee that
-- covers Flutterwave's own charge — the storefronts show both options and
-- recommend the wallet for that reason.
--
-- SETUP: run this file, then deploy the Edge Function
--   supabase functions deploy guest-checkout-pay
-- (needs the FLUTTERWAVE_SECRET_KEY secret the other Flutterwave functions
-- already use). No account has to be created by hand: the first guest order
-- makes the internal "Guest Checkout" payer account itself (see the Edge
-- Function) and remembers it in guest_checkout_config as payer_user_id. Its
-- wallet only ever holds the few seconds' worth of ICAN minted for an order,
-- then spends it. Optional — change the processing fee (default 3.5 %):
--   UPDATE public.guest_checkout_config SET value = '3' WHERE key = 'gateway_fee_pct';
--
-- Known limitation: delivery refunds (icanera_request_delivery_refund) require
-- the customer to be signed in, so a guest whose rider misses the window must
-- ask the store / support to refund them — there is no self-serve button.
--
-- Run after: ADD_DROPSHIP_SMART_TRANSPORT.sql, ADD_DELIVERY_RECEIPT_VERIFICATION.sql.
-- Safe to run more than once.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Config + pending-order tables (service-side only: RLS on, no policies)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.guest_checkout_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  note  TEXT
);
ALTER TABLE public.guest_checkout_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guest_checkout_config FROM PUBLIC, anon, authenticated;

INSERT INTO public.guest_checkout_config (key, value, note) VALUES
  ('gateway_fee_pct', '3.5', 'Payment-processing fee (percent of the order total) a guest pays on top, covering Flutterwave''s charge. Wallet customers pay none.')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.guest_checkout_orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_ref             TEXT NOT NULL UNIQUE,
  reseller_business_profile_id UUID NOT NULL,
  cart               JSONB NOT NULL,
  customer_name      TEXT NOT NULL,
  customer_phone     TEXT NOT NULL,
  delivery_address   TEXT,
  delivery_lat       NUMERIC NOT NULL,
  delivery_lng       NUMERIC NOT NULL,
  max_delivery_hours NUMERIC NOT NULL,
  rider_id           UUID NOT NULL,
  vehicle_types      TEXT[],
  items_ugx          NUMERIC NOT NULL,
  delivery_fee_ugx   NUMERIC NOT NULL,
  order_total_ugx    NUMERIC NOT NULL,
  processing_fee_ugx NUMERIC NOT NULL,
  charge_ugx         NUMERIC NOT NULL,
  status             TEXT NOT NULL DEFAULT 'awaiting_payment'
                     CHECK (status IN ('awaiting_payment', 'fulfilled', 'failed', 'refunded')),
  flw_transaction_id TEXT,
  paid_ugx           NUMERIC,
  result             JSONB,
  error              TEXT,
  refund_note        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guest_checkout_orders_status_idx ON public.guest_checkout_orders(status, created_at DESC);
ALTER TABLE public.guest_checkout_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guest_checkout_orders FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1b. Store's own riders first, then any other available rider.
--     A rider "belongs" to a store when mbg_riders.business_profile_id equals
--     the store's business profile (supermarkets.pichin_business_profile_id) —
--     the same link ADD_ADMIN_VERIFIED_STORE_DRIVERS.sql creates. A store
--     rider only gets priority while they're actually near the store
--     (setting delivery.store_rider_max_km, default 15 km); a rider with no
--     known location, or too far away, is ranked with everyone else by
--     distance. Riders already holding an unanswered offer are skipped, as
--     dropship_checkout does when it auto-assigns.
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.dropship_ranked_riders(UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT[], INT);

CREATE OR REPLACE FUNCTION public.dropship_ranked_riders(
  p_store_business_profile_id UUID,
  p_pickup_lat  NUMERIC, p_pickup_lng  NUMERIC,
  p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC,
  p_vehicle_types TEXT[] DEFAULT NULL,
  p_limit INT DEFAULT 8
) RETURNS TABLE (
  rider_id UUID, full_name TEXT, rating NUMERIC, vehicle_type TEXT,
  distance_to_pickup_km NUMERIC, estimated_arrival_min INTEGER, fare NUMERIC,
  is_store_rider BOOLEAN
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (SELECT public.mbg_get_setting_numeric('delivery.store_rider_max_km', 15) AS max_km),
  cand AS (
    SELECT f.rider_id, f.full_name, f.rating, f.vehicle_type, f.distance_to_pickup_km,
           f.estimated_arrival_min, f.fare,
           (r.business_profile_id IS NOT NULL
            AND r.business_profile_id = p_store_business_profile_id) AS is_store_rider
    FROM public.mbg_find_available_riders(
           p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng,
           NULL, NULL, false, ARRAY[]::UUID[], 60, p_vehicle_types) f
    JOIN public.mbg_riders r ON r.id = f.rider_id
    WHERE NOT EXISTS (SELECT 1 FROM public.mbg_rides x WHERE x.rider_id = f.rider_id AND x.status = 'pending')
  )
  SELECT c.rider_id, c.full_name, c.rating, c.vehicle_type, c.distance_to_pickup_km,
         c.estimated_arrival_min, c.fare, c.is_store_rider
  FROM cand c CROSS JOIN s
  ORDER BY
    CASE WHEN c.is_store_rider AND c.distance_to_pickup_km IS NOT NULL
              AND c.distance_to_pickup_km <= s.max_km THEN 0 ELSE 1 END,
    c.distance_to_pickup_km ASC NULLS LAST,
    c.rating DESC
  LIMIT GREATEST(p_limit, 1);
$$;

REVOKE ALL ON FUNCTION public.dropship_ranked_riders(UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT[], INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dropship_ranked_riders(UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT[], INT) TO service_role;

-- Rider picker for the storefronts: resolves the pickup store from the first
-- cart item (an order is single-store), then ranks as above.
DROP FUNCTION IF EXISTS public.dropship_find_delivery_riders(UUID, UUID, NUMERIC, NUMERIC, TEXT[], INT);

CREATE OR REPLACE FUNCTION public.dropship_find_delivery_riders(
  p_reseller_business_profile_id UUID,
  p_product_id UUID,
  p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC,
  p_vehicle_types TEXT[] DEFAULT NULL,
  p_limit INT DEFAULT 8
) RETURNS TABLE (
  rider_id UUID, full_name TEXT, rating NUMERIC, vehicle_type TEXT,
  distance_to_pickup_km NUMERIC, estimated_arrival_min INTEGER, fare NUMERIC,
  is_store_rider BOOLEAN
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_store_biz UUID;
  v_lat NUMERIC;
  v_lng NUMERIC;
BEGIN
  SELECT s.pichin_business_profile_id, s.latitude, s.longitude
    INTO v_store_biz, v_lat, v_lng
    FROM public.dropship_listings dl
    JOIN public.supermarkets s ON s.id = dl.supermarket_id
   WHERE dl.reseller_business_profile_id = p_reseller_business_profile_id
     AND dl.is_active = TRUE
     AND (p_product_id IS NULL OR dl.product_id = p_product_id)
   LIMIT 1;
  IF v_lat IS NULL OR v_lng IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT * FROM public.dropship_ranked_riders(
      v_store_biz, v_lat, v_lng, p_dropoff_lat, p_dropoff_lng, p_vehicle_types, p_limit);
END;
$$;

REVOKE ALL ON FUNCTION public.dropship_find_delivery_riders(UUID, UUID, NUMERIC, NUMERIC, TEXT[], INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dropship_find_delivery_riders(UUID, UUID, NUMERIC, NUMERIC, TEXT[], INT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. guest_checkout_start — server-side quote (+ pending order when not dry_run)
--    The pricing below mirrors dropship_checkout() (ADD_DROPSHIP_SMART_TRANSPORT.sql)
--    line for line; if that function's maths ever changes, change this too.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'guest_checkout_start'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.guest_checkout_start(%s)', fn.args);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.guest_checkout_start(
  p_reseller_business_profile_id UUID,
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
  v_item JSONB;
  v_listing RECORD;
  v_qty NUMERIC;
  v_tax_line NUMERIC;
  v_items_total NUMERIC := 0;
  v_margin_total NUMERIC := 0;
  v_supermarket_id UUID;
  v_all_free_delivery BOOLEAN := TRUE;
  v_min_subsidy_cap NUMERIC;
  v_subsidy_cap NUMERIC;
  v_subsidy NUMERIC;
  v_store_owner_id UUID;
  v_store_business_id UUID;
  v_store_lat NUMERIC;
  v_store_lng NUMERIC;
  v_reseller_owner_id UUID;
  v_candidate RECORD;
  v_rider_id UUID;
  v_rider_name TEXT;
  v_rider_eta INTEGER;
  v_fare NUMERIC;
  v_delivery_fee NUMERIC;
  v_order_total NUMERIC;
  v_fee_pct NUMERIC;
  v_charge NUMERIC;
  v_phone TEXT;
  v_name TEXT;
  v_min_deadline_hours NUMERIC;
  v_max_deadline_hours NUMERIC;
  v_tx_ref TEXT;
BEGIN
  v_name  := NULLIF(btrim(COALESCE(p_customer_name, '')), '');
  v_phone := regexp_replace(COALESCE(p_customer_phone, ''), '[^0-9+]', '', 'g');

  IF NOT p_dry_run THEN
    IF v_name IS NULL OR char_length(v_name) < 2 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Enter your name');
    END IF;
    IF char_length(v_phone) < 9 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Enter a valid phone number');
    END IF;
  END IF;

  IF p_cart IS NULL OR jsonb_typeof(p_cart) <> 'array' OR jsonb_array_length(p_cart) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cart is empty');
  END IF;
  IF jsonb_array_length(p_cart) > 40 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many different items in one order');
  END IF;
  IF p_delivery_lat IS NULL OR p_delivery_lng IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'A delivery location is required so a rider can be assigned');
  END IF;

  v_min_deadline_hours := public.mbg_get_setting_numeric('delivery.min_deadline_hours', 1);
  v_max_deadline_hours := public.mbg_get_setting_numeric('delivery.max_deadline_hours', 48);
  IF p_max_delivery_hours IS NULL
     OR p_max_delivery_hours < v_min_deadline_hours OR p_max_delivery_hours > v_max_deadline_hours THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('Delivery window must be between %s and %s hours', v_min_deadline_hours, v_max_deadline_hours));
  END IF;

  SELECT user_id INTO v_reseller_owner_id FROM public.business_profiles WHERE id = p_reseller_business_profile_id;
  IF v_reseller_owner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Storefront not found');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart) LOOP
    BEGIN
      v_qty := (v_item->>'quantity')::NUMERIC;
    EXCEPTION WHEN OTHERS THEN
      v_qty := NULL;
    END;
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > 1000 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Invalid quantity in your cart');
    END IF;

    SELECT dl.listed_price, dl.free_delivery, dl.max_delivery_subsidy, p.selling_price, p.tax_rate,
           p.supermarket_id, p.name AS product_name
      INTO v_listing
      FROM public.dropship_listings dl
      JOIN public.products p ON p.id = dl.product_id
     WHERE dl.reseller_business_profile_id = p_reseller_business_profile_id
       AND dl.product_id = (v_item->>'product_id')::UUID
       AND dl.is_active = TRUE
       AND (p.is_active IS NULL OR p.is_active = TRUE)
       AND p.is_dropship_excluded = FALSE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'An item in your cart is no longer available');
    END IF;
    IF v_listing.tax_rate IS NULL OR v_listing.listed_price < v_listing.selling_price THEN
      RETURN jsonb_build_object('success', false, 'error', format('"%s" can''t be ordered right now', v_listing.product_name));
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
      RETURN jsonb_build_object('success', false, 'error', 'All items in one order must come from the same store — order each store separately');
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.inventory inv
      WHERE inv.product_id = (v_item->>'product_id')::UUID
        AND inv.supermarket_id = v_supermarket_id
        AND GREATEST(inv.current_stock - COALESCE(inv.reserved_stock, 0), 0) >= v_qty
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', format('Not enough stock for "%s"', v_listing.product_name));
    END IF;

    v_tax_line     := ROUND(v_listing.listed_price * v_qty * (v_listing.tax_rate / 100), 2);
    v_items_total  := v_items_total + ROUND(v_listing.listed_price * v_qty + v_tax_line, 2);
    v_margin_total := v_margin_total + ROUND((v_listing.listed_price - v_listing.selling_price) * v_qty, 2);
  END LOOP;

  SELECT owner_user_id, pichin_business_profile_id, latitude, longitude
    INTO v_store_owner_id, v_store_business_id, v_store_lat, v_store_lng
    FROM public.supermarkets WHERE id = v_supermarket_id;
  IF v_store_owner_id IS NULL OR v_store_business_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This store can''t take orders yet');
  END IF;
  IF v_store_lat IS NULL OR v_store_lng IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This store has no pickup location yet, so a rider can''t be routed to it');
  END IF;

  -- Rider the order will be booked with: the store's own nearby rider first,
  -- otherwise the nearest available one (see dropship_ranked_riders). The same
  -- rider is locked in and passed to dropship_checkout at fulfilment, so the
  -- fare shown here is the fare charged.
  SELECT rider_id, full_name, estimated_arrival_min, fare
    INTO v_candidate
    FROM public.dropship_ranked_riders(
      v_store_business_id, v_store_lat, v_store_lng, p_delivery_lat, p_delivery_lng, p_vehicle_types, 1
    );
  IF FOUND THEN
    v_rider_id   := v_candidate.rider_id;
    v_rider_name := v_candidate.full_name;
    v_rider_eta  := v_candidate.estimated_arrival_min;
    v_fare       := v_candidate.fare;
  END IF;
  IF v_rider_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No delivery riders are available right now — try again shortly');
  END IF;

  v_subsidy_cap  := CASE WHEN v_all_free_delivery THEN v_fare ELSE COALESCE(v_min_subsidy_cap, 0) END;
  v_subsidy      := LEAST(v_subsidy_cap, v_fare, v_margin_total);
  v_delivery_fee := v_fare - v_subsidy;
  v_order_total  := v_items_total + v_delivery_fee;

  -- Processing fee the guest pays on top so the platform nets the full order
  -- total after Flutterwave's cut. Grossed up (total / (1 - rate)) and rounded
  -- up to the next 100 UGX.
  SELECT LEAST(GREATEST(COALESCE(NULLIF(value, '')::NUMERIC, 0), 0), 20) INTO v_fee_pct
    FROM public.guest_checkout_config WHERE key = 'gateway_fee_pct';
  v_fee_pct := COALESCE(v_fee_pct, 3.5);
  v_charge  := CEIL((v_order_total / (1 - v_fee_pct / 100)) / 100) * 100;

  IF NOT p_dry_run THEN
    v_tx_ref := 'GCO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20));
    INSERT INTO public.guest_checkout_orders (
      tx_ref, reseller_business_profile_id, cart, customer_name, customer_phone,
      delivery_address, delivery_lat, delivery_lng, max_delivery_hours, rider_id, vehicle_types,
      items_ugx, delivery_fee_ugx, order_total_ugx, processing_fee_ugx, charge_ugx
    ) VALUES (
      v_tx_ref, p_reseller_business_profile_id, p_cart, v_name, v_phone,
      NULLIF(btrim(COALESCE(p_delivery_address, '')), ''), p_delivery_lat, p_delivery_lng,
      p_max_delivery_hours, v_rider_id,
      CASE WHEN p_vehicle_types IS NULL OR cardinality(p_vehicle_types) = 0 THEN NULL ELSE p_vehicle_types END,
      v_items_total, v_delivery_fee, v_order_total, v_charge - v_order_total, v_charge
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'tx_ref', v_tx_ref,
    'items_ugx', v_items_total,
    'delivery_fee_ugx', v_delivery_fee,
    'real_fare_ugx', v_fare,
    'subsidy_ugx', v_subsidy,
    'order_total_ugx', v_order_total,
    'processing_fee_pct', v_fee_pct,
    'processing_fee_ugx', v_charge - v_order_total,
    'charge_ugx', v_charge,
    'rider_name', v_rider_name,
    'rider_eta_min', v_rider_eta
  );
END;
$$;

REVOKE ALL ON FUNCTION public.guest_checkout_start(UUID, JSONB, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT[], BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_checkout_start(UUID, JSONB, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT[], BOOLEAN) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. guest_checkout_fulfil — called ONLY by the guest-checkout-pay Edge
--    Function after it has verified the Flutterwave payment. Everything in the
--    inner block (coin mint + the whole dropship_checkout) commits or rolls
--    back together; on failure the order is marked 'failed' and the caller
--    refunds the guest.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guest_checkout_fulfil(
  p_tx_ref TEXT,
  p_flw_transaction_id TEXT,
  p_paid_ugx NUMERIC
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_o      public.guest_checkout_orders%ROWTYPE;
  v_payer  UUID;
  v_ican   NUMERIC;
  v_buy    JSONB;
  v_res    JSONB;
  v_err    TEXT;
  v_actual NUMERIC;
  v_diff   NUMERIC;
BEGIN
  SELECT * INTO v_o FROM public.guest_checkout_orders WHERE tx_ref = p_tx_ref FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found');
  END IF;

  IF v_o.status = 'fulfilled' THEN
    RETURN COALESCE(v_o.result, '{}'::JSONB) || jsonb_build_object('success', true, 'already_processed', true);
  END IF;
  IF v_o.status IN ('failed', 'refunded') THEN
    RETURN jsonb_build_object('success', false, 'status', v_o.status,
      'error', COALESCE(v_o.error, 'This order could not be completed'));
  END IF;
  IF p_paid_ugx IS NULL OR p_paid_ugx < v_o.charge_ugx - 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'The amount paid is less than the order total');
  END IF;

  BEGIN
    SELECT NULLIF(value, '')::UUID INTO v_payer FROM public.guest_checkout_config WHERE key = 'payer_user_id';
    IF v_payer IS NULL THEN
      RAISE EXCEPTION 'Guest checkout payer account is not configured';
    END IF;

    -- Fund the payer with exactly what dropship_checkout will spend (the
    -- order total at the 5,000 UGX/ICAN rate dropship_checkout itself uses,
    -- plus a rounding cushion of 0.000001 ICAN ≈ 0.005 UGX).
    v_ican := CEIL(v_o.order_total_ugx / 5000 * 100000000) / 100000000 + 0.000001;
    v_buy  := public.buy_ican_coins(v_payer, v_ican, 'digital-city-era', 'GUEST-' || p_tx_ref);
    IF NOT COALESCE((v_buy ->> 'success')::BOOLEAN, FALSE) THEN
      RAISE EXCEPTION '%', COALESCE(v_buy ->> 'error', 'Could not fund the guest payer wallet');
    END IF;

    -- Run the normal checkout as the payer account. auth.uid() reads these
    -- transaction-local settings; they are cleared again below.
    PERFORM set_config('request.jwt.claim.sub', v_payer::TEXT, TRUE);
    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub', v_payer::TEXT, 'role', 'authenticated')::TEXT, TRUE);

    v_res := public.dropship_checkout(
      v_o.reseller_business_profile_id, v_o.cart,
      v_o.customer_name, v_o.customer_phone, v_o.delivery_address, NULL,
      v_o.delivery_lat, v_o.delivery_lng, v_o.max_delivery_hours,
      v_o.rider_id, v_o.vehicle_types
    );

    PERFORM set_config('request.jwt.claim.sub', '', TRUE);
    PERFORM set_config('request.jwt.claims', '', TRUE);

    IF NOT COALESCE((v_res ->> 'success')::BOOLEAN, FALSE) THEN
      RAISE EXCEPTION '%', COALESCE(v_res ->> 'error', 'Checkout failed');
    END IF;

    v_actual := (v_res ->> 'customer_paid_total')::NUMERIC;
    IF v_actual > v_o.order_total_ugx + 1 THEN
      RAISE EXCEPTION 'The delivery price changed while you were paying — you have not been charged';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    UPDATE public.guest_checkout_orders
       SET status = 'failed', error = v_err, flw_transaction_id = p_flw_transaction_id,
           paid_ugx = p_paid_ugx, updated_at = now()
     WHERE id = v_o.id;
    RETURN jsonb_build_object('success', false, 'status', 'failed', 'error', v_err, 'refund_required', TRUE);
  END;

  -- Anything the final fare came in under the quote by is handed back.
  v_diff := GREATEST(v_o.order_total_ugx - v_actual, 0);

  v_res := v_res || jsonb_build_object(
    'paid_via', 'guest',
    'processing_fee', v_o.processing_fee_ugx,
    'guest_charged_total', v_o.charge_ugx - v_diff,
    'refund_difference_ugx', v_diff
  );

  UPDATE public.guest_checkout_orders
     SET status = 'fulfilled', result = v_res, flw_transaction_id = p_flw_transaction_id,
         paid_ugx = p_paid_ugx, error = NULL, updated_at = now()
   WHERE id = v_o.id;

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.guest_checkout_fulfil(TEXT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_checkout_fulfil(TEXT, TEXT, NUMERIC) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. guest_checkout_mark_refunded — Edge Function records a completed refund
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guest_checkout_mark_refunded(p_tx_ref TEXT, p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.guest_checkout_orders
     SET status = 'refunded', refund_note = p_note, updated_at = now()
   WHERE tx_ref = p_tx_ref AND status IN ('failed', 'awaiting_payment');
$$;

REVOKE ALL ON FUNCTION public.guest_checkout_mark_refunded(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_checkout_mark_refunded(TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Guest checkout installed. Last step: deploy the guest-checkout-pay Edge Function. Anyone can then pay without an IcanEra account; the internal payer account is created automatically on the first order.';
END $$;
