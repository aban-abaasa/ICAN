/**
 * 💰 ICAN Wallet System - Update User Wallet with Agent Payment
 * Agent has paid 1,000,000 UGX
 */

-- Update wallet with agent payment of 1,000,000 UGX
INSERT INTO public.wallet_accounts (user_id, balance, currency, status)
VALUES (
  '4c25b54b-d6e7-4fd2-b784-66021c41a5d4',
  1000000.00,                               -- Agent payment: 1,000,000 UGX
  'UGX',
  'active'
)
ON CONFLICT (user_id) DO UPDATE SET
  balance = 1000000.00,                     -- Set to agent payment amount
  status = 'active',
  updated_at = NOW();

-- Verify the updated wallet
SELECT id, user_id, balance, currency, status, created_at, updated_at FROM public.wallet_accounts 
WHERE user_id = '4c25b54b-d6e7-4fd2-b784-66021c41a5d4';

