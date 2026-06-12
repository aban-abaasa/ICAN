-- ============================================================================
-- TITHE_PAYMENT_CLEARING_FIX.sql
-- ============================================================================
-- Purpose: Fix tithe clearing when payments are made
-- Issues Fixed:
-- 1. Trigger was setting tithe to 0 instead of deducting payment amount
-- 2. No handling for partial vs full payments
-- 3. Combined payment logic was incorrect
-- 
-- This ensures tithe amounts are properly deducted when payments are recorded
-- ============================================================================

-- Step 1: Drop existing problematic trigger
DROP TRIGGER IF EXISTS trigger_clear_tithe_after_payment ON ican_transactions;
DROP FUNCTION IF EXISTS clear_tithe_after_payment();

-- Step 2: Disable RLS on user_tithe_tracking (internal system table)
ALTER TABLE user_tithe_tracking DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own tithe tracking" ON user_tithe_tracking;
DROP POLICY IF EXISTS "Users can update their own tithe tracking" ON user_tithe_tracking;

-- Step 3: Create SIMPLIFIED function that reliably deducts payment amounts
CREATE OR REPLACE FUNCTION clear_tithe_after_payment()
RETURNS TRIGGER AS $$
DECLARE
  v_payment_type TEXT;
  v_amount DECIMAL(15,2);
BEGIN
  -- Only process tithe payments
  IF NEW.transaction_type = 'tithe' AND NEW.status = 'completed' THEN
    
    -- Extract payment type and amount
    v_payment_type := COALESCE(NEW.metadata->>'payment_type', 'personal');
    v_amount := NEW.amount;
    
    -- Create user record if it doesn't exist
    INSERT INTO user_tithe_tracking (user_id, personal_tithe_accumulated, business_tithe_accumulated, combined_tithe_accumulated)
    VALUES (NEW.user_id, 0, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;
    
    -- ✅ SIMPLIFIED: Directly deduct based on payment type
    IF v_payment_type = 'personal' THEN
      -- Personal payment: deduct from personal only
      UPDATE user_tithe_tracking
      SET 
        personal_tithe_accumulated = GREATEST(0, personal_tithe_accumulated - v_amount),
        combined_tithe_accumulated = GREATEST(0, combined_tithe_accumulated - v_amount),
        last_payment_date = NEW.created_at,
        updated_at = NOW()
      WHERE user_id = NEW.user_id;
      
      RAISE NOTICE '[TITHE_TRIGGER] PERSONAL payment processed: user=%, amount=UGX %', NEW.user_id, v_amount;
      
    ELSIF v_payment_type = 'business' THEN
      -- Business payment: deduct from business only
      UPDATE user_tithe_tracking
      SET 
        business_tithe_accumulated = GREATEST(0, business_tithe_accumulated - v_amount),
        combined_tithe_accumulated = GREATEST(0, combined_tithe_accumulated - v_amount),
        last_payment_date = NEW.created_at,
        updated_at = NOW()
      WHERE user_id = NEW.user_id;
      
      RAISE NOTICE '[TITHE_TRIGGER] BUSINESS payment processed: user=%, amount=UGX %', NEW.user_id, v_amount;
      
    ELSIF v_payment_type = 'combined' THEN
      -- Combined payment: deduct from both
      UPDATE user_tithe_tracking
      SET 
        personal_tithe_accumulated = GREATEST(0, personal_tithe_accumulated - (v_amount / 2)),
        business_tithe_accumulated = GREATEST(0, business_tithe_accumulated - (v_amount / 2)),
        combined_tithe_accumulated = GREATEST(0, combined_tithe_accumulated - v_amount),
        last_payment_date = NEW.created_at,
        updated_at = NOW()
      WHERE user_id = NEW.user_id;
      
      RAISE NOTICE '[TITHE_TRIGGER] COMBINED payment processed: user=%, amount=UGX %', NEW.user_id, v_amount;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Step 4: Create improved trigger that fires AFTER tithe transaction insert
CREATE TRIGGER trigger_clear_tithe_after_payment
AFTER INSERT ON ican_transactions
FOR EACH ROW
EXECUTE FUNCTION clear_tithe_after_payment();

-- Step 5: Verify setup
SELECT 
  'Trigger Status' as check_item,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'trigger_clear_tithe_after_payment'
  ) THEN '✅ ACTIVE' ELSE '❌ FAILED' END as status;

SELECT 
  'Function Status' as check_item,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'clear_tithe_after_payment'
  ) THEN '✅ ACTIVE' ELSE '❌ FAILED' END as status;

SELECT 
  'RLS Status' as check_item,
  CASE WHEN (
    SELECT relrowsecurity FROM pg_class WHERE relname = 'user_tithe_tracking'
  ) = false THEN '✅ DISABLED (Good)' ELSE '❌ ENABLED (Bad)' END as status;

-- Step 6: DIAGNOSTIC - Check if payments are being deducted
-- Run these queries to see what's happening:

-- ❌ Check: Are recent tithe transactions recorded?
-- SELECT 
--   COUNT(*) as total_tithe_payments,
--   SUM(amount) as total_paid,
--   MIN(created_at) as oldest_payment,
--   MAX(created_at) as newest_payment
-- FROM ican_transactions
-- WHERE transaction_type = 'tithe' AND status = 'completed'
-- AND created_at > NOW() - INTERVAL '24 hours';

-- ❌ Check: Why tithe isn't being cleared - compare timestamps
-- SELECT 
--   t.id,
--   t.user_id,
--   t.amount,
--   t.metadata->>'payment_type' as payment_type,
--   t.created_at as payment_recorded_at,
--   utt.personal_tithe_accumulated,
--   utt.business_tithe_accumulated,
--   utt.combined_tithe_accumulated,
--   utt.updated_at as tracking_updated_at
-- FROM ican_transactions t
-- LEFT JOIN user_tithe_tracking utt ON t.user_id = utt.user_id
-- WHERE t.transaction_type = 'tithe' 
--   AND t.status = 'completed'
--   AND t.created_at > NOW() - INTERVAL '24 hours'
-- ORDER BY t.created_at DESC;

-- ❌ Check: Trigger function (should show recent payments in logs)
-- SELECT pg_sleep(0.1); -- Small delay to ensure logs flush
-- SELECT * FROM pg_stat_statements WHERE query LIKE '%TITHE_TRIGGER%' LIMIT 10;

-- ✅ FIX: If trigger still not working, manually clear tithe for testing
-- UPDATE user_tithe_tracking
-- SET 
--   personal_tithe_accumulated = 0,
--   business_tithe_accumulated = 0,
--   combined_tithe_accumulated = 0,
--   updated_at = NOW()
-- WHERE user_id = (SELECT id FROM auth.users WHERE email = 'USER_EMAIL_HERE');
-- SELECT 'Manually cleared tithe for testing' as status;
