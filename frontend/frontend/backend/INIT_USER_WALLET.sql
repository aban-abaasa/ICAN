-- Create wallet record for user if it doesn't exist
INSERT INTO ican_user_wallets (user_id, ican_balance, total_spent, total_earned, purchase_count, sale_count)
VALUES (
  'b030496a-e414-449e-b23b-c26ec6bb964a',
  0.00,
  0,
  0,
  0,
  0
)
ON CONFLICT (user_id) DO NOTHING;

-- Verify it was created
SELECT user_id, ican_balance FROM ican_user_wallets 
WHERE user_id = 'b030496a-e414-449e-b23b-c26ec6bb964a';
