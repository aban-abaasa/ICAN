-- ================================================================
-- FIX: Add RPC function to fetch inventory (bypasses RLS)
-- ================================================================
-- Problem: SELECT query blocked by RLS policy - user not in cmms_users table
-- Solution: Create SECURITY DEFINER RPC function for inventory fetch

DROP FUNCTION IF EXISTS public.fn_get_company_inventory(uuid) CASCADE;

CREATE FUNCTION public.fn_get_company_inventory(
  p_company_id uuid
)
RETURNS TABLE(
  id uuid,
  cmms_company_id uuid,
  department_id uuid,
  item_code varchar,
  item_name varchar,
  description text,
  category varchar,
  supplier_name varchar,
  quantity_in_stock numeric,
  reorder_level numeric,
  unit_price numeric,
  storage_location varchar,
  bin_number varchar,
  unit_of_measure varchar,
  lead_time_days integer,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  last_stock_check timestamptz,
  created_by uuid,
  last_updated_by uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Validate input
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Company ID is required';
  END IF;

  -- Return all active inventory items for the company
  -- SECURITY DEFINER bypasses RLS, so this works even if user not in cmms_users
  RETURN QUERY
  SELECT 
    cii.id,
    cii.cmms_company_id,
    cii.department_id,
    cii.item_code,
    cii.item_name,
    cii.description,
    cii.category,
    cii.supplier_name,
    cii.quantity_in_stock,
    cii.reorder_level,
    cii.unit_price,
    cii.storage_location,
    cii.bin_number,
    cii.unit_of_measure,
    cii.lead_time_days,
    cii.is_active,
    cii.created_at,
    cii.updated_at,
    cii.last_stock_check,
    cii.created_by,
    cii.last_updated_by
  FROM public.cmms_inventory_items cii
  WHERE cii.cmms_company_id = p_company_id
    AND cii.is_active = TRUE
  ORDER BY cii.item_code ASC;

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Error fetching inventory: %', SQLERRM;
END;
$$;

ALTER FUNCTION public.fn_get_company_inventory(uuid) SET row_security = OFF;

GRANT EXECUTE ON FUNCTION public.fn_get_company_inventory(uuid) TO authenticated, anon;

SELECT 'RPC function created: fn_get_company_inventory - inventory fetches now bypass RLS!' as status;
