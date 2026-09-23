-- ============================================================
-- CMMS "Investor pitch" tab -- create a real Pitchin pitch from inside CMMS,
-- for the actual owner OR anyone who manages the business
-- ============================================================
-- CMMSAnnouncementsPanel.jsx's new "Investor pitch" tab lets a CMMS company
-- admin create a Pitchin pitch (video + business-plan/financials/value-
-- proposition/MOU/share-terms documents, via the existing PitchVideoRecorder
-- flow) for the business linked to their CMMS company -- without leaving
-- CMMS or re-typing anything already on file in Pitchin.
--
-- The blocker: pitches INSERT/UPDATE RLS (04_business_profiles_blockchain.sql,
-- later tightened in db/fix_pitches_rls_v2.sql) only allows the literal
-- business_profiles.user_id, or (per fix_pitches_rls_v2.sql) a row in
-- business_co_owners. A CMMS company created/run by a shareholder who is
-- recorded only in business_member_roles (the table
-- fn_set_cmms_company_business_profile already trusts for "does this person
-- manage this business") would open this new tab and be silently blocked --
-- the exact same shareholder-vs-owner gap that caused the "DAb" board-profile
-- bug fixed in CMMS_PUBLIC_BOARD_BUSINESS_PROFILE_NAME_FALLBACK.sql.
--
-- Fix: three SECURITY DEFINER RPCs (create/update/delete, mirroring exactly
-- what Pitchin.jsx's own handleCreatePitch already does: insert, then upload+
-- attach video, or delete on upload failure) that check BOTH co-ownership
-- tables this codebase actually uses -- business_member_roles (operational
-- "manages this business") AND business_co_owners (equity co-ownership) --
-- plus the raw owner. More permissive than either existing check alone,
-- deliberately: a real co-owner recorded in only one of the two tables
-- should not be silently blocked.
--
-- Note: unlike pitches, deletePitch's existing RLS (db/fix_pitches_rls_v2.sql)
-- is owner-only by deliberate design ("Only profile owner can delete
-- pitches (not co-owners)") -- fn_cmms_delete_managed_pitch intentionally
-- widens this ONLY for the specific, narrow rollback case (an upload that
-- just failed, seconds after this same caller's own insert), not general
-- pitch deletion.
--
-- Run after: CMMS_NOTICE_BOARD_PRODUCTS.sql (business_member_roles is used
-- there too), UNIFIED_BUSINESS_MANAGEMENT_AND_SUPPLIER_MARKETPLACE.sql
-- (defines business_member_roles).
-- Safe to run more than once.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Shared ownership/management check
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_business_owns_or_manages(UUID);
CREATE OR REPLACE FUNCTION public.fn_business_owns_or_manages(p_business_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.business_profiles bp
      WHERE bp.id = p_business_profile_id AND bp.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.business_member_roles bmr
      WHERE bmr.business_profile_id = p_business_profile_id
        AND bmr.auth_user_id = auth.uid()
        AND bmr.status = 'active'
    )
    OR EXISTS (
      SELECT 1 FROM public.business_co_owners co
      WHERE co.business_profile_id = p_business_profile_id
        AND co.status = 'active'
        AND (
          co.user_id = auth.uid()
          OR co.owner_email = (SELECT email FROM public.profiles WHERE id = auth.uid())
        )
    );
$$;

REVOKE ALL ON FUNCTION public.fn_business_owns_or_manages(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_business_owns_or_manages(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 2. Create -- mirrors the `newPitch` object Pitchin.jsx's handleCreatePitch
--    builds before calling createPitch().
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_cmms_create_managed_pitch(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, BOOLEAN, TEXT);
CREATE OR REPLACE FUNCTION public.fn_cmms_create_managed_pitch(
  p_business_profile_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_category TEXT,
  p_pitch_type TEXT,
  p_target_funding NUMERIC,
  p_equity_offering NUMERIC,
  p_has_ip BOOLEAN,
  p_ip_details TEXT
)
RETURNS SETOF public.pitches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required';
  END IF;

  IF NOT public.fn_business_owns_or_manages(p_business_profile_id) THEN
    RAISE EXCEPTION 'You can only create a pitch for a business you own or manage';
  END IF;

  RETURN QUERY
  INSERT INTO public.pitches (
    business_profile_id, title, description, category, pitch_type,
    target_funding, raised_amount, equity_offering, has_ip, ip_details,
    status, likes_count, comments_count, shares_count, views_count
  ) VALUES (
    p_business_profile_id,
    COALESCE(NULLIF(TRIM(p_title), ''), 'Untitled Pitch'),
    COALESCE(p_description, ''),
    COALESCE(NULLIF(TRIM(p_category), ''), 'Technology'),
    COALESCE(NULLIF(TRIM(p_pitch_type), ''), 'Equity'),
    COALESCE(p_target_funding, 0),
    0,
    COALESCE(p_equity_offering, 0),
    COALESCE(p_has_ip, FALSE),
    p_ip_details,
    'published',
    0, 0, 0, 0
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_cmms_create_managed_pitch(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cmms_create_managed_pitch(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, BOOLEAN, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 3. Update -- attaches the uploaded video (Pitchin.jsx:862-877's
--    updatePitch(newPitchData.id, { video_url }) step).
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_cmms_update_managed_pitch(UUID, TEXT, INTEGER, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.fn_cmms_update_managed_pitch(
  p_pitch_id UUID,
  p_video_url TEXT,
  p_video_duration_seconds INTEGER,
  p_thumbnail_url TEXT,
  p_status TEXT
)
RETURNS SETOF public.pitches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_profile_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required';
  END IF;

  SELECT business_profile_id INTO v_business_profile_id
  FROM public.pitches WHERE id = p_pitch_id;

  IF v_business_profile_id IS NULL THEN
    RAISE EXCEPTION 'Pitch not found';
  END IF;

  IF NOT public.fn_business_owns_or_manages(v_business_profile_id) THEN
    RAISE EXCEPTION 'You can only update a pitch for a business you own or manage';
  END IF;

  RETURN QUERY
  UPDATE public.pitches SET
    video_url = COALESCE(p_video_url, video_url),
    video_duration_seconds = COALESCE(p_video_duration_seconds, video_duration_seconds),
    thumbnail_url = COALESCE(p_thumbnail_url, thumbnail_url),
    status = COALESCE(p_status, status),
    updated_at = NOW()
  WHERE id = p_pitch_id
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_cmms_update_managed_pitch(UUID, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cmms_update_managed_pitch(UUID, TEXT, INTEGER, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 4. Delete -- rollback when the video upload fails right after create
--    (Pitchin.jsx:877-895's "Video is required" deletePitch() call).
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_cmms_delete_managed_pitch(UUID);
CREATE OR REPLACE FUNCTION public.fn_cmms_delete_managed_pitch(p_pitch_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_profile_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required';
  END IF;

  SELECT business_profile_id INTO v_business_profile_id
  FROM public.pitches WHERE id = p_pitch_id;

  IF v_business_profile_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF NOT public.fn_business_owns_or_manages(v_business_profile_id) THEN
    RAISE EXCEPTION 'You can only delete a pitch for a business you own or manage';
  END IF;

  DELETE FROM public.pitches WHERE id = p_pitch_id;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_cmms_delete_managed_pitch(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cmms_delete_managed_pitch(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS investor-pitch RPCs installed (create/update/delete, owner + co-owner/manager aware)' AS status;
