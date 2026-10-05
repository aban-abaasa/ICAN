CREATE OR REPLACE FUNCTION public.fn_bwp_decide(p_tx UUID, p_decision TEXT, p_pin TEXT, p_comment TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  t public.ican_business_wallet_transactions; v_pol public.branch_wallet_policies;
  v_stage JSONB; v_level TEXT; v_row public.branch_wallet_approvers; v_pin public.branch_approver_pins;
  v_res JSONB; v_email TEXT := public._cmms_caller_email();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF lower(COALESCE(p_decision, '')) NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'Decision must be approved or rejected'; END IF;
  SELECT * INTO t FROM public.ican_business_wallet_transactions WHERE id = p_tx FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF t.status <> 'pending_approval' THEN RAISE EXCEPTION 'This request is already %', t.status; END IF;
  SELECT * INTO v_pol FROM public.branch_wallet_policies WHERE business_profile_id = t.business_profile_id AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'This wallet has no approval ladder; use the standard business approval'; END IF;
  IF t.initiated_by = auth.uid() THEN RAISE EXCEPTION 'You cannot approve a request you raised yourself'; END IF;
  v_stage := public._bwp_stage_status(p_tx);
  SELECT * INTO v_row FROM public.branch_wallet_approvers
   WHERE business_profile_id = t.business_profile_id AND user_id = auth.uid() AND active
     AND (max_amount_ican IS NULL OR max_amount_ican >= t.amount_ican)
     AND (level = 'branch' OR EXISTS (SELECT 1 FROM public._bol_ancestors(t.business_profile_id) a
                                       WHERE a.wallet_rank = 2
                                         AND (public._bwp_user_is_owner(auth.uid(), a.ancestor_id)
                                              OR public._bol_is_business_admin(a.ancestor_id))))
   ORDER BY CASE WHEN level = 'mother' AND (v_stage->'mother'->>'needed')::BOOLEAN THEN 0 ELSE 1 END, level
   LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'You are not an approver for this request (check your assignment and approval limit)'; END IF;
  v_level := v_row.level;
  SELECT * INTO v_pin FROM public.branch_approver_pins WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Set your approval PIN first'; END IF;
  IF v_pin.locked_until IS NOT NULL AND v_pin.locked_until > NOW() THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Too many wrong PIN attempts. Try again after ' || to_char(v_pin.locked_until, 'HH24:MI'));
  END IF;
  IF p_pin IS NULL OR crypt(p_pin, v_pin.pin_hash) <> v_pin.pin_hash THEN
    UPDATE public.branch_approver_pins
       SET failed_count = failed_count + 1,
           locked_until = CASE WHEN failed_count + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' END
     WHERE user_id = auth.uid();
    RETURN jsonb_build_object('success', FALSE, 'error', 'Wrong approval PIN');
  END IF;
  UPDATE public.branch_approver_pins SET failed_count = 0, locked_until = NULL WHERE user_id = auth.uid();
  INSERT INTO public.branch_wallet_stage_approvals (transaction_id, approver_id, approver_email, level, decision, comment)
  VALUES (p_tx, auth.uid(), v_email, v_level, lower(p_decision), p_comment)
  ON CONFLICT (transaction_id, approver_id) DO UPDATE
    SET level = EXCLUDED.level, decision = EXCLUDED.decision, comment = EXCLUDED.comment, decided_at = NOW();
  PERFORM public._bwp_log(t.business_profile_id, 'request_' || lower(p_decision),
    jsonb_build_object('transaction_id', p_tx, 'level', v_level, 'amount_ican', t.amount_ican));
  PERFORM set_config('bwp.engine', 'on', TRUE);
  IF lower(p_decision) = 'rejected' THEN
    UPDATE public.ican_business_wallet_transactions SET status = 'rejected' WHERE id = p_tx;
    PERFORM set_config('bwp.engine', '', TRUE);
    RETURN jsonb_build_object('success', TRUE, 'status', 'rejected', 'stage', public._bwp_stage_status(p_tx));
  END IF;
  v_stage := public._bwp_stage_status(p_tx);
  IF (v_stage->>'complete')::BOOLEAN THEN
    UPDATE public.ican_business_wallet_transactions
       SET approved_ownership_percentage = required_approval_percentage WHERE id = p_tx;
    v_res := public.pitchin_execute_business_wallet_transfer(p_tx);
    PERFORM set_config('bwp.engine', '', TRUE);
    PERFORM public._bwp_log(t.business_profile_id, 'request_released', jsonb_build_object('transaction_id', p_tx, 'result', v_res));
    RETURN jsonb_build_object('success', COALESCE((v_res->>'success')::BOOLEAN, FALSE),
                              'status', COALESCE(v_res->>'status', 'completed'), 'stage', public._bwp_stage_status(p_tx), 'result', v_res);
  END IF;
  PERFORM set_config('bwp.engine', '', TRUE);
  RETURN jsonb_build_object('success', TRUE, 'status', 'pending_approval', 'stage', v_stage);
END;
$$;
