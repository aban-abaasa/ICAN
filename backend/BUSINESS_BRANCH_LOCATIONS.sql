-- ============================================================================
-- BRANCH LOCATIONS: where each branch / store physically is, set on a map
-- ============================================================================
-- Run AFTER BUSINESS_OWNERSHIP_TREE_CMMS_FEED.sql (ownership tree, _bol_* helpers).
-- Optional, and only used when present:
--   * CMMS_ASSETS_BRANCHES_LEDGER.sql  (cmms_company_profiles.supermarket_id)
--   * MULTI_TENANT_PLATFORM.sql + mybodaguy's ADD_SUPERMARKET_GEOLOCATION.sql
--     (supermarkets.latitude / longitude)
-- Safe to run more than once.
--
-- Every branch is a business profile of its own, so the location lives on the
-- business profile: coordinates (the map pin), the address the pin resolves to,
-- and free-text directions for people who arrive without a working map
-- ("behind the Shell station, blue gate").
--
-- Riders do not read business profiles - they read supermarkets (BodaGoEra's
-- nearest-store search and delivery pickup). So when a branch is wired to a
-- supermarket through its CMMS company, saving the location here ALSO writes
-- the same pin to that supermarket. One pin, set once by the admin, and every
-- rider app sees it.
--
-- Who may set a location: an administrator of the business, or of any business
-- above it in the ownership tree (a head office can place its branches).
-- Locations are written only through fn_business_set_location.
--
-- The store side (supermartkera.icanera.space shares this database): a store
-- owner or manager sets the pin from the store's own business-profile settings
-- through fn_supermarket_set_location. It writes the supermarket AND the branch
-- business profile(s) wired to it, so the Branches tab and the riders always
-- show the same place. fn_supermarket_get_location reads it back for the form.
-- ============================================================================

ALTER TABLE public.business_profiles
  ADD COLUMN IF NOT EXISTS latitude            DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude           DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS location_address    TEXT,
  ADD COLUMN IF NOT EXISTS location_directions TEXT,
  ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS location_updated_by UUID;

-- Can the caller place this business on the map: they administer it, or
-- something above it in the tree.
CREATE OR REPLACE FUNCTION public._bol_can_set_location(p_business_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_business_id IS NOT NULL AND (
    public._bol_is_business_admin(p_business_id)
    OR EXISTS (SELECT 1 FROM public._bol_ancestors(p_business_id) a
               WHERE public._bol_is_business_admin(a.ancestor_id))
  );
$$;

-- Save a branch's pin. Returns { status, supermarkets_synced, supermarket_sync }.
-- p_country is the country name the pin sits in (the map resolves it); it is
-- only forwarded to a linked supermarket, where "can customers abroad buy
-- from here" depends on it.
CREATE OR REPLACE FUNCTION public.fn_business_set_location(
  p_business_id UUID,
  p_latitude    NUMERIC,
  p_longitude   NUMERIC,
  p_address     TEXT DEFAULT NULL,
  p_directions  TEXT DEFAULT NULL,
  p_country     TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_synced INT := 0;
  v_sync   TEXT := 'none';
  v_addr   TEXT := NULLIF(btrim(COALESCE(p_address, '')), '');
  v_dir    TEXT := NULLIF(btrim(COALESCE(p_directions, '')), '');
  v_ctry   TEXT := NULLIF(btrim(COALESCE(p_country, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF NOT public._bol_can_set_location(p_business_id) THEN
    RAISE EXCEPTION 'You do not administer this business';
  END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL
     OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'That is not a valid map position';
  END IF;
  IF char_length(COALESCE(v_dir, '')) > 600 THEN
    RAISE EXCEPTION 'Directions are too long (600 characters at most)';
  END IF;

  UPDATE public.business_profiles
     SET latitude = ROUND(p_latitude, 8),
         longitude = ROUND(p_longitude, 8),
         location_address = v_addr,
         location_directions = v_dir,
         location_updated_at = NOW(),
         location_updated_by = auth.uid()
   WHERE id = p_business_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Business not found'; END IF;

  -- The same pin for the supermarket(s) this branch is wired to, so riders find it.
  IF to_regclass('public.supermarkets') IS NOT NULL
     AND to_regclass('public.cmms_company_profiles') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        UPDATE public.supermarkets s
           SET latitude  = $1,
               longitude = $2,
               address   = COALESCE($3, s.address),
               country   = COALESCE($4, s.country)
         WHERE s.id IN (SELECT c.supermarket_id
                          FROM public.cmms_company_profiles c
                         WHERE c.pichin_business_profile_id = $5
                           AND c.supermarket_id IS NOT NULL)
      $q$ USING ROUND(p_latitude, 8), ROUND(p_longitude, 8), v_addr, v_ctry, p_business_id;
      GET DIAGNOSTICS v_synced = ROW_COUNT;
      v_sync := CASE WHEN v_synced > 0 THEN 'synced' ELSE 'none' END;
    EXCEPTION WHEN undefined_column THEN
      -- The supermarket schema has no coordinates yet (ADD_SUPERMARKET_GEOLOCATION.sql
      -- not run): the branch is saved, riders just cannot see it until it is.
      v_synced := 0;
      v_sync := 'supermarket_schema_missing_coordinates';
    END;
  END IF;

  RETURN jsonb_build_object('status', 'saved', 'supermarkets_synced', v_synced, 'supermarket_sync', v_sync);
END;
$$;

-- Where every business in the tree below p_business_id is (itself included).
-- Active links only - a branch that has not accepted yet is not placed by its
-- would-be parent.
CREATE OR REPLACE FUNCTION public.fn_business_branch_locations(p_business_id UUID)
RETURNS TABLE (
  business_id UUID, business_name TEXT, depth INT,
  latitude NUMERIC, longitude NUMERIC, location_address TEXT, location_directions TEXT,
  location_updated_at TIMESTAMPTZ, can_set BOOLEAN, has_supermarket BOOLEAN
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._bol_can_set_location(p_business_id) THEN
    RAISE EXCEPTION 'You do not administer this business';
  END IF;

  RETURN QUERY
  WITH RECURSIVE down AS (
    SELECT p_business_id AS biz, 0 AS d, ARRAY[p_business_id] AS path
    UNION ALL
    SELECT l.child_business_profile_id, down.d + 1, down.path || l.child_business_profile_id
    FROM down
    JOIN public.business_ownership_links l
      ON l.parent_business_profile_id = down.biz AND l.status = 'active'
    WHERE NOT l.child_business_profile_id = ANY (down.path)
  )
  SELECT d.biz, COALESCE(bp.business_name, 'Unnamed business')::TEXT, d.d,
         bp.latitude::NUMERIC, bp.longitude::NUMERIC, bp.location_address, bp.location_directions,
         bp.location_updated_at,
         public._bol_can_set_location(d.biz),
         (to_regclass('public.cmms_company_profiles') IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.cmms_company_profiles c
                       WHERE c.pichin_business_profile_id = d.biz AND c.supermarket_id IS NOT NULL))
  FROM down d
  JOIN public.business_profiles bp ON bp.id = d.biz
  ORDER BY d.d, bp.business_name;
END;
$$;


-- ----------------------------------------------------------------------------
-- Store side: owner / active manager of a supermarket
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._bol_is_supermarket_manager(p_supermarket_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ok BOOLEAN := FALSE;
BEGIN
  IF p_supermarket_id IS NULL OR to_regclass('public.supermarkets') IS NULL THEN RETURN FALSE; END IF;
  EXECUTE $q$
    SELECT EXISTS (SELECT 1 FROM public.supermarkets s WHERE s.id = $1 AND (
      s.owner_user_id = auth.uid()
      OR (to_regclass('public.supermarket_staff') IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.supermarket_staff m WHERE m.supermarket_id = s.id
               AND m.user_id = auth.uid() AND m.role = 'manager' AND m.status = 'active'))))
  $q$ INTO v_ok USING p_supermarket_id;
  RETURN COALESCE(v_ok, FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_supermarket_get_location(p_supermarket_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out JSONB; v_dir TEXT; v_biz UUID;
BEGIN
  IF NOT public._bol_is_supermarket_manager(p_supermarket_id) THEN
    RAISE EXCEPTION 'You are not an owner or manager of that supermarket';
  END IF;
  BEGIN
    EXECUTE $q$
      SELECT jsonb_build_object('latitude', s.latitude, 'longitude', s.longitude,
                                'address', s.address, 'country', s.country, 'name', s.name)
      FROM public.supermarkets s WHERE s.id = $1
    $q$ INTO v_out USING p_supermarket_id;
  EXCEPTION WHEN undefined_column THEN
    RAISE EXCEPTION 'Run ADD_SUPERMARKET_GEOLOCATION.sql first - supermarkets has no coordinates yet';
  END;
  -- Directions and the owning business live on the business profile wired to this store.
  IF to_regclass('public.cmms_company_profiles') IS NOT NULL THEN
    SELECT bp.id, bp.location_directions INTO v_biz, v_dir
      FROM public.cmms_company_profiles c
      JOIN public.business_profiles bp ON bp.id = c.pichin_business_profile_id
     WHERE c.supermarket_id = p_supermarket_id
     ORDER BY bp.location_updated_at DESC NULLS LAST LIMIT 1;
  END IF;
  RETURN v_out || jsonb_build_object('directions', v_dir, 'business_id', v_biz);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_supermarket_set_location(
  p_supermarket_id UUID,
  p_latitude       NUMERIC,
  p_longitude      NUMERIC,
  p_address        TEXT DEFAULT NULL,
  p_directions     TEXT DEFAULT NULL,
  p_country        TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_addr TEXT := NULLIF(btrim(COALESCE(p_address, '')), '');
  v_dir  TEXT := NULLIF(btrim(COALESCE(p_directions, '')), '');
  v_ctry TEXT := NULLIF(btrim(COALESCE(p_country, '')), '');
  v_biz  INT := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF NOT public._bol_is_supermarket_manager(p_supermarket_id) THEN
    RAISE EXCEPTION 'You are not an owner or manager of that supermarket';
  END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL
     OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'That is not a valid map position';
  END IF;
  IF char_length(COALESCE(v_dir, '')) > 600 THEN
    RAISE EXCEPTION 'Directions are too long (600 characters at most)';
  END IF;

  BEGIN
    EXECUTE $q$
      UPDATE public.supermarkets s
         SET latitude = $1, longitude = $2,
             address = COALESCE($3, s.address), country = COALESCE($4, s.country)
       WHERE s.id = $5
    $q$ USING ROUND(p_latitude, 8), ROUND(p_longitude, 8), v_addr, v_ctry, p_supermarket_id;
  EXCEPTION WHEN undefined_column THEN
    RAISE EXCEPTION 'Run ADD_SUPERMARKET_GEOLOCATION.sql first - supermarkets has no coordinates yet';
  END;

  -- The branch business profile(s) wired to this store show the same pin.
  IF to_regclass('public.cmms_company_profiles') IS NOT NULL THEN
    UPDATE public.business_profiles bp
       SET latitude = ROUND(p_latitude, 8), longitude = ROUND(p_longitude, 8),
           location_address = COALESCE(v_addr, bp.location_address),
           location_directions = COALESCE(v_dir, bp.location_directions),
           location_updated_at = NOW(), location_updated_by = auth.uid()
     WHERE bp.id IN (SELECT c.pichin_business_profile_id FROM public.cmms_company_profiles c
                      WHERE c.supermarket_id = p_supermarket_id AND c.pichin_business_profile_id IS NOT NULL);
    GET DIAGNOSTICS v_biz = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('status', 'saved', 'business_profiles_updated', v_biz);
END;
$$;

-- ----------------------------------------------------------------------------
-- Hardening: signed-in users only; the internal helpers are not callable directly.
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._bol_can_set_location(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_business_set_location(UUID, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_business_branch_locations(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._bol_is_supermarket_manager(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_supermarket_get_location(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_supermarket_set_location(UUID, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_supermarket_get_location(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_supermarket_set_location(UUID, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_business_set_location(UUID, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_business_branch_locations(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
