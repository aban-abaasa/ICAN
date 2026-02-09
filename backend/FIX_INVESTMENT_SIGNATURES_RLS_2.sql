-- =====================================================
-- FIX INVESTMENT_SIGNATURES RLS POLICY
-- =====================================================
-- Add INSERT policy for investment_signatures

DROP POLICY IF EXISTS "Users can view their own signatures" ON public.investment_signatures;
DROP POLICY IF EXISTS "Users can insert their own signatures" ON public.investment_signatures;
DROP POLICY IF EXISTS "Users can update their own signatures" ON public.investment_signatures;

-- SELECT policy
CREATE POLICY "Users can view their own signatures"
    ON public.investment_signatures FOR SELECT
    USING (signer_id = auth.uid() OR auth.uid() IS NOT NULL);

-- INSERT policy - allow authenticated users to create signatures
CREATE POLICY "Users can insert their own signatures"
    ON public.investment_signatures FOR INSERT
    WITH CHECK (signer_id = auth.uid() OR auth.uid() IS NOT NULL);

-- UPDATE policy - allow authenticated users to update signatures
CREATE POLICY "Users can update their own signatures"
    ON public.investment_signatures FOR UPDATE
    USING (signer_id = auth.uid() OR auth.uid() IS NOT NULL);

-- Verify policies
SELECT 
  tablename,
  policyname,
  cmd
FROM pg_policies
WHERE tablename = 'investment_signatures'
ORDER BY policyname;
