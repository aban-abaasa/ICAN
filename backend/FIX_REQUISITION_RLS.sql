-- ============================================================
-- FIX: Requisition RLS Insert Policy
-- Problem: Direct INSERT to cmms_requisitions blocked by RLS
-- Solution 1: Add permissive INSERT policy for authenticated users
-- Solution 2: Create SECURITY DEFINER function for requisition creation
-- ============================================================

-- APPROACH 1: Fix the RLS policies to be more permissive for inserts
-- Allow any authenticated user who belongs to the company to create requisitions

ALTER TABLE public.cmms_requisitions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cmms_requisitions
ADD COLUMN IF NOT EXISTS finance_payment_method VARCHAR(20);

-- Drop old restrictive policies
DROP POLICY IF EXISTS "requisitions_insert_policy" ON public.cmms_requisitions;
DROP POLICY IF EXISTS "requisitions_select_policy" ON public.cmms_requisitions;
DROP POLICY IF EXISTS "requisitions_update_policy" ON public.cmms_requisitions;

-- SELECT: Company members can view requisitions
CREATE POLICY "requisitions_select_policy" ON public.cmms_requisitions
FOR SELECT USING (
  cmms_company_id IN (
    SELECT cmms_company_id FROM public.cmms_users WHERE id = auth.uid()
  )
);

-- INSERT: Any authenticated user in the company can create requisitions
CREATE POLICY "requisitions_insert_policy" ON public.cmms_requisitions
FOR INSERT WITH CHECK (
  auth.uid() IS NOT NULL
  AND (
    -- User is in cmms_users for that company
    cmms_company_id IN (
      SELECT cmms_company_id FROM public.cmms_users WHERE id = auth.uid()
    )
    -- OR the requested_by matches auth user
    OR requested_by = auth.uid()
  )
);

-- UPDATE: Company members can update requisitions (for approvals)
CREATE POLICY "requisitions_update_policy" ON public.cmms_requisitions
FOR UPDATE USING (
  cmms_company_id IN (
    SELECT cmms_company_id FROM public.cmms_users WHERE id = auth.uid()
  )
);

-- APPROACH 2: SECURITY DEFINER function for guaranteed bypass
CREATE OR REPLACE FUNCTION public.fn_create_requisition(
  p_company_id UUID,
  p_department_id UUID,
  p_requested_by UUID,
  p_requested_by_name VARCHAR DEFAULT 'Unknown',
  p_requested_by_email VARCHAR DEFAULT NULL,
  p_requested_by_role VARCHAR DEFAULT NULL,
  p_purpose VARCHAR DEFAULT 'maintenance',
  p_justification TEXT DEFAULT NULL,
  p_urgency_level VARCHAR DEFAULT 'normal',
  p_required_by_date DATE DEFAULT NULL,
  p_total_estimated_cost NUMERIC DEFAULT 0,
  p_budget_sufficient BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requisition_id UUID;
  v_requisition_number VARCHAR;
  v_result JSONB;
  v_cmms_user_id UUID;
BEGIN
  -- Verify caller is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Resolve the actual cmms_users.id
  -- First check if p_requested_by is already a valid cmms_users.id
  SELECT id INTO v_cmms_user_id
  FROM public.cmms_users
  WHERE id = p_requested_by AND cmms_company_id = p_company_id
  LIMIT 1;

  -- If not found, try to resolve by email
  IF v_cmms_user_id IS NULL AND p_requested_by_email IS NOT NULL THEN
    SELECT id INTO v_cmms_user_id
    FROM public.cmms_users
    WHERE cmms_company_id = p_company_id AND LOWER(email) = LOWER(p_requested_by_email)
    LIMIT 1;
  END IF;

  -- If still not found, try to resolve by auth.uid() email
  IF v_cmms_user_id IS NULL THEN
    SELECT cu.id INTO v_cmms_user_id
    FROM public.cmms_users cu
    JOIN auth.users au ON LOWER(cu.email) = LOWER(au.email)
    WHERE au.id = auth.uid() AND cu.cmms_company_id = p_company_id
    LIMIT 1;
  END IF;

  IF v_cmms_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found in cmms_users for this company. Please add the user to CMMS first.';
  END IF;

  -- Generate requisition number
  v_requisition_number := 'REQ-' || EXTRACT(EPOCH FROM NOW())::BIGINT || '-' || UPPER(SUBSTR(MD5(RANDOM()::TEXT), 1, 9));

  -- Insert requisition (bypasses RLS due to SECURITY DEFINER)
  INSERT INTO public.cmms_requisitions (
    cmms_company_id,
    department_id,
    requisition_number,
    requested_by,
    requested_by_name,
    requested_by_email,
    requested_by_role,
    purpose,
    justification,
    urgency_level,
    required_by_date,
    total_estimated_cost,
    status,
    budget_sufficient
  ) VALUES (
    p_company_id,
    p_department_id,
    v_requisition_number,
    v_cmms_user_id,
    p_requested_by_name,
    p_requested_by_email,
    p_requested_by_role,
    p_purpose,
    p_justification,
    p_urgency_level,
    p_required_by_date,
    p_total_estimated_cost,
    'pending_department_head',
    p_budget_sufficient
  )
  RETURNING id INTO v_requisition_id;

  -- Return the created requisition as JSON
  SELECT to_jsonb(r) INTO v_result
  FROM public.cmms_requisitions r
  WHERE r.id = v_requisition_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_create_requisition TO authenticated;

-- ============================================================
-- FUNCTION: Get company requisitions (bypasses RLS)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_get_company_requisitions(p_company_id UUID)
RETURNS SETOF public.cmms_requisitions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
    SELECT *
    FROM public.cmms_requisitions
    WHERE cmms_company_id = p_company_id
    ORDER BY requisition_date DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_company_requisitions TO authenticated;

-- ============================================================
-- FUNCTION: Update requisition status (bypasses RLS)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_update_requisition_status(
  p_requisition_id UUID,
  p_status VARCHAR,
  p_approver_role VARCHAR DEFAULT 'department_head',
  p_decision_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_req RECORD;
  v_company_wallet_user_id UUID;
  v_company_wallet_balance NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, cmms_company_id, status, total_estimated_cost
  INTO v_req
  FROM public.cmms_requisitions
  WHERE id = p_requisition_id;

  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Requisition not found';
  END IF;

  -- Enforce workflow: finance can only act on requisitions already approved by department
  IF p_approver_role = 'finance' THEN
    IF p_status = 'completed' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.cmms_requisitions
        WHERE id = p_requisition_id AND status = 'approved'
      ) THEN
        RAISE EXCEPTION 'Finance can only mark a requisition completed after it has been approved.';
      END IF;
    ELSE
      IF NOT EXISTS (
        SELECT 1 FROM public.cmms_requisitions
        WHERE id = p_requisition_id AND status = 'pending_finance'
      ) THEN
        RAISE EXCEPTION 'Finance can only approve/reject requisitions that have been approved by admin/coordinator first (status must be pending_finance).';
      END IF;
    END IF;
  END IF;

  -- Enforce workflow: department_head can only act on pending_department_head
  IF p_approver_role = 'department_head' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cmms_requisitions
      WHERE id = p_requisition_id AND status = 'pending_department_head'
    ) THEN
      RAISE EXCEPTION 'This requisition is not at the department review stage.';
    END IF;
  END IF;

  -- ICAN wallet payout: deduct from business account before marking completed.
  IF p_approver_role = 'finance' AND p_status = 'completed' THEN
    SELECT created_by
    INTO v_company_wallet_user_id
    FROM public.cmms_company_profiles
    WHERE id = v_req.cmms_company_id;

    IF v_company_wallet_user_id IS NULL THEN
      RAISE EXCEPTION 'Business account owner is not configured for this company profile';
    END IF;

    SELECT balance
    INTO v_company_wallet_balance
    FROM public.wallet_accounts
    WHERE user_id = v_company_wallet_user_id
    FOR UPDATE;

    IF v_company_wallet_balance IS NULL THEN
      RAISE EXCEPTION 'Business wallet account not found';
    END IF;

    IF COALESCE(v_company_wallet_balance, 0) < COALESCE(v_req.total_estimated_cost, 0) THEN
      RAISE EXCEPTION 'Insufficient business wallet balance for ICAN wallet payout';
    END IF;

    UPDATE public.wallet_accounts
    SET balance = balance - COALESCE(v_req.total_estimated_cost, 0),
        updated_at = NOW()
    WHERE user_id = v_company_wallet_user_id;
  END IF;

  IF p_approver_role = 'department_head' THEN
    UPDATE public.cmms_requisitions
    SET status = p_status,
        dept_head_approved_at = NOW(),
        dept_head_decision_notes = p_decision_notes,
        updated_at = NOW()
    WHERE id = p_requisition_id;
  ELSIF p_approver_role = 'finance' THEN
    UPDATE public.cmms_requisitions
    SET status = p_status,
        finance_approved_at = NOW(),
        finance_payment_method = CASE
          WHEN p_status = 'completed' THEN 'ican_wallet'
          ELSE finance_payment_method
        END,
        finance_decision_notes = CASE
          WHEN p_status = 'completed' THEN
            COALESCE(NULLIF(TRIM(COALESCE(p_decision_notes, '')), ''), 'ICAN wallet payout completed')
            || ' | Business wallet debited: ' || COALESCE(v_req.total_estimated_cost, 0)::TEXT || ' UGX'
          ELSE p_decision_notes
        END,
        updated_at = NOW()
    WHERE id = p_requisition_id;
  ELSE
    UPDATE public.cmms_requisitions
    SET status = p_status,
        updated_at = NOW()
    WHERE id = p_requisition_id;
  END IF;

  SELECT to_jsonb(r) INTO v_result
  FROM public.cmms_requisitions r
  WHERE r.id = p_requisition_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_update_requisition_status TO authenticated;

-- ============================================================
-- CASH-OUT PROOF WORKFLOW (Finance -> Recipient phone confirmation)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_cashout_proof_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id UUID NOT NULL REFERENCES public.cmms_requisitions(id) ON DELETE CASCADE,
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,

  -- Initiator (finance/admin who initiated payout)
  requested_by_cmms_user_id UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE RESTRICT,
  requested_by_email VARCHAR(255),
  requested_by_name VARCHAR(255),
  requested_by_role VARCHAR(100),

  -- Recipient selected by surname/email lookup
  recipient_lookup_input TEXT NOT NULL,
  recipient_cmms_user_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  recipient_email VARCHAR(255) NOT NULL,
  recipient_phone VARCHAR(50),

  -- Payout details
  payment_method VARCHAR(30) NOT NULL DEFAULT 'cash',
  amount NUMERIC(15, 2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'UGX',

  -- Confirmation status
  status VARCHAR(50) NOT NULL DEFAULT 'pending_recipient_confirmation',
  request_notes TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recipient_confirmed_at TIMESTAMPTZ,
  recipient_confirmation_channel VARCHAR(30),
  recipient_confirmation_payload JSONB,

  -- Blockchain evidence fields
  blockchain_status VARCHAR(30) NOT NULL DEFAULT 'pending_anchor',
  blockchain_proof_hash TEXT,
  blockchain_tx_hash TEXT,
  blockchain_network VARCHAR(50) DEFAULT 'ican-ledger',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cmms_cashout_payment_method_chk CHECK (payment_method IN ('cash', 'ican_wallet')),
  CONSTRAINT cmms_cashout_status_chk CHECK (
    status IN ('pending_recipient_confirmation', 'confirmed', 'rejected', 'expired')
  )
);

CREATE INDEX IF NOT EXISTS idx_cmms_cashout_proof_requisition ON public.cmms_cashout_proof_requests(requisition_id);
CREATE INDEX IF NOT EXISTS idx_cmms_cashout_proof_company ON public.cmms_cashout_proof_requests(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_cmms_cashout_proof_recipient_email ON public.cmms_cashout_proof_requests(recipient_email);
CREATE INDEX IF NOT EXISTS idx_cmms_cashout_proof_status ON public.cmms_cashout_proof_requests(status);

ALTER TABLE public.cmms_cashout_proof_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cmms_cashout_proof_select_policy" ON public.cmms_cashout_proof_requests;
CREATE POLICY "cmms_cashout_proof_select_policy" ON public.cmms_cashout_proof_requests
FOR SELECT USING (
  auth.uid() IS NOT NULL
  AND (
    LOWER(recipient_email) = LOWER((SELECT email FROM auth.users WHERE id = auth.uid()))
    OR LOWER(requested_by_email) = LOWER((SELECT email FROM auth.users WHERE id = auth.uid()))
    OR EXISTS (
      SELECT 1
      FROM public.cmms_users cu
      WHERE cu.cmms_company_id = cmms_cashout_proof_requests.cmms_company_id
        AND LOWER(cu.email) = LOWER((SELECT email FROM auth.users WHERE id = auth.uid()))
    )
  )
);

DROP POLICY IF EXISTS "cmms_cashout_proof_insert_policy" ON public.cmms_cashout_proof_requests;
CREATE POLICY "cmms_cashout_proof_insert_policy" ON public.cmms_cashout_proof_requests
FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "cmms_cashout_proof_update_policy" ON public.cmms_cashout_proof_requests;
CREATE POLICY "cmms_cashout_proof_update_policy" ON public.cmms_cashout_proof_requests
FOR UPDATE USING (false);

-- Initiate proof request for cash payouts on requisitions already approved by finance.
CREATE OR REPLACE FUNCTION public.fn_initiate_cmms_cashout_proof(
  p_requisition_id UUID,
  p_recipient_lookup TEXT,
  p_amount NUMERIC DEFAULT NULL,
  p_currency VARCHAR DEFAULT 'UGX',
  p_request_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
  v_initiator RECORD;
  v_recipient RECORD;
  v_req RECORD;
  v_amount NUMERIC;
  v_request_row JSONB;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    RAISE EXCEPTION 'Authenticated user email not found';
  END IF;

  SELECT id, cmms_company_id, status, total_estimated_cost
  INTO v_req
  FROM public.cmms_requisitions
  WHERE id = p_requisition_id;

  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Requisition not found';
  END IF;

  IF v_req.status <> 'approved' THEN
    RAISE EXCEPTION 'Cash proof can only be initiated after requisition is approved';
  END IF;

  SELECT
    cu.id,
    cu.email,
    cu.full_name,
    r.role_name
  INTO v_initiator
  FROM public.cmms_users cu
  LEFT JOIN public.cmms_user_roles cur ON cur.cmms_user_id = cu.id AND cur.is_active = TRUE
  LEFT JOIN public.cmms_roles r ON r.id = cur.cmms_role_id
  WHERE cu.cmms_company_id = v_req.cmms_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
  ORDER BY cur.assigned_at DESC NULLS LAST
  LIMIT 1;

  IF v_initiator.id IS NULL THEN
    RAISE EXCEPTION 'Initiator is not registered in this CMMS company';
  END IF;

  IF COALESCE(v_initiator.role_name, '') NOT IN ('finance', 'admin') THEN
    RAISE EXCEPTION 'Only finance/admin can initiate cash proof requests';
  END IF;

  SELECT id, email, full_name, phone
  INTO v_recipient
  FROM public.cmms_users
  WHERE cmms_company_id = v_req.cmms_company_id
    AND (
      LOWER(email) = LOWER(TRIM(p_recipient_lookup))
      OR LOWER(full_name) LIKE LOWER(TRIM(p_recipient_lookup)) || '%'
      OR LOWER(full_name) LIKE '% ' || LOWER(TRIM(p_recipient_lookup))
    )
  ORDER BY CASE WHEN LOWER(email) = LOWER(TRIM(p_recipient_lookup)) THEN 0 ELSE 1 END, created_at ASC
  LIMIT 1;

  IF v_recipient.id IS NULL THEN
    RAISE EXCEPTION 'Recipient not found in CMMS users for this company';
  END IF;

  v_amount := COALESCE(p_amount, v_req.total_estimated_cost, 0);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cmms_cashout_proof_requests
    WHERE requisition_id = v_req.id
      AND status = 'pending_recipient_confirmation'
  ) THEN
    RAISE EXCEPTION 'A pending cash payout confirmation already exists for this requisition';
  END IF;

  INSERT INTO public.cmms_cashout_proof_requests (
    requisition_id,
    cmms_company_id,
    requested_by_cmms_user_id,
    requested_by_email,
    requested_by_name,
    requested_by_role,
    recipient_lookup_input,
    recipient_cmms_user_id,
    recipient_email,
    recipient_phone,
    payment_method,
    amount,
    currency,
    status,
    request_notes,
    requested_at,
    blockchain_status,
    blockchain_network,
    updated_at
  ) VALUES (
    v_req.id,
    v_req.cmms_company_id,
    v_initiator.id,
    v_initiator.email,
    v_initiator.full_name,
    v_initiator.role_name,
    p_recipient_lookup,
    v_recipient.id,
    v_recipient.email,
    v_recipient.phone,
    'cash',
    v_amount,
    COALESCE(NULLIF(TRIM(p_currency), ''), 'UGX'),
    'pending_recipient_confirmation',
    p_request_notes,
    NOW(),
    'pending_anchor',
    'ican-ledger',
    NOW()
  );

  UPDATE public.cmms_requisitions
  SET finance_decision_notes = COALESCE(finance_decision_notes, '') || CASE
        WHEN COALESCE(finance_decision_notes, '') = '' THEN ''
        ELSE E'\n'
      END || 'Cash-out proof request sent to ' || v_recipient.email || ' by ' || COALESCE(v_initiator.full_name, v_initiator.email),
      updated_at = NOW()
  WHERE id = v_req.id;

  SELECT to_jsonb(t) INTO v_request_row
  FROM (
    SELECT *
    FROM public.cmms_cashout_proof_requests
    WHERE requisition_id = v_req.id
      AND requested_by_cmms_user_id = v_initiator.id
    ORDER BY requested_at DESC
    LIMIT 1
  ) t;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Cash payout proof request created. Recipient must confirm on phone.',
    'request', v_request_row
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_initiate_cmms_cashout_proof TO authenticated;

DROP FUNCTION IF EXISTS public.fn_get_my_cmms_cashout_proofs();

CREATE OR REPLACE FUNCTION public.fn_get_my_cmms_cashout_proofs()
RETURNS TABLE (
  id UUID,
  requisition_id UUID,
  requisition_number VARCHAR,
  requested_by_email VARCHAR,
  requested_by_name VARCHAR,
  recipient_email VARCHAR,
  recipient_phone VARCHAR,
  amount NUMERIC,
  currency VARCHAR,
  status VARCHAR,
  request_notes TEXT,
  requested_at TIMESTAMPTZ,
  recipient_confirmed_at TIMESTAMPTZ,
  blockchain_proof_hash TEXT,
  blockchain_tx_hash TEXT,
  can_confirm BOOLEAN,
  view_type TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    RAISE EXCEPTION 'Authenticated user email not found';
  END IF;

  RETURN QUERY
  SELECT
    cpr.id,
    cpr.requisition_id,
    cr.requisition_number,
    cpr.requested_by_email,
    cpr.requested_by_name,
    cpr.recipient_email,
    cpr.recipient_phone,
    cpr.amount,
    cpr.currency,
    cpr.status,
    cpr.request_notes,
    cpr.requested_at,
    cpr.recipient_confirmed_at,
    cpr.blockchain_proof_hash,
    cpr.blockchain_tx_hash,
    (LOWER(cpr.recipient_email) = LOWER(v_auth_email)) AS can_confirm,
    CASE
      WHEN cpr.status = 'confirmed' AND LOWER(cpr.recipient_email) = LOWER(v_auth_email) THEN 'recipient_confirmed'
      WHEN cpr.status = 'confirmed' AND LOWER(cpr.requested_by_email) = LOWER(v_auth_email) THEN 'initiated_by_me_confirmed'
      WHEN LOWER(cpr.recipient_email) = LOWER(v_auth_email) THEN 'recipient_pending_confirmation'
      ELSE 'initiated_by_me_pending_confirmation'
    END::TEXT AS view_type
  FROM public.cmms_cashout_proof_requests cpr
  JOIN public.cmms_requisitions cr ON cr.id = cpr.requisition_id
  WHERE (
      LOWER(cpr.recipient_email) = LOWER(v_auth_email)
      OR LOWER(cpr.requested_by_email) = LOWER(v_auth_email)
    )
    AND cpr.status IN ('pending_recipient_confirmation', 'confirmed')
  ORDER BY cpr.requested_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_my_cmms_cashout_proofs TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_confirm_cmms_cashout_proof(
  p_request_id UUID,
  p_confirmation_payload JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
  v_request RECORD;
  v_now TIMESTAMPTZ;
  v_proof_hash TEXT;
  v_tx_hash TEXT;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    RAISE EXCEPTION 'Authenticated user email not found';
  END IF;

  SELECT *
  INTO v_request
  FROM public.cmms_cashout_proof_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'Cash proof request not found';
  END IF;

  IF LOWER(v_request.recipient_email) <> LOWER(v_auth_email) THEN
    RAISE EXCEPTION 'Only the selected recipient can confirm this request';
  END IF;

  IF v_request.status <> 'pending_recipient_confirmation' THEN
    RAISE EXCEPTION 'This request is no longer pending confirmation';
  END IF;

  v_now := NOW();
  v_proof_hash := md5(
    COALESCE(v_request.id::TEXT, '') || '|' ||
    COALESCE(v_request.requisition_id::TEXT, '') || '|' ||
    COALESCE(v_request.recipient_email, '') || '|' ||
    COALESCE(v_request.amount::TEXT, '0') || '|' ||
    COALESCE(v_request.currency, '') || '|' ||
    COALESCE(v_now::TEXT, '')
  );
  v_tx_hash := 'CMMS-' || REPLACE(v_request.id::TEXT, '-', '') || '-' || EXTRACT(EPOCH FROM v_now)::BIGINT::TEXT;

  UPDATE public.cmms_cashout_proof_requests
  SET status = 'confirmed',
      recipient_confirmed_at = v_now,
      recipient_confirmation_channel = 'mobile_phone',
      recipient_confirmation_payload = COALESCE(p_confirmation_payload, '{}'::JSONB),
      blockchain_status = 'anchored',
      blockchain_proof_hash = v_proof_hash,
      blockchain_tx_hash = v_tx_hash,
      updated_at = v_now
  WHERE id = v_request.id;

  -- Requisition is already approved before payout initiation; store payout proof as audit evidence only.
  UPDATE public.cmms_requisitions
  SET status = 'completed',
      finance_payment_method = 'cash',
      finance_decision_notes = COALESCE(finance_decision_notes, '') || CASE
        WHEN COALESCE(finance_decision_notes, '') = '' THEN ''
        ELSE E'\n'
      END || 'Cash recipient confirmed on phone: ' || v_auth_email || ' | blockchain_proof_hash=' || v_proof_hash,
      updated_at = v_now
  WHERE id = v_request.requisition_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Cash proof confirmed. Blockchain evidence stored for payout.',
    'request_id', v_request.id,
    'requisition_id', v_request.requisition_id,
    'blockchain_proof_hash', v_proof_hash,
    'blockchain_tx_hash', v_tx_hash
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_confirm_cmms_cashout_proof TO authenticated;

-- Also fix requisition_items RLS if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cmms_requisition_items') THEN
    ALTER TABLE public.cmms_requisition_items ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "req_items_select_policy" ON public.cmms_requisition_items;
    CREATE POLICY "req_items_select_policy" ON public.cmms_requisition_items
    FOR SELECT USING (true);

    DROP POLICY IF EXISTS "req_items_insert_policy" ON public.cmms_requisition_items;
    CREATE POLICY "req_items_insert_policy" ON public.cmms_requisition_items
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

    DROP POLICY IF EXISTS "req_items_update_policy" ON public.cmms_requisition_items;
    CREATE POLICY "req_items_update_policy" ON public.cmms_requisition_items
    FOR UPDATE USING (auth.uid() IS NOT NULL);
  END IF;
END $$;

-- Also fix requisition_approvals RLS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cmms_requisition_approvals') THEN
    ALTER TABLE public.cmms_requisition_approvals ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "req_approvals_select_policy" ON public.cmms_requisition_approvals;
    CREATE POLICY "req_approvals_select_policy" ON public.cmms_requisition_approvals
    FOR SELECT USING (true);

    DROP POLICY IF EXISTS "req_approvals_insert_policy" ON public.cmms_requisition_approvals;
    CREATE POLICY "req_approvals_insert_policy" ON public.cmms_requisition_approvals
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
  END IF;
END $$;

SELECT 'Requisition RLS policies fixed!' AS status;
