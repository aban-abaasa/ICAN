-- =====================================================
-- CLEAN UP DUPLICATE ESCROW WALLETS - KEEP ONLY ONE
-- =====================================================
-- Keep only the oldest (first created) escrow wallet
DELETE FROM public.user_wallets
WHERE account_type = 'escrow' 
  AND user_email = 'abanabaasa2@gmail.com'
  AND id NOT IN (
    SELECT id FROM public.user_wallets
    WHERE account_type = 'escrow' 
      AND user_email = 'abanabaasa2@gmail.com'
    ORDER BY created_at ASC
    LIMIT 1
  );

-- Verify only ONE escrow wallet remains
SELECT 
  id,
  user_email,
  account_type,
  balance,
  status,
  created_at
FROM public.user_wallets
WHERE account_type = 'escrow'
  AND user_email = 'abanabaasa2@gmail.com';
