-- ============================================================
-- CMMS READ FUNCTIONS (Bypass RLS for SELECT operations)
-- ============================================================
-- Run this in Supabase SQL Editor to enable department/user/role fetching

-- Get departments for a company
DROP FUNCTION IF EXISTS public.fn_get_departments_by_company(UUID);
CREATE FUNCTION public.fn_get_departments_by_company(p_company_id UUID)
RETURNS TABLE(id UUID, cmms_company_id UUID, department_name VARCHAR, description TEXT, location VARCHAR, is_active BOOLEAN, created_by UUID, created_at TIMESTAMP, updated_at TIMESTAMP) 
LANGUAGE sql
SECURITY DEFINER
SET row_security = OFF
AS $$
  SELECT 
    cd.id, cd.cmms_company_id, cd.department_name, cd.description, cd.location, 
    cd.is_active, cd.created_by, cd.created_at, cd.updated_at
  FROM public.cmms_departments cd
  WHERE cd.cmms_company_id = p_company_id
  AND cd.is_active = true
  ORDER BY cd.department_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_departments_by_company(UUID) TO authenticated;

-- Get company users
DROP FUNCTION IF EXISTS public.fn_get_company_users_list(UUID);
CREATE FUNCTION public.fn_get_company_users_list(p_company_id UUID)
RETURNS TABLE(id UUID, cmms_company_id UUID, user_name VARCHAR, email VARCHAR, phone VARCHAR, role VARCHAR, is_active BOOLEAN, created_at TIMESTAMP, updated_at TIMESTAMP) 
LANGUAGE sql
SECURITY DEFINER
SET row_security = OFF
AS $$
  SELECT 
    cu.id, cu.cmms_company_id, cu.user_name, cu.email, cu.phone, cu.role, 
    cu.is_active, cu.created_at, cu.updated_at
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
  AND cu.is_active = true
  ORDER BY cu.user_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_company_users_list(UUID) TO authenticated;

-- Get roles
DROP FUNCTION IF EXISTS public.fn_get_all_roles();
CREATE FUNCTION public.fn_get_all_roles()
RETURNS TABLE(id UUID, role_name VARCHAR, display_name VARCHAR, description TEXT, permission_level INT) 
LANGUAGE sql
SECURITY DEFINER
SET row_security = OFF
AS $$
  SELECT cr.id, cr.role_name, cr.display_name, cr.description, cr.permission_level
  FROM public.cmms_roles cr
  WHERE cr.is_active = true
  ORDER BY cr.permission_level DESC;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_all_roles() TO authenticated;

-- Get inventory for company
DROP FUNCTION IF EXISTS public.fn_get_inventory_by_company(UUID);
CREATE FUNCTION public.fn_get_inventory_by_company(p_company_id UUID)
RETURNS TABLE(id UUID, cmms_company_id UUID, item_name VARCHAR, description TEXT, quantity_in_stock INT, reorder_level INT, unit_price DECIMAL, department_id UUID, is_active BOOLEAN, created_at TIMESTAMP, updated_at TIMESTAMP) 
LANGUAGE sql
SECURITY DEFINER
SET row_security = OFF
AS $$
  SELECT 
    cii.id, cii.cmms_company_id, cii.item_name, cii.description, cii.quantity_in_stock,
    cii.reorder_level, cii.unit_price, cii.department_id, cii.is_active, 
    cii.created_at, cii.updated_at
  FROM public.cmms_inventory_items cii
  WHERE cii.cmms_company_id = p_company_id
  AND cii.is_active = true
  ORDER BY cii.item_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_inventory_by_company(UUID) TO authenticated;

-- ============================================================
-- VERIFICATION
-- ============================================================

SELECT 'CMMS Read Functions Deployed!' as status;

SELECT COUNT(*) as functions_created 
FROM information_schema.routines 
WHERE routine_name LIKE 'fn_get%' 
AND routine_schema = 'public';
