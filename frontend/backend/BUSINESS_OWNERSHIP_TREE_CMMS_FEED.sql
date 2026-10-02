-- ============================================================================
-- PITCHIN BUSINESS PROFILE: BRANCHES, TREE OF OWNERSHIP, CMMS FEED
-- ============================================================================
-- Run AFTER:
--   * CMMS_ASSET_INVENTORY_FOUNDATION.sql      (cmms_company_profiles.pichin_business_profile_id)
--   * SHARED_BUSINESS_AUTHORITY_AND_PAYROLL.sql + UNIFIED_BUSINESS_MANAGEMENT_AND_SUPPLIER_MARKETPLACE.sql
--                                              (public.unified_business_admin)
--   * CMMS_ASSETS_BRANCHES_LEDGER.sql          (groups, ledger, access helpers)
-- Safe to run more than once.
--
-- A branch is a Pitchin business profile of its own. This file records WHO OWNS
-- WHOM as a tree and what each branch agrees to share with its parent's CMMS:
--
--   business_ownership_links   one row per parent -> child edge, with the
--                              arrangement: relationship, ownership %, CMMS
--                              access level (none | summary | full), and a
--                              pending -> active -> ended life cycle. A child
--                              has at most one live parent, so it is a tree;
--                              cycles are refused. Ended edges stay as history.
--   business_ownership_events  append-only log of every proposal / acceptance /
--                              change / ending, with who did it.
--
-- THE CMMS FEED. Every business that has a CMMS company (cmms_company_profiles
-- .pichin_business_profile_id) feeds its parent automatically: the tree is
-- mirrored into the CMMS business group (head office = the root's CMMS, branches
-- = descendants'), so the consolidated report, FX and ledger roll-up from
-- CMMS_ASSETS_BRANCHES_LEDGER.sql follow the ownership tree with no second
-- setup. What an ancestor may read of a branch is capped by the WEAKEST access
-- level along the path to it:
--     none     the branch is in the tree but its CMMS is not shared
--     summary  branch totals appear in the parent's consolidated report
--     full     the parent's admins may also read the branch's register + ledger
-- WALLETS. wallet_control on each link (none | view | govern) says what the parent
-- may do with the branch's business wallet; see BRANCH_WALLETS_APPROVERS.sql.
-- CONSENT. The parent proposes; the child's administrator accepts (automatic
-- when one person administers both). Only the CHILD side can raise the access
-- level; the parent side can only lower it.
-- ============================================================================

SET check_function_bodies = off;

-- ============================================================================
-- 1. TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.business_ownership_links (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  child_business_profile_id  UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  relationship               TEXT NOT NULL DEFAULT 'branch'
                             CHECK (relationship IN ('branch', 'subsidiary', 'franchise', 'joint_venture')),
  ownership_percent          NUMERIC(6, 3) NOT NULL DEFAULT 100
                             CHECK (ownership_percent > 0 AND ownership_percent <= 100),
  cmms_access_level          TEXT NOT NULL DEFAULT 'summary'
                             CHECK (cmms_access_level IN ('none', 'summary', 'full')),
  -- What the parent may do with the branch's business wallet (see
  -- BRANCH_WALLETS_APPROVERS.sql): none | view (balances, activity) | govern
  -- (limits, approvers, freeze, fund, sweep). Same consent rule as CMMS sharing.
  wallet_control             TEXT NOT NULL DEFAULT 'none'
                             CHECK (wallet_control IN ('none', 'view', 'govern')),
  status                     TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'active', 'declined', 'ended')),
  proposed_by                UUID,
  responded_by               UUID,
  effective_from             DATE,
  ended_at                   TIMESTAMPTZ,
  ended_by                   UUID,
  notes                      TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (parent_business_profile_id <> child_business_profile_id)
);

ALTER TABLE public.business_ownership_links ADD COLUMN IF NOT EXISTS wallet_control TEXT NOT NULL DEFAULT 'none'
  CHECK (wallet_control IN ('none', 'view', 'govern'));

-- A business has at most ONE live (pending or active) parent: that is what makes it a tree.
CREATE UNIQUE INDEX IF NOT EXISTS uq_business_ownership_one_live_parent
  ON public.business_ownership_links(child_business_profile_id) WHERE status IN ('pending', 'active');
CREATE INDEX IF NOT EXISTS idx_business_ownership_parent
  ON public.business_ownership_links(parent_business_profile_id, status);

CREATE TABLE IF NOT EXISTS public.business_ownership_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id     UUID REFERENCES public.business_ownership_links(id) ON DELETE CASCADE,
  parent_business_profile_id UUID,
  child_business_profile_id  UUID,
  event       TEXT NOT NULL,
  actor_id    UUID,
  actor_email TEXT,
  details     JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_business_ownership_events_link ON public.business_ownership_events(link_id, created_at);

CREATE OR REPLACE FUNCTION public._boe_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;  -- cascade from a deleted business
  RAISE EXCEPTION 'business_ownership_events is append-only';
END;
$$;
DROP TRIGGER IF EXISTS trg_boe_append_only ON public.business_ownership_events;
CREATE TRIGGER trg_boe_append_only BEFORE UPDATE OR DELETE ON public.business_ownership_events
  FOR EACH ROW EXECUTE FUNCTION public._boe_append_only();

-- The CMMS business group that mirrors a tree is keyed by the tree's root business.
ALTER TABLE public.cmms_business_groups ADD COLUMN IF NOT EXISTS root_business_profile_id UUID
  REFERENCES public.business_profiles(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cmms_group_root_business
  ON public.cmms_business_groups(root_business_profile_id) WHERE root_business_profile_id IS NOT NULL;

-- ============================================================================
-- 2. TREE HELPERS
-- ============================================================================

CREATE OR REPLACE FUNCTION public._bol_access_rank(p_level TEXT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_level WHEN 'full' THEN 2 WHEN 'summary' THEN 1 ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public._bol_wallet_rank(p_level TEXT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_level WHEN 'govern' THEN 2 WHEN 'view' THEN 1 ELSE 0 END;
$$;

-- Every ACTIVE ancestor of a business, nearest first, with the weakest CMMS
-- access rank and the weakest wallet-control rank on the path from that
-- ancestor down to the business.
DROP FUNCTION IF EXISTS public._bol_ancestors(UUID);
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

-- Would making `p_parent` the parent of `p_child` close a loop? (live edges, pending included)
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

CREATE OR REPLACE FUNCTION public._bol_log(p_link public.business_ownership_links, p_event TEXT, p_details JSONB DEFAULT '{}'::JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.business_ownership_events
    (link_id, parent_business_profile_id, child_business_profile_id, event, actor_id, actor_email, details)
  VALUES (p_link.id, p_link.parent_business_profile_id, p_link.child_business_profile_id, p_event,
          auth.uid(), public._cmms_caller_email(), COALESCE(p_details, '{}'::JSONB));
END;
$$;

-- ============================================================================
-- 3. MIRROR THE TREE INTO THE CMMS BUSINESS GROUP
-- ============================================================================

-- One CMMS company per business: the earliest one linked to its profile.
CREATE OR REPLACE FUNCTION public._bol_cmms_company_of(p_business_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id FROM public.cmms_company_profiles c
  WHERE c.pichin_business_profile_id = p_business_id
  ORDER BY c.created_at, c.id LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._cmms_sync_tree_group(p_any_business_in_tree UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_root UUID := public._bol_root_of(p_any_business_in_tree);
  v_group UUID; v_hq UUID; v_name TEXT; v_cur TEXT;
  v_members UUID[];
BEGIN
  -- every business in the tree (root + active descendants) that has a CMMS company
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

  -- Release companies that left the tree (only ones this tree's group owns)
  IF v_group IS NOT NULL THEN
    UPDATE public.cmms_company_profiles
    SET group_id = NULL, is_headquarters = FALSE, updated_at = NOW()
    WHERE group_id = v_group AND NOT (id = ANY (v_members));
  END IF;

  -- A tree needs a head-office CMMS and at least one branch CMMS to be worth a group
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

  -- Companies already in a different (manually made) group are left alone.
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
DROP TRIGGER IF EXISTS trg_bol_after_link_change ON public.business_ownership_links;
CREATE TRIGGER trg_bol_after_link_change
  AFTER INSERT OR UPDATE OF status ON public.business_ownership_links
  FOR EACH ROW EXECUTE FUNCTION public._bol_after_link_change();

-- A CMMS company linked to a Pitchin profile after the branch link was made
CREATE OR REPLACE FUNCTION public._bol_after_company_link()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.pichin_business_profile_id IS NOT NULL THEN
    PERFORM public._cmms_sync_tree_group(NEW.pichin_business_profile_id);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_bol_after_company_link ON public.cmms_company_profiles;
CREATE TRIGGER trg_bol_after_company_link
  AFTER INSERT OR UPDATE OF pichin_business_profile_id ON public.cmms_company_profiles
  FOR EACH ROW EXECUTE FUNCTION public._bol_after_company_link();

-- ============================================================================
-- 4. TREE-AWARE CMMS ACCESS (replaces the group-only helpers of the ledger file)
-- ============================================================================

-- Is the caller an administrator of this business: Pitchin owner / co-owner /
-- business-admin role, or the CMMS administrator of a company linked to it.
CREATE OR REPLACE FUNCTION public._bol_is_business_admin(p_business_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_business_id IS NOT NULL AND (
    public.unified_business_admin(p_business_id)
    OR EXISTS (SELECT 1 FROM public.cmms_company_profiles c
               WHERE c.pichin_business_profile_id = p_business_id
                 AND public._cmms_is_company_admin(c.id))
  );
$$;

-- What the caller may read of a company's CMMS: 2 = full, 1 = summary only, 0 = nothing.
CREATE OR REPLACE FUNCTION public._cmms_access_level(p_company_id UUID)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    -- a member of the company (the common case: answered without walking the tree)
    WHEN public._cmms_member_user_id(p_company_id) IS NOT NULL THEN 2
    ELSE GREATEST(
      -- head-office admin of a MANUALLY made group. A group mirrored from the
      -- ownership tree (root_business_profile_id set) is excluded: there the
      -- agreed access levels are the only authority.
      CASE WHEN EXISTS (
        SELECT 1 FROM public.cmms_company_profiles c
        JOIN public.cmms_business_groups g ON g.id = c.group_id AND g.root_business_profile_id IS NULL
        JOIN public.cmms_company_profiles hq ON hq.group_id = c.group_id AND hq.is_headquarters
        WHERE c.id = p_company_id AND c.group_id IS NOT NULL
          AND public._cmms_is_company_admin(hq.id)) THEN 2 ELSE 0 END,
      -- an administrator of any business above this one in the ownership tree,
      -- capped by the weakest agreement on the way down
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

-- Can the caller manage a group's FX rates / see the whole group: head-office
-- CMMS admin, or an administrator of the tree's root business.
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

-- The consolidated business report, now gated branch by branch by the tree:
-- a branch is included when the caller's access to it is at least 'summary'.
CREATE OR REPLACE FUNCTION public.fn_cmms_inventory_report(
  p_company_id UUID, p_year INT DEFAULT NULL, p_scope TEXT DEFAULT 'branch'
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_year INT := COALESCE(p_year, EXTRACT(YEAR FROM NOW())::INT);
  v_group UUID; v_base TEXT; v_branches JSONB := '[]'::JSONB; v_totals JSONB;
  v_ids UUID[]; v_hidden INT := 0;
BEGIN
  SELECT c.group_id INTO v_group FROM public.cmms_company_profiles c WHERE c.id = p_company_id;
  SELECT g.base_currency INTO v_base FROM public.cmms_business_groups g WHERE g.id = v_group;

  IF p_scope = 'group' AND v_group IS NOT NULL THEN
    SELECT COALESCE(array_agg(c.id) FILTER (WHERE public._cmms_access_level(c.id) >= 1), '{}'),
           COUNT(*) FILTER (WHERE public._cmms_access_level(c.id) < 1)
    INTO v_ids, v_hidden
    FROM public.cmms_company_profiles c WHERE c.group_id = v_group;
    IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN
      RAISE EXCEPTION 'You do not have access to this business';
    END IF;
  ELSE
    IF public._cmms_access_level(p_company_id) < 1 THEN
      RAISE EXCEPTION 'You do not have access to this branch';
    END IF;
    v_ids := ARRAY[p_company_id];
  END IF;

  SELECT COALESCE(jsonb_agg(b ORDER BY (b->>'is_headquarters')::BOOLEAN DESC, b->>'branch_name'), '[]'::JSONB)
  INTO v_branches
  FROM (
    SELECT jsonb_build_object(
      'company_id', c.id,
      'business_profile_id', c.pichin_business_profile_id,
      'branch_name', COALESCE(c.branch_name, c.company_name),
      'branch_code', c.branch_code, 'country', c.country, 'currency', c.currency,
      'is_headquarters', c.is_headquarters,
      'access', CASE public._cmms_access_level(c.id) WHEN 2 THEN 'full' ELSE 'summary' END,
      'fx_rate_to_base', (SELECT rate FROM public._cmms_fx_rate(c.id, make_date(v_year, 12, 31))),
      'fx_source', (SELECT source FROM public._cmms_fx_rate(c.id, make_date(v_year, 12, 31))),
      'assets', (
        SELECT jsonb_build_object(
          'count', COALESCE(SUM(i.quantity_in_stock), 0),
          'cost', COALESCE(ROUND(SUM(COALESCE(i.acquisition_cost, i.unit_price, 0) * i.quantity_in_stock), 2), 0),
          'accumulated_depreciation', COALESCE(ROUND(SUM(a.acc * i.quantity_in_stock), 2), 0),
          'net_book_value', COALESCE(ROUND(SUM((COALESCE(i.acquisition_cost, i.unit_price, 0) - a.acc) * i.quantity_in_stock), 2), 0))
        FROM public.cmms_inventory_items i
        CROSS JOIN LATERAL (SELECT public.fn_cmms_accum_depreciation(COALESCE(i.acquisition_cost, i.unit_price),
              i.salvage_value, i.useful_life_years, i.depreciation_method, i.acquisition_year, v_year) AS acc) a
        WHERE i.cmms_company_id = c.id AND i.is_active AND i.item_kind = 'asset'
          AND COALESCE(i.asset_status, 'in_service') <> 'disposed'),
      'consumables', (
        SELECT jsonb_build_object(
          'items', COUNT(*),
          'value', COALESCE(ROUND(SUM(i.quantity_in_stock * COALESCE(i.unit_price, 0)), 2), 0),
          'low_stock', COUNT(*) FILTER (WHERE i.quantity_in_stock <= COALESCE(i.reorder_level, 0)))
        FROM public.cmms_inventory_items i
        WHERE i.cmms_company_id = c.id AND i.is_active AND i.item_kind = 'consumable'),
      'movement', (
        SELECT COALESCE(jsonb_object_agg(m.txn_type, jsonb_build_object('amount', m.amt, 'amount_base', m.amt_base, 'count', m.n)), '{}'::JSONB)
        FROM (
          SELECT t.txn_type, ROUND(SUM(t.amount), 2) AS amt,
                 ROUND(SUM(CASE WHEN t.fx_rate_source = 'table' OR t.currency = v_base THEN t.amount_base
                                ELSE t.amount * (SELECT r.rate FROM public._cmms_fx_rate(c.id, t.txn_date::DATE) r) END), 2) AS amt_base,
                 COUNT(*) AS n
          FROM public.cmms_inventory_transactions t
          WHERE t.cmms_company_id = c.id AND t.fiscal_year = v_year
          GROUP BY t.txn_type) m)
    ) AS b
    FROM public.cmms_company_profiles c
    WHERE c.id = ANY (v_ids)
  ) x;

  SELECT jsonb_build_object(
    'assets_cost_base',    COALESCE(ROUND(SUM((b->'assets'->>'cost')::NUMERIC * (b->>'fx_rate_to_base')::NUMERIC), 2), 0),
    'assets_nbv_base',     COALESCE(ROUND(SUM((b->'assets'->>'net_book_value')::NUMERIC * (b->>'fx_rate_to_base')::NUMERIC), 2), 0),
    'consumables_value_base', COALESCE(ROUND(SUM((b->'consumables'->>'value')::NUMERIC * (b->>'fx_rate_to_base')::NUMERIC), 2), 0),
    'purchases_base',      COALESCE(ROUND(SUM(COALESCE((b->'movement'->'purchase'->>'amount_base')::NUMERIC, 0)), 2), 0),
    'depreciation_base',   COALESCE(ROUND(SUM(COALESCE((b->'movement'->'depreciation'->>'amount_base')::NUMERIC, 0)), 2), 0)
  ) INTO v_totals
  FROM jsonb_array_elements(v_branches) AS b;

  RETURN jsonb_build_object(
    'year', v_year, 'scope', CASE WHEN p_scope = 'group' AND v_group IS NOT NULL THEN 'group' ELSE 'branch' END,
    'base_currency', COALESCE(v_base, (SELECT currency FROM public.cmms_company_profiles WHERE id = p_company_id)),
    'branches', v_branches, 'totals', v_totals,
    'branches_not_shared', v_hidden);
END;
$$;

-- The caller's view of their business group, now listing the branches the tree lets them see
CREATE OR REPLACE FUNCTION public.fn_cmms_get_my_business_group(p_company_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_group UUID; v_is_hq BOOLEAN; v_out JSONB;
BEGIN
  IF public._cmms_access_level(p_company_id) < 1 THEN
    RAISE EXCEPTION 'You do not have access to this branch';
  END IF;
  SELECT group_id INTO v_group FROM public.cmms_company_profiles WHERE id = p_company_id;
  IF v_group IS NULL THEN
    RETURN jsonb_build_object('group', NULL, 'branches', '[]'::JSONB, 'fx_rates', '[]'::JSONB, 'is_hq_admin', FALSE);
  END IF;
  v_is_hq := public._cmms_is_group_hq_admin(v_group);

  SELECT jsonb_build_object(
    'group', (SELECT to_jsonb(g) FROM public.cmms_business_groups g WHERE g.id = v_group),
    'is_hq_admin', v_is_hq,
    'from_ownership_tree', EXISTS (SELECT 1 FROM public.cmms_business_groups g WHERE g.id = v_group AND g.root_business_profile_id IS NOT NULL),
    'branches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'company_id', c.id, 'company_name', c.company_name, 'business_profile_id', c.pichin_business_profile_id,
        'branch_name', COALESCE(c.branch_name, c.company_name), 'branch_code', c.branch_code,
        'country', c.country, 'currency', c.currency, 'timezone', c.timezone,
        'is_headquarters', c.is_headquarters, 'supermarket_id', c.supermarket_id,
        'is_current', c.id = p_company_id,
        'access', CASE public._cmms_access_level(c.id) WHEN 2 THEN 'full' ELSE 'summary' END)
        ORDER BY c.is_headquarters DESC, COALESCE(c.branch_name, c.company_name))
      FROM public.cmms_company_profiles c
      WHERE c.group_id = v_group AND public._cmms_access_level(c.id) >= 1), '[]'::JSONB),
    'fx_rates', COALESCE((
      SELECT jsonb_agg(to_jsonb(f) ORDER BY f.currency, f.effective_from DESC)
      FROM public.cmms_group_fx_rates f WHERE f.group_id = v_group AND v_is_hq), '[]'::JSONB)
  ) INTO v_out;
  RETURN v_out;
END;
$$;

-- The register / reconciliation / ledger-link already call _cmms_can_view_company,
-- which now honours the tree; the group-manual 'link / update / unlink' flows are
-- unchanged. The summary-only level never reaches rows or the register.

-- ============================================================================
-- 5. TREE MANAGEMENT FUNCTIONS (the Pitchin business profile calls these)
-- ============================================================================

-- Parent proposes a branch. If one person administers both, it is active at once.
DROP FUNCTION IF EXISTS public.fn_business_propose_branch(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.fn_business_propose_branch(
  p_parent UUID, p_child UUID, p_relationship TEXT DEFAULT 'branch',
  p_ownership_percent NUMERIC DEFAULT 100, p_cmms_access TEXT DEFAULT 'summary', p_notes TEXT DEFAULT NULL,
  p_wallet_control TEXT DEFAULT 'none'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_link public.business_ownership_links; v_auto BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF NOT public.unified_business_admin(p_parent) THEN
    RAISE EXCEPTION 'Only an administrator of the parent business can add a branch';
  END IF;
  IF p_parent = p_child THEN RAISE EXCEPTION 'A business cannot be its own branch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_profiles WHERE id = p_child) THEN
    RAISE EXCEPTION 'That business does not exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.business_ownership_links
             WHERE child_business_profile_id = p_child AND status IN ('pending', 'active')) THEN
    RAISE EXCEPTION 'That business already belongs to an ownership tree. End that link first.';
  END IF;
  IF public._bol_would_cycle(p_parent, p_child) THEN
    RAISE EXCEPTION 'That would make the business its own owner (a loop in the tree)';
  END IF;
  IF p_cmms_access NOT IN ('none', 'summary', 'full') THEN RAISE EXCEPTION 'CMMS access must be none, summary or full'; END IF;
  IF COALESCE(p_wallet_control, 'none') NOT IN ('none', 'view', 'govern') THEN RAISE EXCEPTION 'Wallet control must be none, view or govern'; END IF;

  v_auto := public.unified_business_admin(p_child);

  INSERT INTO public.business_ownership_links (
    parent_business_profile_id, child_business_profile_id, relationship, ownership_percent,
    cmms_access_level, wallet_control, status, proposed_by, responded_by, effective_from, notes
  ) VALUES (
    p_parent, p_child, COALESCE(p_relationship, 'branch'), COALESCE(p_ownership_percent, 100),
    p_cmms_access, COALESCE(p_wallet_control, 'none'), CASE WHEN v_auto THEN 'active' ELSE 'pending' END, auth.uid(),
    CASE WHEN v_auto THEN auth.uid() END, CASE WHEN v_auto THEN CURRENT_DATE END, p_notes
  ) RETURNING * INTO v_link;

  PERFORM public._bol_log(v_link, CASE WHEN v_auto THEN 'proposed_and_accepted' ELSE 'proposed' END,
    jsonb_build_object('relationship', v_link.relationship, 'ownership_percent', v_link.ownership_percent,
                       'cmms_access_level', v_link.cmms_access_level, 'wallet_control', v_link.wallet_control));
  RETURN jsonb_build_object('link_id', v_link.id, 'status', v_link.status);
END;
$$;

-- Child administrator answers a proposal; may accept at a LOWER CMMS access level.
DROP FUNCTION IF EXISTS public.fn_business_respond_branch_link(UUID, BOOLEAN, TEXT);
CREATE OR REPLACE FUNCTION public.fn_business_respond_branch_link(
  p_link_id UUID, p_accept BOOLEAN, p_cmms_access TEXT DEFAULT NULL, p_wallet_control TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_link public.business_ownership_links;
BEGIN
  SELECT * INTO v_link FROM public.business_ownership_links WHERE id = p_link_id FOR UPDATE;
  IF NOT FOUND OR v_link.status <> 'pending' THEN RAISE EXCEPTION 'There is no pending request to answer'; END IF;
  IF NOT public.unified_business_admin(v_link.child_business_profile_id) THEN
    RAISE EXCEPTION 'Only an administrator of the business being added can answer';
  END IF;

  IF NOT p_accept THEN
    UPDATE public.business_ownership_links SET status = 'declined', responded_by = auth.uid(), updated_at = NOW()
    WHERE id = p_link_id RETURNING * INTO v_link;
    PERFORM public._bol_log(v_link, 'declined');
    RETURN jsonb_build_object('status', 'declined');
  END IF;

  IF p_cmms_access IS NOT NULL AND p_cmms_access NOT IN ('none', 'summary', 'full') THEN
    RAISE EXCEPTION 'CMMS access must be none, summary or full';
  END IF;
  IF p_cmms_access IS NOT NULL AND public._bol_access_rank(p_cmms_access) > public._bol_access_rank(v_link.cmms_access_level) THEN
    RAISE EXCEPTION 'You can accept at the proposed level or lower, not higher';
  END IF;

  IF p_wallet_control IS NOT NULL AND p_wallet_control NOT IN ('none', 'view', 'govern') THEN
    RAISE EXCEPTION 'Wallet control must be none, view or govern';
  END IF;
  IF p_wallet_control IS NOT NULL AND public._bol_wallet_rank(p_wallet_control) > public._bol_wallet_rank(v_link.wallet_control) THEN
    RAISE EXCEPTION 'You can accept at the proposed wallet control or lower, not higher';
  END IF;

  UPDATE public.business_ownership_links
  SET status = 'active', responded_by = auth.uid(), effective_from = CURRENT_DATE,
      cmms_access_level = COALESCE(p_cmms_access, cmms_access_level),
      wallet_control = COALESCE(p_wallet_control, wallet_control), updated_at = NOW()
  WHERE id = p_link_id RETURNING * INTO v_link;
  PERFORM public._bol_log(v_link, 'accepted', jsonb_build_object('cmms_access_level', v_link.cmms_access_level,
                                                                  'wallet_control', v_link.wallet_control));
  RETURN jsonb_build_object('status', 'active');
END;
$$;

-- Change the arrangement of a live link.
--   parent admin: relationship, ownership %, and may only LOWER the CMMS access
--   child admin : may set the CMMS access to any level (the data is theirs to share)
DROP FUNCTION IF EXISTS public.fn_business_update_branch_link(UUID, NUMERIC, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.fn_business_update_branch_link(
  p_link_id UUID, p_ownership_percent NUMERIC DEFAULT NULL, p_relationship TEXT DEFAULT NULL, p_cmms_access TEXT DEFAULT NULL,
  p_wallet_control TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_link public.business_ownership_links;
  v_is_parent BOOLEAN; v_is_child BOOLEAN; v_before JSONB;
BEGIN
  SELECT * INTO v_link FROM public.business_ownership_links WHERE id = p_link_id FOR UPDATE;
  IF NOT FOUND OR v_link.status <> 'active' THEN RAISE EXCEPTION 'That link is not active'; END IF;
  v_is_parent := public.unified_business_admin(v_link.parent_business_profile_id);
  v_is_child  := public.unified_business_admin(v_link.child_business_profile_id);
  IF NOT (v_is_parent OR v_is_child) THEN RAISE EXCEPTION 'You do not administer either business'; END IF;

  IF p_cmms_access IS NOT NULL THEN
    IF p_cmms_access NOT IN ('none', 'summary', 'full') THEN RAISE EXCEPTION 'CMMS access must be none, summary or full'; END IF;
    IF NOT v_is_child AND public._bol_access_rank(p_cmms_access) > public._bol_access_rank(v_link.cmms_access_level) THEN
      RAISE EXCEPTION 'Only the branch can raise how much of its CMMS is shared';
    END IF;
  END IF;
  IF p_wallet_control IS NOT NULL THEN
    IF p_wallet_control NOT IN ('none', 'view', 'govern') THEN RAISE EXCEPTION 'Wallet control must be none, view or govern'; END IF;
    IF NOT v_is_child AND public._bol_wallet_rank(p_wallet_control) > public._bol_wallet_rank(v_link.wallet_control) THEN
      RAISE EXCEPTION 'Only the branch can raise how much control the parent has over its wallet';
    END IF;
  END IF;
  IF (p_ownership_percent IS NOT NULL OR p_relationship IS NOT NULL) AND NOT v_is_parent THEN
    RAISE EXCEPTION 'Only the parent business can change ownership or the relationship';
  END IF;
  IF p_ownership_percent IS NOT NULL AND (p_ownership_percent <= 0 OR p_ownership_percent > 100) THEN
    RAISE EXCEPTION 'Ownership must be between 0 and 100 percent';
  END IF;

  v_before := jsonb_build_object('relationship', v_link.relationship, 'ownership_percent', v_link.ownership_percent,
                                 'cmms_access_level', v_link.cmms_access_level, 'wallet_control', v_link.wallet_control);
  UPDATE public.business_ownership_links SET
    ownership_percent = COALESCE(p_ownership_percent, ownership_percent),
    relationship      = COALESCE(p_relationship, relationship),
    cmms_access_level = COALESCE(p_cmms_access, cmms_access_level),
    wallet_control    = COALESCE(p_wallet_control, wallet_control),
    updated_at = NOW()
  WHERE id = p_link_id RETURNING * INTO v_link;
  PERFORM public._bol_log(v_link, 'changed', jsonb_build_object('before', v_before,
    'after', jsonb_build_object('relationship', v_link.relationship, 'ownership_percent', v_link.ownership_percent,
                                'cmms_access_level', v_link.cmms_access_level, 'wallet_control', v_link.wallet_control)));
  RETURN jsonb_build_object('status', 'active');
END;
$$;

-- Either side can end the arrangement (or the parent can withdraw a pending proposal).
CREATE OR REPLACE FUNCTION public.fn_business_end_branch_link(p_link_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_link public.business_ownership_links;
BEGIN
  SELECT * INTO v_link FROM public.business_ownership_links WHERE id = p_link_id FOR UPDATE;
  IF NOT FOUND OR v_link.status NOT IN ('pending', 'active') THEN RAISE EXCEPTION 'That link is already closed'; END IF;
  IF NOT (public.unified_business_admin(v_link.parent_business_profile_id)
          OR public.unified_business_admin(v_link.child_business_profile_id)) THEN
    RAISE EXCEPTION 'You do not administer either business';
  END IF;
  UPDATE public.business_ownership_links
  SET status = 'ended', ended_at = NOW(), ended_by = auth.uid(), updated_at = NOW(),
      notes = CASE WHEN p_reason IS NULL THEN notes ELSE COALESCE(notes || E'\n', '') || 'Ended: ' || p_reason END
  WHERE id = p_link_id RETURNING * INTO v_link;
  PERFORM public._bol_log(v_link, 'ended', jsonb_build_object('reason', p_reason));
  RETURN jsonb_build_object('status', 'ended');
END;
$$;

-- The subtree below a business (itself at depth 0), with the arrangement on every edge.
-- Pending / declined proposals of nodes in the tree are listed one level only.
DROP FUNCTION IF EXISTS public.fn_business_branch_tree(UUID);
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

-- Who owns this business: the chain of active owners up to the root
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

-- Proposals waiting on me (incoming) and mine still waiting on others (outgoing)
DROP FUNCTION IF EXISTS public.fn_business_my_branch_requests();
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

-- Ownership history for one business (every proposal, acceptance, change, ending)
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

-- Find a business to propose as a branch (names only; at least 3 characters)
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

-- My own businesses that could become branches (the common single-owner case)
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

-- ============================================================================
-- 6. RLS + GRANTS
-- ============================================================================
ALTER TABLE public.business_ownership_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_ownership_links_select ON public.business_ownership_links;
CREATE POLICY business_ownership_links_select ON public.business_ownership_links FOR SELECT TO authenticated
  USING (public.unified_business_admin(parent_business_profile_id) OR public.unified_business_admin(child_business_profile_id));

ALTER TABLE public.business_ownership_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_ownership_events_select ON public.business_ownership_events;
CREATE POLICY business_ownership_events_select ON public.business_ownership_events FOR SELECT TO authenticated
  USING (public.unified_business_admin(parent_business_profile_id) OR public.unified_business_admin(child_business_profile_id));

REVOKE INSERT, UPDATE, DELETE ON public.business_ownership_links, public.business_ownership_events FROM anon, authenticated;
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
SELECT 'Pitchin ownership tree + CMMS feed installed' AS status;

-- ============================================================================
-- HARDENING: pin search_path, and close the API to everything that is not meant to be called
-- from the app. Internal helpers (leading underscore) can read other businesses' trees or write
-- log rows, so only the screens' fn_* functions (and the few harmless helpers the row-level
-- policies and triggers call as the signed-in user) stay executable by signed-in users (granted
-- explicitly, since PUBLIC no longer covers them).
-- ============================================================================
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname, p.proconfig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (ARRAY[
    '_boe_append_only',
    '_bol_access_rank',
    '_bol_after_company_link',
    '_bol_after_link_change',
    '_bol_ancestors',
    '_bol_cmms_company_of',
    '_bol_is_business_admin',
    '_bol_log',
    '_bol_root_of',
    '_bol_wallet_rank',
    '_bol_would_cycle',
    '_cmms_access_level',
    '_cmms_can_view_company',
    '_cmms_is_group_hq_admin',
    '_cmms_sync_tree_group',
    'fn_business_branch_tree',
    'fn_business_end_branch_link',
    'fn_business_my_branch_requests',
    'fn_business_my_unlinked_businesses',
    'fn_business_ownership_chain',
    'fn_business_ownership_history',
    'fn_business_propose_branch',
    'fn_business_respond_branch_link',
    'fn_business_search_for_branch',
    'fn_business_update_branch_link',
    'fn_cmms_get_my_business_group',
    'fn_cmms_inventory_report'
    ])
  LOOP
    IF r.proconfig IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(r.proconfig) c WHERE c LIKE 'search_path=%') THEN
      EXECUTE 'ALTER FUNCTION ' || r.sig || ' SET search_path = public';
    END IF;
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || r.sig || ' FROM PUBLIC, anon';
    IF left(r.proname, 1) = '_' AND r.proname <> ALL (ARRAY['_cmms_can_view_company', '_cmms_kind_from_category', '_cmms_caller_email', '_cmms_guc', '_cmms_money_spec', '_bol_access_rank', '_bol_wallet_rank']) THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || r.sig || ' FROM authenticated';
    ELSE
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || r.sig || ' TO authenticated';
    END IF;
  END LOOP;
END $$;
