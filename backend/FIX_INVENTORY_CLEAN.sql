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
  v_cmms_user_id uuid;
  v_company_exists boolean;
  v_dept_exists boolean;
BEGIN
  -- Get current user ID
  v_cmms_user_id := auth.uid();
  
  -- Check if inputs are NULL
  IF p_company_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::varchar, NULL::varchar, 'ERROR'::varchar, 'Company ID is NULL - frontend problem'::text;
    RETURN;
  END IF;
  
  IF p_item_name IS NULL OR p_item_name = '' THEN
    RETURN QUERY SELECT NULL::uuid, NULL::varchar, NULL::varchar, 'ERROR'::varchar, 'Item name is required'::text;
    RETURN;
  END IF;
  
  -- Check if company exists
  SELECT EXISTS(SELECT 1 FROM public.cmms_company_profiles WHERE id = p_company_id) INTO v_company_exists;
  
  IF NOT v_company_exists THEN
    RETURN QUERY SELECT NULL::uuid, NULL::varchar, NULL::varchar, 'ERROR'::varchar, format('Company %s not found in cmms_company_profiles', p_company_id)::text;
    RETURN;
  END IF;
  
  -- Check if department exists if provided
  IF p_department_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM public.cmms_departments WHERE id = p_department_id AND cmms_company_id = p_company_id) INTO v_dept_exists;
    
    IF NOT v_dept_exists THEN
      RETURN QUERY SELECT NULL::uuid, NULL::varchar, NULL::varchar, 'ERROR'::varchar, format('Department %s not found in company %s', p_department_id, p_company_id)::text;
      RETURN;
    END IF;
  END IF;
  
  -- Now insert the item
  BEGIN
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
      v_cmms_user_id, 
      v_cmms_user_id, 
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
    RETURN QUERY SELECT NULL::uuid, NULL::varchar, NULL::varchar, 'ERROR'::varchar, format('Insert failed: %s', SQLERRM)::text;
  END;
  
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT NULL::uuid, NULL::varchar, NULL::varchar, 'ERROR'::varchar, format('Function error: %s', SQLERRM)::text;
END;
$$;

ALTER FUNCTION public.fn_create_cmms_inventory_item(uuid, uuid, varchar, varchar, varchar, varchar, numeric, numeric, numeric, varchar, varchar, varchar, varchar, integer) SET row_security = OFF;

GRANT EXECUTE ON FUNCTION public.fn_create_cmms_inventory_item(uuid, uuid, varchar, varchar, varchar, varchar, numeric, numeric, numeric, varchar, varchar, varchar, varchar, integer) TO authenticated;

SELECT 'RPC function deployed with detailed error messages!' as status;
