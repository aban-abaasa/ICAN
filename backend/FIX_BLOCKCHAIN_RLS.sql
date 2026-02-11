-- =============================================
-- FIX: ICAN COIN BLOCKCHAIN TXS RLS POLICY
-- Run this if you get 403 Forbidden errors when recording transactions
-- =============================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own transactions" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "Users can insert own transactions" ON ican_coin_blockchain_txs;

-- Disable RLS temporarily to ensure the table works
ALTER TABLE ican_coin_blockchain_txs DISABLE ROW LEVEL SECURITY;

-- Re-enable RLS
ALTER TABLE ican_coin_blockchain_txs ENABLE ROW LEVEL SECURITY;

-- Create new, cleaner policies
-- SELECT: Users can view their own transaction records
CREATE POLICY "blockchain_select" ON ican_coin_blockchain_txs
  FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT: Users can insert their own transaction records
CREATE POLICY "blockchain_insert" ON ican_coin_blockchain_txs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: Users can update their own records (for status updates)
CREATE POLICY "blockchain_update" ON ican_coin_blockchain_txs
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Grant permissions to authenticated users
GRANT SELECT, INSERT, UPDATE ON ican_coin_blockchain_txs TO authenticated;

-- Verify policies are set
SELECT 
  'ican_coin_blockchain_txs' as table_name,
  schemaname,
  tablename,
  policyname,
  qual as policy_condition
FROM pg_policies 
WHERE tablename = 'ican_coin_blockchain_txs'
ORDER BY policyname;

SELECT '✅ Blockchain transactions RLS fixed!' as status;
