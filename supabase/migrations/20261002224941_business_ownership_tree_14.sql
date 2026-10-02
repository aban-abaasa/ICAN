CREATE OR REPLACE FUNCTION public.fn_business_ownership_history(p_business_id UUID)
RETURNS TABLE (created_at TIMESTAMPTZ, event TEXT, actor_email TEXT, parent_name TEXT, child_name TEXT, details JSONB)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._bol_is_business_admin(p_business_id) THEN RAISE EXCEPTION 'You do not administer this business'; END IF;
  RETURN QUERY
  SELECT e.created_at, e.event, e.actor_email::TEXT, pb.business_name::TEXT, cb.business_name::TEXT, e.details
  FROM public.business_ownership_events e
  LEFT JOIN public.business_profiles pb ON pb.id = e.parent_business_profile_id
  LEFT JOIN public.business_profiles cb ON cb.id = e.child_business_profile_id
  WHERE e.parent_business_profile_id = p_business_id OR e.child_business_profile_id = p_business_id
  ORDER BY e.created_at DESC LIMIT 100;
END;
$$;
CREATE OR REPLACE FUNCTION public.fn_business_search_for_branch(p_query TEXT)
RETURNS TABLE (business_id UUID, business_name TEXT, administered_by_me BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT bp.id, bp.business_name::TEXT, public.unified_business_admin(bp.id)
  FROM public.business_profiles bp
  WHERE auth.uid() IS NOT NULL AND length(btrim(COALESCE(p_query, ''))) >= 3
    AND bp.business_name ILIKE '%' || btrim(p_query) || '%'
    AND NOT EXISTS (SELECT 1 FROM public.business_ownership_links l
                    WHERE l.child_business_profile_id = bp.id AND l.status IN ('pending', 'active'))
  ORDER BY public.unified_business_admin(bp.id) DESC, bp.business_name
  LIMIT 10;
$$;
CREATE OR REPLACE FUNCTION public.fn_business_my_unlinked_businesses()
RETURNS TABLE (business_id UUID, business_name TEXT, has_cmms BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT bp.id, bp.business_name::TEXT, public._bol_cmms_company_of(bp.id) IS NOT NULL
  FROM public.business_profiles bp
  WHERE auth.uid() IS NOT NULL AND public.unified_business_admin(bp.id)
    AND NOT EXISTS (SELECT 1 FROM public.business_ownership_links l
                    WHERE l.child_business_profile_id = bp.id AND l.status IN ('pending', 'active'))
  ORDER BY bp.business_name;
$$;
ALTER TABLE public.business_ownership_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_ownership_links_select ON public.business_ownership_links FOR SELECT TO authenticated
  USING (public.unified_business_admin(parent_business_profile_id) OR public.unified_business_admin(child_business_profile_id));
ALTER TABLE public.business_ownership_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_ownership_events_select ON public.business_ownership_events FOR SELECT TO authenticated
  USING (public.unified_business_admin(parent_business_profile_id) OR public.unified_business_admin(child_business_profile_id));
REVOKE INSERT, UPDATE, DELETE ON public.business_ownership_links, public.business_ownership_events FROM anon, authenticated;
