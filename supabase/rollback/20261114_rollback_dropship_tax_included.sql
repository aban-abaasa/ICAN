-- ============================================================================
-- Rolls back 20261114100000_dropship_tax_included.sql
--
-- Dropship goes back to ADDING tax on top of the price (the checkout, the guest quote and instalment pricing together - they must
-- always agree). Sales already made keep what they were charged. Only the pieces that migration added are taken out; anything
-- else in the functions (the sale-fee patch, the delivery changes) stays. Safe to run twice.
--
-- REFUSES while an instalment plan started after the migration is still open: its amounts are tax-inclusive, and the old receipt
-- code would write its store receipt with the tax counted twice. Let those plans finish (or cancel them), then roll back.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('public.installment_plans') IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.installment_plans p
        WHERE p.dropship_order_id IS NULL
          AND p.status NOT IN ('completed', 'cancelled', 'lapsed')
          AND jsonb_typeof(p.items) = 'array'
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(p.items) l WHERE COALESCE((l ->> 'tax_inclusive')::BOOLEAN, FALSE))) THEN
    RAISE EXCEPTION 'An instalment plan started after the tax-included change is still open - let it finish (or cancel it) before rolling back, otherwise its store receipt would count the tax twice. NOTHING was changed.';
  END IF;
END $guard$;

DO $unpatch$
DECLARE
  v_drop_oid  OID := to_regprocedure('public.dropship_checkout(uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])');
  v_guest_oid OID := to_regprocedure('public.guest_checkout_start(uuid,jsonb,text,text,text,numeric,numeric,numeric,text[],boolean)');
  v_price_oid OID := to_regprocedure('public._inst_price_cart(uuid,jsonb,boolean)');
  v_sale_oid  OID := to_regprocedure('public._inst_record_sale(uuid,text,text)');
  v_drop TEXT; v_guest TEXT; v_price TEXT; v_sale TEXT;
BEGIN
  -- ── dropship_checkout ────────────────────────────────────────────────────────────────────────────────────────────
  IF v_drop_oid IS NOT NULL THEN
    v_drop := replace(pg_get_functiondef(v_drop_oid), E'\r\n', E'\n');
    IF position('selling_price already includes tax' IN v_drop) > 0 THEN
      v_drop := regexp_replace(v_drop,
        $r$-- selling_price already includes tax: split the store's price into the tax inside it and what is left \(never added on top\)\s*v_tax_line := CASE WHEN v_tax_rate > 0\s*THEN ROUND\(v_listing\.selling_price \* v_qty - \(v_listing\.selling_price \* v_qty\) / \(1 \+ v_tax_rate / 100\), 2\)\s*ELSE 0\s*END;\s*v_wholesale_line := ROUND\(v_listing\.selling_price \* v_qty, 2\) - v_tax_line;$r$,
        $r$v_wholesale_line := ROUND(v_listing.selling_price * v_qty, 2);$r$);
      v_drop := regexp_replace(v_drop,
        $r$v_customer_line := ROUND\(v_listing\.listed_price \* v_qty, 2\);$r$,
$r$v_tax_line       := ROUND(v_listing.listed_price * v_qty * (v_tax_rate / 100), 2);
    v_customer_line  := ROUND(v_listing.listed_price * v_qty + v_tax_line, 2);$r$);
      v_drop := regexp_replace(v_drop, $r$('line_total',\s*v_customer_line), 'tax_amount', v_tax_line$r$, $r$\1$r$);
      v_drop := regexp_replace(v_drop, $r$\(item->>'tax_amount'\)::DECIMAL$r$,
        $r$(item->>'tax_rate')::DECIMAL / 100 * (item->>'unit_price')::DECIMAL * (item->>'quantity')::DECIMAL$r$);
      IF position('selling_price already includes tax' IN v_drop) > 0 THEN
        RAISE EXCEPTION 'dropship_checkout was changed after the migration and can no longer be unpatched automatically - NOTHING was changed';
      END IF;
    ELSE
      v_drop := NULL;
    END IF;
  END IF;

  -- ── guest_checkout_start ─────────────────────────────────────────────────────────────────────────────────────────
  IF v_guest_oid IS NOT NULL THEN
    v_guest := replace(pg_get_functiondef(v_guest_oid), E'\r\n', E'\n');
    IF position('selling_price already includes tax' IN v_guest) > 0 THEN
      v_guest := regexp_replace(v_guest,
        $r$-- selling_price already includes tax: the customer pays the listed price, nothing is added on top\s*v_items_total  := v_items_total \+ ROUND\(v_listing\.listed_price \* v_qty, 2\);$r$,
$r$v_tax_line     := ROUND(v_listing.listed_price * v_qty * (v_listing.tax_rate / 100), 2);
    v_items_total  := v_items_total + ROUND(v_listing.listed_price * v_qty + v_tax_line, 2);$r$);
      IF position('selling_price already includes tax' IN v_guest) > 0 THEN
        RAISE EXCEPTION 'guest_checkout_start was changed after the migration and can no longer be unpatched automatically - NOTHING was changed';
      END IF;
    ELSE
      v_guest := NULL;
    END IF;
  END IF;

  -- ── instalments ──────────────────────────────────────────────────────────────────────────────────────────────────
  IF v_price_oid IS NOT NULL THEN
    v_price := replace(pg_get_functiondef(v_price_oid), E'\r\n', E'\n');
    IF position('selling_price already includes tax' IN v_price) > 0 THEN
      v_price := regexp_replace(v_price,
        $r$-- selling_price already includes tax: v_tax_line is the tax inside the store's price, nothing is added on top\s*v_tax_line      := CASE WHEN v_listing\.tax_rate > 0\s*THEN ROUND\(v_listing\.selling_price \* v_qty - \(v_listing\.selling_price \* v_qty\) / \(1 \+ v_listing\.tax_rate / 100\), 2\)\s*ELSE 0\s*END;\s*v_line          := ROUND\(v_listing\.listed_price \* v_qty, 2\);\s*v_items_total   := v_items_total \+ v_line;\s*v_store_total   := v_store_total \+ ROUND\(v_listing\.selling_price \* v_qty, 2\);$r$,
$r$v_tax_line      := ROUND(v_listing.listed_price * v_qty * (v_listing.tax_rate / 100), 2);
    v_line          := ROUND(v_listing.listed_price * v_qty + v_tax_line, 2);
    v_items_total   := v_items_total + v_line;
    v_store_total   := v_store_total + ROUND(v_listing.selling_price * v_qty, 2) + v_tax_line;$r$);
      v_price := regexp_replace(v_price, $r$('wholesale_price',\s*v_listing\.selling_price,\s*'tax_amount',\s*v_tax_line), 'tax_inclusive', TRUE$r$, $r$\1$r$);
      IF position('selling_price already includes tax' IN v_price) > 0 OR position('tax_inclusive' IN v_price) > 0 THEN
        RAISE EXCEPTION '_inst_price_cart was changed after the migration and can no longer be unpatched automatically - NOTHING was changed';
      END IF;
    ELSE
      v_price := NULL;
    END IF;
  END IF;

  IF v_sale_oid IS NOT NULL THEN
    v_sale := replace(pg_get_functiondef(v_sale_oid), E'\r\n', E'\n');
    IF position('tax_inclusive' IN v_sale) > 0 THEN
      v_sale := regexp_replace(v_sale,
        $r$(v_wholesale := v_wholesale \+ ROUND\(\(v_line ->> 'wholesale_price'\)::NUMERIC \* \(v_line ->> 'quantity'\)::NUMERIC, 2\))\s*- CASE WHEN COALESCE\(\(v_line ->> 'tax_inclusive'\)::BOOLEAN, FALSE\) THEN \(v_line ->> 'tax_amount'\)::NUMERIC ELSE 0 END;$r$, $r$\1;$r$);
      v_sale := regexp_replace(v_sale, $r$('line_total', \(v_line ->> 'line_total'\)::NUMERIC), 'tax_amount', \(v_line ->> 'tax_amount'\)::NUMERIC\)$r$, $r$\1)$r$);
      v_sale := regexp_replace(v_sale,
        $r$(ROUND\(\(v_line ->> 'wholesale_price'\)::NUMERIC \* \(v_line ->> 'quantity'\)::NUMERIC, 2\) \+ )CASE WHEN COALESCE\(\(v_line ->> 'tax_inclusive'\)::BOOLEAN, FALSE\) THEN 0 ELSE \(v_line ->> 'tax_amount'\)::NUMERIC END\)$r$,
        $r$\1(v_line ->> 'tax_amount')::NUMERIC)$r$);
      v_sale := regexp_replace(v_sale, $r$\(item ->> 'tax_amount'\)::DECIMAL$r$,
        $r$(item ->> 'tax_rate')::DECIMAL / 100 * (item ->> 'unit_price')::DECIMAL * (item ->> 'quantity')::DECIMAL$r$);
      IF position('tax_inclusive' IN v_sale) > 0 THEN
        RAISE EXCEPTION '_inst_record_sale was changed after the migration and can no longer be unpatched automatically - NOTHING was changed';
      END IF;
    ELSE
      v_sale := NULL;
    END IF;
  END IF;

  IF v_drop  IS NOT NULL THEN EXECUTE v_drop;  END IF;
  IF v_guest IS NOT NULL THEN EXECUTE v_guest; END IF;
  IF v_price IS NOT NULL THEN EXECUTE v_price; END IF;
  IF v_sale  IS NOT NULL THEN EXECUTE v_sale;  END IF;
END $unpatch$;

NOTIFY pgrst, 'reload schema';

SELECT 'Dropship adds tax on top again (checkout, guest quote and instalments); sales already made are untouched' AS status;
