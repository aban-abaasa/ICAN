-- ============================================================
-- CMMS Public Notice Board -- logo & location fall back to the linked
-- Pitchin/ICANera business profile
-- ============================================================
-- A CMMS company can optionally link one of the owner's own ICANera
-- business_profiles to show its products/services on the public board
-- (business_profile_id, see CMMS_NOTICE_BOARD_PRODUCTS.sql). That linked
-- business profile very often already has its own branded logo and address
-- set -- business_profiles.avatar_url (ADD_BUSINESS_AVATAR_URL.sql) and
-- business_profiles.business_address -- shown across Pitchin (video feed,
-- Business Details modal, "See all from this pitcher"). Until now the
-- public board ignored both entirely and fell straight to a plain
-- initial-letter avatar / blank location whenever cmms_company_profiles had
-- none of its own -- forcing an admin who already filled these in once (for
-- Pitchin) to re-enter the exact same info for the board to stop looking
-- generic/incomplete.
--
-- Fallback order in fn_get_public_cmms_company_header, matching Pitchin.jsx's
-- own "business's own logo > (n/a here, no personal-owner fallback on a
-- public board) > initials" precedent:
--   logo_url:  cmms_company_profiles.logo_url  (explicitly set for the board)
--            > business_profiles.avatar_url    (via business_profile_id)
--            > null (BusinessHero renders the initial-letter avatar)
--   location:  cmms_company_profiles.location  (explicitly set for the board)
--            > business_profiles.business_address (via business_profile_id)
--            > null (location chip/Directions button simply don't render)
--
-- avatar_url is an r2://<key> marker exactly like logo_url already is --
-- both flow through the same generic resolveMediaValue() call on the read
-- side (getPublicCompanyHeader in cmmsAnnouncementsService.js, and
-- api/share-preview.js's buildNoticeMeta), so no change is needed there.
-- business_address is a plain text address (not media), used as-is.
--
-- Run after: CMMS_PUBLIC_BUSINESS_WEBSITE_PROFILE.sql.
-- Safe to run more than once.
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_get_public_cmms_company_header(UUID);
CREATE OR REPLACE FUNCTION public.fn_get_public_cmms_company_header(p_company_id UUID)
RETURNS TABLE (
  id UUID,
  company_name VARCHAR,
  industry VARCHAR,
  location VARCHAR,
  website VARCHAR,
  phone VARCHAR,
  email VARCHAR,
  about TEXT,
  logo_url TEXT,
  business_profile_id UUID,
  tagline VARCHAR,
  cover_image_url TEXT,
  whatsapp VARCHAR,
  hours_text VARCHAR,
  facebook_url TEXT,
  instagram_url TEXT,
  twitter_url TEXT,
  linkedin_url TEXT,
  tiktok_url TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cp.id, cp.company_name, cp.industry,
    COALESCE(cp.location, bp.business_address)::VARCHAR AS location,
    cp.website, cp.phone, cp.email,
    cp.about, COALESCE(cp.logo_url, bp.avatar_url) AS logo_url, cp.business_profile_id,
    cp.tagline, cp.cover_image_url, cp.whatsapp, cp.hours_text,
    cp.facebook_url, cp.instagram_url, cp.twitter_url, cp.linkedin_url, cp.tiktok_url
  FROM public.cmms_company_profiles cp
  LEFT JOIN public.business_profiles bp ON bp.id = cp.business_profile_id
  WHERE cp.id = p_company_id;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_public_cmms_company_header(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS public board logo & location now fall back to the linked Pitchin business profile' AS status;
