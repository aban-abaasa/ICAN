-- Fix: Allow shareholders to read business profile data
-- Problem: RLS policy only allowed owner (user_id) to read business_profiles
-- Solution: Allow co-owners (in business_co_owners) to also read the business_profiles table

-- Step 1: Drop existing RLS policy that blocks shareholders
-- First, let's see what policies currently exist on business_profiles
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'business_profiles'
ORDER BY policyname;

-- Step 2: Create new RLS policy that allows shareholders to read business profiles
-- This policy allows:
-- 1. The owner (user_id matches) to read
-- 2. Any shareholder (user_id in business_co_owners) to read
-- 3. Investors viewing the profile to read

-- Option A: If RLS policies don't exist yet, enable RLS and create policies
ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;

-- Drop old restrictive policies if they exist
DROP POLICY IF EXISTS "Enable read for business owners" ON business_profiles;
DROP POLICY IF EXISTS "Enable write for business owners" ON business_profiles;
DROP POLICY IF EXISTS "Public read access" ON business_profiles;

-- Create new permissive policy: Allow owner to read
CREATE POLICY "Owner can read own business profile"
  ON business_profiles
  FOR SELECT
  USING (auth.uid() = user_id);

-- Create new permissive policy: Allow shareholders (co-owners) to read
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

-- Create policy: Allow owner to update own profile
CREATE POLICY "Owner can update own business profile"
  ON business_profiles
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create policy: Allow owner to delete own profile
CREATE POLICY "Owner can delete own business profile"
  ON business_profiles
  FOR DELETE
  USING (auth.uid() = user_id);

-- Create policy: Allow owner to insert new profile
CREATE POLICY "Users can create new business profile"
  ON business_profiles
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Step 3: Verify the policies are in place
SELECT
  policyname,
  permissive,
  roles,
  qual
FROM pg_policies
WHERE tablename = 'business_profiles'
ORDER BY policyname;

-- Step 4: Test that shareholders can now read business profiles
-- Using a shareholder's user_id to verify they can see the business profile
-- Replace 'SHAREHOLDER_USER_ID' with an actual shareholder's user_id
SELECT 
  bp.id,
  bp.business_name,
  bp.user_id as owner_id,
  (SELECT COUNT(*) FROM business_co_owners WHERE business_profile_id = bp.id) as shareholder_count
FROM business_profiles bp
WHERE EXISTS (
  SELECT 1 FROM business_co_owners
  WHERE business_co_owners.business_profile_id = bp.id
)
LIMIT 5;

-- Step 5: Verify shareholders can access the data
SELECT
  bp.id,
  bp.business_name,
  bp.user_id,
  bco.owner_name,
  bco.owner_email,
  bco.user_id as co_owner_user_id
FROM business_profiles bp
INNER JOIN business_co_owners bco ON bco.business_profile_id = bp.id
WHERE bco.status = 'active' OR bco.status IS NULL
ORDER BY bp.business_name, bco.owner_name;
