-- ============================================================
-- Fix CMMS companies mislinked by CMMS_NOTICE_BOARD_PRODUCTS.sql's one-time
-- backfill
-- ============================================================
-- That file's step 1 backfill set business_profile_id to whatever SINGLE
-- business_profile the company's CREATOR happened to own -- with no check
-- that it was actually the same business. A CMMS company created by a
-- shareholder/employee (rather than the business owner) who separately owns
-- one unrelated business_profile got silently wired to that stranger
-- profile instead of being left NULL. Confirmed for "DAb": explicit_link
-- (f30fb702-...) doesn't match its name at all, while a DIFFERENT
-- business_profile (35a1d558-..., literally named "DAb", with a real logo
-- and pitches) was sitting unlinked the whole time.
--
-- Because CMMS_PUBLIC_BOARD_BUSINESS_PROFILE_NAME_FALLBACK.sql's header RPC
-- trusts an explicit business_profile_id link over the name-match fallback
-- (correct in general -- a deliberate link should win), this bad backfill
-- data was silently overriding the correct name match everywhere it fired.
--
-- This is a one-time data fix, not a logic change: it repoints
-- business_profile_id only where the CURRENTLY linked profile's name
-- doesn't match the company's own name AT ALL, but a DIFFERENT business
-- profile with a matching name exists -- i.e. only cases the backfill most
-- plausibly broke. Anything else (no exact-name match found) is left alone
-- and listed at the end for manual review, rather than guessed at.
--
-- Run after: CMMS_PUBLIC_BOARD_BUSINESS_PROFILE_NAME_FALLBACK.sql.
-- Safe to run more than once (idempotent -- rows already correct don't
-- match the WHERE clause a second time).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Diagnostic -- every company whose linked profile's name doesn't match
--    its own name, before touching anything.
-- ------------------------------------------------------------
SELECT
  cp.id AS company_id,
  cp.company_name,
  cp.business_profile_id AS currently_linked_id,
  bp.business_name AS currently_linked_name,
  (SELECT id FROM public.business_profiles bp2
   WHERE lower(trim(bp2.business_name)) = lower(trim(cp.company_name))
   ORDER BY bp2.created_at ASC LIMIT 1) AS correct_match_id
FROM public.cmms_company_profiles cp
JOIN public.business_profiles bp ON bp.id = cp.business_profile_id
WHERE lower(trim(bp.business_name)) <> lower(trim(cp.company_name));

-- ------------------------------------------------------------
-- 2. Repoint only the rows where a correct, name-matched replacement exists.
-- ------------------------------------------------------------
UPDATE public.cmms_company_profiles cp
SET business_profile_id = fix.correct_id, updated_at = NOW()
FROM (
  SELECT
    cp2.id AS company_id,
    (SELECT id FROM public.business_profiles bp2
     WHERE lower(trim(bp2.business_name)) = lower(trim(cp2.company_name))
     ORDER BY bp2.created_at ASC LIMIT 1) AS correct_id
  FROM public.cmms_company_profiles cp2
  JOIN public.business_profiles wrong_bp ON wrong_bp.id = cp2.business_profile_id
  WHERE lower(trim(wrong_bp.business_name)) <> lower(trim(cp2.company_name))
) AS fix
WHERE cp.id = fix.company_id
  AND fix.correct_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3. Anything still mismatched (no company-named business profile exists to
--    repoint to) -- left untouched, review manually via the "Board profile"
--    tab if any of these show up.
-- ------------------------------------------------------------
SELECT
  cp.id AS company_id,
  cp.company_name,
  cp.business_profile_id AS still_linked_to,
  bp.business_name AS still_linked_name
FROM public.cmms_company_profiles cp
JOIN public.business_profiles bp ON bp.id = cp.business_profile_id
WHERE lower(trim(bp.business_name)) <> lower(trim(cp.company_name));

SELECT 'Mislinked CMMS business profiles repointed where a name match existed' AS status;
