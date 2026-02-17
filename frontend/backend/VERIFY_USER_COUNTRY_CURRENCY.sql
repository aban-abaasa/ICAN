-- ========================================
-- 🌍 VERIFY USER COUNTRY & CURRENCY BINDING
-- ========================================
-- Run these queries to check if your country is set
-- and verify currency is bound to that country

-- ========================================
-- Query 1: Check Your User's Country
-- ========================================
-- Replace 'YOUR_USER_ID' with your actual user ID (from Supabase Auth)
-- Get your user ID from Supabase Dashboard > Auth > Users

SELECT 
  'USER COUNTRY STATUS' as "Check",
  user_id,
  country_code as "Your Country Code",
  preferred_currency as "Your Currency",
  ican_coin_balance as "ICAN Coins",
  ican_updated_at as "Last Updated"
FROM user_accounts
WHERE user_id = 'YOUR_USER_ID'::UUID;

-- ========================================
-- Expected Result for Uganda User:
-- ========================================
-- Check: USER COUNTRY STATUS
-- user_id: abc123xyz...
-- Your Country Code: UG
-- Your Currency: UGX
-- ICAN Coins: 5000
-- Last Updated: 2024-01-15...
--
-- This means:
-- ✅ User IS from Uganda (UG)
-- ✅ Currency IS locked to UGX
-- ✅ All contributions will show in USh (UGX symbol)

-- ========================================
-- Query 2: Check if Country is SET (Not NULL)
-- ========================================
-- Returns true if your country_code is NOT NULL
-- Returns false if country_code is NULL

SELECT 
  'COUNTRY IS SET?' as "Check",
  CASE 
    WHEN country_code IS NOT NULL AND country_code != '' THEN 'YES ✅'
    ELSE 'NO ❌ (must set country)'
  END as "Status",
  country_code as "Current Country Code"
FROM user_accounts
WHERE user_id = 'YOUR_USER_ID'::UUID;

-- ========================================
-- Query 3: View Country to Currency Mapping
-- ========================================
-- Shows examples of how countries map to currencies

SELECT 
  'COUNTRY → CURRENCY MAPPING EXAMPLES' as "Type",
  'UG → Uganda → UGX (USh)' as "Example 1"
UNION ALL SELECT * FROM (VALUES
  ('', 'KE → Kenya → KES (KSh)'),
  ('', 'TZ → Tanzania → TZS (TSh)'),
  ('', 'US → United States → USD ($)'),
  ('', 'GB → United Kingdom → GBP (£)'),
  ('', 'NG → Nigeria → NGN (₦)')
) AS countries(a, b);

-- ========================================
-- Query 4: Check if You Have ICAN Wallet
-- ========================================
-- Verifies user_accounts record exists with wallet

SELECT 
  'ICAN WALLET STATUS' as "Check",
  CASE 
    WHEN user_id IS NOT NULL THEN 'YES ✅ (wallet exists)'
    ELSE 'NO ❌ (no wallet)'
  END as "Status",
  user_id as "User ID",
  ican_coin_balance as "ICAN Balance"
FROM user_accounts
WHERE user_id = 'YOUR_USER_ID'::UUID;

-- ========================================
-- Query 5: Verify Currency System Working
-- ========================================
-- Shows if all required fields are set

SELECT 
  'CURRENCY SYSTEM CHECK' as "Component",
  user_id IS NOT NULL as "Has User ID",
  country_code IS NOT NULL as "Has Country",
  preferred_currency IS NOT NULL as "Has Currency",
  ican_coin_balance IS NOT NULL as "Has Wallet Balance",
  CASE 
    WHEN user_id IS NOT NULL 
      AND country_code IS NOT NULL 
      AND ican_coin_balance IS NOT NULL 
    THEN 'FULLY OPERATIONAL ✅'
    ELSE 'NEEDS SETUP ⚠️'
  END as "System Status"
FROM user_accounts
WHERE user_id = 'YOUR_USER_ID'::UUID;

-- ========================================
-- Query 6: If Country is NULL - Set It!
-- ========================================
-- Use this update if your country_code is NULL

-- BEFORE RUNNING THIS:
-- 1. Replace 'YOUR_USER_ID' with your actual user ID
-- 2. Replace 'UG' with your correct country code (UG, KE, US, etc.)
-- 3. Comment out if country is already set

-- UPDATE user_accounts
-- SET country_code = 'UG'  -- Change to your country code
-- WHERE user_id = 'YOUR_USER_ID'::UUID;

-- SELECT 'Country updated! Verify with Query 1 above' as "Result";

-- ========================================
-- Query 7: Debug - See All Your Data
-- ========================================
-- Shows complete record for debugging

SELECT 
  user_id,
  country_code,
  preferred_currency,
  ican_coin_balance,
  ican_updated_at,
  created_at,
  updated_at
FROM user_accounts
WHERE user_id = 'YOUR_USER_ID'::UUID;

-- ========================================
-- VERIFICATION CHECKLIST
-- ========================================
-- After running the queries above, verify:
--
-- ✅ Query 1: country_code is NOT NULL (e.g., "UG")
-- ✅ Query 1: preferred_currency is set (e.g., "UGX")
-- ✅ Query 2: Says "YES ✅" (country is set)
-- ✅ Query 4: Says "YES ✅" (wallet exists)
-- ✅ Query 5: Says "FULLY OPERATIONAL ✅"
--
-- If ALL are ✅, your system is working correctly!
-- 
-- If any are ❌, you need to:
// 1. Set your country with Query 6 (uncomment and run)
-- 2. Log out and back in to your app
-- 3. Verify currency now shows in Contribution Modal

-- ========================================
-- QUICK COUNTRY CODE REFERENCE
-- ========================================
-- Use these codes when updating your country:
--
-- East Africa:
--   UG = Uganda (Currency: UGX, Symbol: USh)
--   KE = Kenya (Currency: KES, Symbol: KSh)
--   TZ = Tanzania (Currency: TZS, Symbol: TSh)
--   RW = Rwanda (Currency: RWF, Symbol: FRw)
--
-- West Africa:
--   NG = Nigeria (Currency: NGN, Symbol: ₦)
--   GH = Ghana (Currency: GHS, Symbol: ₵)
--
-- Southern Africa:
--   ZA = South Africa (Currency: ZAR, Symbol: R)
--   BW = Botswana (Currency: BWP, Symbol: P)
--
-- North America:
--   US = United States (Currency: USD, Symbol: $)
--   CA = Canada (Currency: CAD, Symbol: C$)
--
-- Europe:
--   GB = United Kingdom (Currency: GBP, Symbol: £)
--
-- Asia:
--   IN = India (Currency: INR, Symbol: ₹)
--
-- Oceania:
--   AU = Australia (Currency: AUD, Symbol: A$)
