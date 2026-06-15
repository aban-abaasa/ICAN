-- Comprehensive RLS Diagnosis

-- Check table info
SELECT 
  schemaname, 
  tablename, 
  rowsecurity 
FROM pg_tables 
WHERE tablename IN ('ican_user_wallets', 'ican_coin_blockchain_txs');

-- Check ALL policies on both tables
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  qual,
  with_check
FROM pg_policies 
WHERE tablename IN ('ican_user_wallets', 'ican_coin_blockchain_txs')
ORDER BY tablename, policyname;

-- Check table column types
SELECT 
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name IN ('ican_user_wallets', 'ican_coin_blockchain_txs')
ORDER BY table_name, ordinal_position;

-- Check authenticated role permissions
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name IN ('ican_user_wallets', 'ican_coin_blockchain_txs')
ORDER BY table_name, grantee;
