-- ============================================================
-- CMMS (COMPUTERIZED MAINTENANCE MANAGEMENT SYSTEM)
-- COMPLETE SUPABASE SCHEMA
-- ============================================================
-- This creates all necessary tables for complete CMMS functionality
-- Including: Company Profiles, Users, Roles, Departments, Inventory, Stock Adjustments

-- ============================================================
-- 0. MIGRATION: FIX EXISTING TABLES IF NEEDED
-- ============================================================

-- Add missing columns to cmms_departments if it exists
ALTER TABLE IF EXISTS public.cmms_departments
  ADD COLUMN IF NOT EXISTS location VARCHAR(255),
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add missing columns to cmms_roles if needed
ALTER TABLE IF EXISTS public.cmms_roles
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add missing columns to cmms_users if needed
ALTER TABLE IF EXISTS public.cmms_users
  ADD COLUMN IF NOT EXISTS department_id UUID,
  ADD COLUMN IF NOT EXISTS is_creator BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS role VARCHAR(50),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add missing columns to cmms_inventory_items if needed
ALTER TABLE IF EXISTS public.cmms_inventory_items
  ADD COLUMN IF NOT EXISTS department_id UUID,
  ADD COLUMN IF NOT EXISTS assigned_storeman_id UUID,
  ADD COLUMN IF NOT EXISTS storage_location VARCHAR(100),
  ADD COLUMN IF NOT EXISTS bin_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS last_updated_by UUID,
  ADD COLUMN IF NOT EXISTS last_stock_check TIMESTAMPTZ;

-- Add missing columns to cmms_stock_adjustments if needed
ALTER TABLE IF EXISTS public.cmms_stock_adjustments
  ADD COLUMN IF NOT EXISTS department_id UUID,
  ADD COLUMN IF NOT EXISTS adjusted_by_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- ============================================================
-- 1. COMPANY PROFILES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_company_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Company Information
  company_name VARCHAR(255) NOT NULL,
  company_registration VARCHAR(100),
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20),
  website VARCHAR(255),
  location VARCHAR(255),
  industry VARCHAR(100),
  
  -- Features
  cmms_enabled BOOLEAN DEFAULT TRUE,
  maintenance_budget_annual NUMERIC(15, 2) DEFAULT 0,
  preventive_maintenance_enabled BOOLEAN DEFAULT TRUE,
  inventory_enabled BOOLEAN DEFAULT TRUE,
  work_order_enabled BOOLEAN DEFAULT TRUE,
  analytics_enabled BOOLEAN DEFAULT TRUE,
  mobile_app_enabled BOOLEAN DEFAULT TRUE,
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Metadata
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmms_company_email ON public.cmms_company_profiles(email);
CREATE INDEX IF NOT EXISTS idx_cmms_company_is_active ON public.cmms_company_profiles(is_active);

-- ============================================================
-- 2. ROLES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  role_name VARCHAR(100) NOT NULL,
  description TEXT,
  permission_level INTEGER DEFAULT 1,
  
  -- Permissions
  can_create_work_orders BOOLEAN DEFAULT FALSE,
  can_approve_work_orders BOOLEAN DEFAULT FALSE,
  can_view_reports BOOLEAN DEFAULT FALSE,
  can_manage_users BOOLEAN DEFAULT FALSE,
  can_edit_inventory BOOLEAN DEFAULT FALSE,
  can_manage_departments BOOLEAN DEFAULT FALSE,
  can_manage_roles BOOLEAN DEFAULT FALSE,
  can_manage_budget BOOLEAN DEFAULT FALSE,
  
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_role_name UNIQUE (role_name)
);

CREATE INDEX IF NOT EXISTS idx_cmms_roles_active ON public.cmms_roles(is_active);

-- ============================================================
-- 3. DEPARTMENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  
  -- Department Details
  department_name VARCHAR(255) NOT NULL,
  description TEXT,
  location VARCHAR(255),
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Metadata
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_dept_per_company UNIQUE (cmms_company_id, department_name)
);

CREATE INDEX IF NOT EXISTS idx_cmms_dept_company_id ON public.cmms_departments(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_cmms_dept_is_active ON public.cmms_departments(is_active);

-- ============================================================
-- 4. USERS TABLE (CMMS Users - Different from Auth Users)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  department_id UUID REFERENCES public.cmms_departments(id) ON DELETE SET NULL,
  
  -- User Information
  user_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  
  -- Role
  role VARCHAR(50),
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  is_creator BOOLEAN DEFAULT FALSE,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_user_per_company UNIQUE (cmms_company_id, email)
);

CREATE INDEX IF NOT EXISTS idx_cmms_user_company_id ON public.cmms_users(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_cmms_user_dept_id ON public.cmms_users(department_id);
CREATE INDEX IF NOT EXISTS idx_cmms_user_is_active ON public.cmms_users(is_active);
CREATE INDEX IF NOT EXISTS idx_cmms_user_role ON public.cmms_users(role);

-- ============================================================
-- 5. USER ROLES ASSIGNMENT TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  cmms_user_id UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
  cmms_role_id UUID NOT NULL REFERENCES public.cmms_roles(id) ON DELETE CASCADE,
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Metadata
  assigned_by UUID,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_user_role UNIQUE (cmms_user_id, cmms_role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_role_user_id ON public.cmms_user_roles(cmms_user_id);
CREATE INDEX IF NOT EXISTS idx_user_role_role_id ON public.cmms_user_roles(cmms_role_id);
CREATE INDEX IF NOT EXISTS idx_user_role_company_id ON public.cmms_user_roles(cmms_company_id);

-- ============================================================
-- 6. INVENTORY ITEMS TABLE
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
-- 7. INVENTORY AUDIT LOG TABLE
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
-- 8. STOCK ADJUSTMENT TABLE
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
-- 9. VIEWS FOR EASY QUERYING
-- ============================================================

-- Department Inventory View
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

-- Department Storemen View
DROP VIEW IF EXISTS public.v_department_storemen CASCADE;
CREATE VIEW public.v_department_storemen AS
SELECT
  cd.id AS department_id,
  cd.cmms_company_id,
  cd.department_name,
  cu.id AS user_id,
  cu.user_name,
  cu.email,
  cu.role
FROM public.cmms_departments cd
LEFT JOIN public.cmms_users cu ON cd.id = cu.department_id 
  AND cu.is_active = TRUE 
  AND cu.role IN ('storeman', 'admin')
WHERE cd.is_active = TRUE;

GRANT SELECT ON public.v_department_storemen TO authenticated, anon;

-- ============================================================
-- 10. SECURITY DEFINER FUNCTIONS FOR RLS
-- ============================================================

-- Drop policies first before dropping function
DROP POLICY IF EXISTS "company_select_policy" ON public.cmms_company_profiles;
DROP POLICY IF EXISTS "company_insert_policy" ON public.cmms_company_profiles;
DROP POLICY IF EXISTS "company_update_policy" ON public.cmms_company_profiles;
DROP POLICY IF EXISTS "company_delete_policy" ON public.cmms_company_profiles;
DROP POLICY IF EXISTS "dept_select_policy" ON public.cmms_departments;
DROP POLICY IF EXISTS "dept_insert_policy" ON public.cmms_departments;
DROP POLICY IF EXISTS "dept_update_policy" ON public.cmms_departments;
DROP POLICY IF EXISTS "dept_delete_policy" ON public.cmms_departments;
DROP POLICY IF EXISTS "user_select_policy" ON public.cmms_users;
DROP POLICY IF EXISTS "inventory_select_policy" ON public.cmms_inventory_items;
DROP POLICY IF EXISTS "inventory_insert_policy" ON public.cmms_inventory_items;
DROP POLICY IF EXISTS "inventory_update_policy" ON public.cmms_inventory_items;
DROP POLICY IF EXISTS "inventory_delete_policy" ON public.cmms_inventory_items;
DROP POLICY IF EXISTS "audit_log_select_policy" ON public.cmms_inventory_audit_log;
DROP POLICY IF EXISTS "stock_adj_select_policy" ON public.cmms_stock_adjustments;
DROP POLICY IF EXISTS "stock_adj_insert_policy" ON public.cmms_stock_adjustments;

-- Now drop the function safely
DROP FUNCTION IF EXISTS public.get_user_company_id();

-- Helper function to get current user's company ID (avoids circular RLS references)
CREATE OR REPLACE FUNCTION public.get_user_company_id()
RETURNS UUID AS $$
  SELECT cmms_company_id FROM public.cmms_users WHERE id = auth.uid() LIMIT 1
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

-- ============================================================
-- 11. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================

-- Company Profiles RLS
ALTER TABLE public.cmms_company_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_select_policy ON public.cmms_company_profiles
FOR SELECT USING (
  id = public.get_user_company_id()
);

CREATE POLICY company_insert_policy ON public.cmms_company_profiles
FOR INSERT WITH CHECK (true);

CREATE POLICY company_update_policy ON public.cmms_company_profiles
FOR UPDATE USING (
  id = public.get_user_company_id()
);

CREATE POLICY company_delete_policy ON public.cmms_company_profiles
FOR DELETE USING (
  id = public.get_user_company_id()
);

-- Departments RLS
ALTER TABLE public.cmms_departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY dept_select_policy ON public.cmms_departments
FOR SELECT USING (
  cmms_company_id = public.get_user_company_id()
);

CREATE POLICY dept_insert_policy ON public.cmms_departments
FOR INSERT WITH CHECK (
  cmms_company_id = public.get_user_company_id()
);

CREATE POLICY dept_update_policy ON public.cmms_departments
FOR UPDATE USING (
  cmms_company_id = public.get_user_company_id()
);

CREATE POLICY dept_delete_policy ON public.cmms_departments
FOR DELETE USING (
  cmms_company_id = public.get_user_company_id()
);

-- Users RLS - No circular reference
ALTER TABLE public.cmms_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_select_policy ON public.cmms_users
FOR SELECT USING (
  cmms_company_id = public.get_user_company_id()
);

-- Inventory RLS
ALTER TABLE public.cmms_inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_select_policy ON public.cmms_inventory_items
FOR SELECT USING (
  cmms_company_id = public.get_user_company_id()
);

CREATE POLICY inventory_insert_policy ON public.cmms_inventory_items
FOR INSERT WITH CHECK (
  cmms_company_id = public.get_user_company_id()
);

CREATE POLICY inventory_update_policy ON public.cmms_inventory_items
FOR UPDATE USING (
  cmms_company_id = public.get_user_company_id()
);

CREATE POLICY inventory_delete_policy ON public.cmms_inventory_items
FOR DELETE USING (
  cmms_company_id = public.get_user_company_id()
);

-- Audit Log RLS
ALTER TABLE public.cmms_inventory_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_select_policy ON public.cmms_inventory_audit_log
FOR SELECT USING (
  inventory_item_id IN (
    SELECT id FROM public.cmms_inventory_items
    WHERE cmms_company_id = public.get_user_company_id()
  )
);

-- Stock Adjustments RLS
ALTER TABLE public.cmms_stock_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY stock_adj_select_policy ON public.cmms_stock_adjustments
FOR SELECT USING (
  cmms_company_id = public.get_user_company_id()
);

CREATE POLICY stock_adj_insert_policy ON public.cmms_stock_adjustments
FOR INSERT WITH CHECK (
  cmms_company_id = public.get_user_company_id()
);

-- ============================================================
-- 12. VERIFICATION
-- ============================================================
SELECT 'CMMS Complete Schema created successfully!' as status;

SELECT COUNT(*) as table_count
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name LIKE 'cmms_%';
