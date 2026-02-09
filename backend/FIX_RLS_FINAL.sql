-- FIX: Remove PUBLIC-only policies and create proper authenticated policies

-- Drop all existing policies (all set to PUBLIC role - that's the problem!)
DROP POLICY IF EXISTS "select_own_wallet" ON ican_user_wallets;
DROP POLICY IF EXISTS "insert_own_wallet" ON ican_user_wallets;
DROP POLICY IF EXISTS "update_own_wallet" ON ican_user_wallets;
DROP POLICY IF EXISTS "wallet_user_select" ON ican_user_wallets;
DROP POLICY IF EXISTS "wallet_user_insert" ON ican_user_wallets;
DROP POLICY IF EXISTS "wallet_user_update" ON ican_user_wallets;

DROP POLICY IF EXISTS "txs_user_select" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "txs_user_insert" ON ican_coin_blockchain_txs;

-- Create NEW policies WITHOUT specifying a role (applies to all authenticated users)
CREATE POLICY "wallet_select" ON ican_user_wallets
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "wallet_insert" ON ican_user_wallets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "wallet_update" ON ican_user_wallets
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "blockchain_select" ON ican_coin_blockchain_txs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "blockchain_insert" ON ican_coin_blockchain_txs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

SELECT 'Policies fixed - now apply to all authenticated users, not just PUBLIC' as status;
