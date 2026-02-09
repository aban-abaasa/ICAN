-- Diagnose wallet balance storage

-- Step 1: Check ican_transactions for current user
SELECT 
  COUNT(*) as total_transactions,
  SUM(amount) as total_amount,
  COUNT(DISTINCT currency) as currencies,
  COUNT(CASE WHEN status='completed' THEN 1 END) as completed_count
FROM ican_transactions
WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'abana1662@gmail.com'
)
LIMIT 1;

-- Step 2: List transactions by currency
SELECT 
  currency,
  COUNT(*) as transaction_count,
  SUM(amount) as total_amount,
  status
FROM ican_transactions
WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'abana1662@gmail.com'
)
GROUP BY currency, status
ORDER BY currency;

-- Step 3: Check if there's a user_accounts or profiles table with balance
SELECT 
  column_name,
  data_type
FROM information_schema.columns 
WHERE table_name IN ('user_accounts', 'profiles', 'users')
AND column_name LIKE '%balance%'
LIMIT 10;

-- Step 4: Check all wallet-related tables
SELECT 
  table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND (table_name LIKE '%wallet%' OR table_name LIKE '%balance%' OR table_name LIKE '%account%')
ORDER BY table_name;

-- Step 5: Check profiles table structure and balance
SELECT 
  column_name,
  data_type
FROM information_schema.columns 
WHERE table_name = 'profiles'
ORDER BY ordinal_position
LIMIT 20;
