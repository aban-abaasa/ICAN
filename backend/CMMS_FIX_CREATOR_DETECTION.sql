-- ============================================
-- CMMS - FIX CREATOR/OWNER DETECTION
-- ============================================
-- This script fixes the issue where company creators 
-- are not being properly identified as admins

-- Step 1: Add owner tracking to company profiles (if not exists)
ALTER TABLE cmms_company_profiles
ADD COLUMN IF NOT EXISTS created_by_user_id UUID UNIQUE REFERENCES cmms_users(id),
ADD COLUMN IF NOT EXISTS owner_email VARCHAR(255) UNIQUE,
ADD COLUMN IF NOT EXISTS is_creator_marked BOOLEAN DEFAULT FALSE;

-- Step 2: Create a marker table for company creators
CREATE TABLE IF NOT EXISTS cmms_company_creators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL UNIQUE REFERENCES cmms_company_profiles(id) ON DELETE CASCADE,
  creator_user_id UUID NOT NULL UNIQUE REFERENCES cmms_users(id) ON DELETE CASCADE,
  creator_email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_creator_per_company UNIQUE(cmms_company_id, creator_user_id)
);

-- Step 3: Create index for creator lookup by email
CREATE INDEX IF NOT EXISTS idx_cmms_creators_email ON cmms_company_creators(creator_email);
CREATE INDEX IF NOT EXISTS idx_cmms_creators_company_id ON cmms_company_creators(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_cmms_creators_user_id ON cmms_company_creators(creator_user_id);

-- Step 4: Drop and recreate cmms_users_with_roles view with creator detection
DROP VIEW IF EXISTS cmms_users_with_roles CASCADE;

CREATE VIEW cmms_users_with_roles AS
SELECT 
  u.id,
  u.email,
  u.user_name,
  u.full_name,
  u.phone,
  u.department,
  u.cmms_company_id,
  u.is_active,
  u.created_at,
  -- Check if this user is the company creator
  CASE 
    WHEN cc.creator_user_id = u.id THEN 'admin'
    WHEN ur.cmms_role_id IS NOT NULL THEN r.role_name
    ELSE 'viewer'
  END AS effective_role,
  -- Collect all roles for this user
  STRING_AGG(r.role_name, ', ' ORDER BY r.role_name) AS role_labels,
  -- Mark if user is creator
  CASE WHEN cc.creator_user_id = u.id THEN TRUE ELSE FALSE END AS is_creator
FROM cmms_users u
LEFT JOIN cmms_user_roles ur ON u.id = ur.cmms_user_id AND ur.is_active = TRUE
LEFT JOIN cmms_roles r ON ur.cmms_role_id = r.id
LEFT JOIN cmms_company_creators cc ON u.cmms_company_id = cc.cmms_company_id AND u.id = cc.creator_user_id
WHERE u.is_active = TRUE
GROUP BY u.id, u.email, u.user_name, u.full_name, u.phone, u.department, u.cmms_company_id, u.is_active, u.created_at, cc.creator_user_id, ur.cmms_role_id, r.role_name, cc.creator_user_id;

-- Step 5: Create function to mark company creator
CREATE OR REPLACE FUNCTION mark_company_creator(
  p_company_id UUID,
  p_user_id UUID,
  p_creator_email VARCHAR(255)
)
RETURNS VOID AS $$
BEGIN
  -- Insert or do nothing if creator already marked
  INSERT INTO cmms_company_creators (cmms_company_id, creator_user_id, creator_email)
  VALUES (p_company_id, p_user_id, p_creator_email)
  ON CONFLICT (cmms_company_id) DO NOTHING;
  
  -- Update company profile
  UPDATE cmms_company_profiles
  SET 
    created_by_user_id = p_user_id,
    owner_email = p_creator_email,
    is_creator_marked = TRUE
  WHERE id = p_company_id;
  
  RAISE NOTICE 'Company creator marked: company=%, user=%, email=%', p_company_id, p_user_id, p_creator_email;
END;
$$ LANGUAGE plpgsql;

-- Step 6: Verify the fix - view all company creators
SELECT 
  'CMMS_COMPANY_CREATORS' as table_name,
  COUNT(*) as count
FROM cmms_company_creators
UNION ALL
SELECT 
  'CMMS_USERS_WITH_ROLES (view)',
  COUNT(*)
FROM cmms_users_with_roles
UNION ALL
SELECT
  'CMMS_COMPANY_PROFILES with owners',
  COUNT(*)
FROM cmms_company_profiles
WHERE created_by_user_id IS NOT NULL;

-- Step 7: Display sample data
SELECT 
  'Company Creators' as data_type,
  cc.creator_email,
  c.company_name,
  u.user_name,
  cc.created_at
FROM cmms_company_creators cc
LEFT JOIN cmms_company_profiles c ON cc.cmms_company_id = c.id
LEFT JOIN cmms_users u ON cc.creator_user_id = u.id
LIMIT 10;

SELECT 
  'Users with Roles' as data_type,
  ur.email,
  ur.full_name,
  ur.effective_role,
  ur.is_creator,
  ur.role_labels
FROM cmms_users_with_roles ur
LIMIT 10;
