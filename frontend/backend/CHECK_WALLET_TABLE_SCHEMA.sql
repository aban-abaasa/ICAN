-- Check the actual structure of user_wallets table
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'user_wallets'
ORDER BY ordinal_position;

-- Also check user_accounts table if it exists
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'user_accounts'
ORDER BY ordinal_position;

-- Show a sample record from user_wallets
SELECT * FROM user_wallets LIMIT 1;

-- Show all tables that might contain account or wallet info
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name LIKE '%wallet%' OR table_name LIKE '%account%'
ORDER BY table_name;
