CREATE OR REPLACE FUNCTION public.fn_cmms_list_my_supermarkets()
RETURNS TABLE (id UUID, name TEXT, city TEXT, country TEXT, status TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF to_regclass('public.supermarkets') IS NULL THEN RETURN; END IF;
  RETURN QUERY EXECUTE $q$
    SELECT s.id, s.name::TEXT, s.city::TEXT, s.country::TEXT, s.status::TEXT
    FROM public.supermarkets s
    WHERE s.owner_user_id = auth.uid()
       OR EXISTS (SELECT 1 FROM public.supermarket_staff m
                  WHERE m.supermarket_id = s.id AND m.user_id = auth.uid()
                    AND m.role = 'manager' AND m.status = 'active')
    ORDER BY s.name
  $q$;
END;
$$;
CREATE OR REPLACE FUNCTION public.fn_cmms_link_supermarket(p_company_id UUID, p_supermarket_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ok BOOLEAN;
BEGIN
  IF NOT public._cmms_is_company_admin(p_company_id) THEN
    RAISE EXCEPTION 'Only the branch administrator can link a supermarket';
  END IF;
  IF to_regclass('public.supermarkets') IS NULL THEN
    RAISE EXCEPTION 'The supermarket platform is not installed in this database';
  END IF;
  EXECUTE $q$
    SELECT EXISTS (SELECT 1 FROM public.supermarkets s WHERE s.id = $1 AND (
      s.owner_user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.supermarket_staff m WHERE m.supermarket_id = s.id
                 AND m.user_id = auth.uid() AND m.role = 'manager' AND m.status = 'active')))
  $q$ INTO v_ok USING p_supermarket_id;
  IF NOT v_ok THEN RAISE EXCEPTION 'You are not an owner or manager of that supermarket'; END IF;
  UPDATE public.cmms_company_profiles SET supermarket_id = p_supermarket_id, updated_at = NOW() WHERE id = p_company_id;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
CREATE OR REPLACE FUNCTION public.fn_cmms_unlink_supermarket(p_company_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._cmms_is_company_admin(p_company_id) THEN
    RAISE EXCEPTION 'Only the branch administrator can unlink the supermarket';
  END IF;
  UPDATE public.cmms_company_profiles SET supermarket_id = NULL, updated_at = NOW() WHERE id = p_company_id;
  UPDATE public.cmms_inventory_items SET linked_supermarket_id = NULL, linked_product_id = NULL
  WHERE cmms_company_id = p_company_id AND linked_product_id IS NOT NULL;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
