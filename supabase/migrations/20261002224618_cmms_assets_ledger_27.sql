CREATE OR REPLACE FUNCTION public.fn_cmms_set_group_fx_rate(
  p_group_id UUID, p_currency TEXT, p_rate_to_base NUMERIC, p_effective_from DATE DEFAULT CURRENT_DATE
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._cmms_is_group_hq_admin(p_group_id) THEN
    RAISE EXCEPTION 'Only the head-office administrator can set exchange rates';
  END IF;
  IF p_rate_to_base IS NULL OR p_rate_to_base <= 0 THEN RAISE EXCEPTION 'Rate must be greater than zero'; END IF;
  INSERT INTO public.cmms_group_fx_rates (group_id, currency, rate_to_base, effective_from, created_by)
  VALUES (p_group_id, upper(btrim(p_currency)), p_rate_to_base, COALESCE(p_effective_from, CURRENT_DATE), auth.uid())
  ON CONFLICT (group_id, currency, effective_from) DO UPDATE SET rate_to_base = EXCLUDED.rate_to_base;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
CREATE OR REPLACE FUNCTION public.fn_cmms_get_my_business_group(p_company_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_group UUID; v_is_hq BOOLEAN; v_out JSONB;
BEGIN
  IF NOT public._cmms_can_view_company(p_company_id) THEN
    RAISE EXCEPTION 'You do not have access to this branch';
  END IF;
  SELECT group_id INTO v_group FROM public.cmms_company_profiles WHERE id = p_company_id;
  IF v_group IS NULL THEN
    RETURN jsonb_build_object('group', NULL, 'branches', '[]'::JSONB, 'fx_rates', '[]'::JSONB, 'is_hq_admin', FALSE);
  END IF;
  v_is_hq := public._cmms_is_group_hq_admin(v_group);
  SELECT jsonb_build_object(
    'group', (SELECT to_jsonb(g) FROM public.cmms_business_groups g WHERE g.id = v_group),
    'is_hq_admin', v_is_hq,
    'branches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'company_id', c.id, 'company_name', c.company_name,
        'branch_name', COALESCE(c.branch_name, c.company_name), 'branch_code', c.branch_code,
        'country', c.country, 'currency', c.currency, 'timezone', c.timezone,
        'is_headquarters', c.is_headquarters, 'supermarket_id', c.supermarket_id,
        'is_current', c.id = p_company_id)
        ORDER BY c.is_headquarters DESC, COALESCE(c.branch_name, c.company_name))
      FROM public.cmms_company_profiles c
      WHERE c.group_id = v_group AND (v_is_hq OR c.id = p_company_id)), '[]'::JSONB),
    'fx_rates', COALESCE((
      SELECT jsonb_agg(to_jsonb(f) ORDER BY f.currency, f.effective_from DESC)
      FROM public.cmms_group_fx_rates f WHERE f.group_id = v_group AND v_is_hq), '[]'::JSONB)
  ) INTO v_out;
  RETURN v_out;
END;
$$;
