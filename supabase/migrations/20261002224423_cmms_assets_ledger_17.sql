CREATE OR REPLACE FUNCTION public.fn_cmms_create_item(p_company_id UUID, p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name TEXT := NULLIF(btrim(p_payload->>'item_name'), '');
  v_dept UUID := NULLIF(p_payload->>'department_id', '')::UUID;
  v_code TEXT; v_row public.cmms_inventory_items; v_user UUID; v_try INT := 0;
BEGIN
  IF NOT public._cmms_can_manage_inventory(p_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to add inventory items';
  END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Item name is required'; END IF;
  IF v_dept IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.cmms_departments WHERE id = v_dept AND cmms_company_id = p_company_id) THEN
    RAISE EXCEPTION 'Department not found in this company';
  END IF;
  IF COALESCE(NULLIF(p_payload->>'quantity_in_stock', '')::NUMERIC, 0) < 0
     OR COALESCE(NULLIF(COALESCE(p_payload->>'unit_price', p_payload->>'unit_cost'), '')::NUMERIC, 0) < 0 THEN
    RAISE EXCEPTION 'Quantity and cost cannot be negative';
  END IF;
  v_user := public._cmms_member_user_id(p_company_id);
  v_code := COALESCE(NULLIF(btrim(p_payload->>'item_code'), ''), substr(v_name, 1, 10) || '-' || to_char(NOW(), 'MMDD'));
  WHILE EXISTS (SELECT 1 FROM public.cmms_inventory_items
                WHERE cmms_company_id = p_company_id AND item_code = v_code
                  AND department_id IS NOT DISTINCT FROM v_dept) AND v_try < 20 LOOP
    v_try := v_try + 1;
    v_code := COALESCE(NULLIF(btrim(p_payload->>'item_code'), ''), substr(v_name, 1, 10) || '-' || to_char(NOW(), 'MMDD'))
              || '-' || substr(md5(random()::TEXT), 1, 3);
  END LOOP;
  INSERT INTO public.cmms_inventory_items (
    cmms_company_id, department_id, item_name, item_code, description, category,
    quantity_in_stock, reorder_level, unit_price, supplier_name, storage_location, bin_number,
    unit_of_measure, lead_time_days, assigned_storeman_id, is_active, created_by, last_updated_by, last_stock_check,
    item_kind, asset_tag, serial_number, manufacturer, model, manufacture_year, acquisition_date, acquisition_year,
    acquisition_cost, useful_life_years, salvage_value, depreciation_method, asset_condition, asset_status, warranty_expiry
  ) VALUES (
    p_company_id, v_dept, v_name, v_code, p_payload->>'description',
    COALESCE(NULLIF(p_payload->>'category', ''), 'Spare Parts'),
    COALESCE(NULLIF(p_payload->>'quantity_in_stock', '')::NUMERIC, 0),
    COALESCE(NULLIF(COALESCE(p_payload->>'reorder_level', p_payload->>'minimum_stock_level'), '')::NUMERIC, 0),
    COALESCE(NULLIF(COALESCE(p_payload->>'unit_price', p_payload->>'unit_cost'), '')::NUMERIC, 0),
    p_payload->>'supplier_name', p_payload->>'storage_location', p_payload->>'bin_number',
    COALESCE(NULLIF(p_payload->>'unit_of_measure', ''), 'units'),
    COALESCE(NULLIF(p_payload->>'lead_time_days', '')::INT, 0),
    NULLIF(p_payload->>'assigned_storeman_id', '')::UUID, TRUE, v_user, v_user, NOW(),
    NULLIF(p_payload->>'item_kind', ''),
    NULLIF(p_payload->>'asset_tag', ''), NULLIF(p_payload->>'serial_number', ''),
    NULLIF(p_payload->>'manufacturer', ''), NULLIF(p_payload->>'model', ''),
    NULLIF(p_payload->>'manufacture_year', '')::INT, NULLIF(p_payload->>'acquisition_date', '')::DATE,
    NULLIF(p_payload->>'acquisition_year', '')::INT, NULLIF(p_payload->>'acquisition_cost', '')::NUMERIC,
    NULLIF(p_payload->>'useful_life_years', '')::INT, COALESCE(NULLIF(p_payload->>'salvage_value', '')::NUMERIC, 0),
    NULLIF(p_payload->>'depreciation_method', ''), NULLIF(p_payload->>'asset_condition', ''),
    NULLIF(p_payload->>'asset_status', ''), NULLIF(p_payload->>'warranty_expiry', '')::DATE
  ) RETURNING * INTO v_row;
  IF v_row.item_kind = 'asset' AND v_row.acquisition_cost IS NOT NULL AND v_row.unit_price IS DISTINCT FROM v_row.acquisition_cost THEN
    UPDATE public.cmms_inventory_items SET unit_price = acquisition_cost WHERE id = v_row.id RETURNING * INTO v_row;
  END IF;
  RETURN to_jsonb(v_row);
END;
$$;
