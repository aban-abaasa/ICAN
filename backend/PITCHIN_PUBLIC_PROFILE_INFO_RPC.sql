-- =====================================================
-- PITCHIN PUBLIC PROFILE INFO (pitcher / commenter / status poster avatars)
-- =====================================================
-- Pitchin shows real profile photos instead of initials for: the Pitcher
-- avatar in the video feed, the Business Details modal, pitch comments, and
-- status/"Updates" posts + their comments.
--
-- public.profiles has RLS "USING (auth.uid() = id)" (ADD_PROFILE_COLUMNS.sql)
-- -- a user can only SELECT their own row. Pitchin's pitch feed, comments and
-- statuses are deliberately public ("free to view for everyone" -- see
-- Pitchin.jsx), so a viewer looking at someone else's pitch/comment/status
-- would get zero rows back from a direct `profiles` select for that person
-- and silently fall back to the initials avatar -- the photo would never
-- actually show for anyone except a user looking at their own content.
--
-- This SECURITY DEFINER function returns only full_name/avatar_url for the
-- requested ids -- no email, phone, income_level, financial_goal or any other
-- column on profiles -- so it's safe to expose broadly without loosening RLS
-- on the table itself (same pattern as fn_get_business_issued_shares in
-- PITCHIN_LIVE_SHARE_AVAILABILITY.sql).
--
-- Run once in the Supabase SQL Editor.
-- =====================================================

CREATE OR REPLACE FUNCTION fn_get_public_profile_info(p_user_ids UUID[])
RETURNS TABLE (id UUID, full_name TEXT, avatar_url TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT id, full_name, avatar_url
  FROM profiles
  WHERE id = ANY(p_user_ids);
$$;

-- Pitchin's feed/comments/statuses are readable while signed out too
-- (demo/browse mode), so anon needs this alongside authenticated.
GRANT EXECUTE ON FUNCTION fn_get_public_profile_info(UUID[]) TO anon, authenticated;

SELECT 'fn_get_public_profile_info created' AS status;
