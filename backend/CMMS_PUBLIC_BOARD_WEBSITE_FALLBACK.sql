-- ============================================================
-- CMMS Public Notice Board -- website falls back to the linked
-- Pitchin/ICANera business profile, same as logo/location already do
-- ============================================================
-- CMMS_PUBLIC_BOARD_PITCHIN_FALLBACKS.sql added COALESCE(cp.logo_url,
-- bp.avatar_url) and COALESCE(cp.location, bp.business_address) so an owner
-- who'd already filled these in for Pitchin didn't have to re-enter them for
-- the board. website was left out of that pass -- cp.website is selected
-- plain, with no fallback -- so a company whose cmms_company_profiles row
-- was auto-created (cmms_ensure_pichin_business_access in
-- CMMS_PICHIN_PROFILE_ACCESS_BY_TYPE.sql only sets company_name,
-- company_registration, email, industry -- never website) shows no website
-- on its public board even when the owner's linked business_profiles.website
-- (business_profiles has its own `website VARCHAR(255)` column, see
-- db/schemas/04_business_profiles_blockchain.sql) is already set.
--
-- Fallback order in fn_get_public_cmms_company_header, matching the
-- logo/location precedent:
--   website: cmms_company_profiles.website  (explicitly set for the board)
--          > business_profiles.website      (via business_profile_id)
--          > null (Website action/info row simply don't render)
--
-- Run after: CMMS_PUBLIC_BOARD_PITCHIN_FALLBACKS.sql.
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
    COALESCE(cp.website, bp.website)::VARCHAR AS website,
    cp.phone, cp.email,
    cp.about, COALESCE(cp.logo_url, bp.avatar_url) AS logo_url, cp.business_profile_id,
    cp.tagline, cp.cover_image_url, cp.whatsapp, cp.hours_text,
    cp.facebook_url, cp.instagram_url, cp.twitter_url, cp.linkedin_url, cp.tiktok_url
  FROM public.cmms_company_profiles cp
  LEFT JOIN public.business_profiles bp ON bp.id = cp.business_profile_id
  WHERE cp.id = p_company_id;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_public_cmms_company_header(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS public board website now falls back to the linked Pitchin business profile' AS status;
