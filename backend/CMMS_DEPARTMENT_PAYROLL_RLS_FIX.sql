-- Fixes:
-- 1) company-scoped role assignment selecting the wrong/global role;
-- 2) operational users losing their department assignment;
-- 3) payroll RLS rejecting a valid linked CMMS administrator.
-- Run after CMMS_PICHIN_BUSINESS_AUTHORITY.sql and
-- SHARED_BUSINESS_AUTHORITY_AND_PAYROLL.sql.

CREATE OR REPLACE FUNCTION public.ican_business_admin(p_business_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.business_profiles bp
      WHERE bp.id = p_business_profile_id AND bp.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.business_co_owners co
      WHERE co.business_profile_id = p_business_profile_id
        AND (co.user_id = auth.uid()
          OR lower(COALESCE(co.owner_email, '')) = lower(COALESCE(auth.jwt()->>'email', '')))
        AND lower(COALESCE(co.status, 'active')) IN ('active', 'approved')
        AND (
          lower(COALESCE(co.role, '')) IN ('owner', 'co-owner', 'cofounder', 'ceo', 'administrator')
          OR COALESCE(co.ownership_share, 0) >= 50
          OR COALESCE(co.ownership_share, 0) > COALESCE((
            SELECT MAX(COALESCE(other_co.ownership_share, 0))
            FROM public.business_co_owners other_co
            WHERE other_co.business_profile_id = co.business_profile_id
              AND other_co.id <> co.id
          ), 0)
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.business_account_members bm
      WHERE bm.business_profile_id = p_business_profile_id
        AND bm.auth_user_id = auth.uid()
        AND bm.employment_status = 'active'
        AND COALESCE((bm.permissions->>'manage_business')::boolean, false) = true
    )
    -- Repair path for older automatic links where the business member row was
    -- not created, or where the admin is identified only by the CMMS roster.
    OR EXISTS (
      SELECT 1
      FROM public.business_app_links bal
      JOIN public.cmms_users cu ON cu.cmms_company_id = bal.source_entity_id
      WHERE bal.business_profile_id = p_business_profile_id
        AND bal.app_key = 'cmms'
        AND bal.status = 'active'
        AND cu.is_active = TRUE
        AND lower(cu.email) = lower(COALESCE(auth.jwt()->>'email', ''))
        AND (
          cu.is_creator = TRUE
          OR lower(COALESCE(cu.role, '')) IN ('admin', 'cmms_admin', 'administrator')
          OR EXISTS (
            SELECT 1
            FROM public.cmms_company_creators cc
            WHERE cc.cmms_company_id = cu.cmms_company_id
              AND cc.creator_user_id = cu.id
          )
        )
    )
  );
$$;

-- Keep the manager/admin authority rows synchronized for an already-linked
-- CMMS company. This is safe to call repeatedly from the admin UI.
CREATE OR REPLACE FUNCTION public.cmms_repair_pichin_authority(p_cmms_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_business_id UUID;
  v_admin RECORD;
  v_manager RECORD;
  v_auth_id UUID;
  v_count INTEGER := 0;
BEGIN
  SELECT pichin_business_profile_id INTO v_business_id
  FROM public.cmms_company_profiles
  WHERE id = p_cmms_company_id AND is_active = TRUE;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'CMMS company is not linked to a Pichin business profile';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cmms_users cu
    WHERE cu.cmms_company_id = p_cmms_company_id
      AND cu.is_active = TRUE
      AND lower(cu.email) = lower(COALESCE(auth.jwt()->>'email', ''))
      AND (
        cu.is_creator = TRUE
        OR lower(COALESCE(cu.role, '')) IN ('admin', 'cmms_admin', 'administrator')
        OR EXISTS (
          SELECT 1 FROM public.cmms_company_creators cc
          WHERE cc.cmms_company_id = p_cmms_company_id AND cc.creator_user_id = cu.id
        )
      )
  ) THEN
    RAISE EXCEPTION 'Only the CMMS administrator can repair Pichin authority';
  END IF;

  SELECT au.id, au.email INTO v_admin
  FROM auth.users au
  WHERE au.id = auth.uid();

  INSERT INTO public.business_account_members (
    business_profile_id, auth_user_id, employment_status, job_title,
    permissions, invited_by, joined_at
  ) VALUES (
    v_business_id, auth.uid(), 'active', 'Administrator',
    jsonb_build_object('manage_business', true, 'manage_payroll', true, 'manage_transport', true),
    auth.uid(), now()
  )
  ON CONFLICT (business_profile_id, auth_user_id) DO UPDATE
  SET employment_status = 'active', job_title = 'Administrator',
      permissions = business_account_members.permissions || EXCLUDED.permissions,
      updated_at = now();

  FOR v_manager IN
    SELECT email, user_name
    FROM public.cmms_users
    WHERE cmms_company_id = p_cmms_company_id
      AND is_active = TRUE
      AND lower(COALESCE(role, '')) IN ('manager', 'cmms_manager')
  LOOP
    SELECT id INTO v_auth_id FROM auth.users
    WHERE lower(email) = lower(v_manager.email) LIMIT 1;
    IF v_auth_id IS NOT NULL THEN
      INSERT INTO public.business_account_members (
        business_profile_id, auth_user_id, employment_status, job_title,
        permissions, invited_by, joined_at
      ) VALUES (
        v_business_id, v_auth_id, 'active', 'Manager',
        jsonb_build_object('manage_business', true, 'manage_payroll', true, 'manage_transport', true),
        auth.uid(), now()
      )
      ON CONFLICT (business_profile_id, auth_user_id) DO UPDATE
      SET employment_status = 'active', job_title = 'Manager',
          permissions = business_account_members.permissions || EXCLUDED.permissions,
          updated_at = now();
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'business_profile_id', v_business_id, 'managers_repaired', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cmms_repair_pichin_authority(UUID) TO authenticated;

-- The RPC must never pick a same-named role from another company.
CREATE OR REPLACE FUNCTION public.assign_cmms_user_role_by_key(
  p_company_id UUID,
  p_user_id UUID,
  p_role_key TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_id UUID;
  v_assigned_by UUID;
BEGIN
  IF NOT public.cmms_is_company_admin(p_company_id) THEN
    RAISE EXCEPTION 'Only Admin users can assign roles in this company';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cmms_users
    WHERE id = p_user_id AND cmms_company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Target CMMS user does not belong to this company';
  END IF;

  SELECT r.id INTO v_role_id
  FROM public.cmms_roles r
  WHERE (r.cmms_company_id = p_company_id OR r.cmms_company_id IS NULL)
    AND r.is_active = TRUE
    AND public.cmms_normalize_role_key(r.role_name) = public.cmms_normalize_role_key(p_role_key)
  ORDER BY CASE WHEN r.cmms_company_id = p_company_id THEN 0 ELSE 1 END,
           COALESCE(r.permission_level, 0) DESC
  LIMIT 1;

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'Requested role "%" was not found for this company', p_role_key;
  END IF;

  v_assigned_by := public.cmms_current_user_id_for_company(p_company_id);
  INSERT INTO public.cmms_user_roles (cmms_company_id, cmms_user_id, cmms_role_id, assigned_by, assigned_at, is_active)
  VALUES (p_company_id, p_user_id, v_role_id, v_assigned_by, now(), true)
  ON CONFLICT (cmms_company_id, cmms_user_id, cmms_role_id) DO UPDATE
    SET is_active = true, assigned_by = COALESCE(EXCLUDED.assigned_by, public.cmms_user_roles.assigned_by), assigned_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_cmms_user_role_by_key(UUID, UUID, TEXT) TO authenticated;

DROP POLICY IF EXISTS compensation_business_access ON public.business_compensation_profiles;
CREATE POLICY compensation_business_access ON public.business_compensation_profiles
  FOR ALL TO authenticated
  USING (public.ican_business_admin(business_profile_id))
  WITH CHECK (public.ican_business_admin(business_profile_id));
