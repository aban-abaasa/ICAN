-- ============================================================
-- CMMS REQUISITION CONFIRMATIONS SEPARATION
-- Separate requisitions from their confirmations
-- Admin MUST approve, Coordinator/Supervisor optional confirmations
-- Financial Officer read-only access
-- ============================================================

-- ============================================================
-- 1. REQUISITION CONFIRMATIONS TABLE (New)
-- Tracks confirmations separately from requisitions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_requisition_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id UUID NOT NULL REFERENCES public.cmms_requisitions(id) ON DELETE CASCADE,
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  
  -- Confirmer Details
  confirmed_by UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
  confirmed_by_email VARCHAR(255),
  confirmed_by_name VARCHAR(255),
  confirmed_by_role VARCHAR(100), -- 'admin', 'coordinator', 'supervisor'
  
  -- Confirmation Type
  confirmation_type VARCHAR(50) NOT NULL, -- 'admin_approval' (required), 'coordinator_confirmation' (optional), 'supervisor_confirmation' (optional)
  is_required BOOLEAN DEFAULT FALSE, -- TRUE only for admin_approval
  
  -- Confirmation Status
  confirmation_status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'confirmed', 'rejected'
  confirmation_notes TEXT, -- Comments on why approved/rejected
  
  -- Timestamps
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_confirmations_requisition_id ON public.cmms_requisition_confirmations(requisition_id);
CREATE INDEX IF NOT EXISTS idx_confirmations_company_id ON public.cmms_requisition_confirmations(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_confirmations_confirmed_by ON public.cmms_requisition_confirmations(confirmed_by);
CREATE INDEX IF NOT EXISTS idx_confirmations_type ON public.cmms_requisition_confirmations(confirmation_type);
CREATE INDEX IF NOT EXISTS idx_confirmations_status ON public.cmms_requisition_confirmations(confirmation_status);

-- ============================================================
-- 2. VIEW: REQUISITION STATUS WITH CONFIRMATIONS
-- Shows requisition + all related confirmations
-- ============================================================
CREATE OR REPLACE VIEW public.vw_requisitions_with_confirmations AS
SELECT 
  r.id,
  r.requisition_number,
  r.cmms_company_id,
  r.department_id,
  r.status,
  r.purpose,
  r.urgency_level,
  r.total_estimated_cost,
  r.requisition_date,
  r.required_by_date,
  r.requested_by,
  
  -- Admin Approval (Required)
  CASE 
    WHEN (SELECT COUNT(*) FROM public.cmms_requisition_confirmations 
          WHERE requisition_id = r.id AND confirmation_type = 'admin_approval' AND confirmation_status = 'confirmed') > 0
    THEN 'approved'
    WHEN (SELECT COUNT(*) FROM public.cmms_requisition_confirmations 
          WHERE requisition_id = r.id AND confirmation_type = 'admin_approval' AND confirmation_status = 'rejected') > 0
    THEN 'rejected'
    ELSE 'pending'
  END as admin_approval_status,
  
  (SELECT confirmed_by FROM public.cmms_requisition_confirmations 
   WHERE requisition_id = r.id AND confirmation_type = 'admin_approval' 
   ORDER BY created_at DESC LIMIT 1) as admin_approved_by,
  
  (SELECT confirmed_at FROM public.cmms_requisition_confirmations 
   WHERE requisition_id = r.id AND confirmation_type = 'admin_approval' 
   ORDER BY created_at DESC LIMIT 1) as admin_approved_at,
  
  -- Coordinator Confirmations (Optional)
  (SELECT COUNT(*) FROM public.cmms_requisition_confirmations 
   WHERE requisition_id = r.id AND confirmation_type = 'coordinator_confirmation' AND confirmation_status = 'confirmed') as coordinator_confirmations_count,
  
  -- Supervisor Confirmations (Optional)
  (SELECT COUNT(*) FROM public.cmms_requisition_confirmations 
   WHERE requisition_id = r.id AND confirmation_type = 'supervisor_confirmation' AND confirmation_status = 'confirmed') as supervisor_confirmations_count,
  
  -- Overall Status
  CASE 
    WHEN (SELECT COUNT(*) FROM public.cmms_requisition_confirmations 
          WHERE requisition_id = r.id AND confirmation_type = 'admin_approval' AND confirmation_status = 'pending') > 0
    THEN 'awaiting_admin_approval'
    WHEN (SELECT COUNT(*) FROM public.cmms_requisition_confirmations 
          WHERE requisition_id = r.id AND confirmation_type = 'admin_approval' AND confirmation_status = 'rejected') > 0
    THEN 'admin_rejected'
    WHEN (SELECT COUNT(*) FROM public.cmms_requisition_confirmations 
          WHERE requisition_id = r.id AND confirmation_type = 'admin_approval' AND confirmation_status = 'confirmed') > 0
    THEN 'admin_approved'
    ELSE 'pending_admin_approval'
  END as overall_status,
  
  r.created_at,
  r.updated_at
FROM public.cmms_requisitions r;

-- ============================================================
-- 3. FUNCTION: CREATE REQUISITION WITH AUTO CONFIRMATIONS
-- Creates requisition and pending confirmations for all roles
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_requisition_with_confirmations(
  p_company_id UUID,
  p_department_id UUID,
  p_requested_by UUID,
  p_purpose VARCHAR,
  p_justification TEXT DEFAULT NULL,
  p_urgency_level VARCHAR DEFAULT 'normal',
  p_required_by_date DATE DEFAULT NULL,
  p_total_estimated_cost NUMERIC DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requisition_id UUID;
  v_requisition_number VARCHAR;
  v_admin_user_id UUID;
  v_coordinator_count INTEGER;
  v_supervisor_count INTEGER;
BEGIN
  -- Generate requisition number
  v_requisition_number := generate_requisition_number(p_company_id);
  
  -- Create requisition
  INSERT INTO public.cmms_requisitions (
    cmms_company_id,
    department_id,
    requisition_number,
    requested_by,
    purpose,
    justification,
    urgency_level,
    required_by_date,
    total_estimated_cost,
    status
  ) VALUES (
    p_company_id,
    p_department_id,
    v_requisition_number,
    p_requested_by,
    p_purpose,
    p_justification,
    p_urgency_level,
    p_required_by_date,
    p_total_estimated_cost,
    'pending_confirmations'
  )
  RETURNING id INTO v_requisition_id;
  
  -- Create PENDING admin approval confirmation (required)
  INSERT INTO public.cmms_requisition_confirmations (
    requisition_id,
    cmms_company_id,
    confirmed_by,
    confirmed_by_role,
    confirmation_type,
    is_required,
    confirmation_status
  ) VALUES (
    v_requisition_id,
    p_company_id,
    p_requested_by, -- Placeholder, will be filled when admin actually approves
    'admin',
    'admin_approval',
    TRUE,
    'pending'
  );
  
  RETURN v_requisition_id;
END;
$$;

-- ============================================================
-- 4. FUNCTION: SUBMIT CONFIRMATION (By Coordinator/Supervisor)
-- Optional confirmations by Coordinator and Supervisor
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_requisition_confirmation(
  p_requisition_id UUID,
  p_confirmed_by UUID,
  p_confirmation_type VARCHAR, -- 'coordinator_confirmation' or 'supervisor_confirmation'
  p_confirmation_status VARCHAR, -- 'confirmed' or 'rejected'
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_confirmation_id UUID;
  v_user_role VARCHAR;
  v_user_email VARCHAR;
  v_user_name VARCHAR;
  v_requisition RECORD;
BEGIN
  -- Get user role and info
  SELECT role, email, full_name INTO v_user_role, v_user_email, v_user_name
  FROM public.cmms_users
  WHERE id = p_confirmed_by;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'User not found'
    );
  END IF;
  
  -- Validate confirmation type matches user role
  IF p_confirmation_type = 'coordinator_confirmation' AND v_user_role != 'coordinator' THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Only coordinators can submit coordinator confirmations'
    );
  END IF;
  
  IF p_confirmation_type = 'supervisor_confirmation' AND v_user_role != 'supervisor' THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Only supervisors can submit supervisor confirmations'
    );
  END IF;
  
  -- Get requisition
  SELECT * INTO v_requisition
  FROM public.cmms_requisitions
  WHERE id = p_requisition_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Requisition not found'
    );
  END IF;
  
  -- Upsert confirmation (update if exists, insert if not)
  INSERT INTO public.cmms_requisition_confirmations (
    requisition_id,
    cmms_company_id,
    confirmed_by,
    confirmed_by_email,
    confirmed_by_name,
    confirmed_by_role,
    confirmation_type,
    is_required,
    confirmation_status,
    confirmation_notes,
    confirmed_at
  ) VALUES (
    p_requisition_id,
    v_requisition.cmms_company_id,
    p_confirmed_by,
    v_user_email,
    v_user_name,
    v_user_role,
    p_confirmation_type,
    FALSE, -- Optional confirmations
    p_confirmation_status,
    p_notes,
    NOW()
  )
  ON CONFLICT (requisition_id, confirmation_type) 
  DO UPDATE SET
    confirmation_status = EXCLUDED.confirmation_status,
    confirmation_notes = EXCLUDED.confirmation_notes,
    confirmed_by = EXCLUDED.confirmed_by,
    confirmed_by_email = EXCLUDED.confirmed_by_email,
    confirmed_by_name = EXCLUDED.confirmed_by_name,
    confirmed_at = NOW(),
    updated_at = NOW()
  RETURNING id INTO v_confirmation_id;
  
  RETURN jsonb_build_object(
    'success', TRUE,
    'confirmation_id', v_confirmation_id,
    'message', 'Confirmation submitted successfully'
  );
END;
$$;

-- ============================================================
-- 5. FUNCTION: ADMIN APPROVAL (Required)
-- Only Admin can approve, this is mandatory
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_requisition_as_admin(
  p_requisition_id UUID,
  p_approved_by UUID,
  p_approval_status VARCHAR, -- 'approved' or 'rejected'
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_role VARCHAR;
  v_user_email VARCHAR;
  v_user_name VARCHAR;
  v_requisition RECORD;
  v_confirmation_id UUID;
BEGIN
  -- Get user role and info
  SELECT role, email, full_name INTO v_user_role, v_user_email, v_user_name
  FROM public.cmms_users
  WHERE id = p_approved_by;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'User not found'
    );
  END IF;
  
  -- Validate user is admin
  IF v_user_role != 'admin' THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Only admins can approve requisitions'
    );
  END IF;
  
  -- Get requisition
  SELECT * INTO v_requisition
  FROM public.cmms_requisitions
  WHERE id = p_requisition_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Requisition not found'
    );
  END IF;
  
  -- Update or insert admin approval confirmation
  INSERT INTO public.cmms_requisition_confirmations (
    requisition_id,
    cmms_company_id,
    confirmed_by,
    confirmed_by_email,
    confirmed_by_name,
    confirmed_by_role,
    confirmation_type,
    is_required,
    confirmation_status,
    confirmation_notes,
    confirmed_at
  ) VALUES (
    p_requisition_id,
    v_requisition.cmms_company_id,
    p_approved_by,
    v_user_email,
    v_user_name,
    'admin',
    'admin_approval',
    TRUE, -- Required
    p_approval_status,
    p_notes,
    NOW()
  )
  ON CONFLICT (requisition_id, confirmation_type) 
  DO UPDATE SET
    confirmation_status = EXCLUDED.confirmation_status,
    confirmation_notes = EXCLUDED.confirmation_notes,
    confirmed_by = EXCLUDED.confirmed_by,
    confirmed_by_email = EXCLUDED.confirmed_by_email,
    confirmed_by_name = EXCLUDED.confirmed_by_name,
    confirmed_at = NOW(),
    updated_at = NOW()
  RETURNING id INTO v_confirmation_id;
  
  -- Update requisition status based on admin decision
  UPDATE public.cmms_requisitions
  SET 
    status = CASE 
      WHEN p_approval_status = 'approved' THEN 'approved_by_admin'
      WHEN p_approval_status = 'rejected' THEN 'rejected_by_admin'
      ELSE status
    END,
    updated_at = NOW()
  WHERE id = p_requisition_id;
  
  RETURN jsonb_build_object(
    'success', TRUE,
    'confirmation_id', v_confirmation_id,
    'message', 'Admin approval submitted successfully',
    'approval_status', p_approval_status
  );
END;
$$;

-- ============================================================
-- 6. FUNCTION: GET REQUISITION CONFIRMATIONS
-- Retrieve all confirmations for a requisition
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_requisition_confirmations(
  p_requisition_id UUID
)
RETURNS TABLE (
  id UUID,
  requisition_id UUID,
  confirmation_type VARCHAR,
  confirmed_by_name VARCHAR,
  confirmed_by_role VARCHAR,
  confirmation_status VARCHAR,
  confirmation_notes TEXT,
  is_required BOOLEAN,
  confirmed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rc.id,
    rc.requisition_id,
    rc.confirmation_type,
    rc.confirmed_by_name,
    rc.confirmed_by_role,
    rc.confirmation_status,
    rc.confirmation_notes,
    rc.is_required,
    rc.confirmed_at
  FROM public.cmms_requisition_confirmations rc
  WHERE rc.requisition_id = p_requisition_id
  ORDER BY 
    CASE 
      WHEN rc.confirmation_type = 'admin_approval' THEN 1
      WHEN rc.confirmation_type = 'coordinator_confirmation' THEN 2
      WHEN rc.confirmation_type = 'supervisor_confirmation' THEN 3
      ELSE 4
    END,
    rc.created_at DESC;
END;
$$;

-- ============================================================
-- 7. RLS POLICIES FOR CONFIRMATIONS TABLE
-- ============================================================
ALTER TABLE public.cmms_requisition_confirmations ENABLE ROW LEVEL SECURITY;

-- Admin can see all confirmations
CREATE POLICY cmms_confirmation_admin_read ON public.cmms_requisition_confirmations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.cmms_users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Coordinator/Supervisor can see confirmations for their company
CREATE POLICY cmms_confirmation_role_read ON public.cmms_requisition_confirmations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.cmms_users cu
      WHERE cu.id = auth.uid() 
      AND cu.role IN ('coordinator', 'supervisor')
      AND cu.cmms_company_id = cmms_requisition_confirmations.cmms_company_id
    )
  );

-- Financial Officer can see confirmations read-only
CREATE POLICY cmms_confirmation_finance_read ON public.cmms_requisition_confirmations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.cmms_users cu
      WHERE cu.id = auth.uid() 
      AND cu.role = 'financial_officer'
      AND cu.cmms_company_id = cmms_requisition_confirmations.cmms_company_id
    )
  );

-- Only the confirmer can insert/update their own confirmations
CREATE POLICY cmms_confirmation_insert ON public.cmms_requisition_confirmations
  FOR INSERT
  WITH CHECK (
    confirmed_by = auth.uid() 
    OR EXISTS (
      SELECT 1 FROM public.cmms_users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY cmms_confirmation_update ON public.cmms_requisition_confirmations
  FOR UPDATE
  USING (
    confirmed_by = auth.uid() 
    OR EXISTS (
      SELECT 1 FROM public.cmms_users
      WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    confirmed_by = auth.uid() 
    OR EXISTS (
      SELECT 1 FROM public.cmms_users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================================
-- 8. SAMPLE DATA FOR TESTING
-- ============================================================
-- Insert test confirmation record
-- INSERT INTO public.cmms_requisition_confirmations (
--   requisition_id,
--   cmms_company_id,
--   confirmed_by,
--   confirmed_by_role,
--   confirmation_type,
--   is_required,
--   confirmation_status
-- ) VALUES (
--   'requisition-uuid-here',
--   'company-uuid-here',
--   'user-uuid-here',
--   'admin',
--   'admin_approval',
--   TRUE,
--   'pending'
-- );

GRANT EXECUTE ON FUNCTION public.create_requisition_with_confirmations TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_requisition_confirmation TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_requisition_as_admin TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_requisition_confirmations TO authenticated;
