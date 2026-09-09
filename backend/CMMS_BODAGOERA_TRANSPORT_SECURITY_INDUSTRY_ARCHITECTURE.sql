-- Fix: BodaGoEra's two Pichin category templates (transport_company,
-- security_escort — CREATE_BODAGOERA_BUSINESS_CATEGORIES_AND_REGISTRATION.sql
-- in the mybodaguy repo) were never added to
-- cmms_business_type_architecture()'s keyword match, so both fell through to
-- the generic 'Other' catch-all (CMMS_FIX_INDUSTRY_DEFAULT_STEP2_FIX_
-- FUNCTION_AND_BACKFILL.sql) instead of a fitting industry/department set.
-- This does NOT explain a difference in CMMS *access* between the two
-- categories — cmms_ensure_pichin_business_access() and the auto-provision
-- pass in CMSSModule.jsx (loadCMMSData) apply to every Pichin business a
-- user owns regardless of category — it only explains why both showed up
-- generically labeled instead of correctly.
--
-- Run after CMMS_FIX_INDUSTRY_DEFAULT_STEP2_FIX_FUNCTION_AND_BACKFILL.sql
-- (needs the 'Other' enum value that STEP 1/STEP 2 pair already added).
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
    WHEN lower(coalesce(p_business_type, '')) IN ('transport', 'transportation', 'logistics', 'fleet', 'delivery', 'transport_company') THEN
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
    -- No dedicated 'Security' industry exists in cmms_industry_type (adding
    -- one needs its own STEP1/STEP2 pair, same as 'Other' — Postgres won't
    -- let a new enum value be used in the same transaction that adds it).
    -- 'Other' with escort-specific departments is a real improvement over
    -- the generic catch-all without that extra migration.
    WHEN lower(coalesce(p_business_type, '')) IN ('security_escort', 'security', 'escort') THEN
      jsonb_build_object('industry', 'Other', 'departments', jsonb_build_array('Operations', 'Personnel', 'Dispatch', 'Finance'))
    ELSE
      jsonb_build_object('industry', 'Other', 'departments', jsonb_build_array('Operations', 'Administration', 'Finance', 'Maintenance'))
  END;
$$;

-- Backfill: recompute industry + architecture for every already-linked CMMS
-- company from its stored pichin_business_type, so BodaGoEra businesses
-- created before this fix pick up the correct architecture immediately
-- instead of waiting for their next cmms_ensure_pichin_business_access()
-- call (e.g. next login).
UPDATE public.cmms_company_profiles cp
SET architecture = public.cmms_business_type_architecture(cp.pichin_business_type),
    updated_at = now()
WHERE cp.pichin_business_profile_id IS NOT NULL
  AND cp.pichin_business_type IN ('transport_company', 'security_escort')
  AND cp.architecture IS DISTINCT FROM public.cmms_business_type_architecture(cp.pichin_business_type);

NOTIFY pgrst, 'reload schema';

SELECT 'BodaGoEra transport_company / security_escort now map to a real CMMS industry/department set instead of the generic Other catch-all' AS status;
