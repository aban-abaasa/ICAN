-- ============================================================
-- VERIFY_TITHE_SYSTEM.sql
-- Quick diagnostic queries to check if tithe system is working
-- ============================================================

-- 1. Check if user_tithe_tracking table exists and has data
SELECT 'STEP 1: Check user_tithe_tracking table' as step;
SELECT COUNT(*) as total_records FROM user_tithe_tracking;

-- 2. Check if trigger exists
SELECT 'STEP 2: Check trigger' as step;
SELECT * FROM information_schema.triggers 
WHERE trigger_name = 'trigger_clear_tithe_after_payment';

-- 3. Check recent tithe transactions in ican_transactions
SELECT 'STEP 3: Recent tithe transactions' as step;
SELECT 
  id,
  transaction_type,
  status,
  amount,
  created_at,
  metadata->>'payment_type' as payment_type
FROM ican_transactions
WHERE transaction_type = 'tithe'
ORDER BY created_at DESC
LIMIT 10;

-- 4. Check current tithe owed for each user
SELECT 'STEP 4: Current tithe owed by user' as step;
SELECT 
  u.email,
  t.personal_tithe_accumulated,
  t.business_tithe_accumulated,
  t.combined_tithe_accumulated,
  t.last_payment_date
FROM user_tithe_tracking t
INNER JOIN auth.users u ON t.user_id = u.id
WHERE (t.personal_tithe_accumulated > 0 OR t.business_tithe_accumulated > 0 OR t.combined_tithe_accumulated > 0)
ORDER BY t.updated_at DESC;

-- 5. For debugging: Check if trigger is actually updating the tracking table
-- Get the current user
SELECT 'STEP 5: Check audit trail' as step;
SELECT 
  t.id,
  t.transaction_type,
  t.status,
  t.metadata->>'payment_type' as payment_type,
  t.created_at
FROM ican_transactions t
WHERE t.transaction_type = 'tithe' 
  AND t.status = 'completed'
  AND t.created_at > NOW() - INTERVAL '1 hour'
ORDER BY t.created_at DESC;
