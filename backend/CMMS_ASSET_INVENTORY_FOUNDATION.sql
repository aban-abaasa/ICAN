-- ============================================================================
-- CMMS asset register and shared Pichin business link
-- ============================================================================
-- Additive migration. Operational inventory remains separate from POS stock.

ALTER TABLE IF EXISTS public.cmms_company_profiles
  ADD COLUMN IF NOT EXISTS pichin_business_profile_id UUID
    REFERENCES public.business_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS business_mode TEXT DEFAULT 'sole_proprietor';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cmms_company_profiles'::regclass
      AND conname = 'cmms_company_business_mode_check'
  ) THEN
    ALTER TABLE public.cmms_company_profiles
      ADD CONSTRAINT cmms_company_business_mode_check
      CHECK (business_mode IN ('sole_proprietor', 'organisation', 'enterprise'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cmms_company_pichin_business
  ON public.cmms_company_profiles(pichin_business_profile_id);

CREATE TABLE IF NOT EXISTS public.cmms_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  pichin_business_profile_id UUID REFERENCES public.business_profiles(id) ON DELETE SET NULL,
  asset_code TEXT NOT NULL,
  asset_name TEXT NOT NULL,
  asset_category TEXT NOT NULL,
  description TEXT,
  serial_number TEXT,
  registration_number TEXT,
  manufacturer TEXT,
  model TEXT,
  purchase_date DATE,
  purchase_cost NUMERIC(15,2),
  warranty_expires_at DATE,
  location TEXT,
  department_id UUID REFERENCES public.cmms_departments(id) ON DELETE SET NULL,
  assigned_cmms_user_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'maintenance', 'retired', 'disposed', 'lost')),
  depreciation_method TEXT,
  useful_life_months INTEGER,
  residual_value NUMERIC(15,2),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cmms_company_id, asset_code)
);

CREATE INDEX IF NOT EXISTS idx_cmms_assets_company
  ON public.cmms_assets(cmms_company_id, status);
CREATE INDEX IF NOT EXISTS idx_cmms_assets_category
  ON public.cmms_assets(asset_category);
CREATE INDEX IF NOT EXISTS idx_cmms_assets_department
  ON public.cmms_assets(department_id);

CREATE TABLE IF NOT EXISTS public.cmms_asset_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES public.cmms_assets(id) ON DELETE CASCADE,
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  performed_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.cmms_assets_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cmms_assets_updated_at_trigger ON public.cmms_assets;
CREATE TRIGGER cmms_assets_updated_at_trigger
  BEFORE UPDATE ON public.cmms_assets
  FOR EACH ROW EXECUTE FUNCTION public.cmms_assets_updated_at();

CREATE OR REPLACE FUNCTION public.cmms_asset_audit_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.cmms_asset_audit_log
    (asset_id, cmms_company_id, action, old_value, new_value, performed_by)
  VALUES
    (COALESCE(NEW.id, OLD.id), COALESCE(NEW.cmms_company_id, OLD.cmms_company_id),
     lower(TG_OP), CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
     CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END,
     (SELECT id FROM public.cmms_users
      WHERE lower(email) = lower(COALESCE(auth.jwt()->>'email', ''))
      ORDER BY created_at ASC LIMIT 1));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS cmms_asset_audit_trigger ON public.cmms_assets;
CREATE TRIGGER cmms_asset_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.cmms_assets
  FOR EACH ROW EXECUTE FUNCTION public.cmms_asset_audit_trigger();

ALTER TABLE public.cmms_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_asset_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cmms_assets_company_access ON public.cmms_assets;
CREATE POLICY cmms_assets_company_access ON public.cmms_assets
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cmms_users cu
    WHERE cu.cmms_company_id = cmms_assets.cmms_company_id
      AND lower(cu.email) = lower(auth.jwt()->>'email')
      AND cu.is_active = true
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.cmms_users cu
    WHERE cu.cmms_company_id = cmms_assets.cmms_company_id
      AND lower(cu.email) = lower(auth.jwt()->>'email')
      AND cu.is_active = true
  ));

DROP POLICY IF EXISTS cmms_asset_audit_company_access ON public.cmms_asset_audit_log;
CREATE POLICY cmms_asset_audit_company_access ON public.cmms_asset_audit_log
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cmms_users cu
    WHERE cu.cmms_company_id = cmms_asset_audit_log.cmms_company_id
      AND lower(cu.email) = lower(auth.jwt()->>'email')
      AND cu.is_active = true
  ));

COMMENT ON TABLE public.cmms_assets IS
  'Company-owned operational assets; distinct from Supermarketa POS sellable stock';
