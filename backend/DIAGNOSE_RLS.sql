-- 🔍 DIAGNOSE RLS POLICIES
-- Check what policies currently exist

-- Check ican_user_wallets
SELECT '📋 ICAN_USER_WALLETS POLICIES:' as check;
SELECT schemaname, tablename, policyname, permissive, roles, qual, with_check
FROM pg_policies
WHERE tablename = 'ican_user_wallets'
ORDER BY policyname;

SELECT '';
SELECT '📋 ICAN_COIN_BLOCKCHAIN_TXS POLICIES:' as check;
SELECT schemaname, tablename, policyname, permissive, roles, qual, with_check
FROM pg_policies
WHERE tablename = 'ican_coin_blockchain_txs'
ORDER BY policyname;

-- Check if RLS is enabled
SELECT '';
SELECT '🔐 RLS STATUS:' as check;
SELECT tablename, rowsecurity 
FROM pg_class c 
JOIN pg_tables t ON c.relname = t.tablename 
WHERE t.tablename IN ('ican_user_wallets', 'ican_coin_blockchain_txs');
