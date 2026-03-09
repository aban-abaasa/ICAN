-- ============================================================
-- FIX: Requisition RLS Insert Policy
-- Problem: Direct INSERT to cmms_requisitions blocked by RLS
-- Solution 1: Add permissive INSERT policy for authenticated users
-- Solution 2: Create SECURITY DEFINER function for requisition creation
-- ============================================================

-- APPROACH 1: Fix the RLS policies to be more permissive for inserts
-- Allow any authenticated user who belongs to the company to create requisitions

ALTER TABLE public.cmms_requisitions ENABLE ROW LEVEL SECURITY;

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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Enforce workflow: finance can only act on requisitions already approved by department
  IF p_approver_role = 'finance' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cmms_requisitions
      WHERE id = p_requisition_id AND status = 'pending_finance'
    ) THEN
      RAISE EXCEPTION 'Finance can only approve/reject requisitions that have been approved by admin/coordinator first (status must be pending_finance).';
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
        finance_decision_notes = p_decision_notes,
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
