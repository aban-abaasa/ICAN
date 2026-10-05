CREATE OR REPLACE FUNCTION public.fn_cmms_set_item_details(p_item_id UUID, p_details JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item public.cmms_inventory_items%ROWTYPE;
  v_new  public.cmms_inventory_items%ROWTYPE;
  v_year INT := EXTRACT(YEAR FROM NOW())::INT;
BEGIN
  SELECT * INTO v_item FROM public.cmms_inventory_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item not found'; END IF;
  IF NOT public._cmms_can_manage_inventory(v_item.cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to change this item';
  END IF;
  IF p_details ? 'item_kind' AND p_details->>'item_kind' NOT IN ('asset', 'consumable') THEN
    RAISE EXCEPTION 'item_kind must be asset or consumable';
  END IF;
  IF p_details ? 'depreciation_method' AND NULLIF(p_details->>'depreciation_method', '') IS NOT NULL
     AND p_details->>'depreciation_method' NOT IN ('straight_line', 'declining_balance', 'none') THEN
    RAISE EXCEPTION 'Unknown depreciation method';
  END IF;
  IF p_details ? 'acquisition_year' AND NULLIF(p_details->>'acquisition_year', '') IS NOT NULL
     AND (p_details->>'acquisition_year')::INT > v_year + 1 THEN
    RAISE EXCEPTION 'Acquisition year cannot be in the future';
  END IF;
  UPDATE public.cmms_inventory_items SET
    item_kind           = COALESCE(NULLIF(p_details->>'item_kind', ''), item_kind),
    asset_tag           = CASE WHEN p_details ? 'asset_tag'           THEN NULLIF(p_details->>'asset_tag', '')           ELSE asset_tag END,
    serial_number       = CASE WHEN p_details ? 'serial_number'       THEN NULLIF(p_details->>'serial_number', '')       ELSE serial_number END,
    manufacturer        = CASE WHEN p_details ? 'manufacturer'        THEN NULLIF(p_details->>'manufacturer', '')        ELSE manufacturer END,
    model               = CASE WHEN p_details ? 'model'               THEN NULLIF(p_details->>'model', '')               ELSE model END,
    manufacture_year    = CASE WHEN p_details ? 'manufacture_year'    THEN NULLIF(p_details->>'manufacture_year', '')::INT    ELSE manufacture_year END,
    acquisition_date    = CASE WHEN p_details ? 'acquisition_date'    THEN NULLIF(p_details->>'acquisition_date', '')::DATE   ELSE acquisition_date END,
    acquisition_year    = CASE WHEN p_details ? 'acquisition_year'    THEN NULLIF(p_details->>'acquisition_year', '')::INT    ELSE acquisition_year END,
    acquisition_cost    = CASE WHEN p_details ? 'acquisition_cost'    THEN NULLIF(p_details->>'acquisition_cost', '')::NUMERIC ELSE acquisition_cost END,
    useful_life_years   = CASE WHEN p_details ? 'useful_life_years'   THEN NULLIF(p_details->>'useful_life_years', '')::INT   ELSE useful_life_years END,
    salvage_value       = CASE WHEN p_details ? 'salvage_value'       THEN COALESCE(NULLIF(p_details->>'salvage_value', '')::NUMERIC, 0) ELSE salvage_value END,
    depreciation_method = CASE WHEN p_details ? 'depreciation_method' THEN NULLIF(p_details->>'depreciation_method', '') ELSE depreciation_method END,
    asset_condition     = CASE WHEN p_details ? 'asset_condition'     THEN NULLIF(p_details->>'asset_condition', '')     ELSE asset_condition END,
    asset_status        = CASE WHEN p_details ? 'asset_status'        THEN NULLIF(p_details->>'asset_status', '')        ELSE asset_status END,
    warranty_expiry     = CASE WHEN p_details ? 'warranty_expiry'     THEN NULLIF(p_details->>'warranty_expiry', '')::DATE    ELSE warranty_expiry END,
    updated_at          = NOW()
  WHERE id = p_item_id;
  UPDATE public.cmms_inventory_items
  SET unit_price = acquisition_cost
  WHERE id = p_item_id AND item_kind = 'asset' AND acquisition_cost IS NOT NULL
        AND (p_details ? 'acquisition_cost');
  SELECT * INTO v_new FROM public.cmms_inventory_items WHERE id = p_item_id;
  RETURN to_jsonb(v_new);
END;
$$;
