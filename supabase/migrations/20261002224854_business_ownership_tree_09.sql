CREATE OR REPLACE FUNCTION public.fn_business_respond_branch_link(
  p_link_id UUID, p_accept BOOLEAN, p_cmms_access TEXT DEFAULT NULL, p_wallet_control TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_link public.business_ownership_links;
BEGIN
  SELECT * INTO v_link FROM public.business_ownership_links WHERE id = p_link_id FOR UPDATE;
  IF NOT FOUND OR v_link.status <> 'pending' THEN RAISE EXCEPTION 'There is no pending request to answer'; END IF;
  IF NOT public.unified_business_admin(v_link.child_business_profile_id) THEN
    RAISE EXCEPTION 'Only an administrator of the business being added can answer';
  END IF;
  IF NOT p_accept THEN
    UPDATE public.business_ownership_links SET status = 'declined', responded_by = auth.uid(), updated_at = NOW()
    WHERE id = p_link_id RETURNING * INTO v_link;
    PERFORM public._bol_log(v_link, 'declined');
    RETURN jsonb_build_object('status', 'declined');
  END IF;
  IF p_cmms_access IS NOT NULL AND p_cmms_access NOT IN ('none', 'summary', 'full') THEN
    RAISE EXCEPTION 'CMMS access must be none, summary or full';
  END IF;
  IF p_cmms_access IS NOT NULL AND public._bol_access_rank(p_cmms_access) > public._bol_access_rank(v_link.cmms_access_level) THEN
    RAISE EXCEPTION 'You can accept at the proposed level or lower, not higher';
  END IF;
  IF p_wallet_control IS NOT NULL AND p_wallet_control NOT IN ('none', 'view', 'govern') THEN
    RAISE EXCEPTION 'Wallet control must be none, view or govern';
  END IF;
  IF p_wallet_control IS NOT NULL AND public._bol_wallet_rank(p_wallet_control) > public._bol_wallet_rank(v_link.wallet_control) THEN
    RAISE EXCEPTION 'You can accept at the proposed wallet control or lower, not higher';
  END IF;
  UPDATE public.business_ownership_links
  SET status = 'active', responded_by = auth.uid(), effective_from = CURRENT_DATE,
      cmms_access_level = COALESCE(p_cmms_access, cmms_access_level),
      wallet_control = COALESCE(p_wallet_control, wallet_control), updated_at = NOW()
  WHERE id = p_link_id RETURNING * INTO v_link;
  PERFORM public._bol_log(v_link, 'accepted', jsonb_build_object('cmms_access_level', v_link.cmms_access_level,
                                                                  'wallet_control', v_link.wallet_control));
  RETURN jsonb_build_object('status', 'active');
END;
$$;
