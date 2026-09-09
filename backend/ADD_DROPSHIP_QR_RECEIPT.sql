-- ============================================================================
-- Adapt the shared 3-party QR verification receipt (see
-- ADD_DELIVERY_RECEIPT_VERIFICATION.sql — run that first) for the
-- Dropshipper flow.
--
-- dropship_checkout() already debits the customer's ICAN wallet at
-- CHECKOUT — there's no separate "accept" step in dropshipping, checkout
-- itself is the commitment, so requirement #1 (charge before the goods
-- move) was already true here. What was missing is the same QR/verification
-- layer mybodaguy's store deliveries now get
-- (mybodaguy/backend/database/ADD_DELIVERY_ACCEPTANCE_WALLET_CHARGE_AND_QR_RECEIPT.sql).
--
-- rider_user_id is left NULL on the receipt: DROPSHIP_BUSINESS_WALLET_AND_
-- DELIVERY.sql already documents that this codebase has no live rider-
-- dispatch API for one-off dropship deliveries yet (dropship_orders.
-- transport_status stays 'not_requested'). The store can still confirm
-- pickup itself via icanera_confirm_pickup once whichever rider shows up —
-- and if live dispatch is wired up later, a small follow-up UPDATE on
-- icanera_delivery_receipts.rider_user_id is all that's needed to let that
-- rider confirm pickup too.
--
-- This is a straight CREATE OR REPLACE of dropship_checkout() from
-- DROPSHIP_BUSINESS_WALLET_AND_DELIVERY.sql (same signature) — only the
-- receipt-creation call and the two new return fields are new.
-- ============================================================================

SET check_function_bodies = off;

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
  v_store_address      TEXT;
  v_store_business_id UUID;
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

  SELECT owner_user_id, COALESCE(NULLIF(name, ''), NULLIF(location, ''), 'Store'),
         COALESCE(NULLIF(address, ''), NULLIF(location, '')), pichin_business_profile_id
    INTO v_store_owner_id, v_store_name, v_store_address, v_store_business_id
    FROM public.supermarkets WHERE id = v_supermarket_id;
  IF v_store_owner_id IS NULL THEN
    RAISE EXCEPTION 'The source store has no payment wallet configured';
  END IF;
  IF v_store_business_id IS NULL THEN
    RAISE EXCEPTION 'The source store has no business wallet configured for dropship settlement';
  END IF;

  -- ── Every leg below follows the same shape: lock + debit the customer's
  -- personal ICAN wallet directly (the proven balance-check path), record
  -- their own 'transfer_out' ledger row so it still shows in their history,
  -- then credit the payee's BUSINESS wallet straight away via the trusted
  -- 'pos_sale' settlement entrypoint (ican_settle_business_wallet_income) —
  -- full value, no 10% person-to-business tithe, matching how POS sales and
  -- investment income are already settled. No wallet is ever "opened": both
  -- sides land directly in the right business wallet in one atomic step.

  -- ── Pay the store its real wholesale amount + tax ──────────────────────────
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
     format('Dropship sale via %s | receipt %s', COALESCE(v_reseller_name, 'reseller'), v_store_receipt_no),
     v_store_business_id);

  PERFORM public.ican_settle_business_wallet_income(
    v_store_business_id, v_leg_ican_amount, 'digital-city-era', v_tx_record_id || '_STORE', 'pos_sale',
    format('Dropship sale via %s | receipt %s', COALESCE(v_reseller_name, 'reseller'), v_store_receipt_no),
    jsonb_build_object('dropship_order_transaction_id', v_tx_record_id, 'reseller', v_reseller_name)
  );

  -- ── Delivery fee (if any): paid to the store, kept as its own labeled leg
  -- so it is never mistaken for product revenue. The store settles with the
  -- BodaGoera rider directly at pickup — there is no live rider-booking API
  -- in this codebase yet to pay a rider automatically.
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
       v_delivery_fee, 'UGX', v_store_name, 'business', 'business_expense',
       'digital-city-era', v_tx_record_id || '_DELIVERY',
       format('Dropship delivery fee — pass to BodaGoera rider on pickup | receipt %s', v_store_receipt_no),
       v_store_business_id);

    PERFORM public.ican_settle_business_wallet_income(
      v_store_business_id, v_leg_ican_amount, 'digital-city-era', v_tx_record_id || '_DELIVERY', 'pos_sale',
      format('Dropship delivery fee — pass to BodaGoera rider on pickup | receipt %s', v_store_receipt_no),
      jsonb_build_object('dropship_order_transaction_id', v_tx_record_id)
    );
  END IF;

  -- ── Pay the reseller their markup, tax-free — straight into their real
  -- Pichin business wallet, not their personal one.
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
       format('Dropship commission | %s | receipt %s', COALESCE(v_store_name, 'store'), v_customer_receipt_no),
       p_reseller_business_profile_id);

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
    COALESCE(v_store_address, v_store_name), p_delivery_address, v_delivery_fee, 'completed'
  ) RETURNING id INTO v_dropship_order_id;

  -- ── 3-party QR verification receipt (customer/store/reseller), same
  -- table mybodaguy's store deliveries use. rider_user_id is left NULL —
  -- see file header: no live rider-dispatch API for dropship yet, the
  -- store confirms pickup itself once a rider actually shows up. Best-
  -- effort: a missing/older shared table must never block a real checkout
  -- that already moved real money above.
  v_customer_total_ican := GREATEST(ROUND(v_customer_total / 5000, 8), 0.00000001);
  BEGIN
    v_receipt := public.icanera_create_delivery_receipt(
      'digital-city-era', 'dropship_order', v_dropship_order_id,
      v_auth_id, v_store_owner_id, NULL,
      COALESCE(v_store_name, 'Store'),
      format('%s item(s) via %s', v_items_count, COALESCE(v_reseller_name, 'reseller')),
      v_customer_total_ican
    );
  EXCEPTION WHEN undefined_function THEN
    v_receipt := NULL;
  END;

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
    'transport_provider', 'bodagoera',
    'verification_code', v_receipt ->> 'verification_code',
    'verify_url', v_receipt ->> 'verify_url'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dropship_checkout(UUID, JSONB, TEXT, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dropship_checkout(UUID, JSONB, TEXT, TEXT, TEXT, TEXT, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- VERIFY
-- -----------------------------------------------------------------------------
SELECT 'dropship QR verification receipt installed' AS status, now() AS run_at;
