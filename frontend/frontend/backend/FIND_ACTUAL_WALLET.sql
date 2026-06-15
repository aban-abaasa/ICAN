-- Find the actual wallet balance storage

-- Step 1: List all tables containing 'wallet' or similar
SELECT 
  table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Step 2: Check ican_wallets table (if it exists)
SELECT 
  column_name,
  data_type
FROM information_schema.columns 
WHERE table_name = 'ican_wallets'
ORDER BY ordinal_position;

-- Step 3: Get wallet records
SELECT *
FROM ican_wallets
WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'abana1662@gmail.com'
)
LIMIT 5;

-- Step 4: Check user_wallets
SELECT 
  column_name,
  data_type
FROM information_schema.columns 
WHERE table_name = 'user_wallets'
ORDER BY ordinal_position;

-- Step 5: Get user wallets
SELECT *
FROM user_wallets
WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'abana1662@gmail.com'
)
LIMIT 5;

-- Step 6: Check business_wallets
SELECT 
  column_name,
  data_type
FROM information_schema.columns 
WHERE table_name = 'business_wallets'
ORDER BY ordinal_position;

-- Step 7: Get business wallets for ABANI 4 G
SELECT *
FROM business_wallets
WHERE business_profile_id IN (
  SELECT id FROM business_profiles WHERE business_name = 'ABANI 4 G'
)
LIMIT 5;
