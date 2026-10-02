CREATE OR REPLACE FUNCTION public.fn_cmms_set_item_quantity(
  p_item_id UUID, p_new_quantity NUMERIC, p_reason TEXT DEFAULT NULL, p_is_purchase BOOLEAN DEFAULT TRUE
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item public.cmms_inventory_items%ROWTYPE; v_purchase BOOLEAN; v_row public.cmms_inventory_items;
BEGIN
  SELECT * INTO v_item FROM public.cmms_inventory_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item not found'; END IF;
  IF NOT public._cmms_can_manage_inventory(v_item.cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to change this stock';
  END IF;
  IF p_new_quantity IS NULL OR p_new_quantity < 0 THEN RAISE EXCEPTION 'Quantity cannot be negative'; END IF;
  v_purchase := COALESCE(p_is_purchase, TRUE) AND p_new_quantity > v_item.quantity_in_stock;
  PERFORM set_config('cmms.txn_type', CASE WHEN v_purchase THEN 'restock' ELSE 'adjustment' END, TRUE);
  PERFORM set_config('cmms.txn_reference_type', CASE WHEN v_purchase THEN 'purchase' ELSE 'manual_count' END, TRUE);
  PERFORM set_config('cmms.txn_notes', COALESCE(p_reason, ''), TRUE);
  UPDATE public.cmms_inventory_items
  SET quantity_in_stock = p_new_quantity, last_stock_check = NOW(), updated_at = NOW()
  WHERE id = p_item_id RETURNING * INTO v_row;
  PERFORM set_config('cmms.txn_type', '', TRUE);
  PERFORM set_config('cmms.txn_reference_type', '', TRUE);
  PERFORM set_config('cmms.txn_notes', '', TRUE);
  RETURN to_jsonb(v_row);
END;
$$;
CREATE OR REPLACE FUNCTION public.fn_cmms_unposted_money_entries(p_company_id UUID)
RETURNS TABLE (txn_id UUID, txn_date TIMESTAMPTZ, txn_type VARCHAR, item_name VARCHAR, amount NUMERIC, currency VARCHAR, reason TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._cmms_can_view_company(p_company_id) THEN RAISE EXCEPTION 'You do not have access to this branch'; END IF;
  RETURN QUERY
  SELECT t.id, t.txn_date, t.txn_type, t.item_name, s.m_amount, t.currency,
         CASE WHEN t.ican_transaction_id IS NULL THEN 'not booked yet'
              ELSE 'booked row no longer exists' END
  FROM public.cmms_inventory_transactions t
  CROSS JOIN LATERAL public._cmms_money_spec(t) s
  WHERE t.cmms_company_id = p_company_id AND s.m_feed
    AND (t.ican_transaction_id IS NULL
         OR (to_regclass('public.ican_transactions') IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM public.ican_transactions x WHERE x.id = t.ican_transaction_id)))
  ORDER BY t.txn_date;
END;
$$;
