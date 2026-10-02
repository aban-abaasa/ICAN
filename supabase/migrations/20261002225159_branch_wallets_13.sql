CREATE OR REPLACE FUNCTION public.fn_bwp_wallet_overview(p_business UUID)
RETURNS TABLE (
  business_id UUID, parent_id UUID, depth INT, business_name TEXT, relationship TEXT, my_rank INT,
  wallet_exists BOOLEAN, wallet_label TEXT, wallet_last4 TEXT, balance NUMERIC, wallet_status TEXT,
  funded_30d NUMERIC, spent_30d NUMERIC, pending_count INT, policy JSONB, allowance JSONB, approver_count INT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public._bwp_rank_over(p_business) < 1 THEN RAISE EXCEPTION 'You do not have access to this wallet'; END IF;
  RETURN QUERY
  WITH RECURSIVE down AS (
    SELECT p_business AS biz, NULL::UUID AS par, 0 AS d, NULL::TEXT AS rel, 3 AS wk, ARRAY[p_business] AS path
    UNION ALL
    SELECT l.child_business_profile_id, l.parent_business_profile_id, down.d + 1, l.relationship,
           LEAST(down.wk, public._bol_wallet_rank(l.wallet_control)), down.path || l.child_business_profile_id
    FROM down JOIN public.business_ownership_links l
      ON l.parent_business_profile_id = down.biz AND l.status = 'active'
    WHERE NOT l.child_business_profile_id = ANY (down.path)
  ), nodes AS (
    SELECT * FROM down WHERE d = 0 OR (wk >= 1 AND public._bwp_rank_over(p_business) >= 3)
  )
  SELECT n.biz, n.par, n.d, bp.business_name::TEXT, n.rel,
         CASE WHEN n.d = 0 THEN public._bwp_rank_over(n.biz) ELSE LEAST(n.wk, 2) END,
         w.id IS NOT NULL, pol.wallet_label,
         CASE WHEN w.wallet_address IS NULL THEN NULL ELSE right(w.wallet_address, 4) END,
         COALESCE(w.ican_balance, 0), COALESCE(w.status, 'none'),
         COALESCE((SELECT SUM(x.amount_ican) FROM public.ican_business_wallet_transactions x
                    WHERE x.recipient_business_profile_id = n.biz AND x.status = 'completed'
                      AND COALESCE(to_jsonb(x)->>'operation_type', '') IN ('branch_funding', 'branch_sweep')
                      AND x.created_at > NOW() - INTERVAL '30 days'), 0),
         COALESCE((SELECT SUM(x.amount_ican) FROM public.ican_business_wallet_transactions x
                    WHERE x.business_profile_id = n.biz AND x.status = 'completed'
                      AND COALESCE(to_jsonb(x)->>'operation_type', '') NOT IN ('branch_funding', 'branch_sweep')
                      AND x.created_at > NOW() - INTERVAL '30 days'), 0),
         (SELECT COUNT(*)::INT FROM public.ican_business_wallet_transactions x
           WHERE x.business_profile_id = n.biz AND x.status = 'pending_approval'),
         CASE WHEN pol.business_profile_id IS NULL THEN NULL ELSE to_jsonb(pol) - 'updated_by' END,
         (SELECT to_jsonb(al) - 'created_by' FROM public.branch_wallet_allowances al WHERE al.child_business_profile_id = n.biz),
         (SELECT COUNT(*)::INT FROM public.branch_wallet_approvers a WHERE a.business_profile_id = n.biz AND a.active)
  FROM nodes n
  JOIN public.business_profiles bp ON bp.id = n.biz
  LEFT JOIN public.ican_business_wallets w ON w.business_profile_id = n.biz
  LEFT JOIN public.branch_wallet_policies pol ON pol.business_profile_id = n.biz
  ORDER BY n.d, bp.business_name;
END;
$$;
