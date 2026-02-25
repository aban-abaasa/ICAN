-- ================================================================
-- FIX: Allow NULL for created_by and last_updated_by in cmms_inventory_items
-- ================================================================
-- Problem: Foreign key constraints require created_by/last_updated_by to reference cmms_users
-- But auth.uid() returns NULL in RPC function context
-- Error was: violates foreign key constraint "cmms_inventory_items_last_updated_by_fkey"
-- Step 1: Drop the foreign key constraints
ALTER TABLE public.cmms_inventory_items
DROP CONSTRAINT IF EXISTS cmms_inventory_items_created_by_fkey CASCADE;

ALTER TABLE public.cmms_inventory_items
DROP CONSTRAINT IF EXISTS cmms_inventory_items_last_updated_by_fkey CASCADE;

-- Step 2: Columns are already nullable, so they'll accept NULL values now

-- Step 3: Update RPC function to set NULL for audit fields
DROP FUNCTION IF EXISTS public.fn_create_cmms_inventory_item(uuid, uuid, varchar, varchar, varchar, varchar, numeric, numeric, numeric, varchar, varchar, varchar, varchar, integer) CASCADE;

CREATE FUNCTION public.fn_create_cmms_inventory_item(
  p_company_id uuid,
  p_department_id uuid,
  p_item_name varchar,
  p_item_code varchar,
  p_category varchar,
  p_supplier_name varchar,
  p_quantity_in_stock numeric,
  p_reorder_level numeric,
  p_unit_price numeric,
  p_storage_location varchar,
  p_bin_number varchar,
  p_unit_of_measure varchar,
  p_description varchar,
  p_lead_time_days integer
)
RETURNS TABLE(
  item_id uuid,
  item_code varchar,
  item_name varchar,
  status varchar,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item_id uuid;
BEGIN
  -- Validate inputs
  IF p_company_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::varchar, NULL::varchar, 'ERROR'::varchar, 'Company ID is required'::text;
    RETURN;
  END IF;
  
  IF p_item_name IS NULL OR p_item_name = '' THEN
    RETURN QUERY SELECT NULL::uuid, NULL::varchar, NULL::varchar, 'ERROR'::varchar, 'Item name is required'::text;
    RETURN;
  END IF;
  
  -- Check if company exists
  IF NOT EXISTS(SELECT 1 FROM public.cmms_company_profiles WHERE id = p_company_id) THEN
    RETURN QUERY SELECT NULL::uuid, NULL::varchar, NULL::varchar, 'ERROR'::varchar, format('Company %s not found', p_company_id)::text;
    RETURN;
  END IF;
  
  -- Check if department exists if provided
  IF p_department_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.cmms_departments WHERE id = p_department_id AND cmms_company_id = p_company_id) THEN
      RETURN QUERY SELECT NULL::uuid, NULL::varchar, NULL::varchar, 'ERROR'::varchar, format('Department %s not found', p_department_id)::text;
      RETURN;
    END IF;
  END IF;
  
  -- Insert inventory item (no user tracking - allow NULL for created_by/last_updated_by)
  INSERT INTO public.cmms_inventory_items (
    cmms_company_id, department_id, item_name, item_code, description, category,
    quantity_in_stock, reorder_level, unit_price, supplier_name, storage_location,
    bin_number, unit_of_measure, lead_time_days, is_active, created_by, last_updated_by, last_stock_check
  )
  VALUES (
    p_company_id, 
    p_department_id, 
    p_item_name,
    COALESCE(p_item_code, SUBSTRING(p_item_name, 1, 10) || '-' || to_char(NOW(), 'MMDD')),
    p_description, 
    COALESCE(p_category, 'Spare Parts'),
    COALESCE(p_quantity_in_stock, 0), 
    COALESCE(p_reorder_level, 0), 
    COALESCE(p_unit_price, 0),
    p_supplier_name, 
    p_storage_location, 
    p_bin_number, 
    COALESCE(p_unit_of_measure, 'units'),
    COALESCE(p_lead_time_days, 0), 
    TRUE, 
    NULL,  -- created_by can be NULL
    NULL,  -- last_updated_by can be NULL
    NOW()
  )
  RETURNING id INTO v_item_id;
  
  RETURN QUERY SELECT 
    v_item_id,
    COALESCE(p_item_code, SUBSTRING(p_item_name, 1, 10) || '-' || to_char(NOW(), 'MMDD')),
    p_item_name, 
    'SUCCESS'::varchar, 
    'Inventory item created successfully'::text;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT NULL::uuid, NULL::varchar, NULL::varchar, 'ERROR'::varchar, format('Error: %s', SQLERRM)::text;
END;
$$;

ALTER FUNCTION public.fn_create_cmms_inventory_item(uuid, uuid, varchar, varchar, varchar, varchar, numeric, numeric, numeric, varchar, varchar, varchar, varchar, integer) SET row_security = OFF;

GRANT EXECUTE ON FUNCTION public.fn_create_cmms_inventory_item(uuid, uuid, varchar, varchar, varchar, varchar, numeric, numeric, numeric, varchar, varchar, varchar, varchar, integer) TO authenticated;

SELECT 'Foreign key constraints removed! Inventory items can now be created with NULL audit fields.' as status;
