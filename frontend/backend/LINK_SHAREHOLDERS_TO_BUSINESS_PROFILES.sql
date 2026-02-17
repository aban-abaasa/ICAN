-- ============================================================================
-- LINK SHAREHOLDERS TO BUSINESS PROFILES
-- ============================================================================
-- PURPOSE: Ensure all shareholders are properly linked to their business 
--          profiles so the approval notification system works correctly
--
-- PROBLEM: Shareholders weren't being fetched because:
-- 1. business_profile_id wasn't set in business_co_owners
-- 2. Co-owners weren't linked to specific business profiles
-- 3. Approval workflow couldn't identify which shareholders need to approve
--
-- SOLUTION: This script ensures proper linking so that:
-- 1. Each shareholder has a valid business_profile_id
-- 2. Investors are excluded from their own approval lists
-- 3. Notifications can be sent to correct shareholders
-- ============================================================================

-- Step 1: Check for missing business_profile_id in shareholders (business_co_owners)
-- Run this query to see if any shareholders are missing the link
SELECT 
  id,
  owner_name,
  owner_email,
  business_profile_id,
  user_id,
  'MISSING PROFILE' as status
FROM business_co_owners
WHERE business_profile_id IS NULL
ORDER BY created_at DESC;

-- Step 2: Fix shareholders that are missing business_profile_id
-- If you find missing links, use this pattern:
-- UPDATE business_co_owners 
-- SET business_profile_id = 'UUID_OF_BUSINESS'
-- WHERE id = 'UUID_OF_SHAREHOLDER' AND business_profile_id IS NULL;

-- Step 3: Verify all business profiles have at least one shareholder
SELECT 
  bp.id as business_profile_id,
  bp.business_name,
  bp.user_id as owner_user_id,
  COUNT(bco.id) as shareholder_count,
  STRING_AGG(DISTINCT bco.owner_name, ', ') as shareholder_names
FROM business_profiles bp
LEFT JOIN business_co_owners bco ON bp.id = bco.business_profile_id
GROUP BY bp.id, bp.business_name, bp.user_id
ORDER BY shareholder_count ASC;

-- Step 4: Create view for easy shareholder lookup
-- This view shows all shareholders for a business, excluding the investor
CREATE OR REPLACE VIEW business_shareholders_for_approval AS
SELECT 
  bco.id as shareholder_id,
  bco.owner_name as shareholder_name,
  bco.owner_email as shareholder_email,
  bco.user_id,
  bco.business_profile_id,
  bp.business_name,
  bp.user_id as investor_id,
  bco.ownership_share,
  bco.role,
  -- Flag: Is this shareholder the investor (business owner)?
  (bco.user_id = bp.user_id) as is_investor,
  -- For approval: exclude if they ARE the investor
  (bco.user_id != bp.user_id AND bco.user_id IS NOT NULL) as is_eligible_for_approval
FROM business_co_owners bco
JOIN business_profiles bp ON bco.business_profile_id = bp.id
WHERE bco.status IS NULL OR bco.status = 'active'
ORDER BY bco.created_at;

-- Step 5: Manually ensure correct relationships
-- EXAMPLE: If "Abaasa Aban" is the investor, find their shareholders:
SELECT 
  bp.id as business_profile_id,
  bp.business_name,
  bp.user_id as investor_user_id,
  auth_user.email as investor_email,
  COUNT(bco.id) as total_shareholders,
  SUM(CASE WHEN bco.user_id != bp.user_id THEN 1 ELSE 0 END) as shareholders_needing_approval
FROM business_profiles bp
LEFT JOIN auth.users auth_user ON bp.user_id = auth_user.id
LEFT JOIN business_co_owners bco ON bp.id = bco.business_profile_id
WHERE auth_user.email LIKE '%aban%' OR auth_user.email LIKE '%abaasa%'
GROUP BY bp.id, bp.business_name, bp.user_id, auth_user.email;

-- Step 6: FIX: Add missing business_profile_id for specific shareholder
-- INSTRUCTIONS: 
-- 1. Run Step 5 query to find the business_profile_id for your business
-- 2. Replace 'YOUR_SHAREHOLDER_UUID' with the shareholder ID
-- 3. Replace 'YOUR_BUSINESS_PROFILE_UUID' with the business profile ID
-- 4. Uncomment and run:
/*
UPDATE business_co_owners
SET business_profile_id = 'YOUR_BUSINESS_PROFILE_UUID'
WHERE id = 'YOUR_SHAREHOLDER_UUID' 
  AND business_profile_id IS NULL;
*/

-- Step 7: Verify the fix worked
-- After running the fix above, verify with this query:
SELECT 
  'SHAREHOLDERS FOR APPROVAL' as check_type,
  COUNT(*) as count,
  STRING_AGG(DISTINCT shareholder_name, ', ') as names
FROM business_shareholders_for_approval
WHERE is_eligible_for_approval = true;

-- Step 8: Create index for fast shareholder lookups during approval
CREATE INDEX IF NOT EXISTS idx_business_co_owners_approval_check
ON business_co_owners(business_profile_id, user_id)
WHERE status IS NULL OR status = 'active';

-- Step 9: Verify notification will go to correct shareholders
-- OPTIONAL - Only run AFTER you've fixed the links
-- Replace 'INSERT_YOUR_BUSINESS_PROFILE_ID' with the actual UUID from Step 3
-- Example: SELECT ... WHERE business_profile_id = '550e8400-e29b-41d4-a716-446655440000'
/*
SELECT 
  'NOTIFICATION TEST' as check,
  COUNT(*) as shareholders_will_be_notified,
  STRING_AGG(shareholder_name, ', ') as shareholder_names
FROM business_shareholders_for_approval
WHERE is_eligible_for_approval = true
  AND business_profile_id = 'INSERT_YOUR_BUSINESS_PROFILE_ID';
*/

-- ============================================================================
-- HOW TO USE THIS FILE:
-- ============================================================================
-- 1. Run Step 1 to see if shareholders are missing business_profile_id
-- 2. If missing: Get the UUID from Step 3 or Step 5
-- 3. Run Step 6 (uncommented) with correct shareholder UUIDs to link them
-- 4. Run Step 7 to verify the fix worked
-- 5. Run Step 9 with your business_profile_id to confirm before testing
-- 6. Now test the shareholder approval notifications in the app
-- ============================================================================
