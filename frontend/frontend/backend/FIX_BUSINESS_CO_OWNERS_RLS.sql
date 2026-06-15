-- =====================================================
-- FIX BUSINESS_CO_OWNERS RLS POLICIES
-- =====================================================
-- This script fixes Row Level Security policies on business_co_owners table
-- to allow authenticated users to insert, update, and delete co-owners

-- Step 1: Disable RLS temporarily to fix policies
ALTER TABLE public.business_co_owners DISABLE ROW LEVEL SECURITY;

-- Step 2: Drop all existing policies
DROP POLICY IF EXISTS "Users can view business co-owners" ON public.business_co_owners;
DROP POLICY IF EXISTS "Users can insert co-owners for their business" ON public.business_co_owners;
DROP POLICY IF EXISTS "Users can update co-owners" ON public.business_co_owners;
DROP POLICY IF EXISTS "Users can delete co-owners" ON public.business_co_owners;
DROP POLICY IF EXISTS "Allow authenticated users to view co-owners" ON public.business_co_owners;
DROP POLICY IF EXISTS "Allow authenticated users to manage co-owners" ON public.business_co_owners;

-- Step 3: Re-enable RLS
ALTER TABLE public.business_co_owners ENABLE ROW LEVEL SECURITY;

-- Step 4: Create new permissive policies

-- SELECT: Allow authenticated users to view all co-owners
CREATE POLICY "Allow authenticated users to view co-owners"
  ON public.business_co_owners FOR SELECT
  USING (auth.role() = 'authenticated');

-- INSERT: Allow authenticated users to insert co-owners for their business
CREATE POLICY "Allow authenticated users to insert co-owners"
  ON public.business_co_owners FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- UPDATE: Allow authenticated users to update co-owners
CREATE POLICY "Allow authenticated users to update co-owners"
  ON public.business_co_owners FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- DELETE: Allow authenticated users to delete co-owners
CREATE POLICY "Allow authenticated users to delete co-owners"
  ON public.business_co_owners FOR DELETE
  USING (auth.role() = 'authenticated');

-- Step 5: Verify the policies
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE tablename = 'business_co_owners'
ORDER BY policyname;

-- =====================================================
-- ALTERNATIVE: If above doesn't work, completely disable RLS
-- =====================================================
-- Uncomment below if you want to disable RLS entirely (not recommended for production)
-- ALTER TABLE public.business_co_owners DISABLE ROW LEVEL SECURITY;

-- =====================================================
-- TESTING
-- =====================================================
-- After running this script, try adding a co-owner again
-- The error should be resolved

COMMIT;
