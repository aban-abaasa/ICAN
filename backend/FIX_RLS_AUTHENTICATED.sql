-- FINAL FIX: Explicitly set policies for AUTHENTICATED role (not public)

-- Drop v2 policies
DROP POLICY IF EXISTS "ican_wallet_select_v2" ON ican_user_wallets;
DROP POLICY IF EXISTS "ican_wallet_insert_v2" ON ican_user_wallets;
DROP POLICY IF EXISTS "ican_wallet_update_v2" ON ican_user_wallets;
DROP POLICY IF EXISTS "ican_txs_select_v2" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "ican_txs_insert_v2" ON ican_coin_blockchain_txs;

-- Create policies EXPLICITLY for authenticated role
CREATE POLICY "ican_wallet_select_auth" ON ican_user_wallets
  FOR SELECT 
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "ican_wallet_insert_auth" ON ican_user_wallets
  FOR INSERT 
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "ican_wallet_update_auth" ON ican_user_wallets
  FOR UPDATE 
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "ican_txs_select_auth" ON ican_coin_blockchain_txs
  FOR SELECT 
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "ican_txs_insert_auth" ON ican_coin_blockchain_txs
  FOR INSERT 
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Ensure permissions
GRANT SELECT, INSERT, UPDATE ON ican_user_wallets TO authenticated;
GRANT SELECT, INSERT ON ican_coin_blockchain_txs TO authenticated;

SELECT 'Policies now explicitly FOR authenticated role' as status;
