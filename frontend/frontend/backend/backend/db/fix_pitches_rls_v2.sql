-- Fix Pitches RLS Policies - Simplified to avoid recursion issues
-- Run this in Supabase SQL Editor

-- Drop ALL existing policies on pitches
DROP POLICY IF EXISTS "Anyone can view published pitches" ON public.pitches;
DROP POLICY IF EXISTS "Profile owners can view their own pitches" ON public.pitches;
DROP POLICY IF EXISTS "Users can create pitches for their business profiles" ON public.pitches;
DROP POLICY IF EXISTS "Users can update their own pitches" ON public.pitches;
DROP POLICY IF EXISTS "Users can delete their own pitches" ON public.pitches;
DROP POLICY IF EXISTS "Co-owners can view pitches" ON public.pitches;
DROP POLICY IF EXISTS "Co-owners can create pitches" ON public.pitches;

-- Make sure RLS is enabled
ALTER TABLE public.pitches ENABLE ROW LEVEL SECURITY;

-- =============================================
-- SELECT POLICIES
-- =============================================

-- Anyone can view published pitches
CREATE POLICY "Anyone can view published pitches" 
    ON public.pitches FOR SELECT 
    USING (status = 'published' OR status = 'active');

-- Profile owners can view their own pitches using direct subquery (avoids RLS recursion)
CREATE POLICY "Profile owners can view their own pitches" 
    ON public.pitches FOR SELECT 
    USING (
        (SELECT bp.user_id FROM public.business_profiles bp 
         WHERE bp.id = pitches.business_profile_id) = auth.uid()
    );

-- Co-owners can view pitches for profiles they co-own
CREATE POLICY "Co-owners can view pitches" 
    ON public.pitches FOR SELECT 
    USING (
        EXISTS (
            SELECT 1 FROM public.business_co_owners co
            WHERE co.business_profile_id = pitches.business_profile_id
            AND (co.user_id = auth.uid() OR co.owner_email = (
                SELECT email FROM public.profiles WHERE id = auth.uid()
            ))
        )
    );

-- =============================================
-- INSERT POLICY
-- =============================================

-- Users can create pitches for profiles they own OR co-own
CREATE POLICY "Users can create pitches for their business profiles" 
    ON public.pitches FOR INSERT
    WITH CHECK (
        -- Owner check using direct subquery
        (SELECT bp.user_id FROM public.business_profiles bp 
         WHERE bp.id = business_profile_id) = auth.uid()
        OR
        -- Co-owner check
        EXISTS (
            SELECT 1 FROM public.business_co_owners co
            WHERE co.business_profile_id = business_profile_id
            AND (co.user_id = auth.uid() OR co.owner_email = (
                SELECT email FROM public.profiles WHERE id = auth.uid()
            ))
        )
    );

-- =============================================
-- UPDATE POLICY
-- =============================================

-- Users can update pitches for their business profiles
CREATE POLICY "Users can update their own pitches" 
    ON public.pitches FOR UPDATE
    USING (
        (SELECT bp.user_id FROM public.business_profiles bp 
         WHERE bp.id = pitches.business_profile_id) = auth.uid()
        OR
        EXISTS (
            SELECT 1 FROM public.business_co_owners co
            WHERE co.business_profile_id = pitches.business_profile_id
            AND (co.user_id = auth.uid() OR co.owner_email = (
                SELECT email FROM public.profiles WHERE id = auth.uid()
            ))
        )
    )
    WITH CHECK (
        (SELECT bp.user_id FROM public.business_profiles bp 
         WHERE bp.id = business_profile_id) = auth.uid()
        OR
        EXISTS (
            SELECT 1 FROM public.business_co_owners co
            WHERE co.business_profile_id = business_profile_id
            AND (co.user_id = auth.uid() OR co.owner_email = (
                SELECT email FROM public.profiles WHERE id = auth.uid()
            ))
        )
    );

-- =============================================
-- DELETE POLICY
-- =============================================

-- Only profile owner can delete pitches (not co-owners)
CREATE POLICY "Users can delete their own pitches" 
    ON public.pitches FOR DELETE
    USING (
        (SELECT bp.user_id FROM public.business_profiles bp 
         WHERE bp.id = pitches.business_profile_id) = auth.uid()
    );

-- =============================================
-- VERIFY
-- =============================================
SELECT 'Pitches RLS policies updated!' as status;
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'pitches';
