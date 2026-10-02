CREATE OR REPLACE FUNCTION public.fn_cmms_get_linked_supermarket(p_company_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sm UUID; v_out JSONB;
BEGIN
  IF NOT public._cmms_can_view_company(p_company_id) THEN RAISE EXCEPTION 'You do not have access to this branch'; END IF;
  SELECT supermarket_id INTO v_sm FROM public.cmms_company_profiles WHERE id = p_company_id;
  IF v_sm IS NULL OR to_regclass('public.supermarkets') IS NULL THEN RETURN NULL; END IF;
  EXECUTE $q$
    SELECT jsonb_build_object('id', s.id, 'name', s.name, 'city', s.city, 'country', s.country,
                              'status', s.status, 'slug', s.slug)
    FROM public.supermarkets s WHERE s.id = $1
  $q$ INTO v_out USING v_sm;
  RETURN v_out;
END;
$$;
CREATE OR REPLACE FUNCTION public.fn_cmms_search_supermarket_products(p_company_id UUID, p_query TEXT DEFAULT NULL)
RETURNS TABLE (product_id UUID, name TEXT, sku TEXT, barcode TEXT, selling_price NUMERIC, current_stock NUMERIC, available_stock NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sm UUID;
BEGIN
  IF NOT public._cmms_can_view_company(p_company_id) THEN RAISE EXCEPTION 'You do not have access to this branch'; END IF;
  SELECT supermarket_id INTO v_sm FROM public.cmms_company_profiles WHERE id = p_company_id;
  IF v_sm IS NULL THEN RAISE EXCEPTION 'Link a supermarket to this branch first'; END IF;
  RETURN QUERY EXECUTE $q$
    SELECT p.id, p.name::TEXT, p.sku::TEXT, p.barcode::TEXT, p.selling_price::NUMERIC,
           COALESCE(inv.current_stock, 0)::NUMERIC,
           GREATEST(COALESCE(inv.current_stock - COALESCE(inv.reserved_stock, 0), 0), 0)::NUMERIC
    FROM public.products p
    LEFT JOIN public.inventory inv ON inv.product_id = p.id AND inv.supermarket_id = p.supermarket_id
    WHERE p.supermarket_id = $1 AND (p.is_active IS NULL OR p.is_active = TRUE)
      AND ($2 IS NULL OR $2 = '' OR p.name ILIKE '%' || $2 || '%' OR p.sku ILIKE '%' || $2 || '%' OR p.barcode = $2)
    ORDER BY p.name LIMIT 50
  $q$ USING v_sm, p_query;
END;
$$;
