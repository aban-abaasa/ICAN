CREATE OR REPLACE FUNCTION public.fn_business_update_branch_link(
  p_link_id UUID, p_ownership_percent NUMERIC DEFAULT NULL, p_relationship TEXT DEFAULT NULL, p_cmms_access TEXT DEFAULT NULL,
  p_wallet_control TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_link public.business_ownership_links;
  v_is_parent BOOLEAN; v_is_child BOOLEAN; v_before JSONB;
BEGIN
  SELECT * INTO v_link FROM public.business_ownership_links WHERE id = p_link_id FOR UPDATE;
  IF NOT FOUND OR v_link.status <> 'active' THEN RAISE EXCEPTION 'That link is not active'; END IF;
  v_is_parent := public.unified_business_admin(v_link.parent_business_profile_id);
  v_is_child  := public.unified_business_admin(v_link.child_business_profile_id);
  IF NOT (v_is_parent OR v_is_child) THEN RAISE EXCEPTION 'You do not administer either business'; END IF;
  IF p_cmms_access IS NOT NULL THEN
    IF p_cmms_access NOT IN ('none', 'summary', 'full') THEN RAISE EXCEPTION 'CMMS access must be none, summary or full'; END IF;
    IF NOT v_is_child AND public._bol_access_rank(p_cmms_access) > public._bol_access_rank(v_link.cmms_access_level) THEN
      RAISE EXCEPTION 'Only the branch can raise how much of its CMMS is shared';
    END IF;
  END IF;
  IF p_wallet_control IS NOT NULL THEN
    IF p_wallet_control NOT IN ('none', 'view', 'govern') THEN RAISE EXCEPTION 'Wallet control must be none, view or govern'; END IF;
    IF NOT v_is_child AND public._bol_wallet_rank(p_wallet_control) > public._bol_wallet_rank(v_link.wallet_control) THEN
      RAISE EXCEPTION 'Only the branch can raise how much control the parent has over its wallet';
    END IF;
  END IF;
  IF (p_ownership_percent IS NOT NULL OR p_relationship IS NOT NULL) AND NOT v_is_parent THEN
    RAISE EXCEPTION 'Only the parent business can change ownership or the relationship';
  END IF;
  IF p_ownership_percent IS NOT NULL AND (p_ownership_percent <= 0 OR p_ownership_percent > 100) THEN
    RAISE EXCEPTION 'Ownership must be between 0 and 100 percent';
  END IF;
  v_before := jsonb_build_object('relationship', v_link.relationship, 'ownership_percent', v_link.ownership_percent,
                                 'cmms_access_level', v_link.cmms_access_level, 'wallet_control', v_link.wallet_control);
  UPDATE public.business_ownership_links SET
    ownership_percent = COALESCE(p_ownership_percent, ownership_percent),
    relationship      = COALESCE(p_relationship, relationship),
    cmms_access_level = COALESCE(p_cmms_access, cmms_access_level),
    wallet_control    = COALESCE(p_wallet_control, wallet_control),
    updated_at = NOW()
  WHERE id = p_link_id RETURNING * INTO v_link;
  PERFORM public._bol_log(v_link, 'changed', jsonb_build_object('before', v_before,
    'after', jsonb_build_object('relationship', v_link.relationship, 'ownership_percent', v_link.ownership_percent,
                                'cmms_access_level', v_link.cmms_access_level, 'wallet_control', v_link.wallet_control)));
  RETURN jsonb_build_object('status', 'active');
END;
$$;
