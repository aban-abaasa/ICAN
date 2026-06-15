-- ============================================================
-- FIX: CMMS Companies Table Sync
-- ============================================================
-- Problem: New companies are created in cmms_company_profiles
--          but messages require them to exist in cmms_companies
-- Solution: Sync both tables and add auto-sync trigger
-- ============================================================

-- Step 1: Ensure cmms_companies table exists with proper structure
-- ============================================================
-- Note: Keeping minimal structure to match existing table created by messaging system
CREATE TABLE IF NOT EXISTS public.cmms_companies (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_cmms_companies_name ON public.cmms_companies(name);

-- Step 2: Sync existing companies from cmms_company_profiles to cmms_companies
-- ============================================================
-- Only sync id, name, and created_at to match the minimal structure
INSERT INTO public.cmms_companies (id, name, created_at)
SELECT 
  id,
  company_name,
  created_at
FROM public.cmms_company_profiles
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name;

-- Step 3: Create trigger function to auto-sync new companies
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_sync_company_to_cmms_companies()
RETURNS TRIGGER AS $$
BEGIN
  -- On INSERT: Add to cmms_companies (minimal structure: id, name, created_at)
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.cmms_companies (id, name, created_at)
    VALUES (NEW.id, NEW.company_name, NEW.created_at)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
  END IF;
  
  -- On UPDATE: Update name in cmms_companies
  IF TG_OP = 'UPDATE' THEN
    UPDATE public.cmms_companies
    SET name = NEW.company_name
    WHERE id = NEW.id;
    RETURN NEW;
  END IF;
  
  -- On DELETE: Delete from cmms_companies
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.cmms_companies WHERE id = OLD.id;
    RETURN OLD;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Create trigger on cmms_company_profiles
-- ============================================================
DROP TRIGGER IF EXISTS trg_sync_company_to_cmms_companies ON public.cmms_company_profiles;

CREATE TRIGGER trg_sync_company_to_cmms_companies
  AFTER INSERT OR UPDATE OR DELETE ON public.cmms_company_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_company_to_cmms_companies();

-- Step 5: Verify the sync
-- ============================================================
DO $$
DECLARE
  v_profile_count INT;
  v_companies_count INT;
  v_synced_count INT;
BEGIN
  SELECT COUNT(*) INTO v_profile_count FROM public.cmms_company_profiles;
  SELECT COUNT(*) INTO v_companies_count FROM public.cmms_companies;
  
  SELECT COUNT(*) INTO v_synced_count 
  FROM public.cmms_company_profiles cp
  INNER JOIN public.cmms_companies cc ON cp.id = cc.id;
  
  RAISE NOTICE '================================================';
  RAISE NOTICE 'CMMS Companies Sync Summary:';
  RAISE NOTICE '================================================';
  RAISE NOTICE 'Companies in cmms_company_profiles: %', v_profile_count;
  RAISE NOTICE 'Companies in cmms_companies: %', v_companies_count;
  RAISE NOTICE 'Successfully synced: %', v_synced_count;
  RAISE NOTICE '================================================';
  
  IF v_synced_count = v_profile_count THEN
    RAISE NOTICE '✅ All companies synced successfully!';
  ELSE
    RAISE WARNING '⚠️ Some companies may not be synced. Check manually.';
  END IF;
END $$;

-- Step 6: Grant permissions
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cmms_companies TO authenticated;
GRANT SELECT ON public.cmms_companies TO anon;

-- ============================================================
-- DEPLOYMENT INSTRUCTIONS:
-- ============================================================
-- 1. Run this script in your Supabase SQL Editor
-- 2. Verify the sync summary output
-- 3. Test message sending with newly registered companies
-- 4. Monitor for any sync issues
-- ============================================================

COMMENT ON TABLE public.cmms_companies IS 'Synced copy of company data for messaging system. Auto-synced from cmms_company_profiles via trigger.';
COMMENT ON TRIGGER trg_sync_company_to_cmms_companies ON public.cmms_company_profiles IS 'Auto-syncs company data to cmms_companies table for messaging system compatibility.';
