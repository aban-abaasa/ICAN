-- Find investor's personal wallet balance (named "ABANI 4 G")

-- Step 1: Get current user ID
SELECT id, email FROM auth.users WHERE email = 'abana1662@gmail.com' LIMIT 1;

-- Step 2: Search ALL columns containing 'balance' in public schema
SELECT 
  table_name,
  column_name,
  data_type
FROM information_schema.columns 
WHERE table_schema = 'public'
AND column_name LIKE '%balance%'
ORDER BY table_name;

-- Step 3: Check user_wallets structure first
SELECT 
  column_name,
  data_type
FROM information_schema.columns 
WHERE table_name = 'user_wallets'
ORDER BY ordinal_position;

-- Step 4: Get all user_wallets records
SELECT *
FROM user_wallets
LIMIT 10;

-- Step 5: Get user's specific wallet
SELECT *
FROM user_wallets
WHERE user_id IN (SELECT id FROM auth.users WHERE email = 'abana1662@gmail.com')
LIMIT 5;
