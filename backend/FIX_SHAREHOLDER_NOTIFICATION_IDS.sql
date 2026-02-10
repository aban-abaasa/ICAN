-- =====================================================
-- DIAGNOSE: Check shareholder notifications mismatch
-- =====================================================

-- Run these queries to find the problem:

-- Query 1: Check ALL shareholder notifications for the DAB business
SELECT 
  id,
  business_profile_id,
  shareholder_id,
  shareholder_email,
  notification_title,
  read_at,
  created_at
FROM shareholder_notifications
WHERE business_profile_id IN (
  SELECT id FROM business_profiles WHERE business_name = 'DAB'
)
ORDER BY created_at DESC;

-- This should show:
-- - Multiple rows (one per shareholder)
-- - Some with shareholder_id = NULL or wrong user_id
-- - Some marked with read_at timestamp (approved)

-- =====================================================

-- Query 2: Get the shareholder's actual user_id
-- (Replace 'gantaelon@gmail.com' with the shareholder's email)
SELECT 
  id as user_id,
  email
FROM auth.users
WHERE email = 'gantaelon@gmail.com'
LIMIT 1;

-- Copy this user_id for the next queries

-- =====================================================

-- Query 3: Check business_co_owners for this business
SELECT 
  id,
  owner_email,
  user_id,
  status
FROM business_co_owners
WHERE business_profile_id IN (
  SELECT id FROM business_profiles WHERE business_name = 'DAB'
)
ORDER BY created_at DESC;

-- Expected: user_id should match the shareholder's auth user_id
-- If NULL, that's the problem!

-- =====================================================

-- Query 4: Find notifications with NULL or wrong shareholder_id
SELECT 
  sn.id,
  sn.shareholder_email,
  sn.shareholder_id,
  au.id as correct_user_id,
  sn.read_at
FROM shareholder_notifications sn
LEFT JOIN auth.users au ON au.email = sn.shareholder_email
WHERE sn.business_profile_id IN (
  SELECT id FROM business_profiles WHERE business_name = 'DAB'
)
AND (sn.shareholder_id IS NULL OR sn.shareholder_id != au.id);

-- This shows notifications that need fixing

-- =====================================================
-- THE FIX: Update notifications with correct shareholder_id
-- =====================================================

-- Step 1: Fix notifications where shareholder_id is NULL
UPDATE shareholder_notifications sn
SET shareholder_id = au.id
FROM auth.users au
WHERE sn.shareholder_email = au.email
  AND sn.shareholder_id IS NULL
  AND sn.business_profile_id IN (
    SELECT id FROM business_profiles WHERE business_name = 'DAB'
  );

-- Step 2: Fix notifications where shareholder_id is WRONG
UPDATE shareholder_notifications sn
SET shareholder_id = au.id
FROM auth.users au
WHERE sn.shareholder_email = au.email
  AND sn.shareholder_id != au.id
  AND sn.business_profile_id IN (
    SELECT id FROM business_profiles WHERE business_name = 'DAB'
  );

-- =====================================================

-- Verify the fix:
SELECT 
  COUNT(*) as total_notifications,
  COUNT(CASE WHEN read_at IS NOT NULL THEN 1 END) as approved,
  COUNT(CASE WHEN read_at IS NULL THEN 1 END) as pending,
  COUNT(CASE WHEN shareholder_id IS NULL THEN 1 END) as null_shareholder_ids
FROM shareholder_notifications
WHERE business_profile_id IN (
  SELECT id FROM business_profiles WHERE business_name = 'DAB'
);

-- Expected: null_shareholder_ids should now be 0
