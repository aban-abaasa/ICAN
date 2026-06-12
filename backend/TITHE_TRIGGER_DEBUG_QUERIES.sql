-- ============================================================================
-- TITHE_TRIGGER_DEBUG_QUERIES.sql
-- ============================================================================
-- Run these queries ONE BY ONE in Supabase SQL Editor to diagnose the issue
-- ============================================================================

-- 🔍 DEBUG 1: Is the trigger actually active?
SELECT 
  tgname as trigger_name,
  tgenabled as enabled,
  tgtype as trigger_type,
  tgdeferrable as deferrable
FROM pg_trigger 
WHERE tgname = 'trigger_clear_tithe_after_payment';

-- Expected: Should return 1 row with tgenabled='O' (always on)
-- If NO rows: Trigger doesn't exist ❌
-- If MULTIPLE rows: Duplicate triggers ❌

---

-- 🔍 DEBUG 2: Does the trigger function exist?
SELECT 
  proname,
  prosrc as function_body
FROM pg_proc 
WHERE proname = 'clear_tithe_after_payment';

-- Expected: Should show the function body starting with "IF NEW.transaction_type"
-- If NO rows: Function deleted or doesn't exist ❌

---

-- 🔍 DEBUG 3: Get the user ID for the payments
SELECT DISTINCT
  t.user_id,
  COUNT(t.id) as payment_count,
  SUM(t.amount) as total_paid
FROM ican_transactions t
WHERE t.transaction_type = 'tithe' 
  AND t.status = 'completed'
  AND t.created_at > NOW() - INTERVAL '24 hours'
GROUP BY t.user_id;

-- Copy the user_id you see here for the next queries ➡️ SAVE THIS VALUE

---

-- 🔍 DEBUG 4: Check if user_tithe_tracking record EXISTS for this user
-- REPLACE 'YOUR_USER_ID_HERE' with the user_id from DEBUG 3
SELECT 
  user_id,
  personal_tithe_accumulated,
  business_tithe_accumulated,
  combined_tithe_accumulated,
  updated_at
FROM user_tithe_tracking
WHERE user_id = 'YOUR_USER_ID_HERE';

-- If NO rows: Record doesn't exist - this is the problem! ❌
-- If rows exist: Check if amounts are still high (not being deducted)

---

-- 🔍 DEBUG 5: Force test - manually check if UPDATE works
-- REPLACE 'YOUR_USER_ID_HERE' with the actual user_id
-- This tests if we can UPDATE the record
UPDATE user_tithe_tracking
SET 
  personal_tithe_accumulated = 5000000,  -- Set to a test value
  updated_at = NOW()
WHERE user_id = 'YOUR_USER_ID_HERE'
RETURNING user_id, personal_tithe_accumulated, updated_at;

-- If this UPDATE works: UPDATE statements work (database fine) ✅
-- If error: Permission issue or RLS blocking ❌

---

-- 🔍 DEBUG 6: Check if RLS is actually disabled
SELECT 
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE tablename = 'user_tithe_tracking';

-- Expected: rowsecurity = false ✅ (RLS disabled)
-- If rowsecurity = true: RLS is ENABLED and blocking updates ❌

---

-- 🔍 DEBUG 7: Verify transaction metadata has payment_type
SELECT 
  id,
  user_id,
  amount,
  metadata,
  metadata->>'payment_type' as payment_type
FROM ican_transactions
WHERE transaction_type = 'tithe'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 3;

-- Check: Does metadata->>'payment_type' show 'personal', 'business', or 'combined'?
-- If NULL or missing: Trigger won't work because v_payment_type will be NULL ❌

---

-- 🔍 DEBUG 8: Check database function logs (Supabase specific)
-- This shows if the trigger function was even called
SELECT 
  query,
  mean_time,
  calls,
  total_time
FROM pg_stat_statements
WHERE query LIKE '%TITHE_TRIGGER%' 
   OR query LIKE '%clear_tithe_after_payment%'
LIMIT 10;

-- If NO rows: Function never executed ❌

---

-- 🔍 DEBUG 9: Last resort - check if trigger is on the right table
SELECT 
  t.tgname as trigger_name,
  rel.relname as table_name,
  t.tgtype as trigger_type
FROM pg_trigger t
JOIN pg_class rel ON t.tgrelid = rel.oid
WHERE t.tgname = 'trigger_clear_tithe_after_payment';

-- Expected: table_name = 'ican_transactions'
-- If different table: Trigger on wrong table ❌

---

-- ✅ QUICK FIX: If trigger is broken, recreate it
-- Uncomment and run if other checks show trigger is missing/broken:

/*
DROP TRIGGER IF EXISTS trigger_clear_tithe_after_payment ON ican_transactions;
DROP FUNCTION IF EXISTS clear_tithe_after_payment();

CREATE OR REPLACE FUNCTION clear_tithe_after_payment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.transaction_type = 'tithe' AND NEW.status = 'completed' THEN
    INSERT INTO user_tithe_tracking (user_id, personal_tithe_accumulated, business_tithe_accumulated, combined_tithe_accumulated)
    VALUES (NEW.user_id, 0, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;
    
    UPDATE user_tithe_tracking
    SET 
      personal_tithe_accumulated = GREATEST(0, personal_tithe_accumulated - NEW.amount),
      combined_tithe_accumulated = GREATEST(0, combined_tithe_accumulated - NEW.amount),
      last_payment_date = NEW.created_at,
      updated_at = NOW()
    WHERE user_id = NEW.user_id;
    
    RAISE NOTICE '[TITHE_TRIGGER] Payment processed: user=%, amount=%', NEW.user_id, NEW.amount;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trigger_clear_tithe_after_payment
AFTER INSERT ON ican_transactions
FOR EACH ROW
EXECUTE FUNCTION clear_tithe_after_payment();

SELECT 'Trigger recreated' as status;
*/
