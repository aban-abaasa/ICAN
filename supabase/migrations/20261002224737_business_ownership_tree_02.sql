ALTER TABLE public.cmms_business_groups ADD COLUMN IF NOT EXISTS root_business_profile_id UUID
  REFERENCES public.business_profiles(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cmms_group_root_business
  ON public.cmms_business_groups(root_business_profile_id) WHERE root_business_profile_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public._bol_access_rank(p_level TEXT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_level WHEN 'full' THEN 2 WHEN 'summary' THEN 1 ELSE 0 END;
$$;
CREATE OR REPLACE FUNCTION public._bol_wallet_rank(p_level TEXT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_level WHEN 'govern' THEN 2 WHEN 'view' THEN 1 ELSE 0 END;
$$;
CREATE OR REPLACE FUNCTION public._bol_ancestors(p_business_id UUID)
RETURNS TABLE (ancestor_id UUID, depth INT, access_rank INT, wallet_rank INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE up AS (
    SELECT l.parent_business_profile_id AS anc, 1 AS depth,
           public._bol_access_rank(l.cmms_access_level) AS rk,
           public._bol_wallet_rank(l.wallet_control) AS wk,
           ARRAY[l.child_business_profile_id, l.parent_business_profile_id] AS path
    FROM public.business_ownership_links l
    WHERE l.child_business_profile_id = p_business_id AND l.status = 'active'
    UNION ALL
    SELECT l.parent_business_profile_id, up.depth + 1,
           LEAST(up.rk, public._bol_access_rank(l.cmms_access_level)),
           LEAST(up.wk, public._bol_wallet_rank(l.wallet_control)),
           up.path || l.parent_business_profile_id
    FROM up
    JOIN public.business_ownership_links l
      ON l.child_business_profile_id = up.anc AND l.status = 'active'
    WHERE NOT l.parent_business_profile_id = ANY (up.path)
  )
  SELECT anc, depth, rk, wk FROM up;
$$;
CREATE OR REPLACE FUNCTION public._bol_root_of(p_business_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT a.ancestor_id FROM public._bol_ancestors(p_business_id) a ORDER BY a.depth DESC LIMIT 1),
                  p_business_id);
$$;
CREATE OR REPLACE FUNCTION public._bol_would_cycle(p_parent UUID, p_child UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE up AS (
    SELECT p_parent AS node, ARRAY[p_parent] AS path
    UNION ALL
    SELECT l.parent_business_profile_id, up.path || l.parent_business_profile_id
    FROM up
    JOIN public.business_ownership_links l
      ON l.child_business_profile_id = up.node AND l.status IN ('pending', 'active')
    WHERE NOT l.parent_business_profile_id = ANY (up.path)
  )
  SELECT p_parent = p_child OR EXISTS (SELECT 1 FROM up WHERE node = p_child);
$$;
