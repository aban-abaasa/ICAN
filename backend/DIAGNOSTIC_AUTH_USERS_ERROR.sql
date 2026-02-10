-- =====================================================
-- DIAGNOSTIC: Find where auth.users is being accessed
-- =====================================================

-- Query 1: Check shareholder_notifications RLS policies
SELECT 
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'shareholder_notifications'
ORDER BY policyname;

-- Expected: Should show 3 policies: sn_insert, sn_select_own, sn_update_own
-- Each with NO reference to "users" in the qual column

-- =====================================================

-- Query 2: Check investment_notifications (if exists)
SELECT 
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'investment_notifications'
ORDER BY policyname;

-- =====================================================

-- Query 3: Check business_profile_members RLS
SELECT 
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'business_profile_members'
ORDER BY policyname;

-- =====================================================

-- Query 4: Find ALL policies that reference "users" table
SELECT 
  schemaname,
  tablename,
  policyname,
  qual
FROM pg_policies
WHERE qual LIKE '%users%'
   OR qual LIKE '%auth.users%'
ORDER BY tablename, policyname;

-- ⚠️ If this returns ANY rows, those are the problems!

-- =====================================================

-- Query 5: Check if there are any RPC functions
SELECT 
  p.proname,
  p.prosecdef,
  pg_get_functiondef(p.oid) as function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname LIKE '%shareholder%'
LIMIT 5;

-- =====================================================

-- Query 6: Check table structure
SELECT 
  tablename,
  rowsecurity
FROM pg_tables 
WHERE tablename IN (
  'shareholder_notifications',
  'investment_notifications',
  'business_profile_members',
  'investment_approvals'
)
ORDER BY tablename;

-- Expected: All should have rowsecurity = true

-- =====================================================

-- Query 7: If you find policies with auth.users, 
-- Run this to see exactly which ones:

SELECT 
  tablename,
  policyname
FROM pg_policies
WHERE qual ILIKE '%auth.users%'
  OR qual ILIKE '%auth\.users%';

-- For EACH one found, run:
-- DROP POLICY "policy_name" ON table_name;
-- Then recreate it WITHOUT auth.users access

-- =====================================================
-- ACTION PLAN
-- =====================================================

-- If Query 4 returns NO rows:
-- → The SQL file worked correctly
-- → The error is coming from FRONTEND code
-- → Check ShareholderPendingSignatures.jsx for direct auth.users queries

-- If Query 4 returns rows:
-- → Old policies still exist
-- → Run this command for EACH policy found:
-- → DROP POLICY "policy_name" ON table_name;
-- → Then run NUCLEAR_FIX_RLS_USERS_ERROR.sql again
