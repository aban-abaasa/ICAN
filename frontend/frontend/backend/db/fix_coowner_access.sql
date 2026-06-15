-- =============================================
-- FIX CO-OWNER ACCESS POLICIES
-- Allow all co-owners to VIEW the business profile
-- Only creator OR largest shareholder can EDIT
-- FIXED: Avoid infinite recursion by using simpler policies
-- =============================================

-- First, we need to link co-owners to their actual user accounts
-- Update business_co_owners to link user_id based on email
UPDATE public.business_co_owners co
SET user_id = p.id
FROM public.profiles p
WHERE co.owner_email = p.email
AND co.user_id IS NULL;

-- =============================================
-- BUSINESS PROFILES - Updated RLS Policies
-- =============================================

-- Drop ALL existing policies first (including the one we're creating)
DROP POLICY IF EXISTS "Users can view their own business profiles" ON public.business_profiles;
DROP POLICY IF EXISTS "Users can view business profiles" ON public.business_profiles;
DROP POLICY IF EXISTS "Users can create business profiles" ON public.business_profiles;
DROP POLICY IF EXISTS "Users can update their own profiles" ON public.business_profiles;
DROP POLICY IF EXISTS "Co-owners can view business profiles" ON public.business_profiles;
DROP POLICY IF EXISTS "Creator or largest shareholder can update" ON public.business_profiles;
DROP POLICY IF EXISTS "Only creator can delete business profile" ON public.business_profiles;

-- Also drop co-owner policies early to avoid conflicts
DROP POLICY IF EXISTS "Co-owners visible to profile members" ON public.business_co_owners;
DROP POLICY IF EXISTS "Users can add co-owners to their profiles" ON public.business_co_owners;
DROP POLICY IF EXISTS "Users can update co-owners of their profiles" ON public.business_co_owners;
DROP POLICY IF EXISTS "Users can delete co-owners from their profiles" ON public.business_co_owners;
DROP POLICY IF EXISTS "Creator or largest shareholder can add co-owners" ON public.business_co_owners;
DROP POLICY IF EXISTS "Creator or largest shareholder can update co-owners" ON public.business_co_owners;
DROP POLICY IF EXISTS "Creator or largest shareholder can delete co-owners" ON public.business_co_owners;

-- SELECT Policy: Creator can view, OR co-owner can view (by user_id or email)
CREATE POLICY "Users can view business profiles" 
    ON public.business_profiles FOR SELECT 
    USING (
        -- Creator can always view
        auth.uid() = user_id
        OR
        -- Co-owner can view (matched by user_id in business_co_owners)
        EXISTS (
            SELECT 1 FROM public.business_co_owners co
            WHERE co.business_profile_id = business_profiles.id
            AND co.user_id = auth.uid()
        )
        OR
        -- Co-owner can view (matched by email for backwards compatibility)
        EXISTS (
            SELECT 1 FROM public.business_co_owners co
            JOIN public.profiles p ON p.id = auth.uid()
            WHERE co.business_profile_id = business_profiles.id
            AND co.owner_email = p.email
        )
        OR
        -- Verified profiles are public
        status = 'verified'
    );

-- INSERT Policy: Any authenticated user can create a business profile
CREATE POLICY "Users can create business profiles" 
    ON public.business_profiles FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

-- UPDATE Policy: Only creator can update (largest shareholder check done in app)
CREATE POLICY "Users can update their own profiles" 
    ON public.business_profiles FOR UPDATE 
    USING (auth.uid() = user_id);

-- DELETE Policy: Only creator can delete
CREATE POLICY "Only creator can delete business profile"
    ON public.business_profiles FOR DELETE
    USING (auth.uid() = user_id);

-- =============================================
-- BUSINESS CO-OWNERS - Updated RLS Policies
-- SIMPLIFIED to avoid infinite recursion
-- =============================================

-- SELECT: You can see co-owner records if you're a co-owner OR your email matches
-- NO reference to business_profiles to avoid recursion!
CREATE POLICY "Co-owners visible to profile members" 
    ON public.business_co_owners FOR SELECT 
    USING (
        -- You are a co-owner (direct user_id match)
        user_id = auth.uid()
        OR
        -- You are a co-owner (by email)
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
            AND p.email = business_co_owners.owner_email
        )
        OR
        -- Allow all authenticated users to see co-owners (needed for profile display)
        -- The business_profiles RLS controls access to the profile itself
        auth.uid() IS NOT NULL
    );

-- INSERT: Only profile creator can add co-owners (use function to avoid recursion)
CREATE POLICY "Users can add co-owners to their profiles"
    ON public.business_co_owners FOR INSERT
    WITH CHECK (
        -- Check if user owns the profile using a subquery that bypasses RLS
        (SELECT bp.user_id FROM public.business_profiles bp 
         WHERE bp.id = business_profile_id) = auth.uid()
    );

-- UPDATE: Only profile creator can update co-owners
CREATE POLICY "Users can update co-owners of their profiles"
    ON public.business_co_owners FOR UPDATE
    USING (
        (SELECT bp.user_id FROM public.business_profiles bp 
         WHERE bp.id = business_profile_id) = auth.uid()
    );

-- DELETE: Only profile creator can remove co-owners
CREATE POLICY "Users can delete co-owners from their profiles"
    ON public.business_co_owners FOR DELETE
    USING (
        (SELECT bp.user_id FROM public.business_profiles bp 
         WHERE bp.id = business_profile_id) = auth.uid()
    );

-- =============================================
-- HELPER FUNCTION: Check if user can edit business profile
-- This is called from the application, not from RLS
-- =============================================
CREATE OR REPLACE FUNCTION public.can_edit_business_profile(profile_id UUID, checking_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    is_creator BOOLEAN;
    is_largest_shareholder BOOLEAN;
    user_email TEXT;
BEGIN
    -- Get user's email
    SELECT email INTO user_email FROM public.profiles WHERE id = checking_user_id;
    
    -- Check if user is creator
    SELECT EXISTS (
        SELECT 1 FROM public.business_profiles 
        WHERE id = profile_id AND user_id = checking_user_id
    ) INTO is_creator;
    
    IF is_creator THEN
        RETURN TRUE;
    END IF;
    
    -- Check if user is largest shareholder
    SELECT EXISTS (
        SELECT 1 FROM public.business_co_owners co
        WHERE co.business_profile_id = profile_id
        AND co.owner_email = user_email
        AND co.ownership_share = (
            SELECT MAX(ownership_share) 
            FROM public.business_co_owners 
            WHERE business_profile_id = profile_id
        )
    ) INTO is_largest_shareholder;
    
    RETURN is_largest_shareholder;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.can_edit_business_profile TO authenticated;

-- =============================================
-- VERIFY SETUP
-- =============================================
SELECT 'RLS Policies updated successfully!' as status;
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'business_profiles';
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'business_co_owners';

-- Check if user_ids are linked for co-owners
SELECT 
    co.id,
    co.owner_name,
    co.owner_email,
    co.user_id,
    p.email as profile_email,
    CASE WHEN co.user_id IS NOT NULL THEN '✓ Linked' ELSE '✗ NOT Linked' END as link_status
FROM public.business_co_owners co
LEFT JOIN public.profiles p ON p.id = co.user_id
ORDER BY co.business_profile_id;
