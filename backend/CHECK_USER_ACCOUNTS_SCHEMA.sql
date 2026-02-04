-- Check the structure of user_accounts table
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'user_accounts'
ORDER BY ordinal_position;
