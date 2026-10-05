CREATE INDEX IF NOT EXISTS idx_cmms_itx_group_year   ON public.cmms_inventory_transactions(group_id, fiscal_year);
CREATE INDEX IF NOT EXISTS idx_cmms_itx_item         ON public.cmms_inventory_transactions(item_id);
CREATE INDEX IF NOT EXISTS idx_cmms_itx_type         ON public.cmms_inventory_transactions(cmms_company_id, txn_type, fiscal_year);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cmms_itx_depreciation_once
  ON public.cmms_inventory_transactions(item_id, fiscal_year) WHERE txn_type = 'depreciation';
CREATE OR REPLACE FUNCTION public._cmms_itx_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() <= 1 THEN
      RAISE EXCEPTION 'cmms_inventory_transactions is append-only: rows cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.ican_transaction_id IS NULL
     AND (to_jsonb(NEW) - 'ican_transaction_id') = (to_jsonb(OLD) - 'ican_transaction_id') THEN
    RETURN NEW;   -- only the money-ledger link was added
  END IF;
  IF pg_trigger_depth() > 1 AND NEW.item_id IS NULL
     AND (to_jsonb(NEW) - 'item_id') = (to_jsonb(OLD) - 'item_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'cmms_inventory_transactions is append-only: rows cannot be edited';
END;
$$;
CREATE TRIGGER trg_cmms_itx_immutable
  BEFORE UPDATE OR DELETE ON public.cmms_inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION public._cmms_itx_immutable();
ALTER TABLE public.cmms_inventory_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY cmms_itx_select ON public.cmms_inventory_transactions
  FOR SELECT USING (public._cmms_can_view_company(cmms_company_id));
REVOKE INSERT, UPDATE, DELETE ON public.cmms_inventory_transactions FROM anon, authenticated;
GRANT SELECT ON public.cmms_inventory_transactions TO authenticated;
CREATE OR REPLACE FUNCTION public._cmms_guc(p_name TEXT)
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting(p_name, TRUE), '');
$$;
CREATE OR REPLACE FUNCTION public._cmms_fx_rate(p_company_id UUID, p_on DATE, OUT rate NUMERIC, OUT source TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_group UUID; v_cur TEXT; v_base TEXT;
BEGIN
  SELECT c.group_id, c.currency, g.base_currency INTO v_group, v_cur, v_base
  FROM public.cmms_company_profiles c
  LEFT JOIN public.cmms_business_groups g ON g.id = c.group_id
  WHERE c.id = p_company_id;
  IF v_group IS NULL OR v_base IS NULL OR v_cur IS NOT DISTINCT FROM v_base THEN
    rate := 1; source := 'identity'; RETURN;
  END IF;
  SELECT f.rate_to_base INTO rate
  FROM public.cmms_group_fx_rates f
  WHERE f.group_id = v_group AND f.currency = v_cur AND f.effective_from <= p_on
  ORDER BY f.effective_from DESC LIMIT 1;
  IF rate IS NULL THEN rate := 1; source := 'missing'; ELSE source := 'table'; END IF;
END;
$$;
