-- CLEAR_TITHE_ON_PAYMENT.sql
-- Automatic tithe clearing system when users make tithe payments
-- NO UUID REPLACEMENT NEEDED - This script handles all users automatically!

-- ============================================================
-- SECTION 1: CREATE A TITHE TRACKING TABLE
-- ============================================================
-- Run this FIRST to create the tracking table
CREATE TABLE IF NOT EXISTS user_tithe_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  personal_tithe_accumulated DECIMAL(15,2) DEFAULT 0,
  business_tithe_accumulated DECIMAL(15,2) DEFAULT 0,
  combined_tithe_accumulated DECIMAL(15,2) DEFAULT 0,
  last_payment_date TIMESTAMP DEFAULT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ============================================================
-- SECTION 2: INITIALIZE ALL EXISTING USERS (NO UUID REPLACEMENT!)
-- ============================================================
-- Run this SECOND to automatically populate the table for all users
-- This creates a record for every user in auth.users with tithe amounts set to 0
INSERT INTO user_tithe_tracking (user_id, personal_tithe_accumulated, business_tithe_accumulated, combined_tithe_accumulated)
SELECT id, 0, 0, 0 FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- Verify the records were created:
SELECT COUNT(*) as total_users_initialized FROM user_tithe_tracking;

-- ============================================================
-- SECTION 3: TRIGGER TO AUTO-RESET TITHE AFTER PAYMENT
-- ============================================================
-- Run this THIRD to set up automatic clearing on tithe payments
-- This trigger automatically clears tithe when a tithe payment is recorded

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
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_clear_tithe_after_payment ON ican_transactions;

-- Create trigger to execute after INSERT on ican_transactions
CREATE TRIGGER trigger_clear_tithe_after_payment
AFTER INSERT ON ican_transactions
FOR EACH ROW
EXECUTE FUNCTION clear_tithe_after_payment();

-- ============================================================
-- SECTION 4: ENABLE ROW LEVEL SECURITY
-- ============================================================
-- Run this FOURTH to secure the tithe tracking table
ALTER TABLE user_tithe_tracking ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (safe for re-running)
DROP POLICY IF EXISTS "Users can view their own tithe tracking" ON user_tithe_tracking;
DROP POLICY IF EXISTS "Users can update their own tithe tracking" ON user_tithe_tracking;

-- Create policy for users to see their own tithe tracking
CREATE POLICY "Users can view their own tithe tracking" ON user_tithe_tracking
  FOR SELECT USING (auth.uid() = user_id);

-- Create policy for users to update their own tithe tracking
CREATE POLICY "Users can update their own tithe tracking" ON user_tithe_tracking
  FOR UPDATE USING (auth.uid() = user_id);

-- ============================================================
-- SECTION 5: VERIFY THE SETUP
-- ============================================================
-- Run these queries to verify everything is working

-- 1. Check table exists:
SELECT 'TABLE EXISTS' as status FROM information_schema.tables 
WHERE table_name = 'user_tithe_tracking';

-- 2. Check how many users were initialized:
SELECT COUNT(*) as users_with_tithe_tracking FROM user_tithe_tracking;

-- 3. Check trigger exists:
SELECT 'TRIGGER EXISTS' as status FROM information_schema.triggers 
WHERE trigger_name = 'trigger_clear_tithe_after_payment';

-- 4. View sample user tithe status (first 5 users):
SELECT 
  u.id,
  u.email,
  t.personal_tithe_accumulated,
  t.business_tithe_accumulated,
  t.combined_tithe_accumulated,
  t.last_payment_date
FROM user_tithe_tracking t
INNER JOIN auth.users u ON t.user_id = u.id
LIMIT 5;

-- ============================================================
-- SECTION 6: OPTIONAL - VIEW ALL USERS WITH PENDING TITHE
-- ============================================================
-- Shows all users who have unpaid tithe amounts
SELECT 
  u.id,
  u.email,
  t.personal_tithe_accumulated,
  t.business_tithe_accumulated,
  t.combined_tithe_accumulated,
  (t.personal_tithe_accumulated + t.business_tithe_accumulated + t.combined_tithe_accumulated) as total_tithe_owed,
  t.last_payment_date
FROM user_tithe_tracking t
INNER JOIN auth.users u ON t.user_id = u.id
WHERE (t.personal_tithe_accumulated > 0 OR t.business_tithe_accumulated > 0 OR t.combined_tithe_accumulated > 0)
ORDER BY total_tithe_owed DESC;

-- ============================================================
-- SECTION 7: HOW TO RECORD TITHE PAYMENTS WITH PROPER METADATA
-- ============================================================
-- When recording a tithe payment, use this structure to ensure it appears
-- correctly in reports with Business/Personal categorization:

-- Example 1: Record PERSONAL tithe payment
/*
INSERT INTO ican_transactions (
  user_id, 
  transaction_type, 
  category, 
  amount, 
  status, 
  description,
  metadata
)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'user@example.com' LIMIT 1),
  'tithe',
  'giving',
  250.00,
  'completed',
  'Tithe Payment - Personal',
  jsonb_build_object(
    'payment_type', 'personal',
    'tithe_type', 'personal',
    'entry_mode', 'tithe-pay-in',
    'recipient', 'Church Name',
    'recorded_date', NOW()::text,
    'record_category', 'personal'
  )
);
*/

-- Example 2: Record BUSINESS tithe payment
/*
INSERT INTO ican_transactions (
  user_id, 
  transaction_type, 
  category, 
  amount, 
  status, 
  description,
  metadata
)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'user@example.com' LIMIT 1),
  'tithe',
  'giving',
  500.00,
  'completed',
  'Tithe Payment - Business',
  jsonb_build_object(
    'payment_type', 'business',
    'tithe_type', 'business',
    'entry_mode', 'tithe-pay-in',
    'recipient', 'Ministry Organization',
    'recorded_date', NOW()::text,
    'record_category', 'business'
  )
);
*/

-- Example 3: Record COMBINED tithe payment (Personal + Business)
/*
INSERT INTO ican_transactions (
  user_id, 
  transaction_type, 
  category, 
  amount, 
  status, 
  description,
  metadata
)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'user@example.com' LIMIT 1),
  'tithe',
  'giving',
  750.00,
  'completed',
  'Tithe Payment - Personal & Business',
  jsonb_build_object(
    'payment_type', 'combined',
    'tithe_type', 'combined',
    'entry_mode', 'tithe-pay-in',
    'recipient', 'Church',
    'recorded_date', NOW()::text,
    'record_category', 'combined',
    'personal_portion', 250,
    'business_portion', 500
  )
);
*/

-- ============================================================
-- SECTION 8: VIEW RECORDED TITHE TRANSACTIONS FOR A USER
-- ============================================================
-- Shows all tithe payments recorded for a specific user with metadata

/*
SELECT 
  t.id,
  t.created_at,
  t.amount,
  t.description,
  t.status,
  t.metadata->>'payment_type' as payment_type,
  t.metadata->>'recipient' as recipient,
  t.metadata->>'entry_mode' as entry_mode
FROM ican_transactions t
INNER JOIN auth.users u ON t.user_id = u.id
WHERE u.email = 'user@example.com' 
  AND t.transaction_type = 'tithe'
ORDER BY t.created_at DESC;
*/

-- ============================================================
-- SECTION 9: OPTIONAL - MANUALLY RESET A SPECIFIC USER'S TITHE
-- ============================================================
-- If you need to manually reset one user's tithe, uncomment and modify:
/*
UPDATE user_tithe_tracking
SET 
  personal_tithe_accumulated = 0,
  business_tithe_accumulated = 0,
  combined_tithe_accumulated = 0,
  last_payment_date = NOW(),
  updated_at = NOW()
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'user@example.com' LIMIT 1);
*/
