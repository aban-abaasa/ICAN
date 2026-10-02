CREATE OR REPLACE FUNCTION public.fn_cmms_get_asset_register(p_company_id UUID, p_as_of_year INT DEFAULT NULL)
RETURNS TABLE (
  id UUID, item_code VARCHAR, item_name VARCHAR, category VARCHAR, department_id UUID,
  quantity NUMERIC, unit_cost NUMERIC, total_cost NUMERIC, salvage_value NUMERIC,
  acquisition_year INT, acquisition_date DATE, manufacture_year INT, age_years INT,
  useful_life_years INT, depreciation_method VARCHAR,
  accumulated_depreciation NUMERIC, net_book_value NUMERIC, depreciation_this_year NUMERIC,
  fully_depreciated BOOLEAN, asset_tag VARCHAR, serial_number VARCHAR, manufacturer VARCHAR, model VARCHAR,
  asset_condition VARCHAR, asset_status VARCHAR, warranty_expiry DATE, storage_location VARCHAR,
  supplier_name VARCHAR, currency VARCHAR
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_year INT := COALESCE(p_as_of_year, EXTRACT(YEAR FROM NOW())::INT);
BEGIN
  IF NOT public._cmms_can_view_company(p_company_id) THEN
    RAISE EXCEPTION 'You do not have access to this branch';
  END IF;
  RETURN QUERY
  SELECT i.id, i.item_code, i.item_name, i.category, i.department_id,
    i.quantity_in_stock,
    COALESCE(i.acquisition_cost, i.unit_price, 0),
    ROUND(COALESCE(i.acquisition_cost, i.unit_price, 0) * i.quantity_in_stock, 2),
    COALESCE(i.salvage_value, 0),
    i.acquisition_year, i.acquisition_date, i.manufacture_year,
    CASE WHEN i.acquisition_year IS NULL THEN NULL ELSE GREATEST(0, v_year - i.acquisition_year) END,
    i.useful_life_years, i.depreciation_method,
    ROUND(a.acc * i.quantity_in_stock, 2),
    ROUND((COALESCE(i.acquisition_cost, i.unit_price, 0) - a.acc) * i.quantity_in_stock, 2),
    ROUND((a.acc - a.acc_prev) * i.quantity_in_stock, 2),
    (COALESCE(i.acquisition_cost, i.unit_price, 0) - a.acc) <= COALESCE(i.salvage_value, 0) AND a.acc > 0,
    i.asset_tag, i.serial_number, i.manufacturer, i.model,
    i.asset_condition, i.asset_status, i.warranty_expiry, i.storage_location, i.supplier_name,
    c.currency
  FROM public.cmms_inventory_items i
  JOIN public.cmms_company_profiles c ON c.id = i.cmms_company_id
  CROSS JOIN LATERAL (SELECT
      public.fn_cmms_accum_depreciation(COALESCE(i.acquisition_cost, i.unit_price), i.salvage_value, i.useful_life_years,
                                        i.depreciation_method, i.acquisition_year, v_year) AS acc,
      public.fn_cmms_accum_depreciation(COALESCE(i.acquisition_cost, i.unit_price), i.salvage_value, i.useful_life_years,
                                        i.depreciation_method, i.acquisition_year, v_year - 1) AS acc_prev) a
  WHERE i.cmms_company_id = p_company_id AND i.is_active AND i.item_kind = 'asset'
    AND COALESCE(i.asset_status, 'in_service') <> 'disposed'
  ORDER BY i.acquisition_year NULLS LAST, i.item_name;
END;
$$;
