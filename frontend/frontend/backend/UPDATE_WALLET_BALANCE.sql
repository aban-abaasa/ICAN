-- =====================================================
-- CHECK AND UPDATE WALLET BALANCE
-- =====================================================
-- Check current balance for abana1662@gmail.com

SELECT 
  id,
  user_id,
  user_email,
  balance,
  pin,
  status
FROM public.user_wallets
WHERE user_email = 'abana1662@gmail.com';

-- Update balance to 5000 ICAN
UPDATE public.user_wallets
SET 
  balance = 5000.00,
  updated_at = NOW()
WHERE user_email = 'abana1662@gmail.com';

-- Verify the update
SELECT 
  user_email,
  balance,
  updated_at
FROM public.user_wallets
WHERE user_email = 'abana1662@gmail.com';
