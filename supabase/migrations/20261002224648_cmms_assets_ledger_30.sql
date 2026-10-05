CREATE OR REPLACE FUNCTION public.fn_cmms_link_item_to_product(p_item_id UUID, p_product_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item public.cmms_inventory_items%ROWTYPE; v_sm UUID; v_ok BOOLEAN;
BEGIN
  SELECT * INTO v_item FROM public.cmms_inventory_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item not found'; END IF;
  IF NOT public._cmms_can_manage_inventory(v_item.cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to change this item';
  END IF;
  IF v_item.item_kind <> 'consumable' THEN RAISE EXCEPTION 'Only consumables can be linked to shop stock'; END IF;
  IF p_product_id IS NULL THEN
    UPDATE public.cmms_inventory_items SET linked_supermarket_id = NULL, linked_product_id = NULL, updated_at = NOW() WHERE id = p_item_id;
    RETURN jsonb_build_object('ok', TRUE);
  END IF;
  SELECT supermarket_id INTO v_sm FROM public.cmms_company_profiles WHERE id = v_item.cmms_company_id;
  IF v_sm IS NULL THEN RAISE EXCEPTION 'Link a supermarket to this branch first'; END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.products p WHERE p.id = $1 AND p.supermarket_id = $2)'
    INTO v_ok USING p_product_id, v_sm;
  IF NOT v_ok THEN RAISE EXCEPTION 'That product does not belong to the linked supermarket'; END IF;
  UPDATE public.cmms_inventory_items SET linked_supermarket_id = v_sm, linked_product_id = p_product_id, updated_at = NOW()
  WHERE id = p_item_id;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
CREATE OR REPLACE FUNCTION public.fn_cmms_get_supermarket_stock_link(p_company_id UUID)
RETURNS TABLE (item_id UUID, item_code VARCHAR, item_name VARCHAR, store_quantity NUMERIC,
               product_id UUID, product_name TEXT, shop_quantity NUMERIC, shop_available NUMERIC, shop_price NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._cmms_can_view_company(p_company_id) THEN RAISE EXCEPTION 'You do not have access to this branch'; END IF;
  RETURN QUERY EXECUTE $q$
    SELECT i.id, i.item_code, i.item_name, i.quantity_in_stock,
           p.id, p.name::TEXT, COALESCE(inv.current_stock, 0)::NUMERIC,
           GREATEST(COALESCE(inv.current_stock - COALESCE(inv.reserved_stock, 0), 0), 0)::NUMERIC,
           p.selling_price::NUMERIC
    FROM public.cmms_inventory_items i
    JOIN public.products p ON p.id = i.linked_product_id
    LEFT JOIN public.inventory inv ON inv.product_id = p.id AND inv.supermarket_id = p.supermarket_id
    WHERE i.cmms_company_id = $1 AND i.is_active AND i.linked_product_id IS NOT NULL
    ORDER BY i.item_name
  $q$ USING p_company_id;
END;
$$;
