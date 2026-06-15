-- ============================================================
-- CMMS - DEPARTMENT-BASED INVENTORY & SMART REQUISITIONS
-- ============================================================
-- This script creates a complete department-level inventory 
-- and requisition management system with role-based access
--
-- Features:
-- 1. Department management and staff assignment
-- 2. Department-specific inventory tracking
-- 3. Smart requisitions with price, quantity, time needed
-- 4. Approval workflows for requisitions
-- 5. Row-Level Security (RLS) for department separation
--
-- Run this in Supabase SQL Editor

-- ============================================================
-- 1. DEPARTMENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  
  -- Department Info
  department_name VARCHAR(255) NOT NULL,
  department_code VARCHAR(50),
  description TEXT,
  
  -- Department Head/Manager
  department_head_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  
  -- Budget & Status
  annual_budget NUMERIC(15, 2),
  budget_used NUMERIC(15, 2) DEFAULT 0,
  status VARCHAR(50) DEFAULT 'active', -- 'active', 'inactive', 'archived'
  
  -- Metadata
  created_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_dept_per_company UNIQUE (cmms_company_id, department_code)
);

CREATE INDEX IF NOT EXISTS idx_cmms_departments_company_id ON public.cmms_departments(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_cmms_departments_head_id ON public.cmms_departments(department_head_id);

-- ============================================================
-- 2. DEPARTMENT STAFF ASSIGNMENT TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_department_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES public.cmms_departments(id) ON DELETE CASCADE,
  cmms_user_id UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  
  -- Assignment Details
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  is_primary_department BOOLEAN DEFAULT FALSE, -- User's main department
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  removed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_staff_per_dept UNIQUE (department_id, cmms_user_id)
);

CREATE INDEX IF NOT EXISTS idx_cmms_department_staff_dept_id ON public.cmms_department_staff(department_id);
CREATE INDEX IF NOT EXISTS idx_cmms_department_staff_user_id ON public.cmms_department_staff(cmms_user_id);
CREATE INDEX IF NOT EXISTS idx_cmms_department_staff_company_id ON public.cmms_department_staff(cmms_company_id);

-- ============================================================
-- 3. INVENTORY ITEMS TABLE (Per Department)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES public.cmms_departments(id) ON DELETE CASCADE,
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  
  -- Item Details
  item_code VARCHAR(100) NOT NULL,
  item_name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100), -- 'spare_parts', 'tools', 'consumables', 'equipment', 'other'
  
  -- Stock Information
  quantity_in_stock NUMERIC(10, 2) DEFAULT 0,
  reorder_level NUMERIC(10, 2),
  reorder_quantity NUMERIC(10, 2),
  unit_of_measure VARCHAR(50), -- 'pcs', 'liters', 'kg', 'meters', etc.
  
  -- Pricing
  unit_price NUMERIC(12, 2),
  supplier_id VARCHAR(100),
  supplier_name VARCHAR(255),
  lead_time_days INTEGER, -- Days to get item from supplier
  
  -- Locations
  storage_location VARCHAR(100),
  bin_number VARCHAR(50),
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  last_updated_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  last_stock_check TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_item_per_dept UNIQUE (department_id, item_code)
);

CREATE INDEX IF NOT EXISTS idx_cmms_inventory_department_id ON public.cmms_inventory_items(department_id);
CREATE INDEX IF NOT EXISTS idx_cmms_inventory_company_id ON public.cmms_inventory_items(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_cmms_inventory_item_code ON public.cmms_inventory_items(item_code);
CREATE INDEX IF NOT EXISTS idx_cmms_inventory_category ON public.cmms_inventory_items(category);

-- ============================================================
-- 4. REQUISITIONS TABLE (Smart Tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_requisitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.cmms_departments(id) ON DELETE CASCADE,
  
  -- Requisition Details
  requisition_number VARCHAR(100) NOT NULL UNIQUE,
  requisition_date TIMESTAMPTZ DEFAULT NOW(),
  
  -- Requester Information
  requested_by UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
  requested_by_email VARCHAR(255),
  requested_by_name VARCHAR(255),
  requested_by_role VARCHAR(100),
  
  -- Purpose & Justification
  purpose VARCHAR(255) NOT NULL, -- 'maintenance', 'repair', 'preventive', 'consumable_replenishment', 'emergency', 'other'
  justification TEXT,
  work_order_id UUID, -- Link to associated work order if applicable
  
  -- Urgency & Timeline
  urgency_level VARCHAR(50) DEFAULT 'normal', -- 'urgent', 'normal', 'low'
  required_by_date DATE, -- When items are needed
  preferred_delivery_date DATE, -- When would be ideal
  
  -- Status Tracking
  status VARCHAR(50) DEFAULT 'pending_department_head', 
  -- pending_dept_head → dept_head_approved/rejected → pending_finance → finance_approved/rejected → approved → ordered → delivered → closed
  
  -- Approval Chain
  dept_head_approved_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  dept_head_approved_at TIMESTAMPTZ,
  dept_head_decision_notes TEXT,
  
  finance_reviewer_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  finance_reviewed_at TIMESTAMPTZ,
  finance_approved_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  finance_approved_at TIMESTAMPTZ,
  finance_decision_notes TEXT,
  
  -- Budget Check
  total_estimated_cost NUMERIC(15, 2) DEFAULT 0,
  budget_available NUMERIC(15, 2),
  budget_sufficient BOOLEAN,
  cost_over_threshold BOOLEAN DEFAULT FALSE, -- Requires additional approvals
  
  -- Ordering
  order_placed_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  order_placed_date TIMESTAMPTZ,
  po_number VARCHAR(100),
  
  -- Delivery
  expected_delivery_date TIMESTAMPTZ,
  actual_delivery_date TIMESTAMPTZ,
  delivered_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  delivery_notes TEXT,
  
  -- Completion
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  final_notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmms_requisitions_company_id ON public.cmms_requisitions(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_cmms_requisitions_department_id ON public.cmms_requisitions(department_id);
CREATE INDEX IF NOT EXISTS idx_cmms_requisitions_requested_by ON public.cmms_requisitions(requested_by);
CREATE INDEX IF NOT EXISTS idx_cmms_requisitions_status ON public.cmms_requisitions(status);
CREATE INDEX IF NOT EXISTS idx_cmms_requisitions_date ON public.cmms_requisitions(requisition_date);
CREATE INDEX IF NOT EXISTS idx_cmms_requisitions_required_by ON public.cmms_requisitions(required_by_date);

-- ============================================================
-- 5. REQUISITION LINE ITEMS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_requisition_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id UUID NOT NULL REFERENCES public.cmms_requisitions(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.cmms_departments(id) ON DELETE CASCADE,
  inventory_item_id UUID REFERENCES public.cmms_inventory_items(id) ON DELETE SET NULL,
  
  -- Item Details
  item_code VARCHAR(100),
  item_name VARCHAR(255) NOT NULL,
  item_description TEXT,
  category VARCHAR(100),
  
  -- Requested Quantity & Pricing
  requested_quantity NUMERIC(10, 2) NOT NULL,
  unit_of_measure VARCHAR(50),
  unit_price NUMERIC(12, 2) NOT NULL,
  line_total NUMERIC(15, 2) GENERATED ALWAYS AS (requested_quantity * unit_price) STORED,
  
  -- Reason
  reason_for_requisition TEXT,
  
  -- Supplier Info
  preferred_supplier VARCHAR(255),
  supplier_notes TEXT,
  
  -- Expected Delivery
  lead_time_days INTEGER,
  expected_delivery_date DATE,
  
  -- Status
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'ordered', 'partial_received', 'received', 'cancelled'
  quantity_received NUMERIC(10, 2) DEFAULT 0,
  received_at TIMESTAMPTZ,
  received_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmms_requisition_items_req_id ON public.cmms_requisition_items(requisition_id);
CREATE INDEX IF NOT EXISTS idx_cmms_requisition_items_dept_id ON public.cmms_requisition_items(department_id);
CREATE INDEX IF NOT EXISTS idx_cmms_requisition_items_inv_id ON public.cmms_requisition_items(inventory_item_id);

-- ============================================================
-- 6. REQUISITION APPROVAL HISTORY TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_requisition_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id UUID NOT NULL REFERENCES public.cmms_requisitions(id) ON DELETE CASCADE,
  
  -- Approval Details
  approval_level VARCHAR(50) NOT NULL, -- 'department_head', 'finance', 'admin'
  approved_by UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
  approved_by_email VARCHAR(255),
  approved_by_name VARCHAR(255),
  approved_by_role VARCHAR(100),
  
  -- Decision
  decision VARCHAR(50) NOT NULL, -- 'approved', 'rejected', 'pending_revision'
  decision_comment TEXT,
  
  -- Timestamp
  decided_at TIMESTAMPTZ DEFAULT NOW(),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmms_approvals_req_id ON public.cmms_requisition_approvals(requisition_id);
CREATE INDEX IF NOT EXISTS idx_cmms_approvals_approved_by ON public.cmms_requisition_approvals(approved_by);

-- ============================================================
-- 7. REQUISITION AUTO-NUMBERING FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_requisition_number(p_company_id UUID)
RETURNS VARCHAR
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_year VARCHAR(4);
  v_number VARCHAR(100);
BEGIN
  v_year := TO_CHAR(NOW(), 'YYYY');
  
  -- Get count of requisitions this year for this company
  SELECT COUNT(*) + 1 INTO v_count
  FROM public.cmms_requisitions
  WHERE cmms_company_id = p_company_id
    AND DATE_PART('year', requisition_date) = DATE_PART('year', NOW());
  
  v_number := 'REQ-' || v_year || '-' || LPAD(v_count::TEXT, 5, '0');
  
  RETURN v_number;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_requisition_number(UUID) TO authenticated;

-- ============================================================
-- 8. CALCULATE TOTAL REQUISITION COST FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.calculate_requisition_total(p_requisition_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total NUMERIC(15, 2);
BEGIN
  SELECT COALESCE(SUM(line_total), 0) INTO v_total
  FROM public.cmms_requisition_items
  WHERE requisition_id = p_requisition_id;
  
  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_requisition_total(UUID) TO authenticated;

-- ============================================================
-- 9) SMART REQUISITION SUBMISSION FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_requisition(
  p_department_id UUID,
  p_purpose VARCHAR,
  p_justification TEXT,
  p_urgency_level VARCHAR DEFAULT 'normal',
  p_required_by_date DATE DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::JSONB -- Array of {item_id, quantity, unit_price, lead_time_days}
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_company_id UUID;
  v_user_email VARCHAR(255);
  v_user_name VARCHAR(255);
  v_user_role VARCHAR(100);
  v_requisition_id UUID;
  v_requisition_number VARCHAR(100);
  v_item JSONB;
  v_total_cost NUMERIC(15, 2);
  v_dept_budget NUMERIC(15, 2);
  v_budget_used NUMERIC(15, 2);
  v_budget_available NUMERIC(15, 2);
BEGIN
  -- Get current user
  SELECT au.id, cu.email, cu.full_name, cu.cmms_company_id
  INTO v_user_id, v_user_email, v_user_name, v_company_id
  FROM auth.users au
  JOIN public.cmms_users cu ON au.email = cu.email
  WHERE au.id = auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated or not in CMMS system';
  END IF;

  -- Get user's role
  SELECT r.role_name INTO v_user_role
  FROM public.cmms_users cu
  JOIN public.cmms_user_roles cur ON cu.id = cur.cmms_user_id
  JOIN public.cmms_roles r ON cur.cmms_role_id = r.id
  WHERE cu.id = v_user_id AND cur.is_active = TRUE
  LIMIT 1;

  -- Verify user is in department
  IF NOT EXISTS (
    SELECT 1 FROM public.cmms_department_staff
    WHERE department_id = p_department_id
      AND cmms_user_id = v_user_id
      AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'User is not part of this department';
  END IF;

  -- Get company budget info
  SELECT cd.cmms_company_id, cd.annual_budget, COALESCE(cd.budget_used, 0)
  INTO v_company_id, v_dept_budget, v_budget_used
  FROM public.cmms_departments cd
  WHERE cd.id = p_department_id;

  v_budget_available := COALESCE(v_dept_budget - v_budget_used, 0);

  -- Generate requisition number
  v_requisition_number := public.generate_requisition_number(v_company_id);

  -- Create requisition
  INSERT INTO public.cmms_requisitions (
    cmms_company_id,
    department_id,
    requisition_number,
    requested_by,
    requested_by_email,
    requested_by_name,
    requested_by_role,
    purpose,
    justification,
    urgency_level,
    required_by_date,
    status,
    budget_available,
    total_estimated_cost
  ) VALUES (
    v_company_id,
    p_department_id,
    v_requisition_number,
    v_user_id,
    v_user_email,
    v_user_name,
    v_user_role,
    p_purpose,
    p_justification,
    p_urgency_level,
    COALESCE(p_required_by_date, CURRENT_DATE + INTERVAL '7 days'),
    'pending_department_head',
    v_budget_available,
    0
  )
  RETURNING id INTO v_requisition_id;

  -- Add line items if provided
  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      INSERT INTO public.cmms_requisition_items (
        requisition_id,
        department_id,
        inventory_item_id,
        item_code,
        item_name,
        item_description,
        category,
        requested_quantity,
        unit_of_measure,
        unit_price,
        lead_time_days,
        expected_delivery_date
      ) VALUES (
        v_requisition_id,
        p_department_id,
        (v_item->>'inventory_item_id')::UUID,
        v_item->>'item_code',
        v_item->>'item_name',
        v_item->>'item_description',
        v_item->>'category',
        (v_item->>'requested_quantity')::NUMERIC,
        v_item->>'unit_of_measure',
        (v_item->>'unit_price')::NUMERIC,
        (v_item->>'lead_time_days')::INTEGER,
        (CURRENT_DATE + ((v_item->>'lead_time_days')::INTEGER || ' days')::INTERVAL)::DATE
      );
    END LOOP;
  END IF;

  -- Update total estimated cost
  UPDATE public.cmms_requisitions
  SET total_estimated_cost = public.calculate_requisition_total(v_requisition_id),
      budget_sufficient = (public.calculate_requisition_total(v_requisition_id) <= v_budget_available),
      cost_over_threshold = (public.calculate_requisition_total(v_requisition_id) > (v_dept_budget * 0.2))
  WHERE id = v_requisition_id;

  RETURN v_requisition_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_requisition(UUID, VARCHAR, TEXT, VARCHAR, DATE, JSONB) TO authenticated;

-- ============================================================
-- 10) APPROVE REQUISITION FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_requisition(
  p_requisition_id UUID,
  p_decision VARCHAR,
  p_comment TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_user_email VARCHAR(255);
  v_user_name VARCHAR(255);
  v_user_role VARCHAR(100);
  v_current_status VARCHAR(50);
  v_department_id UUID;
  v_approval_level VARCHAR(50);
  v_new_status VARCHAR(50);
BEGIN
  -- Get current user
  SELECT au.id, cu.email, cu.full_name
  INTO v_user_id, v_user_email, v_user_name
  FROM auth.users au
  JOIN public.cmms_users cu ON au.email = cu.email
  WHERE au.id = auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  -- Get requisition details
  SELECT cr.status, cr.department_id INTO v_current_status, v_department_id
  FROM public.cmms_requisitions cr
  WHERE cr.id = p_requisition_id;

  -- Get user's role
  SELECT r.role_name INTO v_user_role
  FROM public.cmms_users cu
  JOIN public.cmms_user_roles cur ON cu.id = cur.cmms_user_id
  JOIN public.cmms_roles r ON cur.cmms_role_id = r.id
  WHERE cu.id = v_user_id AND cur.is_active = TRUE
  LIMIT 1;

  -- Determine approval level and new status
  CASE v_current_status
    WHEN 'pending_department_head' THEN
      v_approval_level := 'department_head';
      v_new_status := CASE WHEN p_decision = 'approved' THEN 'pending_finance' ELSE 'rejected' END;
    WHEN 'pending_finance' THEN
      v_approval_level := 'finance';
      v_new_status := CASE WHEN p_decision = 'approved' THEN 'approved' ELSE 'rejected' END;
    ELSE
      RAISE EXCEPTION 'Requisition cannot be approved in current status: %', v_current_status;
  END CASE;

  -- Record approval
  INSERT INTO public.cmms_requisition_approvals (
    requisition_id,
    approval_level,
    approved_by,
    approved_by_email,
    approved_by_name,
    approved_by_role,
    decision,
    decision_comment
  ) VALUES (
    p_requisition_id,
    v_approval_level,
    v_user_id,
    v_user_email,
    v_user_name,
    v_user_role,
    p_decision,
    p_comment
  );

  -- Update requisition status
  UPDATE public.cmms_requisitions
  SET status = v_new_status,
      updated_at = NOW()
  WHERE id = p_requisition_id;

  IF v_approval_level = 'department_head' THEN
    UPDATE public.cmms_requisitions
    SET dept_head_approved_by = v_user_id,
        dept_head_approved_at = NOW(),
        dept_head_decision_notes = p_comment
    WHERE id = p_requisition_id;
  END IF;

  IF v_approval_level = 'finance' THEN
    UPDATE public.cmms_requisitions
    SET finance_approved_by = v_user_id,
        finance_approved_at = NOW(),
        finance_decision_notes = p_comment
    WHERE id = p_requisition_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_requisition(UUID, VARCHAR, TEXT) TO authenticated;

-- ============================================================
-- 11) CLOSE REQUISITION FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.close_requisition(
  p_requisition_id UUID,
  p_final_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT au.id INTO v_user_id FROM auth.users au WHERE au.id = auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  UPDATE public.cmms_requisitions
  SET status = 'closed',
      closed_at = NOW(),
      closed_by = v_user_id,
      final_notes = p_final_notes,
      updated_at = NOW()
  WHERE id = p_requisition_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_requisition(UUID, TEXT) TO authenticated;

-- ============================================================
-- 12) UPDATE INVENTORY AFTER DELIVERY FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.receive_requisition_items(
  p_requisition_id UUID,
  p_delivery_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_item RECORD;
BEGIN
  SELECT au.id INTO v_user_id FROM auth.users au WHERE au.id = auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  -- Update requisition
  UPDATE public.cmms_requisitions
  SET status = 'delivered',
      actual_delivery_date = NOW(),
      delivered_by = v_user_id,
      delivery_notes = p_delivery_notes
  WHERE id = p_requisition_id;

  -- Update inventory for each item
  FOR v_item IN
    SELECT cri.inventory_item_id, cri.requested_quantity
    FROM public.cmms_requisition_items cri
    WHERE cri.requisition_id = p_requisition_id
      AND cri.status = 'ordered'
  LOOP
    IF v_item.inventory_item_id IS NOT NULL THEN
      UPDATE public.cmms_inventory_items
      SET quantity_in_stock = quantity_in_stock + v_item.requested_quantity,
          last_updated_by = v_user_id,
          last_stock_check = NOW(),
          updated_at = NOW()
      WHERE id = v_item.inventory_item_id;
    END IF;

    UPDATE public.cmms_requisition_items
    SET status = 'received',
        quantity_received = requested_quantity,
        received_at = NOW(),
        received_by = v_user_id
    WHERE requisition_id = p_requisition_id
      AND inventory_item_id = v_item.inventory_item_id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_requisition_items(UUID, TEXT) TO authenticated;

-- ============================================================
-- 13) VIEWS FOR EASY QUERYING
-- ============================================================

-- Department Inventory View
DROP VIEW IF EXISTS public.v_department_inventory CASCADE;
CREATE VIEW public.v_department_inventory AS
SELECT
  cii.id,
  cii.department_id,
  cd.department_name,
  cd.cmms_company_id,
  cii.item_code,
  cii.item_name,
  cii.description,
  cii.category,
  cii.quantity_in_stock,
  cii.reorder_level,
  cii.unit_price,
  (cii.quantity_in_stock * cii.unit_price) AS stock_value,
  cii.supplier_name,
  cii.lead_time_days,
  cii.storage_location,
  cii.unit_of_measure,
  CASE 
    WHEN cii.quantity_in_stock <= cii.reorder_level THEN 'REORDER_NEEDED'
    WHEN cii.quantity_in_stock = 0 THEN 'OUT_OF_STOCK'
    ELSE 'IN_STOCK'
  END AS stock_status,
  cii.is_active,
  cii.last_stock_check,
  cii.created_at
FROM public.cmms_inventory_items cii
JOIN public.cmms_departments cd ON cii.department_id = cd.id
WHERE cii.is_active = TRUE;

GRANT SELECT ON public.v_department_inventory TO authenticated, anon;

-- Department Staff View
DROP VIEW IF EXISTS public.v_department_staff CASCADE;
CREATE VIEW public.v_department_staff AS
SELECT
  cds.id,
  cds.department_id,
  cd.department_name,
  cd.cmms_company_id,
  cds.cmms_user_id,
  cu.email,
  cu.full_name,
  cu.job_title,
  r.role_name,
  cds.is_primary_department,
  cds.is_active,
  cds.assigned_at,
  cu.created_at
FROM public.cmms_department_staff cds
JOIN public.cmms_departments cd ON cds.department_id = cd.id
JOIN public.cmms_users cu ON cds.cmms_user_id = cu.id
LEFT JOIN public.cmms_user_roles cur ON cu.id = cur.cmms_user_id AND cur.is_active = TRUE
LEFT JOIN public.cmms_roles r ON cur.cmms_role_id = r.id
WHERE cds.is_active = TRUE;

GRANT SELECT ON public.v_department_staff TO authenticated, anon;

-- Requisition Summary View
DROP VIEW IF EXISTS public.v_requisition_summary CASCADE;
CREATE VIEW public.v_requisition_summary AS
SELECT
  cr.id,
  cr.requisition_number,
  cr.cmms_company_id,
  cr.department_id,
  cd.department_name,
  cr.requested_by,
  cr.requested_by_name,
  cr.requested_by_email,
  cr.purpose,
  cr.urgency_level,
  cr.status,
  cr.requisition_date,
  cr.required_by_date,
  cr.total_estimated_cost,
  cr.budget_available,
  cr.budget_sufficient,
  COUNT(cri.id) AS line_items_count,
  cr.dept_head_approved_at,
  cr.finance_approved_at,
  cr.order_placed_date,
  cr.expected_delivery_date,
  cr.actual_delivery_date,
  CASE 
    WHEN cr.status = 'pending_department_head' THEN 'Waiting for Department Head'
    WHEN cr.status = 'pending_finance' THEN 'Waiting for Finance Approval'
    WHEN cr.status = 'approved' THEN 'Approved - Ready to Order'
    WHEN cr.status = 'ordered' THEN 'Order Placed'
    WHEN cr.status = 'delivered' THEN 'Order Delivered'
    WHEN cr.status = 'closed' THEN 'Closed'
    WHEN cr.status LIKE '%rejected%' THEN 'Rejected'
    ELSE cr.status
  END AS status_display,
  cr.created_at
FROM public.cmms_requisitions cr
JOIN public.cmms_departments cd ON cr.department_id = cd.id
LEFT JOIN public.cmms_requisition_items cri ON cr.id = cri.requisition_id
GROUP BY cr.id, cd.department_name;

GRANT SELECT ON public.v_requisition_summary TO authenticated, anon;

-- ============================================================
-- 14) ROW-LEVEL SECURITY (RLS) POLICIES
-- ============================================================

-- RLS on cmms_departments
ALTER TABLE public.cmms_departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "departments_select_policy" ON public.cmms_departments;
CREATE POLICY departments_select_policy ON public.cmms_departments
FOR SELECT USING (
  cmms_company_id IN (
    SELECT cmms_company_id FROM public.cmms_users WHERE id = auth.uid()
  )
);

DROP POLICY IF EXISTS "departments_insert_policy" ON public.cmms_departments;
CREATE POLICY departments_insert_policy ON public.cmms_departments
FOR INSERT WITH CHECK (
  cmms_company_id IN (
    SELECT cmms_company_id FROM public.cmms_users WHERE id = auth.uid()
  )
  AND EXISTS (
    SELECT 1 FROM public.cmms_user_roles cur
    JOIN public.cmms_roles cr ON cur.cmms_role_id = cr.id
    WHERE cur.cmms_user_id = (SELECT id FROM public.cmms_users WHERE email = auth.jwt()->>'email')
    AND cr.can_manage_users = TRUE
  )
);

-- RLS on cmms_department_staff
ALTER TABLE public.cmms_department_staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dept_staff_select_policy" ON public.cmms_department_staff;
CREATE POLICY dept_staff_select_policy ON public.cmms_department_staff
FOR SELECT USING (
  cmms_company_id IN (
    SELECT cmms_company_id FROM public.cmms_users WHERE id = auth.uid()
  )
);

-- RLS on cmms_inventory_items
ALTER TABLE public.cmms_inventory_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_select_policy" ON public.cmms_inventory_items;
CREATE POLICY inventory_select_policy ON public.cmms_inventory_items
FOR SELECT USING (
  department_id IN (
    SELECT id FROM public.cmms_departments
    WHERE cmms_company_id IN (
      SELECT cmms_company_id FROM public.cmms_users WHERE id = auth.uid()
    )
  )
  OR cmms_company_id IN (
    SELECT cmms_company_id FROM public.cmms_users WHERE id = auth.uid()
  )
);

DROP POLICY IF EXISTS "inventory_insert_policy" ON public.cmms_inventory_items;
CREATE POLICY inventory_insert_policy ON public.cmms_inventory_items
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.cmms_user_roles cur
    JOIN public.cmms_roles cr ON cur.cmms_role_id = cr.id
    JOIN public.cmms_users cu ON cur.cmms_user_id = cu.id
    WHERE cu.email = auth.jwt()->>'email'
    AND (cr.can_edit_inventory = TRUE OR cr.role_name = 'storeman')
    AND cu.cmms_company_id = (
      SELECT cmms_company_id FROM public.cmms_departments WHERE id = cmms_inventory_items.department_id
    )
  )
);

DROP POLICY IF EXISTS "inventory_update_policy" ON public.cmms_inventory_items;
CREATE POLICY inventory_update_policy ON public.cmms_inventory_items
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.cmms_user_roles cur
    JOIN public.cmms_roles cr ON cur.cmms_role_id = cr.id
    JOIN public.cmms_users cu ON cur.cmms_user_id = cu.id
    WHERE cu.email = auth.jwt()->>'email'
    AND (cr.can_edit_inventory = TRUE OR cr.role_name = 'storeman')
    AND cu.cmms_company_id = (
      SELECT cmms_company_id FROM public.cmms_departments WHERE id = cmms_inventory_items.department_id
    )
  )
);

-- RLS on cmms_requisitions
ALTER TABLE public.cmms_requisitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "requisitions_select_policy" ON public.cmms_requisitions;
CREATE POLICY requisitions_select_policy ON public.cmms_requisitions
FOR SELECT USING (
  cmms_company_id IN (SELECT cmms_company_id FROM public.cmms_users WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "requisitions_insert_policy" ON public.cmms_requisitions;
CREATE POLICY requisitions_insert_policy ON public.cmms_requisitions
FOR INSERT WITH CHECK (
  department_id IN (
    SELECT id FROM public.cmms_departments
    WHERE cmms_company_id IN (
      SELECT cmms_company_id FROM public.cmms_users WHERE id = auth.uid()
    )
  )
);

-- ============================================================
-- VERIFICATION & SUMMARY
-- ============================================================
SELECT 
  'Department Tables Created' as message,
  COUNT(*) as tables_count
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE 'cmms_department%'
  OR table_name LIKE 'cmms_inventory%'
  OR table_name LIKE 'cmms_requisition%';

SELECT 'Setup Complete!' as status;
