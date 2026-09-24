-- ============================================================
-- CMMS STAFF ITEM CUSTODY LOG (ADD-ONLY)
-- ============================================================
-- Lets a staff member "sign" for a specific inventory item when they take
-- it, and sign again when they bring it back, so the business has proof
-- of who has which item and when. Ties into cmms_inventory_items (stock
-- is decremented while an item is checked out, restored on a good/damaged
-- return, written off on a lost one) and cmms_users.
--
-- The acting staff member is ALWAYS resolved server-side from their
-- signed-in email (auth.jwt()->>'email' matched against cmms_users for
-- the item's company) -- never trusted from client input. This mirrors
-- staff_check_in_with_qr / staff_check_out_with_qr in
-- CMMS_STAFF_ATTENDANCE_VISITOR_MANAGEMENT.sql.
--
-- WHAT THIS ADDS:
--   1. public.cmms_item_custody_log          -- one row per take/return cycle
--   2. public._cmms_is_item_custodian(...)   -- helper: admin/storeman/creator
--                                                or the item's assigned storeman
--   3. public.fn_checkout_inventory_item(...) -- staff signs an item OUT
--   4. public.fn_return_inventory_item(...)   -- staff signs an item back IN
--   5. public.fn_get_item_custody_log(...)    -- proof/audit listing
--   6. public.cmms_item_requests + fn_request_inventory_item /
--      fn_decide_item_request / fn_cancel_item_request / fn_get_item_requests
--                                              -- employees request, managers approve
--   7. Role-based access via cmms_roles.tool_access->'item-custody'
--      (request / see_all / manage) -- _cmms_item_custody_can(...) and
--      fn_get_my_item_custody_access(...) -- picked per role by the admin
--      in Role and tool configuration
--
-- Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_item_custody_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES public.cmms_inventory_items(id) ON DELETE CASCADE,

  -- Who holds the item, and who signed it out to them (NULL = self-service)
  cmms_user_id UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
  issued_by_cmms_user_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,

  quantity NUMERIC(10, 2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  purpose TEXT,

  -- Take ("sign out")
  taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  taken_signature_method VARCHAR(30),
  taken_pin_masked VARCHAR(10),
  expected_return_at TIMESTAMPTZ,

  -- Bring back ("sign in")
  returned_at TIMESTAMPTZ,
  received_by_cmms_user_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  return_condition VARCHAR(20) CHECK (return_condition IN ('good', 'damaged', 'lost')),
  return_notes TEXT,
  returned_signature_method VARCHAR(30),
  returned_pin_masked VARCHAR(10),

  status VARCHAR(20) NOT NULL DEFAULT 'checked_out' CHECK (status IN ('checked_out', 'returned', 'lost')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_item_custody_company ON public.cmms_item_custody_log(cmms_company_id, status);
CREATE INDEX IF NOT EXISTS idx_item_custody_item ON public.cmms_item_custody_log(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_item_custody_user ON public.cmms_item_custody_log(cmms_user_id);

ALTER TABLE public.cmms_item_custody_log ENABLE ROW LEVEL SECURITY;

-- Company scoping via cmms_users.id = auth.uid() does not hold in this
-- schema (cmms_users are separate rows matched by email, not the auth
-- user's id -- see FIX_INVENTORY_UPDATE_RLS.sql). All writes therefore go
-- through the SECURITY DEFINER functions below, which do their own
-- email-based company/identity checks; SELECT is left permissive to any
-- signed-in user, matching the existing cmms_inventory_items policy.
DROP POLICY IF EXISTS "item_custody_select_policy" ON public.cmms_item_custody_log;
CREATE POLICY "item_custody_select_policy" ON public.cmms_item_custody_log
FOR SELECT USING (auth.uid() IS NOT NULL);

-- ============================================================
-- Helper: can this cmms_user act "on behalf of" someone else for this
-- item -- an inventory manager (admin/storeman/creator), or the item's
-- own assigned storeman.
-- ============================================================
-- ============================================================
-- Role-based access. The admin picks, per role, in Role and tool
-- configuration -> "Item requests & custody" (cmms_roles.tool_access
-- ->'item-custody'):
--   request  : may ask for items (and sign their own items back in)
--   see_all  : may see every staff member's requests and custody records
--              (without it, a person only sees their own)
--   manage   : may approve/decline requests, record who took an item, and
--              receive returns on someone else's behalf -- implies the two above
-- Company admins/creators and storemen always have every power.
-- ============================================================
CREATE OR REPLACE FUNCTION public._cmms_item_custody_can(p_cmms_user_id UUID, p_action TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.cmms_users u
    WHERE u.id = p_cmms_user_id AND u.is_active = TRUE
      AND (u.is_creator = TRUE OR lower(COALESCE(u.role, '')) IN ('admin', 'storeman'))
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.cmms_users u
    JOIN public.cmms_user_roles ur ON ur.cmms_user_id = u.id AND ur.is_active
    JOIN public.cmms_roles r ON r.id = ur.cmms_role_id AND r.is_active
    WHERE u.id = p_cmms_user_id AND u.is_active = TRUE
      AND (
        (r.tool_access #>> ARRAY['item-custody', p_action]) = 'true'
        OR (r.tool_access #>> ARRAY['item-custody', 'manage']) = 'true'
      )
  );
END;
$$;

-- Can act on a specific item as a manager: has the 'manage' action, or is
-- that item's own assigned storeman.
CREATE OR REPLACE FUNCTION public._cmms_is_item_custodian(p_cmms_user_id UUID, p_inventory_item_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public._cmms_item_custody_can(p_cmms_user_id, 'manage')
    OR EXISTS (
      SELECT 1 FROM public.cmms_inventory_items i
      WHERE i.id = p_inventory_item_id AND i.assigned_storeman_id = p_cmms_user_id
    );
END;
$$;

-- What the signed-in person may do in a company -- the UI reads this so the
-- buttons it shows always match what the server will allow.
CREATE OR REPLACE FUNCTION public.fn_get_my_item_custody_access(p_cmms_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_email TEXT := lower(auth.jwt()->>'email');
  v_user_id UUID;
  v_assigned BOOLEAN;
BEGIN
  IF v_caller_email IS NULL THEN
    RETURN jsonb_build_object('cmms_user_id', NULL, 'can_request', false, 'can_see_all', false, 'can_manage', false);
  END IF;

  SELECT id INTO v_user_id FROM public.cmms_users
  WHERE cmms_company_id = p_cmms_company_id AND is_active = TRUE AND lower(email) = v_caller_email
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('cmms_user_id', NULL, 'can_request', false, 'can_see_all', false, 'can_manage', false);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.cmms_inventory_items i
    WHERE i.cmms_company_id = p_cmms_company_id AND i.assigned_storeman_id = v_user_id
  ) INTO v_assigned;

  RETURN jsonb_build_object(
    'cmms_user_id', v_user_id,
    'can_request', public._cmms_item_custody_can(v_user_id, 'request') OR v_assigned,
    'can_see_all', public._cmms_item_custody_can(v_user_id, 'see_all') OR v_assigned,
    'can_manage', public._cmms_item_custody_can(v_user_id, 'manage') OR v_assigned
  );
END;
$$;

-- ============================================================
-- Sign an item OUT
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_checkout_inventory_item(
  p_inventory_item_id UUID,
  p_quantity NUMERIC DEFAULT 1,
  p_purpose TEXT DEFAULT NULL,
  p_cmms_user_id UUID DEFAULT NULL,          -- who is taking it; NULL = the caller
  p_expected_return_at TIMESTAMPTZ DEFAULT NULL,
  p_signature_method VARCHAR DEFAULT NULL,    -- e.g. 'wallet_pin'
  p_pin_masked VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_email TEXT := lower(auth.jwt()->>'email');
  v_item RECORD;
  v_actor_id UUID;
  v_target_id UUID;
  v_log_id UUID;
BEGIN
  IF v_caller_email IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  SELECT * INTO v_item FROM public.cmms_inventory_items WHERE id = p_inventory_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item not found';
  END IF;

  SELECT id INTO v_actor_id FROM public.cmms_users
  WHERE cmms_company_id = v_item.cmms_company_id AND is_active = TRUE AND lower(email) = v_caller_email
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'You are not an active staff member of this company';
  END IF;

  v_target_id := COALESCE(p_cmms_user_id, v_actor_id);

  -- Employees ask for items through fn_request_inventory_item; only an
  -- inventory manager records a take (for themself or on someone's behalf).
  IF NOT public._cmms_is_item_custodian(v_actor_id, p_inventory_item_id) THEN
    RAISE EXCEPTION 'Only an inventory manager can sign an item out — please submit a request instead';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cmms_users
    WHERE id = v_target_id AND cmms_company_id = v_item.cmms_company_id AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'The selected staff member is not active in this company';
  END IF;

  IF v_item.quantity_in_stock < p_quantity THEN
    RAISE EXCEPTION 'Not enough stock: % available, % requested', v_item.quantity_in_stock, p_quantity;
  END IF;

  UPDATE public.cmms_inventory_items
  SET quantity_in_stock = quantity_in_stock - p_quantity,
      last_stock_check = NOW(),
      updated_at = NOW()
  WHERE id = p_inventory_item_id;

  INSERT INTO public.cmms_item_custody_log (
    cmms_company_id, inventory_item_id, cmms_user_id, issued_by_cmms_user_id,
    quantity, purpose, expected_return_at, taken_signature_method, taken_pin_masked
  ) VALUES (
    v_item.cmms_company_id, p_inventory_item_id, v_target_id,
    CASE WHEN v_target_id <> v_actor_id THEN v_actor_id ELSE NULL END,
    p_quantity, p_purpose, p_expected_return_at, p_signature_method, p_pin_masked
  )
  RETURNING id INTO v_log_id;

  INSERT INTO public.cmms_inventory_audit_log (
    inventory_item_id, action, old_quantity, new_quantity, quantity_change, changed_by, change_reason
  ) VALUES (
    p_inventory_item_id, 'item_checkout', v_item.quantity_in_stock, v_item.quantity_in_stock - p_quantity,
    -p_quantity, v_actor_id, COALESCE(p_purpose, 'Signed out to staff')
  );

  RETURN jsonb_build_object(
    'success', true,
    'custody_id', v_log_id,
    'item_name', v_item.item_name,
    'quantity', p_quantity,
    'message', format('%s signed out (%s %s)', v_item.item_name, p_quantity, COALESCE(v_item.unit_of_measure, 'units'))
  );
END;
$$;

-- ============================================================
-- Sign an item back IN
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_return_inventory_item(
  p_custody_id UUID,
  p_condition VARCHAR DEFAULT 'good',   -- 'good' | 'damaged' | 'lost'
  p_return_notes TEXT DEFAULT NULL,
  p_signature_method VARCHAR DEFAULT NULL,
  p_pin_masked VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_email TEXT := lower(auth.jwt()->>'email');
  v_log RECORD;
  v_item RECORD;
  v_actor_id UUID;
  v_status VARCHAR(20);
BEGIN
  IF v_caller_email IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_condition NOT IN ('good', 'damaged', 'lost') THEN
    RAISE EXCEPTION 'Invalid condition: %', p_condition;
  END IF;

  SELECT * INTO v_log FROM public.cmms_item_custody_log WHERE id = p_custody_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Custody record not found';
  END IF;

  IF v_log.status <> 'checked_out' THEN
    RAISE EXCEPTION 'This item has already been marked as %', v_log.status;
  END IF;

  SELECT id INTO v_actor_id FROM public.cmms_users
  WHERE cmms_company_id = v_log.cmms_company_id AND is_active = TRUE AND lower(email) = v_caller_email
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'You are not an active staff member of this company';
  END IF;

  IF v_actor_id <> v_log.cmms_user_id AND NOT public._cmms_is_item_custodian(v_actor_id, v_log.inventory_item_id) THEN
    RAISE EXCEPTION 'Only the staff member holding this item or an inventory manager can sign it back in';
  END IF;

  v_status := CASE WHEN p_condition = 'lost' THEN 'lost' ELSE 'returned' END;

  UPDATE public.cmms_item_custody_log
  SET returned_at = NOW(),
      received_by_cmms_user_id = CASE WHEN v_actor_id <> v_log.cmms_user_id THEN v_actor_id ELSE NULL END,
      return_condition = p_condition,
      return_notes = p_return_notes,
      returned_signature_method = p_signature_method,
      returned_pin_masked = p_pin_masked,
      status = v_status,
      updated_at = NOW()
  WHERE id = p_custody_id;

  SELECT * INTO v_item FROM public.cmms_inventory_items WHERE id = v_log.inventory_item_id FOR UPDATE;

  IF p_condition <> 'lost' THEN
    UPDATE public.cmms_inventory_items
    SET quantity_in_stock = quantity_in_stock + v_log.quantity,
        last_stock_check = NOW(),
        updated_at = NOW()
    WHERE id = v_log.inventory_item_id;
  END IF;

  INSERT INTO public.cmms_inventory_audit_log (
    inventory_item_id, action, old_quantity, new_quantity, quantity_change, changed_by, change_reason
  ) VALUES (
    v_log.inventory_item_id,
    CASE WHEN p_condition = 'lost' THEN 'item_lost' ELSE 'item_return' END,
    v_item.quantity_in_stock,
    CASE WHEN p_condition = 'lost' THEN v_item.quantity_in_stock ELSE v_item.quantity_in_stock + v_log.quantity END,
    CASE WHEN p_condition = 'lost' THEN 0 ELSE v_log.quantity END,
    v_actor_id,
    COALESCE(p_return_notes, format('Signed back in (%s)', p_condition))
  );

  RETURN jsonb_build_object(
    'success', true,
    'custody_id', p_custody_id,
    'status', v_status,
    'message', CASE WHEN v_status = 'lost' THEN 'Item marked as lost' ELSE 'Item signed back in' END
  );
END;
$$;

-- ============================================================
-- Proof / audit listing
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_get_item_custody_log(
  p_cmms_company_id UUID,
  p_status VARCHAR DEFAULT NULL,        -- NULL = all statuses
  p_cmms_user_id UUID DEFAULT NULL,     -- NULL = everyone
  p_inventory_item_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  inventory_item_id UUID,
  item_name VARCHAR,
  item_code VARCHAR,
  cmms_user_id UUID,
  holder_name VARCHAR,
  issued_by_name VARCHAR,
  received_by_name VARCHAR,
  quantity NUMERIC,
  purpose TEXT,
  taken_at TIMESTAMPTZ,
  expected_return_at TIMESTAMPTZ,
  returned_at TIMESTAMPTZ,
  return_condition VARCHAR,
  return_notes TEXT,
  status VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_email TEXT := lower(auth.jwt()->>'email');
  v_actor_id UUID;
  v_sees_all BOOLEAN;
BEGIN
  IF v_caller_email IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT cu.id INTO v_actor_id FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_cmms_company_id AND cu.is_active = TRUE AND lower(cu.email) = v_caller_email
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'You are not an active staff member of this company';
  END IF;

  v_sees_all := public._cmms_item_custody_can(v_actor_id, 'see_all')
    OR EXISTS (SELECT 1 FROM public.cmms_inventory_items s WHERE s.cmms_company_id = p_cmms_company_id AND s.assigned_storeman_id = v_actor_id);

  RETURN QUERY
  SELECT
    l.id, l.inventory_item_id, i.item_name, i.item_code,
    l.cmms_user_id, holder.user_name, issuer.user_name, receiver.user_name,
    l.quantity, l.purpose, l.taken_at, l.expected_return_at, l.returned_at,
    l.return_condition, l.return_notes, l.status
  FROM public.cmms_item_custody_log l
  JOIN public.cmms_inventory_items i ON i.id = l.inventory_item_id
  JOIN public.cmms_users holder ON holder.id = l.cmms_user_id
  LEFT JOIN public.cmms_users issuer ON issuer.id = l.issued_by_cmms_user_id
  LEFT JOIN public.cmms_users receiver ON receiver.id = l.received_by_cmms_user_id
  WHERE l.cmms_company_id = p_cmms_company_id
    AND (v_sees_all OR l.cmms_user_id = v_actor_id)
    AND (p_status IS NULL OR l.status = p_status)
    AND (p_cmms_user_id IS NULL OR l.cmms_user_id = p_cmms_user_id)
    AND (p_inventory_item_id IS NULL OR l.inventory_item_id = p_inventory_item_id)
  ORDER BY l.taken_at DESC;
END;
$$;

-- ============================================================
-- Employee item REQUESTS
-- An employee asks for an item; an inventory manager approves (which signs
-- the item out to the requester and links the custody record) or declines.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_item_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES public.cmms_inventory_items(id) ON DELETE CASCADE,
  requested_by_cmms_user_id UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  purpose TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  decided_by_cmms_user_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  custody_id UUID REFERENCES public.cmms_item_custody_log(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_item_requests_company ON public.cmms_item_requests(cmms_company_id, status);
CREATE INDEX IF NOT EXISTS idx_item_requests_user ON public.cmms_item_requests(requested_by_cmms_user_id);

ALTER TABLE public.cmms_item_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "item_requests_select_policy" ON public.cmms_item_requests;
CREATE POLICY "item_requests_select_policy" ON public.cmms_item_requests
FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION public.fn_request_inventory_item(
  p_inventory_item_id UUID,
  p_quantity NUMERIC DEFAULT 1,
  p_purpose TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_email TEXT := lower(auth.jwt()->>'email');
  v_item RECORD;
  v_actor_id UUID;
  v_request_id UUID;
BEGIN
  IF v_caller_email IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  SELECT * INTO v_item FROM public.cmms_inventory_items WHERE id = p_inventory_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item not found';
  END IF;

  SELECT id INTO v_actor_id FROM public.cmms_users
  WHERE cmms_company_id = v_item.cmms_company_id AND is_active = TRUE AND lower(email) = v_caller_email
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'You are not an active staff member of this company';
  END IF;

  IF NOT (public._cmms_item_custody_can(v_actor_id, 'request') OR public._cmms_is_item_custodian(v_actor_id, p_inventory_item_id)) THEN
    RAISE EXCEPTION 'Your role is not allowed to request items — ask an admin to enable it';
  END IF;

  INSERT INTO public.cmms_item_requests (cmms_company_id, inventory_item_id, requested_by_cmms_user_id, quantity, purpose)
  VALUES (v_item.cmms_company_id, p_inventory_item_id, v_actor_id, p_quantity, p_purpose)
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object('success', true, 'request_id', v_request_id, 'message', format('Request for %s sent for approval', v_item.item_name));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_decide_item_request(
  p_request_id UUID,
  p_approve BOOLEAN,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_email TEXT := lower(auth.jwt()->>'email');
  v_req RECORD;
  v_actor_id UUID;
  v_checkout JSONB;
  v_custody_id UUID;
BEGIN
  IF v_caller_email IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_req FROM public.cmms_item_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'This request is already %', v_req.status;
  END IF;

  SELECT id INTO v_actor_id FROM public.cmms_users
  WHERE cmms_company_id = v_req.cmms_company_id AND is_active = TRUE AND lower(email) = v_caller_email
  LIMIT 1;

  IF v_actor_id IS NULL OR NOT public._cmms_is_item_custodian(v_actor_id, v_req.inventory_item_id) THEN
    RAISE EXCEPTION 'Only an inventory manager can decide item requests';
  END IF;

  IF p_approve THEN
    -- Signs the item out to the requester; raises if stock is insufficient.
    v_checkout := public.fn_checkout_inventory_item(
      v_req.inventory_item_id, v_req.quantity,
      COALESCE(v_req.purpose, 'Approved request'), v_req.requested_by_cmms_user_id
    );
    v_custody_id := (v_checkout->>'custody_id')::UUID;
  END IF;

  UPDATE public.cmms_item_requests
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'declined' END,
      decided_by_cmms_user_id = v_actor_id,
      decided_at = NOW(),
      decision_note = p_note,
      custody_id = v_custody_id,
      updated_at = NOW()
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', CASE WHEN p_approve THEN 'approved' ELSE 'declined' END,
    'message', CASE WHEN p_approve THEN 'Request approved and item signed out' ELSE 'Request declined' END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_cancel_item_request(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_email TEXT := lower(auth.jwt()->>'email');
  v_req RECORD;
BEGIN
  IF v_caller_email IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT r.* INTO v_req FROM public.cmms_item_requests r
  JOIN public.cmms_users u ON u.id = r.requested_by_cmms_user_id
  WHERE r.id = p_request_id AND lower(u.email) = v_caller_email
  FOR UPDATE OF r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'This request is already %', v_req.status;
  END IF;

  UPDATE public.cmms_item_requests SET status = 'cancelled', updated_at = NOW() WHERE id = p_request_id;
  RETURN jsonb_build_object('success', true, 'message', 'Request cancelled');
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_get_item_requests(
  p_cmms_company_id UUID,
  p_status VARCHAR DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  inventory_item_id UUID,
  item_name VARCHAR,
  unit_of_measure VARCHAR,
  quantity_in_stock NUMERIC,
  requested_by_cmms_user_id UUID,
  requester_name VARCHAR,
  quantity NUMERIC,
  purpose TEXT,
  status VARCHAR,
  decided_by_name VARCHAR,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_email TEXT := lower(auth.jwt()->>'email');
  v_actor_id UUID;
  v_sees_all BOOLEAN;
BEGIN
  IF v_caller_email IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT cu.id INTO v_actor_id FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_cmms_company_id AND cu.is_active = TRUE AND lower(cu.email) = v_caller_email
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'You are not an active staff member of this company';
  END IF;

  v_sees_all := public._cmms_item_custody_can(v_actor_id, 'see_all')
    OR EXISTS (SELECT 1 FROM public.cmms_inventory_items s WHERE s.cmms_company_id = p_cmms_company_id AND s.assigned_storeman_id = v_actor_id);

  RETURN QUERY
  SELECT
    r.id, r.inventory_item_id, i.item_name, i.unit_of_measure, i.quantity_in_stock,
    r.requested_by_cmms_user_id, requester.user_name, r.quantity, r.purpose, r.status,
    decider.user_name, r.decided_at, r.decision_note, r.created_at
  FROM public.cmms_item_requests r
  JOIN public.cmms_inventory_items i ON i.id = r.inventory_item_id
  JOIN public.cmms_users requester ON requester.id = r.requested_by_cmms_user_id
  LEFT JOIN public.cmms_users decider ON decider.id = r.decided_by_cmms_user_id
  WHERE r.cmms_company_id = p_cmms_company_id
    AND (v_sees_all OR r.requested_by_cmms_user_id = v_actor_id)
    AND (p_status IS NULL OR r.status = p_status)
  ORDER BY r.created_at DESC;
END;
$$;

-- ============================================================
-- Grants
-- ============================================================
REVOKE ALL ON FUNCTION public._cmms_item_custody_can FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_get_my_item_custody_access FROM PUBLIC;
REVOKE ALL ON FUNCTION public._cmms_is_item_custodian FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_checkout_inventory_item FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_return_inventory_item FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_get_item_custody_log FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_request_inventory_item FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_decide_item_request FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_cancel_item_request FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_get_item_requests FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fn_get_my_item_custody_access TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_checkout_inventory_item TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_return_inventory_item TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_item_custody_log TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_request_inventory_item TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_decide_item_request TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cancel_item_request TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_item_requests TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS item custody log created successfully!' AS status;
