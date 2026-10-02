CREATE OR REPLACE FUNCTION public.fn_bwp_set_policy(p_business UUID, p_policy JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_has_parent BOOLEAN; v_row public.branch_wallet_policies;
BEGIN
  IF NOT public._bwp_can_govern(p_business) THEN
    RAISE EXCEPTION 'Only the wallet’s governing administrator can change its rules';
  END IF;
  v_has_parent := public._bwp_governed_by_ancestor(p_business);
  INSERT INTO public.branch_wallet_policies (business_profile_id) VALUES (p_business) ON CONFLICT DO NOTHING;
  UPDATE public.branch_wallet_policies SET
    enabled = COALESCE((p_policy->>'enabled')::BOOLEAN, enabled),
    wallet_label = CASE WHEN p_policy ? 'wallet_label' THEN NULLIF(btrim(p_policy->>'wallet_label'), '') ELSE wallet_label END,
    per_tx_limit_ican = CASE WHEN p_policy ? 'per_tx_limit_ican' THEN NULLIF(p_policy->>'per_tx_limit_ican', '')::NUMERIC ELSE per_tx_limit_ican END,
    daily_limit_ican = CASE WHEN p_policy ? 'daily_limit_ican' THEN NULLIF(p_policy->>'daily_limit_ican', '')::NUMERIC ELSE daily_limit_ican END,
    branch_approval_up_to_ican = COALESCE(NULLIF(p_policy->>'branch_approval_up_to_ican', '')::NUMERIC, branch_approval_up_to_ican),
    branch_approvals_required = COALESCE(NULLIF(p_policy->>'branch_approvals_required', '')::INT, branch_approvals_required),
    mother_approvals_required = COALESCE(NULLIF(p_policy->>'mother_approvals_required', '')::INT, mother_approvals_required),
    allow_owner_override = CASE WHEN NOT v_has_parent THEN TRUE
                                ELSE COALESCE((p_policy->>'allow_owner_override')::BOOLEAN, allow_owner_override) END,
    updated_by = auth.uid(), updated_at = NOW()
  WHERE business_profile_id = p_business RETURNING * INTO v_row;
  PERFORM public._bwp_log(p_business, 'policy_set', to_jsonb(v_row) - 'updated_by');
  RETURN to_jsonb(v_row);
END;
$$;
