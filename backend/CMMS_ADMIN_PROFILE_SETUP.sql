-- ============================================================
-- CMMS ADMIN PROFILE & DEPARTMENT MANAGEMENT SETUP
-- ============================================================
-- This SQL file handles admin profile creation and department setup
-- Run this AFTER CMMS_COMPLETE_SCHEMA.sql

-- ============================================================
-- 0. COMPATIBILITY PATCHES (for older cmms_* schemas)
-- ============================================================
-- Some older setup files created cmms_roles with a different column set
-- (e.g. can_view_company/can_edit_company) and without can_approve_work_orders.
-- This patch makes the table compatible before role inserts below.

-- Drop restrictive check constraint if it exists
ALTER TABLE IF EXISTS public.cmms_roles
  DROP CONSTRAINT IF EXISTS valid_permission_level;

ALTER TABLE IF EXISTS public.cmms_roles
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS permission_level INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS can_create_work_orders BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_approve_work_orders BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_view_reports BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_manage_users BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_edit_inventory BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_manage_departments BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_manage_roles BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_manage_budget BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add new check constraint to allow permission levels 1-10
ALTER TABLE IF EXISTS public.cmms_roles
  ADD CONSTRAINT valid_permission_level CHECK (permission_level BETWEEN 1 AND 10);

UPDATE public.cmms_roles
SET display_name = INITCAP(role_name)
WHERE display_name IS NULL;

ALTER TABLE IF EXISTS public.cmms_users
  ADD COLUMN IF NOT EXISTS role VARCHAR(50),
  ADD COLUMN IF NOT EXISTS is_creator BOOLEAN DEFAULT FALSE;

ALTER TABLE IF EXISTS public.cmms_inventory_items
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS last_updated_by UUID;

-- ============================================================
-- 1. DEFAULT ROLES SETUP
-- ============================================================

-- Admin Role
INSERT INTO public.cmms_roles (
  role_name,
  display_name,
  description,
  permission_level,
  can_create_work_orders,
  can_approve_work_orders,
  can_view_reports,
  can_manage_users,
  can_edit_inventory,
  can_manage_departments,
  can_manage_roles,
  can_manage_budget
)
SELECT 'admin', 'Admin', 'Administrator with full access', 10, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM public.cmms_roles WHERE role_name = 'admin');

-- Storeman Role
INSERT INTO public.cmms_roles (
  role_name,
  display_name,
  description,
  permission_level,
  can_create_work_orders,
  can_approve_work_orders,
  can_view_reports,
  can_manage_users,
  can_edit_inventory,
  can_manage_departments,
  can_manage_roles,
  can_manage_budget
)
SELECT 'storeman', 'Storeman', 'Storeman for inventory management', 5, FALSE, FALSE, TRUE, FALSE, TRUE, FALSE, FALSE, FALSE
WHERE NOT EXISTS (SELECT 1 FROM public.cmms_roles WHERE role_name = 'storeman');

-- Maintenance Technician Role
INSERT INTO public.cmms_roles (
  role_name,
  display_name,
  description,
  permission_level,
  can_create_work_orders,
  can_approve_work_orders,
  can_view_reports,
  can_manage_users,
  can_edit_inventory,
  can_manage_departments,
  can_manage_roles,
  can_manage_budget
)
SELECT 'technician', 'Technician', 'Maintenance technician', 3, TRUE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE
WHERE NOT EXISTS (SELECT 1 FROM public.cmms_roles WHERE role_name = 'technician');

-- Manager Role
INSERT INTO public.cmms_roles (
  role_name,
  display_name,
  description,
  permission_level,
  can_create_work_orders,
  can_approve_work_orders,
  can_view_reports,
  can_manage_users,
  can_edit_inventory,
  can_manage_departments,
  can_manage_roles,
  can_manage_budget
)
SELECT 'manager', 'Manager', 'Maintenance manager', 7, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, FALSE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM public.cmms_roles WHERE role_name = 'manager');

-- Staff Role
INSERT INTO public.cmms_roles (
  role_name,
  display_name,
  description,
  permission_level,
  can_create_work_orders,
  can_approve_work_orders,
  can_view_reports,
  can_manage_users,
  can_edit_inventory,
  can_manage_departments,
  can_manage_roles,
  can_manage_budget
)
SELECT 'staff', 'Staff', 'General staff member', 1, FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE
WHERE NOT EXISTS (SELECT 1 FROM public.cmms_roles WHERE role_name = 'staff');

-- ============================================================
-- 2. PL/pgSQL FUNCTION: CREATE COMPANY WITH ADMIN USER
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_create_cmms_company(
  p_company_name VARCHAR,
  p_email VARCHAR,
  p_admin_user_id UUID,
  p_admin_name VARCHAR,
  p_phone VARCHAR,
  p_website VARCHAR,
  p_location VARCHAR,
  p_industry VARCHAR
)
RETURNS TABLE(
  company_id UUID,
  admin_user_id UUID,
  status VARCHAR,
  message TEXT
) AS $$
DECLARE
  v_company_id UUID;
  v_admin_role_id UUID;
  v_user_id UUID;
BEGIN
  -- Create company profile
  INSERT INTO public.cmms_company_profiles (
    company_name,
    email,
    phone,
    website,
    location,
    industry,
    created_by
  )
  VALUES (p_company_name, p_email, p_phone, p_website, p_location, p_industry, p_admin_user_id)
  RETURNING id INTO v_company_id;
  
  -- Get admin role
  SELECT id INTO v_admin_role_id FROM public.cmms_roles WHERE role_name = 'admin' LIMIT 1;
  
  -- Create admin user for company
  INSERT INTO public.cmms_users (
    cmms_company_id,
    user_name,
    email,
    is_creator,
    role
  )
  VALUES (v_company_id, p_admin_name, p_email, TRUE, 'admin')
  RETURNING id INTO v_user_id;
  
  -- Assign admin role to user
  IF v_admin_role_id IS NOT NULL THEN
    INSERT INTO public.cmms_user_roles (
      cmms_company_id,
      cmms_user_id,
      cmms_role_id,
      assigned_by
    )
    VALUES (v_company_id, v_user_id, v_admin_role_id, p_admin_user_id);
  END IF;
  
  RETURN QUERY SELECT v_company_id, v_user_id, 'SUCCESS'::VARCHAR, 'Company created with admin user'::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'ERROR'::VARCHAR, SQLERRM::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3. PL/pgSQL FUNCTION: CREATE DEPARTMENT
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_create_cmms_department(
  p_company_id UUID,
  p_department_name VARCHAR,
  p_description TEXT,
  p_location VARCHAR,
  p_created_by UUID
)
RETURNS TABLE(
  department_id UUID,
  status VARCHAR,
  message TEXT
) AS $$
DECLARE
  v_dept_id UUID;
BEGIN
  -- Check if user belongs to company
  IF p_created_by IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cmms_users 
      WHERE id = p_created_by AND cmms_company_id = p_company_id
    ) THEN
      RETURN QUERY SELECT NULL::UUID, 'ERROR'::VARCHAR, 'User does not belong to company'::TEXT;
      RETURN;
    END IF;
  END IF;
  
  -- Try to insert department
  INSERT INTO public.cmms_departments (
    cmms_company_id,
    department_name,
    description,
    location,
    created_by
  )
  VALUES (p_company_id, p_department_name, p_description, p_location, p_created_by)
  RETURNING id INTO v_dept_id;
  
  RETURN QUERY SELECT v_dept_id, 'SUCCESS'::VARCHAR, 'Department created successfully'::TEXT;
  
EXCEPTION WHEN unique_violation THEN
  RETURN QUERY SELECT NULL::UUID, 'ERROR'::VARCHAR, 'Department name already exists in this company'::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT NULL::UUID, 'ERROR'::VARCHAR, SQLERRM::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. PL/pgSQL FUNCTION: UPDATE DEPARTMENT
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_update_cmms_department(
  p_department_id UUID,
  p_department_name VARCHAR,
  p_description TEXT,
  p_location VARCHAR,
  p_is_active BOOLEAN
)
RETURNS TABLE(
  status VARCHAR,
  message TEXT
) AS $$
BEGIN
  UPDATE public.cmms_departments
  SET
    department_name = COALESCE(p_department_name, department_name),
    description = COALESCE(p_description, description),
    location = COALESCE(p_location, location),
    is_active = COALESCE(p_is_active, is_active),
    updated_at = NOW()
  WHERE id = p_department_id;
  
  IF FOUND THEN
    RETURN QUERY SELECT 'SUCCESS'::VARCHAR, 'Department updated successfully'::TEXT;
  ELSE
    RETURN QUERY SELECT 'ERROR'::VARCHAR, 'Department not found'::TEXT;
  END IF;
  
EXCEPTION WHEN unique_violation THEN
  RETURN QUERY SELECT 'ERROR'::VARCHAR, 'Department name already exists in this company'::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT 'ERROR'::VARCHAR, SQLERRM::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 5. PL/pgSQL FUNCTION: DELETE DEPARTMENT (Soft Delete)
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_delete_cmms_department(
  p_department_id UUID
)
RETURNS TABLE(
  status VARCHAR,
  message TEXT
) AS $$
BEGIN
  -- Soft delete: set is_active to FALSE
  UPDATE public.cmms_departments
  SET
    is_active = FALSE,
    updated_at = NOW()
  WHERE id = p_department_id;
  
  IF FOUND THEN
    -- Also soft delete associated inventory items
    UPDATE public.cmms_inventory_items
    SET is_active = FALSE, updated_at = NOW()
    WHERE department_id = p_department_id;
    
    RETURN QUERY SELECT 'SUCCESS'::VARCHAR, 'Department deleted successfully'::TEXT;
  ELSE
    RETURN QUERY SELECT 'ERROR'::VARCHAR, 'Department not found'::TEXT;
  END IF;
  
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT 'ERROR'::VARCHAR, SQLERRM::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 6. PL/pgSQL FUNCTION: GET COMPANY STATS
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_get_company_stats(p_company_id UUID)
RETURNS TABLE(
  total_departments INTEGER,
  total_users INTEGER,
  total_inventory_items INTEGER,
  total_inventory_value NUMERIC,
  low_stock_items INTEGER,
  out_of_stock_items INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH dept_count AS (
    SELECT COUNT(*) as count FROM public.cmms_departments 
    WHERE cmms_company_id = p_company_id AND is_active = TRUE
  ),
  user_count AS (
    SELECT COUNT(*) as count FROM public.cmms_users 
    WHERE cmms_company_id = p_company_id AND is_active = TRUE
  ),
  inv_stats AS (
    SELECT
      COUNT(*) as total_items,
      COALESCE(SUM(quantity_in_stock * unit_price), 0) as total_value,
      COUNT(CASE WHEN quantity_in_stock <= reorder_level THEN 1 END) as low_stock,
      COUNT(CASE WHEN quantity_in_stock = 0 THEN 1 END) as out_of_stock
    FROM public.cmms_inventory_items
    WHERE cmms_company_id = p_company_id AND is_active = TRUE
  )
  SELECT
    (SELECT count FROM dept_count)::INTEGER,
    (SELECT count FROM user_count)::INTEGER,
    (SELECT total_items FROM inv_stats)::INTEGER,
    (SELECT total_value FROM inv_stats),
    (SELECT low_stock FROM inv_stats)::INTEGER,
    (SELECT out_of_stock FROM inv_stats)::INTEGER;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 7. TRIGGER: AUTO UPDATE UPDATED_AT
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_cmms_company_updated_at ON public.cmms_company_profiles;
CREATE TRIGGER trg_update_cmms_company_updated_at
BEFORE UPDATE ON public.cmms_company_profiles
FOR EACH ROW
EXECUTE FUNCTION public.fn_update_updated_at();

DROP TRIGGER IF EXISTS trg_update_cmms_dept_updated_at ON public.cmms_departments;
CREATE TRIGGER trg_update_cmms_dept_updated_at
BEFORE UPDATE ON public.cmms_departments
FOR EACH ROW
EXECUTE FUNCTION public.fn_update_updated_at();

DROP TRIGGER IF EXISTS trg_update_cmms_user_updated_at ON public.cmms_users;
CREATE TRIGGER trg_update_cmms_user_updated_at
BEFORE UPDATE ON public.cmms_users
FOR EACH ROW
EXECUTE FUNCTION public.fn_update_updated_at();

DROP TRIGGER IF EXISTS trg_update_cmms_inventory_updated_at ON public.cmms_inventory_items;
CREATE TRIGGER trg_update_cmms_inventory_updated_at
BEFORE UPDATE ON public.cmms_inventory_items
FOR EACH ROW
EXECUTE FUNCTION public.fn_update_updated_at();

-- ============================================================
-- 8. TRIGGER: INVENTORY AUDIT LOG
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_log_inventory_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.cmms_inventory_audit_log (
      inventory_item_id,
      action,
      new_quantity,
      changed_by,
      change_reason
    )
    VALUES (
      NEW.id,
      'CREATED',
      NEW.quantity_in_stock,
      NEW.created_by,
      'Inventory item created'
    );
  ELSIF TG_OP = 'UPDATE' AND OLD.quantity_in_stock != NEW.quantity_in_stock THEN
    INSERT INTO public.cmms_inventory_audit_log (
      inventory_item_id,
      action,
      old_quantity,
      new_quantity,
      quantity_change,
      changed_by,
      change_reason
    )
    VALUES (
      NEW.id,
      'QUANTITY_UPDATED',
      OLD.quantity_in_stock,
      NEW.quantity_in_stock,
      NEW.quantity_in_stock - OLD.quantity_in_stock,
      NEW.last_updated_by,
      'Quantity updated'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_inventory_changes ON public.cmms_inventory_items;
CREATE TRIGGER trg_log_inventory_changes
AFTER INSERT OR UPDATE ON public.cmms_inventory_items
FOR EACH ROW
EXECUTE FUNCTION public.fn_log_inventory_change();

-- ============================================================
-- 9. VERIFICATION
-- ============================================================

SELECT 'CMMS Admin Profile & Department Management Setup Complete!' as status;

SELECT COUNT(*) as role_count FROM public.cmms_roles;
