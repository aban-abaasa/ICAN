-- =====================================================
-- LINK CO-OWNERS TO THEIR AUTH USERS BY EMAIL
-- =====================================================
-- This script updates business_co_owners to link user_id based on matching emails

-- Step 1: Check which co-owners are missing user_id
SELECT 
  bco.id,
  bco.owner_name,
  bco.owner_email,
  bco.user_id,
  CASE WHEN bco.user_id IS NULL THEN '❌ NOT LINKED' ELSE '✅ LINKED' END as status
FROM public.business_co_owners bco
WHERE bco.status = 'active'
ORDER BY bco.created_at DESC;

-- Step 2: Link co-owners to auth users by email match
UPDATE public.business_co_owners co
SET user_id = p.id
FROM public.profiles p
WHERE co.owner_email = p.email
  AND co.user_id IS NULL
  AND co.status = 'active';

-- Step 3: Verify the links were created
SELECT 
  bco.id,
  bco.owner_name,
  bco.owner_email,
  bco.user_id,
  p.email as profile_email,
  CASE WHEN bco.user_id IS NOT NULL THEN '✅ LINKED' ELSE '❌ NOT LINKED' END as link_status
FROM public.business_co_owners bco
LEFT JOIN public.profiles p ON p.id = bco.user_id
WHERE bco.status = 'active'
ORDER BY bco.created_at DESC;
