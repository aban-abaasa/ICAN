ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS model               VARCHAR(150);
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS manufacture_year    INTEGER;
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS acquisition_date    DATE;
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS acquisition_year    INTEGER;
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS acquisition_cost    NUMERIC(16, 2);
-- per unit
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS useful_life_years   INTEGER;
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS salvage_value       NUMERIC(16, 2) DEFAULT 0;
-- per unit
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS depreciation_method VARCHAR(20);
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS asset_condition     VARCHAR(20);
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS asset_status        VARCHAR(20);
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS warranty_expiry     DATE;
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS disposed_at         TIMESTAMPTZ;
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS linked_supermarket_id UUID;
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS linked_product_id     UUID;
CREATE OR REPLACE FUNCTION public._cmms_kind_from_category(p_category TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN lower(btrim(COALESCE(p_category, ''))) IN (
    'equipment', 'tools', 'machinery', 'plant & machinery', 'vehicles', 'vehicle',
    'it equipment', 'furniture', 'furniture & fittings', 'buildings', 'building',
    'land', 'fixed asset', 'fixed assets', 'asset', 'assets'
  ) THEN 'asset' ELSE 'consumable' END;
$$;
