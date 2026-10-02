CREATE OR REPLACE FUNCTION public.fn_cmms_get_company_inventory(p_company_id uuid)
RETURNS SETOF public.cmms_inventory_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Company ID is required';
  END IF;
  RETURN QUERY
  SELECT i.* FROM public.cmms_inventory_items i
  WHERE i.cmms_company_id = p_company_id AND i.is_active = TRUE
  ORDER BY i.item_code ASC;
END;
$$;
ALTER FUNCTION public.fn_cmms_get_company_inventory(uuid) SET row_security = OFF;
GRANT EXECUTE ON FUNCTION public.fn_cmms_get_company_inventory(uuid) TO authenticated;

