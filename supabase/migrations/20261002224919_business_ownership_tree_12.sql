CREATE OR REPLACE FUNCTION public.fn_business_branch_tree(p_business_id UUID)
RETURNS TABLE (
  link_id UUID, business_id UUID, parent_id UUID, depth INT, business_name TEXT,
  relationship TEXT, ownership_percent NUMERIC, effective_percent NUMERIC,
  cmms_access_level TEXT, effective_access TEXT, status TEXT,
  cmms_company_id UUID, cmms_company_name TEXT, can_manage BOOLEAN,
  wallet_control TEXT, effective_wallet TEXT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public._bol_is_business_admin(p_business_id)
          OR EXISTS (SELECT 1 FROM public._bol_ancestors(p_business_id) a WHERE public._bol_is_business_admin(a.ancestor_id))) THEN
    RAISE EXCEPTION 'You do not administer this business';
  END IF;
  RETURN QUERY
  WITH RECURSIVE down AS (
    SELECT NULL::UUID AS lid, p_business_id AS biz, NULL::UUID AS par, 0 AS d,
           NULL::TEXT AS rel, 100::NUMERIC AS pct, 100::NUMERIC AS eff, 'full'::TEXT AS lvl, 2 AS rk,
           'active'::TEXT AS st, ARRAY[p_business_id] AS path,
           'govern'::TEXT AS wlvl, 2 AS wk
    UNION ALL
    SELECT l.id, l.child_business_profile_id, l.parent_business_profile_id, down.d + 1,
           l.relationship, l.ownership_percent, ROUND(down.eff * l.ownership_percent / 100, 3),
           l.cmms_access_level, LEAST(down.rk, public._bol_access_rank(l.cmms_access_level)),
           l.status, down.path || l.child_business_profile_id,
           l.wallet_control, LEAST(down.wk, public._bol_wallet_rank(l.wallet_control))
    FROM down
    JOIN public.business_ownership_links l
      ON l.parent_business_profile_id = down.biz AND l.status IN ('active', 'pending')
    WHERE down.st = 'active' AND NOT l.child_business_profile_id = ANY (down.path)
  )
  SELECT d.lid, d.biz, d.par, d.d,
         COALESCE(bp.business_name, 'Unnamed business')::TEXT,
         d.rel, d.pct, d.eff, d.lvl,
         CASE d.rk WHEN 2 THEN 'full' WHEN 1 THEN 'summary' ELSE 'none' END,
         d.st, cc.id, cc.company_name::TEXT,
         public._bol_is_business_admin(d.par) OR public._bol_is_business_admin(d.biz),
         d.wlvl, CASE d.wk WHEN 2 THEN 'govern' WHEN 1 THEN 'view' ELSE 'none' END
  FROM down d
  JOIN public.business_profiles bp ON bp.id = d.biz
  LEFT JOIN public.cmms_company_profiles cc ON cc.id = public._bol_cmms_company_of(d.biz)
  ORDER BY d.d, bp.business_name;
END;
$$;
