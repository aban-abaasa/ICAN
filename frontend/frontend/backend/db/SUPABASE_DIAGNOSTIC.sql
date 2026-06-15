-- ============================================
-- DIAGNOSTIC QUERY - Check Your Table Structure
-- ============================================
-- Run this in Supabase SQL Editor to see what columns exist

-- 1. List all tables in public schema
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';

-- 2. Show all columns in transactions table (if it exists)
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'transactions'
ORDER BY ordinal_position;

-- 3. Show sample data from transactions table
SELECT * FROM transactions LIMIT 5;

-- After running these, share the results so I can adapt the schema
-- OR if the table doesn't exist at all, let me know and I'll create it from scratch
