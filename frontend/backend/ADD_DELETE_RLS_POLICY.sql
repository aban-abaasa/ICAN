-- ============================================
-- ADD MISSING DELETE RLS POLICY
-- ============================================
-- Problem: ican_transactions table was missing a DELETE RLS policy
-- Result: DELETE queries executed without error but didn't actually delete records
-- Solution: Add DELETE policy allowing users to delete their own transactions

-- Drop the old policy if it exists
DROP POLICY IF EXISTS "Users can delete their own transactions" ON public.ican_transactions;

-- Create DELETE policy
CREATE POLICY "Users can delete their own transactions" 
    ON public.ican_transactions FOR DELETE 
    USING (auth.uid() = user_id);

-- Verify policies are now complete
-- Query to check all policies on ican_transactions:
-- SELECT schemaname, tablename, policyname, permissive, roles, qual, with_check
-- FROM pg_policies 
-- WHERE tablename = 'ican_transactions'
-- ORDER BY policyname;

-- Expected result after this script runs:
-- - SELECT policy: Users can view their own transactions
-- - INSERT policy: Users can create their own transactions
-- - UPDATE policy: Users can update their own pending transactions
-- - DELETE policy: Users can delete their own transactions (NEW)

COMMIT;
