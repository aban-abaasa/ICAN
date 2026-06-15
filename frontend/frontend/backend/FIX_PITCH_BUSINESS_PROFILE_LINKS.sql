-- Fix: Link each pitch to the correct business profile

-- Step 1: Find the correct IDs
SELECT 
  'DAb Pitch' as type,
  p.id as pitch_id,
  p.title,
  p.business_profile_id as current_bp_id,
  bp.business_name as current_business,
  (SELECT id FROM business_profiles WHERE business_name = 'DAb' LIMIT 1) as correct_bp_id,
  (SELECT business_name FROM business_profiles WHERE business_name = 'DAb' LIMIT 1) as correct_business
FROM pitches p
LEFT JOIN business_profiles bp ON p.business_profile_id = bp.id
WHERE p.title ILIKE '%DAb%'
LIMIT 1;

-- Step 2: Update the DAb pitch to link to the correct DAb business profile
UPDATE pitches
SET business_profile_id = (SELECT id FROM business_profiles WHERE business_name = 'DAb' LIMIT 1)
WHERE title ILIKE '%DAb%';

-- Step 3: Verify the fix worked
SELECT 
  p.id,
  p.title,
  p.business_profile_id,
  bp.business_name,
  bp.user_id
FROM pitches p
LEFT JOIN business_profiles bp ON p.business_profile_id = bp.id
WHERE p.title ILIKE '%DAb%'
LIMIT 1;

-- Step 4: Show all pitches with their correct businesses
SELECT 
  p.id,
  p.title,
  bp.id as business_profile_id,
  bp.business_name as seller_business,
  bp.user_id as seller_user_id,
  (SELECT COUNT(*) FROM business_co_owners WHERE business_profile_id = bp.id) as shareholder_count
FROM pitches p
LEFT JOIN business_profiles bp ON p.business_profile_id = bp.id
ORDER BY p.created_at DESC;
