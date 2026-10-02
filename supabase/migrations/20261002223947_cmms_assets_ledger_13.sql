INSERT INTO public.cmms_inventory_transactions (
  cmms_company_id, group_id, item_id, item_code, item_name, item_kind, item_category, txn_type,
  quantity, balance_after, unit_cost, amount, currency, fx_rate_to_base, fx_rate_source, amount_base,
  txn_date, fiscal_year, department_id, branch_name, branch_country, reference_type, notes, metadata
)
SELECT
  i.cmms_company_id, c.group_id, i.id, i.item_code, i.item_name, i.item_kind, i.category, 'opening',
  i.quantity_in_stock, i.quantity_in_stock,
  COALESCE(CASE WHEN i.item_kind = 'asset' THEN i.acquisition_cost END, i.unit_price, 0),
  ROUND(i.quantity_in_stock * COALESCE(CASE WHEN i.item_kind = 'asset' THEN i.acquisition_cost END, i.unit_price, 0), 2),
  COALESCE(c.currency, 'UGX'), 1, 'identity',
  ROUND(i.quantity_in_stock * COALESCE(CASE WHEN i.item_kind = 'asset' THEN i.acquisition_cost END, i.unit_price, 0), 2),
  NOW(), EXTRACT(YEAR FROM NOW())::INT, i.department_id,
  COALESCE(c.branch_name, c.company_name), c.country, 'opening_balance',
  'Opening balance when the transaction ledger was switched on',
  jsonb_build_object('recorded_before_ledger', TRUE)
FROM public.cmms_inventory_items i
JOIN public.cmms_company_profiles c ON c.id = i.cmms_company_id
WHERE i.is_active = TRUE
  AND COALESCE(i.quantity_in_stock, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM public.cmms_inventory_transactions t WHERE t.item_id = i.id);
