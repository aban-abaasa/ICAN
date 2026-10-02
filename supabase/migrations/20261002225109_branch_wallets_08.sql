CREATE OR REPLACE FUNCTION public.fn_bwp_list_approvers(p_business UUID)
RETURNS TABLE (id UUID, user_id UUID, email TEXT, level TEXT, max_amount_ican NUMERIC, active BOOLEAN, has_pin BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public._bwp_rank_over(p_business) < 2 THEN RAISE EXCEPTION 'You do not govern this wallet'; END IF;
  RETURN QUERY
  SELECT a.id, a.user_id, u.email::TEXT, a.level, a.max_amount_ican, a.active,
         EXISTS (SELECT 1 FROM public.branch_approver_pins p WHERE p.user_id = a.user_id)
  FROM public.branch_wallet_approvers a LEFT JOIN auth.users u ON u.id = a.user_id
  WHERE a.business_profile_id = p_business AND a.active
  ORDER BY a.level DESC, u.email;
END;
$$;
CREATE OR REPLACE FUNCTION public.fn_bwp_set_wallet_status(p_business UUID, p_status TEXT, p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cur TEXT;
BEGIN
  IF p_status NOT IN ('active', 'frozen') THEN RAISE EXCEPTION 'Status must be active or frozen'; END IF;
  IF p_status = 'frozen' AND public._bwp_rank_over(p_business) < 2 THEN
    RAISE EXCEPTION 'You do not govern this wallet';
  END IF;
  IF p_status = 'active' AND NOT public._bwp_can_govern(p_business) THEN
    RAISE EXCEPTION 'Only the wallet’s governing administrator can unfreeze it';
  END IF;
  SELECT status INTO v_cur FROM public.ican_business_wallets WHERE business_profile_id = p_business FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This business has no wallet yet'; END IF;
  IF v_cur = 'suspended' THEN RAISE EXCEPTION 'A suspended wallet can only be reactivated by the platform'; END IF;
  UPDATE public.ican_business_wallets SET status = p_status, updated_at = NOW() WHERE business_profile_id = p_business;
  PERFORM public._bwp_log(p_business, CASE WHEN p_status = 'frozen' THEN 'wallet_frozen' ELSE 'wallet_unfrozen' END,
                          jsonb_build_object('reason', p_reason));
  RETURN jsonb_build_object('status', p_status);
END;
$$;
