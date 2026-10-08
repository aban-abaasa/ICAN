-- =============================================================================
-- FIX_SELF_CHECKOUT_INVENTORY_TRIGGER.sql
--
-- Fixes the MyBodaGuy self-checkout error
--   "Product <id> does not belong to supermarket <NULL>"
--
-- Self-checkout (customer_self_checkout) and dropship checkouts already lock and
-- deduct stock themselves and never set transactions.supermarket_id, so the
-- shared inventory trigger blew up on them. This makes the trigger skip those
-- register numbers ('SELF-CHECKOUT', 'DROPSHIP'); every other sale (regular POS,
-- pharmacy, ...) is unaffected. Same function as SECTION 6B of
-- DROPSHIP_RESELLER_SYSTEM.sql, on its own so it can be run by itself.
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- =============================================================================

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
