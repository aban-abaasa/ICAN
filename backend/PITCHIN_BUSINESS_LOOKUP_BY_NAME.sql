-- =====================================================
-- Name-based business_profile_id lookup for the public board
-- =====================================================
-- PublicCompanyNoticeBoard.jsx (/notices/:companyId) only shows a business's
-- Pitches tab when someone has manually linked that CMMS company to a
-- business_profile_id (the "Board profile" step in CMMSAnnouncementsPanel.jsx).
-- Until that manual link is made, a business with real published pitches
-- would show no Pitches tab at all on its own public page.
--
-- This lets the board fall back to matching by business NAME when the
-- explicit link is missing. business_profiles has no public SELECT policy
-- (FIX_BUSINESS_PROFILES_RLS_FOR_SHAREHOLDERS.sql restricted it to owner/
-- co-owners), so a plain client-side name search would return nothing for
-- anyone else -- this SECURITY DEFINER function exposes only the bare id,
-- nothing else about the business.
-- =====================================================

DROP FUNCTION IF EXISTS public.fn_find_business_profile_id_by_name(TEXT);
CREATE OR REPLACE FUNCTION public.fn_find_business_profile_id_by_name(p_business_name TEXT)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT id
  FROM public.business_profiles
  WHERE lower(trim(business_name)) = lower(trim(p_business_name))
  ORDER BY created_at ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.fn_find_business_profile_id_by_name(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_find_business_profile_id_by_name(TEXT) TO anon, authenticated;

-- =====================================================
-- VERIFICATION
-- =====================================================
SELECT 'fn_find_business_profile_id_by_name created' AS check, proname
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_find_business_profile_id_by_name';
