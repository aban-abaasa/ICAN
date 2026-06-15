-- Fix Pitches RLS - Free to VIEW, restricted to CREATE/UPDATE/DELETE
-- Run this in Supabase SQL Editor

-- Drop ALL existing policies on pitches to start fresh
DROP POLICY IF EXISTS "Anyone can view published pitches" ON public.pitches;
DROP POLICY IF EXISTS "Profile owners can view their own pitches" ON public.pitches;
DROP POLICY IF EXISTS "Users can create pitches for their business profiles" ON public.pitches;
DROP POLICY IF EXISTS "Users can update their own pitches" ON public.pitches;
DROP POLICY IF EXISTS "Users can delete their own pitches" ON public.pitches;
DROP POLICY IF EXISTS "Co-owners can view pitches" ON public.pitches;
DROP POLICY IF EXISTS "Co-owners can create pitches" ON public.pitches;
DROP POLICY IF EXISTS "Public can view published pitches" ON public.pitches;
DROP POLICY IF EXISTS "Free public view pitches" ON public.pitches;

-- Make sure RLS is enabled
ALTER TABLE public.pitches ENABLE ROW LEVEL SECURITY;

-- =============================================
-- SELECT POLICY - FREE FOR ALL
-- =============================================

-- 🔓 ANYONE can view ALL published pitches - no authentication required
CREATE POLICY "Free public view pitches" 
    ON public.pitches FOR SELECT 
    USING (true);  -- Allow ALL reads, status filter done in frontend

-- =============================================
-- INSERT POLICY - RESTRICTED
-- =============================================

-- Only authenticated users can create pitches for their own profiles
CREATE POLICY "Users can create pitches for their business profiles" 
    ON public.pitches FOR INSERT
    WITH CHECK (
        auth.uid() IS NOT NULL AND (
            -- Owner check
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
        )
    );

-- =============================================
-- UPDATE POLICY - RESTRICTED
-- =============================================

-- Only owners/co-owners can update their pitches
CREATE POLICY "Users can update their own pitches" 
    ON public.pitches FOR UPDATE
    USING (
        auth.uid() IS NOT NULL AND (
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
    );

-- =============================================
-- DELETE POLICY - RESTRICTED
-- =============================================

-- Only profile owner can delete pitches
CREATE POLICY "Users can delete their own pitches" 
    ON public.pitches FOR DELETE
    USING (
        auth.uid() IS NOT NULL AND
        (SELECT bp.user_id FROM public.business_profiles bp 
         WHERE bp.id = pitches.business_profile_id) = auth.uid()
    );

-- =============================================
-- VERIFY
-- =============================================
SELECT '✅ Pitches: FREE to view, RESTRICTED to create/edit/delete!' as status;
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'pitches';
