DO $$
BEGIN
  UPDATE public.cmms_inventory_items
  SET item_kind = public._cmms_kind_from_category(category)
  WHERE item_kind IS NULL;
  UPDATE public.cmms_inventory_items
  SET acquisition_year     = COALESCE(acquisition_year, EXTRACT(YEAR FROM COALESCE(acquisition_date, created_at, NOW()))::INT),
      acquisition_cost     = COALESCE(acquisition_cost, unit_price),
      useful_life_years    = COALESCE(useful_life_years, 5),
      depreciation_method  = COALESCE(depreciation_method, 'straight_line'),
      asset_condition      = COALESCE(asset_condition, 'good'),
      asset_status         = COALESCE(asset_status, 'in_service')
  WHERE item_kind = 'asset';
END $$;
