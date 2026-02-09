-- =====================================================
-- CONSOLIDATE ALL USERS INTO ONE UNIFIED TABLE
-- =====================================================
-- This script creates a single users table that COPIES users from all sources
-- Users remain in their original tables - this is a READ-ONLY consolidation
-- No data is deleted or moved - only copied/synchronized

-- Step 1: Create unified users table
CREATE TABLE IF NOT EXISTS public.all_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE, -- Reference to auth.users.id if exists
  email VARCHAR(255) UNIQUE NOT NULL,
  full_name VARCHAR(255),
  phone VARCHAR(50),
  avatar_url TEXT,
  user_type VARCHAR(50) DEFAULT 'general', -- 'auth_user', 'profile', 'co_owner', 'business_owner'
  source_table VARCHAR(100), -- Which table this user came from
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_all_users_email ON public.all_users(email);
CREATE INDEX IF NOT EXISTS idx_all_users_user_id ON public.all_users(user_id);
CREATE INDEX IF NOT EXISTS idx_all_users_user_type ON public.all_users(user_type);
CREATE INDEX IF NOT EXISTS idx_all_users_created_at ON public.all_users(created_at);

-- Step 2: Insert users from ican_user_profiles (users STAY in ican_user_profiles too)
INSERT INTO public.all_users (user_id, email, full_name, phone, user_type, source_table)
SELECT 
  id,
  email,
  full_name,
  phone,
  'profile_user',
  'ican_user_profiles'
FROM public.ican_user_profiles
ON CONFLICT (email) DO UPDATE SET
  full_name = COALESCE(EXCLUDED.full_name, all_users.full_name),
  phone = COALESCE(EXCLUDED.phone, all_users.phone),
  user_id = COALESCE(all_users.user_id, EXCLUDED.user_id),
  updated_at = NOW();

-- Step 3: Insert users from profiles table (users STAY in profiles too)
INSERT INTO public.all_users (user_id, email, full_name, phone, user_type, source_table)
SELECT 
  id,
  email,
  full_name,
  NULL as phone,
  'profile_user',
  'profiles'
FROM public.profiles
WHERE email NOT IN (SELECT email FROM public.all_users WHERE email IS NOT NULL)
ON CONFLICT (email) DO UPDATE SET
  full_name = COALESCE(EXCLUDED.full_name, all_users.full_name),
  user_id = COALESCE(all_users.user_id, EXCLUDED.user_id),
  updated_at = NOW();

-- Step 4: Insert unique business profile owners (co-owners STAY in business_co_owners too)
INSERT INTO public.all_users (email, full_name, phone, user_type, source_table)
SELECT DISTINCT
  owner_email,
  owner_name,
  owner_phone,
  'co_owner',
  'business_co_owners'
FROM public.business_co_owners
WHERE owner_email NOT IN (SELECT email FROM public.all_users WHERE email IS NOT NULL)
  AND owner_email IS NOT NULL
ON CONFLICT (email) DO UPDATE SET
  full_name = COALESCE(EXCLUDED.full_name, all_users.full_name),
  phone = COALESCE(EXCLUDED.phone, all_users.phone),
  user_type = 'co_owner',
  updated_at = NOW();

-- Step 5: Insert from auth.users (auth users STAY in auth.users too)
INSERT INTO public.all_users (user_id, email, full_name, user_type, source_table)
SELECT 
  id,
  email,
  COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', ''),
  'auth_user',
  'auth.users'
FROM auth.users
WHERE email NOT IN (SELECT email FROM public.all_users WHERE email IS NOT NULL)
ON CONFLICT (email) DO UPDATE SET
  user_id = COALESCE(all_users.user_id, EXCLUDED.user_id),
  full_name = COALESCE(EXCLUDED.full_name, all_users.full_name),
  user_type = 'auth_user',
  updated_at = NOW();

-- Step 6: Create a view for easy syncing in the future
CREATE OR REPLACE VIEW public.v_all_users_sync AS
SELECT 'ican_user_profiles' as source_table, id as user_id, email, full_name, phone FROM public.ican_user_profiles
UNION ALL
SELECT 'profiles', id, email, full_name, NULL FROM public.profiles
UNION ALL
SELECT 'business_co_owners', NULL, owner_email, owner_name, owner_phone FROM public.business_co_owners
UNION ALL
SELECT 'auth.users', id, email, COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', ''), NULL FROM auth.users;

-- Step 7: Verify the consolidation
SELECT 
  COUNT(*) as total_users,
  COUNT(DISTINCT email) as unique_emails,
  user_type,
  source_table,
  COUNT(*) as count
FROM public.all_users
GROUP BY user_type, source_table
ORDER BY count DESC;

-- Step 8: Show sample of consolidated users
SELECT 
  id,
  email,
  full_name,
  phone,
  user_type,
  source_table,
  is_active,
  created_at
FROM public.all_users
ORDER BY created_at DESC
LIMIT 20;

-- =====================================================
-- SUMMARY OF CONSOLIDATION
-- =====================================================
-- This script:
-- ✅ Creates all_users table as a COPY of all users
-- ✅ Pulls from ican_user_profiles (users STAY there)
-- ✅ Pulls from profiles (users STAY there)
-- ✅ Pulls from business_co_owners (co-owners STAY there)
-- ✅ Pulls from auth.users (auth users STAY there)
-- ✅ Avoids duplicates by checking email uniqueness
-- ✅ Tracks source table and user type
-- ✅ Creates a view (v_all_users_sync) for automatic syncing
--
-- IMPORTANT: All original data REMAINS in source tables
-- This is a READ-ONLY consolidation layer
--
-- To use this consolidated table in your app:
-- UPDATE pitchingService.js searchICANUsers() to query 'all_users'
-- UPDATE AuthContext.jsx to use 'all_users' instead of 'profiles'
-- UPDATE CMSSModule.jsx to use 'all_users' for user searches
--
-- To refresh consolidated data periodically, run this SQL again
-- or create a trigger on source tables to update all_users
-- =====================================================

COMMIT;
