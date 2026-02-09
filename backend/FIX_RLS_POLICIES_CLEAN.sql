-- CLEAN RLS POLICY REBUILD - Drop existing policies and rebuild fresh

-- ===== STEP 1: DROP ALL EXISTING POLICIES =====
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

DROP POLICY IF EXISTS "ican_txs_select" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "ican_txs_insert" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "Select own transactions" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "Insert own transactions" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "Users can view own transactions" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "Users can insert own transactions" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "ican_coin_blockchain_txs_select" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "ican_coin_blockchain_txs_insert" ON ican_coin_blockchain_txs;

-- ===== STEP 2: RECREATE POLICIES WITH FRESH NAMES =====

-- Policies for ican_user_wallets
CREATE POLICY "wallet_user_select" ON ican_user_wallets
  FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "wallet_user_insert" ON ican_user_wallets
  FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "wallet_user_update" ON ican_user_wallets
  FOR UPDATE USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- Policies for ican_coin_blockchain_txs
CREATE POLICY "txs_user_select" ON ican_coin_blockchain_txs
  FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "txs_user_insert" ON ican_coin_blockchain_txs
  FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

-- ===== STEP 3: ENSURE PROPER PERMISSIONS =====
GRANT SELECT, INSERT, UPDATE ON ican_user_wallets TO authenticated;
GRANT SELECT, INSERT ON ican_coin_blockchain_txs TO authenticated;

-- Verification
SELECT 'RLS policies successfully rebuilt' as status;
SELECT 'ican_user_wallets: SELECT, INSERT, UPDATE enabled' as wallet_permissions;
SELECT 'ican_coin_blockchain_txs: SELECT, INSERT enabled' as txs_permissions;