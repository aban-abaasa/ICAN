-- Find where Aban's 100,000 balance actually is stored
-- User ID: b030496a-e414-449e-b23b-c26ec6bb964a

SELECT 'CHECKING user_wallets' as table_check;
SELECT * FROM user_wallets 
WHERE user_id = 'b030496a-e414-449e-b23b-c26ec6bb964a';

SELECT 'CHECKING wallet_accounts' as table_check;
SELECT * FROM wallet_accounts 
WHERE user_id = 'b030496a-e414-449e-b23b-c26ec6bb964a';

SELECT 'CHECKING wallet_transactions' as table_check;
SELECT * FROM wallet_transactions 
WHERE user_id = 'b030496a-e414-449e-b23b-c26ec6bb964a' 
LIMIT 5;

SELECT 'SAMPLE FROM user_wallets' as table_check;
SELECT * FROM user_wallets LIMIT 3;

SELECT 'SAMPLE FROM wallet_accounts' as table_check;
SELECT * FROM wallet_accounts LIMIT 3;

SELECT 'SAMPLE FROM ican_user_wallets' as table_check;
SELECT * FROM ican_user_wallets LIMIT 3;
