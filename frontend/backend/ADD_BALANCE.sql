-- =====================================================
-- ADD BALANCE TO EXISTING WALLET
-- =====================================================
-- Add 5000 ICAN to wallet for abana1662@gmail.com

UPDATE public.user_wallets
SET 
  balance = 5000.00,
  updated_at = NOW()
WHERE user_email = 'abana1662@gmail.com';

-- Verify the update
SELECT 
  user_email,
  balance,
  pin,
  currency,
  status
FROM public.user_wallets
WHERE user_email = 'abana1662@gmail.com';
