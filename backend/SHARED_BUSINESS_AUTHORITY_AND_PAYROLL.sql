-- ============================================================================
-- Shared Pichin business authority, application links, members, and payroll
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.business_app_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  app_key TEXT NOT NULL CHECK (app_key IN ('cmms', 'supermarketa', 'agribone', 'bodagoera')),
  source_entity_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'suspended', 'revoked')),
  linked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_key, source_entity_id),
  UNIQUE (business_profile_id, app_key, source_entity_id)
);

CREATE INDEX IF NOT EXISTS idx_business_app_links_profile
  ON public.business_app_links(business_profile_id, app_key, status);

CREATE TABLE IF NOT EXISTS public.business_account_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  employment_status TEXT NOT NULL DEFAULT 'active'
    CHECK (employment_status IN ('invited', 'active', 'suspended', 'terminated')),
  job_title TEXT,
  department TEXT,
  employee_number TEXT,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_profile_id, auth_user_id)
);

CREATE INDEX IF NOT EXISTS idx_business_members_profile
  ON public.business_account_members(business_profile_id, employment_status);
CREATE INDEX IF NOT EXISTS idx_business_members_auth_user
  ON public.business_account_members(auth_user_id);

CREATE OR REPLACE FUNCTION public.ican_business_admin(p_business_profile_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.business_profiles bp
      WHERE bp.id = p_business_profile_id AND bp.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.business_co_owners co
      WHERE co.business_profile_id = p_business_profile_id
        AND (
          co.user_id = auth.uid()
          OR lower(COALESCE(co.owner_email, '')) = lower(COALESCE(auth.jwt()->>'email', ''))
        )
        AND lower(COALESCE(co.role, '')) IN ('owner', 'co-owner', 'cofounder', 'ceo', 'administrator')
        AND lower(COALESCE(co.status, 'active')) IN ('active', 'approved')
        OR (
          co.business_profile_id = p_business_profile_id
          AND (
            co.user_id = auth.uid()
            OR lower(COALESCE(co.owner_email, '')) = lower(COALESCE(auth.jwt()->>'email', ''))
          )
          AND lower(COALESCE(co.status, 'active')) IN ('active', 'approved')
          AND (
            COALESCE(co.ownership_share, 0) >= 50
            OR COALESCE(co.ownership_share, 0) > COALESCE((
              SELECT MAX(COALESCE(other_co.ownership_share, 0))
              FROM public.business_co_owners other_co
              WHERE other_co.business_profile_id = co.business_profile_id
                AND other_co.id <> co.id
            ), 0)
          )
        )
      )
    OR EXISTS (
      SELECT 1 FROM public.business_account_members bm
      WHERE bm.business_profile_id = p_business_profile_id
        AND bm.auth_user_id = auth.uid()
        AND bm.employment_status = 'active'
        AND COALESCE((bm.permissions->>'manage_business')::boolean, false) = true
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.ican_business_member(p_business_profile_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.ican_business_admin(p_business_profile_id)
      OR EXISTS (
        SELECT 1 FROM public.business_account_members bm
        WHERE bm.business_profile_id = p_business_profile_id
          AND bm.auth_user_id = auth.uid()
          AND bm.employment_status = 'active'
      );
$$;

ALTER TABLE public.business_app_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_account_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_app_links_member_access ON public.business_app_links;
CREATE POLICY business_app_links_member_access ON public.business_app_links
  FOR SELECT TO authenticated
  USING (public.ican_business_member(business_profile_id));

DROP POLICY IF EXISTS business_app_links_admin_manage ON public.business_app_links;
CREATE POLICY business_app_links_admin_manage ON public.business_app_links
  FOR ALL TO authenticated
  USING (public.ican_business_admin(business_profile_id))
  WITH CHECK (public.ican_business_admin(business_profile_id));

DROP POLICY IF EXISTS business_members_member_access ON public.business_account_members;
CREATE POLICY business_members_member_access ON public.business_account_members
  FOR SELECT TO authenticated
  USING (public.ican_business_member(business_profile_id));

DROP POLICY IF EXISTS business_members_admin_manage ON public.business_account_members;
CREATE POLICY business_members_admin_manage ON public.business_account_members
  FOR ALL TO authenticated
  USING (public.ican_business_admin(business_profile_id))
  WITH CHECK (public.ican_business_admin(business_profile_id));

CREATE TABLE IF NOT EXISTS public.business_compensation_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  employee_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pay_type TEXT NOT NULL DEFAULT 'monthly' CHECK (pay_type IN ('monthly', 'hourly', 'per_ride', 'hybrid')),
  base_salary NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'UGX',
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  overtime_rate NUMERIC(15,2) DEFAULT 0,
  payroll_status TEXT NOT NULL DEFAULT 'on_pay'
    CHECK (payroll_status IN ('on_pay', 'on_hold', 'ended')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_profile_id, employee_user_id, effective_from)
);

ALTER TABLE public.business_compensation_profiles
  ADD COLUMN IF NOT EXISTS payroll_status TEXT NOT NULL DEFAULT 'on_pay';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'business_compensation_profiles_payroll_status_check'
  ) THEN
    ALTER TABLE public.business_compensation_profiles
      ADD CONSTRAINT business_compensation_profiles_payroll_status_check
      CHECK (payroll_status IN ('on_pay', 'on_hold', 'ended'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.business_payroll_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'paid', 'locked', 'cancelled')),
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_profile_id, period_start, period_end),
  CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS public.business_payroll_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_period_id UUID NOT NULL REFERENCES public.business_payroll_periods(id) ON DELETE CASCADE,
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  employee_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  base_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  allowances NUMERIC(15,2) NOT NULL DEFAULT 0,
  deductions NUMERIC(15,2) NOT NULL DEFAULT 0,
  incentives NUMERIC(15,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(15,2) GENERATED ALWAYS AS
    (base_amount + allowances + incentives - deductions) STORED,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'paid', 'cancelled')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payroll_period_id, employee_user_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_periods_business
  ON public.business_payroll_periods(business_profile_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_employee
  ON public.business_payroll_entries(employee_user_id, payroll_period_id);

ALTER TABLE public.business_compensation_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_payroll_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compensation_business_access ON public.business_compensation_profiles;
CREATE POLICY compensation_business_access ON public.business_compensation_profiles
  FOR ALL TO authenticated
  USING (public.ican_business_admin(business_profile_id))
  WITH CHECK (public.ican_business_admin(business_profile_id));

DROP POLICY IF EXISTS payroll_period_business_access ON public.business_payroll_periods;
CREATE POLICY payroll_period_business_access ON public.business_payroll_periods
  FOR ALL TO authenticated
  USING (public.ican_business_admin(business_profile_id))
  WITH CHECK (public.ican_business_admin(business_profile_id));

DROP POLICY IF EXISTS payroll_entry_business_access ON public.business_payroll_entries;
CREATE POLICY payroll_entry_business_access ON public.business_payroll_entries
  FOR ALL TO authenticated
  USING (public.ican_business_admin(business_profile_id))
  WITH CHECK (public.ican_business_admin(business_profile_id));

COMMENT ON TABLE public.business_payroll_entries IS
  'Shared payroll records; payment execution remains a separate approved integration';
