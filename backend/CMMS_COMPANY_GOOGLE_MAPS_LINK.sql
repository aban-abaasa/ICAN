-- ============================================================
-- CMMS Company Profile -- save the business's own verified Google Maps
-- listing link, and let the public board's Directions/map use it
-- ============================================================
-- The public board's Directions button and embedded map (PITCHIN_PUBLIC_
-- BUSINESS_PROFILE_INFO_RPC.sql's sibling, CMMS_PUBLIC_BOARD_WEBSITE_
-- FALLBACK.sql) previously only ever geocoded free-text "business name,
-- location" -- a best-effort guess. Once an owner has actually registered
-- (or already has) a Google Business Profile/Maps listing (see the "Get
-- found on Google Maps" card in CMSSModule.jsx), they can paste that real
-- listing's link back in here so visitors get routed to the exact,
-- Google-verified pin instead of a geocoded guess.
--
-- Run after: CMMS_PUBLIC_BOARD_WEBSITE_FALLBACK.sql.
-- Safe to run more than once.
-- ============================================================

ALTER TABLE public.cmms_company_profiles
  ADD COLUMN IF NOT EXISTS google_maps_url TEXT;

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
  tiktok_url TEXT,
  google_maps_url TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cp.id, cp.company_name, cp.industry,
    COALESCE(cp.location, bp.business_address)::VARCHAR AS location,
    COALESCE(cp.website, bp.website)::VARCHAR AS website,
    cp.phone, cp.email,
    cp.about, COALESCE(cp.logo_url, bp.avatar_url) AS logo_url, cp.business_profile_id,
    cp.tagline, cp.cover_image_url, cp.whatsapp, cp.hours_text,
    cp.facebook_url, cp.instagram_url, cp.twitter_url, cp.linkedin_url, cp.tiktok_url,
    cp.google_maps_url
  FROM public.cmms_company_profiles cp
  LEFT JOIN public.business_profiles bp ON bp.id = cp.business_profile_id
  WHERE cp.id = p_company_id;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_public_cmms_company_header(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS company profiles can now save a verified Google Maps link, used by the public board' AS status;
