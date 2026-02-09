-- 🔧 COMPLETE RLS POLICY REBUILD
-- Remove all existing policies and rebuild from scratch

-- ===== DISABLE RLS TEMPORARILY TO CLEAR POLICIES =====
ALTER TABLE ican_user_wallets DISABLE ROW LEVEL SECURITY;
ALTER TABLE ican_coin_blockchain_txs DISABLE ROW LEVEL SECURITY;

-- Drop ALL existing policies
DROP POLICY IF EXISTS "Select own wallet" ON ican_user_wallets;
DROP POLICY IF EXISTS "Insert own wallet" ON ican_user_wallets;
DROP POLICY IF EXISTS "Update own wallet" ON ican_user_wallets;
DROP POLICY IF EXISTS "Users can view own wallets" ON ican_user_wallets;
DROP POLICY IF EXISTS "Users can insert own wallets" ON ican_user_wallets;
DROP POLICY IF EXISTS "Users can update own wallets" ON ican_user_wallets;
DROP POLICY IF EXISTS "ican_user_wallets_select" ON ican_user_wallets;
DROP POLICY IF EXISTS "ican_user_wallets_insert" ON ican_user_wallets;
DROP POLICY IF EXISTS "ican_user_wallets_update" ON ican_user_wallets;

DROP POLICY IF EXISTS "Select own transactions" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "Insert own transactions" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "Users can view own transactions" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "Users can insert own transactions" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "ican_coin_blockchain_txs_select" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "ican_coin_blockchain_txs_insert" ON ican_coin_blockchain_txs;

-- ===== RE-ENABLE RLS =====
ALTER TABLE ican_user_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ican_coin_blockchain_txs ENABLE ROW LEVEL SECURITY;

-- ===== CREATE NEW WORKING POLICIES FOR ICAN_USER_WALLETS =====
CREATE POLICY "ican_wallet_select" ON ican_user_wallets
  FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "ican_wallet_insert" ON ican_user_wallets
  FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "ican_wallet_update" ON ican_user_wallets
  FOR UPDATE USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- ===== CREATE NEW WORKING POLICIES FOR ICAN_COIN_BLOCKCHAIN_TXS =====
CREATE POLICY "ican_txs_select" ON ican_coin_blockchain_txs
  FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "ican_txs_insert" ON ican_coin_blockchain_txs
  FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

-- ===== GRANT TABLE PERMISSIONS =====
GRANT SELECT, INSERT, UPDATE ON ican_user_wallets TO authenticated;
GRANT SELECT, INSERT ON ican_coin_blockchain_txs TO authenticated;

SELECT 'RLS POLICIES REBUILT' as status;
SELECT 'Both tables now have working policies' as info;
SELECT 'Try purchasing ICAN coins again' as next_step;
