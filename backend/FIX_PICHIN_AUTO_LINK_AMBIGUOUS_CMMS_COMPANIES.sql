-- ===========================================================================
-- FIX: creating a store fails with
--   duplicate key value violates unique constraint
--   "idx_cmms_company_profiles_pichin_business_profile_id"
--
-- Cause: when a new Pichin business profile is created for a Supermarketa
-- store, two triggers claim the owner's CMMS companies that are not linked to
-- any Pichin business yet:
--   * sync_pichin_business_app_authority()         (AFTER INSERT business_profiles)
--   * ensure_supermarketa_pichin_business_account() (AFTER INSERT supermarkets)
-- Each ran ONE update that pointed EVERY unlinked company of that owner at the
-- new profile. A CMMS company and a Pichin business are strictly 1:1 (unique
-- index), so an owner with two or more unlinked CMMS companies could never
-- create a store.
--
-- Fix: link automatically only when exactly one unlinked company matches, as
-- before. With several candidates the choice is ambiguous, so none is linked;
-- the owner links the right one from CMMS / "Use Your Business Profile".
-- A profile that already has a CMMS company is never given a second one.
--
-- Only the two UPDATE statements change; the rest is the live definition.
-- Safe to re-run.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.sync_pichin_business_app_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
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

  -- Link the CMMS company owned by the same authenticated person. This is the
  -- missing connection that prevents a Supermarkera-created owner from being
  -- recognized as the CMMS/Pichin administrator. Only when it is unambiguous.
  IF to_regclass('public.cmms_company_profiles') IS NOT NULL THEN
    WITH candidates AS (
      SELECT cp.id
        FROM public.cmms_company_profiles cp
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
         )
    )
    UPDATE public.cmms_company_profiles cp
       SET pichin_business_profile_id = NEW.id
      FROM candidates c
     WHERE cp.id = c.id
       AND (SELECT count(*) FROM candidates) = 1
       AND NOT EXISTS (
         SELECT 1 FROM public.cmms_company_profiles x
          WHERE x.pichin_business_profile_id = NEW.id
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

CREATE OR REPLACE FUNCTION public.ensure_supermarketa_pichin_business_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

  -- Same rule as sync_pichin_business_app_authority(): one company at most,
  -- and only when exactly one unlinked company belongs to this owner.
  WITH candidates AS (
    SELECT cp.id
      FROM public.cmms_company_profiles cp
     WHERE cp.pichin_business_profile_id IS NULL
       AND (
         cp.created_by = NEW.owner_user_id
         OR (v_email IS NOT NULL AND lower(cp.owner_email) = v_email)
         OR EXISTS (
           SELECT 1 FROM public.cmms_users cu
            WHERE cu.id = cp.created_by_user_id
              AND lower(cu.email) = v_email
         )
       )
  )
  UPDATE public.cmms_company_profiles cp
     SET pichin_business_profile_id = v_business_id
    FROM candidates c
   WHERE cp.id = c.id
     AND (SELECT count(*) FROM candidates) = 1
     AND NOT EXISTS (
       SELECT 1 FROM public.cmms_company_profiles x
        WHERE x.pichin_business_profile_id = v_business_id
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
