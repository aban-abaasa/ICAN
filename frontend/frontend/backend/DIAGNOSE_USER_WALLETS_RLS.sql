-- Diagnose user_wallets access issues
-- Check RLS policies and data availability

-- Step 1: Check RLS status on user_wallets table
SELECT 
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE tablename = 'user_wallets';

-- Step 2: List all RLS policies on user_wallets
SELECT 
  policyname,
  permissive,
  roles,
  qual as policy_expression,
  with_check
FROM pg_policies 
WHERE tablename = 'user_wallets'
ORDER BY policyname;

-- Step 3: Get user ID and check records
SELECT id, email FROM auth.users WHERE email = 'abana1662@gmail.com' LIMIT 1;

-- Step 4: Check if user has ANY wallets (ignoring RLS)
SELECT 
  id, 
  user_id, 
  account_type, 
  currency, 
  balance, 
  status,
  created_at
FROM user_wallets 
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'abana1662@gmail.com' LIMIT 1)
LIMIT 10;

-- Step 5: Check if user_wallets RLS policy checks auth.uid()
SELECT 
  schemaname,
  tablename,
  policyname,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'user_wallets' 
AND (qual LIKE '%auth.uid()%' OR with_check LIKE '%auth.uid()%');

-- Step 6: Check what RLS policies exist and their logic
SELECT 
  policyname,
  roles::text,
  permissive,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'user_wallets';

-- Step 7: Verify user_wallets table structure
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'user_wallets'
ORDER BY ordinal_position;
