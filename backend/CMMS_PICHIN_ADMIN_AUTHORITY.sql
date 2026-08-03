-- Canonical authority rule:
-- A CMMS company creator is not automatically a business administrator.
-- CMMS company-level administration requires an active Pichin business profile
-- owner, approved co-owner, or delegated business_account_members admin.
-- Run after SHARED_BUSINESS_AUTHORITY_AND_PAYROLL.sql and the CMMS creator setup.

-- Make this migration safe to run even when the asset foundation has not yet
-- been applied. The column is shared by CMMS assets, payroll, and authority.
ALTER TABLE IF EXISTS public.cmms_company_profiles
  ADD COLUMN IF NOT EXISTS pichin_business_profile_id UUID
    REFERENCES public.business_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cmms_company_pichin_business
  ON public.cmms_company_profiles(pichin_business_profile_id);

CREATE OR REPLACE FUNCTION public.cmms_is_company_admin(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cmms_company_profiles cp
    WHERE cp.id = p_company_id
      AND cp.pichin_business_profile_id IS NOT NULL
      AND public.ican_business_admin(cp.pichin_business_profile_id)
      AND EXISTS (
        SELECT 1
        FROM public.cmms_users cu
        WHERE cu.cmms_company_id = cp.id
          AND lower(cu.email) = lower(auth.jwt()->>'email')
          AND cu.is_active = TRUE
      )
  );
$$;

-- Keep role-based permission checks aligned with the canonical business admin.
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
  IF public.cmms_is_company_admin(p_company_id) THEN
    RETURN TRUE;
  END IF;

  v_user_id := public.cmms_current_user_id_for_company(p_company_id);
  IF v_user_id IS NULL THEN
    RETURN FALSE;
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

COMMENT ON FUNCTION public.cmms_is_company_admin(UUID)
  IS 'CMMS company administration is granted only through a linked Pichin business account.';
