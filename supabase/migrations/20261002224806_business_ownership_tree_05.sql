CREATE OR REPLACE FUNCTION public._bol_after_company_link()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.pichin_business_profile_id IS NOT NULL THEN
    PERFORM public._cmms_sync_tree_group(NEW.pichin_business_profile_id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_bol_after_company_link
  AFTER INSERT OR UPDATE OF pichin_business_profile_id ON public.cmms_company_profiles
  FOR EACH ROW EXECUTE FUNCTION public._bol_after_company_link();
CREATE OR REPLACE FUNCTION public._bol_is_business_admin(p_business_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_business_id IS NOT NULL AND (
    public.unified_business_admin(p_business_id)
    OR EXISTS (SELECT 1 FROM public.cmms_company_profiles c
               WHERE c.pichin_business_profile_id = p_business_id
                 AND public._cmms_is_company_admin(c.id))
  );
$$;
CREATE OR REPLACE FUNCTION public._cmms_access_level(p_company_id UUID)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public._cmms_member_user_id(p_company_id) IS NOT NULL THEN 2
    ELSE GREATEST(
      CASE WHEN EXISTS (
        SELECT 1 FROM public.cmms_company_profiles c
        JOIN public.cmms_business_groups g ON g.id = c.group_id AND g.root_business_profile_id IS NULL
        JOIN public.cmms_company_profiles hq ON hq.group_id = c.group_id AND hq.is_headquarters
        WHERE c.id = p_company_id AND c.group_id IS NOT NULL
          AND public._cmms_is_company_admin(hq.id)) THEN 2 ELSE 0 END,
      COALESCE((
        SELECT MAX(a.access_rank)
        FROM public.cmms_company_profiles c
        CROSS JOIN LATERAL public._bol_ancestors(c.pichin_business_profile_id) a
        WHERE c.id = p_company_id AND c.pichin_business_profile_id IS NOT NULL
          AND public._bol_is_business_admin(a.ancestor_id)), 0))
  END;
$$;
CREATE OR REPLACE FUNCTION public._cmms_can_view_company(p_company_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cmms_access_level(p_company_id) >= 2;
$$;
CREATE OR REPLACE FUNCTION public._cmms_is_group_hq_admin(p_group_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_group_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.cmms_company_profiles hq
            WHERE hq.group_id = p_group_id AND hq.is_headquarters
              AND public._cmms_is_company_admin(hq.id))
    OR EXISTS (SELECT 1 FROM public.cmms_business_groups g
               WHERE g.id = p_group_id AND g.root_business_profile_id IS NOT NULL
                 AND public._bol_is_business_admin(g.root_business_profile_id))
  );
$$;
