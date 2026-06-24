-- Disable compile-time table validation so functions can be created even if
-- referenced tables (transactions, categories, etc.) don't exist yet.
SET check_function_bodies = off;

-- =============================================================================
-- DCE_CUSTOMER_SELFCHECKOUT.sql
--
-- Grants mybodaguy "customer" role full self-checkout access to the
-- digital-city-era (supermarket) Supabase tables.
--
-- Actual POS tables (discovered from transactionService.js):
--   transactions            — POS receipt (cashier_id, customer_name, items JSON …)
--   sales_transaction_items — line items per transaction
--   products / inventory    — catalog + stock
--
-- Run once in the Supabase SQL Editor.  Idempotent.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- SECTION 1 — CUSTOMER PROFILE BRIDGE
-- Inserts the mbg customer into dce "users" table with id = auth.uid() so
-- that cashier_id = auth.uid() works in self-checkout RLS.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ensure_dce_customer_profile(p_user_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_users_id UUID;
  v_email    TEXT;
  v_name     TEXT;
BEGIN
  SELECT id INTO v_users_id
  FROM public.users
  WHERE id = p_user_id OR auth_id = p_user_id
  LIMIT 1;
  IF FOUND THEN RETURN v_users_id; END IF;

  SELECT au.email,
         COALESCE(au.raw_user_meta_data->>'full_name',
                  au.raw_user_meta_data->>'name',
                  au.email)
  INTO v_email, v_name
  FROM auth.users au WHERE au.id = p_user_id;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'auth.users row not found for uid %', p_user_id;
  END IF;

  SELECT COALESCE(mup.full_name, v_name)
  INTO v_name
  FROM public.mbg_user_profiles mup
  WHERE mup.user_id = p_user_id LIMIT 1;

  INSERT INTO public.users (
    id, auth_id, email, full_name,
    role, is_active, email_verified, created_at, updated_at
  ) VALUES (
    p_user_id, p_user_id, v_email, v_name,
    'customer', TRUE, TRUE, now(), now()
  )
  ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        auth_id   = EXCLUDED.auth_id,
        updated_at = now()
  RETURNING id INTO v_users_id;

  RETURN v_users_id;
END;
$$;


-- -----------------------------------------------------------------------------
-- SECTION 2 — CATALOG RLS  (products · inventory · categories)
-- All wrapped in existence checks.
-- -----------------------------------------------------------------------------

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='products') THEN
    ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "any_auth_read_products"       ON public.products;
    DROP POLICY IF EXISTS "authenticated_write_products" ON public.products;
    EXECUTE $p$ CREATE POLICY "any_auth_read_products"
      ON public.products FOR SELECT TO authenticated USING (true) $p$;
    EXECUTE $p$ CREATE POLICY "authenticated_write_products"
      ON public.products FOR ALL TO authenticated USING (true) WITH CHECK (true) $p$;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='inventory') THEN
    ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "any_auth_read_inventory"       ON public.inventory;
    DROP POLICY IF EXISTS "authenticated_write_inventory" ON public.inventory;
    EXECUTE $p$ CREATE POLICY "any_auth_read_inventory"
      ON public.inventory FOR SELECT TO authenticated USING (true) $p$;
    EXECUTE $p$ CREATE POLICY "authenticated_write_inventory"
      ON public.inventory FOR ALL TO authenticated USING (true) WITH CHECK (true) $p$;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='categories') THEN
    ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "any_auth_read_categories" ON public.categories;
    EXECUTE $p$ CREATE POLICY "any_auth_read_categories"
      ON public.categories FOR SELECT TO authenticated USING (true) $p$;
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- SECTION 3 — TRANSACTIONS  (the real POS table)
-- Add customer_user_id column so self-checkout rows are identifiable.
-- RLS: cashier reads their own rows; customer reads rows where they were
--      the "cashier" (self-checkout) or the tagged customer_user_id.
-- -----------------------------------------------------------------------------

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='transactions') THEN

    ALTER TABLE public.transactions
      ADD COLUMN IF NOT EXISTS customer_user_id UUID;

    ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "auth_read_own_transactions" ON public.transactions;
    DROP POLICY IF EXISTS "authenticated_write_tx"      ON public.transactions;

    EXECUTE $p$
      CREATE POLICY "auth_read_own_transactions" ON public.transactions
        FOR SELECT TO authenticated
        USING (cashier_id = auth.uid() OR customer_user_id = auth.uid())
    $p$;

    EXECUTE $p$
      CREATE POLICY "authenticated_write_tx" ON public.transactions
        FOR ALL TO authenticated USING (true) WITH CHECK (true)
    $p$;

  ELSE
    RAISE NOTICE 'transactions table does not exist yet — skipping RLS';
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- SECTION 4 — SALES_TRANSACTION_ITEMS  (line items)
-- -----------------------------------------------------------------------------

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='sales_transaction_items') THEN
    ALTER TABLE public.sales_transaction_items ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "auth_read_own_tx_items"    ON public.sales_transaction_items;
    DROP POLICY IF EXISTS "authenticated_write_items"  ON public.sales_transaction_items;

    -- Customer reads items that belong to their own transaction
    EXECUTE $p$
      CREATE POLICY "auth_read_own_tx_items" ON public.sales_transaction_items
        FOR SELECT TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM public.transactions t
            WHERE t.id = sales_transaction_items.transaction_id
              AND (t.cashier_id = auth.uid() OR t.customer_user_id = auth.uid())
          )
        )
    $p$;

    EXECUTE $p$
      CREATE POLICY "authenticated_write_items" ON public.sales_transaction_items
        FOR ALL TO authenticated USING (true) WITH CHECK (true)
    $p$;
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- SECTION 5 — BARCODE / SKU PRODUCT LOOKUP
-- Returns product + live stock in one call.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lookup_product_by_barcode(p_scan TEXT)
RETURNS TABLE (
  product_id      UUID,
  name            TEXT,
  sku             TEXT,
  barcode         TEXT,
  selling_price   DECIMAL,
  tax_rate        DECIMAL,
  category_name   TEXT,
  brand           TEXT,
  images          JSONB,
  current_stock   DECIMAL,
  available_stock DECIMAL,
  in_stock        BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.name::TEXT,
    p.sku::TEXT,
    p.barcode::TEXT,
    p.selling_price,
    COALESCE(p.tax_rate, 18)                                          AS tax_rate,
    c.name::TEXT                                                      AS category_name,
    p.brand::TEXT,
    p.images,
    COALESCE(inv.current_stock, 0)                                    AS current_stock,
    GREATEST(COALESCE(inv.current_stock - inv.reserved_stock, 0), 0) AS available_stock,
    GREATEST(COALESCE(inv.current_stock - inv.reserved_stock, 0), 0) > 0 AS in_stock
  FROM public.products p
  LEFT JOIN public.categories c   ON c.id = p.category_id
  LEFT JOIN public.inventory  inv ON inv.product_id = p.id
  WHERE (p.is_active IS NULL OR p.is_active = TRUE)
    AND (p.barcode = p_scan OR p.sku = p_scan OR p.id::TEXT = p_scan)
  LIMIT 1;
END;
$$;


-- -----------------------------------------------------------------------------
-- SECTION 6 — ATOMIC SELF-CHECKOUT
-- Mirrors the exact column set from transactionService.js saveTransaction().
-- SECURITY DEFINER — bypasses RLS on all INSERTs.
-- Cart format: [{ "product_id": "uuid", "quantity": 2 }, ...]
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION customer_self_checkout(
  p_cart           JSONB,
  p_payment_method TEXT,
  p_pay_with_ican  BOOLEAN DEFAULT FALSE,
  p_store_location TEXT    DEFAULT 'Kampala Main Branch'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_auth_id      UUID    := auth.uid();
  v_tx_id        UUID;
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
    SELECT p.selling_price, COALESCE(p.tax_rate, 18)
    INTO   v_product
    FROM   public.products p
    WHERE  p.id = (v_item->>'product_id')::UUID
      AND  (p.is_active IS NULL OR p.is_active = TRUE);

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found or inactive', v_item->>'product_id';
    END IF;

    v_unit_price := v_product.selling_price;
    v_tax_rate   := v_product.tax_rate;
    v_tax_amount := ROUND(v_unit_price * v_qty * (v_tax_rate / 100), 2);
    v_line_total := ROUND(v_unit_price * v_qty + v_tax_amount, 2);

    -- Stock check
    IF NOT EXISTS (
      SELECT 1 FROM public.inventory inv
      WHERE inv.product_id = (v_item->>'product_id')::UUID
        AND GREATEST(inv.current_stock - COALESCE(inv.reserved_stock, 0), 0) >= v_qty
    ) THEN
      RAISE EXCEPTION 'Insufficient stock for product %', v_item->>'product_id';
    END IF;

    -- Deduct stock
    UPDATE public.inventory
    SET current_stock = current_stock - v_qty,
        updated_at    = now()
    WHERE product_id = (v_item->>'product_id')::UUID;

    v_subtotal    := v_subtotal    + (v_unit_price * v_qty);
    v_tax_total   := v_tax_total   + v_tax_amount;
    v_net_total   := v_net_total   + v_line_total;
    v_items_count := v_items_count + 1;

    v_snapshot := v_snapshot || jsonb_build_object(
      'product_id', v_item->>'product_id',
      'quantity',   v_qty,
      'unit_price', v_unit_price,
      'tax_rate',   v_tax_rate,
      'line_total', v_line_total
    );
  END LOOP;

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
    v_subtotal,        v_tax_total,     18.00,
    v_net_total,       p_payment_method,
    COALESCE(v_cust_name, 'Self-Checkout Customer'),
    v_cust_phone,
    v_auth_id,
    v_items_count,     v_snapshot,
    'completed',       now()
  )
  RETURNING id INTO v_tx_id;

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

  -- ── ICAN cashback (1%, swallowed on failure) ──────────────────────────────
  IF p_pay_with_ican = FALSE THEN
    BEGIN
      SELECT credit_ican_earning(
        v_auth_id,
        GREATEST(ROUND(v_net_total * 0.01 / 5000, 8), 0.0001),
        'digital-city-era',
        format('Self-checkout cashback | UGX %s | receipt %s',
               v_net_total::TEXT, v_receipt_no),
        v_tx_id::TEXT
      ) INTO v_ican_result;
    EXCEPTION WHEN OTHERS THEN
      v_ican_result := jsonb_build_object('success', false, 'error', SQLERRM);
    END;
  END IF;

  RETURN jsonb_build_object(
    'success',          true,
    'transaction_id',   v_tx_id,
    'receipt_number',   v_receipt_no,
    'subtotal_ugx',     v_subtotal,
    'tax_ugx',          v_tax_total,
    'total_ugx',        v_net_total,
    'items_count',      v_items_count,
    'payment_method',   p_payment_method,
    'ican_cashback',    v_ican_result
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;


-- -----------------------------------------------------------------------------
-- SECTION 7 — CUSTOMER TRANSACTION HISTORY VIEW
-- -----------------------------------------------------------------------------

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='transactions')
  AND EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='sales_transaction_items') THEN

    EXECUTE $v$
      CREATE OR REPLACE VIEW customer_transaction_history AS
      SELECT
        t.id            AS transaction_id,
        t.receipt_number,
        t.customer_user_id,
        t.total_amount,
        t.tax_amount,
        t.subtotal,
        t.payment_method,
        t.status,
        t.store_location,
        t.created_at,
        jsonb_agg(
          jsonb_build_object(
            'product_id',   sti.product_id,
            'product_name', sti.product_name,
            'quantity',     sti.quantity,
            'unit_price',   sti.unit_price,
            'line_total',   sti.line_total
          )
          ORDER BY sti.id
        ) AS items
      FROM public.transactions t
      JOIN public.sales_transaction_items sti ON sti.transaction_id = t.id
      WHERE t.register_number = 'SELF-CHECKOUT'
      GROUP BY t.id, t.receipt_number, t.customer_user_id,
               t.total_amount, t.tax_amount, t.subtotal,
               t.payment_method, t.status, t.store_location, t.created_at
    $v$;

  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- SECTION 8 — PRODUCT SEARCH (name / category browse)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION search_products_for_customer(
  p_query    TEXT    DEFAULT '',
  p_category UUID    DEFAULT NULL,
  p_limit    INTEGER DEFAULT 40,
  p_offset   INTEGER DEFAULT 0
) RETURNS TABLE (
  product_id      UUID,
  name            TEXT,
  sku             TEXT,
  barcode         TEXT,
  selling_price   DECIMAL,
  tax_rate        DECIMAL,
  brand           TEXT,
  category_id     UUID,
  category_name   TEXT,
  images          JSONB,
  available_stock DECIMAL,
  in_stock        BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.name::TEXT,
    p.sku::TEXT,
    p.barcode::TEXT,
    p.selling_price,
    COALESCE(p.tax_rate, 18),
    p.brand::TEXT,
    p.category_id,
    c.name::TEXT AS category_name,
    p.images,
    GREATEST(COALESCE(inv.current_stock - inv.reserved_stock, 0), 0) AS available_stock,
    GREATEST(COALESCE(inv.current_stock - inv.reserved_stock, 0), 0) > 0 AS in_stock
  FROM public.products p
  LEFT JOIN public.categories c   ON c.id = p.category_id
  LEFT JOIN public.inventory  inv ON inv.product_id = p.id
  WHERE (p.is_active IS NULL OR p.is_active = TRUE)
    AND (
      p_query = ''
      OR p.name    ILIKE '%' || p_query || '%'
      OR p.sku     ILIKE '%' || p_query || '%'
      OR p.brand   ILIKE '%' || p_query || '%'
      OR p.barcode ILIKE '%' || p_query || '%'
    )
    AND (p_category IS NULL OR p.category_id = p_category)
  ORDER BY p.name
  LIMIT p_limit OFFSET p_offset;
END;
$$;


-- =============================================================================
SELECT 'DCE Customer Self-Checkout migration complete' AS status, now() AS run_at;
