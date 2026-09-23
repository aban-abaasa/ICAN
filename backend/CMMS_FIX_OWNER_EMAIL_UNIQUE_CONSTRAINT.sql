-- Fix: cmms_ensure_pichin_business_access -> 409 Conflict
--   duplicate key value violates unique constraint
--   "cmms_company_profiles_owner_email_key"
--   Key (owner_email)=(...) already exists.
--
-- Root cause: CMMS_FIX_CREATOR_DETECTION.sql added
--   owner_email VARCHAR(255) UNIQUE
-- back when each user could only run one CMMS-linked business. Since
-- CMMS_PICHIN_PROFILE_ACCESS_BY_TYPE.sql, cmms_ensure_pichin_business_access()
-- deliberately creates one cmms_company_profiles row PER Pichin business a
-- user owns (its own comment: "a single owner can run multiple businesses
-- with separate CMMS administration") -- but the leftover UNIQUE(owner_email)
-- was never dropped, so provisioning the second business for the same owner
-- email always fails on INSERT with 23505 -> PostgREST reports it as 409.
--
-- Fix: drop the stale UNIQUE(owner_email) and replace the intended
-- uniqueness guarantee with a partial unique index on
-- pichin_business_profile_id (one CMMS company per Pichin business profile,
-- which is what cmms_ensure_pichin_business_access's own check-then-insert
-- assumes; legacy non-Pichin rows with a NULL pichin_business_profile_id are
-- excluded so they don't collide with each other).
--
-- Safe to run more than once.

ALTER TABLE public.cmms_company_profiles
  DROP CONSTRAINT IF EXISTS cmms_company_profiles_owner_email_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cmms_company_profiles_pichin_business_profile_id
  ON public.cmms_company_profiles (pichin_business_profile_id)
  WHERE pichin_business_profile_id IS NOT NULL;
