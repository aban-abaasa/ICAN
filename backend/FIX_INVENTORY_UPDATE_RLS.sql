-- ============================================================
-- FIX: Inventory Item Update RLS
-- Problem: UPDATE on cmms_inventory_items blocked by RLS because
--   cmms_users.id ≠ auth.uid() — same root cause as requisitions
-- Solution: SECURITY DEFINER function + permissive RLS fallback
-- ============================================================

-- 1. Fix RLS policies to be more permissive
ALTER TABLE public.cmms_inventory_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_select_policy" ON public.cmms_inventory_items;
CREATE POLICY "inventory_select_policy" ON public.cmms_inventory_items
FOR SELECT USING (
  auth.uid() IS NOT NULL
);

DROP POLICY IF EXISTS "inventory_insert_policy" ON public.cmms_inventory_items;
CREATE POLICY "inventory_insert_policy" ON public.cmms_inventory_items
FOR INSERT WITH CHECK (
  auth.uid() IS NOT NULL
);

DROP POLICY IF EXISTS "inventory_update_policy" ON public.cmms_inventory_items;
CREATE POLICY "inventory_update_policy" ON public.cmms_inventory_items
FOR UPDATE USING (
  auth.uid() IS NOT NULL
);

DROP POLICY IF EXISTS "inventory_delete_policy" ON public.cmms_inventory_items;
CREATE POLICY "inventory_delete_policy" ON public.cmms_inventory_items
FOR DELETE USING (
  auth.uid() IS NOT NULL
);

-- 2. SECURITY DEFINER function for inventory update (guaranteed RLS bypass)
DROP FUNCTION IF EXISTS public.fn_update_inventory_item(UUID, JSONB);
CREATE OR REPLACE FUNCTION public.fn_update_inventory_item(
  p_item_id UUID,
  p_updates JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify item exists
  IF NOT EXISTS (SELECT 1 FROM public.cmms_inventory_items WHERE id = p_item_id) THEN
    RAISE EXCEPTION 'Inventory item not found';
  END IF;

  -- Apply updates dynamically
  UPDATE public.cmms_inventory_items
  SET
    item_name        = COALESCE(p_updates->>'item_name', item_name),
    category         = COALESCE(p_updates->>'category', category),
    quantity_in_stock = CASE WHEN p_updates ? 'quantity_in_stock' THEN (p_updates->>'quantity_in_stock')::NUMERIC ELSE quantity_in_stock END,
    reorder_level    = CASE WHEN p_updates ? 'minimum_stock_level' THEN (p_updates->>'minimum_stock_level')::NUMERIC
                            WHEN p_updates ? 'reorder_level' THEN (p_updates->>'reorder_level')::NUMERIC
                            ELSE reorder_level END,
    unit_price       = CASE WHEN p_updates ? 'unit_cost' THEN (p_updates->>'unit_cost')::NUMERIC
                            WHEN p_updates ? 'unit_price' THEN (p_updates->>'unit_price')::NUMERIC
                            ELSE unit_price END,
    department_id    = CASE WHEN p_updates ? 'department_id' THEN NULLIF(p_updates->>'department_id', '')::UUID ELSE department_id END,
    assigned_storeman_id = CASE WHEN p_updates ? 'assigned_storeman_id' THEN NULLIF(p_updates->>'assigned_storeman_id', '')::UUID ELSE assigned_storeman_id END,
    storage_location = COALESCE(NULLIF(p_updates->>'storage_location', ''), storage_location),
    supplier_name    = COALESCE(NULLIF(p_updates->>'supplier_name', ''), supplier_name),
    updated_at       = NOW(),
    last_stock_check = NOW()
  WHERE id = p_item_id;

  -- Return the updated item
  SELECT to_jsonb(i) INTO v_result
  FROM public.cmms_inventory_items i
  WHERE i.id = p_item_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_update_inventory_item TO authenticated;

SELECT 'Inventory update RLS fixed!' AS status;
