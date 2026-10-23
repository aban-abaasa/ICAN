\set ON_ERROR_STOP on
-- An instalment pricing function that is NOT the version the migration was written for (the store total is worked out differently).
-- The migration must refuse - and must then have changed NONE of the other functions either.
DO $$
DECLARE v_def TEXT := pg_get_functiondef('public._inst_price_cart(uuid,jsonb,boolean)'::regprocedure);
BEGIN
  IF position('v_store_total   := v_store_total + ROUND(v_listing.selling_price * v_qty, 2) + v_tax_line;' IN v_def) = 0 THEN
    RAISE EXCEPTION 'test set-up: the store total line was not found';
  END IF;
  EXECUTE replace(v_def, 'v_store_total   := v_store_total + ROUND(v_listing.selling_price * v_qty, 2) + v_tax_line;',
                         'v_store_total   := v_store_total + ROUND(v_listing.selling_price * v_qty * 1, 2) + v_tax_line;');
END $$;
