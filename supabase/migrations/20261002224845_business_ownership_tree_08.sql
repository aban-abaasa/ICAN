CREATE OR REPLACE FUNCTION public.fn_business_propose_branch(
  p_parent UUID, p_child UUID, p_relationship TEXT DEFAULT 'branch',
  p_ownership_percent NUMERIC DEFAULT 100, p_cmms_access TEXT DEFAULT 'summary', p_notes TEXT DEFAULT NULL,
  p_wallet_control TEXT DEFAULT 'none'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_link public.business_ownership_links; v_auto BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF NOT public.unified_business_admin(p_parent) THEN
    RAISE EXCEPTION 'Only an administrator of the parent business can add a branch';
  END IF;
  IF p_parent = p_child THEN RAISE EXCEPTION 'A business cannot be its own branch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_profiles WHERE id = p_child) THEN
    RAISE EXCEPTION 'That business does not exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.business_ownership_links
             WHERE child_business_profile_id = p_child AND status IN ('pending', 'active')) THEN
    RAISE EXCEPTION 'That business already belongs to an ownership tree. End that link first.';
  END IF;
  IF public._bol_would_cycle(p_parent, p_child) THEN
    RAISE EXCEPTION 'That would make the business its own owner (a loop in the tree)';
  END IF;
  IF p_cmms_access NOT IN ('none', 'summary', 'full') THEN RAISE EXCEPTION 'CMMS access must be none, summary or full'; END IF;
  IF COALESCE(p_wallet_control, 'none') NOT IN ('none', 'view', 'govern') THEN RAISE EXCEPTION 'Wallet control must be none, view or govern'; END IF;
  v_auto := public.unified_business_admin(p_child);
  INSERT INTO public.business_ownership_links (
    parent_business_profile_id, child_business_profile_id, relationship, ownership_percent,
    cmms_access_level, wallet_control, status, proposed_by, responded_by, effective_from, notes
  ) VALUES (
    p_parent, p_child, COALESCE(p_relationship, 'branch'), COALESCE(p_ownership_percent, 100),
    p_cmms_access, COALESCE(p_wallet_control, 'none'), CASE WHEN v_auto THEN 'active' ELSE 'pending' END, auth.uid(),
    CASE WHEN v_auto THEN auth.uid() END, CASE WHEN v_auto THEN CURRENT_DATE END, p_notes
  ) RETURNING * INTO v_link;
  PERFORM public._bol_log(v_link, CASE WHEN v_auto THEN 'proposed_and_accepted' ELSE 'proposed' END,
    jsonb_build_object('relationship', v_link.relationship, 'ownership_percent', v_link.ownership_percent,
                       'cmms_access_level', v_link.cmms_access_level, 'wallet_control', v_link.wallet_control));
  RETURN jsonb_build_object('link_id', v_link.id, 'status', v_link.status);
END;
$$;
