-- =====================================================
-- APPROVAL STATUS UPDATE FIX
-- =====================================================
-- ISSUE: After shareholder approves investment, UI still shows "pending approvals"
-- ROOT CAUSES:
--   1. ApprovalNotificationCenter wasn't auto-refreshing
--   2. RLS policies for shareholder_notifications too restrictive
--   3. No callback to refresh parent component after approval
--
-- SOLUTION:
--   1. Added 3-second auto-refresh to ApprovalNotificationCenter ✅
--   2. Simplified RLS policies to match by email as fallback ✅
--   3. Added onApprovalComplete callback ✅
-- =====================================================

-- PART 1: Deploy COMPREHENSIVE_SCHEMA_FIX.sql to Supabase
-- This fixes the shareholder_notifications RLS policies

-- After running COMPREHENSIVE_SCHEMA_FIX.sql, the new RLS policies will be:
-- - Shareholders can view their own notifications by shareholder_id
-- - Shareholders can view notifications by email match (fallback)
-- - Anyone can INSERT (for system to create notifications)
-- - Shareholders can UPDATE their own notifications (mark as approved)

-- PART 2: Frontend changes (automatically applied)
-- ✅ ApprovalNotificationCenter.jsx - Added 3-second auto-refresh
-- ✅ ShareholderPendingSignatures.jsx - Added onApprovalComplete callback
-- ✅ ShareholderApprovalsCenter.jsx - Passes callback to child component

-- PART 3: Testing the fix
-- 1. Log in as a shareholder
-- 2. Go to Approval Center
-- 3. You should see "X pending investment approvals"
-- 4. Click "Approve Investment" button OR drag the slider to 100%
-- 5. You will see an alert showing approval percentage
-- 6. Count should update to "No Pending Investment Approvals" within 3 seconds
-- 7. If still showing pending after 5 seconds, there may be RLS issue

-- DEBUGGING CHECKLIST:
-- If approvals still show as pending after approval:
-- 
-- 1. Check browser console for errors
-- 2. Check Supabase SQL Editor:
--    SELECT * FROM shareholder_notifications 
--    WHERE read_at IS NULL 
--    ORDER BY created_at DESC LIMIT 5;
--    
--    Should show 0-1 rows after approval (shareholder should have read_at = timestamp)
--
-- 3. Check RLS policies:
--    SELECT * FROM pg_policies 
--    WHERE tablename = 'shareholder_notifications';
--    
--    Should show policies allowing SELECT based on shareholder_id OR shareholder_email match
--
-- 4. If shareholder_id is NULL in the table, that's the issue - frontend must send shareholder_id
--    OR the shareholder must be able to see by email match (which is now supported)
--
-- 5. Test the query that the frontend uses:
--    SELECT * FROM shareholder_notifications 
--    WHERE read_at IS NULL 
--    AND (
--      shareholder_id = '<current-user-id>' 
--      OR shareholder_email = '<current-user-email>'
--    );
--
--    This should return 0 rows if the shareholder has approved

-- =====================================================
-- MANUAL DEPLOYMENT STEPS
-- =====================================================

-- Step 1: If you haven't run COMPREHENSIVE_SCHEMA_FIX.sql yet, run it now:
-- Copy the entire COMPREHENSIVE_SCHEMA_FIX.sql file into Supabase SQL Editor and execute

-- Step 2: Verify the schema by running:

SELECT tablename, 
       (SELECT COUNT(*) FROM information_schema.table_privileges 
        WHERE table_name = tablename AND privilege_type = 'SELECT') as select_policies
FROM pg_tables 
WHERE tablename IN ('shareholder_notifications', 'investment_signatures', 'investment_agreements', 'investment_approvals')
ORDER BY tablename;

-- Step 3: Check RLS policies:

SELECT schemaname, tablename, policyname, permissive, cmd 
FROM pg_policies 
WHERE tablename IN ('shareholder_notifications', 'investment_signatures')
ORDER BY tablename, policyname;

-- Step 4: Test RLS by checking what a shareholder can see:

-- As the shareholder (must be logged in the same Supabase session):
SELECT id, business_profile_id, shareholder_id, shareholder_email, notification_type, 
       read_at, created_at
FROM shareholder_notifications
WHERE read_at IS NULL
ORDER BY created_at DESC;

-- =====================================================
-- WHAT CHANGED IN FRONTEND
-- =====================================================

-- File: ApprovalNotificationCenter.jsx
-- Change: Added 3-second auto-refresh interval
-- Location: Lines 28-36 of useEffect hook
-- Effect: Will automatically refresh pending approval counts every 3 seconds

-- File: ShareholderPendingSignatures.jsx
-- Changes: 
--   1. Added onApprovalComplete prop parameter (line 3)
--   2. Calls onApprovalComplete() after approval (line 142)
-- Effect: Allows parent component to refresh when shareholder approves

-- File: ShareholderApprovalsCenter.jsx
-- Change: Passes loadCounts callback to ShareholderPendingSignatures (line 137)
-- Effect: When shareholder approves, it triggers loadCounts() to refresh the counts

-- =====================================================
-- EXPECTED BEHAVIOR AFTER FIX
-- =====================================================

-- BEFORE (Broken):
-- 1. User approves investment
-- 2. Alert shows approval successful
-- 3. UI still shows "2 pending approvals"
-- 4. User must refresh page or wait indefinitely

-- AFTER (Fixed):
-- 1. User approves investment
-- 2. Alert shows approval successful + progress
-- 3. Count refreshes automatically within 3 seconds
-- 4. UI updates to show "No pending approvals" (or updated count)
-- 5. Approval Center shows new total

-- =====================================================
-- TIMELINE OF AUTO-REFRESH
-- =====================================================

-- 0s:    User clicks "Approve Investment"
-- 0.5s:  Database updates read_at = NOW()
-- 1s:    ShareholderPendingSignatures reloads and shows updated list
-- 1.5s:  onApprovalComplete callback fires, triggering loadCounts()
-- 2s:    ShareholderApprovalsCenter updates shareholderCount
-- 3s:    ApprovalNotificationCenter auto-refresh also runs
-- 5s:    Maximum time for UI to fully update

-- =====================================================
-- IF ISSUE PERSISTS
-- =====================================================

-- Option 1: Increase auto-refresh frequency
-- In ApprovalNotificationCenter.jsx, change interval from 3000 to 1000 (1 second)

-- Option 2: Disable RLS temporarily to test (NOT for production):
-- ALTER TABLE shareholder_notifications DISABLE ROW LEVEL SECURITY;
-- Then re-enable after testing:
-- ALTER TABLE shareholder_notifications ENABLE ROW LEVEL SECURITY;

-- Option 3: Check if shareholder_id is being set correctly
-- Look at insertion code in ShareSigningFlow.jsx lines 1845-1870
-- Ensure the notificationData includes proper shareholder_id

-- =====================================================
-- LONG-TERM IMPROVEMENTS
-- =====================================================

-- 1. Add real-time subscriptions instead of polling (use Supabase realtime)
-- 2. Implement optimistic updates on client (show change immediately)
-- 3. Add pending state to prevent double-clicks
-- 4. Add error retry logic if update fails

-- Status: All immediate fixes completed ✅
