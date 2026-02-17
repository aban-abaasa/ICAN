-- =====================================================
-- DIAGNOSE: Why is approval count showing 3/2?
-- =====================================================

-- Query 1: Count shareholder_notifications (should be 2)
SELECT COUNT(*) as total_notifications
FROM shareholder_notifications
WHERE business_profile_id = (
  SELECT id FROM business_profiles WHERE business_name = 'DAB'
);

-- Expected: 2 (one per shareholder)

-- =====================================================

-- Query 2: Count approved notifications (should be ≤ 2)
SELECT COUNT(*) as approved_count
FROM shareholder_notifications
WHERE business_profile_id = (
  SELECT id FROM business_profiles WHERE business_name = 'DAB'
)
AND read_at IS NOT NULL;

-- Expected: Should be 2 or less
-- If showing 3, there are DUPLICATES!

-- =====================================================

-- Query 3: Check for duplicate notifications
SELECT 
  shareholder_id,
  shareholder_email,
  COUNT(*) as count
FROM shareholder_notifications
WHERE business_profile_id = (
  SELECT id FROM business_profiles WHERE business_name = 'DAB'
)
GROUP BY shareholder_id, shareholder_email
HAVING COUNT(*) > 1
ORDER BY count DESC;

-- If this returns rows, there are duplicates!
-- Example:
-- shareholder_id | shareholder_email | count
-- uuid-123       | user@email.com    | 2     <- DUPLICATE!

-- =====================================================

-- Query 4: Show all notifications for DAB
SELECT 
  id,
  shareholder_id,
  shareholder_email,
  read_at,
  created_at
FROM shareholder_notifications
WHERE business_profile_id = (
  SELECT id FROM business_profiles WHERE business_name = 'DAB'
)
ORDER BY created_at DESC;

-- =====================================================

-- Query 5: Count co-owners (should be 2)
SELECT COUNT(*) as total_co_owners
FROM business_co_owners
WHERE business_profile_id = (
  SELECT id FROM business_profiles WHERE business_name = 'DAB'
)
AND status = 'active';

-- Expected: 2

-- =====================================================
-- THE PROBLEM
-- =====================================================

-- If Query 2 shows 3 but Query 5 shows 2:
-- → There are 3 shareholder_notifications but only 2 co-owners
-- → This means DUPLICATE notifications were created
-- → When we approve, we count 3 approved out of 2 total = 3/2 (impossible!)

-- =====================================================
-- THE FIX (if duplicates found)
-- =====================================================

-- Delete duplicate notifications (keep only 1 per shareholder)
DELETE FROM shareholder_notifications
WHERE id NOT IN (
  SELECT DISTINCT ON (shareholder_id) id
  FROM shareholder_notifications
  WHERE business_profile_id = (
    SELECT id FROM business_profiles WHERE business_name = 'DAB'
  )
  ORDER BY shareholder_id, created_at DESC
);

-- This keeps only the MOST RECENT notification for each shareholder

-- =====================================================
-- VERIFY THE FIX
-- =====================================================

-- Check counts again
SELECT COUNT(*) as total_notifications
FROM shareholder_notifications
WHERE business_profile_id = (
  SELECT id FROM business_profiles WHERE business_name = 'DAB'
);

-- Should now show: 2 (matches co-owner count)
