-- TEST FIXTURE. Not a migration: never run this against a real database.
--
-- customer_self_checkout EXACTLY as it was deployed in the live project when the first version of
-- 20261107100000_sale_platform_fees.sql refused it (read with pg_get_functiondef on 2026-10-22), Windows line endings
-- (CRLF) included. It is OLDER than backend/FIX_CUSTOMER_SELF_CHECKOUT_TAX_INCLUSIVE.sql: no v_currency / v_price_per_ican (it
-- writes 'UGX' and 5000 literally) and tax is ADDED on top of the shelf price. It already has the later in-place patches
-- (store_name, supermarket_id, shop points). run.sh runs the whole suite against this shape as well as the repo's own copy.
--
-- Note: this fixture only documents what is deployed. It does NOT fix the tax-on-top pricing - that is a separate change.
CREATE OR REPLACE FUNCTION public.customer_self_checkout(p_cart jsonb, p_payment_method text, p_pay_with_ican boolean DEFAULT false, p_store_location text DEFAULT 'Kampala Main Branch'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_auth_id      UUID    := auth.uid();
  v_tx_id        UUID;
  v_receipt_id   UUID;
  v_tx_record_id TEXT;
  v_receipt_no   TEXT;
  v_subtotal     DECIMAL := 0;
  v_tax_total    DECIMAL := 0;
  v_net_total    DECIMAL := 0;
  v_items_count  INTEGER := 0;
  v_item         JSONB;
  v_product      RECORD;
  v_qty          DECIMAL;
  v_unit_price   DECIMAL;
  v_tax_rate     DECIMAL;
  v_tax_amount   DECIMAL;
  v_line_total   DECIMAL;
  v_ican_result  JSONB;
  v_snapshot     JSONB   := '[]'::JSONB;
  v_cust_name    TEXT;
  v_cust_phone   TEXT;
  v_supermarket_id UUID;
  v_store_owner_id UUID;
  v_merchant_name  TEXT;
  v_platform_fee_pct    DECIMAL;
  v_store_ican          DECIMAL;
  v_customer_charge_ican DECIMAL;
  v_platform_fee_ican   DECIMAL;
  v_customer_balance    DECIMAL;
BEGIN
  IF v_auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF jsonb_array_length(p_cart) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cart is empty');
  END IF;
  IF p_payment_method NOT IN ('cash','card','mobile_money','ican') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid payment_method');
  END IF;

  -- Ensure customer exists in dce users table
  PERFORM ensure_dce_customer_profile(v_auth_id);

  -- Fetch customer display info
  SELECT full_name, phone INTO v_cust_name, v_cust_phone
  FROM public.users WHERE id = v_auth_id LIMIT 1;

  -- Unique receipt IDs (matching transactionService.js format)
  v_tx_record_id := 'SCO_' || extract(epoch from now())::BIGINT::TEXT
                    || '_' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
  v_receipt_no   := 'RCP-' || to_char(now(), 'YYYYMMDD') || '-'
                    || upper(substr(md5(gen_random_uuid()::text), 1, 8));

  -- ── Process each cart line ────────────────────────────────────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart) LOOP

    v_qty := (v_item->>'quantity')::DECIMAL;

    -- Always use DB price
    SELECT
      p.selling_price AS selling_price,
      p.tax_rate AS tax_rate,
      p.supermarket_id AS supermarket_id,
      p.name AS product_name,
      p.sku AS product_sku
    INTO   v_product
    FROM   public.products p
    WHERE  p.id = (v_item->>'product_id')::UUID
      AND  (p.is_active IS NULL OR p.is_active = TRUE);

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found or inactive', v_item->>'product_id';
    END IF;

    IF v_product.tax_rate IS NULL THEN
      RAISE EXCEPTION 'Product % has no tax rate configured', v_item->>'product_id';
    END IF;

    -- A self-checkout cart must belong to one store. This also identifies the
    -- wallet that receives an ICAN payment made by a customer or BodaGoera.
    IF v_supermarket_id IS NULL THEN
      v_supermarket_id := v_product.supermarket_id;
    ELSIF v_supermarket_id IS DISTINCT FROM v_product.supermarket_id THEN
      RAISE EXCEPTION 'All checkout items must belong to the same supermarket';
    END IF;

    v_unit_price := v_product.selling_price;
    v_tax_rate   := v_product.tax_rate;
    v_tax_amount := ROUND(v_unit_price * v_qty * (v_tax_rate / 100), 2);
    v_line_total := ROUND(v_unit_price * v_qty + v_tax_amount, 2);

    -- Stock check
    IF NOT EXISTS (
      SELECT 1 FROM public.inventory inv
      WHERE inv.product_id = (v_item->>'product_id')::UUID
        AND inv.supermarket_id = v_supermarket_id
        AND GREATEST(inv.current_stock - COALESCE(inv.reserved_stock, 0), 0) >= v_qty
      FOR UPDATE
    ) THEN
      RAISE EXCEPTION 'Insufficient stock for product %', v_item->>'product_id';
    END IF;

    -- Deduct stock
    UPDATE public.inventory
    SET current_stock = current_stock - v_qty,
        updated_at    = now()
    WHERE product_id = (v_item->>'product_id')::UUID
      AND supermarket_id = v_supermarket_id;

    v_subtotal    := v_subtotal    + (v_unit_price * v_qty);
    v_tax_total   := v_tax_total   + v_tax_amount;
    v_net_total   := v_net_total   + v_line_total;
    v_items_count := v_items_count + 1;

    v_snapshot := v_snapshot || jsonb_build_object(
      'product_id', v_item->>'product_id',
      'product_name', v_product.product_name,
      'product_sku', v_product.product_sku,
      'quantity',   v_qty,
      'unit_price', v_unit_price,
      'tax_rate',   v_tax_rate,
      'line_total', v_line_total
    );
  END LOOP;

  IF p_pay_with_ican THEN
    SELECT owner_user_id, COALESCE(NULLIF(name, ''), NULLIF(location, ''), p_store_location)
    INTO v_store_owner_id, v_merchant_name
    FROM public.supermarkets
    WHERE id = v_supermarket_id;

    IF v_store_owner_id IS NULL THEN
      RAISE EXCEPTION 'The selected supermarket has no payment wallet';
    END IF;

    -- Same rate rides use, one shared developer-configurable knob.
    v_platform_fee_pct := public.mbg_get_setting_numeric('commission.icanera_platform_fee_percentage', 8);

    -- Store is unaffected — full order total, unchanged mechanism.
    -- ICANera's cut is a SEPARATE surcharge on top, not carved out of what
    -- the store receives.
    v_store_ican           := GREATEST(ROUND(v_net_total / 5000, 8), 0.00000001);
    v_customer_charge_ican := ROUND(v_store_ican * (1 + v_platform_fee_pct / 100), 8);
    v_platform_fee_ican    := v_customer_charge_ican - v_store_ican;

    -- Store's full share — unchanged transfer_ican() call, unchanged amount.
    SELECT transfer_ican(
      v_auth_id,
      v_store_owner_id,
      v_store_ican,
      format('Supermarket self-checkout | receipt %s', v_receipt_no),
      'digital-city-era',
      v_tx_record_id,
      v_net_total,
      'UGX',
      COALESCE(v_merchant_name, 'Supermarket'),
      'business',
      'business_expense'
    ) INTO v_ican_result;

    IF NOT COALESCE((v_ican_result ->> 'success')::BOOLEAN, FALSE) THEN
      RAISE EXCEPTION 'ICAN payment failed: %', COALESCE(v_ican_result ->> 'error', 'insufficient balance');
    END IF;

    -- ICANera's cut — a second, explicit debit from the same customer
    -- wallet, on top of the order total (not itemized to them; they only
    -- ever see the one total leaving their account), credited for real to
    -- the platform-fee business wallet via fn_credit_platform_fee_to_business,
    -- same mechanism every other platform fee already uses.
    IF v_platform_fee_ican > 0 THEN
      SELECT ican_balance INTO v_customer_balance
      FROM public.ican_user_wallets WHERE user_id = v_auth_id FOR UPDATE;

      IF COALESCE(v_customer_balance, 0) < v_platform_fee_ican THEN
        RAISE EXCEPTION 'ICAN payment failed: insufficient balance for platform fee';
      END IF;

      UPDATE public.ican_user_wallets
      SET ican_balance = ican_balance - v_platform_fee_ican,
          total_spent  = COALESCE(total_spent, 0) + v_platform_fee_ican
      WHERE user_id = v_auth_id;

      INSERT INTO public.ican_coin_transactions
        (sender_user_id, ican_amount, type, transaction_type, status, local_amount, local_currency,
         merchant_name, counterparty_type, expense_classification, source_app, reference_id, note)
      VALUES
        (v_auth_id, v_platform_fee_ican, 'transfer_out', 'transfer_out', 'completed',
         ROUND(v_platform_fee_ican * 5000, 2), 'UGX', 'ICANera platform fee', 'business',
         'business_expense', 'digital-city-era', v_tx_record_id || '_FEE',
         format('ICANera platform fee on supermarket order | receipt %s', v_receipt_no));

      PERFORM public.fn_credit_platform_fee_to_business(
        p_amount_ican      => v_platform_fee_ican,
        p_source_app       => 'digital-city-era',
        p_source_reference => 'checkout-platform-fee:' || v_tx_record_id,
        p_fee_type         => 'supermarket_order_fee',
        p_actor_user_id    => v_auth_id,
        p_note             => format('ICANera platform fee on supermarket order (receipt %s)', v_receipt_no)
      );
    END IF;
  END IF;

  -- ── Insert transaction (matches transactionService.js columns exactly) ────
  INSERT INTO public.transactions (
    transaction_id,    receipt_number,
    cashier_id,        cashier_name,
    register_number,   store_location,
    subtotal,          tax_amount,      tax_rate,
    total_amount,      payment_method,
    customer_name,     customer_phone,
    customer_user_id,
    items_count,       items,
    status,            created_at
  ) VALUES (
    v_tx_record_id,    v_receipt_no,
    v_auth_id,         COALESCE(v_cust_name, 'Self-Checkout Customer'),
    'SELF-CHECKOUT',   p_store_location,
     v_subtotal,        v_tax_total,
     CASE WHEN v_subtotal > 0
       THEN ROUND((v_tax_total / v_subtotal) * 100, 2)
       ELSE NULL
     END,
    v_net_total,       p_payment_method,
    COALESCE(v_cust_name, 'Self-Checkout Customer'),
    v_cust_phone,
    v_auth_id,
    v_items_count,     v_snapshot,
    'completed',       now()
  )
  RETURNING id INTO v_tx_id;

  -- Attach the store AFTER the insert (not in it): the revenue-ledger trigger
  -- only runs on INSERT, so this cannot double-count an ICAN-paid sale.
  UPDATE public.transactions SET supermarket_id = v_supermarket_id WHERE id = v_tx_id;

  -- ── Insert line items (matches sales_transaction_items columns) ───────────
  INSERT INTO public.sales_transaction_items (
    transaction_id, product_id, product_name, product_sku,
    product_barcode, unit_price, quantity, line_total,
    tax_included, tax_amount
  )
  SELECT
    v_tx_id,
    (item->>'product_id')::UUID,
    p.name,
    p.sku,
    p.barcode,
    (item->>'unit_price')::DECIMAL,
    (item->>'quantity')::DECIMAL,
    (item->>'line_total')::DECIMAL,
    TRUE,
    (item->>'tax_rate')::DECIMAL / 100 *
      (item->>'unit_price')::DECIMAL * (item->>'quantity')::DECIMAL
  FROM jsonb_array_elements(v_snapshot) item
  JOIN public.products p ON p.id = (item->>'product_id')::UUID;

  -- Store the completed receipt for both customer and cashier receipt views.
  -- In self-checkout the authenticated user is both identities.
  INSERT INTO public.receipts (
    receipt_number, transaction_id,
    cashier_id, cashier_name,
    customer_name,
    subtotal, tax_amount, total_amount, amount_paid,
    payment_method, items_json,
    status, register_id, store_location, created_at
  ) VALUES (
    v_receipt_no, v_tx_record_id,
    v_auth_id, COALESCE(v_cust_name, 'Self-Checkout Customer'),
    COALESCE(v_cust_name, 'Self-Checkout Customer'),
    v_subtotal, v_tax_total, v_net_total, v_net_total,
    p_payment_method, v_snapshot,
    'completed', 'SELF-CHECKOUT', p_store_location, now()
  )
  RETURNING id INTO v_receipt_id;

  UPDATE public.receipts r
     SET supermarket_id = v_supermarket_id,
         store_name     = (SELECT s.name FROM public.supermarkets s WHERE s.id = v_supermarket_id)
   WHERE r.id = v_receipt_id;

  -- ── ICAN cashback (1%, swallowed on failure) ──────────────────────────────
  -- Shop points (replaces the old ICAN cashback). Silent: the customer sees
  -- nothing; the developer monitors them via dev_get_shop_points().
  BEGIN
    PERFORM public.dce_award_shop_points(
      v_auth_id, v_net_total, v_receipt_no, v_supermarket_id, v_tx_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'dce_award_shop_points failed for receipt %: %', v_receipt_no, SQLERRM;
  END;

  RETURN jsonb_build_object(
    'success',          true,
    'transaction_id',   v_tx_id,
    'receipt_id',       v_receipt_id,
    'receipt_number',   v_receipt_no,
    'subtotal_ugx',     v_subtotal,
    'tax_ugx',          v_tax_total,
    'total_ugx',        v_net_total,
    'items_count',      v_items_count,
    'items',             v_snapshot,
    'payment_method',   p_payment_method
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$function$;
