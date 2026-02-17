-- Find where the 100,000 balance is stored

-- Step 1: Check all wallet tables
SELECT 
  table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND (table_name LIKE '%wallet%' OR table_name LIKE '%account%' OR table_name LIKE '%balance%')
ORDER BY table_name;

-- Step 2: Check user_accounts table structure
SELECT 
  column_name,
  data_type
FROM information_schema.columns 
WHERE table_name = 'user_accounts'
ORDER BY ordinal_position;

-- Step 3: Get current user's account info
SELECT *
FROM user_accounts
WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'abana1662@gmail.com'
)
LIMIT 1;

-- Step 4: Check ican_transactions totals
SELECT 
  COUNT(*) as total_transactions,
  SUM(amount) as total_amount,
  COUNT(DISTINCT currency) as unique_currencies
FROM ican_transactions
WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'abana1662@gmail.com'
);

-- Step 5: Show transactions by type
SELECT 
  transaction_type,
  COUNT(*) as count,
  SUM(amount) as total,
  AVG(amount) as avg_amount
FROM ican_transactions
WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'abana1662@gmail.com'
)
GROUP BY transaction_type;
