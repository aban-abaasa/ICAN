CREATE OR REPLACE FUNCTION public.fn_cmms_post_asset_depreciation(p_company_id UUID, p_year INT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_year INT := COALESCE(p_year, EXTRACT(YEAR FROM NOW())::INT);
  v_item public.cmms_inventory_items%ROWTYPE;
  v_dep NUMERIC; v_posted INT := 0; v_total NUMERIC := 0; v_id UUID;
BEGIN
  IF NOT public._cmms_can_manage_inventory(p_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to post depreciation';
  END IF;
  IF v_year > EXTRACT(YEAR FROM NOW())::INT THEN
    RAISE EXCEPTION 'Cannot post depreciation for a future year';
  END IF;
  FOR v_item IN
    SELECT * FROM public.cmms_inventory_items
    WHERE cmms_company_id = p_company_id AND is_active AND item_kind = 'asset'
      AND COALESCE(asset_status, 'in_service') <> 'disposed'
      AND COALESCE(quantity_in_stock, 0) > 0
      AND COALESCE(depreciation_method, 'straight_line') <> 'none'
      AND acquisition_year IS NOT NULL AND acquisition_year <= v_year
  LOOP
    v_dep := ROUND(
      (public.fn_cmms_accum_depreciation(v_item.acquisition_cost, v_item.salvage_value, v_item.useful_life_years,
                                         v_item.depreciation_method, v_item.acquisition_year, v_year)
     - public.fn_cmms_accum_depreciation(v_item.acquisition_cost, v_item.salvage_value, v_item.useful_life_years,
                                         v_item.depreciation_method, v_item.acquisition_year, v_year - 1))
      * v_item.quantity_in_stock, 2);
    CONTINUE WHEN v_dep <= 0;
    BEGIN
      v_id := public._cmms_write_inventory_txn(
        v_item, 'depreciation', 0, v_item.acquisition_cost, v_dep,
        make_date(v_year, 12, 31)::TIMESTAMPTZ, 'depreciation_run', v_year::TEXT, NULL,
        format('Depreciation %s (%s)', v_year, v_item.depreciation_method),
        jsonb_build_object('method', v_item.depreciation_method, 'life_years', v_item.useful_life_years,
                           'acquisition_year', v_item.acquisition_year)
      );
      v_posted := v_posted + 1; v_total := v_total + v_dep;
    EXCEPTION WHEN unique_violation THEN
      NULL;   -- already posted for this item and year
    END;
  END LOOP;
  RETURN jsonb_build_object('year', v_year, 'items_posted', v_posted, 'total_depreciation', v_total);
END;
$$;
