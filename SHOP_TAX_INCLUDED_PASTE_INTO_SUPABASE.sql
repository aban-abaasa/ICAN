-- ============================================================================
-- Shop checkout: tax is INCLUDED in the selling price - never added on top
--
-- products.selling_price already contains the tax (the cashier portal shows it and charges it as-is, and the shop apps show
-- the shelf price as the total: "Selling prices already include tax"). The customer_self_checkout deployed in the live
-- project still ADDED tax on top of that price (line_total = price x qty + price x qty x rate), so a UGX 10,000 product with
-- 18% tax cost the customer 11,800 while the screen said 10,000.
--
-- After this, for every line:
--   line total = selling price x quantity                       (exactly what the customer saw)
--   tax        = line total - line total / (1 + rate)           (the part of it that is tax; 0 for a 0% product)
--   subtotal   = line total - tax
-- so subtotal + tax = total = the shelf price. The receipt, the transaction, the line items and the ICAN the store receives
-- all follow the new total.
--
-- This is the same arithmetic as backend/FIX_CUSTOMER_SELF_CHECKOUT_TAX_INCLUSIVE.sql, but applied as a PATCH IN PLACE to
-- the deployed function (the way FIX_SELF_CHECKOUT_POINTS_AND_ADMIN_HISTORY.sql does), NOT by redefining the whole function:
-- that file would also undo the later changes the live function already has (shop points, the store on the receipt) and
-- brings multi-currency pricing nobody asked for here. Every piece of text it replaces must be found exactly once; if not,
-- this stops with a message and changes NOTHING. If the function already works this way it is left alone.
--
-- Independent of 20261107100000_sale_platform_fees.sql: run them in either order.
-- Orders already placed are not touched. Dropship pricing is a separate change (it also adds tax on top).
-- Safe to run twice. Roll back with supabase/rollback/20261108_rollback_shop_checkout_tax_included.sql.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regprocedure('public.customer_self_checkout(jsonb,text,boolean,text)') IS NULL THEN
    RAISE EXCEPTION 'Run DCE_CUSTOMER_SELFCHECKOUT.sql first - this patches customer_self_checkout.';
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
  v_def TEXT := replace(pg_get_functiondef(to_regprocedure('public.customer_self_checkout(jsonb,text,boolean,text)')), E'\r\n', E'\n');
BEGIN
  IF position('v_line_total / (1 + v_tax_rate / 100)' IN v_def) > 0 THEN
    RAISE NOTICE 'customer_self_checkout already treats the selling price as tax-inclusive - left as it is';
    RETURN;
  END IF;

  -- the line: the price IS the total, the tax is the part of it that is tax
  v_def := pg_temp.ican_patch_rx(v_def,
    $r$v_tax_amount\s*:=\s*ROUND\(\s*v_unit_price\s*\*\s*v_qty\s*\*\s*\(\s*v_tax_rate\s*/\s*100\s*\)\s*,\s*2\s*\)\s*;\s*v_line_total\s*:=\s*ROUND\(\s*v_unit_price\s*\*\s*v_qty\s*\+\s*v_tax_amount\s*,\s*2\s*\)\s*;$r$,
$r$-- selling_price already includes tax: the line total IS the price, and the tax is the portion sitting inside it (never added on top).
    v_line_total := ROUND(v_unit_price * v_qty, 2);
    v_tax_amount := CASE WHEN v_tax_rate > 0
                      THEN ROUND(v_line_total - (v_line_total / (1 + v_tax_rate / 100)), 2)
                      ELSE 0
                    END;$r$,
    'customer_self_checkout: line total and tax');

  -- the subtotal is what is left of the total once the tax inside it is taken out
  v_def := pg_temp.ican_patch_rx(v_def,
    $r$v_subtotal\s*:=\s*v_subtotal\s*\+\s*\(\s*v_unit_price\s*\*\s*v_qty\s*\)\s*;$r$,
    $r$v_subtotal := v_subtotal + (v_line_total - v_tax_amount);$r$,
    'customer_self_checkout: subtotal');

  -- each line keeps its own tax, so the line items can record it
  v_def := pg_temp.ican_patch_rx(v_def,
    $r$('tax_rate',\s*v_tax_rate,\s*)('line_total',\s*v_line_total)$r$,
    $r$\1'tax_amount', v_tax_amount,
      \2$r$,
    'customer_self_checkout: line snapshot');

  -- ...and the line items record it (they used to work it out as price x rate, which is the tax-on-top figure)
  v_def := pg_temp.ican_patch_rx(v_def,
    $r$\(item->>'tax_rate'\)::DECIMAL\s*/\s*100\s*\*\s*\(item->>'unit_price'\)::DECIMAL\s*\*\s*\(item->>'quantity'\)::DECIMAL$r$,
    $r$(item->>'tax_amount')::DECIMAL$r$,
    'customer_self_checkout: line item tax');

  IF position('v_line_total / (1 + v_tax_rate / 100)' IN v_def) = 0 OR position('(item->>''tax_amount'')::DECIMAL' IN v_def) = 0 THEN
    RAISE EXCEPTION 'customer_self_checkout: the patch did not take - NOTHING was changed';
  END IF;
  EXECUTE v_def;
  RAISE NOTICE 'The shop checkout now treats the selling price as tax-inclusive: the customer pays exactly the shelf price.';
END $patch$;

NOTIFY pgrst, 'reload schema';
