-- =====================================================
-- ADD TEST CO-OWNERS FOR SHAREHOLDER SIGNATURE TESTING
-- =====================================================
-- This script adds 3 co-owners to your business profile
-- so the shareholder signature system has real shareholders to notify

-- Option 1: AUTO-DETECT (uses the FIRST business profile in your system)
-- Run this entire script as-is - it will auto-detect and add co-owners

DO $$
DECLARE
  v_business_profile_id UUID;
BEGIN
  -- Get the first business profile
  SELECT id INTO v_business_profile_id
  FROM public.business_profiles
  ORDER BY created_at DESC
  LIMIT 1;
  
  IF v_business_profile_id IS NULL THEN
    RAISE EXCEPTION 'No business profiles found in database';
  END IF;
  
  RAISE NOTICE 'Adding co-owners to business profile: %', v_business_profile_id;
  
  -- Insert 3 co-owners
  INSERT INTO public.business_co_owners (
    business_profile_id,
    owner_name,
    owner_email,
    owner_phone,
    ownership_share,
    role,
    status,
    created_at,
    updated_at
  ) VALUES
  (
    v_business_profile_id,
    'John Owner',
    'john@business.com',
    '+256701234567',
    33.33,
    'Co-Owner',
    'active',
    NOW(),
    NOW()
  ),
  (
    v_business_profile_id,
    'Sarah Partner',
    'sarah@business.com',
    '+256702234567',
    33.33,
    'Co-Owner',
    'active',
    NOW(),
    NOW()
  ),
  (
    v_business_profile_id,
    'Mike Investor',
    'mike@investor.com',
    '+256703234567',
    33.34,
    'Shareholder',
    'active',
    NOW(),
    NOW()
  );
  
  RAISE NOTICE 'Successfully added 3 co-owners to business profile: %', v_business_profile_id;
  
END $$;

-- Step 2: Verify they were added
-- SELECT id, owner_name, owner_email, ownership_share, status, business_profile_id
-- FROM business_co_owners 
-- ORDER BY created_at DESC
-- LIMIT 3;

-- Step 3: Now test the shareholder signature flow
-- You should see 3 notifications sent instead of 1
-- Required approval should be 2 out of 3 (60% = 2 required)

COMMIT;
