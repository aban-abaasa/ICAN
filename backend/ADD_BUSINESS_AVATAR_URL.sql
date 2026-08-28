-- ============================================================================
-- Lets a business have its own logo/avatar, separate from the owner's
-- personal profile photo. Before this, the Pitcher avatar (video feed,
-- Business Details modal, "See all from this pitcher") always showed the
-- owner's personal photo (profiles.avatar_url via fn_get_public_profile_info)
-- because business_profiles had no image of its own -- fine as a default for
-- a sole proprietor, but wrong once a business wants its own branded logo
-- distinct from whoever happens to be signed in as the owner.
--
-- Display order (see Pitchin.jsx): business_profiles.avatar_url (this
-- column, explicitly set by the owner) > owner's personal photo > initials.
--
-- avatar_url follows the same r2://<key> convention as everything else the
-- app stores in R2 (pitches, statuses, personal avatars) -- resolved to a
-- live signed URL at read time via resolveMediaValue(s), never used as-is.
--
-- Run once in Supabase SQL Editor.
-- ============================================================================

ALTER TABLE public.business_profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

SELECT 'business_profiles.avatar_url added' AS status;
