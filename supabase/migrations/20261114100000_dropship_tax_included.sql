-- ============================================================================
-- Dropship: tax is INCLUDED in the selling price - never added on top, anywhere
--
-- THE PROBLEM
--   products.selling_price already contains the tax (the cashier portal charges it as-is, the shop apps show the shelf price as the
--   total, and 20261108100000_shop_checkout_tax_included.sql made the shop checkout charge exactly that). Dropship still ADDED
--   the tax on top: a UGX 10,000 product with 18% VAT cost the customer 11,800 while the storefront, the cart and the website's
--   Market all said 10,000. The same happened through the guest (Mobile Money / card / bank) quote and through instalments, which
--   price a cart "exactly the way dropship_checkout does".
--
-- AFTER THIS, for every dropship line (quantity q):
--   the customer pays   listed price x q                     (exactly what they were shown; tax is inside it)
--   the store receives  selling price x q                    (its shelf price - the tax inside it is the store's, which is the merchant of record)
--   the reseller keeps  (listed price - selling price) x q   (a tax-free markup, as before)
--   tax                 the part of the store's price that is tax = selling x q - selling x q / (1 + rate)   (0 for a 0% product)
-- so  store + reseller = what the customer paid for the goods, to the shilling, and the delivery fare is added to the customer's
-- total exactly as before. With no markup the customer pays the shelf price.
--
-- HOW (the smallest change that makes every figure right)
--   Everything downstream of the line maths already says "the store's wholesale part + the tax" (the store's settlement leg, its
--   receipt, the order record, the answer). So instead of rewriting those, the line maths is changed to split the store's price
--   into the tax inside it and what is left; wholesale + tax is then the shelf price, and all of them are right as they stand.
--   Only what priced the customer's line (and the tax figure stored on each sale item) needed to change.
--
-- WHAT IS PATCHED - IN PLACE, from whatever version is deployed (the way 20261107 and 20261108 patch theirs):
--   dropship_checkout (the 11-argument one every dropship path ends in)   the order itself
--   guest_checkout_start                                                    the Mobile Money / card / bank quote - must equal the order
--   _inst_price_cart                                                        instalment pricing - must equal the order
--   _inst_record_sale                                                       the receipts an instalment sale writes
-- Each piece of text it replaces must be found exactly once in its function; if ANY function is not the version this was written
-- for, the migration stops with a message and NOTHING is changed (all four are checked before any is touched). A function that is
-- not installed (guest checkout, instalments) is simply skipped. If the function already works this way it is left alone.
-- Independent of 20261107100000_sale_platform_fees.sql: run them in either order.
--
-- WHAT IT DOES NOT TOUCH
--   * Sales already made. * The delivery fare, the rider's pay, the reseller's subsidy, the platform fee rules.
--   * Instalment plans already open: their amounts were fixed (tax on top) when they were started and stay that way - every
--     amount the plan holds is consistent with itself, and a plan that is delivered after this goes live is simply charged less
--     by dropship, the difference staying in the customer's wallet. New plans carry `tax_inclusive` on each line, which is how the
--     receipts tell the two apart. A guest order started before this and paid after it is charged less, and the difference is
--     handed back by guest checkout, as it already does when a fare comes in under its quote.
--
-- Safe to run twice. Roll back with supabase/rollback/20261114_rollback_dropship_tax_included.sql.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regprocedure('public.dropship_checkout(uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])') IS NULL THEN
    RAISE EXCEPTION 'Run ADD_DROPSHIP_SMART_TRANSPORT.sql first - this patches its 11-argument dropship_checkout.';
  END IF;
END $guard$;

-- Replace text that must occur exactly once; anything else means this is not the version the migration was written for.
CREATE OR REPLACE FUNCTION pg_temp.ican_patch_rx(d TEXT, pat TEXT, repl TEXT, what TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  n INTEGER := (SELECT count(*) FROM regexp_matches(d, pat, 'g'));
BEGIN
  IF n = 1 THEN RETURN regexp_replace(d, pat, repl); END IF;
  RAISE EXCEPTION '%: expected to find exactly one match for /%/ but found % - this is not the version of the function this migration was written for, so NOTHING was changed', what, pat, n;
END $$;

DO $patch$
DECLARE
  v_drop_oid  OID := to_regprocedure('public.dropship_checkout(uuid,jsonb,text,text,text,text,numeric,numeric,numeric,uuid,text[])');
  v_guest_oid OID := to_regprocedure('public.guest_checkout_start(uuid,jsonb,text,text,text,numeric,numeric,numeric,text[],boolean)');
  v_price_oid OID := to_regprocedure('public._inst_price_cart(uuid,jsonb,boolean)');
  v_sale_oid  OID := to_regprocedure('public._inst_record_sale(uuid,text,text)');
  v_drop  TEXT := replace(pg_get_functiondef(v_drop_oid), E'\r\n', E'\n');
  v_guest TEXT;
  v_price TEXT;
  v_sale  TEXT;
  v_drop_done  BOOLEAN := position('selling_price already includes tax' IN v_drop) > 0;
  v_guest_done BOOLEAN := FALSE;
  v_price_done BOOLEAN := FALSE;
  v_sale_done  BOOLEAN := FALSE;
BEGIN
  IF v_guest_oid IS NOT NULL THEN
    v_guest := replace(pg_get_functiondef(v_guest_oid), E'\r\n', E'\n');
    v_guest_done := position('selling_price already includes tax' IN v_guest) > 0;
  END IF;
  IF v_price_oid IS NOT NULL THEN
    v_price := replace(pg_get_functiondef(v_price_oid), E'\r\n', E'\n');
    v_price_done := position('selling_price already includes tax' IN v_price) > 0;
  END IF;
  IF v_sale_oid IS NOT NULL THEN
    v_sale := replace(pg_get_functiondef(v_sale_oid), E'\r\n', E'\n');
    v_sale_done := position('tax_inclusive' IN v_sale) > 0;
  END IF;

  -- ── dropship_checkout ────────────────────────────────────────────────────────────────────────────────────────────
  IF NOT v_drop_done THEN
    -- the store's price: the tax inside it, and the rest. wholesale + tax = the shelf price exactly.
    v_drop := pg_temp.ican_patch_rx(v_drop,
      $r$v_wholesale_line\s*:=\s*ROUND\(\s*v_listing\.selling_price\s*\*\s*v_qty\s*,\s*2\s*\)\s*;$r$,
$r$-- selling_price already includes tax: split the store's price into the tax inside it and what is left (never added on top)
    v_tax_line := CASE WHEN v_tax_rate > 0
                    THEN ROUND(v_listing.selling_price * v_qty - (v_listing.selling_price * v_qty) / (1 + v_tax_rate / 100), 2)
                    ELSE 0
                  END;
    v_wholesale_line := ROUND(v_listing.selling_price * v_qty, 2) - v_tax_line;$r$,
      'dropship_checkout: the store''s price');

    -- the customer's line is the listed price, exactly as they were shown it
    v_drop := pg_temp.ican_patch_rx(v_drop,
      $r$v_tax_line\s*:=\s*ROUND\(\s*v_listing\.listed_price\s*\*\s*v_qty\s*\*\s*\(\s*v_tax_rate\s*/\s*100\s*\)\s*,\s*2\s*\)\s*;\s*v_customer_line\s*:=\s*ROUND\(\s*v_listing\.listed_price\s*\*\s*v_qty\s*\+\s*v_tax_line\s*,\s*2\s*\)\s*;$r$,
      $r$v_customer_line := ROUND(v_listing.listed_price * v_qty, 2);$r$,
      'dropship_checkout: the customer''s line');

    -- each sale line keeps the tax inside it...
    v_drop := pg_temp.ican_patch_rx(v_drop,
      $r$('unit_price',\s*v_listing\.listed_price,\s*'tax_rate',\s*v_tax_rate,\s*'line_total',\s*v_customer_line)$r$,
      $r$\1, 'tax_amount', v_tax_line$r$,
      'dropship_checkout: the line snapshot');

    -- ...and the sale items record it (they used to work it out as listed price x rate, which is the tax-on-top figure)
    v_drop := pg_temp.ican_patch_rx(v_drop,
      $r$\(item->>'tax_rate'\)::DECIMAL\s*/\s*100\s*\*\s*\(item->>'unit_price'\)::DECIMAL\s*\*\s*\(item->>'quantity'\)::DECIMAL$r$,
      $r$(item->>'tax_amount')::DECIMAL$r$,
      'dropship_checkout: the sale items'' tax');

    IF position('selling_price already includes tax' IN v_drop) = 0 THEN
      RAISE EXCEPTION 'dropship_checkout: the patch did not take - NOTHING was changed';
    END IF;
  END IF;

  -- ── guest_checkout_start: the quote must equal the order ─────────────────────────────────────────────────────────
  IF v_guest_oid IS NOT NULL AND NOT v_guest_done THEN
    v_guest := pg_temp.ican_patch_rx(v_guest,
      $r$v_tax_line\s*:=\s*ROUND\(\s*v_listing\.listed_price\s*\*\s*v_qty\s*\*\s*\(\s*v_listing\.tax_rate\s*/\s*100\s*\)\s*,\s*2\s*\)\s*;\s*v_items_total\s*:=\s*v_items_total\s*\+\s*ROUND\(\s*v_listing\.listed_price\s*\*\s*v_qty\s*\+\s*v_tax_line\s*,\s*2\s*\)\s*;$r$,
$r$-- selling_price already includes tax: the customer pays the listed price, nothing is added on top
    v_items_total  := v_items_total + ROUND(v_listing.listed_price * v_qty, 2);$r$,
      'guest_checkout_start: the items total');
    IF position('selling_price already includes tax' IN v_guest) = 0 THEN
      RAISE EXCEPTION 'guest_checkout_start: the patch did not take - NOTHING was changed';
    END IF;
  END IF;

  -- ── instalments: price the cart the way dropship_checkout does, and record the sale that way ─────────────────────
  IF v_price_oid IS NOT NULL AND NOT v_price_done THEN
    v_price := pg_temp.ican_patch_rx(v_price,
      $r$v_tax_line\s*:=\s*ROUND\(\s*v_listing\.listed_price\s*\*\s*v_qty\s*\*\s*\(\s*v_listing\.tax_rate\s*/\s*100\s*\)\s*,\s*2\s*\)\s*;\s*v_line\s*:=\s*ROUND\(\s*v_listing\.listed_price\s*\*\s*v_qty\s*\+\s*v_tax_line\s*,\s*2\s*\)\s*;\s*v_items_total\s*:=\s*v_items_total\s*\+\s*v_line\s*;\s*v_store_total\s*:=\s*v_store_total\s*\+\s*ROUND\(\s*v_listing\.selling_price\s*\*\s*v_qty\s*,\s*2\s*\)\s*\+\s*v_tax_line\s*;$r$,
$r$-- selling_price already includes tax: v_tax_line is the tax inside the store's price, nothing is added on top
    v_tax_line      := CASE WHEN v_listing.tax_rate > 0
                         THEN ROUND(v_listing.selling_price * v_qty - (v_listing.selling_price * v_qty) / (1 + v_listing.tax_rate / 100), 2)
                         ELSE 0
                       END;
    v_line          := ROUND(v_listing.listed_price * v_qty, 2);
    v_items_total   := v_items_total + v_line;
    v_store_total   := v_store_total + ROUND(v_listing.selling_price * v_qty, 2);$r$,
      '_inst_price_cart: the line maths');
    -- plans started before this have lines without it: that is how their receipts are told apart
    v_price := pg_temp.ican_patch_rx(v_price,
      $r$('wholesale_price',\s*v_listing\.selling_price,\s*'tax_amount',\s*v_tax_line)$r$,
      $r$\1, 'tax_inclusive', TRUE$r$,
      '_inst_price_cart: the line marker');
  END IF;

  IF v_sale_oid IS NOT NULL AND NOT v_sale_done THEN
    -- the store's price without the tax inside it (a plan started before this has its tax on top: it stays as it was)
    v_sale := pg_temp.ican_patch_rx(v_sale,
      $r$v_wholesale\s*:=\s*v_wholesale\s*\+\s*ROUND\(\s*\(v_line\s*->>\s*'wholesale_price'\)::NUMERIC\s*\*\s*\(v_line\s*->>\s*'quantity'\)::NUMERIC\s*,\s*2\s*\)\s*;$r$,
$r$v_wholesale := v_wholesale + ROUND((v_line ->> 'wholesale_price')::NUMERIC * (v_line ->> 'quantity')::NUMERIC, 2)
                    - CASE WHEN COALESCE((v_line ->> 'tax_inclusive')::BOOLEAN, FALSE) THEN (v_line ->> 'tax_amount')::NUMERIC ELSE 0 END;$r$,
      '_inst_record_sale: the store''s subtotal');
    v_sale := pg_temp.ican_patch_rx(v_sale,
      $r$('tax_rate',\s*\(v_line\s*->>\s*'tax_rate'\)::NUMERIC,\s*'line_total',\s*\(v_line\s*->>\s*'line_total'\)::NUMERIC)\)$r$,
      $r$\1, 'tax_amount', (v_line ->> 'tax_amount')::NUMERIC)$r$,
      '_inst_record_sale: the line snapshot');
    v_sale := pg_temp.ican_patch_rx(v_sale,
      $r$('line_total',\s*ROUND\(\(v_line\s*->>\s*'wholesale_price'\)::NUMERIC\s*\*\s*\(v_line\s*->>\s*'quantity'\)::NUMERIC\s*,\s*2\)\s*\+\s*)\(v_line\s*->>\s*'tax_amount'\)::NUMERIC\)$r$,
      $r$\1CASE WHEN COALESCE((v_line ->> 'tax_inclusive')::BOOLEAN, FALSE) THEN 0 ELSE (v_line ->> 'tax_amount')::NUMERIC END)$r$,
      '_inst_record_sale: the store''s line');
    v_sale := pg_temp.ican_patch_rx(v_sale,
      $r$\(item\s*->>\s*'tax_rate'\)::DECIMAL\s*/\s*100\s*\*\s*\(item\s*->>\s*'unit_price'\)::DECIMAL\s*\*\s*\(item\s*->>\s*'quantity'\)::DECIMAL$r$,
      $r$(item ->> 'tax_amount')::DECIMAL$r$,
      '_inst_record_sale: the sale items'' tax');
    IF position('tax_inclusive' IN v_sale) = 0 THEN
      RAISE EXCEPTION '_inst_record_sale: the patch did not take - NOTHING was changed';
    END IF;
  END IF;

  -- every piece of text in EVERY function was found exactly once before any of them is touched
  IF NOT v_drop_done THEN EXECUTE v_drop; ELSE RAISE NOTICE 'dropship_checkout already treats the selling price as tax-inclusive - left as it is'; END IF;
  IF v_guest_oid IS NULL THEN RAISE NOTICE 'guest checkout is not installed - nothing to change there';
  ELSIF NOT v_guest_done THEN EXECUTE v_guest; ELSE RAISE NOTICE 'guest_checkout_start already treats the selling price as tax-inclusive - left as it is'; END IF;
  IF v_price_oid IS NULL THEN RAISE NOTICE 'instalments are not installed - nothing to change there';
  ELSE
    IF NOT v_price_done THEN EXECUTE v_price; ELSE RAISE NOTICE '_inst_price_cart already treats the selling price as tax-inclusive - left as it is'; END IF;
    IF v_sale_oid IS NOT NULL AND NOT v_sale_done THEN EXECUTE v_sale; END IF;
  END IF;
  RAISE NOTICE 'Dropship now treats the selling price as tax-inclusive: the customer pays the listed price, the store receives its shelf price.';
END $patch$;

NOTIFY pgrst, 'reload schema';
