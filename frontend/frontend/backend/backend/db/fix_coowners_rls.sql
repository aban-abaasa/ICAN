-- =============================================
-- Fix Business Co-Owners RLS Policies
-- =============================================
-- Problem: INSERT/UPDATE blocked by RLS
-- Solution: Add proper policies for co-owner management

-- Step 1: Drop existing policies to ensure clean slate
DROP POLICY IF EXISTS "Co-owners visible to profile members" ON public.business_co_owners;
DROP POLICY IF EXISTS "Users can add co-owners to their profiles" ON public.business_co_owners;
DROP POLICY IF EXISTS "Users can update co-owners of their profiles" ON public.business_co_owners;
DROP POLICY IF EXISTS "Users can delete co-owners from their profiles" ON public.business_co_owners;

-- Step 2: Ensure RLS is enabled
ALTER TABLE public.business_co_owners ENABLE ROW LEVEL SECURITY;

-- Step 3: SELECT policy - Users can see co-owners of their own profiles
CREATE POLICY "Co-owners visible to profile members"
    ON public.business_co_owners FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.business_profiles bp
            WHERE bp.id = business_co_owners.business_profile_id
            AND bp.user_id = auth.uid()
        )
    );

-- Step 4: INSERT policy - Users can add co-owners to their own profiles
CREATE POLICY "Users can add co-owners to their profiles"
    ON public.business_co_owners FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.business_profiles bp
            WHERE bp.id = business_co_owners.business_profile_id
            AND bp.user_id = auth.uid()
        )
    );

-- Step 5: UPDATE policy - Users can update co-owners of their own profiles
CREATE POLICY "Users can update co-owners of their profiles"
    ON public.business_co_owners FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.business_profiles bp
            WHERE bp.id = business_co_owners.business_profile_id
            AND bp.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.business_profiles bp
            WHERE bp.id = business_co_owners.business_profile_id
            AND bp.user_id = auth.uid()
        )
    );

-- Step 6: DELETE policy - Users can remove co-owners from their own profiles
CREATE POLICY "Users can delete co-owners from their profiles"
    ON public.business_co_owners FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.business_profiles bp
            WHERE bp.id = business_co_owners.business_profile_id
            AND bp.user_id = auth.uid()
        )
    );

-- =============================================
-- VERIFICATION CHECKLIST
-- =============================================
-- 1. Go to Supabase Dashboard → SQL Editor
-- 2. Copy and paste this entire script
-- 3. Click "Run" button
-- 4. Go to Supabase Dashboard → Database → business_co_owners table
-- 5. Click on "RLS" (under Authentication section)
-- 6. You should see 4 policies:
--    ✓ Co-owners visible to profile members (SELECT)
--    ✓ Users can add co-owners to their profiles (INSERT)
--    ✓ Users can update co-owners of their profiles (UPDATE)
--    ✓ Users can delete co-owners from their profiles (DELETE)
--
-- =============================================
-- TESTING
-- =============================================
-- 1. Go to frontend
-- 2. Create a new business profile
-- 3. Add 2 co-owners
-- 4. Click "Create Business Profile"
-- 5. Check browser console - should see:
--    ✅ Saved 2 co-owners successfully
-- 6. Check Supabase → business_co_owners table
-- 7. Should show the 2 new co-owner records with:
--    - owner_name, owner_email, ownership_share populated
--    - business_profile_id linked correctly
--
-- =============================================
-- HOW IT WORKS
-- =============================================
-- The policies use EXISTS to check:
-- 1. Is there a business_profile with this ID?
-- 2. Does that profile's user_id match the current user (auth.uid())?
-- 3. If both true, allow the operation
--
-- This ensures:
-- ✓ Users can only manage co-owners of THEIR OWN profiles
-- ✓ Users cannot modify other users' co-owners
-- ✓ Profile creators control the co-owner list
-- ✓ Security is maintained without blocking legitimate operations
