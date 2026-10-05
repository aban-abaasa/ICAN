CREATE OR REPLACE FUNCTION public._bwp_log(p_business UUID, p_event TEXT, p_details JSONB DEFAULT '{}'::JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.branch_wallet_events (business_profile_id, event, actor_id, actor_email, details)
  VALUES (p_business, p_event, auth.uid(), public._cmms_caller_email(), COALESCE(p_details, '{}'::JSONB));
END;
$$;
CREATE OR REPLACE FUNCTION public._bwp_user_is_owner(p_user UUID, p_business UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_user IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.business_profiles bp WHERE bp.id = p_business AND bp.user_id = p_user)
    OR EXISTS (SELECT 1 FROM public.business_co_owners co
               WHERE co.business_profile_id = p_business AND co.user_id = p_user
                 AND lower(co.status) IN ('active', 'approved')));
$$;
CREATE OR REPLACE FUNCTION public._bwp_rank_over(p_business UUID)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT GREATEST(
    CASE WHEN public._bol_is_business_admin(p_business) THEN 3 ELSE 0 END,
    COALESCE((SELECT MAX(a.wallet_rank) FROM public._bol_ancestors(p_business) a
              WHERE a.wallet_rank > 0 AND public._bol_is_business_admin(a.ancestor_id)), 0));
$$;
CREATE OR REPLACE FUNCTION public._bwp_governed_by_ancestor(p_business UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public._bol_ancestors(p_business) a WHERE a.wallet_rank = 2);
$$;
CREATE OR REPLACE FUNCTION public._bwp_can_govern(p_business UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public._bwp_governed_by_ancestor(p_business) THEN
      EXISTS (SELECT 1 FROM public._bol_ancestors(p_business) a
              WHERE a.wallet_rank = 2 AND public._bol_is_business_admin(a.ancestor_id))
    ELSE public._bol_is_business_admin(p_business)
  END;
$$;
