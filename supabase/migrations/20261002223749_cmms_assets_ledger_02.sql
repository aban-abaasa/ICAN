ALTER TABLE public.cmms_company_profiles ADD COLUMN IF NOT EXISTS timezone        VARCHAR(60);
ALTER TABLE public.cmms_company_profiles ADD COLUMN IF NOT EXISTS supermarket_id  UUID;
CREATE INDEX IF NOT EXISTS idx_cmms_company_group ON public.cmms_company_profiles(group_id);
CREATE INDEX IF NOT EXISTS idx_cmms_company_supermarket ON public.cmms_company_profiles(supermarket_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cmms_one_hq_per_group
  ON public.cmms_company_profiles(group_id) WHERE is_headquarters AND group_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.cmms_group_fx_rates (
  group_id       UUID NOT NULL REFERENCES public.cmms_business_groups(id) ON DELETE CASCADE,
  currency       VARCHAR(3) NOT NULL,
  rate_to_base   NUMERIC(20, 8) NOT NULL CHECK (rate_to_base > 0),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, currency, effective_from)
);
CREATE OR REPLACE FUNCTION public._cmms_can_view_company(p_company_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cmms_member_user_id(p_company_id) IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM public.cmms_company_profiles c
        JOIN public.cmms_company_profiles hq ON hq.group_id = c.group_id AND hq.is_headquarters
        WHERE c.id = p_company_id AND c.group_id IS NOT NULL
          AND public._cmms_is_company_admin(hq.id)
      );
$$;
CREATE OR REPLACE FUNCTION public._cmms_is_group_hq_admin(p_group_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_group_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.cmms_company_profiles hq
    WHERE hq.group_id = p_group_id AND hq.is_headquarters
      AND public._cmms_is_company_admin(hq.id)
  );
$$;
ALTER TABLE public.cmms_business_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY cmms_group_select ON public.cmms_business_groups FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.cmms_company_profiles c
          WHERE c.group_id = cmms_business_groups.id AND public._cmms_can_view_company(c.id))
);
ALTER TABLE public.cmms_group_fx_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY cmms_fx_select ON public.cmms_group_fx_rates FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.cmms_company_profiles c
          WHERE c.group_id = cmms_group_fx_rates.group_id AND public._cmms_can_view_company(c.id))
);
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS assigned_storeman_id UUID;
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS item_kind           VARCHAR(20);
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS asset_tag           VARCHAR(100);
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS serial_number       VARCHAR(150);
ALTER TABLE public.cmms_inventory_items ADD COLUMN IF NOT EXISTS manufacturer        VARCHAR(150);
