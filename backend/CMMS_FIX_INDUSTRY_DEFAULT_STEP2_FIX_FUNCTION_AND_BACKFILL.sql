-- Fix: CMMS notice board / careers page shows "Construction" for businesses
-- that aren't construction companies (e.g. ITAWO). See STEP1 in this same
-- fix pair for the root cause. Run STEP 1 first and let it commit -- this
-- script uses the 'Other' enum value STEP 1 adds, and Postgres refuses to
-- use a new enum value inside the same transaction that created it.
--
-- This script:
--   1. Replaces cmms_business_type_architecture() so unmatched Pichin
--      business categories map to the new 'Other' industry instead of
--      silently defaulting to 'Construction', and gives 'construction' its
--      own explicit keyword match (previously it only worked by accident,
--      via the catch-all).
--   2. Backfills every existing Pichin-linked CMMS company: recomputes
--      industry + architecture from its stored pichin_business_type, so
--      businesses already mis-labeled "Construction" are corrected
--      immediately instead of waiting for their next
--      cmms_ensure_pichin_business_access() call (e.g. next login).
--
-- Safe to run more than once.

CREATE OR REPLACE FUNCTION public.cmms_business_type_architecture(p_business_type TEXT)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(coalesce(p_business_type, '')) IN ('factory', 'manufacturing', 'industrial') THEN
      jsonb_build_object('industry', 'Manufacturing', 'departments', jsonb_build_array('Production', 'Maintenance', 'Quality Assurance', 'Operations', 'Warehouse'))
    WHEN lower(coalesce(p_business_type, '')) IN ('wholesale', 'hardware', 'supermarket', 'retail', 'shop', 'supplier') THEN
      jsonb_build_object('industry', 'Retail', 'departments', jsonb_build_array('Store Operations', 'Purchasing', 'Warehouse', 'Sales', 'Maintenance'))
    WHEN lower(coalesce(p_business_type, '')) IN ('school', 'education', 'college', 'university') THEN
      jsonb_build_object('industry', 'Education', 'departments', jsonb_build_array('Administration', 'Teaching', 'Students', 'Admissions', 'Examinations', 'Facilities', 'Transport', 'Procurement', 'Finance', 'Human Resources'))
    WHEN lower(coalesce(p_business_type, '')) IN ('transport', 'transportation', 'logistics', 'fleet', 'delivery') THEN
      jsonb_build_object('industry', 'Transportation', 'departments', jsonb_build_array('Fleet Management', 'Operations', 'Maintenance', 'Logistics'))
    WHEN lower(coalesce(p_business_type, '')) IN ('pharmacy', 'healthcare', 'clinic', 'hospital') THEN
      jsonb_build_object('industry', 'Healthcare', 'departments', jsonb_build_array('Operations', 'Maintenance', 'Facilities', 'Administration'))
    WHEN lower(coalesce(p_business_type, '')) IN ('hotel', 'hospitality', 'restaurant', 'restaurant_cafe', 'cafe') THEN
      jsonb_build_object('industry', 'Hospitality', 'departments', jsonb_build_array('Operations', 'Inventory', 'Facilities', 'Maintenance', 'Food Safety'))
    WHEN lower(coalesce(p_business_type, '')) IN ('farm', 'agriculture', 'agribusiness') THEN
      jsonb_build_object('industry', 'Food_Processing', 'departments', jsonb_build_array('Production', 'Equipment Maintenance', 'Stores', 'Logistics', 'Safety'))
    WHEN lower(coalesce(p_business_type, '')) IN ('construction', 'contractor', 'builder') THEN
      jsonb_build_object('industry', 'Construction', 'departments', jsonb_build_array('Operations', 'Maintenance', 'Inventory', 'Administration'))
    WHEN lower(coalesce(p_business_type, '')) IN ('government', 'infrastructure', 'public_sector') THEN
      jsonb_build_object('industry', 'Other', 'departments', jsonb_build_array('Administration', 'Operations', 'Finance', 'Procurement'))
    WHEN lower(coalesce(p_business_type, '')) IN ('law_firm', 'legal') THEN
      jsonb_build_object('industry', 'Other', 'departments', jsonb_build_array('Client Matters', 'Administration', 'Finance', 'Records'))
    WHEN lower(coalesce(p_business_type, '')) IN ('professional_services', 'consultancy', 'services') THEN
      jsonb_build_object('industry', 'Other', 'departments', jsonb_build_array('Operations', 'Client Services', 'Administration', 'Finance'))
    ELSE
      jsonb_build_object('industry', 'Other', 'departments', jsonb_build_array('Operations', 'Administration', 'Finance', 'Maintenance'))
  END;
$$;

-- Backfill: recompute industry + architecture for every Pichin-linked CMMS
-- company from its stored pichin_business_type, so companies wrongly
-- stamped 'Construction' by the old catch-all pick up the correct industry
-- now, without needing to wait for their next login/onboarding sync (which
-- would fix them anyway, since it re-runs this function).
UPDATE public.cmms_company_profiles cp
SET industry = (t.arch ->> 'industry')::cmms_industry_type,
    architecture = t.arch,
    updated_at = now()
FROM LATERAL (SELECT public.cmms_business_type_architecture(cp.pichin_business_type) AS arch) t
WHERE cp.pichin_business_profile_id IS NOT NULL
  AND cp.industry IS DISTINCT FROM (t.arch ->> 'industry')::cmms_industry_type;

NOTIFY pgrst, 'reload schema';

SELECT 'Industry defaults fixed: unmatched Pichin business categories now map to Other instead of Construction' AS status;
