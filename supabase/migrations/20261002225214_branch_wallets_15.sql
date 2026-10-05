CREATE OR REPLACE FUNCTION public.fn_bwp_set_allowance(p_child UUID, p_config JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_parent UUID; v_row public.branch_wallet_allowances;
BEGIN
  SELECT l.parent_business_profile_id INTO v_parent FROM public.business_ownership_links l
   WHERE l.child_business_profile_id = p_child AND l.status = 'active';
  IF v_parent IS NULL THEN RAISE EXCEPTION 'This business has no mother account'; END IF;
  IF NOT public._bol_is_business_admin(v_parent) THEN
    RAISE EXCEPTION 'Only an administrator of the mother account can set a branch allowance';
  END IF;
  INSERT INTO public.branch_wallet_allowances
    (child_business_profile_id, parent_business_profile_id, enabled, mode, amount_ican, float_target_ican, period,
     sweep_above_ican, next_run_at, created_by)
  VALUES (p_child, v_parent, COALESCE((p_config->>'enabled')::BOOLEAN, TRUE), COALESCE(p_config->>'mode', 'top_up'),
          NULLIF(p_config->>'amount_ican', '')::NUMERIC, NULLIF(p_config->>'float_target_ican', '')::NUMERIC,
          COALESCE(p_config->>'period', 'monthly'), NULLIF(p_config->>'sweep_above_ican', '')::NUMERIC,
          COALESCE(NULLIF(p_config->>'next_run_at', '')::TIMESTAMPTZ, NOW()), auth.uid())
  ON CONFLICT (child_business_profile_id) DO UPDATE SET
    parent_business_profile_id = EXCLUDED.parent_business_profile_id, enabled = EXCLUDED.enabled, mode = EXCLUDED.mode,
    amount_ican = EXCLUDED.amount_ican, float_target_ican = EXCLUDED.float_target_ican, period = EXCLUDED.period,
    sweep_above_ican = EXCLUDED.sweep_above_ican, next_run_at = EXCLUDED.next_run_at,
    created_by = auth.uid(), updated_at = NOW()
  RETURNING * INTO v_row;
  PERFORM public._bwp_log(p_child, 'allowance_set', to_jsonb(v_row) - 'created_by');
  RETURN to_jsonb(v_row) - 'created_by';
END;
$$;
