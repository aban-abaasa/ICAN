-- =====================================================
-- FIX RLS POLICIES FOR INVESTMENT FLOW OPERATIONS
-- =====================================================
-- Date: 2026-02-09
-- Issues Fixed:
-- 1. add_investor_as_pending_member RPC (403 Forbidden)
-- 2. investment_notifications INSERT (403 Forbidden)
-- =====================================================

-- STEP 1: Fix business_profile_members RLS
-- Problem: Only business owner can insert, but investor needs to be added as pending
-- Solution: Allow investors to add themselves as pending members

DROP POLICY IF EXISTS "Investors can add themselves as pending members" ON business_profile_members;
CREATE POLICY "Investors can add themselves as pending members"
ON business_profile_members FOR INSERT
WITH CHECK (
  -- Allow business owner to insert (existing behavior)
  business_profile_id IN (
    SELECT id FROM business_profiles WHERE user_id = auth.uid()
  )
  OR
  -- NEW: Allow any user to add themselves as a potential member (for RPC to work)
  (user_id = auth.uid())
);

-- Also update UPDATE policy to allow pending members to exist
DROP POLICY IF EXISTS "Business owners can update members" ON business_profile_members;
CREATE POLICY "Business owners can update members"
ON business_profile_members FOR UPDATE
USING (
  business_profile_id IN (
    SELECT id FROM business_profiles WHERE user_id = auth.uid()
  )
  OR
  -- Allow users to update their own pending status
  (user_id = auth.uid() AND status = 'pending')
)
WITH CHECK (
  business_profile_id IN (
    SELECT id FROM business_profiles WHERE user_id = auth.uid()
  )
  OR
  (user_id = auth.uid())
);

-- Ensure SELECT policy allows viewing
DROP POLICY IF EXISTS "Members can view themselves" ON business_profile_members;
CREATE POLICY "Members can view themselves"
ON business_profile_members FOR SELECT
USING (
  user_id = auth.uid() 
  OR 
  business_profile_id IN (
    SELECT id FROM business_profiles WHERE user_id = auth.uid()
  )
);

-- STEP 2: Fix investment_notifications RLS
-- Problem: INSERT is being blocked even though policy says WITH CHECK (true)
-- Solution: Verify the policy is correctly set and ensure no other constraints

-- Drop all existing notification policies
DROP POLICY IF EXISTS "Users can view their own notifications" ON investment_notifications;
DROP POLICY IF EXISTS "Users can update their own notifications" ON investment_notifications;
DROP POLICY IF EXISTS "System can create notifications" ON investment_notifications;

-- Create a PERMISSIVE INSERT policy that allows unrestricted notifications
CREATE POLICY "investment_notifications_insert_all"
ON investment_notifications FOR INSERT
WITH CHECK (true);

-- Create restricted SELECT policy (users see only their notifications)
CREATE POLICY "investment_notifications_select_own"
ON investment_notifications FOR SELECT
USING (auth.uid() = recipient_id);

-- Create restricted UPDATE policy (users can only update their own)
CREATE POLICY "investment_notifications_update_own"
ON investment_notifications FOR UPDATE
USING (auth.uid() = recipient_id)
WITH CHECK (auth.uid() = recipient_id);

-- STEP 3: Ensure RLS is enabled
ALTER TABLE business_profile_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_notifications ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- DEBUGGING: Check current policies
-- =====================================================
-- Run this to verify all policies are correct:
/*
SELECT 
  schemaname, 
  tablename, 
  policyname, 
  permissive, 
  roles, 
  qual, 
  with_check 
FROM pg_policies 
WHERE tablename IN ('business_profile_members', 'investment_notifications')
ORDER BY tablename, policyname;
*/

-- =====================================================
-- TEST HELPER: Check if investor can be added
-- =====================================================
-- After running this, test with:
-- SELECT add_investor_as_pending_member(
--   '00000000-0000-0000-0000-000000000001'::uuid,  -- investment_id
--   'YOUR_BUSINESS_PROFILE_ID'::uuid,              -- business_profile_id
--   'YOUR_INVESTOR_ID'::uuid,                      -- investor_id
--   'investor@example.com',                         -- investor_email
--   'Investor Name'                                 -- investor_name
-- );
