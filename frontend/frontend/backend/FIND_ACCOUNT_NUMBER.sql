-- Find where account number ICAN-0389329785396722 is stored
SELECT 'ican_user_wallets' as table_name, * FROM ican_user_wallets WHERE user_id = (SELECT user_id FROM ican_user_wallets LIMIT 1) LIMIT 1;

SELECT 'wallet_accounts' as table_name, * FROM wallet_accounts WHERE account_number = 'ICAN-0389329785396722' LIMIT 1;

SELECT 'user_accounts' as table_name, * FROM user_accounts WHERE account_number = 'ICAN-0389329785396722' LIMIT 1;

-- If not found, show me what columns wallet_accounts has
SELECT column_name FROM information_schema.columns WHERE table_name = 'wallet_accounts';
