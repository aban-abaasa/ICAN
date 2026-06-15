-- ADD_MISSING_WALLET_COLUMNS.sql
-- Add missing columns to support tithe payment deduction

-- ============================================================
-- STEP 1: Add wallet_type column to user_wallets table
-- ============================================================
-- This column differentiates between different wallet types (personal, business, etc)

ALTER TABLE user_wallets
ADD COLUMN IF NOT EXISTS wallet_type VARCHAR(50) DEFAULT 'personal';

-- Create an index for faster filtering
CREATE INDEX IF NOT EXISTS idx_user_wallets_user_id_type ON user_wallets(user_id, wallet_type);

-- ============================================================
-- STEP 2: Add net_worth column to user_profiles table
-- ============================================================
-- This column tracks the user's total net worth for deductions

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS net_worth DECIMAL(15,2) DEFAULT 0;

-- ============================================================
-- STEP 3: Verify the columns were added
-- ============================================================
-- Run these queries to confirm:

-- Check user_wallets columns:
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'user_wallets'
ORDER BY ordinal_position;

-- Check user_profiles columns:
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'user_profiles'
ORDER BY ordinal_position;
