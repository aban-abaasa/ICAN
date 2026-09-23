-- ============================================================
-- CMMS Public Notice Board -- business-profile fallback works even when
-- the CMMS company was never linked to its owner's Pitchin business profile
-- ============================================================
-- CMMS_PUBLIC_BOARD_PITCHIN_FALLBACKS.sql made the public board's logo/
-- location fall back to the linked ICANera business_profiles row via
-- cmms_company_profiles.business_profile_id -- but that link is only ever
-- set through the "Board profile" tab in CMMSAnnouncementsPanel.jsx, whose
-- picker (myBusinessProfiles) only lists business profiles the CURRENT
-- user themselves owns. A shareholder/employee who has canEdit on the CMMS
-- company but didn't personally create the business's Pitchin profile has
-- no way to link it at all -- business_profile_id just stays NULL forever,
-- even though a real, fully-filled-in profile (logo, description, website,
-- pitches) already exists under the actual owner's account with the exact
-- same business name.
--
-- fn_find_business_profile_id_by_name (PITCHIN_BUSINESS_LOOKUP_BY_NAME.sql)
-- already solves exactly this for the Pitches tab, client-side (see
-- getBusinessProfileIdByName in PublicCompanyNoticeBoard.jsx) -- this file
-- brings the same name-match fallback server-side into the header RPC
-- itself, so:
--   - logo_url / location / website / about all fall back through the
--     name-matched profile too, not only an explicit link, and
--   - the header now returns the RESOLVED business_profile_id, so the
--     Pitches tab and the header always agree on which business profile
--     they're both pulling from (today they can resolve to different
--     profiles in the rare case of a duplicate business name, since each
--     used a separate, independent lookup).
--
-- Fallback order per field (explicit link always wins when set, since an
-- admin who deliberately linked or typed a value meant exactly that):
--   business_profile_id: cp.business_profile_id > fn_find_business_profile_id_by_name(cp.company_name)
--   logo_url:  cp.logo_url  > bp.avatar_url  > null
--   location:  cp.location  > bp.business_address > null
--   website:   cp.website   > bp.website > null
--   about:     cp.about     > bp.description > null
--
-- Run after: PITCHIN_BUSINESS_LOOKUP_BY_NAME.sql (defines
-- fn_find_business_profile_id_by_name, called below) and
-- CMMS_PUBLIC_BUSINESS_WEBSITE_PROFILE.sql (defines the tagline/cover/
-- socials columns this function also still returns).
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
  WITH resolved AS (
    SELECT
      cp.*,
      COALESCE(cp.business_profile_id, public.fn_find_business_profile_id_by_name(cp.company_name)) AS resolved_business_profile_id
    FROM public.cmms_company_profiles cp
    WHERE cp.id = p_company_id
  )
  SELECT
    r.id, r.company_name, r.industry,
    COALESCE(r.location, bp.business_address)::VARCHAR AS location,
    COALESCE(r.website, bp.website)::VARCHAR AS website,
    r.phone, r.email,
    COALESCE(r.about, bp.description) AS about,
    COALESCE(r.logo_url, bp.avatar_url) AS logo_url,
    r.resolved_business_profile_id AS business_profile_id,
    r.tagline, r.cover_image_url, r.whatsapp, r.hours_text,
    r.facebook_url, r.instagram_url, r.twitter_url, r.linkedin_url, r.tiktok_url
  FROM resolved r
  LEFT JOIN public.business_profiles bp ON bp.id = r.resolved_business_profile_id;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_public_cmms_company_header(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS public board header now falls back to a name-matched business profile even without an explicit Board-profile link' AS status;
