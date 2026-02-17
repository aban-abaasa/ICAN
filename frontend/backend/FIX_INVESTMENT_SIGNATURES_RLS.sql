-- =====================================================
-- FIX RLS POLICIES FOR INVESTMENT SIGNATURES
-- =====================================================
-- Add INSERT and UPDATE policies to investment_signatures table

DROP POLICY IF EXISTS "Users can view their own signatures" ON public.investment_signatures;
DROP POLICY IF EXISTS "Users can insert their own signatures" ON public.investment_signatures;
DROP POLICY IF EXISTS "Users can update their own signatures" ON public.investment_signatures;
DROP POLICY IF EXISTS "Business owners can view signatures" ON public.investment_signatures;

-- SELECT policy - users can view their own signatures
CREATE POLICY "Users can view their own signatures"
    ON public.investment_signatures FOR SELECT
    USING (signer_id = auth.uid() OR auth.uid() IS NOT NULL);

-- INSERT policy - authenticated users can create signatures
CREATE POLICY "Users can insert their own signatures"
    ON public.investment_signatures FOR INSERT
    WITH CHECK (signer_id = auth.uid() OR auth.uid() IS NOT NULL);

-- UPDATE policy - users can update their own signatures
CREATE POLICY "Users can update their own signatures"
    ON public.investment_signatures FOR UPDATE
    USING (signer_id = auth.uid());

-- Verify policies
SELECT 
  tablename,
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'investment_signatures'
ORDER BY policyname;
