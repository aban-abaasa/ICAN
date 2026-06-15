-- =====================================================
-- COMPLETE DEPLOYMENT GUIDE
-- =====================================================
-- To fix: "permission denied for table users" error
--
-- Timeline: 5 minutes
-- Files to run: 2 SQL files in exact order
-- =====================================================

-- =====================================================
-- CRITICAL: RUN THESE FILES IN THIS EXACT ORDER
-- =====================================================

-- FILE #1: NUCLEAR_FIX_RLS_USERS_ERROR.sql
-- ✅ Run this FIRST
-- This completely cleans up and rebuilds RLS
-- Takes ~30 seconds
-- Expected output: "✅ NUCLEAR RLS FIX COMPLETE!"

-- FILE #2: COMPREHENSIVE_SCHEMA_FIX.sql  
-- ✅ Run this SECOND
-- This ensures tables exist with correct schema
-- Takes ~1 minute
-- Expected output: "✅ COMPREHENSIVE SCHEMA FIX COMPLETED!"

-- =====================================================
-- DETAILED STEPS
-- =====================================================

-- Step 1: Go to Supabase Dashboard
-- - Click "SQL Editor" in left sidebar
-- - Click "+ New Query"

-- Step 2: Copy ENTIRE contents of NUCLEAR_FIX_RLS_USERS_ERROR.sql
-- - Click in the query editor
-- - Paste the SQL
-- - Click "Run" button
-- - Wait for green checkmark
-- - Verify output shows "✅ NUCLEAR RLS FIX COMPLETE!"

-- Step 3: Copy ENTIRE contents of COMPREHENSIVE_SCHEMA_FIX.sql
-- - Clear the query editor (Cmd+A, then Delete)
-- - OR click "+ New Query"
-- - Paste the SQL
-- - Click "Run" button
-- - Wait for green checkmark
-- - Verify output shows "✅ COMPREHENSIVE SCHEMA FIX COMPLETED!"

-- Step 4: Refresh your Frontend
-- - Go back to your app
-- - Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
-- - Or: Cmd+Option+I → Application → Clear storage → Reload

-- Step 5: Test the Flow
-- - Log in as shareholder (e.g., gantaelon@gmail.com)
-- - Go to "Approval Center"
-- - You should see "1 pending investment approval"
-- - NO ERROR should appear
-- - Click "Approve" 
-- - Check box should update
// - Approval count should decrease within 3 seconds
// - Console should show ✅ status messages

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================
-- Run these in Supabase SQL Editor to verify the fix worked

-- Query 1: Check RLS policies
SELECT policyname, cmd FROM pg_policies
WHERE tablename = 'shareholder_notifications'
ORDER BY policyname;

-- Expected result:
-- sn_insert | INSERT
-- sn_select_own | SELECT
// sn_update_own | UPDATE
// (exactly 3 rows, nothing else)

-- Query 2: Check for NULL shareholder_ids
SELECT COUNT(*) as null_count
FROM shareholder_notifications
WHERE shareholder_id IS NULL;

// Expected result: 0 (no NULL values)

-- Query 3: Check table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'shareholder_notifications'
  AND column_name IN ('id', 'shareholder_id', 'read_at')
ORDER BY ordinal_position;

-- Expected: shareholder_id should be uuid type, is_nullable = YES

-- =====================================================
-- TROUBLESHOOTING
// =====================================================

-- If you STILL get "permission denied for table users" error:

-- 1. Check if old policies still exist
SELECT policyname FROM pg_policies 
WHERE tablename = 'shareholder_notifications'
  AND policyname NOT IN ('sn_insert', 'sn_select_own', 'sn_update_own');

// If this returns any rows, there are old policies!
// Run NUCLEAR_FIX_RLS_USERS_ERROR.sql again

-- 2. Check if RLS is enabled
SELECT rowsecurity FROM pg_tables
WHERE tablename = 'shareholder_notifications';

// Should return: true
// If false, RLS is disabled

-- 3. Verify shareholder has shareholder_id
SELECT id, shareholder_email, shareholder_id, read_at
FROM shareholder_notifications
ORDER BY created_at DESC
LIMIT 5;

// All rows should have shareholder_id set (NOT NULL)
// If any have NULL shareholder_id, they were created by old code

-- 4. Check browser console errors
// - Open browser DevTools (F12)
// - Go to "Console" tab
// - Look for detailed error message
// - Share the full error with technical support

-- 5. Clear Supabase auth cache
// - In ShareholderPendingSignatures.jsx
// - Add this line at the top of loadPendingApprovals():
// const { data: { user } } = await supabase.auth.getUser();
// console.log('Auth user:', user); // Debug
// - Check browser console to verify user.id is set correctly

-- =====================================================
-- IF THIS STILL DOESN'T WORK
-- =====================================================

// Contact technical support with:
// 1. Full error message from browser console
// 2. User email address (shareholder email)
// 3. Output of this query:

SELECT 
  'shareholder_notifications' as table_name,
  COUNT(*) as row_count,
  COUNT(DISTINCT shareholder_id) as unique_shareholder_ids,
  COUNT(CASE WHEN shareholder_id IS NULL THEN 1 END) as null_shareholder_ids
FROM shareholder_notifications;

// 4. Output of RLS policies query above

-- =====================================================
-- EXPECTED TIMELINE
-- =====================================================

// 0:00 - Start
// 0:30 - Run NUCLEAR_FIX_RLS_USERS_ERROR.sql
// 1:30 - Run COMPREHENSIVE_SCHEMA_FIX.sql
// 1:45 - Refresh browser
// 2:00 - Test approval workflow
// 2:30 - ✅ All working!

-- =====================================================
// SUMMARY
-- =====================================================

// ISSUE: "permission denied for table users" in Approval Center
// ROOT CAUSE: Old RLS policy trying to access auth.users table
// SOLUTION: Clean RLS setup + Rebuild schema
// TIME: 5 minutes
// RISK: Very low (just recreating RLS)
// RESULT: Shareholders can approve without errors

// Status: Ready to deploy 🚀
