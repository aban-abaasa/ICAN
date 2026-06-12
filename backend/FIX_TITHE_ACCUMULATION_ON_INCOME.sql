-- ============================================================================
-- FIX_TITHE_ACCUMULATION_ON_INCOME.sql
-- ============================================================================
-- Purpose: Add tithe to user_tithe_tracking when new income (salary/business) 
-- is recorded. Works in conjunction with existing payment-clearing trigger.
-- 
-- This ensures:
-- 1. Income recorded → tithe amounts added to accumulated total
-- 2. Tithe paid → accumulated amounts cleared (existing trigger)
-- 3. Frontend shows current accumulated tithe owed from database
-- ============================================================================

-- Step 1: Verify trigger doesn't already exist
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'trigger_calculate_tithe_on_income'
  ) THEN
    RAISE NOTICE 'Trigger trigger_calculate_tithe_on_income already exists, dropping...';
    DROP TRIGGER IF EXISTS trigger_calculate_tithe_on_income ON ican_transactions;
  END IF;
END $$;

-- Step 2: Verify function doesn't already exist
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'calculate_tithe_on_income'
  ) THEN
    RAISE NOTICE 'Function calculate_tithe_on_income already exists, dropping...';
    DROP FUNCTION IF EXISTS calculate_tithe_on_income();
  END IF;
END $$;

-- Step 3: Create function to calculate and add tithe on income
CREATE OR REPLACE FUNCTION calculate_tithe_on_income()
RETURNS TRIGGER AS $$
DECLARE
  v_personal_tithe DECIMAL(15, 2) := 0;
  v_business_tithe DECIMAL(15, 2) := 0;
  v_combined_tithe DECIMAL(15, 2) := 0;
  v_tithe_rate DECIMAL(5, 2) := 0.10; -- Default 10% tithe rate
BEGIN
  -- Only process for income transactions (salary, business_sales)
  IF NEW.transaction_type IN ('salary', 'business_sales') THEN
    
    -- Calculate tithe based on transaction type
    IF NEW.transaction_type = 'salary' THEN
      v_personal_tithe := NEW.amount * v_tithe_rate;
      v_combined_tithe := v_personal_tithe;
    ELSIF NEW.transaction_type = 'business_sales' THEN
      v_business_tithe := NEW.amount * v_tithe_rate;
      v_combined_tithe := v_business_tithe;
    END IF;
    
    -- Ensure user_tithe_tracking row exists
    INSERT INTO user_tithe_tracking (
      user_id,
      personal_tithe_accumulated,
      business_tithe_accumulated,
      combined_tithe_accumulated,
      last_updated
    )
    VALUES (
      NEW.user_id,
      v_personal_tithe,
      v_business_tithe,
      v_combined_tithe,
      NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      personal_tithe_accumulated = user_tithe_tracking.personal_tithe_accumulated + EXCLUDED.personal_tithe_accumulated,
      business_tithe_accumulated = user_tithe_tracking.business_tithe_accumulated + EXCLUDED.business_tithe_accumulated,
      combined_tithe_accumulated = user_tithe_tracking.combined_tithe_accumulated + EXCLUDED.combined_tithe_accumulated,
      last_updated = NOW();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Create trigger to fire AFTER new income transaction is inserted
CREATE TRIGGER trigger_calculate_tithe_on_income
AFTER INSERT ON ican_transactions
FOR EACH ROW
EXECUTE FUNCTION calculate_tithe_on_income();

-- Step 5: Verify setup
SELECT 
  'Trigger Status' as check_item,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'trigger_calculate_tithe_on_income'
  ) THEN '✅ ACTIVE' ELSE '❌ FAILED' END as status;

SELECT 
  'Function Status' as check_item,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'calculate_tithe_on_income'
  ) THEN '✅ ACTIVE' ELSE '❌ FAILED' END as status;

-- Step 6: Test - show current tithe tracking after income added
-- (Run this separately after inserting test income)
-- SELECT * FROM user_tithe_tracking ORDER BY last_updated DESC LIMIT 5;
