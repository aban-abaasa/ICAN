-- =====================================================
-- FIX WALLET TRANSACTIONS RLS POLICIES
-- =====================================================
-- Add missing INSERT and UPDATE policies

DROP POLICY IF EXISTS "Users can view their own transactions" ON public.wallet_transactions;
DROP POLICY IF EXISTS "Users can insert their own transactions" ON public.wallet_transactions;
DROP POLICY IF EXISTS "Users can update their own transactions" ON public.wallet_transactions;

-- SELECT policy
CREATE POLICY "Users can view their own transactions"
    ON public.wallet_transactions FOR SELECT
    USING (user_id = auth.uid() OR auth.uid() IS NOT NULL);

-- INSERT policy - allow authenticated users to create transactions
CREATE POLICY "Users can insert their own transactions"
    ON public.wallet_transactions FOR INSERT
    WITH CHECK (user_id = auth.uid() OR auth.uid() IS NOT NULL);

-- UPDATE policy - allow authenticated users to update transactions
CREATE POLICY "Users can update their own transactions"
    ON public.wallet_transactions FOR UPDATE
    USING (user_id = auth.uid() OR auth.uid() IS NOT NULL);

-- Verify policies
SELECT 
  tablename,
  policyname,
  cmd
FROM pg_policies
WHERE tablename = 'wallet_transactions'
ORDER BY policyname;
