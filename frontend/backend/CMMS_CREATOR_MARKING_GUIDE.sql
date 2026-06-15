-- ============================================
-- CMMS - USAGE GUIDE FOR CREATOR MARKING
-- ============================================

-- Guide for new company profile creation
-- When creating a new company, immediately mark the creator

-- Example: Using the mark_company_creator function
-- SELECT mark_company_creator(
--   '01c4d596-2b65-4713-b066-15f85bec2d37'::UUID,  -- company_id
--   'userid-12345'::UUID,                            -- user_id
--   'creator@example.com'                            -- email
-- );

-- ============================================
-- ROLLBACK / CLEANUP (if needed)
-- ============================================

-- To rollback changes if something goes wrong:

-- DROP VIEW IF EXISTS cmms_users_with_roles CASCADE;
-- DROP TABLE IF EXISTS cmms_company_creators;
-- DROP FUNCTION IF EXISTS mark_company_creator;

-- ALTER TABLE cmms_company_profiles
-- DROP COLUMN IF EXISTS created_by_user_id,
-- DROP COLUMN IF EXISTS owner_email,
-- DROP COLUMN IF EXISTS is_creator_marked;

-- Then recreate the original view:
-- CREATE VIEW cmms_users_with_roles AS
-- SELECT 
--   u.id,
--   u.email,
--   u.user_name,
--   u.full_name,
--   u.phone,
--   u.department,
--   u.cmms_company_id,
--   u.is_active,
--   u.created_at,
--   ur.cmms_role_id::text,
--   STRING_AGG(r.role_name, ', ' ORDER BY r.role_name) AS role_labels,
--   CASE 
--     WHEN ur.cmms_role_id IS NOT NULL THEN r.role_name
--     ELSE 'viewer'
--   END AS effective_role
-- FROM cmms_users u
-- LEFT JOIN cmms_user_roles ur ON u.id = ur.cmms_user_id AND ur.is_active = TRUE
-- LEFT JOIN cmms_roles r ON ur.cmms_role_id = r.id
-- WHERE u.is_active = TRUE
-- GROUP BY u.id, u.email, u.user_name, u.full_name, u.phone, u.department, u.cmms_company_id, u.is_active, u.created_at, ur.cmms_role_id, r.role_name;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- 1. Check if new view is working
SELECT 
  email,
  effective_role,
  is_creator,
  (SELECT company_name FROM cmms_company_profiles WHERE id = cmms_company_id) as company
FROM cmms_users_with_roles
ORDER BY email;

-- 2. List all company creators
SELECT 
  c.company_name,
  cc.creator_email,
  u.user_name,
  cc.created_at,
  (SELECT role_labels FROM cmms_users_with_roles WHERE id = u.id LIMIT 1) as roles
FROM cmms_company_creators cc
LEFT JOIN cmms_company_profiles c ON cc.cmms_company_id = c.id
LEFT JOIN cmms_users u ON cc.creator_user_id = u.id;

-- 3. Find companies WITHOUT creators (need manual marking)
SELECT 
  cp.id,
  cp.company_name,
  cp.created_at,
  (SELECT email FROM cmms_users WHERE cmms_company_id = cp.id LIMIT 1) as first_user_email
FROM cmms_company_profiles cp
WHERE NOT EXISTS (
  SELECT 1 FROM cmms_company_creators cc 
  WHERE cc.cmms_company_id = cp.id
)
ORDER BY cp.created_at DESC;

-- 4. Test creator detection for specific company
-- Replace 'COMPANY_NAME' with actual company name
SELECT 
  u.email,
  u.user_name,
  uwr.effective_role,
  uwr.is_creator,
  uwr.role_labels,
  (SELECT company_name FROM cmms_company_profiles WHERE id = u.cmms_company_id) as company
FROM cmms_users u
JOIN cmms_users_with_roles uwr ON u.id = uwr.id
WHERE u.cmms_company_id = (
  SELECT id FROM cmms_company_profiles WHERE company_name = 'MBKH' LIMIT 1
)
ORDER BY u.created_at;

-- ============================================
-- TROUBLESHOOTING
-- ============================================

-- If creators are not detected, check:

-- 1. Do creators exist in cmms_company_creators table?
SELECT COUNT(*) as total_creators FROM cmms_company_creators;

-- 2. Are cmms_users properly linked to cmms_company_profiles?
SELECT 
  COUNT(*) as total_users,
  COUNT(DISTINCT cmms_company_id) as companies_with_users
FROM cmms_users
WHERE is_active = TRUE;

-- 3. Are cmms_user_roles properly set up?
SELECT 
  COUNT(*) as total_role_assignments
FROM cmms_user_roles
WHERE is_active = TRUE;

-- 4. Manual creator marking for a specific company
-- Use this if automatic detection didn't work:
-- SELECT mark_company_creator(
--   (SELECT id FROM cmms_company_profiles WHERE company_name = 'MBKH' LIMIT 1)::UUID,
--   (SELECT id FROM cmms_users WHERE cmms_company_id = (SELECT id FROM cmms_company_profiles WHERE company_name = 'MBKH' LIMIT 1) ORDER BY created_at LIMIT 1)::UUID,
--   (SELECT email FROM cmms_users WHERE cmms_company_id = (SELECT id FROM cmms_company_profiles WHERE company_name = 'MBKH' LIMIT 1) ORDER BY created_at LIMIT 1)
-- );
