CREATE OR REPLACE FUNCTION public.fn_bwp_assign_approver(
  p_business UUID, p_email TEXT, p_level TEXT, p_max_amount NUMERIC DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user UUID; v_ok BOOLEAN;
BEGIN
  IF p_level NOT IN ('branch', 'mother') THEN RAISE EXCEPTION 'Level must be branch or mother'; END IF;
  IF NOT public._bwp_can_govern(p_business) THEN
    RAISE EXCEPTION 'Only the wallet’s governing administrator can assign approvers';
  END IF;
  SELECT id INTO v_user FROM auth.users WHERE lower(email) = lower(btrim(p_email)) LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'No ICAN account was found for %', p_email; END IF;
  IF p_level = 'mother' THEN
    SELECT EXISTS (SELECT 1 FROM public._bol_ancestors(p_business) a
                   WHERE a.wallet_rank = 2 AND public._bwp_user_is_owner(v_user, a.ancestor_id)) INTO v_ok;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'A mother approver must be an owner of a business that governs this branch';
    END IF;
  ELSE
    SELECT EXISTS (SELECT 1 FROM public.business_account_members m
                   WHERE m.business_profile_id = p_business AND m.auth_user_id = v_user
                     AND lower(COALESCE(m.employment_status, 'active')) = 'active')
        OR public._bwp_user_is_owner(v_user, p_business)
        OR EXISTS (SELECT 1 FROM public._bol_ancestors(p_business) a
                   WHERE a.wallet_rank = 2 AND public._bwp_user_is_owner(v_user, a.ancestor_id))
    INTO v_ok;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'A branch approver must be on this business’s team';
    END IF;
  END IF;
  INSERT INTO public.branch_wallet_approvers (business_profile_id, user_id, level, max_amount_ican, added_by)
  VALUES (p_business, v_user, p_level, p_max_amount, auth.uid())
  ON CONFLICT (business_profile_id, user_id, level)
  DO UPDATE SET active = TRUE, max_amount_ican = EXCLUDED.max_amount_ican;
  PERFORM public._bwp_log(p_business, 'approver_assigned',
    jsonb_build_object('approver', lower(btrim(p_email)), 'level', p_level, 'max_amount_ican', p_max_amount));
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
CREATE OR REPLACE FUNCTION public.fn_bwp_remove_approver(p_business UUID, p_approver_row UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.branch_wallet_approvers;
BEGIN
  IF NOT public._bwp_can_govern(p_business) THEN
    RAISE EXCEPTION 'Only the wallet’s governing administrator can remove approvers';
  END IF;
  UPDATE public.branch_wallet_approvers SET active = FALSE
  WHERE id = p_approver_row AND business_profile_id = p_business RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approver not found'; END IF;
  PERFORM public._bwp_log(p_business, 'approver_removed',
    jsonb_build_object('user_id', v_row.user_id, 'level', v_row.level));
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
