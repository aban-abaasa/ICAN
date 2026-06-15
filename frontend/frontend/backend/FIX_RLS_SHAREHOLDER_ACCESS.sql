-- Fix: Update RLS policies to allow shareholders to read business_profiles
-- The policies already exist, so we need to drop them first, then recreate with shareholder access

-- Step 1: Check existing policies
SELECT
  policyname,
  permissive,
  qual
FROM pg_policies
WHERE tablename = 'business_profiles'
ORDER BY policyname;

-- Step 2: Drop all existing policies on business_profiles
DROP POLICY IF EXISTS "Owner can read own business profile" ON business_profiles;
DROP POLICY IF EXISTS "Co-owners can read business profile" ON business_profiles;
DROP POLICY IF EXISTS "Owner can update own business profile" ON business_profiles;
DROP POLICY IF EXISTS "Owner can delete own business profile" ON business_profiles;
DROP POLICY IF EXISTS "Users can create new business profile" ON business_profiles;
DROP POLICY IF EXISTS "Enable read for business owners" ON business_profiles;
DROP POLICY IF EXISTS "Enable write for business owners" ON business_profiles;
DROP POLICY IF EXISTS "Public read access" ON business_profiles;

-- Step 3: Ensure RLS is enabled
ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;

-- Step 4: Create new policies with shareholder access

-- Policy 1: Owner can read own business profile
CREATE POLICY "Owner can read own business profile"
  ON business_profiles
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy 2: Shareholders (co-owners) can read business profile
CREATE POLICY "Co-owners can read business profile"
  ON business_profiles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_co_owners
      WHERE business_co_owners.business_profile_id = business_profiles.id
        AND business_co_owners.user_id = auth.uid()
        AND (business_co_owners.status = 'active' OR business_co_owners.status IS NULL)
    )
  );

-- Policy 3: Owner can update own profile
CREATE POLICY "Owner can update own business profile"
  ON business_profiles
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy 4: Owner can delete own profile
CREATE POLICY "Owner can delete own business profile"
  ON business_profiles
  FOR DELETE
  USING (auth.uid() = user_id);

-- Policy 5: Users can create business profile
CREATE POLICY "Users can create new business profile"
  ON business_profiles
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Step 5: Verify new policies are in place
SELECT
  policyname,
  permissive,
  qual
FROM pg_policies
WHERE tablename = 'business_profiles'
ORDER BY policyname;

-- Step 6: Test - Verify shareholders can now access business profiles
SELECT
  bp.id,
  bp.business_name,
  bp.user_id as owner_id,
  COUNT(bco.id) as active_shareholders
FROM business_profiles bp
LEFT JOIN business_co_owners bco 
  ON bco.business_profile_id = bp.id 
  AND (bco.status = 'active' OR bco.status IS NULL)
GROUP BY bp.id, bp.business_name, bp.user_id
HAVING COUNT(bco.id) > 0
ORDER BY bp.business_name;
