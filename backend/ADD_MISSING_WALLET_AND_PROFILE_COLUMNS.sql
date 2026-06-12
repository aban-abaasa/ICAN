-- ADD_MISSING_WALLET_AND_PROFILE_COLUMNS.sql
-- Fix for: wallet_type column missing from user_wallets table
-- Fix for: net_worth column missing from user_profiles table
-- Status: 400 Bad Request errors when querying these columns

-- ============================================================
-- SECTION 1: ADD wallet_type COLUMN TO user_wallets TABLE
-- ============================================================
-- Run this FIRST to add the wallet_type column
-- This allows filtering wallets by type (personal, business, trust, agent, investment)

ALTER TABLE user_wallets 
ADD COLUMN IF NOT EXISTS wallet_type VARCHAR(50) DEFAULT 'personal';

-- Add comment for clarity
COMMENT ON COLUMN user_wallets.wallet_type IS 'Type of wallet: personal, business, trust, agent, investment';

-- Create index for faster queries by wallet_type
CREATE INDEX IF NOT EXISTS idx_user_wallets_type 
ON user_wallets(user_id, wallet_type);

-- ============================================================
-- SECTION 2: ADD net_worth COLUMN TO user_profiles TABLE
-- ============================================================
-- Run this SECOND to add the net_worth column
-- This allows tracking user total net worth across all wallets

ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS net_worth DECIMAL(15,2) DEFAULT 0;

-- Add comment for clarity
COMMENT ON COLUMN user_profiles.net_worth IS 'Total net worth calculated from all wallets (personal + business + trust + investments)';

-- Create index for faster queries by net_worth
CREATE INDEX IF NOT EXISTS idx_user_profiles_net_worth 
ON user_profiles(net_worth DESC);

-- ============================================================
-- SECTION 3: UPDATE EXISTING RECORDS - wallet_type VALUES
-- ============================================================
-- Set wallet_type for all existing wallet records based on naming convention
-- NOTE: If your wallet name column has a different name, update the column reference below
-- Common column names: name, title, description, wallet_label, display_name

-- OPTION A: If you have a wallet name/title column, uncomment and modify this:
/*
UPDATE user_wallets 
SET wallet_type = CASE 
  WHEN [column_name] ILIKE '%business%' THEN 'business'
  WHEN [column_name] ILIKE '%trust%' OR [column_name] ILIKE '%savings%' THEN 'trust'
  WHEN [column_name] ILIKE '%agent%' THEN 'agent'
  WHEN [column_name] ILIKE '%invest%' THEN 'investment'
  ELSE 'personal'
END
WHERE wallet_type = 'personal';
*/

-- OPTION B: Default approach - all wallets default to 'personal' type
-- Users can manually update wallet_type for specific wallets using:
/*
UPDATE user_wallets SET wallet_type = 'business' WHERE id = 'wallet-uuid-here';
UPDATE user_wallets SET wallet_type = 'trust' WHERE id = 'wallet-uuid-here';
*/

-- Verify current wallet_type distribution:
SELECT wallet_type, COUNT(*) as count FROM user_wallets GROUP BY wallet_type;

-- ============================================================
-- SECTION 4: TRIGGER TO AUTO-CALCULATE net_worth
-- ============================================================
-- Create function to calculate net_worth from all user wallets

CREATE OR REPLACE FUNCTION calculate_user_net_worth(p_user_id UUID)
RETURNS DECIMAL AS $$
DECLARE
  v_net_worth DECIMAL(15,2);
BEGIN
  SELECT COALESCE(SUM(balance), 0)
  INTO v_net_worth
  FROM user_wallets
  WHERE user_id = p_user_id;
  
  RETURN v_net_worth;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- SECTION 5: UPDATE net_worth FOR ALL EXISTING USERS
-- ============================================================
-- Calculate and update net_worth for all users based on their wallet balances

UPDATE user_profiles
SET net_worth = calculate_user_net_worth(user_id)
WHERE EXISTS (
  SELECT 1 FROM user_wallets WHERE user_wallets.user_id = user_profiles.user_id
);

-- Verify net_worth updates (show users with highest net worth):
SELECT 
  u.id,
  u.email,
  p.net_worth,
  COUNT(w.id) as wallet_count,
  SUM(w.balance) as total_balance
FROM user_profiles p
INNER JOIN auth.users u ON p.user_id = u.id
LEFT JOIN user_wallets w ON w.user_id = u.id
GROUP BY u.id, u.email, p.net_worth
ORDER BY p.net_worth DESC
LIMIT 10;

-- ============================================================
-- SECTION 6: TRIGGER TO AUTO-UPDATE net_worth ON WALLET CHANGES
-- ============================================================
-- When wallet balance changes, update the user's net_worth in profile

CREATE OR REPLACE FUNCTION update_user_net_worth_on_wallet_change()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE user_profiles
  SET net_worth = calculate_user_net_worth(NEW.user_id)
  WHERE user_id = NEW.user_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_update_net_worth_on_wallet_change ON user_wallets;

-- Create trigger to execute after wallet balance updates
CREATE TRIGGER trigger_update_net_worth_on_wallet_change
AFTER UPDATE OF balance ON user_wallets
FOR EACH ROW
EXECUTE FUNCTION update_user_net_worth_on_wallet_change();

-- Also trigger on INSERT (new wallet created)
CREATE OR REPLACE FUNCTION update_user_net_worth_on_wallet_insert()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE user_profiles
  SET net_worth = calculate_user_net_worth(NEW.user_id)
  WHERE user_id = NEW.user_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_update_net_worth_on_wallet_insert ON user_wallets;

CREATE TRIGGER trigger_update_net_worth_on_wallet_insert
AFTER INSERT ON user_wallets
FOR EACH ROW
EXECUTE FUNCTION update_user_net_worth_on_wallet_insert();

-- ============================================================
-- SECTION 7: UPDATE RLS POLICIES FOR wallet_type
-- ============================================================
-- Users can only see wallets of specific types (based on your app logic)

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "Users can view wallets by type" ON user_wallets;

-- Create policy for users to view wallets by type
-- Note: WITH CHECK is only for INSERT/UPDATE/DELETE; SELECT uses USING only
CREATE POLICY "Users can view wallets by type" ON user_wallets
  FOR SELECT USING (auth.uid() = user_id);

-- ============================================================
-- SECTION 8: VERIFY THE SETUP
-- ============================================================
-- Run these queries to verify everything is working

-- 1. Check columns exist:
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name IN ('user_wallets', 'user_profiles') 
AND column_name IN ('wallet_type', 'net_worth');

-- 2. Check functions exist:
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_name IN ('calculate_user_net_worth', 'update_user_net_worth_on_wallet_change', 'update_user_net_worth_on_wallet_insert');

-- 3. Check indexes exist:
SELECT indexname 
FROM pg_indexes 
WHERE indexname LIKE 'idx_user_%';

-- 4. Check triggers exist:
SELECT trigger_name 
FROM information_schema.triggers 
WHERE trigger_name LIKE 'trigger_update_net_worth%';

-- 5. Sample data - wallets with their types:
SELECT 
  u.email,
  w.wallet_type,
  w.balance,
  p.net_worth
FROM user_wallets w
INNER JOIN auth.users u ON w.user_id = u.id
INNER JOIN user_profiles p ON p.user_id = u.id
LIMIT 10;

-- ============================================================
-- SECTION 9: ROLLBACK (if needed)
-- ============================================================
-- If you need to rollback these changes, uncomment and run:
/*
ALTER TABLE user_wallets DROP COLUMN IF EXISTS wallet_type;
ALTER TABLE user_profiles DROP COLUMN IF EXISTS net_worth;
DROP TRIGGER IF EXISTS trigger_update_net_worth_on_wallet_change ON user_wallets;
DROP TRIGGER IF EXISTS trigger_update_net_worth_on_wallet_insert ON user_wallets;
DROP FUNCTION IF EXISTS update_user_net_worth_on_wallet_change();
DROP FUNCTION IF EXISTS update_user_net_worth_on_wallet_insert();
DROP FUNCTION IF EXISTS calculate_user_net_worth(UUID);
DROP INDEX IF EXISTS idx_user_wallets_type;
DROP INDEX IF EXISTS idx_user_profiles_net_worth;
*/
