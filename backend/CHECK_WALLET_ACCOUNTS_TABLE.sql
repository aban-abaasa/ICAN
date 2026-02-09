-- Check if wallet_accounts has records for Aban
SELECT * FROM wallet_accounts 
WHERE user_id = 'b030496a-e414-449e-b23b-c26ec6bb964a';

-- Show all currencies in wallet_accounts for this user
SELECT user_id, currency, balance FROM wallet_accounts 
WHERE user_id = 'b030496a-e414-449e-b23b-c26ec6bb964a';

-- If empty, show sample wallet_accounts records
SELECT 'SAMPLE wallet_accounts' as info;
SELECT * FROM wallet_accounts LIMIT 5;

-- Check user_accounts table instead
SELECT 'CHECKING user_accounts' as info;
SELECT * FROM user_accounts 
WHERE user_id = 'b030496a-e414-449e-b23b-c26ec6bb964a';

-- Show sample user_accounts
SELECT 'SAMPLE user_accounts' as info;
SELECT * FROM user_accounts LIMIT 5;
