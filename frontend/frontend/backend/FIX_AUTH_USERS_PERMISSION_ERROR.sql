-- =====================================================
-- FIX: RLS "permission denied for table users" ERRORS
-- =====================================================
-- Issue: Shareholders get 403 error when trying to approve
-- Error: "permission denied for table users" (code 42501)
--
-- Root Cause: RLS policy was querying auth.users table
-- Solution: Simplified RLS + Fixed frontend to set shareholder_id
-- =====================================================

-- =====================================================
-- CHANGES MADE
-- =====================================================

-- DATABASE CHANGES (COMPREHENSIVE_SCHEMA_FIX.sql):
-- ✅ Simplified RLS policies to NOT query auth.users
-- ✅ Uses only shareholder_id matching with auth.uid()
-- ✅ Removed email-based fallback (requires auth.users access)

-- FRONTEND CHANGES:
-- ✅ ShareSigningFlow.jsx: ALWAYS set shareholder_id in notifications
-- ✅ ShareholderPendingSignatures.jsx: 
--    - Include shareholder_id in UPDATE filter
--    - Include shareholder_id in SELECT filter
--    - Only fetch unregistered byEmail if shareholder_id IS NULL

-- =====================================================
-- RLS POLICIES (SIMPLIFIED)
-- =====================================================

-- INSERT: Unrestricted (anyone/system can create notifications)
CREATE POLICY "allow_insert_notifications"
  ON shareholder_notifications FOR INSERT
  WITH CHECK (true);

-- SELECT: Only notifications addressed to current user
CREATE POLICY "shareholders_view_own_notifications"
  ON shareholder_notifications FOR SELECT
  USING (auth.uid() = shareholder_id);

-- UPDATE: Only current user can mark their notifications as read
CREATE POLICY "shareholders_update_own_notifications"
  ON shareholder_notifications FOR UPDATE
  USING (auth.uid() = shareholder_id);

-- This is MUCH simpler and avoids auth.users table access!

-- =====================================================
-- FRONTEND FLOW (CORRECTED)
-- =====================================================

-- When sending approval notifications to shareholders:
--
-- 1. ShareSigningFlow identifies all business_co_owners
-- 2. For EACH co-owner:
--    - Check if they have user_id (registered in auth)
--    - If YES: Include shareholder_id in notification
--    - If NO: Skip them (can't approve online without auth account)
-- 3. Insert notifications with shareholder_id set

-- When shareholder approves:
--
-- 1. ShareholderPendingSignatures loads notifications
--    Query: WHERE shareholder_id = auth.uid() AND read_at IS NULL
-- 2. Shareholder clicks "Approve"
-- 3. Update notification: UPDATE ... SET read_at = NOW()
--    Filter: WHERE id = notification_id AND shareholder_id = auth.uid()
-- 4. Check if 60% threshold reached
-- 5. Refresh UI with new totals

-- =====================================================
-- IMPORTANT: UNREGISTERED SHAREHOLDERS
-- =====================================================

-- Unregistered shareholders (no Supabase auth account):
-- ❌ CANNOT approve online in the current system
-- ✅ CAN be recorded as co-owners in business_co_owners
-- ✅ CAN be part of the 60% threshold calculation
-- ⚠️ May need separate offline approval process

-- If you need unregistered shareholders to approve:
-- Option 1: Create auto-generated auth accounts for them
-- Option 2: Change RLS to allow unregistered approvals (risky)
-- Option 3: Create separate approval flow with email verification

-- =====================================================
-- DEPLOYMENT STEPS
-- =====================================================

-- Step 1: Run COMPREHENSIVE_SCHEMA_FIX.sql (with simplified RLS)
-- Step 2: Frontend changes are ALREADY APPLIED:
--         - ShareSigningFlow.jsx (shareholder_id always set)
--         - ShareholderPendingSignatures.jsx (filtered queries)
-- Step 3: Refresh browser with Cmd+Shift+R or Ctrl+Shift+R
-- Step 4: Test shareholder approval workflow

-- =====================================================
-- TESTING CHECKLIST
-- =====================================================

-- ✅ Create investment as investor
-- ✅ Investor verifies PIN
-- ✅ Investment agreement created
-- ✅ Investment signatures created
-- ✅ RPC add_investor_as_pending_member succeeds (or gracefully fails)
-- ✅ Investment notifications created (no 403 error)
-- ✅ Shareholder sees "Pending Investment Approvals"
-- ✅ Shareholder clicks "Approve"
-- ✅ No PATCH 403 error on read_at update
-- ✅ Approval count increases
-- ✅ When 60%+ approved, funds transfer

-- =====================================================
-- DEBUGGING QUERIES (Run in Supabase SQL Editor)
-- =====================================================

-- Check what RLS policies exist:
SELECT policyname, permissive, cmd FROM pg_policies
WHERE tablename = 'shareholder_notifications'
ORDER BY policyname;

-- Expected output:
-- allow_insert_notifications | t | INSERT
-- shareholders_view_own_notifications | t | SELECT
-- shareholders_update_own_notifications | t | UPDATE

-- Check notifications with NULL shareholder_id (unregistered):
SELECT id, business_profile_id, shareholder_email, shareholder_id, read_at
FROM shareholder_notifications
WHERE shareholder_id IS NULL
LIMIT 5;

-- If you see results, those shareholders can't approve!
-- They need shareholder_id to be set.

-- Check notifications created with shareholder_id:
SELECT id, business_profile_id, shareholder_email, shareholder_id, read_at
FROM shareholder_notifications
WHERE shareholder_id IS NOT NULL
LIMIT 5;

-- These should be queryable by the shareholder (auth.uid() = shareholder_id)

-- =====================================================
-- IF ERRORS STILL OCCUR
-- =====================================================

-- If you still get "permission denied for table users":
-- 1. Check that the RLS policies have been updated
-- 2. Clear browser cache (Cmd+Shift+R)
-- 3. Verify shareholder_id is being set in the INSERT

-- If you still get 403 on UPDATE:
-- 1. Make sure ShareholderPendingSignatures has the
--    .eq('shareholder_id', user.id) filter
-- 2. Verify the notification was created with this shareholder_id
-- 3. Run verification query above

-- If unregistered shareholders need to approve:
-- 1. Create auth accounts for them before investment
-- 2. OR implement alternate approval mechanism
-- 3. OR ask business owner to approve on their behalf

-- =====================================================
-- SUCCESS INDICATORS
-- =====================================================

-- ✅ Shareholder can load pending approvals (no 403 SELECT error)
-- ✅ Shareholder can mark as approved (no 403 UPDATE error)
-- ✅ Approval count updates in UI within 3 seconds
-- ✅ When 60% approve, investment auto-seals
-- ✅ Funds transfer initiated
-- ✅ Console shows ✅ status messages, no ⚠️ warnings

-- Timeline: < 5 seconds from approval to UI update

-- =====================================================
-- SUMMARY
-- =====================================================

-- Issue: RLS policy querying auth.users was blocking shareholders
-- Solution: Simplified RLS to use only shareholder_id comparison
-- Result: Shareholders can approve without permission errors
-- Trade-off: Unregistered shareholders must be registered users

-- Status: ✅ READY FOR TESTING
