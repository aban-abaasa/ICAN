CREATE OR REPLACE FUNCTION public.fn_cmms_post_missing_money_entries(p_company_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; v_ok INT := 0; v_left INT := 0; v_money UUID;
BEGIN
  IF NOT public._cmms_can_manage_inventory(p_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to post transactions';
  END IF;
  FOR r IN
    SELECT t.id FROM public.cmms_inventory_transactions t
    CROSS JOIN LATERAL public._cmms_money_spec(t) s
    WHERE t.cmms_company_id = p_company_id AND s.m_feed AND t.ican_transaction_id IS NULL
    ORDER BY t.txn_date
  LOOP
    v_money := public._cmms_feed_money(r.id);
    IF v_money IS NULL THEN v_left := v_left + 1; ELSE v_ok := v_ok + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('posted', v_ok, 'still_unposted', v_left);
END;
$$;
