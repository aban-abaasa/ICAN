-- CMMS role permissions for operational assets and shared payroll.
-- Run after CMMS_ADD_USER_SCHEMA.sql, CMMS_CREATOR_AND_RLS_SETUP.sql,
-- CMMS_ASSET_INVENTORY_FOUNDATION.sql, and SHARED_BUSINESS_AUTHORITY_AND_PAYROLL.sql.

ALTER TABLE IF EXISTS public.cmms_roles
  ADD COLUMN IF NOT EXISTS can_manage_assets BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_manage_consumables BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_approve_asset_disposal BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_manage_payroll BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_approve_payroll BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.cmms_roles
SET can_manage_assets = TRUE,
    can_manage_consumables = TRUE,
    can_approve_asset_disposal = TRUE,
    can_manage_payroll = TRUE,
    can_approve_payroll = TRUE
WHERE LOWER(role_name) IN ('admin', 'administrator', 'owner');

UPDATE public.cmms_roles
SET can_manage_assets = TRUE,
    can_manage_consumables = TRUE,
    can_manage_payroll = TRUE
WHERE LOWER(role_name) IN ('manager', 'maintenance_manager', 'finance');

UPDATE public.cmms_roles
SET can_manage_assets = TRUE,
    can_manage_consumables = TRUE
WHERE LOWER(role_name) IN ('storeman', 'technician', 'supervisor', 'coordinator');

CREATE OR REPLACE FUNCTION public.cmms_has_permission(
  p_company_id UUID,
  p_permission TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_allowed BOOLEAN;
BEGIN
  v_user_id := public.cmms_current_user_id_for_company(p_company_id);
  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF public.cmms_is_company_admin(p_company_id) THEN
    RETURN TRUE;
  END IF;

  SELECT CASE LOWER(p_permission)
    WHEN 'manage_assets' THEN COALESCE(r.can_manage_assets, FALSE)
    WHEN 'manage_consumables' THEN COALESCE(r.can_manage_consumables, FALSE)
    WHEN 'approve_asset_disposal' THEN COALESCE(r.can_approve_asset_disposal, FALSE)
    WHEN 'manage_payroll' THEN COALESCE(r.can_manage_payroll, FALSE)
    WHEN 'approve_payroll' THEN COALESCE(r.can_approve_payroll, FALSE)
    ELSE FALSE
  END
  INTO v_allowed
  FROM public.cmms_user_roles ur
  JOIN public.cmms_roles r ON r.id = ur.cmms_role_id
  WHERE ur.cmms_company_id = p_company_id
    AND ur.cmms_user_id = v_user_id
    AND ur.is_active = TRUE
    AND r.is_active = TRUE
  ORDER BY COALESCE(r.permission_level, 0) DESC
  LIMIT 1;

  RETURN COALESCE(v_allowed, FALSE);
END;
$$;

-- Replace the broad asset membership policy with permission-aware access.
-- Guarded: cmms_assets only exists once CMMS_ASSET_INVENTORY_FOUNDATION.sql
-- has been run, and this file must not fail outright just because that one
-- hasn't been applied yet (its own header says "run after", not "requires").
DO $$
BEGIN
  IF to_regclass('public.cmms_assets') IS NOT NULL THEN
    DROP POLICY IF EXISTS cmms_assets_company_access ON public.cmms_assets;
    DROP POLICY IF EXISTS cmms_assets_member_access ON public.cmms_assets;
    CREATE POLICY cmms_assets_member_access ON public.cmms_assets
      FOR SELECT
      USING (public.cmms_has_permission(cmms_company_id, 'manage_assets'));
  END IF;
END $$;

-- Payroll remains visible to finance/admin users, while the shared Pichin owner
-- path continues to work through ican_business_admin().
DROP POLICY IF EXISTS payroll_period_business_access ON public.business_payroll_periods;
CREATE POLICY business_payroll_periods_admin ON public.business_payroll_periods
  FOR ALL
  USING (
    public.ican_business_admin(business_profile_id)
    OR EXISTS (
      SELECT 1
      FROM public.cmms_company_profiles cp
      WHERE cp.pichin_business_profile_id = business_payroll_periods.business_profile_id
        AND public.cmms_has_permission(cp.id, 'manage_payroll')
    )
  )
  WITH CHECK (
    public.ican_business_admin(business_profile_id)
    OR EXISTS (
      SELECT 1
      FROM public.cmms_company_profiles cp
      WHERE cp.pichin_business_profile_id = business_payroll_periods.business_profile_id
        AND public.cmms_has_permission(cp.id, 'manage_payroll')
    )
  );

DROP POLICY IF EXISTS payroll_entry_business_access ON public.business_payroll_entries;
CREATE POLICY business_payroll_entries_admin ON public.business_payroll_entries
  FOR ALL
  USING (
    public.ican_business_admin(business_profile_id)
    OR EXISTS (
      SELECT 1
      FROM public.cmms_company_profiles cp
      WHERE cp.pichin_business_profile_id = business_payroll_entries.business_profile_id
        AND public.cmms_has_permission(cp.id, 'manage_payroll')
    )
  )
  WITH CHECK (
    public.ican_business_admin(business_profile_id)
    OR EXISTS (
      SELECT 1
      FROM public.cmms_company_profiles cp
      WHERE cp.pichin_business_profile_id = business_payroll_entries.business_profile_id
        AND public.cmms_has_permission(cp.id, 'manage_payroll')
    )
  );

COMMENT ON FUNCTION public.cmms_has_permission(UUID, TEXT)
  IS 'Checks CMMS company role permissions, with creator/admin override.';
