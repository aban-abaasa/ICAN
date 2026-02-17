-- Fix: Allow ANY authenticated user to read business profiles
-- Investors need to see the business profile they're investing in
-- Only owners can create/update/delete

-- Step 1: Drop the restrictive policies
DROP POLICY IF EXISTS "Owner can read own business profile" ON business_profiles;
DROP POLICY IF EXISTS "Co-owners can read business profile" ON business_profiles;
DROP POLICY IF EXISTS "Owner can update own business profile" ON business_profiles;
DROP POLICY IF EXISTS "Owner can delete own business profile" ON business_profiles;
DROP POLICY IF EXISTS "Users can create new business profile" ON business_profiles;

-- Step 2: Ensure RLS is enabled
ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;

-- Step 3: Create new permissive policies

-- Policy 1: ANY authenticated user can READ any business profile
-- (investors need to see what they're investing in)
CREATE POLICY "Anyone can read business profiles"
  ON business_profiles
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Policy 2: Only owner can INSERT new business profile
CREATE POLICY "Users can create new business profile"
  ON business_profiles
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy 3: Only owner can UPDATE own business profile
CREATE POLICY "Owner can update own business profile"
  ON business_profiles
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy 4: Only owner can DELETE own business profile
CREATE POLICY "Owner can delete own business profile"
  ON business_profiles
  FOR DELETE
  USING (auth.uid() = user_id);

-- Step 4: Verify policies are in place
SELECT
  policyname,
  permissive,
  qual
FROM pg_policies
WHERE tablename = 'business_profiles'
ORDER BY policyname;
