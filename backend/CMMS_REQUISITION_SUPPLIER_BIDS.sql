-- ============================================================
-- CMMS Requisition -> Supplier Bids (itemised request for quotation)
-- ============================================================
-- An approved requisition lists the items a company needs to buy. This file
-- lets that list be opened to supplier businesses as a bid opportunity:
--
--   approved requisition
--     -> cmms_publish_requisition_for_bids   (status -> 'sourcing')
--     -> suppliers quote a unit price for EVERY item
--        (cmms_submit_supplier_bid, from the Supplier Portal)
--     -> buyer compares bids side by side
--     -> cmms_award_requisition_bid          (status -> 'ordered')
--          creates ONE supplier_marketplace_orders row and ONE business-wallet
--          payment request, exactly like cmms_create_supplier_purchase_order,
--          so the store/company wallet administrator still approves the
--          payment with the business-wallet PIN.
--     -> supplier marks the order fulfilled -> requisition 'completed'
--
-- It reuses the existing opportunity/bid tables
-- (CMMS_BUSINESS_OPPORTUNITIES_AND_BIDS.sql) instead of adding a parallel
-- tender system: an opportunity gains opportunity_kind = 'supply' plus a link
-- to its requisition, and a bid gains a fourth identity, 'supplier' (a
-- published business_profiles row) with per-item prices.
--
-- Why a new 'sourcing' / 'ordered' requisition status: fn_update_requisition_status
-- lets finance mark an 'approved' requisition 'completed', which debits the
-- company wallet for the ESTIMATED cost. A requisition that is being (or has
-- been) sourced through a supplier order is paid through the supplier order's
-- wallet request instead, so it must leave 'approved' or it could be paid
-- twice. RequisitionApprovalsTab only offers the payout for status 'approved'.
--
-- Money: UGX only, settled at the shared ICAN/UGX floor rate (5000), the same
-- rate cmms_create_supplier_purchase_order uses for supplier orders.
--
-- Visibility: an opportunity's basic listing and its items are visible to any
-- signed-in user (same as every opportunity). Bids stay PRIVATE: the buyer's
-- permitted staff see all bids; a supplier sees only its own.
--
-- Run after: CMMS_BUSINESS_OPPORTUNITIES_AND_BIDS.sql,
-- CMMS_OPPORTUNITY_BID_PIPELINE.sql, CMMS_OPPORTUNITY_PUBLIC_PAGE.sql,
-- CMMS_OPPORTUNITY_ANONYMOUS_BID.sql, CMMS_SUPPLIER_PURCHASE_ORDERS.sql,
-- CMMS_SUPPLIER_MARKETPLACE_SMART_MATCH.sql, ICAN_BUSINESS_WALLET_TRANSFERS.sql.
-- Safe to run more than once.
-- ============================================================

-- ============================================================
-- 1. Opportunities: kind + requisition link
-- ============================================================

ALTER TABLE public.cmms_business_opportunities
  ADD COLUMN IF NOT EXISTS opportunity_kind VARCHAR(20) NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS cmms_requisition_id UUID REFERENCES public.cmms_requisitions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_location TEXT;

ALTER TABLE public.cmms_business_opportunities
  DROP CONSTRAINT IF EXISTS cmms_biz_opps_kind_chk;
ALTER TABLE public.cmms_business_opportunities
  ADD CONSTRAINT cmms_biz_opps_kind_chk CHECK (opportunity_kind IN ('general', 'supply'));

-- One live tender per requisition.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cmms_biz_opps_open_requisition
  ON public.cmms_business_opportunities(cmms_requisition_id)
  WHERE cmms_requisition_id IS NOT NULL AND status = 'open';

CREATE INDEX IF NOT EXISTS idx_cmms_biz_opps_requisition
  ON public.cmms_business_opportunities(cmms_requisition_id)
  WHERE cmms_requisition_id IS NOT NULL;

-- ============================================================
-- 2. The items a supply request asks for
-- ============================================================
-- A snapshot of the requisition's line items at publish time. Deliberately
-- carries NO price: the buyer's estimate is internal budget information.

CREATE TABLE IF NOT EXISTS public.cmms_opportunity_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES public.cmms_business_opportunities(id) ON DELETE CASCADE,
  requisition_item_id UUID REFERENCES public.cmms_requisition_items(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  item_name VARCHAR(255) NOT NULL CHECK (TRIM(item_name) <> ''),
  description TEXT,
  quantity NUMERIC(14, 2) NOT NULL CHECK (quantity > 0),
  unit VARCHAR(50) NOT NULL DEFAULT 'unit',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmms_opp_items_opportunity ON public.cmms_opportunity_items(opportunity_id);

ALTER TABLE public.cmms_opportunity_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cmms_opp_items_authenticated_select ON public.cmms_opportunity_items;
CREATE POLICY cmms_opp_items_authenticated_select ON public.cmms_opportunity_items
  FOR SELECT TO authenticated USING (true);
-- No insert/update/delete policies: rows are only written by
-- cmms_publish_requisition_for_bids (SECURITY DEFINER).

-- ============================================================
-- 3. Bids: supplier identity, lead time, resulting order
-- ============================================================

ALTER TABLE public.cmms_business_opportunity_bids
  ADD COLUMN IF NOT EXISTS bidder_business_profile_id UUID REFERENCES public.business_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_time_days INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  ADD COLUMN IF NOT EXISTS supplier_order_id UUID REFERENCES public.supplier_marketplace_orders(id) ON DELETE SET NULL;

-- Superset of every earlier version of these two constraints
-- (individual / business / anonymous), plus 'supplier'.
ALTER TABLE public.cmms_business_opportunity_bids
  DROP CONSTRAINT IF EXISTS cmms_business_opportunity_bids_bidder_type_check;
ALTER TABLE public.cmms_business_opportunity_bids
  ADD CONSTRAINT cmms_business_opportunity_bids_bidder_type_check
  CHECK (bidder_type IN ('individual', 'business', 'anonymous', 'supplier'));

ALTER TABLE public.cmms_business_opportunity_bids
  DROP CONSTRAINT IF EXISTS cmms_biz_bids_identity_chk;
ALTER TABLE public.cmms_business_opportunity_bids
  ADD CONSTRAINT cmms_biz_bids_identity_chk CHECK (
    (bidder_type = 'individual' AND bidder_ican_user_id IS NOT NULL AND bidder_cmms_company_id IS NULL AND bidder_business_profile_id IS NULL)
    OR (bidder_type = 'business' AND bidder_cmms_company_id IS NOT NULL AND bidder_ican_user_id IS NULL AND bidder_business_profile_id IS NULL)
    OR (bidder_type = 'anonymous' AND bidder_ican_user_id IS NULL AND bidder_cmms_company_id IS NULL AND bidder_business_profile_id IS NULL)
    OR (bidder_type = 'supplier' AND bidder_business_profile_id IS NOT NULL AND bidder_ican_user_id IS NULL AND bidder_cmms_company_id IS NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_cmms_biz_bids_supplier
  ON public.cmms_business_opportunity_bids(opportunity_id, bidder_business_profile_id)
  WHERE bidder_business_profile_id IS NOT NULL;

-- A supplier's price for one requested item.
CREATE TABLE IF NOT EXISTS public.cmms_opportunity_bid_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id UUID NOT NULL REFERENCES public.cmms_business_opportunity_bids(id) ON DELETE CASCADE,
  opportunity_item_id UUID NOT NULL REFERENCES public.cmms_opportunity_items(id) ON DELETE CASCADE,
  unit_price NUMERIC(14, 2) NOT NULL CHECK (unit_price >= 0),
  notes TEXT,
  UNIQUE (bid_id, opportunity_item_id)
);

CREATE INDEX IF NOT EXISTS idx_cmms_opp_bid_items_bid ON public.cmms_opportunity_bid_items(bid_id);

ALTER TABLE public.cmms_opportunity_bid_items ENABLE ROW LEVEL SECURITY;

-- Inherits the bid's own privacy: the sub-select runs under the caller's RLS
-- on cmms_business_opportunity_bids, so a row is visible exactly when its bid is.
DROP POLICY IF EXISTS cmms_opp_bid_items_select ON public.cmms_opportunity_bid_items;
CREATE POLICY cmms_opp_bid_items_select ON public.cmms_opportunity_bid_items
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.cmms_business_opportunity_bids b WHERE b.id = cmms_opportunity_bid_items.bid_id)
  );

-- Bid visibility: everything the earlier policy allowed, plus (a) the
-- supplier's own business members and (b) the buyer's purchasing / approving
-- staff for a requisition tender (they need not hold 'opportunities: view').
DROP POLICY IF EXISTS cmms_biz_bids_select ON public.cmms_business_opportunity_bids;
CREATE POLICY cmms_biz_bids_select ON public.cmms_business_opportunity_bids
  FOR SELECT TO authenticated USING (
    bidder_ican_user_id = auth.uid()
    OR (bidder_cmms_company_id IS NOT NULL AND public.cmms_current_user_id_for_company(bidder_cmms_company_id) IS NOT NULL)
    OR (bidder_business_profile_id IS NOT NULL AND public.unified_business_member(bidder_business_profile_id))
    OR EXISTS (
      SELECT 1 FROM public.cmms_business_opportunities o
      WHERE o.id = cmms_business_opportunity_bids.opportunity_id
        AND (
          public.cmms_has_tool_action(o.cmms_company_id, 'opportunities', 'view')
          OR (
            o.opportunity_kind = 'supply'
            AND (
              public.cmms_has_tool_action(o.cmms_company_id, 'requisitions', 'purchase')
              OR public.cmms_has_tool_action(o.cmms_company_id, 'requisitions', 'approve')
            )
          )
        )
    )
  );

-- ============================================================
-- 4. Guards
-- ============================================================

-- A supply request is itemised, so a flat "amount + proposal" bid (an
-- individual, a CMMS company, or an anonymous visitor via
-- fn_submit_public_opportunity_bid) is meaningless on it. One trigger covers
-- every insert path.
CREATE OR REPLACE FUNCTION public.cmms_block_flat_bid_on_supply()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.bidder_type <> 'supplier' AND EXISTS (
    SELECT 1 FROM public.cmms_business_opportunities o
    WHERE o.id = NEW.opportunity_id AND o.opportunity_kind = 'supply'
  ) THEN
    RAISE EXCEPTION 'This is an itemised supply request. Only a published supplier business can bid, with a unit price for every item.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cmms_block_flat_bid_on_supply ON public.cmms_business_opportunity_bids;
CREATE TRIGGER trg_cmms_block_flat_bid_on_supply
  BEFORE INSERT ON public.cmms_business_opportunity_bids
  FOR EACH ROW EXECUTE FUNCTION public.cmms_block_flat_bid_on_supply();

-- The generic "Select Winner" would mark a supply bid selected without
-- creating the order / payment request and leave the requisition stuck in
-- 'sourcing'. Identical to the original, plus one guard.
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
  v_kind VARCHAR;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  SELECT o.id, o.cmms_company_id, o.status, o.opportunity_kind
  INTO v_opportunity_id, v_company_id, v_opportunity_status, v_kind
  FROM public.cmms_business_opportunity_bids b
  JOIN public.cmms_business_opportunities o ON o.id = b.opportunity_id
  WHERE b.id = p_bid_id;

  IF v_opportunity_id IS NULL THEN
    RAISE EXCEPTION 'Bid not found.';
  END IF;

  IF NOT public.cmms_has_tool_action(v_company_id, 'opportunities', 'manage') THEN
    RAISE EXCEPTION 'You do not have permission to decide this opportunity.';
  END IF;

  IF v_kind = 'supply' THEN
    RAISE EXCEPTION 'Supply requests are awarded from the requisition, which also raises the supplier order and payment request.';
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

-- Whoever closes a supply request without awarding it (the Cancel button in
-- the Opportunities tab, or cmms_cancel_requisition_tender below) puts the
-- requisition back to 'approved' so it can be re-tendered or paid normally.
CREATE OR REPLACE FUNCTION public.cmms_supply_opportunity_status_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.cmms_requisition_id IS NOT NULL
     AND OLD.status = 'open'
     AND NEW.status IN ('cancelled', 'closed') THEN
    UPDATE public.cmms_requisitions
       SET status = 'approved', updated_at = NOW()
     WHERE id = NEW.cmms_requisition_id AND status = 'sourcing';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cmms_supply_opportunity_status_sync ON public.cmms_business_opportunities;
CREATE TRIGGER trg_cmms_supply_opportunity_status_sync
  AFTER UPDATE OF status ON public.cmms_business_opportunities
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.cmms_supply_opportunity_status_sync();

-- ============================================================
-- 5. Buyer side
-- ============================================================

-- Who may open a requisition to bids and award it: the same people who may
-- place supplier orders ('requisitions: purchase') or manage opportunities.
CREATE OR REPLACE FUNCTION public.cmms_can_source_requisition(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.cmms_has_tool_action(p_company_id, 'requisitions', 'purchase')
      OR public.cmms_has_tool_action(p_company_id, 'opportunities', 'manage');
$$;

CREATE OR REPLACE FUNCTION public.cmms_publish_requisition_for_bids(
  p_requisition_id UUID,
  p_deadline TIMESTAMPTZ,
  p_notes TEXT DEFAULT NULL,
  p_delivery_location TEXT DEFAULT NULL
)
RETURNS public.cmms_business_opportunities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.cmms_requisitions;
  v_opp public.cmms_business_opportunities;
  v_item_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  SELECT * INTO v_req FROM public.cmms_requisitions WHERE id = p_requisition_id FOR UPDATE;
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Requisition not found.';
  END IF;

  IF NOT public.cmms_can_source_requisition(v_req.cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to request supplier bids.';
  END IF;

  IF v_req.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved requisitions can be opened for supplier bids (this one is "%").', v_req.status;
  END IF;

  IF p_deadline IS NULL OR p_deadline <= NOW() THEN
    RAISE EXCEPTION 'Choose a bid deadline in the future.';
  END IF;

  -- Awarding raises a business-wallet payment request, so the buyer must be
  -- linked to a business profile before suppliers spend time quoting.
  IF NOT EXISTS (
    SELECT 1 FROM public.cmms_company_profiles cp
    WHERE cp.id = v_req.cmms_company_id AND cp.pichin_business_profile_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'This company is not linked to a business profile, so supplier orders cannot be paid from its wallet.';
  END IF;

  SELECT COUNT(*) INTO v_item_count
  FROM public.cmms_requisition_items ri
  WHERE ri.requisition_id = v_req.id AND COALESCE(ri.status, 'pending') <> 'cancelled';
  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'This requisition has no line items to request bids for.';
  END IF;

  INSERT INTO public.cmms_business_opportunities (
    cmms_company_id, title, description, deadline, status, created_by,
    opportunity_kind, cmms_requisition_id, delivery_location
  ) VALUES (
    v_req.cmms_company_id,
    LEFT('Supply request ' || v_req.requisition_number || ' - ' || v_req.purpose, 255),
    COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Quotation requested for the items listed below.'),
    p_deadline,
    'open',
    public.cmms_current_user_id_for_company(v_req.cmms_company_id),
    'supply',
    v_req.id,
    NULLIF(TRIM(COALESCE(p_delivery_location, '')), '')
  ) RETURNING * INTO v_opp;

  INSERT INTO public.cmms_opportunity_items (
    opportunity_id, requisition_item_id, sort_order, item_name, description, quantity, unit
  )
  SELECT v_opp.id, ri.id,
         (ROW_NUMBER() OVER (ORDER BY ri.created_at, ri.id))::INTEGER,
         ri.item_name, ri.item_description, ri.requested_quantity,
         COALESCE(NULLIF(TRIM(COALESCE(ri.unit_of_measure, '')), ''), 'unit')
  FROM public.cmms_requisition_items ri
  WHERE ri.requisition_id = v_req.id AND COALESCE(ri.status, 'pending') <> 'cancelled';

  UPDATE public.cmms_requisitions
     SET status = 'sourcing', updated_at = NOW()
   WHERE id = v_req.id;

  RETURN v_opp;
END;
$$;

CREATE OR REPLACE FUNCTION public.cmms_cancel_requisition_tender(p_opportunity_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opp public.cmms_business_opportunities;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  SELECT * INTO v_opp FROM public.cmms_business_opportunities WHERE id = p_opportunity_id FOR UPDATE;
  IF v_opp.id IS NULL OR v_opp.opportunity_kind <> 'supply' THEN
    RAISE EXCEPTION 'Supply request not found.';
  END IF;
  IF NOT public.cmms_can_source_requisition(v_opp.cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to cancel this supply request.';
  END IF;
  IF v_opp.status <> 'open' THEN
    RAISE EXCEPTION 'This supply request has already been decided.';
  END IF;

  -- The status trigger returns the requisition to 'approved'.
  UPDATE public.cmms_business_opportunities SET status = 'cancelled', updated_at = NOW() WHERE id = v_opp.id;
END;
$$;

-- Awards one bid: marks it selected and rejects the rest, closes the
-- opportunity, creates the supplier order + wallet payment request, and moves
-- the requisition to 'ordered' -- all in one transaction, so a failing wallet
-- request (e.g. no permission on the company wallet) awards nothing.
CREATE OR REPLACE FUNCTION public.cmms_award_requisition_bid(
  p_bid_id UUID,
  p_delivery_details JSONB DEFAULT '{}'::JSONB
)
RETURNS public.supplier_marketplace_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_bid public.cmms_business_opportunity_bids;
  v_opp public.cmms_business_opportunities;
  v_req public.cmms_requisitions;
  v_company public.cmms_company_profiles;
  v_cmms_user_id UUID;
  v_order public.supplier_marketplace_orders;
  v_lines JSONB;
  v_total NUMERIC;
  v_amount_ican NUMERIC;
  v_payment JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  SELECT * INTO v_bid FROM public.cmms_business_opportunity_bids WHERE id = p_bid_id;
  IF v_bid.id IS NULL OR v_bid.bidder_business_profile_id IS NULL THEN
    RAISE EXCEPTION 'Supplier bid not found.';
  END IF;

  SELECT * INTO v_opp FROM public.cmms_business_opportunities WHERE id = v_bid.opportunity_id FOR UPDATE;
  IF v_opp.id IS NULL OR v_opp.opportunity_kind <> 'supply' OR v_opp.cmms_requisition_id IS NULL THEN
    RAISE EXCEPTION 'This bid does not belong to a requisition supply request.';
  END IF;

  IF NOT public.cmms_can_source_requisition(v_opp.cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to award this supply request.';
  END IF;

  IF v_opp.status <> 'open' THEN
    RAISE EXCEPTION 'This supply request has already been decided.';
  END IF;
  IF v_bid.status IN ('selected', 'rejected', 'withdrawn') THEN
    RAISE EXCEPTION 'This bid is no longer available to award (%).', v_bid.status;
  END IF;

  SELECT * INTO v_req FROM public.cmms_requisitions WHERE id = v_opp.cmms_requisition_id FOR UPDATE;
  IF v_req.id IS NULL OR v_req.status <> 'sourcing' THEN
    RAISE EXCEPTION 'The requisition is not waiting for a supplier award.';
  END IF;

  SELECT * INTO v_company FROM public.cmms_company_profiles WHERE id = v_opp.cmms_company_id AND is_active;
  IF v_company.id IS NULL OR v_company.pichin_business_profile_id IS NULL THEN
    RAISE EXCEPTION 'This company is not linked to a business profile, so the supplier order cannot be paid.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.supplier_directory sd
    WHERE sd.business_profile_id = v_bid.bidder_business_profile_id AND sd.is_published
  ) THEN
    RAISE EXCEPTION 'This supplier is no longer published.';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'item_name', oi.item_name,
           'quantity', oi.quantity,
           'unit', oi.unit,
           'unit_price', bi.unit_price,
           'line_total', ROUND(oi.quantity * bi.unit_price, 2)
         ) ORDER BY oi.sort_order),
         COALESCE(SUM(ROUND(oi.quantity * bi.unit_price, 2)), 0)
    INTO v_lines, v_total
    FROM public.cmms_opportunity_bid_items bi
    JOIN public.cmms_opportunity_items oi ON oi.id = bi.opportunity_item_id
   WHERE bi.bid_id = v_bid.id;

  IF v_lines IS NULL OR v_total <= 0 THEN
    RAISE EXCEPTION 'This bid has no priced items.';
  END IF;

  v_cmms_user_id := public.cmms_current_user_id_for_company(v_opp.cmms_company_id);
  v_amount_ican := ROUND(v_total / 5000, 8); -- shared ICAN UGX floor rate

  INSERT INTO public.supplier_marketplace_orders (
    buyer_business_profile_id, supplier_business_profile_id, supplier_catalog_item_id,
    order_number, quantity, unit_price, currency, status, delivery_details, metadata,
    created_by, cmms_company_id, cmms_requisition_id, created_by_cmms_user_id, payment_status
  ) VALUES (
    v_company.pichin_business_profile_id, v_bid.bidder_business_profile_id, NULL,
    'CMMS-PO-' || UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 12)),
    -- One order for the whole bid: quantity 1 at the bid total, with the
    -- itemised lines in metadata, so the buyer approves a single wallet request.
    1, v_total, 'UGX', 'accepted',
    jsonb_strip_nulls(jsonb_build_object('address', v_opp.delivery_location) || COALESCE(p_delivery_details, '{}'::JSONB)),
    jsonb_build_object(
      'source_app', 'cmms_requisition_bid',
      'cmms_company_id', v_opp.cmms_company_id,
      'opportunity_id', v_opp.id,
      'bid_id', v_bid.id,
      'requisition_number', v_req.requisition_number,
      'lead_time_days', v_bid.lead_time_days,
      'items', v_lines,
      'amount_ugx', v_total,
      'amount_ican', v_amount_ican
    ),
    auth.uid(), v_opp.cmms_company_id, v_req.id, v_cmms_user_id, 'not_requested'
  ) RETURNING * INTO v_order;

  v_payment := public.pitchin_business_wallet_transfer_to_business(
    v_company.pichin_business_profile_id, v_bid.bidder_business_profile_id, v_amount_ican,
    'Supplier order ' || v_order.order_number, v_order.id::TEXT, NULL);

  UPDATE public.supplier_marketplace_orders
     SET wallet_transaction_id = (v_payment ->> 'transaction_id')::UUID,
         payment_status = 'pending_approval',
         updated_at = NOW()
   WHERE id = v_order.id
   RETURNING * INTO v_order;

  UPDATE public.cmms_business_opportunity_bids
     SET status = 'selected', supplier_order_id = v_order.id,
         status_updated_at = NOW(), status_updated_by = v_cmms_user_id, updated_at = NOW()
   WHERE id = v_bid.id;
  UPDATE public.cmms_business_opportunity_bids
     SET status = 'rejected', status_updated_at = NOW(), status_updated_by = v_cmms_user_id, updated_at = NOW()
   WHERE opportunity_id = v_opp.id AND id <> v_bid.id
     AND status IN ('submitted', 'under_review', 'shortlisted', 'interview');

  UPDATE public.cmms_business_opportunities SET status = 'awarded', updated_at = NOW() WHERE id = v_opp.id;

  UPDATE public.cmms_requisitions
     SET status = 'ordered',
         order_placed_by = v_cmms_user_id,
         order_placed_date = NOW(),
         po_number = v_order.order_number,
         expected_delivery_date = CASE WHEN v_bid.lead_time_days IS NOT NULL
                                       THEN NOW() + (v_bid.lead_time_days || ' days')::INTERVAL
                                       ELSE expected_delivery_date END,
         updated_at = NOW()
   WHERE id = v_req.id;

  RETURN v_order;
END;
$$;

-- When the supplier marks the awarded order fulfilled, close the requisition.
CREATE OR REPLACE FUNCTION public.cmms_sync_requisition_bid_order_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.cmms_requisition_id IS NOT NULL
     AND NEW.metadata ->> 'source_app' = 'cmms_requisition_bid'
     AND NEW.status = 'fulfilled' THEN
    UPDATE public.cmms_requisitions
       SET status = 'completed',
           actual_delivery_date = COALESCE(actual_delivery_date, NOW()),
           updated_at = NOW()
     WHERE id = NEW.cmms_requisition_id AND status = 'ordered';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cmms_requisition_bid_order_status ON public.supplier_marketplace_orders;
CREATE TRIGGER trg_cmms_requisition_bid_order_status
  AFTER UPDATE OF status ON public.supplier_marketplace_orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.cmms_sync_requisition_bid_order_status();

-- ============================================================
-- 6. Supplier side
-- ============================================================

CREATE OR REPLACE FUNCTION public.cmms_submit_supplier_bid(
  p_opportunity_id UUID,
  p_supplier_business_profile_id UUID,
  p_items JSONB,
  p_proposal TEXT DEFAULT NULL,
  p_lead_time_days INTEGER DEFAULT NULL,
  p_contact TEXT DEFAULT NULL
)
RETURNS public.cmms_business_opportunity_bids
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_opp public.cmms_business_opportunities;
  v_bid public.cmms_business_opportunity_bids;
  v_business_name TEXT;
  v_buyer_business_id UUID;
  v_requested INTEGER;
  v_total NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  IF NOT public.unified_business_member(p_supplier_business_profile_id) THEN
    RAISE EXCEPTION 'You are not an active member of this supplier business.';
  END IF;

  SELECT bp.business_name INTO v_business_name
  FROM public.business_profiles bp
  JOIN public.supplier_directory sd ON sd.business_profile_id = bp.id AND sd.is_published
  WHERE bp.id = p_supplier_business_profile_id AND COALESCE(bp.status, 'active') = 'active';
  IF v_business_name IS NULL THEN
    RAISE EXCEPTION 'Only a published supplier business can bid on supply requests.';
  END IF;

  SELECT * INTO v_opp
  FROM public.cmms_business_opportunities
  WHERE id = p_opportunity_id
    AND opportunity_kind = 'supply'
    AND status = 'open'
    AND (deadline IS NULL OR deadline > NOW())
  FOR UPDATE;
  IF v_opp.id IS NULL THEN
    RAISE EXCEPTION 'This supply request is not open for bids.';
  END IF;

  SELECT cp.pichin_business_profile_id INTO v_buyer_business_id
  FROM public.cmms_company_profiles cp WHERE cp.id = v_opp.cmms_company_id;
  IF v_buyer_business_id IS NOT DISTINCT FROM p_supplier_business_profile_id THEN
    RAISE EXCEPTION 'You cannot bid on your own business''s supply request.';
  END IF;

  IF p_lead_time_days IS NOT NULL AND p_lead_time_days < 0 THEN
    RAISE EXCEPTION 'Delivery time cannot be negative.';
  END IF;

  -- Every requested item, exactly once, with a positive numeric price.
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Provide a unit price for every requested item.';
  END IF;

  SELECT COUNT(*) INTO v_requested FROM public.cmms_opportunity_items WHERE opportunity_id = v_opp.id;
  IF v_requested = 0 OR jsonb_array_length(p_items) <> v_requested THEN
    RAISE EXCEPTION 'Provide a unit price for every requested item (% items).', v_requested;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cmms_opportunity_items oi
    WHERE oi.opportunity_id = v_opp.id
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) e(value)
        WHERE e.value ->> 'opportunity_item_id' = oi.id::TEXT
          AND (e.value ->> 'unit_price') ~ '^[0-9]+(\.[0-9]+)?$'
          AND (e.value ->> 'unit_price')::NUMERIC > 0
      )
  ) THEN
    RAISE EXCEPTION 'Every requested item needs a unit price greater than zero.';
  END IF;

  SELECT * INTO v_bid
  FROM public.cmms_business_opportunity_bids
  WHERE opportunity_id = v_opp.id AND bidder_business_profile_id = p_supplier_business_profile_id
  FOR UPDATE;

  IF v_bid.id IS NOT NULL THEN
    IF v_bid.status IN ('selected', 'rejected') THEN
      RAISE EXCEPTION 'Your bid on this request has already been decided.';
    END IF;
    -- Revise (or resubmit after withdrawing) while the request is still open.
    UPDATE public.cmms_business_opportunity_bids
       SET status = 'submitted',
           proposal = COALESCE(NULLIF(TRIM(COALESCE(p_proposal, '')), ''), 'Itemised quotation'),
           lead_time_days = p_lead_time_days,
           bidder_contact = NULLIF(TRIM(COALESCE(p_contact, '')), ''),
           bidder_name = v_business_name,
           updated_at = NOW()
     WHERE id = v_bid.id;
    DELETE FROM public.cmms_opportunity_bid_items WHERE bid_id = v_bid.id;
  ELSE
    INSERT INTO public.cmms_business_opportunity_bids (
      opportunity_id, bidder_type, bidder_business_profile_id, bidder_name, bidder_contact,
      amount, proposal, status, lead_time_days
    ) VALUES (
      v_opp.id, 'supplier', p_supplier_business_profile_id, v_business_name,
      NULLIF(TRIM(COALESCE(p_contact, '')), ''),
      0, COALESCE(NULLIF(TRIM(COALESCE(p_proposal, '')), ''), 'Itemised quotation'),
      'submitted', p_lead_time_days
    ) RETURNING * INTO v_bid;
  END IF;

  INSERT INTO public.cmms_opportunity_bid_items (bid_id, opportunity_item_id, unit_price, notes)
  SELECT v_bid.id, (e.value ->> 'opportunity_item_id')::UUID,
         ROUND((e.value ->> 'unit_price')::NUMERIC, 2),
         NULLIF(TRIM(COALESCE(e.value ->> 'notes', '')), '')
  FROM jsonb_array_elements(p_items) e(value);

  -- Total from the stored (rounded) prices, so the bid total always equals
  -- the sum of its lines.
  SELECT COALESCE(SUM(ROUND(oi.quantity * bi.unit_price, 2)), 0) INTO v_total
  FROM public.cmms_opportunity_bid_items bi
  JOIN public.cmms_opportunity_items oi ON oi.id = bi.opportunity_item_id
  WHERE bi.bid_id = v_bid.id;

  UPDATE public.cmms_business_opportunity_bids
     SET amount = v_total, updated_at = NOW()
   WHERE id = v_bid.id
   RETURNING * INTO v_bid;

  RETURN v_bid;
END;
$$;

CREATE OR REPLACE FUNCTION public.cmms_withdraw_supplier_bid(p_bid_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bid public.cmms_business_opportunity_bids;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required.';
  END IF;

  SELECT * INTO v_bid FROM public.cmms_business_opportunity_bids
  WHERE id = p_bid_id AND bidder_business_profile_id IS NOT NULL FOR UPDATE;
  IF v_bid.id IS NULL OR NOT public.unified_business_member(v_bid.bidder_business_profile_id) THEN
    RAISE EXCEPTION 'Bid not found.';
  END IF;
  IF v_bid.status NOT IN ('submitted', 'under_review', 'shortlisted', 'interview') THEN
    RAISE EXCEPTION 'This bid can no longer be withdrawn.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cmms_business_opportunities o WHERE o.id = v_bid.opportunity_id AND o.status = 'open'
  ) THEN
    RAISE EXCEPTION 'This supply request is no longer open.';
  END IF;

  UPDATE public.cmms_business_opportunity_bids SET status = 'withdrawn', updated_at = NOW() WHERE id = v_bid.id;
END;
$$;

-- Open supply requests a supplier can bid on, with the supplier's own bid
-- (if any) so the portal can show "revise" instead of "bid". Read through a
-- function because a supplier is not a member of the buyer's CMMS company
-- and would not otherwise be able to read the buyer's name.
CREATE OR REPLACE FUNCTION public.cmms_get_open_supply_requests(p_supplier_business_profile_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.unified_business_member(p_supplier_business_profile_id) THEN
    RAISE EXCEPTION 'You are not an active member of this supplier business.';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(s.j ORDER BY s.deadline NULLS LAST, s.created_at DESC)
    FROM (
      SELECT
        jsonb_build_object(
          'id', o.id,
          'title', o.title,
          'description', o.description,
          'deadline', o.deadline,
          'delivery_location', o.delivery_location,
          'created_at', o.created_at,
          'company_name', cp.company_name,
          'items', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                     'id', i.id, 'item_name', i.item_name, 'description', i.description,
                     'quantity', i.quantity, 'unit', i.unit) ORDER BY i.sort_order), '[]'::JSONB)
            FROM public.cmms_opportunity_items i WHERE i.opportunity_id = o.id
          ),
          'my_bid', (
            SELECT jsonb_build_object(
                     'id', b.id, 'status', b.status, 'amount', b.amount,
                     'lead_time_days', b.lead_time_days, 'proposal', b.proposal,
                     'items', (
                       SELECT COALESCE(jsonb_agg(jsonb_build_object(
                                'opportunity_item_id', bi.opportunity_item_id,
                                'unit_price', bi.unit_price, 'notes', bi.notes)), '[]'::JSONB)
                       FROM public.cmms_opportunity_bid_items bi WHERE bi.bid_id = b.id))
            FROM public.cmms_business_opportunity_bids b
            WHERE b.opportunity_id = o.id AND b.bidder_business_profile_id = p_supplier_business_profile_id
          )
        ) AS j,
        o.deadline, o.created_at
      FROM public.cmms_business_opportunities o
      JOIN public.cmms_company_profiles cp ON cp.id = o.cmms_company_id
      WHERE o.opportunity_kind = 'supply'
        AND o.status = 'open'
        AND (o.deadline IS NULL OR o.deadline > NOW())
        AND cp.pichin_business_profile_id IS DISTINCT FROM p_supplier_business_profile_id
    ) s
  ), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.cmms_get_my_supplier_bids(p_supplier_business_profile_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.unified_business_member(p_supplier_business_profile_id) THEN
    RAISE EXCEPTION 'You are not an active member of this supplier business.';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', b.id,
             'opportunity_id', o.id,
             'title', o.title,
             'company_name', cp.company_name,
             'opportunity_status', o.status,
             'bid_status', b.status,
             'amount', b.amount,
             'lead_time_days', b.lead_time_days,
             'submitted_at', b.created_at,
             'order_number', ord.order_number,
             'payment_status', ord.payment_status
           ) ORDER BY b.created_at DESC)
    FROM public.cmms_business_opportunity_bids b
    JOIN public.cmms_business_opportunities o ON o.id = b.opportunity_id
    JOIN public.cmms_company_profiles cp ON cp.id = o.cmms_company_id
    LEFT JOIN public.supplier_marketplace_orders ord ON ord.id = b.supplier_order_id
    WHERE b.bidder_business_profile_id = p_supplier_business_profile_id
  ), '[]'::JSONB);
END;
$$;

-- ============================================================
-- 7. Public board -- show the items, kind and delivery place
-- ============================================================
-- Same functions as CMMS_OPPORTUNITY_PUBLIC_PAGE.sql with extra columns, so a
-- visitor sees WHAT is being asked for. Bidding a supply request still needs a
-- signed-in supplier business (cmms_block_flat_bid_on_supply enforces it).

DROP FUNCTION IF EXISTS public.fn_get_public_cmms_opportunities(UUID);
CREATE OR REPLACE FUNCTION public.fn_get_public_cmms_opportunities(p_company_id UUID)
RETURNS TABLE (
  id UUID,
  title VARCHAR,
  description TEXT,
  budget_hint VARCHAR,
  deadline TIMESTAMPTZ,
  poster_url TEXT,
  document_url TEXT,
  created_at TIMESTAMPTZ,
  opportunity_kind VARCHAR
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.title, o.description, o.budget_hint, o.deadline, o.poster_url, o.document_url,
         o.created_at, o.opportunity_kind
  FROM public.cmms_business_opportunities o
  WHERE o.cmms_company_id = p_company_id
    AND o.status = 'open'
    AND (o.deadline IS NULL OR o.deadline > NOW())
  ORDER BY o.created_at DESC;
$$;

DROP FUNCTION IF EXISTS public.fn_get_public_cmms_opportunity(UUID);
CREATE OR REPLACE FUNCTION public.fn_get_public_cmms_opportunity(p_opportunity_id UUID)
RETURNS TABLE (
  id UUID,
  cmms_company_id UUID,
  company_name VARCHAR,
  title VARCHAR,
  description TEXT,
  budget_hint VARCHAR,
  deadline TIMESTAMPTZ,
  poster_url TEXT,
  document_url TEXT,
  created_at TIMESTAMPTZ,
  is_open BOOLEAN,
  opportunity_kind VARCHAR,
  delivery_location TEXT,
  items JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.id, o.cmms_company_id, cp.company_name, o.title, o.description, o.budget_hint,
    o.deadline, o.poster_url, o.document_url, o.created_at,
    (o.status = 'open' AND (o.deadline IS NULL OR o.deadline > NOW())) AS is_open,
    o.opportunity_kind, o.delivery_location,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'item_name', i.item_name, 'description', i.description,
               'quantity', i.quantity, 'unit', i.unit) ORDER BY i.sort_order)
      FROM public.cmms_opportunity_items i WHERE i.opportunity_id = o.id
    ), '[]'::JSONB) AS items
  FROM public.cmms_business_opportunities o
  JOIN public.cmms_company_profiles cp ON cp.id = o.cmms_company_id
  WHERE o.id = p_opportunity_id;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_public_cmms_opportunities(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_public_cmms_opportunity(UUID) TO anon, authenticated;

-- ============================================================
-- 8. Grants
-- ============================================================

REVOKE ALL ON FUNCTION public.cmms_can_source_requisition(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_publish_requisition_for_bids(UUID, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_cancel_requisition_tender(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_award_requisition_bid(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_submit_supplier_bid(UUID, UUID, JSONB, TEXT, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_withdraw_supplier_bid(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_get_open_supply_requests(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_get_my_supplier_bids(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.cmms_can_source_requisition(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_publish_requisition_for_bids(UUID, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_cancel_requisition_tender(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_award_requisition_bid(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_submit_supplier_bid(UUID, UUID, JSONB, TEXT, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_withdraw_supplier_bid(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_get_open_supply_requests(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_get_my_supplier_bids(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS requisition supplier bids (publish / quote / compare / award) installed' AS status;
