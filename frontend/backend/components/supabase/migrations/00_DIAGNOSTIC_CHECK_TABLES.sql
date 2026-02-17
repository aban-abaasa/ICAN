/**
 * 🔍 Diagnostic: Check Your Database Structure
 * Run this in Supabase SQL Editor to see what tables exist
 */

-- ===================================
-- 1. List all tables in your database
-- ===================================
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public'
ORDER BY table_name;

-- ===================================
-- 2. Check user_accounts table structure
-- ===================================
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'user_accounts'
ORDER BY ordinal_position;

-- ===================================
-- 3. Check if user_accounts has ICAN columns
-- ===================================
SELECT COUNT(*) as column_count
FROM information_schema.columns
WHERE table_name = 'user_accounts'
AND (column_name LIKE '%ican%' OR column_name LIKE '%country%');

-- ===================================
-- 4. Sample user_accounts record structure
-- ===================================
SELECT id, user_id, account_number, preferred_currency
FROM user_accounts
LIMIT 1;

-- ===================================
-- 5. Check which ICAN columns already exist
-- ===================================
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'user_accounts'
AND column_name IN ('ican_coin_balance', 'ican_coin_total_purchased', 'ican_coin_total_sold', 'country_code');
