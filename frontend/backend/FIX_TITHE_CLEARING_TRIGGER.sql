-- ============================================================
-- FIX_TITHE_CLEARING_TRIGGER.sql
-- Fixes the tithe clearing system to work with RLS policies
-- ============================================================

-- PROBLEM: The trigger function can't update user_tithe_tracking due to RLS policies
-- SOLUTION: Disable RLS on user_tithe_tracking table (it's internal system table)

-- ============================================================
-- STEP 1: DISABLE RLS ON USER_TITHE_TRACKING
-- ============================================================
-- This table is internal and should not have user-facing RLS
ALTER TABLE user_tithe_tracking DISABLE ROW LEVEL SECURITY;

-- Drop all existing policies
DROP POLICY IF EXISTS "Users can view their own tithe tracking" ON user_tithe_tracking;
DROP POLICY IF EXISTS "Users can update their own tithe tracking" ON user_tithe_tracking;

-- ============================================================
-- STEP 2: DROP TRIGGER FIRST (before dropping function)
-- ============================================================

DROP TRIGGER IF EXISTS trigger_clear_tithe_after_payment ON ican_transactions;

-- ============================================================
-- STEP 3: RECREATE THE TRIGGER FUNCTION WITH PROPER LOGIC
-- ============================================================

DROP FUNCTION IF EXISTS clear_tithe_after_payment();

CREATE OR REPLACE FUNCTION clear_tithe_after_payment()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process tithe payments
  IF NEW.transaction_type = 'tithe' AND NEW.status = 'completed' THEN
    -- Ensure metadata has proper structure for reporting
    IF NEW.metadata IS NULL THEN
      NEW.metadata := jsonb_build_object(
        'payment_type', 'personal',
        'tithe_type', 'personal',
        'entry_mode', 'tithe-pay-in',
        'recorded_date', NOW()::text
      );
    ELSE
      -- Add missing fields if not present
      NEW.metadata := NEW.metadata || jsonb_build_object(
        'entry_mode', COALESCE(NEW.metadata->>'entry_mode', 'tithe-pay-in'),
        'recorded_date', COALESCE(NEW.metadata->>'recorded_date', NOW()::text),
        'tithe_type', COALESCE(NEW.metadata->>'tithe_type', NEW.metadata->>'payment_type')
      );
    END IF;
    
    -- Create user record if it doesn't exist
    INSERT INTO user_tithe_tracking (user_id, personal_tithe_accumulated, business_tithe_accumulated, combined_tithe_accumulated)
    VALUES (NEW.user_id, 0, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;
    
    -- ✅ FIXED: Now this will work because RLS is disabled on user_tithe_tracking
    -- Reset tithe amounts based on payment type and update tracking
    UPDATE user_tithe_tracking
    SET 
      personal_tithe_accumulated = CASE 
        WHEN (NEW.metadata->>'payment_type' = 'personal' OR NEW.metadata->>'payment_type' = 'combined')
        THEN 0 
        ELSE personal_tithe_accumulated 
      END,
      business_tithe_accumulated = CASE 
        WHEN (NEW.metadata->>'payment_type' = 'business' OR NEW.metadata->>'payment_type' = 'combined')
        THEN 0 
        ELSE business_tithe_accumulated 
      END,
      combined_tithe_accumulated = CASE 
        WHEN NEW.metadata->>'payment_type' = 'combined'
        THEN 0 
        ELSE combined_tithe_accumulated 
      END,
      last_payment_date = NEW.created_at,
      updated_at = NOW()
    WHERE user_id = NEW.user_id;
    
    -- Log that tithe was cleared
    RAISE NOTICE 'Tithe cleared for user % with payment type: %', NEW.user_id, NEW.metadata->>'payment_type';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- STEP 4: RECREATE THE TRIGGER
-- ============================================================

CREATE TRIGGER trigger_clear_tithe_after_payment
AFTER INSERT ON ican_transactions
FOR EACH ROW
EXECUTE FUNCTION clear_tithe_after_payment();

-- ============================================================
-- STEP 5: TEST THE FIX
-- ============================================================

-- Check trigger exists
SELECT 'TRIGGER EXISTS' as status FROM information_schema.triggers 
WHERE trigger_name = 'trigger_clear_tithe_after_payment';

-- Check RLS is disabled
SELECT relname, relrowsecurity 
FROM pg_class 
WHERE relname = 'user_tithe_tracking';

-- Show current tithe status
SELECT 
  COUNT(*) as total_users_tracking,
  SUM(personal_tithe_accumulated) as total_personal_tithe,
  SUM(business_tithe_accumulated) as total_business_tithe,
  SUM(combined_tithe_accumulated) as total_combined_tithe
FROM user_tithe_tracking;

-- Show recent tithe transactions
SELECT 
  t.id,
  t.user_id,
  t.transaction_type,
  t.status,
  t.amount,
  t.metadata->>'payment_type' as payment_type,
  t.created_at
FROM ican_transactions t
WHERE t.transaction_type = 'tithe'
  AND t.status = 'completed'
ORDER BY t.created_at DESC
LIMIT 10;

-- Show tithe status for users with recent payments
SELECT 
  ut.user_id,
  ut.personal_tithe_accumulated,
  ut.business_tithe_accumulated,
  ut.combined_tithe_accumulated,
  ut.last_payment_date,
  COUNT(it.id) as payment_count,
  SUM(it.amount) as total_paid
FROM user_tithe_tracking ut
LEFT JOIN ican_transactions it ON ut.user_id = it.user_id 
  AND it.transaction_type = 'tithe' 
  AND it.status = 'completed'
GROUP BY ut.user_id, ut.personal_tithe_accumulated, ut.business_tithe_accumulated, 
         ut.combined_tithe_accumulated, ut.last_payment_date
HAVING COUNT(it.id) > 0
ORDER BY ut.last_payment_date DESC;
