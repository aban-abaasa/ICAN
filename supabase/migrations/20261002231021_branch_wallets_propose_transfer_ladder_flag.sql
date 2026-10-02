CREATE OR REPLACE FUNCTION public.fn_bwp_propose_transfer(
  p_source UUID, p_target UUID, p_kind TEXT, p_amount NUMERIC, p_note TEXT DEFAULT NULL, p_reference TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_required NUMERIC; v_tx UUID; v_pol public.branch_wallet_policies;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF p_kind NOT IN ('funding', 'sweep') THEN RAISE EXCEPTION 'Kind must be funding or sweep'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF p_source = p_target THEN RAISE EXCEPTION 'Choose a different wallet'; END IF;

  IF p_kind = 'funding' THEN
    -- mother -> any branch beneath her
    IF NOT EXISTS (SELECT 1 FROM public._bol_ancestors(p_target) a WHERE a.ancestor_id = p_source) THEN
      RAISE EXCEPTION 'You can only fund a branch that belongs to this business';
    END IF;
    IF NOT public._bol_is_business_admin(p_source) THEN
      RAISE EXCEPTION 'Only an administrator of the funding business can fund a branch';
    END IF;
  ELSE
    -- branch -> an owner above it: the branch itself, or whoever governs it
    IF NOT EXISTS (SELECT 1 FROM public._bol_ancestors(p_source) a WHERE a.ancestor_id = p_target) THEN
      RAISE EXCEPTION 'A branch can only be swept to a business that owns it';
    END IF;
    IF NOT (public._bol_is_business_admin(p_source) OR public._bwp_can_govern(p_source)) THEN
      RAISE EXCEPTION 'Only the branch’s administrator or its governing business can sweep it';
    END IF;
  END IF;

  INSERT INTO public.ican_business_wallets (business_profile_id, created_by)
  SELECT id, user_id FROM public.business_profiles WHERE id IN (p_source, p_target)
  ON CONFLICT (business_profile_id) DO NOTHING;
  INSERT INTO public.ican_business_wallet_settings (business_profile_id) VALUES (p_source) ON CONFLICT DO NOTHING;

  SELECT approval_percentage INTO v_required FROM public.ican_business_wallet_settings WHERE business_profile_id = p_source;
  v_required := GREATEST(COALESCE(v_required, 100), 1);

  INSERT INTO public.ican_business_wallet_transactions
    (business_profile_id, initiated_by, amount_ican, note, reference_id, status, required_approval_percentage,
     recipient_business_profile_id, operation_type, source_app)
  VALUES
    (p_source, auth.uid(), p_amount, COALESCE(NULLIF(btrim(p_note), ''), CASE WHEN p_kind = 'funding' THEN 'Branch funding' ELSE 'Surplus swept to mother account' END),
     p_reference, 'pending_approval', v_required, p_target,
     CASE WHEN p_kind = 'funding' THEN 'branch_funding' ELSE 'branch_sweep' END, 'ican')
  RETURNING id INTO v_tx;

  SELECT * INTO v_pol FROM public.branch_wallet_policies WHERE business_profile_id = p_source AND enabled;
  PERFORM public._bwp_log(p_source, 'transfer_proposed',
    jsonb_build_object('transaction_id', v_tx, 'kind', p_kind, 'target', p_target, 'amount_ican', p_amount));
  RETURN jsonb_build_object('transaction_id', v_tx, 'status', 'pending_approval', 'ladder', v_pol.business_profile_id IS NOT NULL);
END;
$$;
