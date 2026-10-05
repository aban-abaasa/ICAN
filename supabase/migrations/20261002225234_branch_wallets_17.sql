CREATE OR REPLACE FUNCTION public.fn_bwp_events(p_business UUID)
RETURNS TABLE (created_at TIMESTAMPTZ, event TEXT, actor_email TEXT, details JSONB)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public._bwp_rank_over(p_business) < 1 THEN RAISE EXCEPTION 'You do not have access to this wallet'; END IF;
  RETURN QUERY SELECT e.created_at, e.event, e.actor_email::TEXT, e.details
  FROM public.branch_wallet_events e WHERE e.business_profile_id = p_business ORDER BY e.created_at DESC LIMIT 100;
END;
$$;
GRANT EXECUTE ON FUNCTION
  public.fn_bwp_set_policy(UUID, JSONB),
  public.fn_bwp_assign_approver(UUID, TEXT, TEXT, NUMERIC),
  public.fn_bwp_remove_approver(UUID, UUID),
  public.fn_bwp_list_approvers(UUID),
  public.fn_bwp_set_wallet_status(UUID, TEXT, TEXT),
  public.fn_bwp_set_my_pin(TEXT, TEXT),
  public.fn_bwp_my_pin_status(),
  public.fn_bwp_decide(UUID, TEXT, TEXT, TEXT),
  public.fn_bwp_pending_for_me(),
  public.fn_bwp_wallet_overview(UUID),
  public.fn_bwp_propose_transfer(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT),
  public.fn_bwp_set_allowance(UUID, JSONB),
  public.fn_bwp_run_due_allowances(),
  public.fn_bwp_events(UUID)
TO authenticated;
NOTIFY pgrst, 'reload schema';
