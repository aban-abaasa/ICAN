-- =====================================================
-- APPROVAL COUNT FIX - SUMMARY
-- =====================================================

-- THE PROBLEM:
-- Shareholder approves an investment, but the count stays at "1"
-- Expected: Count should decrease after approval
-- Actual: Count remained the same

-- ROOT CAUSE:
-- In ShareholderPendingSignatures.jsx line 119:
-- const approvedCount = (approvedApprovals?.length || 0) + 1;
--                                                            ^^^
-- THE DOUBLE COUNTING BUG!

-- WHY IT FAILED:
-- 1. UPDATE shareholder_notifications SET read_at = now()
-- 2. Query counts all WHERE read_at IS NOT NULL
-- 3. This query ALREADY includes the current user's approval
-- 4. Adding +1 counts them TWICE
-- Result: Displayed count was too high, showed "2 approvals" when only 1 existed

-- THE FIX:
-- Changed line 119 from:
--   const approvedCount = (approvedApprovals?.length || 0) + 1;
-- To:
--   const approvedCount = approvedApprovals?.length || 0;

-- WHY THIS WORKS:
-- 1. UPDATE sets read_at for current user
-- 2. Query immediately gets count of ALL approved (read_at IS NOT NULL)
-- 3. This count is ALREADY correct and includes current user
-- 4. No +1 needed
-- 5. Correct count is displayed in alert
-- 6. loadPendingApprovals() reloads list (read_at IS NULL only)
-- 7. Approved item disappears from list
-- 8. onApprovalComplete() callback fires
-- 9. Parent's loadCounts() re-queries for pending count
-- 10. UI updates with correct count

-- =====================================================
-- VERIFICATION
-- =====================================================

-- After the fix, run this query to verify:

SELECT 
  COUNT(*) as total_shareholder_notifications,
  COUNT(CASE WHEN read_at IS NOT NULL THEN 1 END) as approved_count,
  COUNT(CASE WHEN read_at IS NULL THEN 1 END) as pending_count
FROM shareholder_notifications
WHERE business_profile_id = '35a1d558-d256-465b-bb16-b023eafb5388'  -- DAB business
ORDER BY created_at DESC;

-- Expected output:
-- total | approved_count | pending_count
-- 2     | 1              | 1           <- After first shareholder approves
-- 2     | 2              | 0           <- After second shareholder approves

-- =====================================================
-- TEST INSTRUCTIONS
-- =====================================================

-- 1. Hard refresh browser: Ctrl+Shift+R
-- 2. Log in as shareholder 1 (e.g., gantaelon@gmail.com)
-- 3. Go to Approval Center
-- 4. See: "1 pending investment approval"
-- 5. Click "Approve"
-- 6. Alert should show: "Progress: 1/2 shareholders (50%)"
-- 7. Count should now show: "0 pending" or disappear
-- 8. loadPendingApprovals() reloads - no items shown
-- 9. Log in as shareholder 2
-- 10. Go to Approval Center
-- 11. See: "1 pending investment approval"
// 12. Click "Approve"
// 13. Alert should show: "60% shareholder approval threshold reached!"
// 14. Agreement should auto-seal
// 15. Funds should be transferred

// =====================================================
// DETAILED APPROVAL FLOW
// =====================================================

// Shareholder clicks "Approve" button
//     ↓
// handleApprove() fires
//     ↓
// UPDATE shareholder_notifications
// SET read_at = now()
// WHERE id = notification_id
// AND shareholder_id = user.id
//     ↓ (UPDATE succeeds)
// Query: SELECT COUNT FROM shareholder_notifications
// WHERE business_profile_id = ?
// AND read_at IS NOT NULL
// Result: approvedCount = 1 (includes current user)
//     ↓
// Calculate: approvalPercent = 1/2 = 50%
//     ↓
// Show alert: "Progress: 1/2 shareholders (50%)"
//     ↓
// Call: loadPendingApprovals()
//     ↓
// Query: SELECT * FROM shareholder_notifications
// WHERE shareholder_id = user.id
// AND read_at IS NULL
// Result: [] (empty - current user already approved)
//     ↓
// setPendingApprovals([])
// UI re-renders: Approve button disappears ✅
//     ↓
// Call: onApprovalComplete() callback
//     ↓
// Parent calls: loadCounts()
// Query: SELECT COUNT FROM shareholder_notifications
// WHERE read_at IS NULL
// Result: shareholderCount = 1 (other approvals still pending)
//     ↓
// setShareholderCount(1)
// UI updates: Shows "1 pending approval" ✅
//     ↓
// Result: All correct! ✅

