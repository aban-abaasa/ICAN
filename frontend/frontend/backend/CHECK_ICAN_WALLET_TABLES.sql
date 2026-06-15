-- Check structure of ican_user_wallets (most likely the right one)
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'ican_user_wallets'
ORDER BY ordinal_position;

-- Show a sample record
SELECT * FROM ican_user_wallets LIMIT 1;

-- Check user_accounts table structure
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'user_accounts'
ORDER BY ordinal_position;

-- Show sample from user_accounts
SELECT * FROM user_accounts LIMIT 1;

-- Check wallet_accounts table structure
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'wallet_accounts'
ORDER BY ordinal_position;

-- Show sample from wallet_accounts
SELECT * FROM wallet_accounts LIMIT 1;
