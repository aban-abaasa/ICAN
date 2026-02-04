-- First, let's inspect the actual table schemas

-- Check cmms_users table structure
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'cmms_users' 
ORDER BY ordinal_position;

-- Check cmms_user_roles table structure
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'cmms_user_roles' 
ORDER BY ordinal_position;

-- Check cmms_roles table structure
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'cmms_roles' 
ORDER BY ordinal_position;
