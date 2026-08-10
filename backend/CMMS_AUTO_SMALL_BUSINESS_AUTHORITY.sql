-- Temporary small-team onboarding for Supermarkera/CMMS.
-- Run after SHARED_BUSINESS_AUTHORITY_AND_PAYROLL.sql and the CMMS creator
-- migrations.  Teams with fewer than three active CMMS employees receive a
-- simple Pichin sole-proprietor account automatically.  Larger teams must
-- complete business setup in IcanEra/Pichin.

CREATE OR REPLACE FUNCTION public.cmms_ensure_small_business_authority(
  p_cmms_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $cmms$
DECLARE
  v_company public.cmms_company_profiles;
  v_business_id UUID;
  v_employee_count INTEGER;
  v_current_email TEXT := lower(COALESCE(auth.jwt()->>'email', ''));
  v_current_is_admin BOOLEAN;
  v_manager RECORD;
  v_manager_auth_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User is not authenticated';
  END IF;

  SELECT * INTO v_company
  FROM public.cmms_company_profiles
  WHERE id = p_cmms_company_id AND is_active = TRUE;

  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'CMMS company profile was not found';
  END IF;

  -- Only the CMMS creator/admin may bootstrap the linked Pichin account.
  SELECT EXISTS (
    SELECT 1
    FROM public.cmms_users cu
    WHERE cu.cmms_company_id = p_cmms_company_id
      AND cu.is_active = TRUE
      AND lower(cu.email) = v_current_email
      AND (cu.is_creator = TRUE OR lower(COALESCE(cu.role, '')) IN ('admin', 'cmms_admin', 'administrator'))
  ) OR EXISTS (
    SELECT 1
    FROM public.cmms_company_creators cc
    JOIN public.cmms_users cu ON cu.id = cc.creator_user_id
    WHERE cc.cmms_company_id = p_cmms_company_id
      AND cu.is_active = TRUE
      AND lower(cu.email) = v_current_email
  ) INTO v_current_is_admin;

  IF NOT v_current_is_admin THEN
    RETURN jsonb_build_object('success', false, 'mode', 'requires_admin_setup', 'employee_count', 0);
  END IF;

  -- Count only payroll workers. Suppliers, customers, and the administrator
  -- are not employees for the small-team threshold.
  SELECT COUNT(*)::INTEGER INTO v_employee_count
  FROM public.cmms_users
  WHERE cmms_company_id = p_cmms_company_id
    AND is_active = TRUE
    AND COALESCE(is_creator, FALSE) = FALSE
    AND lower(COALESCE(role, '')) IN ('cashier', 'manager', 'cmms_manager');

  -- Do not silently create a sole-proprietor account for a larger operation.
  IF v_employee_count >= 3 AND v_company.pichin_business_profile_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'mode', 'requires_full_setup',
      'employee_count', v_employee_count,
      'business_profile_id', NULL
    );
  END IF;

  v_business_id := v_company.pichin_business_profile_id;

  IF v_business_id IS NULL THEN
    SELECT bal.business_profile_id INTO v_business_id
    FROM public.business_app_links bal
    WHERE bal.app_key = 'cmms'
      AND bal.source_entity_id = p_cmms_company_id
      AND bal.status = 'active'
    LIMIT 1;
  END IF;

  IF v_business_id IS NULL THEN
    INSERT INTO public.business_profiles (
      user_id, business_name, business_type, description, status, metadata
    ) VALUES (
      auth.uid(),
      v_company.company_name,
      'Sole Proprietorship',
      'Automatically created for a small CMMS team. Complete the full IcanEra business setup when the team reaches three employees.',
      'active',
      jsonb_build_object('source', 'cmms_auto_small_team', 'cmms_company_id', p_cmms_company_id)
    )
    RETURNING id INTO v_business_id;
  END IF;

  UPDATE public.cmms_company_profiles
  SET pichin_business_profile_id = v_business_id
  WHERE id = p_cmms_company_id;

  INSERT INTO public.business_app_links (
    business_profile_id, app_key, source_entity_id, status, linked_by, metadata
  ) VALUES (
    v_business_id, 'cmms', p_cmms_company_id, 'active', auth.uid(),
    jsonb_build_object('mode', 'small_team_auto_link')
  )
  ON CONFLICT (app_key, source_entity_id) DO UPDATE
    SET business_profile_id = EXCLUDED.business_profile_id,
        status = 'active', updated_at = now();

  -- The signed-in CMMS administrator is the Pichin business owner/admin.
  IF NOT EXISTS (
    SELECT 1 FROM public.business_co_owners
    WHERE business_profile_id = v_business_id
      AND (user_id = auth.uid() OR lower(owner_email) = v_current_email)
      AND status IN ('active', 'approved')
  ) THEN
    INSERT INTO public.business_co_owners (
      business_profile_id, owner_name, owner_email, user_id,
      ownership_share, role, status, verification_status
    ) VALUES (
      v_business_id,
      COALESCE(auth.jwt()->'user_metadata'->>'full_name', split_part(v_current_email, '@', 1)),
      v_current_email, auth.uid(), 100, 'owner', 'active', 'verified'
    );
  END IF;

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

  -- Give every active CMMS manager access to CMMS operations only. For a sole
  -- proprietorship, store workers must not receive PitchIn business-profile
  -- administration or wallet-approval authority.
  FOR v_manager IN
    SELECT cu.user_name, cu.email
    FROM public.cmms_users cu
    WHERE cu.cmms_company_id = p_cmms_company_id
      AND cu.is_active = TRUE
      AND lower(COALESCE(cu.role, '')) IN ('manager', 'cmms_manager')
  LOOP
    SELECT au.id INTO v_manager_auth_id
    FROM auth.users au
    WHERE lower(au.email) = lower(v_manager.email)
    LIMIT 1;

    IF v_manager_auth_id IS NOT NULL THEN
      INSERT INTO public.business_account_members (
        business_profile_id, auth_user_id, employment_status, job_title,
        permissions, invited_by, joined_at
      ) VALUES (
        v_business_id, v_manager_auth_id, 'active', 'Manager',
         jsonb_build_object('manage_business', false, 'manage_payroll', true, 'manage_transport', true),
        auth.uid(), now()
      )
      ON CONFLICT (business_profile_id, auth_user_id) DO UPDATE
        SET employment_status = 'active', job_title = 'Manager',
            permissions = business_account_members.permissions || EXCLUDED.permissions,
            updated_at = now();
    END IF;
  END LOOP;

  -- Revoke any previously granted PitchIn business-management permission from
  -- non-admin workers. Their CMMS roles and CMMS access remain unchanged.
  UPDATE public.business_account_members bam
     SET permissions = COALESCE(bam.permissions, '{}'::JSONB)
                         || jsonb_build_object('manage_business', false),
         updated_at = now()
   WHERE bam.business_profile_id = v_business_id
     AND bam.auth_user_id <> auth.uid()
     AND EXISTS (
       SELECT 1 FROM public.business_profiles bp
        WHERE bp.id = bam.business_profile_id
          AND lower(COALESCE(bp.business_type, '')) NOT IN
              ('limited', 'limited company', 'llc', 'private limited company')
     );

  RETURN jsonb_build_object(
    'success', true,
    'mode', 'small_team',
    'employee_count', v_employee_count,
    'business_profile_id', v_business_id
  );
END;
$cmms$;

REVOKE ALL ON FUNCTION public.cmms_ensure_small_business_authority(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_ensure_small_business_authority(UUID) TO authenticated;
