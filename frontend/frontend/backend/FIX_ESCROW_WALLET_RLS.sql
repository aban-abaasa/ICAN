-- =====================================================
-- FIX ESCROW WALLET RLS POLICY
-- =====================================================
-- Allow all authenticated users to read escrow wallet

DROP POLICY IF EXISTS "Allow reading escrow wallet" ON public.user_wallets;

CREATE POLICY "Allow reading escrow wallet"
    ON public.user_wallets FOR SELECT
    USING (account_type = 'escrow' OR user_id = auth.uid());

-- Verify policy
SELECT 
  tablename,
  policyname,
  cmd
FROM pg_policies
WHERE tablename = 'user_wallets'
ORDER BY policyname;
