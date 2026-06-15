-- Fix Pitches RLS Policies - Add missing INSERT and UPDATE policies

-- Drop existing policies first
DROP POLICY IF EXISTS "Anyone can view published pitches" ON public.pitches;
DROP POLICY IF EXISTS "Profile owners can view their own pitches" ON public.pitches;
DROP POLICY IF EXISTS "Users can create pitches for their business profiles" ON public.pitches;
DROP POLICY IF EXISTS "Users can update their own pitches" ON public.pitches;
DROP POLICY IF EXISTS "Users can delete their own pitches" ON public.pitches;

-- SELECT: Anyone can view published pitches
CREATE POLICY "Anyone can view published pitches" 
    ON public.pitches FOR SELECT 
    USING (status = 'published' OR status = 'active');

-- SELECT: Profile owners can view their own pitches (draft, published, etc)
CREATE POLICY "Profile owners can view their own pitches" 
    ON public.pitches FOR SELECT 
    USING (
        EXISTS (
            SELECT 1 FROM public.business_profiles bp
            WHERE bp.id = pitches.business_profile_id
            AND bp.user_id = auth.uid()
        )
    );

-- INSERT: Users can create pitches for their business profiles
CREATE POLICY "Users can create pitches for their business profiles" 
    ON public.pitches FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.business_profiles bp
            WHERE bp.id = business_profile_id
            AND bp.user_id = auth.uid()
        )
    );

-- UPDATE: Users can update their own pitches
CREATE POLICY "Users can update their own pitches" 
    ON public.pitches FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.business_profiles bp
            WHERE bp.id = pitches.business_profile_id
            AND bp.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.business_profiles bp
            WHERE bp.id = business_profile_id
            AND bp.user_id = auth.uid()
        )
    );

-- DELETE: Users can delete their own pitches
CREATE POLICY "Users can delete their own pitches" 
    ON public.pitches FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.business_profiles bp
            WHERE bp.id = pitches.business_profile_id
            AND bp.user_id = auth.uid()
        )
    );
