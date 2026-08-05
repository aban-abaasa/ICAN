-- Pichin is the source of truth for CMMS company administration.
-- Run after SHARED_BUSINESS_AUTHORITY_AND_PAYROLL.sql,
-- CMMS_CREATOR_ADMIN_ENFORCEMENT.sql, and CMMS_PICHIN_AUTO_SYNC.sql.
--
-- A Pichin business owner/authorized 50%+ shareholder may administer the
-- linked CMMS company. Other active shareholders may still be CMMS members,
-- but they do not become CMMS administrators from ownership alone.

CREATE OR REPLACE FUNCTION public.cmms_is_company_admin(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_cmms_user_id UUID;
  v_pichin_business_id UUID;
BEGIN
  v_current_cmms_user_id := public.cmms_current_user_id_for_company(p_company_id);
  IF v_current_cmms_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cmms_company_profiles cp
    WHERE cp.id = p_company_id AND cp.created_by_user_id = v_current_cmms_user_id
  ) OR EXISTS (
    SELECT 1 FROM public.cmms_company_creators cc
    WHERE cc.cmms_company_id = p_company_id AND cc.creator_user_id = v_current_cmms_user_id
  ) OR EXISTS (
    SELECT 1
    FROM public.cmms_user_roles ur
    JOIN public.cmms_roles r ON r.id = ur.cmms_role_id
    WHERE ur.cmms_company_id = p_company_id
      AND ur.cmms_user_id = v_current_cmms_user_id
      AND ur.is_active = TRUE
      AND public.cmms_normalize_role_key(r.role_name) = 'admin'
  ) THEN
    RETURN TRUE;
  END IF;

  SELECT cp.pichin_business_profile_id
  INTO v_pichin_business_id
  FROM public.cmms_company_profiles cp
  WHERE cp.id = p_company_id;

  -- Pichin's business authority, including its 50%+ / majority-owner rule,
  -- controls administration of the linked CMMS company.
  RETURN v_pichin_business_id IS NOT NULL
    AND public.ican_business_admin(v_pichin_business_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cmms_is_company_admin(UUID) TO authenticated;
