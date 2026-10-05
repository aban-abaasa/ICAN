CREATE OR REPLACE FUNCTION public._cmms_item_ledger_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_unit NUMERIC := COALESCE(CASE WHEN NEW.item_kind = 'asset' THEN NEW.acquisition_cost END, NEW.unit_price, 0);
  v_legacy BOOLEAN := NEW.item_kind = 'asset' AND (
    (NEW.acquisition_date IS NOT NULL AND NEW.acquisition_date < date_trunc('year', NOW())::DATE)
    OR (NEW.acquisition_date IS NULL AND NEW.acquisition_year < EXTRACT(YEAR FROM NOW())::INT));
  v_when TIMESTAMPTZ := CASE
    WHEN NEW.acquisition_date IS NOT NULL THEN NEW.acquisition_date::TIMESTAMPTZ
    WHEN v_legacy THEN make_date(NEW.acquisition_year, 12, 31)::TIMESTAMPTZ
    ELSE NOW() END;
BEGIN
  IF COALESCE(NEW.quantity_in_stock, 0) > 0 THEN
    PERFORM public._cmms_write_inventory_txn(
      NEW, COALESCE(public._cmms_guc('cmms.txn_type'), CASE WHEN v_legacy THEN 'opening' ELSE 'purchase' END),
      NEW.quantity_in_stock, v_unit, NEW.quantity_in_stock * v_unit, v_when,
      COALESCE(public._cmms_guc('cmms.txn_reference_type'), CASE WHEN v_legacy THEN 'legacy_asset' ELSE 'manual' END),
      public._cmms_guc('cmms.txn_reference_no'), NEW.supplier_name,
      COALESCE(public._cmms_guc('cmms.txn_notes'),
               CASE WHEN v_legacy THEN 'Asset already owned, brought into the register' ELSE 'Item added to stock records' END),
      '{}'::JSONB
    );
  END IF;
  RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public._cmms_item_ledger_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_delta NUMERIC := COALESCE(NEW.quantity_in_stock, 0) - COALESCE(OLD.quantity_in_stock, 0);
  v_unit  NUMERIC := COALESCE(NULLIF(public._cmms_guc('cmms.txn_unit_cost'), '')::NUMERIC,
                              CASE WHEN NEW.item_kind = 'asset' THEN NEW.acquisition_cost END,
                              NEW.unit_price, 0);
  v_type  TEXT;
BEGIN
  IF v_delta = 0 THEN RETURN NULL; END IF;
  v_type := COALESCE(public._cmms_guc('cmms.txn_type'), CASE WHEN v_delta > 0 THEN 'restock' ELSE 'issue' END);
  PERFORM public._cmms_write_inventory_txn(
    NEW, v_type, v_delta, v_unit, ABS(v_delta) * v_unit, NOW(),
    public._cmms_guc('cmms.txn_reference_type'), public._cmms_guc('cmms.txn_reference_no'),
    public._cmms_guc('cmms.txn_counterparty'), public._cmms_guc('cmms.txn_notes'),
    COALESCE(public._cmms_guc('cmms.txn_meta')::JSONB, '{}'::JSONB),
    public._cmms_guc('cmms.txn_supermarket_id')::UUID, public._cmms_guc('cmms.txn_product_id')::UUID
  );
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_cmms_item_ledger_insert
  AFTER INSERT ON public.cmms_inventory_items
  FOR EACH ROW EXECUTE FUNCTION public._cmms_item_ledger_insert();
CREATE TRIGGER trg_cmms_item_ledger_update
  AFTER UPDATE OF quantity_in_stock ON public.cmms_inventory_items
  FOR EACH ROW WHEN (OLD.quantity_in_stock IS DISTINCT FROM NEW.quantity_in_stock)
  EXECUTE FUNCTION public._cmms_item_ledger_update();
