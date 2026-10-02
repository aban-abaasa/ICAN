CREATE OR REPLACE FUNCTION public.fn_cmms_inventory_report(
  p_company_id UUID, p_year INT DEFAULT NULL, p_scope TEXT DEFAULT 'branch'
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_year INT := COALESCE(p_year, EXTRACT(YEAR FROM NOW())::INT);
  v_group UUID; v_base TEXT; v_branches JSONB := '[]'::JSONB; v_totals JSONB;
  v_ids UUID[];
BEGIN
  SELECT c.group_id INTO v_group FROM public.cmms_company_profiles c WHERE c.id = p_company_id;
  SELECT g.base_currency INTO v_base FROM public.cmms_business_groups g WHERE g.id = v_group;
  IF p_scope = 'group' AND v_group IS NOT NULL THEN
    IF NOT public._cmms_is_group_hq_admin(v_group) THEN
      RAISE EXCEPTION 'Only the head office can read the whole business';
    END IF;
    SELECT array_agg(c.id) INTO v_ids FROM public.cmms_company_profiles c WHERE c.group_id = v_group;
  ELSE
    IF NOT public._cmms_can_view_company(p_company_id) THEN
      RAISE EXCEPTION 'You do not have access to this branch';
    END IF;
    v_ids := ARRAY[p_company_id];
  END IF;
  SELECT COALESCE(jsonb_agg(b ORDER BY (b->>'is_headquarters')::BOOLEAN DESC, b->>'branch_name'), '[]'::JSONB)
  INTO v_branches
  FROM (
    SELECT jsonb_build_object(
      'company_id', c.id,
      'branch_name', COALESCE(c.branch_name, c.company_name),
      'branch_code', c.branch_code, 'country', c.country, 'currency', c.currency,
      'is_headquarters', c.is_headquarters,
      'fx_rate_to_base', (SELECT rate FROM public._cmms_fx_rate(c.id, make_date(v_year, 12, 31))),
      'fx_source', (SELECT source FROM public._cmms_fx_rate(c.id, make_date(v_year, 12, 31))),
      'assets', (
        SELECT jsonb_build_object(
          'count', COALESCE(SUM(i.quantity_in_stock), 0),
          'cost', COALESCE(ROUND(SUM(COALESCE(i.acquisition_cost, i.unit_price, 0) * i.quantity_in_stock), 2), 0),
          'accumulated_depreciation', COALESCE(ROUND(SUM(a.acc * i.quantity_in_stock), 2), 0),
          'net_book_value', COALESCE(ROUND(SUM((COALESCE(i.acquisition_cost, i.unit_price, 0) - a.acc) * i.quantity_in_stock), 2), 0))
        FROM public.cmms_inventory_items i
        CROSS JOIN LATERAL (SELECT public.fn_cmms_accum_depreciation(COALESCE(i.acquisition_cost, i.unit_price),
              i.salvage_value, i.useful_life_years, i.depreciation_method, i.acquisition_year, v_year) AS acc) a
        WHERE i.cmms_company_id = c.id AND i.is_active AND i.item_kind = 'asset'
          AND COALESCE(i.asset_status, 'in_service') <> 'disposed'),
      'consumables', (
        SELECT jsonb_build_object(
          'items', COUNT(*),
          'value', COALESCE(ROUND(SUM(i.quantity_in_stock * COALESCE(i.unit_price, 0)), 2), 0),
          'low_stock', COUNT(*) FILTER (WHERE i.quantity_in_stock <= COALESCE(i.reorder_level, 0)))
        FROM public.cmms_inventory_items i
        WHERE i.cmms_company_id = c.id AND i.is_active AND i.item_kind = 'consumable'),
      'movement', (
        SELECT COALESCE(jsonb_object_agg(m.txn_type, jsonb_build_object('amount', m.amt, 'amount_base', m.amt_base, 'count', m.n)), '{}'::JSONB)
        FROM (
          SELECT t.txn_type, ROUND(SUM(t.amount), 2) AS amt,
                 ROUND(SUM(CASE WHEN t.fx_rate_source = 'table' OR t.currency = v_base THEN t.amount_base
                                ELSE t.amount * (SELECT r.rate FROM public._cmms_fx_rate(c.id, t.txn_date::DATE) r) END), 2) AS amt_base,
                 COUNT(*) AS n
          FROM public.cmms_inventory_transactions t
          WHERE t.cmms_company_id = c.id AND t.fiscal_year = v_year
          GROUP BY t.txn_type) m)
    ) AS b
    FROM public.cmms_company_profiles c
    WHERE c.id = ANY (v_ids)
  ) x;
  SELECT jsonb_build_object(
    'assets_cost_base',    COALESCE(ROUND(SUM((b->'assets'->>'cost')::NUMERIC * (b->>'fx_rate_to_base')::NUMERIC), 2), 0),
    'assets_nbv_base',     COALESCE(ROUND(SUM((b->'assets'->>'net_book_value')::NUMERIC * (b->>'fx_rate_to_base')::NUMERIC), 2), 0),
    'consumables_value_base', COALESCE(ROUND(SUM((b->'consumables'->>'value')::NUMERIC * (b->>'fx_rate_to_base')::NUMERIC), 2), 0),
    'purchases_base',      COALESCE(ROUND(SUM(COALESCE((b->'movement'->'purchase'->>'amount_base')::NUMERIC, 0)), 2), 0),
    'depreciation_base',   COALESCE(ROUND(SUM(COALESCE((b->'movement'->'depreciation'->>'amount_base')::NUMERIC, 0)), 2), 0)
  ) INTO v_totals
  FROM jsonb_array_elements(v_branches) AS b;
  RETURN jsonb_build_object(
    'year', v_year, 'scope', CASE WHEN p_scope = 'group' AND v_group IS NOT NULL THEN 'group' ELSE 'branch' END,
    'base_currency', COALESCE(v_base, (SELECT currency FROM public.cmms_company_profiles WHERE id = p_company_id)),
    'branches', v_branches, 'totals', v_totals);
END;
$$;
