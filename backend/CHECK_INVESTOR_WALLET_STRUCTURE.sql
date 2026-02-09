-- Check wallet table structure and investor's balance

-- Step 1: List all wallet-related tables
SELECT 
  table_name
FROM information_schema.tables
WHERE table_name LIKE '%wallet%' OR table_name LIKE '%balance%'
ORDER BY table_name;

-- Step 2: Check ican_wallets table structure
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'ican_wallets'
ORDER BY ordinal_position;

-- Step 3: Check if user_wallets table exists
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'user_wallets'
ORDER BY ordinal_position;

-- Step 4: Check transactions/accounts table
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'user_accounts'
ORDER BY ordinal_position;

-- Step 5: List all users with wallets
SELECT 
  user_id,
  COUNT(*) as record_count
FROM ican_wallets
GROUP BY user_id
LIMIT 10;

-- Step 6: Get specific user's wallet (abana1662@gmail.com)
SELECT 
  id,
  user_id,
  balance,
  currency,
  updated_at
FROM ican_wallets
WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'abana1662@gmail.com'
)
LIMIT 5;
