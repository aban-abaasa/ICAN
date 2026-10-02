CREATE OR REPLACE FUNCTION public._cmms_money_spec(t public.cmms_inventory_transactions)
RETURNS TABLE (m_feed BOOLEAN, m_direction TEXT, m_amount NUMERIC, m_accounting_type TEXT, m_label TEXT)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_cat TEXT := lower(btrim(COALESCE(t.item_category, '')));
  v_proceeds NUMERIC;
BEGIN
  m_feed := FALSE; m_direction := NULL; m_amount := 0; m_accounting_type := NULL; m_label := NULL;
  IF t.txn_type = 'purchase' OR (t.txn_type = 'restock' AND t.reference_type = 'purchase') THEN
    m_feed := t.amount > 0; m_direction := 'expense'; m_amount := t.amount; m_label := t.txn_type;
    m_accounting_type := CASE
      WHEN t.item_kind = 'asset' THEN 'asset'
      WHEN v_cat IN ('retail stock', 'materials', 'spare parts', 'raw materials') THEN 'cogs'
      ELSE NULL END;
  ELSIF t.txn_type = 'depreciation' THEN
    m_feed := t.amount > 0; m_direction := 'expense'; m_amount := t.amount;
    m_accounting_type := 'depreciation'; m_label := 'depreciation ' || t.fiscal_year;
  ELSIF t.txn_type = 'disposal' THEN
    v_proceeds := COALESCE(NULLIF(t.metadata->>'proceeds', '')::NUMERIC, 0);
    m_feed := v_proceeds > 0; m_direction := 'income'; m_amount := v_proceeds;
    m_accounting_type := 'revenue'; m_label := 'asset disposal proceeds';
  END IF;
  RETURN NEXT;
END;
$$;
