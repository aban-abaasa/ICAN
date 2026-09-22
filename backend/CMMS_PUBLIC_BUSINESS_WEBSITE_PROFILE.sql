-- ============================================================
-- CMMS Public Notice Board -- "Real Business Website" Profile
-- ============================================================
-- Every CMMS company already has a free public page at
-- /notices/<companyId> (PublicCompanyNoticeBoard.jsx), reachable from its
-- own shareable link and printable QR flyer. Until now that page only had
-- company_name/industry/location/website/phone/about/logo_url to work
-- with -- enough for a notice feed, not enough to *read* as the business's
-- own website. This file adds the fields a real small-business site needs
-- (tagline, cover photo, WhatsApp, socials, hours) and republishes the one
-- public header RPC the page already calls, so the change is purely
-- additive: every existing caller of fn_get_public_cmms_company_header
-- keeps working, it just gets more columns back.
--
-- Design:
--   - All new columns live on cmms_company_profiles, same table `about`
--     already lives on, and are editable the same way: a plain column
--     UPDATE under the existing "allow_update_company_profile" RLS policy
--     (admin-only) -- see updateCompanyPublicProfile() in
--     cmmsAnnouncementsService.js. No new RPC or policy needed.
--   - Nothing here is sensitive: these are public marketing fields the
--     admin is choosing to put on their own public page, same trust level
--     as `about`/`phone`/`website` already granted to anon readers.
--   - cover_image_url/cover_image_path follow the same "uploaded to R2,
--     stored as a plain URL + key" shape as cmms_announcements.poster_url.
--
-- Run after: CMMS_NOTICE_BOARD_PRODUCTS.sql (defines the header RPC this
-- file replaces).
-- Safe to run more than once.
-- ============================================================

-- ============================================================
-- 1. New public-profile columns
-- ============================================================

ALTER TABLE public.cmms_company_profiles
  ADD COLUMN IF NOT EXISTS tagline VARCHAR(160),
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT,
  ADD COLUMN IF NOT EXISTS cover_image_path TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(30),
  ADD COLUMN IF NOT EXISTS hours_text VARCHAR(300),
  ADD COLUMN IF NOT EXISTS facebook_url TEXT,
  ADD COLUMN IF NOT EXISTS instagram_url TEXT,
  ADD COLUMN IF NOT EXISTS twitter_url TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_url TEXT;

-- ============================================================
-- 2. Public header RPC -- now returns the full "real website" profile
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
    cp.id, cp.company_name, cp.industry, cp.location, cp.website, cp.phone, cp.email,
    cp.about, cp.logo_url, cp.business_profile_id,
    cp.tagline, cp.cover_image_url, cp.whatsapp, cp.hours_text,
    cp.facebook_url, cp.instagram_url, cp.twitter_url, cp.linkedin_url, cp.tiktok_url
  FROM public.cmms_company_profiles cp
  WHERE cp.id = p_company_id;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_public_cmms_company_header(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS public notice board upgraded to a real business website profile (tagline, cover photo, WhatsApp, socials, hours)' AS status;
