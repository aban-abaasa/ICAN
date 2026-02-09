-- Trace exact data being passed to ShareSigningFlow

-- Step 1: Find the "DAb Investment Pitch" 
SELECT 
  id,
  title,
  business_profile_id,
  status,
  created_at
FROM pitches
WHERE title ILIKE '%DAb%'
LIMIT 1;

-- Step 2: Get the business profile linked to this pitch
SELECT 
  id,
  business_name,
  user_id,
  created_at
FROM business_profiles
WHERE id IN (
  SELECT business_profile_id FROM pitches WHERE title ILIKE '%DAb%'
)
LIMIT 1;

-- Step 3: Get the profiles (owner info) for the user_id
SELECT 
  id,
  email,
  full_name
FROM profiles
WHERE id IN (
  SELECT user_id FROM business_profiles 
  WHERE id IN (
    SELECT business_profile_id FROM pitches WHERE title ILIKE '%DAb%'
  )
)
LIMIT 1;

-- Step 4: What would the SELECT statement from getAllPitches return?
SELECT 
  p.id,
  p.title,
  p.business_profile_id,
  p.status,
  p.created_at,
  bp.id as bp_id,
  bp.user_id as bp_user_id,
  bp.business_name as bp_business_name,
  bp.description as bp_description
FROM pitches p
LEFT JOIN business_profiles bp ON p.business_profile_id = bp.id
WHERE p.title ILIKE '%DAb%'
LIMIT 1;

-- Step 5: Check all pitches and their linked businesses
SELECT 
  p.id,
  p.title,
  p.business_profile_id,
  bp.business_name as seller_business
FROM pitches p
LEFT JOIN business_profiles bp ON p.business_profile_id = bp.id
ORDER BY p.created_at DESC
LIMIT 20;

-- Step 6: Check all business profiles
SELECT 
  id,
  business_name,
  user_id
FROM business_profiles
ORDER BY created_at DESC
LIMIT 20;
