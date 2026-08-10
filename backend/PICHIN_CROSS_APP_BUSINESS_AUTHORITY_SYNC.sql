-- Cross-app business authority synchronization.
-- Run after MULTI_TENANT_PLATFORM.sql, SHARED_BUSINESS_AUTHORITY_AND_PAYROLL.sql,
-- CMMS_PICHIN_ADMIN_AUTHORITY.sql, and PITCHIN_BUSINESS_PROFILE_ICAN_WALLET.sql.
--
-- One business identity is shared by Pichin, Supermarkera, and CMMS:
--   * a Pichin business profile owner administers linked app records;
--   * a Supermarkera tenant gets a sole-proprietor Pichin profile automatically;
--   * supplier profiles remain separate and are not linked by this migration.

ALTER TABLE IF EXISTS public.supermarkets
  ADD COLUMN IF NOT EXISTS pichin_business_profile_id UUID
    REFERENCES public.business_profiles(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.cmms_company_profiles
  ADD COLUMN IF NOT EXISTS pichin_business_profile_id UUID
    REFERENCES public.business_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS owner_email TEXT;

CREATE INDEX IF NOT EXISTS idx_supermarkets_pichin_business
  ON public.supermarkets(pichin_business_profile_id)
  WHERE pichin_business_profile_id IS NOT NULL;

-- Make the Pichin profile list consistent for owners and verified
-- co-owners. This avoids depending on whichever older business_profiles RLS
-- policy happened to be installed last.
ALTER TABLE IF EXISTS public.business_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pichin_business_profile_owner_shareholder_read
  ON public.business_profiles;
CREATE POLICY pichin_business_profile_owner_shareholder_read
  ON public.business_profiles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
        FROM public.business_co_owners co
       WHERE co.business_profile_id = business_profiles.id
         AND (co.user_id = auth.uid()
              OR lower(co.owner_email) = lower(auth.jwt() ->> 'email'))
         AND lower(COALESCE(co.status, 'active')) IN ('active', 'approved', 'verified')
    )
  );

-- CMMS entry is membership-based. Linking a company to Pichin alone is not
-- enough for the CMMS UI, which reads cmms_users_with_roles. Ensure that the
-- Pichin owner has an active CMMS user and an admin role for every linked
-- company.
CREATE OR REPLACE FUNCTION public.ensure_pichin_cmms_admin_membership(
  p_business_profile_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_owner_id UUID;
  v_email TEXT;
  v_full_name TEXT;
  v_company RECORD;
  v_shareholder RECORD;
  v_shareholder_user_id UUID;
  v_shareholder_email TEXT;
  v_shareholder_name TEXT;
  v_cmms_user_id UUID;
  v_admin_role_id UUID;
BEGIN
  SELECT bp.user_id, lower(au.email),
         COALESCE(au.raw_user_meta_data ->> 'full_name', split_part(au.email, '@', 1))
    INTO v_owner_id, v_email, v_full_name
    FROM public.business_profiles bp
    JOIN auth.users au ON au.id = bp.user_id
   WHERE bp.id = p_business_profile_id;

  IF v_owner_id IS NULL OR v_email IS NULL
     OR to_regclass('public.cmms_company_profiles') IS NULL
     OR to_regclass('public.cmms_users') IS NULL THEN
    RETURN;
  END IF;

  FOR v_company IN
    SELECT id FROM public.cmms_company_profiles
     WHERE pichin_business_profile_id = p_business_profile_id
  LOOP
    SELECT id INTO v_cmms_user_id
      FROM public.cmms_users
     WHERE cmms_company_id = v_company.id
       AND lower(email) = v_email
     LIMIT 1;

    IF v_cmms_user_id IS NULL THEN
      INSERT INTO public.cmms_users
        (cmms_company_id, email, user_name, is_active)
      VALUES
        (v_company.id, v_email, v_full_name, TRUE)
      RETURNING id INTO v_cmms_user_id;
    ELSE
      UPDATE public.cmms_users
         SET is_active = TRUE,
             updated_at = now()
       WHERE id = v_cmms_user_id
         AND is_active IS DISTINCT FROM TRUE;
    END IF;

    SELECT id INTO v_admin_role_id
      FROM public.cmms_roles
     WHERE lower(role_name) IN ('admin', 'administrator', 'cmms_admin')
     ORDER BY permission_level DESC NULLS LAST
     LIMIT 1;

    IF v_admin_role_id IS NOT NULL THEN
      INSERT INTO public.cmms_user_roles
        (cmms_company_id, cmms_user_id, cmms_role_id, assigned_by, is_active)
      VALUES (v_company.id, v_cmms_user_id, v_admin_role_id, v_cmms_user_id, TRUE)
      ON CONFLICT (cmms_company_id, cmms_user_id, cmms_role_id) DO UPDATE
        SET is_active = TRUE, updated_at = now();
    END IF;

    IF to_regclass('public.cmms_company_creators') IS NOT NULL THEN
      INSERT INTO public.cmms_company_creators
        (cmms_company_id, creator_user_id, creator_email)
      VALUES (v_company.id, v_cmms_user_id, v_email)
      ON CONFLICT (cmms_company_id) DO UPDATE
        SET creator_user_id = EXCLUDED.creator_user_id,
            creator_email = EXCLUDED.creator_email;
    END IF;
  END LOOP;

  -- A verified 50%+ shareholder is also a business administrator under the
  -- shared authority rule. Ensure that person can enter the linked CMMS
  -- company even when they did not originally create the Pichin profile.
  FOR v_company IN
    SELECT id FROM public.cmms_company_profiles
     WHERE pichin_business_profile_id = p_business_profile_id
  LOOP
    FOR v_shareholder IN
      SELECT co.user_id,
             lower(co.owner_email) AS owner_email,
             co.owner_name
        FROM public.business_co_owners co
       WHERE co.business_profile_id = p_business_profile_id
         AND lower(COALESCE(co.status, 'active')) IN ('active', 'approved', 'verified')
         AND (COALESCE(co.ownership_share, 0) >= 50
              OR lower(COALESCE(co.role, '')) IN ('owner', 'co-owner', 'cofounder', 'ceo', 'administrator'))
    LOOP
      v_shareholder_user_id := v_shareholder.user_id;
      v_shareholder_email := v_shareholder.owner_email;
      v_shareholder_name := COALESCE(v_shareholder.owner_name, split_part(v_shareholder_email, '@', 1));

      IF v_shareholder_user_id IS NULL AND v_shareholder_email IS NOT NULL THEN
        SELECT id INTO v_shareholder_user_id
          FROM auth.users
         WHERE lower(email) = v_shareholder_email
         LIMIT 1;
      END IF;

      IF v_shareholder_email IS NULL AND v_shareholder_user_id IS NOT NULL THEN
        SELECT lower(email),
               COALESCE(raw_user_meta_data ->> 'full_name', split_part(email, '@', 1))
          INTO v_shareholder_email, v_shareholder_name
          FROM auth.users
         WHERE id = v_shareholder_user_id;
      END IF;

      IF v_shareholder_email IS NOT NULL THEN
        SELECT id INTO v_cmms_user_id
          FROM public.cmms_users
         WHERE cmms_company_id = v_company.id
           AND lower(email) = v_shareholder_email
         LIMIT 1;

        IF v_cmms_user_id IS NULL THEN
          INSERT INTO public.cmms_users
            (cmms_company_id, email, user_name, is_active)
          VALUES
            (v_company.id, v_shareholder_email, v_shareholder_name, TRUE)
          RETURNING id INTO v_cmms_user_id;
        END IF;

        IF v_admin_role_id IS NOT NULL THEN
          INSERT INTO public.cmms_user_roles
            (cmms_company_id, cmms_user_id, cmms_role_id, assigned_by, is_active)
          VALUES (v_company.id, v_cmms_user_id, v_admin_role_id, v_cmms_user_id, TRUE)
          ON CONFLICT (cmms_company_id, cmms_user_id, cmms_role_id) DO UPDATE
            SET is_active = TRUE, updated_at = now();
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_pichin_business_app_authority()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email TEXT;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT lower(email) INTO v_email
    FROM auth.users
   WHERE id = NEW.user_id;

  -- Only the profile created by the Supermarkera onboarding trigger may be
  -- linked automatically. A Pichin-created profile must not silently absorb
  -- an existing Supermarkera tenant; that requires the explicit merge RPC.
  UPDATE public.supermarkets sm
     SET pichin_business_profile_id = NEW.id,
         updated_at = now()
   WHERE lower(COALESCE(NEW.metadata ->> 'source', '')) = 'supermarketa_auto'
     AND COALESCE(NEW.metadata ->> 'supermarket_id', '') = sm.id::TEXT
     AND (sm.pichin_business_profile_id IS NULL OR sm.pichin_business_profile_id = NEW.id);

  INSERT INTO public.business_app_links
    (business_profile_id, app_key, source_entity_id, status, linked_by, metadata)
  SELECT NEW.id, 'supermarketa', sm.id, 'active', NEW.user_id,
         jsonb_build_object('linked_by', 'pichin_business_profile_sync')
    FROM public.supermarkets sm
   WHERE lower(COALESCE(NEW.metadata ->> 'source', '')) = 'supermarketa_auto'
     AND COALESCE(NEW.metadata ->> 'supermarket_id', '') = sm.id::TEXT
     AND sm.pichin_business_profile_id = NEW.id
  ON CONFLICT (app_key, source_entity_id) DO UPDATE
    SET business_profile_id = EXCLUDED.business_profile_id,
        status = 'active',
        metadata = public.business_app_links.metadata || EXCLUDED.metadata,
        updated_at = now();

  -- Link CMMS companies owned by the same authenticated person. This is the
  -- missing connection that prevents a Supermarkera-created owner from being
  -- recognized as the CMMS/Pichin administrator.
  IF to_regclass('public.cmms_company_profiles') IS NOT NULL THEN
    UPDATE public.cmms_company_profiles cp
       SET pichin_business_profile_id = NEW.id
     WHERE cp.pichin_business_profile_id IS NULL
       AND (
         -- Some CMMS versions store the auth UUID directly, while newer
         -- versions store a cmms_users UUID plus the creator email.
         cp.created_by = NEW.user_id
         OR (v_email IS NOT NULL AND lower(cp.owner_email) = v_email)
         OR EXISTS (
           SELECT 1
             FROM public.cmms_users cu
            WHERE cu.id = cp.created_by_user_id
              AND lower(cu.email) = v_email
         )
       );

    INSERT INTO public.business_app_links
      (business_profile_id, app_key, source_entity_id, status, linked_by, metadata)
    SELECT NEW.id, 'cmms', cp.id, 'active', NEW.user_id,
           jsonb_build_object('linked_by', 'pichin_business_profile_sync')
      FROM public.cmms_company_profiles cp
     WHERE cp.pichin_business_profile_id = NEW.id
    ON CONFLICT (app_key, source_entity_id) DO UPDATE
      SET business_profile_id = EXCLUDED.business_profile_id,
          status = 'active',
          metadata = public.business_app_links.metadata || EXCLUDED.metadata,
          updated_at = now();
  END IF;

  PERFORM public.ensure_pichin_cmms_admin_membership(NEW.id);

  -- The owner is always a verified 100% shareholder for an automatically
  -- linked sole-proprietor profile. This also makes wallet PIN notifications
  -- resolve to the same owner who created the Supermarkera tenant.
  INSERT INTO public.business_co_owners
    (business_profile_id, owner_name, owner_email, user_id,
     ownership_share, role, status, verification_status)
  VALUES
    (NEW.id,
     COALESCE(NEW.business_name, split_part(COALESCE(v_email, ''), '@', 1)),
     v_email, NEW.user_id, 100, 'owner', 'active', 'verified')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pichin_business_profile_cross_app_authority
  ON public.business_profiles;
CREATE TRIGGER pichin_business_profile_cross_app_authority
AFTER INSERT ON public.business_profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_pichin_business_app_authority();

CREATE OR REPLACE FUNCTION public.ensure_supermarketa_pichin_business_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id UUID;
  v_email TEXT;
BEGIN
  SELECT id INTO v_business_id
    FROM public.business_profiles
   WHERE user_id = NEW.owner_user_id
     AND lower(COALESCE(metadata ->> 'source', '')) = 'supermarketa_auto'
     AND COALESCE(metadata ->> 'supermarket_id', '') = NEW.id::TEXT
     AND status = 'active'
   LIMIT 1;

  IF v_business_id IS NULL THEN
    INSERT INTO public.business_profiles
      (user_id, business_name, business_type, description, status, metadata)
    VALUES
      (NEW.owner_user_id, NEW.name, 'Sole Proprietorship',
       'Automatically created from Supermarkera. This profile is the shared business authority for Pichin and CMMS.',
       'active',
       jsonb_build_object('source', 'supermarketa_auto', 'supermarket_id', NEW.id))
    RETURNING id INTO v_business_id;
  END IF;

  UPDATE public.supermarkets
     SET pichin_business_profile_id = v_business_id,
         updated_at = now()
   WHERE id = NEW.id;

  SELECT lower(email) INTO v_email
    FROM auth.users
   WHERE id = NEW.owner_user_id;

  INSERT INTO public.business_app_links
    (business_profile_id, app_key, source_entity_id, status, linked_by, metadata)
  VALUES
    (v_business_id, 'supermarketa', NEW.id, 'active', NEW.owner_user_id,
     jsonb_build_object('linked_by', 'supermarket_tenant_sync'))
  ON CONFLICT (app_key, source_entity_id) DO UPDATE
    SET business_profile_id = EXCLUDED.business_profile_id,
        status = 'active',
        metadata = public.business_app_links.metadata || EXCLUDED.metadata,
        updated_at = now();

  UPDATE public.cmms_company_profiles cp
     SET pichin_business_profile_id = v_business_id
   WHERE cp.pichin_business_profile_id IS NULL
     AND (
       cp.created_by = NEW.owner_user_id
       OR (v_email IS NOT NULL AND lower(cp.owner_email) = v_email)
       OR EXISTS (
         SELECT 1 FROM public.cmms_users cu
          WHERE cu.id = cp.created_by_user_id
            AND lower(cu.email) = v_email
       )
     );

  INSERT INTO public.business_app_links
    (business_profile_id, app_key, source_entity_id, status, linked_by, metadata)
  SELECT v_business_id, 'cmms', cp.id, 'active', NEW.owner_user_id,
         jsonb_build_object('linked_by', 'supermarket_tenant_sync')
    FROM public.cmms_company_profiles cp
   WHERE cp.pichin_business_profile_id = v_business_id
  ON CONFLICT (app_key, source_entity_id) DO UPDATE
      SET business_profile_id = EXCLUDED.business_profile_id,
          status = 'active',
          metadata = public.business_app_links.metadata || EXCLUDED.metadata,
          updated_at = now();

  PERFORM public.ensure_pichin_cmms_admin_membership(v_business_id);

  RETURN NEW;
END;
$$;

-- Explicitly merge a Supermarkera tenant into an existing Pichin business.
-- The automatic onboarding path deliberately keeps entities separate.
CREATE OR REPLACE FUNCTION public.merge_supermarketa_pichin_business(
  p_supermarket_id UUID,
  p_business_profile_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_supermarket public.supermarkets;
  v_source TEXT;
BEGIN
  SELECT * INTO v_supermarket
    FROM public.supermarkets
   WHERE id = p_supermarket_id
     AND owner_user_id = auth.uid()
   FOR UPDATE;
  IF v_supermarket.id IS NULL THEN
    RAISE EXCEPTION 'Supermarket not found or owner access required';
  END IF;

  SELECT lower(COALESCE(metadata ->> 'source', '')) INTO v_source
    FROM public.business_profiles
   WHERE id = p_business_profile_id
     AND COALESCE(status, 'active') = 'active';
  IF v_source IS NULL THEN
    RAISE EXCEPTION 'Pichin business profile not found or inactive';
  END IF;
  IF v_source = 'supermarketa_supplier' THEN
    RAISE EXCEPTION 'Supplier businesses cannot be merged with a supermarket entity';
  END IF;
  IF NOT public.ican_business_admin(p_business_profile_id) THEN
    RAISE EXCEPTION 'Only a Pichin business administrator can merge this entity';
  END IF;

  UPDATE public.supermarkets
     SET pichin_business_profile_id = p_business_profile_id,
         updated_at = now()
   WHERE id = p_supermarket_id;

  INSERT INTO public.business_app_links
    (business_profile_id, app_key, source_entity_id, status, linked_by, metadata)
  VALUES
    (p_business_profile_id, 'supermarketa', p_supermarket_id, 'active', auth.uid(),
     jsonb_build_object('linked_by', 'explicit_user_merge'))
  ON CONFLICT (app_key, source_entity_id) DO UPDATE
    SET business_profile_id = EXCLUDED.business_profile_id,
        status = 'active',
        linked_by = EXCLUDED.linked_by,
        metadata = public.business_app_links.metadata || EXCLUDED.metadata,
        updated_at = now();

  PERFORM public.ensure_pichin_cmms_admin_membership(p_business_profile_id);

  RETURN jsonb_build_object(
    'success', true,
    'merged', true,
    'supermarket_id', p_supermarket_id,
    'business_profile_id', p_business_profile_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_supermarketa_pichin_business(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_supermarketa_pichin_business(UUID, UUID) TO authenticated;

-- Used by the Supermarkera/Pichin chooser before the explicit merge action.
CREATE OR REPLACE FUNCTION public.get_supermarketa_pichin_merge_options(
  p_supermarket_id UUID
)
RETURNS TABLE (
  business_profile_id UUID,
  business_name TEXT,
  business_type TEXT,
  is_current BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT bp.id,
         bp.business_name,
         bp.business_type,
         sm.pichin_business_profile_id = bp.id
    FROM public.supermarkets sm
    JOIN public.business_profiles bp
      ON bp.user_id = sm.owner_user_id
   WHERE sm.id = p_supermarket_id
     AND sm.owner_user_id = auth.uid()
     AND COALESCE(bp.status, 'active') = 'active'
     AND lower(COALESCE(bp.metadata ->> 'source', '')) <> 'supermarketa_supplier'
     AND public.ican_business_admin(bp.id)
   ORDER BY bp.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_supermarketa_pichin_merge_options(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_supermarketa_pichin_merge_options(UUID) TO authenticated;

-- Explicitly keep a tenant separate, including tenants that were merged by an
-- older version of this migration.
CREATE OR REPLACE FUNCTION public.separate_supermarketa_pichin_business(
  p_supermarket_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_supermarket public.supermarkets;
  v_business_id UUID;
BEGIN
  SELECT * INTO v_supermarket
    FROM public.supermarkets
   WHERE id = p_supermarket_id
     AND owner_user_id = auth.uid()
   FOR UPDATE;
  IF v_supermarket.id IS NULL THEN
    RAISE EXCEPTION 'Supermarket not found or owner access required';
  END IF;

  SELECT id INTO v_business_id
    FROM public.business_profiles
   WHERE user_id = auth.uid()
     AND lower(COALESCE(metadata ->> 'source', '')) = 'supermarketa_auto'
     AND COALESCE(metadata ->> 'supermarket_id', '') = p_supermarket_id::TEXT
     AND COALESCE(status, 'active') = 'active'
   LIMIT 1;

  IF v_business_id IS NULL THEN
    INSERT INTO public.business_profiles
      (user_id, business_name, business_type, description, status, metadata)
    VALUES
      (auth.uid(), v_supermarket.name, 'Sole Proprietorship',
       'Separate business entity created for this Supermarkera tenant.',
       'active',
       jsonb_build_object('source', 'supermarketa_auto', 'supermarket_id', p_supermarket_id,
                          'separation_requested', true))
    RETURNING id INTO v_business_id;
  END IF;

  UPDATE public.supermarkets
     SET pichin_business_profile_id = v_business_id,
         updated_at = now()
   WHERE id = p_supermarket_id;

  INSERT INTO public.business_app_links
    (business_profile_id, app_key, source_entity_id, status, linked_by, metadata)
  VALUES
    (v_business_id, 'supermarketa', p_supermarket_id, 'active', auth.uid(),
     jsonb_build_object('linked_by', 'explicit_user_separate'))
  ON CONFLICT (app_key, source_entity_id) DO UPDATE
    SET business_profile_id = EXCLUDED.business_profile_id,
        status = 'active',
        linked_by = EXCLUDED.linked_by,
        metadata = public.business_app_links.metadata || EXCLUDED.metadata,
        updated_at = now();

  PERFORM public.ensure_pichin_cmms_admin_membership(v_business_id);

  RETURN jsonb_build_object(
    'success', true,
    'separated', true,
    'supermarket_id', p_supermarket_id,
    'business_profile_id', v_business_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.separate_supermarketa_pichin_business(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.separate_supermarketa_pichin_business(UUID) TO authenticated;

DROP TRIGGER IF EXISTS supermarket_pichin_business_account
  ON public.supermarkets;
CREATE TRIGGER supermarket_pichin_business_account
AFTER INSERT ON public.supermarkets
FOR EACH ROW EXECUTE FUNCTION public.ensure_supermarketa_pichin_business_account();

-- If CMMS is created after the Pichin profile, perform the reverse sync too.
CREATE OR REPLACE FUNCTION public.sync_cmms_company_pichin_authority()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email TEXT;
  v_business_id UUID;
  v_company_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'cmms_users' THEN
    v_company_id := NEW.cmms_company_id;
    v_email := lower(NEW.email);
  ELSE
    v_company_id := NEW.id;
    SELECT lower(cu.email) INTO v_email
      FROM public.cmms_users cu
     WHERE cu.cmms_company_id = v_company_id
       AND cu.is_active = TRUE
       AND (COALESCE(cu.is_creator, FALSE) OR lower(COALESCE(cu.role, '')) IN ('admin', 'cmms_admin', 'administrator'))
     ORDER BY COALESCE(cu.is_creator, FALSE) DESC
     LIMIT 1;
  END IF;

  IF v_email IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT bp.id INTO v_business_id
    FROM public.business_profiles bp
    JOIN auth.users au ON au.id = bp.user_id
   WHERE lower(au.email) = v_email
     AND lower(COALESCE(bp.metadata ->> 'source', '')) <> 'supermarketa_supplier'
     AND COALESCE(bp.status, 'active') = 'active'
   ORDER BY bp.created_at DESC
   LIMIT 1;

  IF v_business_id IS NOT NULL THEN
    UPDATE public.cmms_company_profiles
       SET pichin_business_profile_id = v_business_id
     WHERE id = v_company_id
       AND pichin_business_profile_id IS NULL;

    INSERT INTO public.business_app_links
      (business_profile_id, app_key, source_entity_id, status, linked_by, metadata)
    VALUES
      (v_business_id, 'cmms', v_company_id, 'active',
       (SELECT user_id FROM public.business_profiles WHERE id = v_business_id),
       jsonb_build_object('linked_by', 'cmms_company_authority_sync'))
    ON CONFLICT (app_key, source_entity_id) DO UPDATE
      SET business_profile_id = EXCLUDED.business_profile_id,
          status = 'active',
          metadata = public.business_app_links.metadata || EXCLUDED.metadata,
          updated_at = now();

    PERFORM public.ensure_pichin_cmms_admin_membership(v_business_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cmms_company_pichin_authority_sync
  ON public.cmms_company_profiles;
CREATE TRIGGER cmms_company_pichin_authority_sync
AFTER INSERT OR UPDATE OF owner_email, created_by, created_by_user_id
ON public.cmms_company_profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_cmms_company_pichin_authority();

DROP TRIGGER IF EXISTS cmms_user_pichin_authority_sync
  ON public.cmms_users;
CREATE TRIGGER cmms_user_pichin_authority_sync
AFTER INSERT OR UPDATE OF email, is_creator, role, is_active
ON public.cmms_users
FOR EACH ROW EXECUTE FUNCTION public.sync_cmms_company_pichin_authority();

-- Backfill tenants created before this migration. The profile trigger then
-- links their Supermarkera and any matching CMMS company automatically.
INSERT INTO public.business_profiles
  (user_id, business_name, business_type, description, status, metadata)
SELECT sm.owner_user_id, sm.name, 'Sole Proprietorship',
       'Automatically created from Supermarkera. This profile is the shared business authority for Pichin and CMMS.',
       'active',
       jsonb_build_object('source', 'supermarketa_auto', 'supermarket_id', sm.id)
  FROM public.supermarkets sm
 WHERE sm.owner_user_id IS NOT NULL
   AND sm.pichin_business_profile_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.business_profiles bp
      WHERE bp.user_id = sm.owner_user_id
        AND lower(COALESCE(bp.metadata ->> 'source', '')) = 'supermarketa_auto'
        AND COALESCE(bp.metadata ->> 'supermarket_id', '') = sm.id::TEXT
   );

UPDATE public.supermarkets sm
   SET pichin_business_profile_id = bp.id,
       updated_at = now()
  FROM public.business_profiles bp
 WHERE sm.pichin_business_profile_id IS NULL
   AND bp.user_id = sm.owner_user_id
   AND lower(COALESCE(bp.metadata ->> 'source', '')) = 'supermarketa_auto'
   AND COALESCE(bp.metadata ->> 'supermarket_id', '') = sm.id::TEXT;

-- Repair already-linked Pichin/CMMS pairs that predate this membership fix.
DO $$
DECLARE
  v_profile_id UUID;
BEGIN
  FOR v_profile_id IN
    SELECT DISTINCT pichin_business_profile_id
      FROM public.cmms_company_profiles
     WHERE pichin_business_profile_id IS NOT NULL
  LOOP
    PERFORM public.ensure_pichin_cmms_admin_membership(v_profile_id);
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
