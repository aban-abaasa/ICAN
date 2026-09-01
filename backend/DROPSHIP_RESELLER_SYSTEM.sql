-- =============================================================================
-- DROPSHIP_RESELLER_SYSTEM.sql
--
-- Lets any user with a business profile ("Manage Your Business" ->
-- Dropshipping) pick any active, non-excluded retail product from any
-- supermarket already on the platform, list it at their own price, and sell
-- it to a customer. The order is always fulfilled from the source store's
-- real inventory (public.inventory), the store is always paid its real
-- selling_price (+ tax), and the reseller only ever receives the markup as
-- pure profit. Payment is via the ICANera coin wallet (transfer_ican), same
-- as customer_self_checkout() in DCE_CUSTOMER_SELFCHECKOUT.sql.
--
-- No approval handshake between reseller and store is required — a store
-- opts a product OUT via products.is_dropship_excluded if it does not want
-- it resold; otherwise every active product is dropshippable by default.
--
-- Delivery rides the existing BodaGoera contract already used by
-- supplier_marketplace_orders (transport_provider / transport_status /
-- bodago_delivery_request_id / pickup_address / delivery_address) — no new
-- transport integration is built here.
--
-- Run once in the Supabase SQL Editor, after DCE_CUSTOMER_SELFCHECKOUT.sql
-- and UNIFIED_BUSINESS_MANAGEMENT_AND_SUPPLIER_MARKETPLACE.sql. Idempotent.
-- =============================================================================

SET check_function_bodies = off;

-- -----------------------------------------------------------------------------
-- SECTION 1 — STORE OPT-OUT FLAG
-- -----------------------------------------------------------------------------

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'products') THEN
    ALTER TABLE public.products
      ADD COLUMN IF NOT EXISTS is_dropship_excluded BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- SECTION 2 — DROPSHIP_LISTINGS  (a reseller's own shelf, own price)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.dropship_listings (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  product_id                UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  supermarket_id             UUID NOT NULL,
  listed_price               NUMERIC NOT NULL CHECK (listed_price >= 0),
  is_active                  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reseller_business_profile_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_dropship_listings_reseller ON public.dropship_listings(reseller_business_profile_id);
CREATE INDEX IF NOT EXISTS idx_dropship_listings_product  ON public.dropship_listings(product_id);

ALTER TABLE public.dropship_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "any_read_active_dropship_listings" ON public.dropship_listings;
CREATE POLICY "any_read_active_dropship_listings" ON public.dropship_listings
  FOR SELECT USING (is_active = TRUE OR public.unified_business_member(reseller_business_profile_id));

DROP POLICY IF EXISTS "reseller_manage_own_dropship_listings" ON public.dropship_listings;
CREATE POLICY "reseller_manage_own_dropship_listings" ON public.dropship_listings
  FOR ALL TO authenticated
  USING (public.unified_business_member(reseller_business_profile_id))
  WITH CHECK (public.unified_business_member(reseller_business_profile_id));

-- -----------------------------------------------------------------------------
-- SECTION 3 — DROPSHIP_ORDERS  (settlement record, companion to transactions)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.dropship_orders (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id             TEXT NOT NULL,
  reseller_business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id),
  supermarket_id              UUID NOT NULL,
  wholesale_amount            NUMERIC NOT NULL,
  reseller_margin_amount      NUMERIC NOT NULL,
  customer_paid_amount        NUMERIC NOT NULL,
  customer_receipt_number     TEXT NOT NULL,
  store_receipt_number        TEXT NOT NULL,
  transport_provider          TEXT NOT NULL DEFAULT 'bodagoera',
  transport_status            TEXT NOT NULL DEFAULT 'not_requested',
  bodago_delivery_request_id  UUID,
  pickup_address               TEXT,
  delivery_address             TEXT,
  status                       TEXT NOT NULL DEFAULT 'completed',
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dropship_orders_reseller ON public.dropship_orders(reseller_business_profile_id);
CREATE INDEX IF NOT EXISTS idx_dropship_orders_supermarket ON public.dropship_orders(supermarket_id);

ALTER TABLE public.dropship_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parties_read_own_dropship_orders" ON public.dropship_orders;
CREATE POLICY "parties_read_own_dropship_orders" ON public.dropship_orders
  FOR SELECT TO authenticated
  USING (
    public.unified_business_member(reseller_business_profile_id)
    OR EXISTS (
      SELECT 1 FROM public.supermarkets s
      WHERE s.id = dropship_orders.supermarket_id AND s.owner_user_id = auth.uid()
    )
  );
-- No INSERT/UPDATE/DELETE policy: only dropship_checkout() (SECURITY DEFINER)
-- is allowed to write these rows.

-- -----------------------------------------------------------------------------
-- SECTION 4 — BROWSE RPCs
-- -----------------------------------------------------------------------------

-- Every product a reseller is allowed to list, across every store, with an
-- indicator of whether this reseller already has a listing for it.
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
  listed_price     NUMERIC
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
    dl.listed_price
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

-- Public storefront: a reseller's active listings. No auth required to browse.
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
  reseller_name    TEXT
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    dl.id, p.id, p.name::TEXT, p.sku::TEXT, p.images, p.brand::TEXT,
    dl.listed_price,
    GREATEST(COALESCE(inv.current_stock - inv.reserved_stock, 0), 0) AS available_stock,
    GREATEST(COALESCE(inv.current_stock - inv.reserved_stock, 0), 0) > 0 AS in_stock,
    bp.business_name::TEXT
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
-- SECTION 5 — LIST / UNLIST A PRODUCT
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.dropship_set_listing(
  p_reseller_business_profile_id UUID,
  p_product_id  UUID,
  p_listed_price NUMERIC,
  p_is_active    BOOLEAN DEFAULT TRUE
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

  INSERT INTO public.dropship_listings (reseller_business_profile_id, product_id, supermarket_id, listed_price, is_active)
  VALUES (p_reseller_business_profile_id, p_product_id, v_product.supermarket_id, p_listed_price, p_is_active)
  ON CONFLICT (reseller_business_profile_id, product_id) DO UPDATE
    SET listed_price = EXCLUDED.listed_price,
        is_active     = EXCLUDED.is_active,
        updated_at    = now()
  RETURNING id INTO v_listing_id;

  RETURN jsonb_build_object('success', true, 'listing_id', v_listing_id);
END;
$$;

REVOKE ALL ON FUNCTION public.dropship_set_listing(UUID, UUID, NUMERIC, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dropship_set_listing(UUID, UUID, NUMERIC, BOOLEAN) TO authenticated;

-- -----------------------------------------------------------------------------
-- SECTION 6 — ATOMIC DROPSHIP CHECKOUT
--
-- Mirrors customer_self_checkout() in DCE_CUSTOMER_SELFCHECKOUT.sql, plus the
-- reseller markup + two-sided settlement. Cart format:
--   [{ "product_id": "uuid", "quantity": 2 }, ...]
--
-- Money model per line:
--   wholesale part (-> store)   = selling_price * qty, plus ALL tax on the sale
--   reseller margin (-> reseller) = (listed_price - selling_price) * qty, tax-free profit
--   customer pays                = wholesale part + reseller margin
--                                 = listed_price * qty + tax
-- The store is always the merchant of record for tax purposes; the reseller's
-- cut is a clean commission on top, matching "he just receives profits".
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.dropship_checkout(
  p_reseller_business_profile_id UUID,
  p_cart              JSONB,
  p_customer_name     TEXT DEFAULT NULL,
  p_customer_phone    TEXT DEFAULT NULL,
  p_delivery_address  TEXT DEFAULT NULL,
  p_store_location    TEXT DEFAULT NULL
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
  v_store_address     TEXT;
  v_store_business_id UUID;
  v_reseller_owner_id UUID;
  v_reseller_name     TEXT;
  v_cust_name         TEXT;
  v_cust_phone        TEXT;
  v_dropship_order_id UUID;
  v_debit_balance  NUMERIC;
  v_leg_ican_amount NUMERIC;
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
    SELECT dl.listed_price, p.selling_price, p.tax_rate, p.supermarket_id,
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

  -- ── Every leg below: lock + debit the customer's personal ICAN wallet
  -- directly (the proven balance-check path), record their own
  -- 'transfer_out' ledger row so it still shows in their history, then
  -- credit the payee's BUSINESS wallet straight away via the trusted
  -- 'pos_sale' settlement entrypoint — full value, no person-to-business
  -- tithe, no personal-wallet detour on the receiving side.

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

  -- ── Pay the reseller their markup, tax-free ─────────────────────────────────
  IF v_margin_total > 0 THEN
    v_leg_ican_amount := GREATEST(ROUND(v_margin_total / 5000, 8), 0.00000001);

    SELECT ican_balance INTO v_debit_balance
      FROM public.ican_user_wallets WHERE user_id = v_auth_id FOR UPDATE;
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
       v_margin_total, 'UGX', v_reseller_name, 'business', 'business_expense',
       'digital-city-era', v_tx_record_id || '_RESELLER',
       format('Dropship commission | %s | receipt %s', COALESCE(v_store_name, 'store'), v_customer_receipt_no),
       p_reseller_business_profile_id);

    PERFORM public.ican_settle_business_wallet_income(
      p_reseller_business_profile_id,
      v_leg_ican_amount,
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
    v_wholesale_subtotal, v_tax_total, v_wholesale_subtotal + v_tax_total, v_wholesale_subtotal + v_tax_total,
    'ican', v_store_snapshot, 'completed', 'DROPSHIP', COALESCE(v_store_name, 'Store'), now()
  );

  INSERT INTO public.dropship_orders (
    transaction_id, reseller_business_profile_id, supermarket_id,
    wholesale_amount, reseller_margin_amount, customer_paid_amount,
    customer_receipt_number, store_receipt_number,
    pickup_address, delivery_address, status
  ) VALUES (
    v_tx_record_id, p_reseller_business_profile_id, v_supermarket_id,
    v_wholesale_subtotal + v_tax_total, v_margin_total, v_customer_total,
    v_customer_receipt_no, v_store_receipt_no,
    COALESCE(v_store_address, v_store_name), p_delivery_address, 'completed'
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
    'items_count', v_items_count,
    'delivery_address', p_delivery_address,
    'transport_provider', 'bodagoera'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dropship_checkout(UUID, JSONB, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dropship_checkout(UUID, JSONB, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- SECTION 6B — STOP THE SHARED INVENTORY TRIGGER FROM RE-PROCESSING SELF-
-- MANAGED CHECKOUTS
--
-- public.deduct_inventory_on_transaction() (see
-- digital-city-era/backend/database/migrations/ADD_PHARMACY_FLEXIBLE_INVENTORY.sql)
-- fires AFTER INSERT/UPDATE on every public.transactions row and re-validates
-- + re-deducts stock by matching products.supermarket_id = NEW.supermarket_id.
-- dropship_checkout() (and customer_self_checkout() before it) already lock
-- and deduct public.inventory themselves BEFORE moving any money, and never
-- set transactions.supermarket_id, so this trigger used to blow up with
-- "Product % does not belong to supermarket <NULL>" the instant a dropship
-- sale completed — and would double-deduct stock even if supermarket_id were
-- filled in. Skip the trigger entirely for these self-managed register
-- numbers; every other flow (regular POS, pharmacy, etc.) is unaffected.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.deduct_inventory_on_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_product_id UUID;
  v_batch_id UUID;
  v_qty NUMERIC;
  v_mode TEXT;
  v_product_status TEXT;
  v_requires_prescription BOOLEAN;
  v_controlled BOOLEAN;
  v_expiry DATE;
  v_stock NUMERIC;
  v_supermarket_type TEXT;
BEGIN
  IF NEW.status <> 'completed'
     OR (TG_OP = 'UPDATE' AND OLD.status = 'completed') THEN
    RETURN NEW;
  END IF;

  IF NEW.register_number IN ('DROPSHIP', 'SELF-CHECKOUT') THEN
    RETURN NEW;
  END IF;

  SELECT business_type INTO v_supermarket_type
  FROM public.supermarkets
  WHERE id = NEW.supermarket_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(NEW.items, '[]'::jsonb))
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::UUID;
    v_batch_id := NULLIF(v_item->>'batch_id', '')::UUID;
    v_qty := GREATEST(COALESCE(NULLIF(v_item->>'quantity', '')::NUMERIC, 1), 0);

    IF v_product_id IS NULL OR v_qty = 0 THEN
      CONTINUE;
    END IF;

    SELECT inventory_mode, product_status, prescription_required,
           controlled_medicine, expiry_date
    INTO v_mode, v_product_status, v_requires_prescription,
         v_controlled, v_expiry
    FROM public.products
    WHERE id = v_product_id
      AND supermarket_id = NEW.supermarket_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % does not belong to supermarket %', v_product_id, NEW.supermarket_id;
    END IF;

    IF COALESCE(v_product_status, 'active') IN ('expired', 'recalled', 'discontinued')
       OR (v_expiry IS NOT NULL AND v_expiry < CURRENT_DATE) THEN
      RAISE EXCEPTION 'Product % is expired, recalled, or discontinued', v_product_id;
    END IF;

    IF v_supermarket_type = 'pharmacy'
       AND (v_requires_prescription OR v_controlled)
       AND COALESCE((v_item->>'prescription_verified')::BOOLEAN, FALSE) = FALSE THEN
      RAISE EXCEPTION 'Prescription verification is required for product %', v_product_id;
    END IF;

    IF v_mode IN ('listing_only', 'service_item') THEN
      CONTINUE;
    END IF;

    IF v_mode = 'batch_controlled' THEN
      IF v_batch_id IS NOT NULL THEN
        SELECT current_stock, expiry_date, status
        INTO v_stock, v_expiry, v_product_status
        FROM public.product_inventory_batches
        WHERE id = v_batch_id
          AND product_id = v_product_id
          AND supermarket_id = NEW.supermarket_id
        FOR UPDATE;

        IF NOT FOUND OR v_product_status <> 'active' OR v_expiry < CURRENT_DATE THEN
          RAISE EXCEPTION 'Selected pharmacy batch is unavailable or expired';
        END IF;

        IF v_stock < v_qty THEN
          RAISE EXCEPTION 'Insufficient stock in selected pharmacy batch for product %', v_product_id;
        END IF;

        UPDATE public.product_inventory_batches
        SET current_stock = current_stock - v_qty,
            status = CASE WHEN current_stock - v_qty = 0 THEN 'depleted' ELSE status END,
            updated_at = now()
        WHERE id = v_batch_id;
      ELSE
        SELECT id, current_stock, expiry_date
        INTO v_batch_id, v_stock, v_expiry
        FROM public.product_inventory_batches
        WHERE product_id = v_product_id
          AND supermarket_id = NEW.supermarket_id
          AND status = 'active'
          AND expiry_date >= CURRENT_DATE
          AND current_stock >= v_qty
        ORDER BY expiry_date ASC
        LIMIT 1
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'No eligible pharmacy batch has enough stock for product %', v_product_id;
        END IF;

        UPDATE public.product_inventory_batches
        SET current_stock = current_stock - v_qty,
            status = CASE WHEN current_stock - v_qty = 0 THEN 'depleted' ELSE status END,
            updated_at = now()
        WHERE id = v_batch_id;
      END IF;
    ELSE
      SELECT current_stock INTO v_stock
      FROM public.inventory
      WHERE product_id = v_product_id
        AND supermarket_id = NEW.supermarket_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Inventory record is missing for product %', v_product_id;
      END IF;

      IF v_stock < v_qty THEN
        RAISE EXCEPTION 'Insufficient stock for product %', v_product_id;
      END IF;

      UPDATE public.inventory
      SET current_stock = current_stock - v_qty,
          updated_at = now()
      WHERE product_id = v_product_id
        AND supermarket_id = NEW.supermarket_id;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- SECTION 7 — SETTLEMENT REPORTS (store side + reseller side)
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_store_dropship_sales(UUID);
CREATE OR REPLACE FUNCTION public.get_store_dropship_sales(p_supermarket_id UUID)
RETURNS SETOF public.dropship_orders LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.supermarkets s WHERE s.id = p_supermarket_id AND s.owner_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'You do not have access to this store''s dropship sales';
  END IF;
  RETURN QUERY SELECT * FROM public.dropship_orders WHERE supermarket_id = p_supermarket_id ORDER BY created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_store_dropship_sales(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_dropship_sales(UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.get_reseller_dropship_sales(UUID);
CREATE OR REPLACE FUNCTION public.get_reseller_dropship_sales(p_reseller_business_profile_id UUID)
RETURNS SETOF public.dropship_orders LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.unified_business_member(p_reseller_business_profile_id) THEN
    RAISE EXCEPTION 'You do not have access to this business profile';
  END IF;
  RETURN QUERY SELECT * FROM public.dropship_orders
    WHERE reseller_business_profile_id = p_reseller_business_profile_id ORDER BY created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_reseller_dropship_sales(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reseller_dropship_sales(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- SECTION 8 — "DROPSHIPPING" BUSINESS CATEGORY (Manage Your Business)
-- Gives a reseller a normal business account: wallet, Pichin pitching, etc.
-- via the existing create_business_profile_from_category() onboarding RPC.
-- -----------------------------------------------------------------------------

INSERT INTO public.business_category_templates
  (category_key, display_name, operating_mode, default_modules, default_departments, default_roles, required_documents)
VALUES
  ('dropshipping', 'Dropshipping / Reseller', 'retail_adapter',
   '{"dropship":true,"reports":true,"transport":true}',
   '["Sales","Finance"]', '["business_admin","reseller_agent"]', '[]')
ON CONFLICT (category_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  operating_mode = EXCLUDED.operating_mode,
  default_modules = EXCLUDED.default_modules,
  default_departments = EXCLUDED.default_departments,
  default_roles = EXCLUDED.default_roles,
  required_documents = EXCLUDED.required_documents,
  is_active = TRUE;

NOTIFY pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- VERIFY
-- -----------------------------------------------------------------------------
SELECT 'dropship reseller system installed' AS status, now() AS run_at;
