CREATE OR REPLACE FUNCTION public._cmms_item_ledger_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_delta NUMERIC := COALESCE(NEW.quantity_in_stock, 0) - COALESCE(OLD.quantity_in_stock, 0);
  v_unit  NUMERIC := COALESCE(NULLIF(public._cmms_guc('cmms.txn_unit_cost'), '')::NUMERIC,
                              CASE WHEN NEW.item_kind = 'asset' THEN NEW.acquisition_cost END,
                              NEW.unit_price, 0);
  v_type  TEXT;
  v_ref   TEXT;
  v_ctx   TEXT;
BEGIN
  IF v_delta = 0 THEN RETURN NULL; END IF;
  GET DIAGNOSTICS v_ctx = PG_CONTEXT;
  IF v_ctx LIKE '%function fn_checkout_inventory_item(%' THEN
    v_type := 'issue';      v_ref := 'staff_custody';
  ELSIF v_ctx LIKE '%function fn_return_inventory_item(%' THEN
    v_type := 'restock';    v_ref := 'staff_custody';
  ELSIF v_ctx LIKE '%function fn_update_inventory_item(%' THEN
    v_type := 'adjustment'; v_ref := 'manual_edit';
  END IF;
  v_type := COALESCE(public._cmms_guc('cmms.txn_type'), v_type, CASE WHEN v_delta > 0 THEN 'restock' ELSE 'issue' END);
  v_ref  := COALESCE(public._cmms_guc('cmms.txn_reference_type'), v_ref);

  PERFORM public._cmms_write_inventory_txn(
    NEW, v_type, v_delta, v_unit, ABS(v_delta) * v_unit, NOW(),
    v_ref, public._cmms_guc('cmms.txn_reference_no'),
    public._cmms_guc('cmms.txn_counterparty'), public._cmms_guc('cmms.txn_notes'),
    COALESCE(public._cmms_guc('cmms.txn_meta')::JSONB, '{}'::JSONB),
    public._cmms_guc('cmms.txn_supermarket_id')::UUID, public._cmms_guc('cmms.txn_product_id')::UUID
  );
  RETURN NULL;
END;
$$;
