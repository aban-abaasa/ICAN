-- =====================================================
-- PITCHIN PUBLIC BUSINESS PROFILE INFO (pitch card logo/name/funding info)
-- =====================================================
-- Root cause of "the logo is saved in Pitchin but doesn't show on the public
-- page": FIX_BUSINESS_PROFILES_RLS_FOR_SHAREHOLDERS.sql dropped the table's
-- old "Public read access" policy and replaced it with owner-only + co-owner
-- only SELECT policies. pitchingService.js's PITCH_WITH_BUSINESS_SELECT
-- embeds business_profiles(...) directly in its `pitches` query, so that
-- embed -- and every avatar_url/business_name/founded_year/total_capital
-- field on it -- now comes back completely NULL for anyone except the
-- business's own owner/co-owner. That's almost every viewer of the public
-- Pitchin feed, a shared /pitchin/:id link, or the "Business Details" modal,
-- so a business's saved logo (and its founded-year/total-capital, shown
-- publicly by design on a fundraising pitch) silently never rendered for
-- them -- confirmed live: `pitches?select=...,business_profiles(...)` via
-- the anon key returns `"business_profiles":null` even though the row and
-- its business_profile_id are both real.
--
-- This SECURITY DEFINER function returns only the columns Pitchin's own
-- pitch cards, PublicPitchViewer and the Business Details modal already
-- render publicly (business_name, description, business_type,
-- business_structure, founded_year, total_capital, avatar_url) -- no wallet
-- balance, banking, KYC/verification documents, or contact details -- so
-- it's safe to expose broadly without reopening the table's own RLS (same
-- pattern as fn_get_public_profile_info in PITCHIN_PUBLIC_PROFILE_INFO_RPC.sql,
-- just keyed by business_profile_id instead of user_id).
--
-- Run once in the Supabase SQL Editor.
-- =====================================================

CREATE OR REPLACE FUNCTION fn_get_public_business_profiles(p_business_profile_ids UUID[])
RETURNS TABLE (
  id UUID,
  user_id UUID,
  business_name TEXT,
  description TEXT,
  business_type TEXT,
  business_structure TEXT,
  founded_year INT,
  total_capital NUMERIC,
  avatar_url TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT id, user_id, business_name, description, business_type,
         business_structure, founded_year, total_capital, avatar_url
  FROM business_profiles
  WHERE id = ANY(p_business_profile_ids);
$$;

-- Pitchin's feed/shared pitch links are readable while signed out too, so
-- anon needs this alongside authenticated.
GRANT EXECUTE ON FUNCTION fn_get_public_business_profiles(UUID[]) TO anon, authenticated;

SELECT 'fn_get_public_business_profiles created' AS status;
