-- =====================================================
-- FUND TEST WALLET FOR INVESTMENT TESTING
-- =====================================================
-- This script adds test balance to your wallet

-- Update your wallet with test balance (5000 ICAN)
UPDATE public.user_wallets
SET 
  balance = 5000.00,
  updated_at = NOW()
WHERE user_email = auth.email();

-- Verify the update
SELECT 
  id,
  user_email,
  balance,
  currency,
  status,
  created_at
FROM public.user_wallets
WHERE user_email = auth.email();

-- =====================================================
-- ALTERNATIVE: If above doesn't work, use this with your actual email
-- =====================================================
-- UPDATE public.user_wallets
-- SET 
--   balance = 5000.00,
--   updated_at = NOW()
-- WHERE user_email = 'your-email@example.com';
