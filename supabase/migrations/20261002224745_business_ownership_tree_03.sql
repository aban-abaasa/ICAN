CREATE OR REPLACE FUNCTION public._bol_log(p_link public.business_ownership_links, p_event TEXT, p_details JSONB DEFAULT '{}'::JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.business_ownership_events
    (link_id, parent_business_profile_id, child_business_profile_id, event, actor_id, actor_email, details)
  VALUES (p_link.id, p_link.parent_business_profile_id, p_link.child_business_profile_id, p_event,
          auth.uid(), public._cmms_caller_email(), COALESCE(p_details, '{}'::JSONB));
END;
$$;
CREATE OR REPLACE FUNCTION public._bol_cmms_company_of(p_business_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id FROM public.cmms_company_profiles c
  WHERE c.pichin_business_profile_id = p_business_id
  ORDER BY c.created_at, c.id LIMIT 1;
$$;
