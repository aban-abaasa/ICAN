CREATE OR REPLACE FUNCTION public._cmms_sync_tree_group(p_any_business_in_tree UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_root UUID := public._bol_root_of(p_any_business_in_tree);
  v_group UUID; v_hq UUID; v_name TEXT; v_cur TEXT;
  v_members UUID[];
BEGIN
  WITH RECURSIVE down AS (
    SELECT v_root AS biz, ARRAY[v_root] AS path
    UNION ALL
    SELECT l.child_business_profile_id, down.path || l.child_business_profile_id
    FROM down JOIN public.business_ownership_links l
      ON l.parent_business_profile_id = down.biz AND l.status = 'active'
    WHERE NOT l.child_business_profile_id = ANY (down.path)
  )
  SELECT COALESCE(array_agg(DISTINCT public._bol_cmms_company_of(biz)) FILTER (WHERE public._bol_cmms_company_of(biz) IS NOT NULL), '{}')
  INTO v_members FROM down;
  v_hq := public._bol_cmms_company_of(v_root);
  SELECT id INTO v_group FROM public.cmms_business_groups WHERE root_business_profile_id = v_root;
  IF v_group IS NOT NULL THEN
    UPDATE public.cmms_company_profiles
    SET group_id = NULL, is_headquarters = FALSE, updated_at = NOW()
    WHERE group_id = v_group AND NOT (id = ANY (v_members));
  END IF;
  IF v_hq IS NULL OR COALESCE(array_length(v_members, 1), 0) < 2 THEN
    RETURN;
  END IF;
  IF v_group IS NULL THEN
    SELECT COALESCE(NULLIF(bp.business_name, ''), 'Business group') INTO v_name
    FROM public.business_profiles bp WHERE bp.id = v_root;
    SELECT currency INTO v_cur FROM public.cmms_company_profiles WHERE id = v_hq;
    INSERT INTO public.cmms_business_groups (name, base_currency, root_business_profile_id)
    VALUES (COALESCE(v_name, 'Business group'), COALESCE(v_cur, 'UGX'), v_root)
    RETURNING id INTO v_group;
  END IF;
  UPDATE public.cmms_company_profiles
  SET is_headquarters = FALSE, updated_at = NOW()
  WHERE group_id = v_group AND is_headquarters AND id <> v_hq;
  UPDATE public.cmms_company_profiles c
  SET group_id = v_group,
      is_headquarters = (c.id = v_hq),
      branch_name = COALESCE(c.branch_name,
        (SELECT bp.business_name FROM public.business_profiles bp WHERE bp.id = c.pichin_business_profile_id)),
      updated_at = NOW()
  WHERE c.id = ANY (v_members) AND (c.group_id IS NULL OR c.group_id = v_group);
END;
$$;
CREATE OR REPLACE FUNCTION public._bol_after_link_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._cmms_sync_tree_group(NEW.parent_business_profile_id);
  IF TG_OP = 'UPDATE' AND NEW.status = 'ended' THEN
    PERFORM public._cmms_sync_tree_group(NEW.child_business_profile_id);   -- the detached subtree is its own tree now
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_bol_after_link_change
  AFTER INSERT OR UPDATE OF status ON public.business_ownership_links
  FOR EACH ROW EXECUTE FUNCTION public._bol_after_link_change();
