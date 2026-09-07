-- ============================================================
-- CMMS Business Opportunities & Bids -- a company posts an open
-- opportunity (a contract/project it needs done); both individuals
-- (bidding from their own ICAN resume/portfolio page) and other CMMS
-- companies (bidding as a business) can submit a bid on it.
-- ============================================================
-- Unlike CMMS_SERVICE_PROVIDER_CONTRACTS.sql, every participant here
-- already has an ICAN account -- a bidding individual is a signed-in ICAN
-- user browsing from their own resume/portfolio page, and a bidding
-- business is a CMMS company its staff already belong to. So there is no
-- opaque-token/anon-RPC layer at all: this is a plain authenticated-RLS
-- feature, same shape as the rest of the app.
--
-- Visibility (explicit product decision): an opportunity's basic listing
-- (title, description, deadline, status) is visible to any authenticated
-- ICAN user -- that's the "browse available businesses' opportunities"
-- page. The bids placed on it are PRIVATE: the posting company's
-- permitted staff see every bid on their own opportunity; a bidder sees
-- only their own bid. Nobody else sees any bid at all.
--
-- Permission: posting/managing an opportunity (create, edit, pick a
-- winner) requires the 'opportunities' tool's 'manage' action via
-- cmms_has_tool_action -- admin always has it, any other role can be
-- granted it from Roles management (see CMMSRoleConfiguration.jsx),
-- same pattern as CMMS_SERVICE_PROVIDER_CONTRACTS.sql's publish_contract.
-- Submitting a bid needs no special permission -- any active member of a
-- CMMS company can bid on another company's opportunity as that
-- business, and any ICAN user can bid as themselves.
--
-- Run after: CMMS_ANNOUNCEMENTS_AND_JOBS.sql (cmms_has_tool_action,
-- cmms_current_user_id_for_company, cmms_touch_updated_at).
-- Safe to run more than once.
-- ============================================================

-- ============================================================
-- 1. cmms_business_opportunities -- the open call for bids
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_business_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,

  title VARCHAR(255) NOT NULL CHECK (TRIM(title) <> ''),
  description TEXT,
  budget_hint VARCHAR(255),
  deadline TIMESTAMPTZ,

  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'awarded', 'closed', 'cancelled')),

  created_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmms_biz_opps_company ON public.cmms_business_opportunities(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_cmms_biz_opps_status ON public.cmms_business_opportunities(status);

DROP TRIGGER IF EXISTS trg_cmms_biz_opps_touch_updated_at ON public.cmms_business_opportunities;
CREATE TRIGGER trg_cmms_biz_opps_touch_updated_at
  BEFORE UPDATE ON public.cmms_business_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.cmms_touch_updated_at();

ALTER TABLE public.cmms_business_opportunities ENABLE ROW LEVEL SECURITY;

-- Any signed-in ICAN user can browse open opportunities -- this is the
-- "available businesses" list a resume/portfolio page or another
-- company's bid page reads from. Nothing sensitive lives on this table.
DROP POLICY IF EXISTS cmms_biz_opps_authenticated_select ON public.cmms_business_opportunities;
CREATE POLICY cmms_biz_opps_authenticated_select ON public.cmms_business_opportunities
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cmms_biz_opps_staff_manage ON public.cmms_business_opportunities;
CREATE POLICY cmms_biz_opps_staff_manage ON public.cmms_business_opportunities
  FOR INSERT TO authenticated WITH CHECK (
    public.cmms_has_tool_action(cmms_company_id, 'opportunities', 'manage')
  );

DROP POLICY IF EXISTS cmms_biz_opps_staff_update ON public.cmms_business_opportunities;
CREATE POLICY cmms_biz_opps_staff_update ON public.cmms_business_opportunities
  FOR UPDATE TO authenticated USING (
    public.cmms_has_tool_action(cmms_company_id, 'opportunities', 'manage')
  ) WITH CHECK (
    public.cmms_has_tool_action(cmms_company_id, 'opportunities', 'manage')
  );

DROP POLICY IF EXISTS cmms_biz_opps_staff_delete ON public.cmms_business_opportunities;
CREATE POLICY cmms_biz_opps_staff_delete ON public.cmms_business_opportunities
  FOR DELETE TO authenticated USING (
    public.cmms_has_tool_action(cmms_company_id, 'opportunities', 'manage')
  );

-- ============================================================
-- 2. cmms_business_opportunity_bids -- private bids on an opportunity
-- ============================================================
-- Exactly one of bidder_ican_user_id / bidder_cmms_company_id is set,
-- matching bidder_type -- an individual bidding as themselves from their
-- resume page, or a company's staff bidding on behalf of that business.

CREATE TABLE IF NOT EXISTS public.cmms_business_opportunity_bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES public.cmms_business_opportunities(id) ON DELETE CASCADE,

  bidder_type VARCHAR(10) NOT NULL CHECK (bidder_type IN ('individual', 'business')),
  bidder_ican_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  bidder_cmms_company_id UUID REFERENCES public.cmms_company_profiles(id) ON DELETE SET NULL,
  bidder_name VARCHAR(255) NOT NULL CHECK (TRIM(bidder_name) <> ''),
  bidder_contact VARCHAR(255),

  amount NUMERIC(14, 2),
  proposal TEXT NOT NULL CHECK (TRIM(proposal) <> ''),

  status VARCHAR(20) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'selected', 'rejected', 'withdrawn')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cmms_biz_bids_identity_chk CHECK (
    (bidder_type = 'individual' AND bidder_ican_user_id IS NOT NULL AND bidder_cmms_company_id IS NULL)
    OR (bidder_type = 'business' AND bidder_cmms_company_id IS NOT NULL AND bidder_ican_user_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_cmms_biz_bids_opportunity ON public.cmms_business_opportunity_bids(opportunity_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cmms_biz_bids_individual ON public.cmms_business_opportunity_bids(opportunity_id, bidder_ican_user_id) WHERE bidder_ican_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cmms_biz_bids_business ON public.cmms_business_opportunity_bids(opportunity_id, bidder_cmms_company_id) WHERE bidder_cmms_company_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_cmms_biz_bids_touch_updated_at ON public.cmms_business_opportunity_bids;
CREATE TRIGGER trg_cmms_biz_bids_touch_updated_at
  BEFORE UPDATE ON public.cmms_business_opportunity_bids
  FOR EACH ROW EXECUTE FUNCTION public.cmms_touch_updated_at();

ALTER TABLE public.cmms_business_opportunity_bids ENABLE ROW LEVEL SECURITY;

-- Private: a bidder sees only their own bid; the posting company's
-- permitted staff see every bid on their own opportunity.
DROP POLICY IF EXISTS cmms_biz_bids_select ON public.cmms_business_opportunity_bids;
CREATE POLICY cmms_biz_bids_select ON public.cmms_business_opportunity_bids
  FOR SELECT TO authenticated USING (
    bidder_ican_user_id = auth.uid()
    OR (bidder_cmms_company_id IS NOT NULL AND public.cmms_current_user_id_for_company(bidder_cmms_company_id) IS NOT NULL)
    OR EXISTS (
      SELECT 1 FROM public.cmms_business_opportunities o
      WHERE o.id = cmms_business_opportunity_bids.opportunity_id
        AND public.cmms_has_tool_action(o.cmms_company_id, 'opportunities', 'view')
    )
  );

-- Bidding needs no special permission -- any signed-in user can bid as
-- themselves; any active member of a CMMS company can bid as that
-- business. Can't bid on your own company's opportunity, and only while
-- it's still open.
DROP POLICY IF EXISTS cmms_biz_bids_insert ON public.cmms_business_opportunity_bids;
CREATE POLICY cmms_biz_bids_insert ON public.cmms_business_opportunity_bids
  FOR INSERT TO authenticated WITH CHECK (
    status = 'submitted'
    AND (
      (bidder_type = 'individual' AND bidder_ican_user_id = auth.uid())
      OR (bidder_type = 'business' AND public.cmms_current_user_id_for_company(bidder_cmms_company_id) IS NOT NULL)
    )
    AND EXISTS (
      SELECT 1 FROM public.cmms_business_opportunities o
      WHERE o.id = opportunity_id
        AND o.status = 'open'
        AND (o.deadline IS NULL OR o.deadline > NOW())
        AND o.cmms_company_id IS DISTINCT FROM bidder_cmms_company_id
    )
  );

-- A bidder may edit or withdraw their own bid while it's still pending
-- and the opportunity is still open.
DROP POLICY IF EXISTS cmms_biz_bids_bidder_update ON public.cmms_business_opportunity_bids;
CREATE POLICY cmms_biz_bids_bidder_update ON public.cmms_business_opportunity_bids
  FOR UPDATE TO authenticated USING (
    status = 'submitted'
    AND (
      bidder_ican_user_id = auth.uid()
      OR (bidder_cmms_company_id IS NOT NULL AND public.cmms_current_user_id_for_company(bidder_cmms_company_id) IS NOT NULL)
    )
  ) WITH CHECK (
    status IN ('submitted', 'withdrawn')
    AND (
      bidder_ican_user_id = auth.uid()
      OR (bidder_cmms_company_id IS NOT NULL AND public.cmms_current_user_id_for_company(bidder_cmms_company_id) IS NOT NULL)
    )
  );

-- ============================================================
-- 3. fn_select_opportunity_bid -- staff-only. Atomically marks one bid
-- selected, rejects the rest, and closes the opportunity as awarded.
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_select_opportunity_bid(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_select_opportunity_bid(p_bid_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opportunity_id UUID;
  v_company_id UUID;
  v_opportunity_status VARCHAR;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  SELECT o.id, o.cmms_company_id, o.status
  INTO v_opportunity_id, v_company_id, v_opportunity_status
  FROM public.cmms_business_opportunity_bids b
  JOIN public.cmms_business_opportunities o ON o.id = b.opportunity_id
  WHERE b.id = p_bid_id;

  IF v_opportunity_id IS NULL THEN
    RAISE EXCEPTION 'Bid not found.';
  END IF;

  IF NOT public.cmms_has_tool_action(v_company_id, 'opportunities', 'manage') THEN
    RAISE EXCEPTION 'You do not have permission to decide this opportunity.';
  END IF;

  IF v_opportunity_status != 'open' THEN
    RAISE EXCEPTION 'This opportunity has already been decided.';
  END IF;

  UPDATE public.cmms_business_opportunity_bids SET status = 'selected', updated_at = NOW() WHERE id = p_bid_id;
  UPDATE public.cmms_business_opportunity_bids SET status = 'rejected', updated_at = NOW()
    WHERE opportunity_id = v_opportunity_id AND id != p_bid_id AND status = 'submitted';
  UPDATE public.cmms_business_opportunities SET status = 'awarded', updated_at = NOW() WHERE id = v_opportunity_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_select_opportunity_bid(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS business opportunities & bids installed' AS status;
