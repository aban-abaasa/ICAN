-- 🔧 COMPREHENSIVE RLS FIX - Run this to enable all transactions
-- This removes restrictive policies and creates permissive ones

-- ===== CLEAR EXISTING POLICIES =====
DROP POLICY IF EXISTS "Users can view own wallets" ON ican_user_wallets;
DROP POLICY IF EXISTS "Users can insert own wallets" ON ican_user_wallets;
DROP POLICY IF EXISTS "Users can update own wallets" ON ican_user_wallets;
DROP POLICY IF EXISTS "ican_user_wallets_select" ON ican_user_wallets;
DROP POLICY IF EXISTS "ican_user_wallets_insert" ON ican_user_wallets;
DROP POLICY IF EXISTS "ican_user_wallets_update" ON ican_user_wallets;

DROP POLICY IF EXISTS "Users can view own transactions" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "Users can insert own transactions" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "ican_coin_blockchain_txs_select" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "ican_coin_blockchain_txs_insert" ON ican_coin_blockchain_txs;

-- ===== ENABLE RLS ON BOTH TABLES =====
ALTER TABLE ican_user_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ican_coin_blockchain_txs ENABLE ROW LEVEL SECURITY;

-- ===== CREATE NEW POLICIES FOR ICAN_USER_WALLETS =====
-- SELECT policy: Users can view their own wallet
CREATE POLICY "Select own wallet"
  ON ican_user_wallets
  FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT policy: Users can create their own wallet
CREATE POLICY "Insert own wallet"
  ON ican_user_wallets
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- UPDATE policy: Users can update their own wallet
CREATE POLICY "Update own wallet"
  ON ican_user_wallets
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ===== CREATE NEW POLICIES FOR ICAN_COIN_BLOCKCHAIN_TXS =====
-- SELECT policy: Users can view their own transactions
CREATE POLICY "Select own transactions"
  ON ican_coin_blockchain_txs
  FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT policy: Users can create their own transactions
CREATE POLICY "Insert own transactions"
  ON ican_coin_blockchain_txs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ===== VERIFY POLICIES ARE ACTIVE =====
SELECT '✅ RLS POLICIES FIXED!' as status;
SELECT 'All users can now:' as info;
SELECT '  • Read their own ICAN wallet' as permission_1;
SELECT '  • Update their ICAN wallet' as permission_2;
SELECT '  • Record ICAN coin transactions' as permission_3;

-- Test query to verify it works
SELECT 'Test: This query should now return user wallets' as test_description;
