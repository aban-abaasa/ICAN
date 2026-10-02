CREATE OR REPLACE FUNCTION public.fn_bwp_run_due_allowances()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.branch_wallet_allowances; v_bal NUMERIC; v_amt NUMERIC; v_made INT := 0; v_actor UUID;
BEGIN
  FOR a IN SELECT * FROM public.branch_wallet_allowances WHERE enabled AND next_run_at <= NOW() FOR UPDATE SKIP LOCKED LOOP
    IF auth.uid() IS NOT NULL AND NOT public._bol_is_business_admin(a.parent_business_profile_id) THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.business_ownership_links l WHERE l.child_business_profile_id = a.child_business_profile_id
                   AND l.parent_business_profile_id = a.parent_business_profile_id AND l.status = 'active') THEN
      CONTINUE;   -- the branch left the tree
    END IF;
    v_actor := a.created_by;
    SELECT COALESCE(ican_balance, 0) INTO v_bal FROM public.ican_business_wallets WHERE business_profile_id = a.child_business_profile_id;
    v_bal := COALESCE(v_bal, 0);
    v_amt := CASE WHEN a.mode = 'fixed' THEN a.amount_ican ELSE GREATEST(0, a.float_target_ican - v_bal) END;
    IF v_amt > 0 AND NOT EXISTS (
         SELECT 1 FROM public.ican_business_wallet_transactions x
          WHERE x.reference_id = 'allowance:' || a.child_business_profile_id AND x.status = 'pending_approval') THEN
      INSERT INTO public.ican_business_wallet_transactions
        (business_profile_id, initiated_by, amount_ican, note, reference_id, status, required_approval_percentage,
         recipient_business_profile_id, operation_type, source_app)
      VALUES (a.parent_business_profile_id, v_actor, v_amt,
              CASE WHEN a.mode = 'fixed' THEN 'Scheduled branch allowance' ELSE 'Top-up to float' END,
              'allowance:' || a.child_business_profile_id, 'pending_approval',
              GREATEST(COALESCE((SELECT approval_percentage FROM public.ican_business_wallet_settings WHERE business_profile_id = a.parent_business_profile_id), 100), 1),
              a.child_business_profile_id, 'branch_funding', 'ican');
      v_made := v_made + 1;
    END IF;
    IF a.sweep_above_ican IS NOT NULL AND v_bal > a.sweep_above_ican AND NOT EXISTS (
         SELECT 1 FROM public.ican_business_wallet_transactions x
          WHERE x.reference_id = 'sweep:' || a.child_business_profile_id AND x.status = 'pending_approval') THEN
      INSERT INTO public.ican_business_wallet_transactions
        (business_profile_id, initiated_by, amount_ican, note, reference_id, status, required_approval_percentage,
         recipient_business_profile_id, operation_type, source_app)
      VALUES (a.child_business_profile_id, v_actor, v_bal - a.sweep_above_ican, 'Surplus above the ceiling swept to mother account',
              'sweep:' || a.child_business_profile_id, 'pending_approval',
              GREATEST(COALESCE((SELECT approval_percentage FROM public.ican_business_wallet_settings WHERE business_profile_id = a.child_business_profile_id), 100), 1),
              a.parent_business_profile_id, 'branch_sweep', 'ican');
      v_made := v_made + 1;
    END IF;
    UPDATE public.branch_wallet_allowances
       SET last_run_at = NOW(), next_run_at = NOW() + CASE a.period WHEN 'weekly' THEN INTERVAL '7 days' ELSE INTERVAL '1 month' END
     WHERE child_business_profile_id = a.child_business_profile_id;
  END LOOP;
  RETURN jsonb_build_object('requests_created', v_made);
END;
$$;
