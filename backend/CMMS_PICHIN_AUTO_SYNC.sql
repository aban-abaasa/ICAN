-- ============================================================================
-- CMMS -> Pichin administrator synchronization
-- Run after SHARED_BUSINESS_AUTHORITY_AND_PAYROLL.sql and
-- CMMS_PICHIN_ADMIN_AUTHORITY.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cmms_sync_pichin_business(
  p_cmms_company_id UUID,
  p_business_profile_id UUID
)
RETURNS public.cmms_company_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.cmms_company_profiles;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User is not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cmms_users cu
    WHERE cu.cmms_company_id = p_cmms_company_id
      AND cu.is_active = TRUE
      AND lower(cu.email) = lower(COALESCE(auth.jwt()->>'email', ''))
  ) THEN
    RAISE EXCEPTION 'The signed-in Gmail is not an active member of this CMMS company';
  END IF;

  IF NOT public.ican_business_admin(p_business_profile_id) THEN
    RAISE EXCEPTION 'The signed-in Gmail is not an authorized Pichin business administrator';
  END IF;

  UPDATE public.cmms_company_profiles
  SET pichin_business_profile_id = p_business_profile_id
  WHERE id = p_cmms_company_id
  RETURNING * INTO v_profile;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'CMMS company profile was not found';
  END IF;

  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_sync_pichin_business(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_sync_pichin_business(UUID, UUID) TO authenticated;
