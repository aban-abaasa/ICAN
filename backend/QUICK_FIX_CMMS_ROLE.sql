-- ============================================================
-- QUICK FIX: CMMS Role Assignment Error
-- ============================================================
-- Run this script to immediately fix the job assignment error
-- ============================================================

-- Step 1: Update the user's role to supervisor
UPDATE public.cmms_users
SET role = 'supervisor'
WHERE LOWER(email) = LOWER('icanera@gmail.com')
  AND is_active = TRUE;

-- Step 2: Verify the fix
SELECT 
  email,
  name,
  role,
  is_active,
  'Can now assign jobs' as status
FROM public.cmms_users
WHERE LOWER(email) = LOWER('icanera@gmail.com');

-- Step 3: If you need to update multiple users, uncomment below:
/*
UPDATE public.cmms_users
SET role = 'supervisor'
WHERE is_active = TRUE
  AND (role IS NULL OR LOWER(role) = 'member');
*/

-- Done! Try assigning jobs again.
