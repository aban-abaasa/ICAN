-- Check ACTUAL column names in ican_user_wallets
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'ican_user_wallets'
ORDER BY ordinal_position;

-- Show ONE actual record to see what data looks like
SELECT * FROM ican_user_wallets LIMIT 1;

-- Also check if there's a different wallet table with balance
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'user_wallets'
ORDER BY ordinal_position;

SELECT * FROM user_wallets LIMIT 1;
