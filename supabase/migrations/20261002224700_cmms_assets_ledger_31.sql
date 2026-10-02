CREATE OR REPLACE FUNCTION public.fn_cmms_transfer_stock_supermarket(
  p_item_id UUID, p_quantity NUMERIC, p_direction TEXT DEFAULT 'to_shop', p_note TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item public.cmms_inventory_items%ROWTYPE; v_sm UUID; v_rows INT; v_avail NUMERIC;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be greater than zero'; END IF;
  IF p_direction NOT IN ('to_shop', 'to_store') THEN RAISE EXCEPTION 'Direction must be to_shop or to_store'; END IF;
  SELECT * INTO v_item FROM public.cmms_inventory_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item not found'; END IF;
  IF NOT public._cmms_can_manage_inventory(v_item.cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to move this stock';
  END IF;
  IF v_item.linked_product_id IS NULL THEN RAISE EXCEPTION 'Link this item to a supermarket product first'; END IF;
  SELECT supermarket_id INTO v_sm FROM public.cmms_company_profiles WHERE id = v_item.cmms_company_id;
  IF v_sm IS DISTINCT FROM v_item.linked_supermarket_id THEN
    RAISE EXCEPTION 'The branch is no longer linked to this item''s supermarket';
  END IF;
  IF p_direction = 'to_shop' THEN
    IF p_quantity > v_item.quantity_in_stock THEN
      RAISE EXCEPTION 'Only % in the store room', v_item.quantity_in_stock;
    END IF;
    EXECUTE 'UPDATE public.inventory SET current_stock = COALESCE(current_stock, 0) + $1, updated_at = now()
             WHERE product_id = $2 AND supermarket_id = $3' USING p_quantity, v_item.linked_product_id, v_sm;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN RAISE EXCEPTION 'That product has no stock record in the supermarket yet'; END IF;
  ELSE
    EXECUTE 'SELECT GREATEST(COALESCE(current_stock - COALESCE(reserved_stock, 0), 0), 0)
             FROM public.inventory WHERE product_id = $1 AND supermarket_id = $2 FOR UPDATE'
      INTO v_avail USING v_item.linked_product_id, v_sm;
    IF v_avail IS NULL THEN RAISE EXCEPTION 'That product has no stock record in the supermarket yet'; END IF;
    IF p_quantity > v_avail THEN RAISE EXCEPTION 'Only % available on the shop floor', v_avail; END IF;
    EXECUTE 'UPDATE public.inventory SET current_stock = current_stock - $1, updated_at = now()
             WHERE product_id = $2 AND supermarket_id = $3' USING p_quantity, v_item.linked_product_id, v_sm;
  END IF;
  PERFORM set_config('cmms.txn_type', CASE WHEN p_direction = 'to_shop' THEN 'transfer_out' ELSE 'transfer_in' END, TRUE);
  PERFORM set_config('cmms.txn_reference_type', 'supermarket_transfer', TRUE);
  PERFORM set_config('cmms.txn_supermarket_id', v_sm::TEXT, TRUE);
  PERFORM set_config('cmms.txn_product_id', v_item.linked_product_id::TEXT, TRUE);
  PERFORM set_config('cmms.txn_counterparty', 'Supermarket shop floor', TRUE);
  PERFORM set_config('cmms.txn_notes', COALESCE(p_note, CASE WHEN p_direction = 'to_shop'
        THEN 'Stock sent to the shop floor' ELSE 'Stock returned to the store room' END), TRUE);
  UPDATE public.cmms_inventory_items
  SET quantity_in_stock = quantity_in_stock + CASE WHEN p_direction = 'to_shop' THEN -p_quantity ELSE p_quantity END,
      updated_at = NOW()
  WHERE id = p_item_id;
  PERFORM set_config('cmms.txn_type', '', TRUE);
  PERFORM set_config('cmms.txn_reference_type', '', TRUE);
  PERFORM set_config('cmms.txn_supermarket_id', '', TRUE);
  PERFORM set_config('cmms.txn_product_id', '', TRUE);
  PERFORM set_config('cmms.txn_counterparty', '', TRUE);
  PERFORM set_config('cmms.txn_notes', '', TRUE);
  RETURN jsonb_build_object('ok', TRUE, 'direction', p_direction, 'quantity', p_quantity);
END;
$$;
