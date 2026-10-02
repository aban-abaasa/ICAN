GRANT SELECT ON public.business_ownership_links, public.business_ownership_events TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.fn_business_propose_branch(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT),
  public.fn_business_respond_branch_link(UUID, BOOLEAN, TEXT, TEXT),
  public.fn_business_update_branch_link(UUID, NUMERIC, TEXT, TEXT, TEXT),
  public.fn_business_end_branch_link(UUID, TEXT),
  public.fn_business_branch_tree(UUID),
  public.fn_business_ownership_chain(UUID),
  public.fn_business_my_branch_requests(),
  public.fn_business_ownership_history(UUID),
  public.fn_business_search_for_branch(TEXT),
  public.fn_business_my_unlinked_businesses(),
  public.fn_cmms_inventory_report(UUID, INT, TEXT),
  public.fn_cmms_get_my_business_group(UUID)
TO authenticated;
NOTIFY pgrst, 'reload schema';
