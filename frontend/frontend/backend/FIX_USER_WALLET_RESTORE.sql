-- Create wallet with the 2 ICAN coins from your purchase
INSERT INTO ican_user_wallets (user_id, ican_balance, total_spent, total_earned, purchase_count, sale_count)
VALUES (
  'b030496a-e414-449e-b23b-c26ec6bb964a',
  2.00000000,
  10000,
  0,
  1,
  0
)
ON CONFLICT (user_id) DO UPDATE SET
  ican_balance = 2.00000000,
  total_spent = 10000,
  purchase_count = 1;

-- Verify
SELECT user_id, ican_balance, total_spent, purchase_count FROM ican_user_wallets 
WHERE user_id = 'b030496a-e414-449e-b23b-c26ec6bb964a';
