CREATE OR REPLACE FUNCTION public._bwp_stage_status(p_tx UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.ican_business_wallet_transactions; v_pol public.branch_wallet_policies;
  v_has_mother BOOLEAN; v_above BOOLEAN; v_needs_mother BOOLEAN; v_owner BOOLEAN;
  v_b INT; v_m INT; v_branch_ok BOOLEAN; v_mother_ok BOOLEAN;
BEGIN
  SELECT * INTO t FROM public.ican_business_wallet_transactions WHERE id = p_tx;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_pol FROM public.branch_wallet_policies WHERE business_profile_id = t.business_profile_id AND enabled;
  IF NOT FOUND THEN RETURN jsonb_build_object('ladder', FALSE); END IF;
  v_has_mother := public._bwp_governed_by_ancestor(t.business_profile_id);
  v_above := t.amount_ican > v_pol.branch_approval_up_to_ican;
  v_needs_mother := v_above AND v_has_mother;
  v_owner := v_above AND NOT v_has_mother;
  SELECT COUNT(*) FILTER (WHERE level = 'branch' AND decision = 'approved'),
         COUNT(*) FILTER (WHERE level = 'mother' AND decision = 'approved')
  INTO v_b, v_m FROM public.branch_wallet_stage_approvals WHERE transaction_id = p_tx;
  v_branch_ok := v_b >= v_pol.branch_approvals_required;
  v_mother_ok := (NOT v_needs_mother) OR v_m >= v_pol.mother_approvals_required;
  RETURN jsonb_build_object(
    'ladder', TRUE, 'amount_ican', t.amount_ican, 'status', t.status,
    'branch', jsonb_build_object('required', v_pol.branch_approvals_required, 'have', v_b, 'ok', v_branch_ok),
    'mother', jsonb_build_object('needed', v_needs_mother, 'required', v_pol.mother_approvals_required, 'have', v_m, 'ok', v_mother_ok),
    'owner_needed', v_owner,
    'complete', v_branch_ok AND v_mother_ok AND NOT v_owner);
END;
$$;
