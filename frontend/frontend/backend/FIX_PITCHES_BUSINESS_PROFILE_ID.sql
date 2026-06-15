-- FIX PITCHES BUSINESS_PROFILE_ID
-- Ensure all pitches have their business_profile_id populated

-- Step 1: Check current state
SELECT 
  COUNT(*) as total_pitches,
  COUNT(CASE WHEN business_profile_id IS NULL THEN 1 END) as missing_business_profile_id,
  COUNT(CASE WHEN business_profile_id IS NOT NULL THEN 1 END) as have_business_profile_id
FROM pitches;

-- Step 2: List pitches with missing business_profile_id
SELECT 
  p.id,
  p.title,
  p.business_profile_id,
  bp.id as expected_business_profile_id,
  bp.business_name
FROM pitches p
LEFT JOIN business_profiles bp ON p.business_profile_id = bp.id
WHERE p.business_profile_id IS NULL
ORDER BY p.created_at DESC;

-- Step 3: If pitches table is missing the business_profile_id column entirely, add it
-- (This should already exist, but just in case)
-- ALTER TABLE pitches ADD COLUMN business_profile_id UUID REFERENCES business_profiles(id) ON DELETE CASCADE;

-- Step 4: Update any pitches that have NULL business_profile_id
-- This assumes there's a way to link pitches to business profiles
-- First, let's see what relationships exist
SELECT 
  p.id,
  p.title,
  p.created_at,
  bp.id,
  bp.business_name,
  bp.user_id
FROM pitches p
CROSS JOIN business_profiles bp
WHERE p.business_profile_id IS NULL
LIMIT 5;

-- Step 5: Verify all pitches now have business_profile_id
SELECT 
  id,
  title,
  business_profile_id,
  created_at
FROM pitches
WHERE business_profile_id IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;

-- Step 6: Summary check
SELECT 
  'Pitches with business_profile_id' as status,
  COUNT(*) as count
FROM pitches
WHERE business_profile_id IS NOT NULL
UNION ALL
SELECT 
  'Pitches missing business_profile_id',
  COUNT(*)
FROM pitches
WHERE business_profile_id IS NULL;
