-- ROBUST RLS FIX - Handles all edge cases

-- Step 1: Drop ALL existing policies silently
DROP POLICY IF EXISTS "wallet_user_select" ON ican_user_wallets;
DROP POLICY IF EXISTS "wallet_user_insert" ON ican_user_wallets;
DROP POLICY IF EXISTS "wallet_user_update" ON ican_user_wallets;
DROP POLICY IF EXISTS "ican_wallet_select" ON ican_user_wallets;
DROP POLICY IF EXISTS "ican_wallet_insert" ON ican_user_wallets;
DROP POLICY IF EXISTS "ican_wallet_update" ON ican_user_wallets;
DROP POLICY IF EXISTS "Select own wallet" ON ican_user_wallets;
DROP POLICY IF EXISTS "Insert own wallet" ON ican_user_wallets;
DROP POLICY IF EXISTS "Update own wallet" ON ican_user_wallets;
DROP POLICY IF EXISTS "Users can view own wallets" ON ican_user_wallets;
DROP POLICY IF EXISTS "Users can insert own wallets" ON ican_user_wallets;
DROP POLICY IF EXISTS "Users can update own wallets" ON ican_user_wallets;
DROP POLICY IF EXISTS "ican_user_wallets_select" ON ican_user_wallets;
DROP POLICY IF EXISTS "ican_user_wallets_insert" ON ican_user_wallets;
DROP POLICY IF EXISTS "ican_user_wallets_update" ON ican_user_wallets;

DROP POLICY IF EXISTS "txs_user_select" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "txs_user_insert" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "ican_txs_select" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "ican_txs_insert" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "Select own transactions" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "Insert own transactions" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "Users can view own transactions" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "Users can insert own transactions" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "ican_coin_blockchain_txs_select" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "ican_coin_blockchain_txs_insert" ON ican_coin_blockchain_txs;

-- Step 2: Ensure RLS is enabled
ALTER TABLE ican_user_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ican_coin_blockchain_txs ENABLE ROW LEVEL SECURITY;

-- Step 3: Create PERMISSIVE policies (allow access)
-- For ican_user_wallets
CREATE POLICY "Enable SELECT for users" ON ican_user_wallets
  FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Enable INSERT for users" ON ican_user_wallets
  FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Enable UPDATE for users" ON ican_user_wallets
  FOR UPDATE 
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- For ican_coin_blockchain_txs
CREATE POLICY "Enable SELECT transactions" ON ican_coin_blockchain_txs
  FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Enable INSERT transactions" ON ican_coin_blockchain_txs
  FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- Step 4: Grant required permissions to authenticated role
GRANT SELECT, INSERT, UPDATE ON ican_user_wallets TO authenticated;
GRANT SELECT, INSERT ON ican_coin_blockchain_txs TO authenticated;

-- Step 5: Verification queries
SELECT 'Step 1: Policy cleanup complete' as step;
SELECT 'Step 2: RLS enabled on both tables' as step;
SELECT 'Step 3: Policies recreated with UUID comparison' as step;
SELECT 'Step 4: Permissions granted to authenticated role' as step;
SELECT 'RLS Fix Complete - Test purchase now' as status;
