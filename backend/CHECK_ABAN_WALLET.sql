-- Check ICAN wallet for Aban (investor)
-- User ID: b030496a-e414-449e-b23b-c26ec6bb964a
-- Email: abana1662@gmail.com

-- Check if wallet exists for this user
SELECT 
  id,
  user_id,
  ican_balance,
  total_spent,
  total_earned,
  purchase_count,
  sale_count,
  created_at,
  updated_at
FROM ican_user_wallets 
WHERE user_id = 'b030496a-e414-449e-b23b-c26ec6bb964a';

-- Show ALL wallets to verify records exist
SELECT COUNT(*) as total_wallets FROM ican_user_wallets;

-- Show 5 sample wallets
SELECT 
  id,
  user_id,
  ican_balance,
  total_spent,
  total_earned
FROM ican_user_wallets 
LIMIT 5;

-- Check if user exists in profiles
SELECT 'USER IN PROFILES' as check_name;
SELECT id, email, full_name FROM profiles WHERE id = 'b030496a-e414-449e-b23b-c26ec6bb964a';

-- Check user by email
SELECT 'USER BY EMAIL' as check_name;
SELECT id, email, full_name FROM profiles WHERE email = 'abana1662@gmail.com';

