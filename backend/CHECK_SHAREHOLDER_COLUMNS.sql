-- Check what columns shareholder_notifications actually has
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_name = 'shareholder_notifications'
ORDER BY ordinal_position;
