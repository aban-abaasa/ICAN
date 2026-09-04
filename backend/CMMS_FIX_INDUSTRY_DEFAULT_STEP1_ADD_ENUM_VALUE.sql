-- Fix: CMMS notice board / careers page shows "Construction" for businesses
-- that aren't construction companies (e.g. ITAWO).
--
-- Root cause: cmms_business_type_architecture() in
-- CMMS_PICHIN_PROFILE_ACCESS_BY_TYPE.sql maps a Pichin business's category
-- to a cmms_industry_type. Its ELSE branch -- the catch-all for any category
-- it doesn't recognize (government, law_firm, professional_services, the
-- generic "other" category, etc.) -- defaults to 'Construction'. Every
-- business whose category isn't factory/retail/school/transport/pharmacy/
-- hotel/farm silently gets stamped "Construction".
--
-- cmms_industry_type has no generic "Other" value to fall back to instead,
-- so this STEP 1 adds one. Postgres will not let a newly added enum value
-- be used in the same transaction that creates it, so this must run as its
-- own statement batch, committed, BEFORE running STEP 2 (which uses it in
-- the corrected function and in a backfill UPDATE).
--
-- Safe to run more than once.

ALTER TYPE public.cmms_industry_type ADD VALUE IF NOT EXISTS 'Other';
