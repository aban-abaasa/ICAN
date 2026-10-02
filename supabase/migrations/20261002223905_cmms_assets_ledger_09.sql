CREATE OR REPLACE FUNCTION public._cmms_write_inventory_txn(
  p_item public.cmms_inventory_items,
  p_type TEXT,
  p_qty NUMERIC,
  p_unit_cost NUMERIC,
  p_amount NUMERIC,
  p_date TIMESTAMPTZ DEFAULT NOW(),
  p_ref_type TEXT DEFAULT NULL,
  p_ref_no TEXT DEFAULT NULL,
  p_counterparty TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_meta JSONB DEFAULT '{}'::JSONB,
  p_supermarket_id UUID DEFAULT NULL,
  p_product_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_co RECORD; v_fx RECORD; v_id UUID; v_amt NUMERIC := ROUND(ABS(COALESCE(p_amount, 0)), 2);
BEGIN
  SELECT c.id, c.group_id, c.currency, c.branch_name, c.company_name, c.country
    INTO v_co FROM public.cmms_company_profiles c WHERE c.id = p_item.cmms_company_id;
  SELECT * INTO v_fx FROM public._cmms_fx_rate(p_item.cmms_company_id, p_date::DATE);
  INSERT INTO public.cmms_inventory_transactions (
    cmms_company_id, group_id, item_id, item_code, item_name, item_kind, item_category, txn_type,
    quantity, balance_after, unit_cost, amount, currency, fx_rate_to_base, fx_rate_source, amount_base,
    txn_date, fiscal_year, department_id, branch_name, branch_country,
    reference_type, reference_no, counterparty, supermarket_id, supermarket_product_id,
    actor_auth_id, actor_email, notes, metadata
  ) VALUES (
    p_item.cmms_company_id, v_co.group_id, p_item.id, p_item.item_code, p_item.item_name, p_item.item_kind, p_item.category, p_type,
    COALESCE(p_qty, 0), p_item.quantity_in_stock, p_unit_cost, v_amt,
    COALESCE(v_co.currency, 'UGX'), v_fx.rate, v_fx.source, ROUND(v_amt * v_fx.rate, 2),
    p_date, EXTRACT(YEAR FROM p_date)::INT, p_item.department_id,
    COALESCE(v_co.branch_name, v_co.company_name), v_co.country,
    p_ref_type, p_ref_no, p_counterparty, p_supermarket_id, p_product_id,
    auth.uid(), public._cmms_caller_email(), p_notes, COALESCE(p_meta, '{}'::JSONB)
  ) RETURNING id INTO v_id;
  PERFORM public._cmms_feed_money(v_id);
  RETURN v_id;
END;
$$;
