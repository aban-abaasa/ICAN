-- Check what seller business is actually linked to the pitch

-- Step 1: Get the pitch details
SELECT 
  id,
  title,
  created_by,
  business_profile_id,
  creator_name
FROM pitches
WHERE title LIKE '%DAb%' OR title LIKE '%Dad%'
LIMIT 5;

-- Step 2: Get the business profile linked to the pitch
SELECT 
  bp.id,
  bp.business_name,
  bp.user_id,
  bp.description,
  bp.created_at
FROM pitches p
LEFT JOIN business_profiles bp ON p.business_profile_id = bp.id
WHERE p.title LIKE '%DAb%' OR p.title LIKE '%Dad%'
LIMIT 5;

-- Step 3: Find all business profiles named "Dad" or similar
SELECT 
  id,
  business_name,
  user_id,
  description,
  created_at
FROM business_profiles
WHERE business_name ILIKE '%dad%' 
   OR business_name ILIKE '%DAb%'
ORDER BY created_at DESC
LIMIT 10;

-- Step 4: Check ALL pitches and their linked businesses
SELECT 
  p.id,
  p.title,
  p.created_by,
  p.business_profile_id,
  bp.business_name as seller_business,
  bp.user_id as seller_user_id
FROM pitches p
LEFT JOIN business_profiles bp ON p.business_profile_id = bp.id
ORDER BY p.created_at DESC
LIMIT 10;
