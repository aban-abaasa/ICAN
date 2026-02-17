-- NUCLEAR RLS FIX - Disable, clear all, rebuild fresh

-- Step 1: Disable RLS to drop policies
ALTER TABLE ican_user_wallets DISABLE ROW LEVEL SECURITY;
ALTER TABLE ican_coin_blockchain_txs DISABLE ROW LEVEL SECURITY;

-- Step 2: Drop ALL policies (multiple names to catch everything)
DROP POLICY IF EXISTS "wallet_select" ON ican_user_wallets;
DROP POLICY IF EXISTS "wallet_insert" ON ican_user_wallets;
DROP POLICY IF EXISTS "wallet_update" ON ican_user_wallets;
DROP POLICY IF EXISTS "select_own_wallet" ON ican_user_wallets;
DROP POLICY IF EXISTS "insert_own_wallet" ON ican_user_wallets;
DROP POLICY IF EXISTS "update_own_wallet" ON ican_user_wallets;
DROP POLICY IF EXISTS "wallet_user_select" ON ican_user_wallets;
DROP POLICY IF EXISTS "wallet_user_insert" ON ican_user_wallets;
DROP POLICY IF EXISTS "wallet_user_update" ON ican_user_wallets;
DROP POLICY IF EXISTS "Users can view own wallets" ON ican_user_wallets;
DROP POLICY IF EXISTS "Users can insert own wallets" ON ican_user_wallets;
DROP POLICY IF EXISTS "Users can update own wallets" ON ican_user_wallets;
DROP POLICY IF EXISTS "ican_wallet_select" ON ican_user_wallets;
DROP POLICY IF EXISTS "ican_wallet_insert" ON ican_user_wallets;
DROP POLICY IF EXISTS "ican_wallet_update" ON ican_user_wallets;
DROP POLICY IF EXISTS "Enable SELECT for users" ON ican_user_wallets;
DROP POLICY IF EXISTS "Enable INSERT for users" ON ican_user_wallets;
DROP POLICY IF EXISTS "Enable UPDATE for users" ON ican_user_wallets;
DROP POLICY IF EXISTS "insert_own_wallet" ON ican_user_wallets;

DROP POLICY IF EXISTS "blockchain_select" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "blockchain_insert" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "txs_user_select" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "txs_user_insert" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "Select own transactions" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "Insert own transactions" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "Users can view own transactions" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "Users can insert own transactions" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "ican_coin_blockchain_txs_select" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "ican_coin_blockchain_txs_insert" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "Enable SELECT transactions" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "Enable INSERT transactions" ON ican_coin_blockchain_txs;

-- Step 3: Re-enable RLS and create FRESH policies
ALTER TABLE ican_user_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ican_coin_blockchain_txs ENABLE ROW LEVEL SECURITY;

-- Create policies with type casting (UUID to text) for safety
CREATE POLICY "ican_wallet_select_v2" ON ican_user_wallets
  FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "ican_wallet_insert_v2" ON ican_user_wallets
  FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "ican_wallet_update_v2" ON ican_user_wallets
  FOR UPDATE USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "ican_txs_select_v2" ON ican_coin_blockchain_txs
  FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "ican_txs_insert_v2" ON ican_coin_blockchain_txs
  FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

-- Step 4: Ensure permissions
GRANT SELECT, INSERT, UPDATE ON ican_user_wallets TO authenticated;
GRANT SELECT, INSERT ON ican_coin_blockchain_txs TO authenticated;

SELECT 'SUCCESS: RLS completely rebuilt with v2 policies' as status;
