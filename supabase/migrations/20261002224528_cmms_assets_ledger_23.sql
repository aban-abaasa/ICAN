CREATE OR REPLACE FUNCTION public.fn_cmms_inventory_reconciliation(p_company_id UUID)
RETURNS TABLE (item_id UUID, item_code VARCHAR, item_name VARCHAR, item_kind VARCHAR,
               stock_quantity NUMERIC, ledger_quantity NUMERIC, variance NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._cmms_can_view_company(p_company_id) THEN
    RAISE EXCEPTION 'You do not have access to this branch';
  END IF;
  RETURN QUERY
  SELECT i.id, i.item_code, i.item_name, i.item_kind, i.quantity_in_stock,
         COALESCE(SUM(t.quantity), 0), i.quantity_in_stock - COALESCE(SUM(t.quantity), 0)
  FROM public.cmms_inventory_items i
  LEFT JOIN public.cmms_inventory_transactions t ON t.item_id = i.id
  WHERE i.cmms_company_id = p_company_id AND i.is_active
  GROUP BY i.id
  HAVING i.quantity_in_stock - COALESCE(SUM(t.quantity), 0) <> 0
  ORDER BY ABS(i.quantity_in_stock - COALESCE(SUM(t.quantity), 0)) DESC;
END;
$$;
