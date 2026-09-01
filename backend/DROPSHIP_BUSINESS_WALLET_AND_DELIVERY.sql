-- =============================================================================
-- DROPSHIP_BUSINESS_WALLET_AND_DELIVERY.sql
-- Run after DROPSHIP_RESELLER_SYSTEM.sql.
--
-- Two changes to the dropship reseller system:
--
-- 1. RESELLER PAYOUT NOW GOES TO THEIR REAL PICHIN BUSINESS WALLET
--    Previously dropship_checkout() paid the reseller's margin into their
--    PERSONAL ican_user_wallets balance via transfer_ican(). A "Dropshipping"
--    business is a business_profiles account like any other on this
--    platform, so its income should land in its own public.ican_business_wallets
--    row (the same wallet Pichin, CMMS and every other business module use) —
--    visible on the wallet's "Business Accounts" tab, poolable with the
--    business's other income. We still route the customer's ICAN debit
--    through transfer_ican() (the proven debit/lock/balance-check path),
--    then sweep the identical amount from the reseller's personal wallet
--    into their business wallet via public.ican_settle_business_wallet_income()
--    — the same trusted-settlement entrypoint POS sales and investments use
--    to credit a business wallet. Net effect for the reseller's personal
--    wallet is zero; their business wallet gets the real credit.
--
-- 2. OPTIONAL PER-LISTING FREE DELIVERY + A TRACKED DELIVERY FEE
--    A reseller can mark a listing free_delivery = true. Otherwise the
--    customer pays a delivery fee at checkout (set by the frontend/rider
--    quote), tracked as its own line on the order and paid to the STORE
--    (the only real, known wallet at checkout time) with its own note, so
--    it is never silently folded into product revenue. NOTE: this repo has
--    no live BodaGoera ride-booking API for one-off consumer deliveries —
--    the closest thing (mbg_corporate_ride_requests) requires a pre-existing
--    corporate transport CONTRACT and isn't a fit for a random customer
--    order. dropship_orders.transport_status / bodago_delivery_request_id
--    are left as the same "not_requested" placeholder contract already used
--    by supplier_marketplace_orders elsewhere in this codebase, ready for
--    whichever process actually books riders to fill in later. Until then,
--    the store collects the delivery fee at pickup and settles with the
--    rider directly — the same as any other delivery pickup today.
-- =============================================================================

SET check_function_bodies = off;

-- -----------------------------------------------------------------------------
-- SECTION 1 — NEW COLUMNS
-- -----------------------------------------------------------------------------

ALTER TABLE public.dropship_listings
  ADD COLUMN IF NOT EXISTS free_delivery BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.dropship_orders
  ADD COLUMN IF NOT EXISTS delivery_fee_amount NUMERIC NOT NULL DEFAULT 0;

-- -----------------------------------------------------------------------------
-- SECTION 2 — dropship_set_listing: add p_free_delivery
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.dropship_set_listing(UUID, UUID, NUMERIC, BOOLEAN);

CREATE OR REPLACE FUNCTION public.dropship_set_listing(
  p_reseller_business_profile_id UUID,
  p_product_id  UUID,
  p_listed_price NUMERIC,
  p_is_active    BOOLEAN DEFAULT TRUE,
  p_free_delivery BOOLEAN DEFAULT FALSE
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

  INSERT INTO public.dropship_listings (reseller_business_profile_id, product_id, supermarket_id, listed_price, is_active, free_delivery)
  VALUES (p_reseller_business_profile_id, p_product_id, v_product.supermarket_id, p_listed_price, p_is_active, COALESCE(p_free_delivery, FALSE))
  ON CONFLICT (reseller_business_profile_id, product_id) DO UPDATE
    SET listed_price = EXCLUDED.listed_price,
        is_active     = EXCLUDED.is_active,
        free_delivery = EXCLUDED.free_delivery,
        updated_at    = now()
  RETURNING id INTO v_listing_id;

  RETURN jsonb_build_object('success', true, 'listing_id', v_listing_id);
END;
$$;

REVOKE ALL ON FUNCTION public.dropship_set_listing(UUID, UUID, NUMERIC, BOOLEAN, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dropship_set_listing(UUID, UUID, NUMERIC, BOOLEAN, BOOLEAN) TO authenticated;

-- -----------------------------------------------------------------------------
-- SECTION 3 — browse/storefront RPCs: expose free_delivery
-- -----------------------------------------------------------------------------

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
  free_delivery    BOOLEAN
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
    COALESCE(dl.free_delivery, FALSE)
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
  free_delivery    BOOLEAN
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    dl.id, p.id, p.name::TEXT, p.sku::TEXT, p.images, p.brand::TEXT,
    dl.listed_price,
    GREATEST(COALESCE(inv.current_stock - inv.reserved_stock, 0), 0) AS available_stock,
    GREATEST(COALESCE(inv.current_stock - inv.reserved_stock, 0), 0) > 0 AS in_stock,
    bp.business_name::TEXT,
    dl.free_delivery
  FROM public.dropship_listings dl
  JOIN public.products p ON p.id = dl.product_id
  JOIN public.business_profiles bp ON bp.id = dl.reseller_business_profile_id
  LEFT JOIN public.inventory inv ON inv.product_id = p.id AND inv.supermarket_id = dl.supermarket_id
  WHERE dl.reseller_business_profile_id = p_reseller_business_profile_id
    AND dl.is_active = TRUE
    AND (p.is_active IS NULL OR p.is_active = TRUE)
    AND p.is_dropship_excluded = FALSE
  ORDER BY p.name;
$$;

REVOKE ALL ON FUNCTION public.get_dropship_storefront(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dropship_storefront(UUID) TO authenticated, anon;

-- -----------------------------------------------------------------------------
-- SECTION 4 — dropship_checkout: business-wallet payout + delivery fee
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.dropship_checkout(UUID, JSONB, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.dropship_checkout(
  p_reseller_business_profile_id UUID,
  p_cart              JSONB,
  p_customer_name     TEXT DEFAULT NULL,
  p_customer_phone    TEXT DEFAULT NULL,
  p_delivery_address  TEXT DEFAULT NULL,
  p_store_location    TEXT DEFAULT NULL,
  p_delivery_fee      NUMERIC DEFAULT 0
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
  v_reseller_owner_id UUID;
  v_reseller_name     TEXT;
  v_cust_name         TEXT;
  v_cust_phone        TEXT;
  v_pay_store  JSONB;
  v_pay_delivery JSONB;
  v_pay_reseller JSONB;
  v_dropship_order_id UUID;
  v_delivery_fee NUMERIC := GREATEST(COALESCE(p_delivery_fee, 0), 0);
  v_all_free_delivery BOOLEAN := TRUE;
  v_margin_ican_amount NUMERIC;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sign in with your ICANera wallet to check out');
  END IF;
  IF p_cart IS NULL OR jsonb_array_length(p_cart) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cart is empty');
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

    -- Live re-check: listing must still be active, product still eligible,
    -- and the reseller's price must still be at or above the store's price.
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

    -- Stock check + deduct (single source of truth, same as customer_self_checkout)
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

  -- Every item in the cart offers free delivery — the customer owes nothing
  -- for delivery regardless of what the frontend quoted.
  IF v_all_free_delivery THEN
    v_delivery_fee := 0;
  END IF;
  v_customer_total := v_customer_total + v_delivery_fee;

  SELECT owner_user_id, COALESCE(NULLIF(name, ''), NULLIF(location, ''), 'Store')
    INTO v_store_owner_id, v_store_name
    FROM public.supermarkets WHERE id = v_supermarket_id;
  IF v_store_owner_id IS NULL THEN
    RAISE EXCEPTION 'The source store has no payment wallet configured';
  END IF;

  -- ── Pay the store its real wholesale amount + tax ──────────────────────────
  SELECT public.transfer_ican(
    v_auth_id, v_store_owner_id,
    GREATEST(ROUND((v_wholesale_subtotal + v_tax_total) / 5000, 8), 0.00000001),
    format('Dropship sale via %s | receipt %s', COALESCE(v_reseller_name, 'reseller'), v_store_receipt_no),
    'digital-city-era', v_tx_record_id || '_STORE',
    v_wholesale_subtotal + v_tax_total, 'UGX', v_store_name, 'business', 'business_expense',
    NULL
  ) INTO v_pay_store;
  IF NOT COALESCE((v_pay_store ->> 'success')::BOOLEAN, FALSE) THEN
    RAISE EXCEPTION 'Payment to store failed: %', COALESCE(v_pay_store ->> 'error', 'unknown error');
  END IF;

  -- ── Delivery fee (if any): paid to the store, kept as its own labeled leg
  -- so it is never mistaken for product revenue. The store settles with the
  -- BodaGoera rider directly at pickup — there is no live rider-booking API
  -- in this codebase yet to pay a rider automatically.
  IF v_delivery_fee > 0 THEN
    SELECT public.transfer_ican(
      v_auth_id, v_store_owner_id,
      GREATEST(ROUND(v_delivery_fee / 5000, 8), 0.00000001),
      format('Dropship delivery fee — pass to BodaGoera rider on pickup | receipt %s', v_store_receipt_no),
      'digital-city-era', v_tx_record_id || '_DELIVERY',
      v_delivery_fee, 'UGX', v_store_name, 'business', 'business_expense',
      NULL
    ) INTO v_pay_delivery;
    IF NOT COALESCE((v_pay_delivery ->> 'success')::BOOLEAN, FALSE) THEN
      RAISE EXCEPTION 'Payment of delivery fee failed: %', COALESCE(v_pay_delivery ->> 'error', 'unknown error');
    END IF;
  END IF;

  -- ── Pay the reseller their markup, tax-free — straight into their real
  -- Pichin business wallet, not their personal one.
  IF v_margin_total > 0 THEN
    v_margin_ican_amount := GREATEST(ROUND(v_margin_total / 5000, 8), 0.00000001);

    SELECT public.transfer_ican(
      v_auth_id, v_reseller_owner_id,
      v_margin_ican_amount,
      format('Dropship commission | %s | receipt %s', COALESCE(v_store_name, 'store'), v_customer_receipt_no),
      'digital-city-era', v_tx_record_id || '_RESELLER',
      v_margin_total, 'UGX', v_reseller_name, 'business', 'income',
      p_reseller_business_profile_id
    ) INTO v_pay_reseller;
    IF NOT COALESCE((v_pay_reseller ->> 'success')::BOOLEAN, FALSE) THEN
      RAISE EXCEPTION 'Payment of reseller commission failed: %', COALESCE(v_pay_reseller ->> 'error', 'unknown error');
    END IF;

    -- Sweep the same amount out of the reseller's personal wallet and into
    -- their business wallet — net zero on the personal side, real credit on
    -- the business side. Same trusted-settlement entrypoint used for POS
    -- sales and investment deposits.
    UPDATE public.ican_user_wallets
       SET ican_balance = ican_balance - v_margin_ican_amount,
           total_spent = total_spent + v_margin_ican_amount
     WHERE user_id = v_reseller_owner_id;

    PERFORM public.ican_settle_business_wallet_income(
      p_reseller_business_profile_id,
      v_margin_ican_amount,
      'digital-city-era',
      v_tx_record_id || '_RESELLER_BIZ',
      'pos_sale',
      format('Dropship commission | %s | receipt %s', COALESCE(v_store_name, 'store'), v_customer_receipt_no),
      jsonb_build_object('dropship_order_transaction_id', v_tx_record_id, 'store', v_store_name)
    );
  END IF;

  -- ── One transaction record for the sale ─────────────────────────────────────
  INSERT INTO public.transactions (
    transaction_id, receipt_number, cashier_id, cashier_name,
    register_number, store_location, subtotal, tax_amount, tax_rate,
    total_amount, payment_method, customer_name, customer_phone,
    customer_user_id, items_count, items, status, created_at
  ) VALUES (
    v_tx_record_id, v_customer_receipt_no, v_auth_id, COALESCE(v_cust_name, 'Dropship Customer'),
    'DROPSHIP', COALESCE(p_store_location, v_reseller_name, 'Dropship'),
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

  -- ── Customer-facing receipt: reseller-branded, price the customer paid ─────
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

  -- ── Store-facing receipt: the store's real revenue on this sale ────────────
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

  INSERT INTO public.dropship_orders (
    transaction_id, reseller_business_profile_id, supermarket_id,
    wholesale_amount, reseller_margin_amount, customer_paid_amount,
    customer_receipt_number, store_receipt_number,
    pickup_address, delivery_address, delivery_fee_amount, status
  ) VALUES (
    v_tx_record_id, p_reseller_business_profile_id, v_supermarket_id,
    v_wholesale_subtotal + v_tax_total, v_margin_total, v_customer_total,
    v_customer_receipt_no, v_store_receipt_no,
    v_store_name, p_delivery_address, v_delivery_fee, 'completed'
  ) RETURNING id INTO v_dropship_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'dropship_order_id', v_dropship_order_id,
    'transaction_id', v_tx_id,
    'customer_receipt_number', v_customer_receipt_no,
    'store_receipt_number', v_store_receipt_no,
    'customer_paid_total', v_customer_total,
    'store_wholesale_total', v_wholesale_subtotal + v_tax_total,
    'reseller_margin_total', v_margin_total,
    'delivery_fee', v_delivery_fee,
    'items_count', v_items_count,
    'delivery_address', p_delivery_address,
    'transport_provider', 'bodagoera'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dropship_checkout(UUID, JSONB, TEXT, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dropship_checkout(UUID, JSONB, TEXT, TEXT, TEXT, TEXT, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- VERIFY
-- -----------------------------------------------------------------------------
SELECT 'dropship business wallet + delivery fee patch installed' AS status, now() AS run_at;
