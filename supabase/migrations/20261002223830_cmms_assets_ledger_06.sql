DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cmms_item_kind') THEN
    ALTER TABLE public.cmms_inventory_items ADD CONSTRAINT chk_cmms_item_kind CHECK (item_kind IN ('asset', 'consumable'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cmms_item_dep_method') THEN
    ALTER TABLE public.cmms_inventory_items ADD CONSTRAINT chk_cmms_item_dep_method
      CHECK (depreciation_method IS NULL OR depreciation_method IN ('straight_line', 'declining_balance', 'none'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cmms_item_asset_status') THEN
    ALTER TABLE public.cmms_inventory_items ADD CONSTRAINT chk_cmms_item_asset_status
      CHECK (asset_status IS NULL OR asset_status IN ('in_service', 'in_repair', 'idle', 'disposed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cmms_item_years') THEN
    ALTER TABLE public.cmms_inventory_items ADD CONSTRAINT chk_cmms_item_years
      CHECK ((acquisition_year  IS NULL OR acquisition_year  BETWEEN 1900 AND 2200)
         AND (manufacture_year  IS NULL OR manufacture_year  BETWEEN 1800 AND 2200)
         AND (useful_life_years IS NULL OR useful_life_years BETWEEN 1 AND 100));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_cmms_inventory_kind ON public.cmms_inventory_items(cmms_company_id, item_kind) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_cmms_inventory_linked_product ON public.cmms_inventory_items(linked_product_id) WHERE linked_product_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public._cmms_item_defaults()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.item_kind IS NULL THEN
    NEW.item_kind := public._cmms_kind_from_category(NEW.category);
  END IF;
  IF NEW.item_kind = 'asset' THEN
    NEW.acquisition_cost    := COALESCE(NEW.acquisition_cost, NEW.unit_price);
    NEW.acquisition_year    := COALESCE(NEW.acquisition_year,
                                        EXTRACT(YEAR FROM COALESCE(NEW.acquisition_date, NOW()))::INT);
    NEW.useful_life_years   := COALESCE(NEW.useful_life_years, 5);
    NEW.depreciation_method := COALESCE(NEW.depreciation_method, 'straight_line');
    NEW.asset_condition     := COALESCE(NEW.asset_condition, 'good');
    NEW.asset_status        := COALESCE(NEW.asset_status, 'in_service');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_cmms_item_defaults
  BEFORE INSERT OR UPDATE OF item_kind, category ON public.cmms_inventory_items
  FOR EACH ROW EXECUTE FUNCTION public._cmms_item_defaults();
