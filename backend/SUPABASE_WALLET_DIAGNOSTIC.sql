/**
 * 🔍 ICAN Wallet System - Diagnostic Script
 * Run this to see what tables exist and their current state
 */

-- Check if tables exist
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';

-- Check wallet_accounts structure if it exists
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'wallet_accounts'
ORDER BY ordinal_position;

-- Check for RLS policies
SELECT schemaname, tablename, policyname, permissive, roles, qual, with_check 
FROM pg_policies 
WHERE schemaname = 'public';

-- Check for triggers
SELECT trigger_schema, trigger_name, event_manipulation, event_object_table 
FROM information_schema.triggers 
WHERE trigger_schema = 'public';
