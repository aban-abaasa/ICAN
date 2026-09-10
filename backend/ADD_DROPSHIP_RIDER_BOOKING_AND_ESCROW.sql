-- ============================================================================
-- Wires dropship checkout into a REAL BodaGoera rider booking, and gives it
-- the exact same seal-scan escrow, customer-chosen deadline and rider
-- liability that mybodaguy/backend/database/ADD_DELIVERY_ESCROW_DEADLINE_AND_
-- RIDER_LIABILITY.sql just added for Bodagoera store deliveries — via the
-- SAME shared icanera_delivery_receipts mechanism (settlement_legs,
-- delivery_due_at, icanera_confirm_pickup, icanera_request_delivery_refund),
-- not a parallel copy of it.
--
-- WHAT WAS TRUE UNTIL NOW (DROPSHIP_BUSINESS_WALLET_AND_DELIVERY.sql /
-- ADD_DROPSHIP_QR_RECEIPT.sql): dropship_checkout() paid the store and
-- reseller immediately at checkout, with no real rider ever assigned —
-- "the store settles with the rider directly at pickup", an IRL handshake
-- this codebase couldn't see or enforce. dropship_orders.bodago_delivery_
-- request_id existed as a placeholder, always NULL.
--
-- WHAT THIS FILE CHANGES:
--   1. Checkout now requires delivery coordinates (p_delivery_lat/lng) and a
--      chosen delivery window (p_max_delivery_hours), same bounds as
--      Bodagoera. It accepts an optional p_rider_id so the storefront can
--      let the customer actually SEE and PICK a rider/driver for the
--      delivery — the frontend calls mbg_find_available_riders(store_lat,
--      store_lng, delivery_lat, delivery_lng, ...) itself (already public,
--      already used by the ride-booking screens) to render that picker,
--      the same UX Bodagoera already gives. Leave p_rider_id NULL and it
--      auto-picks the nearest available one instead — either way it
--      creates a REAL mbg_rides row, linked back via dropship_orders.
--      bodago_delivery_request_id (a column that already existed for
--      exactly this).
--   2. That ride uses a NEW delivery_mode = 'dropship' (added to mbg_rides'
--      existing CHECK constraint) specifically so it does NOT fall into
--      mbg_respond_to_ride's delivery_mode='supermarket' goods-repricing
--      branch — dropship prices its own cart (store wholesale + reseller
--      markup), a different model than a plain store cart, so that branch
--      must never re-price or re-pay it. It falls into the ordinary
--      "accept the offer" path instead — pure rider assignment, no money.
--   3. The customer is still debited the FULL order total at checkout, same
--      as before (funds guaranteed up front) — but the store's wholesale
--      leg, the reseller's margin leg, AND the delivery fee (now paid to
--      the assigned rider's own wallet instead of "handed over at pickup")
--      are all held as unsettled settlement_legs on the shared receipt,
--      released only once the store/rider taps "Approve" on the QR receipt
--      (icanera_confirm_pickup) — the seal scan. wallet_charged_at_
--      acceptance=true on the created ride means mbg_complete_ride never
--      tries to charge for it again.
--   4. From the seal scan, the exact same overdue sweep + customer refund
--      already built for Bodagoera applies automatically — no dropship-
--      specific code needed for that part at all.
--   5. If the auto-picked rider declines, mbg_run_due_dropship_redispatch
--      (pg_cron, every 5 min) retries matching — same resilience pattern
--      ADD_PG_CRON_DISPATCH.sql already uses for cargo/purchase-order
--      delivery retries.
--
-- Run after mybodaguy/backend/database/ADD_DELIVERY_ESCROW_DEADLINE_AND_
-- RIDER_LIABILITY.sql (needs settlement_legs, icanera_confirm_pickup's
-- personal-payee support, and mbg_get_setting_numeric('delivery.*')) and
-- after mybodaguy/backend/database/CREATE_REAL_RIDE_MATCHING_ENGINE.sql
-- (needs mbg_find_available_riders, mbg_haversine_km).
-- ============================================================================

SET check_function_bodies = off;

-- ----------------------------------------------------------------------------
-- SECTION 1 — mbg_rides.delivery_mode gains a 3rd allowed value.
-- ----------------------------------------------------------------------------

ALTER TABLE public.mbg_rides DROP CONSTRAINT IF EXISTS mbg_rides_delivery_mode_check;
ALTER TABLE public.mbg_rides
  ADD CONSTRAINT mbg_rides_delivery_mode_check CHECK (delivery_mode IN ('supermarket', 'normal', 'dropship'));

-- ----------------------------------------------------------------------------
-- SECTION 2 — dropship_checkout: 3 new trailing DEFAULT NULL params
-- (p_delivery_lat, p_delivery_lng, p_max_delivery_hours), same backward-
-- compatible extension technique already used on icanera_create_delivery_
-- receipt. Enforced as functionally required inside the body (RAISE
-- EXCEPTION if missing) rather than as a hard SQL NOT NULL, so this stays a
-- plain CREATE OR REPLACE with no DROP needed.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.dropship_checkout(
  p_reseller_business_profile_id UUID,
  p_cart              JSONB,
  p_customer_name     TEXT DEFAULT NULL,
  p_customer_phone    TEXT DEFAULT NULL,
  p_delivery_address  TEXT DEFAULT NULL,
  p_store_location    TEXT DEFAULT NULL,
  p_delivery_fee      NUMERIC DEFAULT 0,
  p_delivery_lat      NUMERIC DEFAULT NULL,
  p_delivery_lng      NUMERIC DEFAULT NULL,
  p_max_delivery_hours NUMERIC DEFAULT NULL,
  p_rider_id          UUID DEFAULT NULL
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
  v_delivery_fee NUMERIC := GREATEST(COALESCE(p_delivery_fee, 0), 0);
  v_all_free_delivery BOOLEAN := TRUE;
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

    SELECT dl.listed_price, dl.free_delivery, p.selling_price, p.tax_rate, p.supermarket_id,
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

  IF v_all_free_delivery THEN
    v_delivery_fee := 0;
  END IF;
  v_customer_total := v_customer_total + v_delivery_fee;

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
  -- Nothing has been charged yet — if no rider is found, checkout fails
  -- cleanly here, before any money moves (stock was already adjusted above,
  -- same pre-existing tradeoff this function has always had for the pricing
  -- loop). ────────────────────────────────────────────────────────────────
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
        NULL, NULL, false, ARRAY[]::UUID[], 5
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

  -- ── Delivery fee: now paid to the ASSIGNED RIDER's own wallet (a
  -- 'personal' leg) instead of the store, since there's finally a real
  -- rider to pay. ──────────────────────────────────────────────────────────
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

  -- ── Reseller's markup leg ────────────────────────────────────────────────
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
    pickup_address, delivery_address, delivery_fee_amount, status,
    transport_status, bodago_delivery_request_id
  ) VALUES (
    v_tx_record_id, p_reseller_business_profile_id, v_supermarket_id,
    v_wholesale_subtotal + v_tax_total, v_margin_total, v_customer_total,
    v_customer_receipt_no, v_store_receipt_no,
    COALESCE(v_store_address, v_store_name), p_delivery_address, v_delivery_fee, 'pending_dispatch',
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

REVOKE ALL ON FUNCTION public.dropship_checkout(UUID, JSONB, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dropship_checkout(UUID, JSONB, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- SECTION 3 — retry dispatch: if the auto-picked rider declines,
-- mbg_respond_to_ride's decline branch resets rider_id to NULL but leaves
-- status='pending' — this job (every 5 min, same cadence as the existing
-- cargo-dispatch retry) finds those orphaned dropship deliveries and
-- re-matches them to a fresh nearest-available rider.
-- ----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.mbg_run_due_dropship_redispatch()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride RECORD;
  v_candidate RECORD;
  v_new_rider_id UUID;
  v_count INTEGER := 0;
BEGIN
  FOR v_ride IN
    SELECT id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng
    FROM public.mbg_rides
    WHERE delivery_mode = 'dropship' AND status = 'pending' AND rider_id IS NULL
    LIMIT 50
  LOOP
    v_new_rider_id := NULL;
    FOR v_candidate IN
      SELECT rider_id FROM public.mbg_find_available_riders(
        v_ride.pickup_lat, v_ride.pickup_lng, v_ride.dropoff_lat, v_ride.dropoff_lng,
        NULL, NULL, false, ARRAY[]::UUID[], 5
      )
    LOOP
      IF NOT EXISTS (SELECT 1 FROM public.mbg_rides WHERE rider_id = v_candidate.rider_id AND status = 'pending') THEN
        v_new_rider_id := v_candidate.rider_id;
        EXIT;
      END IF;
    END LOOP;

    IF v_new_rider_id IS NOT NULL THEN
      UPDATE public.mbg_rides SET rider_id = v_new_rider_id, updated_at = now() WHERE id = v_ride.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_run_due_dropship_redispatch TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('mbg-dropship-redispatch');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('mbg-dropship-redispatch', '*/5 * * * *', $$ SELECT public.mbg_run_due_dropship_redispatch(); $$);

-- ----------------------------------------------------------------------------
-- SECTION 4 — get_dropship_storefront: also return the store's pickup
-- coordinates, so the public storefront page can call
-- mbg_find_available_riders(store_lat, store_lng, delivery_lat, delivery_lng)
-- itself and let the customer actually see and pick a rider/driver before
-- checkout — the same UX Bodagoera's own ride-request screen already gives,
-- now on the public dropship page too. Changing a RETURNS TABLE shape needs
-- a DROP first — CREATE OR REPLACE alone won't add output columns.
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

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ dropship_checkout now books a real BodaGoera rider (customer-picked via the new p_rider_id, or auto-matched and retried every 5 min if declined) and holds the store/reseller/rider payouts in escrow until the seal scan — same overdue-warning and rider-liable-refund mechanism as Bodagoera store deliveries, via the shared icanera_delivery_receipts settlement_legs. get_dropship_storefront now also returns store_lat/store_lng so the public page can render a rider picker.';
END $$;
