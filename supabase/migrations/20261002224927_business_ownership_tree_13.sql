CREATE OR REPLACE FUNCTION public.fn_business_ownership_chain(p_business_id UUID)
RETURNS TABLE (depth INT, business_id UUID, business_name TEXT, relationship TEXT, ownership_percent NUMERIC, cmms_access_level TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._bol_is_business_admin(p_business_id) THEN
    RAISE EXCEPTION 'You do not administer this business';
  END IF;
  RETURN QUERY
  WITH RECURSIVE up AS (
    SELECT 1 AS d, l.parent_business_profile_id AS biz, l.relationship AS rel, l.ownership_percent AS pct,
           l.cmms_access_level AS lvl, ARRAY[l.child_business_profile_id, l.parent_business_profile_id] AS path
    FROM public.business_ownership_links l
    WHERE l.child_business_profile_id = p_business_id AND l.status = 'active'
    UNION ALL
    SELECT up.d + 1, l.parent_business_profile_id, l.relationship, l.ownership_percent, l.cmms_access_level,
           up.path || l.parent_business_profile_id
    FROM up JOIN public.business_ownership_links l
      ON l.child_business_profile_id = up.biz AND l.status = 'active'
    WHERE NOT l.parent_business_profile_id = ANY (up.path)
  )
  SELECT up.d, up.biz, COALESCE(bp.business_name, 'Unnamed business')::TEXT, up.rel, up.pct, up.lvl
  FROM up JOIN public.business_profiles bp ON bp.id = up.biz
  ORDER BY up.d;
END;
$$;
CREATE OR REPLACE FUNCTION public.fn_business_my_branch_requests()
RETURNS TABLE (
  link_id UUID, direction TEXT, parent_id UUID, parent_name TEXT, child_id UUID, child_name TEXT,
  relationship TEXT, ownership_percent NUMERIC, cmms_access_level TEXT, created_at TIMESTAMPTZ, wallet_control TEXT
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id,
         CASE WHEN public.unified_business_admin(l.child_business_profile_id) THEN 'incoming' ELSE 'outgoing' END,
         l.parent_business_profile_id, pb.business_name::TEXT,
         l.child_business_profile_id, cb.business_name::TEXT,
         l.relationship, l.ownership_percent, l.cmms_access_level, l.created_at, l.wallet_control
  FROM public.business_ownership_links l
  JOIN public.business_profiles pb ON pb.id = l.parent_business_profile_id
  JOIN public.business_profiles cb ON cb.id = l.child_business_profile_id
  WHERE l.status = 'pending'
    AND (public.unified_business_admin(l.child_business_profile_id) OR public.unified_business_admin(l.parent_business_profile_id))
  ORDER BY l.created_at DESC;
$$;
