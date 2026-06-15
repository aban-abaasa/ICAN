-- ============================================================
-- CMMS INVENTORY SYSTEM - COMPLETE SUPABASE SCHEMA
-- ============================================================
-- This creates all necessary tables for the CMMS inventory system
-- with proper RLS, functions, and integrations

-- ============================================================
-- 1. INVENTORY ITEMS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  department_id UUID REFERENCES public.cmms_departments(id) ON DELETE SET NULL,
  
  -- Item Details
  item_code VARCHAR(100) NOT NULL,
  item_name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  
  -- Stock Information
  quantity_in_stock NUMERIC(10, 2) DEFAULT 0,
  reorder_level NUMERIC(10, 2) DEFAULT 0,
  reorder_quantity NUMERIC(10, 2),
  unit_of_measure VARCHAR(50) DEFAULT 'units',
  
  -- Pricing
  unit_price NUMERIC(12, 2) DEFAULT 0,
  supplier_id VARCHAR(100),
  supplier_name VARCHAR(255),
  lead_time_days INTEGER DEFAULT 0,
  
  -- Storage Location
  storage_location VARCHAR(100),
  bin_number VARCHAR(50),

  -- Assignment & Responsibility
  assigned_storeman_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  
  -- Status & Tracking
  is_active BOOLEAN DEFAULT TRUE,
  last_updated_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  last_stock_check TIMESTAMPTZ,
  
  -- Metadata
  created_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_item_code_per_dept UNIQUE (department_id, item_code)
);

CREATE INDEX IF NOT EXISTS idx_cmms_inventory_company_id ON public.cmms_inventory_items(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_cmms_inventory_department_id ON public.cmms_inventory_items(department_id);
CREATE INDEX IF NOT EXISTS idx_cmms_inventory_storeman_id ON public.cmms_inventory_items(assigned_storeman_id);
CREATE INDEX IF NOT EXISTS idx_cmms_inventory_item_code ON public.cmms_inventory_items(item_code);
CREATE INDEX IF NOT EXISTS idx_cmms_inventory_category ON public.cmms_inventory_items(category);
CREATE INDEX IF NOT EXISTS idx_cmms_inventory_is_active ON public.cmms_inventory_items(is_active);
CREATE INDEX IF NOT EXISTS idx_cmms_inventory_created_at ON public.cmms_inventory_items(created_at);

-- ============================================================
-- 2. INVENTORY AUDIT LOG TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_inventory_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id UUID NOT NULL REFERENCES public.cmms_inventory_items(id) ON DELETE CASCADE,
  
  -- Action Details
  action VARCHAR(50),
  old_quantity NUMERIC(10, 2),
  new_quantity NUMERIC(10, 2),
  quantity_change NUMERIC(10, 2),
  
  -- Change Notes
  change_reason TEXT,
  notes TEXT,
  
  -- User Info
  changed_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  changed_by_email VARCHAR(255),
  
  -- Timestamp
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_audit_item_id ON public.cmms_inventory_audit_log(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_audit_changed_at ON public.cmms_inventory_audit_log(changed_at);
CREATE INDEX IF NOT EXISTS idx_inventory_audit_action ON public.cmms_inventory_audit_log(action);

-- ============================================================
-- 3. STOCK ADJUSTMENT TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_stock_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id UUID NOT NULL REFERENCES public.cmms_inventory_items(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.cmms_departments(id) ON DELETE CASCADE,
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  
  -- Adjustment Details
  adjustment_type VARCHAR(50),
  quantity_adjusted NUMERIC(10, 2),
  reason VARCHAR(255),
  notes TEXT,
  
  -- Reference
  reference_number VARCHAR(100),
  reference_type VARCHAR(50),
  
  -- User Info
  adjusted_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  adjusted_by_email VARCHAR(255),
  
  -- Status
  is_approved BOOLEAN DEFAULT FALSE,
  approved_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_adj_inventory_id ON public.cmms_stock_adjustments(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_adj_dept_id ON public.cmms_stock_adjustments(department_id);
CREATE INDEX IF NOT EXISTS idx_stock_adj_type ON public.cmms_stock_adjustments(adjustment_type);

-- ============================================================
-- 4. INVENTORY VIEWS FOR EASY QUERYING
-- ============================================================

DROP VIEW IF EXISTS public.v_department_inventory CASCADE;
CREATE VIEW public.v_department_inventory AS
SELECT
  cii.id,
  cii.cmms_company_id,
  cii.department_id,
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
    WHEN cii.quantity_in_stock <= 0 THEN 'OUT_OF_STOCK'
    WHEN cii.quantity_in_stock <= cii.reorder_level THEN 'REORDER_NEEDED'
    ELSE 'IN_STOCK'
  END AS stock_status,
  cii.is_active,
  cii.last_stock_check,
  cii.created_at,
  cii.updated_at
FROM public.cmms_inventory_items cii
WHERE cii.is_active = TRUE;

GRANT SELECT ON public.v_department_inventory TO authenticated, anon;

-- Low Stock Items Alert View
DROP VIEW IF EXISTS public.v_low_stock_items CASCADE;
CREATE VIEW public.v_low_stock_items AS
SELECT
  cii.id,
  cii.cmms_company_id,
  cii.department_id,
  cii.item_name,
  cii.item_code,
  cii.quantity_in_stock,
  cii.reorder_level,
  cii.reorder_quantity,
  cii.unit_price,
  cii.supplier_name,
  cii.lead_time_days,
  (cii.reorder_quantity * cii.unit_price) AS reorder_cost,
  cii.created_at
FROM public.cmms_inventory_items cii
WHERE cii.is_active = TRUE
  AND cii.quantity_in_stock <= cii.reorder_level
ORDER BY cii.quantity_in_stock ASC;

GRANT SELECT ON public.v_low_stock_items TO authenticated, anon;

-- Inventory Summary by Department
DROP VIEW IF EXISTS public.v_inventory_summary CASCADE;
CREATE VIEW public.v_inventory_summary AS
SELECT
  cii.cmms_company_id,
  cii.department_id,
  COUNT(*) AS total_items,
  COUNT(CASE WHEN cii.quantity_in_stock > 0 THEN 1 END) AS in_stock_count,
  COUNT(CASE WHEN cii.quantity_in_stock <= cii.reorder_level THEN 1 END) AS low_stock_count,
  COUNT(CASE WHEN cii.quantity_in_stock = 0 THEN 1 END) AS out_of_stock_count,
  COALESCE(SUM(cii.quantity_in_stock * cii.unit_price), 0) AS total_value
FROM public.cmms_inventory_items cii
WHERE cii.is_active = TRUE
GROUP BY cii.cmms_company_id, cii.department_id;

GRANT SELECT ON public.v_inventory_summary TO authenticated, anon;

-- Inventory with Department and Storeman Details
DROP VIEW IF EXISTS public.v_inventory_with_assignments CASCADE;
CREATE VIEW public.v_inventory_with_assignments AS
SELECT
  cii.id,
  cii.cmms_company_id,
  cii.department_id,
  cd.department_name,
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
  cii.assigned_storeman_id,
  cu.user_name AS storeman_name,
  CASE 
    WHEN cii.quantity_in_stock <= 0 THEN 'OUT_OF_STOCK'
    WHEN cii.quantity_in_stock <= cii.reorder_level THEN 'REORDER_NEEDED'
    ELSE 'IN_STOCK'
  END AS stock_status,
  cii.is_active,
  cii.last_stock_check,
  cii.created_at,
  cii.updated_at
FROM public.cmms_inventory_items cii
LEFT JOIN public.cmms_departments cd ON cii.department_id = cd.id
LEFT JOIN public.cmms_users cu ON cii.assigned_storeman_id = cu.id
WHERE cii.is_active = TRUE;

GRANT SELECT ON public.v_inventory_with_assignments TO authenticated, anon;

-- ============================================================
-- 5. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================

ALTER TABLE public.cmms_inventory_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_select_policy" ON public.cmms_inventory_items;
CREATE POLICY inventory_select_policy ON public.cmms_inventory_items
FOR SELECT USING (
  cmms_company_id IN (
    SELECT cmms_company_id FROM public.cmms_users WHERE id = auth.uid()
  )
);

DROP POLICY IF EXISTS "inventory_insert_policy" ON public.cmms_inventory_items;
CREATE POLICY inventory_insert_policy ON public.cmms_inventory_items
FOR INSERT WITH CHECK (
  cmms_company_id IN (
    SELECT cmms_company_id FROM public.cmms_users WHERE id = auth.uid()
  )
  AND EXISTS (
    SELECT 1 FROM public.cmms_user_roles cur
    JOIN public.cmms_roles cr ON cur.cmms_role_id = cr.id
    WHERE cur.cmms_user_id = auth.uid()
    AND (cr.role_name = 'storeman' OR cr.role_name = 'admin' OR cr.can_edit_inventory = TRUE)
    AND cur.is_active = TRUE
  )
);

DROP POLICY IF EXISTS "inventory_update_policy" ON public.cmms_inventory_items;
CREATE POLICY inventory_update_policy ON public.cmms_inventory_items
FOR UPDATE USING (
  cmms_company_id IN (
    SELECT cmms_company_id FROM public.cmms_users WHERE id = auth.uid()
  )
  AND EXISTS (
    SELECT 1 FROM public.cmms_user_roles cur
    JOIN public.cmms_roles cr ON cur.cmms_role_id = cr.id
    WHERE cur.cmms_user_id = auth.uid()
    AND (cr.role_name = 'storeman' OR cr.role_name = 'admin' OR cr.can_edit_inventory = TRUE)
    AND cur.is_active = TRUE
  )
);

DROP POLICY IF EXISTS "inventory_delete_policy" ON public.cmms_inventory_items;
CREATE POLICY inventory_delete_policy ON public.cmms_inventory_items
FOR DELETE USING (
  cmms_company_id IN (
    SELECT cmms_company_id FROM public.cmms_users WHERE id = auth.uid()
  )
  AND EXISTS (
    SELECT 1 FROM public.cmms_user_roles cur
    JOIN public.cmms_roles cr ON cur.cmms_role_id = cr.id
    WHERE cur.cmms_user_id = auth.uid()
    AND cr.role_name = 'admin'
    AND cur.is_active = TRUE
  )
);

ALTER TABLE public.cmms_inventory_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_select_policy" ON public.cmms_inventory_audit_log;
CREATE POLICY audit_log_select_policy ON public.cmms_inventory_audit_log
FOR SELECT USING (
  inventory_item_id IN (
    SELECT id FROM public.cmms_inventory_items
    WHERE cmms_company_id IN (
      SELECT cmms_company_id FROM public.cmms_users WHERE id = auth.uid()
    )
  )
);

ALTER TABLE public.cmms_stock_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_adj_select_policy" ON public.cmms_stock_adjustments;
CREATE POLICY stock_adj_select_policy ON public.cmms_stock_adjustments
FOR SELECT USING (
  cmms_company_id IN (
    SELECT cmms_company_id FROM public.cmms_users WHERE id = auth.uid()
  )
);

DROP POLICY IF EXISTS "stock_adj_insert_policy" ON public.cmms_stock_adjustments;
CREATE POLICY stock_adj_insert_policy ON public.cmms_stock_adjustments
FOR INSERT WITH CHECK (
  cmms_company_id IN (
    SELECT cmms_company_id FROM public.cmms_users WHERE id = auth.uid()
  )
);

-- ============================================================
-- 6. DATABASE FUNCTIONS FOR INVENTORY OPERATIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_add_inventory_item(
  p_company_id UUID,
  p_department_id UUID,
  p_item_name VARCHAR,
  p_item_code VARCHAR,
  p_category VARCHAR,
  p_quantity NUMERIC,
  p_reorder_level NUMERIC,
  p_unit_price NUMERIC,
  p_supplier_name VARCHAR DEFAULT NULL,
  p_location VARCHAR DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_id UUID;
  v_user_id UUID;
BEGIN
  SELECT auth.uid() INTO v_user_id;
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;
  
  INSERT INTO public.cmms_inventory_items (
    cmms_company_id,
    department_id,
    item_code,
    item_name,
    category,
    quantity_in_stock,
    reorder_level,
    unit_price,
    supplier_name,
    storage_location,
    created_by,
    last_updated_by
  ) VALUES (
    p_company_id,
    p_department_id,
    p_item_code,
    p_item_name,
    p_category,
    p_quantity,
    p_reorder_level,
    p_unit_price,
    p_supplier_name,
    p_location,
    v_user_id,
    v_user_id
  )
  RETURNING id INTO v_item_id;
  
  INSERT INTO public.cmms_inventory_audit_log (
    inventory_item_id,
    action,
    new_quantity,
    changed_by,
    change_reason
  ) VALUES (
    v_item_id,
    'created',
    p_quantity,
    v_user_id,
    'Initial inventory entry'
  );
  
  RETURN v_item_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_add_inventory_item TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_update_inventory_quantity(
  p_item_id UUID,
  p_new_quantity NUMERIC,
  p_reason VARCHAR DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_quantity NUMERIC;
  v_user_id UUID;
BEGIN
  SELECT auth.uid() INTO v_user_id;
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;
  
  SELECT quantity_in_stock INTO v_old_quantity
  FROM public.cmms_inventory_items
  WHERE id = p_item_id;
  
  UPDATE public.cmms_inventory_items
  SET 
    quantity_in_stock = p_new_quantity,
    last_stock_check = NOW(),
    last_updated_by = v_user_id,
    updated_at = NOW()
  WHERE id = p_item_id;
  
  INSERT INTO public.cmms_inventory_audit_log (
    inventory_item_id,
    action,
    old_quantity,
    new_quantity,
    quantity_change,
    changed_by,
    change_reason
  ) VALUES (
    p_item_id,
    'stock_updated',
    v_old_quantity,
    p_new_quantity,
    p_new_quantity - v_old_quantity,
    v_user_id,
    p_reason
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_update_inventory_quantity TO authenticated;

-- ============================================================
-- 7. VERIFICATION
-- ============================================================
SELECT 'Inventory schema created successfully!' as status;

SELECT COUNT(*) as table_count
FROM information_schema.tables
WHERE table_schema = 'public'
AND (
  table_name LIKE 'cmms_inventory%' 
  OR table_name LIKE 'cmms_stock%'
  OR table_name LIKE 'v_%inventory%'
);
