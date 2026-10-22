-- Rolls back 20261108100000_shop_checkout_tax_included.sql
--
-- customer_self_checkout goes back to ADDING tax on top of the selling price. Orders placed in the meantime keep what they were
-- charged. Only the pieces that migration added are taken out; anything else in the function stays. Safe to run twice.

DO $unpatch$
DECLARE
  v_oid OID := to_regprocedure('public.customer_self_checkout(jsonb,text,boolean,text)');
  v_def TEXT;
BEGIN
  IF v_oid IS NULL THEN RETURN; END IF;
  v_def := replace(pg_get_functiondef(v_oid), E'\r\n', E'\n');
  IF position('v_line_total / (1 + v_tax_rate / 100)' IN v_def) = 0 THEN RETURN; END IF;

  v_def := replace(v_def, $r$-- selling_price already includes tax: the line total IS the price, and the tax is the portion sitting inside it (never added on top).
    v_line_total := ROUND(v_unit_price * v_qty, 2);
    v_tax_amount := CASE WHEN v_tax_rate > 0
                      THEN ROUND(v_line_total - (v_line_total / (1 + v_tax_rate / 100)), 2)
                      ELSE 0
                    END;$r$,
$r$v_tax_amount := ROUND(v_unit_price * v_qty * (v_tax_rate / 100), 2);
    v_line_total := ROUND(v_unit_price * v_qty + v_tax_amount, 2);$r$);
  v_def := replace(v_def, $r$v_subtotal := v_subtotal + (v_line_total - v_tax_amount);$r$,
                          $r$v_subtotal := v_subtotal + (v_unit_price * v_qty);$r$);
  v_def := replace(v_def, $r$'tax_amount', v_tax_amount,
      $r$, '');
  v_def := replace(v_def, $r$(item->>'tax_amount')::DECIMAL$r$,
    $r$(item->>'tax_rate')::DECIMAL / 100 * (item->>'unit_price')::DECIMAL * (item->>'quantity')::DECIMAL$r$);

  IF position('v_line_total / (1 + v_tax_rate / 100)' IN v_def) > 0 THEN
    RAISE EXCEPTION 'customer_self_checkout was changed after the migration and can no longer be unpatched automatically - NOTHING was changed';
  END IF;
  EXECUTE v_def;
END $unpatch$;

NOTIFY pgrst, 'reload schema';
