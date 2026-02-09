-- =====================================================
-- CHECK EXISTING WALLET BALANCE
-- =====================================================
-- Check wallet for: abana1662@gmail.com
-- User already has an account with existing balance

SELECT 
  id,
  user_id,
  user_email,
  balance,
  pin,
  currency,
  account_type,
  status,
  created_at,
  updated_at
FROM public.user_wallets
WHERE user_email = 'abana1662@gmail.com';
