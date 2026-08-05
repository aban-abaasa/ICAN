-- Supplier business authority for Supermarketera and CMMS/Pichin.
-- Run after MULTI_TENANT_PLATFORM.sql, SHARED_BUSINESS_AUTHORITY_AND_PAYROLL.sql,
-- and CMMS_PICHIN_BUSINESS_AUTHORITY.sql.
--
-- A supplier may be a sole proprietor or a limited company.  In both cases
-- the supplier's Pichin business profile is the authority source.  The
-- business owner/creator can manage the supplier record; ordinary business
-- members can read it when the supplier has been linked to the supermarket.

ALTER TABLE IF EXISTS public.supplier_applications
  ADD COLUMN IF NOT EXISTS supplier_business_profile_id UUID
    REFERENCES public.business_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_business_type TEXT;

-- Creates the supplier's separate Pichin business account.  The supplier
-- business is never borrowed from the supermarket or CMMS company.
CREATE OR REPLACE FUNCTION public.supplier_create_business_account(
  p_business_name TEXT,
  p_business_type TEXT,
  p_registration_number TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_business_id UUID;
  v_type TEXT := lower(trim(COALESCE(p_business_type, '')));
  v_email TEXT := lower(COALESCE(auth.jwt()->>'email', ''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'User is not authenticated'; END IF;
  IF NULLIF(trim(p_business_name), '') IS NULL THEN RAISE EXCEPTION 'Business name is required'; END IF;
  IF v_type NOT IN ('sole proprietorship', 'sole proprietor', 'sole',
                    'limited company', 'limited', 'llc', 'private limited company') THEN
    RAISE EXCEPTION 'Supplier business type must be Sole Proprietorship or Limited Company';
  END IF;

  SELECT id INTO v_business_id
  FROM public.business_profiles
  WHERE user_id = auth.uid()
    AND lower(COALESCE(metadata->>'source', '')) = 'supermarketa_supplier'
    AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_business_id IS NULL THEN
    INSERT INTO public.business_profiles
      (user_id, business_name, business_type, registration_number, status, metadata)
    VALUES
      (auth.uid(), trim(p_business_name),
       CASE WHEN v_type IN ('limited company', 'limited', 'llc', 'private limited company')
            THEN 'Limited Company' ELSE 'Sole Proprietorship' END,
       NULLIF(trim(p_registration_number), ''), 'active',
       jsonb_build_object('source', 'supermarketa_supplier'))
    RETURNING id INTO v_business_id;
  END IF;

  INSERT INTO public.business_co_owners
    (business_profile_id, owner_name, owner_email, user_id,
     ownership_share, role, status, verification_status)
  VALUES
    (v_business_id,
     COALESCE(auth.jwt()->'user_metadata'->>'full_name', split_part(v_email, '@', 1)),
     v_email, auth.uid(), 100, 'owner', 'active', 'verified')
  ON CONFLICT DO NOTHING;

  RETURN v_business_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.supplier_create_business_account(TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.supplier_link_application_business(
  p_application_id UUID,
  p_business_profile_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.supplier_business_admin(p_business_profile_id, auth.uid()) THEN
    RAISE EXCEPTION 'Only the supplier business creator can link this account';
  END IF;
  UPDATE public.supplier_applications
     SET supplier_business_profile_id = p_business_profile_id,
         supplier_business_type = (SELECT business_type FROM public.business_profiles WHERE id = p_business_profile_id),
         supplier_user_id = COALESCE(supplier_user_id, auth.uid()),
         updated_at = now()
   WHERE id = p_application_id
     AND supplier_user_id = auth.uid();
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.supplier_link_application_business(UUID, UUID) TO authenticated;

ALTER TABLE IF EXISTS public.supplier_catalog_items
  ADD COLUMN IF NOT EXISTS supplier_business_profile_id UUID
    REFERENCES public.business_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_apps_business_profile
  ON public.supplier_applications(supplier_business_profile_id)
  WHERE supplier_business_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_catalog_business_profile
  ON public.supplier_catalog_items(supplier_business_profile_id)
  WHERE supplier_business_profile_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.supplier_business_admin(
  p_business_profile_id UUID,
  p_supplier_user_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    (p_supplier_user_id IS NOT NULL AND p_supplier_user_id = auth.uid())
    OR (
      p_business_profile_id IS NOT NULL
      AND (
        public.ican_business_admin(p_business_profile_id)
        OR EXISTS (
          SELECT 1
          FROM public.business_profiles bp
          WHERE bp.id = p_business_profile_id
            AND bp.user_id = auth.uid()
        )
      )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.supplier_business_member(
  p_business_profile_id UUID,
  p_supplier_user_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    (p_supplier_user_id IS NOT NULL AND p_supplier_user_id = auth.uid())
    OR (
      p_business_profile_id IS NOT NULL
      AND public.ican_business_member(p_business_profile_id)
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.supplier_business_admin(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_business_member(UUID, UUID) TO authenticated;

-- Replace the old individual-only policies.  Existing rows without a
-- business link continue to work for the supplier user who created them.
ALTER TABLE IF EXISTS public.supplier_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_own_apps ON public.supplier_applications;
DROP POLICY IF EXISTS supermarket_see_apps ON public.supplier_applications;
DROP POLICY IF EXISTS supplier_business_apps_access ON public.supplier_applications;
CREATE POLICY supplier_business_apps_access ON public.supplier_applications
  FOR ALL TO authenticated
  USING (
    public.supplier_business_member(supplier_business_profile_id, supplier_user_id)
    OR EXISTS (
      SELECT 1 FROM public.supermarkets sm
      WHERE sm.id = supermarket_id AND sm.owner_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.supermarket_staff ss
      WHERE ss.supermarket_id = supplier_applications.supermarket_id
        AND ss.user_id = auth.uid()
        AND ss.role = 'manager' AND ss.status = 'active'
    )
  )
  WITH CHECK (
    public.supplier_business_admin(supplier_business_profile_id, supplier_user_id)
    OR supplier_user_id = auth.uid()
  );

-- A supermarket owner/manager can read supplier applications, including
-- applications linked to a limited-company Pichin account.
DROP POLICY IF EXISTS supermarket_supplier_read ON public.supplier_applications;
CREATE POLICY supermarket_supplier_read ON public.supplier_applications
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.supermarkets sm
      WHERE sm.id = supermarket_id AND sm.owner_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.supermarket_staff ss
      WHERE ss.supermarket_id = supplier_applications.supermarket_id
        AND ss.user_id = auth.uid()
        AND ss.role = 'manager' AND ss.status = 'active'
    )
  );

ALTER TABLE IF EXISTS public.supplier_catalog_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_own_catalog ON public.supplier_catalog_items;
DROP POLICY IF EXISTS catalog_public_read ON public.supplier_catalog_items;
DROP POLICY IF EXISTS supplier_business_catalog_access ON public.supplier_catalog_items;
CREATE POLICY supplier_business_catalog_access ON public.supplier_catalog_items
  FOR ALL TO authenticated
  USING (
    public.supplier_business_member(supplier_business_profile_id, supplier_user_id)
    OR is_available = TRUE
  )
  WITH CHECK (
    public.supplier_business_admin(supplier_business_profile_id, supplier_user_id)
    OR supplier_user_id = auth.uid()
  );

-- Link either a Sole Proprietorship or a Limited Company to CMMS.  The
-- caller must be the CMMS creator/admin or a Pichin business administrator.
CREATE OR REPLACE FUNCTION public.cmms_link_pichin_business_account(
  p_cmms_company_id UUID,
  p_business_profile_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_business_type TEXT;
  v_cmms_user_id UUID;
BEGIN
  SELECT lower(trim(COALESCE(bp.business_type, '')))
    INTO v_business_type
  FROM public.business_profiles bp
  WHERE bp.id = p_business_profile_id AND COALESCE(bp.status, 'active') = 'active';

  IF v_business_type IS NULL THEN
    RAISE EXCEPTION 'Pichin business profile was not found or is inactive';
  END IF;

  IF v_business_type NOT IN (
    'sole proprietorship', 'sole proprietor', 'sole',
    'limited company', 'limited', 'llc', 'private limited company'
  ) THEN
    RAISE EXCEPTION 'Only sole-proprietor and limited-company accounts can be linked';
  END IF;

  v_cmms_user_id := public.cmms_current_user_id_for_company(p_cmms_company_id);
  IF v_cmms_user_id IS NULL
     OR NOT (
       EXISTS (
         SELECT 1 FROM public.cmms_company_profiles cp
         WHERE cp.id = p_cmms_company_id AND cp.created_by_user_id = v_cmms_user_id
       )
       OR EXISTS (
         SELECT 1 FROM public.cmms_company_creators cc
         WHERE cc.cmms_company_id = p_cmms_company_id
           AND cc.creator_user_id = v_cmms_user_id
       )
       OR public.ican_business_admin(p_business_profile_id)
     ) THEN
    RAISE EXCEPTION 'Only the CMMS creator or Pichin business administrator can link accounts';
  END IF;

  UPDATE public.cmms_company_profiles
     SET pichin_business_profile_id = p_business_profile_id
   WHERE id = p_cmms_company_id;

  INSERT INTO public.business_app_links (
    business_profile_id, app_key, source_entity_id, status, linked_by, metadata
  ) VALUES (
    p_business_profile_id, 'cmms', p_cmms_company_id, 'active', auth.uid(),
    jsonb_build_object('business_type', v_business_type, 'linked_by_rpc', true)
  )
  ON CONFLICT (app_key, source_entity_id) DO UPDATE
    SET business_profile_id = EXCLUDED.business_profile_id,
        status = 'active', linked_by = EXCLUDED.linked_by,
        metadata = public.business_app_links.metadata || EXCLUDED.metadata,
        updated_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'cmms_company_id', p_cmms_company_id,
    'business_profile_id', p_business_profile_id,
    'business_type', v_business_type
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_link_pichin_business_account(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_link_pichin_business_account(UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
