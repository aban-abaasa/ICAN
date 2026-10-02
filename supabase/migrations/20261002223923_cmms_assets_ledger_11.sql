CREATE OR REPLACE FUNCTION public._cmms_feed_money(p_txn_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.cmms_inventory_transactions;
  spec RECORD; v_co JSONB; v_business UUID; v_user UUID; v_money UUID;
BEGIN
  IF to_regclass('public.ican_transactions') IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO t FROM public.cmms_inventory_transactions WHERE id = p_txn_id;
  IF NOT FOUND OR t.ican_transaction_id IS NOT NULL THEN RETURN t.ican_transaction_id; END IF;
  SELECT * INTO spec FROM public._cmms_money_spec(t);
  IF NOT spec.m_feed THEN RETURN NULL; END IF;
  SELECT to_jsonb(c) INTO v_co FROM public.cmms_company_profiles c WHERE c.id = t.cmms_company_id;
  v_business := NULLIF(v_co->>'pichin_business_profile_id', '')::UUID;
  v_user := t.actor_auth_id;
  IF v_user IS NULL AND v_business IS NOT NULL AND to_regclass('public.business_profiles') IS NOT NULL THEN
    EXECUTE 'SELECT user_id FROM public.business_profiles WHERE id = $1' INTO v_user USING v_business;
  END IF;
  IF v_user IS NULL THEN RETURN NULL; END IF;     -- nobody to book it to; reported as unposted
  INSERT INTO public.ican_transactions (
    user_id, transaction_type, amount, currency, description, status, business_profile_id, metadata, created_at
  ) VALUES (
    v_user, spec.m_direction, spec.m_amount, t.currency,
    format('%s%s — CMMS %s', COALESCE(t.item_name, 'Inventory item'),
           CASE WHEN t.item_category IS NULL THEN '' ELSE ' (' || t.item_category || ')' END, spec.m_label),
    'completed', v_business,
    jsonb_strip_nulls(jsonb_build_object(
      'category', 'cmms_inventory', 'source_app', 'cmms', 'record_category', 'business',
      'accounting_type', spec.m_accounting_type,
      'product_name', t.item_name,
      'cmms_company_id', t.cmms_company_id, 'cmms_item_id', t.item_id, 'cmms_txn_id', t.id,
      'cmms_item_kind', t.item_kind, 'cmms_txn_type', t.txn_type,
      'branch_name', t.branch_name, 'non_cash', CASE WHEN t.txn_type = 'depreciation' THEN TRUE END)),
    t.txn_date
  ) RETURNING id INTO v_money;
  UPDATE public.cmms_inventory_transactions SET ican_transaction_id = v_money WHERE id = t.id;
  RETURN v_money;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'CMMS money feed failed for ledger row %: %', p_txn_id, SQLERRM;
  RETURN NULL;
END;
$$;
