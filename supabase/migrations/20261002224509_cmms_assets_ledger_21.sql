CREATE OR REPLACE FUNCTION public.fn_cmms_dispose_asset(
  p_item_id UUID, p_quantity NUMERIC DEFAULT NULL, p_proceeds NUMERIC DEFAULT 0, p_reason TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item public.cmms_inventory_items%ROWTYPE;
  v_qty NUMERIC; v_nbv_unit NUMERIC; v_year INT := EXTRACT(YEAR FROM NOW())::INT;
BEGIN
  SELECT * INTO v_item FROM public.cmms_inventory_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND OR v_item.item_kind <> 'asset' THEN RAISE EXCEPTION 'Asset not found'; END IF;
  IF NOT public._cmms_can_manage_inventory(v_item.cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to dispose of assets';
  END IF;
  v_qty := COALESCE(p_quantity, v_item.quantity_in_stock);
  IF v_qty <= 0 OR v_qty > v_item.quantity_in_stock THEN
    RAISE EXCEPTION 'Quantity must be between 1 and % ', v_item.quantity_in_stock;
  END IF;
  v_nbv_unit := GREATEST(0, COALESCE(v_item.acquisition_cost, v_item.unit_price, 0)
    - public.fn_cmms_accum_depreciation(v_item.acquisition_cost, v_item.salvage_value, v_item.useful_life_years,
                                        v_item.depreciation_method, v_item.acquisition_year, v_year));
  PERFORM set_config('cmms.txn_type', 'disposal', TRUE);
  PERFORM set_config('cmms.txn_unit_cost', v_nbv_unit::TEXT, TRUE);
  PERFORM set_config('cmms.txn_reference_type', 'asset_disposal', TRUE);
  PERFORM set_config('cmms.txn_notes', COALESCE(p_reason, 'Asset disposed'), TRUE);
  PERFORM set_config('cmms.txn_meta', jsonb_build_object(
    'proceeds', COALESCE(p_proceeds, 0), 'nbv_removed', ROUND(v_nbv_unit * v_qty, 2),
    'gain_loss', ROUND(COALESCE(p_proceeds, 0) - v_nbv_unit * v_qty, 2))::TEXT, TRUE);
  UPDATE public.cmms_inventory_items
  SET quantity_in_stock = quantity_in_stock - v_qty,
      asset_status = CASE WHEN quantity_in_stock - v_qty <= 0 THEN 'disposed' ELSE asset_status END,
      disposed_at  = CASE WHEN quantity_in_stock - v_qty <= 0 THEN NOW() ELSE disposed_at END,
      updated_at = NOW()
  WHERE id = p_item_id;
  PERFORM set_config('cmms.txn_type', '', TRUE);
  PERFORM set_config('cmms.txn_unit_cost', '', TRUE);
  PERFORM set_config('cmms.txn_reference_type', '', TRUE);
  PERFORM set_config('cmms.txn_notes', '', TRUE);
  PERFORM set_config('cmms.txn_meta', '', TRUE);
  RETURN jsonb_build_object('quantity_disposed', v_qty, 'nbv_removed', ROUND(v_nbv_unit * v_qty, 2),
                            'proceeds', COALESCE(p_proceeds, 0),
                            'gain_loss', ROUND(COALESCE(p_proceeds, 0) - v_nbv_unit * v_qty, 2));
END;
$$;
