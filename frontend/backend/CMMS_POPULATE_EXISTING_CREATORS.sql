-- ============================================
-- CMMS - POPULATE EXISTING CREATORS
-- ============================================
-- This script identifies and marks existing company creators
-- Run this AFTER CMMS_FIX_CREATOR_DETECTION.sql

-- Step 1: For companies with owner_email in profiles, mark the creator
INSERT INTO cmms_company_creators (cmms_company_id, creator_user_id, creator_email)
SELECT 
  cp.id as cmms_company_id,
  u.id as creator_user_id,
  cp.owner_email as creator_email
FROM cmms_company_profiles cp
LEFT JOIN cmms_users u ON u.email = cp.owner_email AND u.cmms_company_id = cp.id
WHERE cp.owner_email IS NOT NULL
  AND u.id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM cmms_company_creators cc 
    WHERE cc.cmms_company_id = cp.id
  )
ON CONFLICT (cmms_company_id) DO NOTHING;

-- Step 2: For companies without owner_email, find the first admin user
INSERT INTO cmms_company_creators (cmms_company_id, creator_user_id, creator_email)
SELECT 
  cp.id as cmms_company_id,
  u.id as creator_user_id,
  u.email as creator_email
FROM cmms_company_profiles cp
JOIN cmms_users u ON u.cmms_company_id = cp.id
JOIN cmms_user_roles ur ON ur.cmms_user_id = u.id
JOIN cmms_roles r ON r.id = ur.cmms_role_id AND r.role_name = 'Admin'
WHERE NOT EXISTS (
  SELECT 1 FROM cmms_company_creators cc 
  WHERE cc.cmms_company_id = cp.id
)
ORDER BY cp.created_at, u.created_at
LIMIT 1
ON CONFLICT (cmms_company_id) DO NOTHING;

-- Step 3: Verify population results
SELECT 
  'Step 1: Marked from owner_email' as step,
  COUNT(*) as creators_marked
FROM cmms_company_creators
WHERE created_at >= NOW() - INTERVAL '5 minutes'
UNION ALL
SELECT 
  'Total creators marked',
  COUNT(*)
FROM cmms_company_creators;

-- Step 4: Show which companies now have creators
SELECT 
  c.company_name,
  cc.creator_email,
  u.user_name,
  r.role_name,
  cc.created_at as marked_at
FROM cmms_company_creators cc
LEFT JOIN cmms_company_profiles c ON cc.cmms_company_id = c.id
LEFT JOIN cmms_users u ON cc.creator_user_id = u.id
LEFT JOIN cmms_user_roles ur ON ur.cmms_user_id = u.id AND ur.is_active = TRUE
LEFT JOIN cmms_roles r ON r.id = ur.cmms_role_id
ORDER BY c.company_name;

-- Step 5: Verify view is working correctly
SELECT 
  'View Test: Users with correct roles',
  email,
  effective_role,
  is_creator,
  role_labels
FROM cmms_users_with_roles
WHERE is_creator = TRUE
LIMIT 10;
