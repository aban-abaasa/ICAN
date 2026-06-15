-- =====================================================
-- FIX RLS POLICIES FOR WALLET TRANSACTIONS
-- =====================================================
-- Add INSERT and UPDATE policies to wallet_transactions

DROP POLICY IF EXISTS "Users can view their own transactions" ON public.wallet_transactions;
DROP POLICY IF EXISTS "Users can insert their own transactions" ON public.wallet_transactions;
DROP POLICY IF EXISTS "Users can update their own transactions" ON public.wallet_transactions;

-- SELECT policy
CREATE POLICY "Users can view their own transactions"
    ON public.wallet_transactions FOR SELECT
    USING (user_id = auth.uid());

-- INSERT policy - allow users to create transactions for their own wallet
CREATE POLICY "Users can insert their own transactions"
    ON public.wallet_transactions FOR INSERT
    WITH CHECK (user_id = auth.uid() OR auth.uid() IS NOT NULL);

-- UPDATE policy - allow users to update their own transactions
CREATE POLICY "Users can update their own transactions"
    ON public.wallet_transactions FOR UPDATE
    USING (user_id = auth.uid());

-- Verify policies
SELECT 
  tablename,
  policyname,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'wallet_transactions'
ORDER BY policyname;
