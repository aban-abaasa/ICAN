-- ================================================================
-- FIX: Handle duplicate inventory items (UPDATE instead of INSERT)
-- ================================================================
-- Problem: duplicate key value violates unique constraint "unique_item_per_dept"
-- Solution: Check if item with same code exists in department, UPDATE if yes, INSERT if no

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
  v_item_code varchar;
  v_existing_id uuid;
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

  -- Generate item code if not provided
  v_item_code := COALESCE(p_item_code, SUBSTRING(p_item_name, 1, 10) || '-' || to_char(NOW(), 'MMDD'));

  -- Check if item with same code already exists in this department
  SELECT cii.id INTO v_existing_id 
  FROM public.cmms_inventory_items cii
  WHERE cii.cmms_company_id = p_company_id 
    AND cii.department_id = p_department_id 
    AND cii.item_code = v_item_code
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Item exists - UPDATE it instead
    UPDATE public.cmms_inventory_items
    SET 
      item_name = p_item_name,
      description = p_description,
      category = COALESCE(p_category, 'Spare Parts'),
      quantity_in_stock = COALESCE(p_quantity_in_stock, 0),
      reorder_level = COALESCE(p_reorder_level, 0),
      unit_price = COALESCE(p_unit_price, 0),
      supplier_name = p_supplier_name,
      storage_location = p_storage_location,
      bin_number = p_bin_number,
      unit_of_measure = COALESCE(p_unit_of_measure, 'units'),
      lead_time_days = COALESCE(p_lead_time_days, 0),
      last_updated_by = NULL,
      updated_at = NOW()
    WHERE id = v_existing_id;
    
    v_item_id := v_existing_id;
    
    RETURN QUERY SELECT 
      v_item_id,
      v_item_code,
      p_item_name, 
      'SUCCESS'::varchar, 
      'Inventory item updated successfully'::text;
  ELSE
    -- Item does not exist - INSERT new one
    INSERT INTO public.cmms_inventory_items (
      cmms_company_id, department_id, item_name, item_code, description, category,
      quantity_in_stock, reorder_level, unit_price, supplier_name, storage_location,
      bin_number, unit_of_measure, lead_time_days, is_active, created_by, last_updated_by, last_stock_check
    )
    VALUES (
      p_company_id, 
      p_department_id, 
      p_item_name,
      v_item_code,
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
      v_item_code,
      p_item_name, 
      'SUCCESS'::varchar, 
      'Inventory item created successfully'::text;
  END IF;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT NULL::uuid, NULL::varchar, NULL::varchar, 'ERROR'::varchar, format('Error: %s', SQLERRM)::text;
END;
$$;

ALTER FUNCTION public.fn_create_cmms_inventory_item(uuid, uuid, varchar, varchar, varchar, varchar, numeric, numeric, numeric, varchar, varchar, varchar, varchar, integer) SET row_security = OFF;

GRANT EXECUTE ON FUNCTION public.fn_create_cmms_inventory_item(uuid, uuid, varchar, varchar, varchar, varchar, numeric, numeric, numeric, varchar, varchar, varchar, varchar, integer) TO authenticated;

SELECT 'Function updated to handle duplicate items - now UPDATEs instead of INSERT when item_code already exists!' as status;
