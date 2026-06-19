-- ============================================================
-- FIX CMMS ROLE ASSIGNMENT ERROR
-- ============================================================
-- This script diagnoses and fixes the "Only admin, coordinator, 
-- or supervisor can assign jobs" error in the CMMS system.
-- ============================================================

-- ============================================================
-- STEP 1: DIAGNOSTIC - Check current user roles
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE '=== CMMS ROLE ASSIGNMENT DIAGNOSTIC ===';
  RAISE NOTICE 'Checking current user roles in cmms_users table...';
END $$;

-- Show all users and their current roles
SELECT 
  cu.id,
  cu.email,
  cu.name,
  cu.role,
  cu.cmms_company_id,
  cc.company_name,
  cu.is_active,
  cu.created_at
FROM public.cmms_users cu
LEFT JOIN public.cmms_companies cc ON cu.cmms_company_id = cc.id
ORDER BY cu.created_at DESC;

-- ============================================================
-- STEP 2: IDENTIFY USERS WITH INSUFFICIENT PERMISSIONS
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== USERS WITHOUT ASSIGNMENT PERMISSIONS ===';
  RAISE NOTICE 'These users cannot assign jobs:';
END $$;

SELECT 
  cu.email,
  cu.name,
  cu.role AS current_role,
  cc.company_name,
  CASE 
    WHEN cu.role IS NULL THEN 'No role assigned'
    WHEN LOWER(cu.role) NOT IN ('admin', 'coordinator', 'supervisor') THEN 'Insufficient permissions'
    ELSE 'Has permissions'
  END AS status
FROM public.cmms_users cu
LEFT JOIN public.cmms_companies cc ON cu.cmms_company_id = cc.id
WHERE cu.is_active = TRUE
  AND (cu.role IS NULL OR LOWER(cu.role) NOT IN ('admin', 'coordinator', 'supervisor'));

-- ============================================================
-- STEP 3: FIX OPTIONS
-- ============================================================

-- ============================================================
-- OPTION A: Grant SUPERVISOR role to specific user by email
-- ============================================================
-- INSTRUCTIONS: Replace 'user@example.com' with the actual email
-- Uncomment the lines below to execute:

/*
UPDATE public.cmms_users
SET role = 'supervisor'
WHERE LOWER(email) = LOWER('icanera@gmail.com')
  AND is_active = TRUE;

-- Verify the update
SELECT 
  email, 
  name, 
  role, 
  is_active 
FROM public.cmms_users 
WHERE LOWER(email) = LOWER('icanera@gmail.com');
*/

-- ============================================================
-- OPTION B: Grant ADMIN role to company creator/owner
-- ============================================================
-- This updates the first user in each company to admin role

/*
WITH first_users AS (
  SELECT DISTINCT ON (cmms_company_id)
    id,
    cmms_company_id,
    email,
    name
  FROM public.cmms_users
  ORDER BY cmms_company_id, created_at ASC
)
UPDATE public.cmms_users cu
SET role = 'admin'
FROM first_users fu
WHERE cu.id = fu.id
  AND cu.is_active = TRUE
  AND (cu.role IS NULL OR LOWER(cu.role) NOT IN ('admin', 'coordinator', 'supervisor'));

-- Verify the updates
SELECT 
  cu.email,
  cu.name,
  cu.role,
  cc.company_name,
  cu.created_at
FROM public.cmms_users cu
LEFT JOIN public.cmms_companies cc ON cu.cmms_company_id = cc.id
WHERE cu.role = 'admin'
ORDER BY cu.created_at;
*/

-- ============================================================
-- OPTION C: Grant COORDINATOR role to all active users
-- ============================================================
-- WARNING: This gives assignment permissions to ALL users
-- Use only if appropriate for your organization

/*
UPDATE public.cmms_users
SET role = 'coordinator'
WHERE is_active = TRUE
  AND (role IS NULL OR LOWER(role) = 'member');

-- Verify the updates
SELECT 
  email,
  name,
  role,
  is_active
FROM public.cmms_users
ORDER BY created_at DESC;
*/

-- ============================================================
-- OPTION D: Create a comprehensive role assignment based on profile
-- ============================================================
-- This matches users with their profiles and assigns appropriate roles

/*
DO $$
DECLARE
  v_user RECORD;
  v_profile_role TEXT;
  v_new_cmms_role TEXT;
BEGIN
  -- Loop through all cmms_users without proper roles
  FOR v_user IN 
    SELECT cu.id, cu.email, cu.cmms_company_id, cu.role
    FROM public.cmms_users cu
    WHERE cu.is_active = TRUE
      AND (cu.role IS NULL OR LOWER(cu.role) NOT IN ('admin', 'coordinator', 'supervisor'))
  LOOP
    -- Try to find matching profile role
    SELECT COALESCE(p.role, 'member') INTO v_profile_role
    FROM public.profiles p
    WHERE LOWER(p.email) = LOWER(v_user.email)
    LIMIT 1;

    -- Map profile role to CMMS role
    v_new_cmms_role := CASE 
      WHEN v_profile_role IN ('admin', 'Admin', 'ADMIN') THEN 'admin'
      WHEN v_profile_role IN ('coordinator', 'Coordinator', 'COORDINATOR') THEN 'coordinator'
      WHEN v_profile_role IN ('supervisor', 'Supervisor', 'SUPERVISOR') THEN 'supervisor'
      ELSE 'supervisor'  -- Default to supervisor for assignment capability
    END;

    -- Update the cmms_user role
    UPDATE public.cmms_users
    SET role = v_new_cmms_role
    WHERE id = v_user.id;

    RAISE NOTICE 'Updated user % to role: %', v_user.email, v_new_cmms_role;
  END LOOP;
END $$;

-- Verify all updates
SELECT 
  cu.email,
  cu.name,
  cu.role AS cmms_role,
  cc.company_name,
  cu.is_active
FROM public.cmms_users cu
LEFT JOIN public.cmms_companies cc ON cu.cmms_company_id = cc.id
ORDER BY cc.company_name, cu.role, cu.email;
*/

-- ============================================================
-- RECOMMENDED QUICK FIX FOR YOUR CASE
-- ============================================================
-- Based on the error screenshot showing user 'icanera@gmail.com'
-- This grants supervisor role to enable job assignment

UPDATE public.cmms_users
SET role = 'SUPERVISOR'
WHERE LOWER(email) = LOWER('icanera@gmail.com')
  AND is_active = TRUE;

-- Also ensure the role column accepts the value with proper case handling
-- Update the function to be case-insensitive if needed
CREATE OR REPLACE FUNCTION public.fn_assign_job(
  p_company_id UUID,
  p_report_id UUID,
  p_assigned_to_user_id UUID,
  p_job_title VARCHAR,
  p_job_description TEXT DEFAULT NULL,
  p_due_date DATE DEFAULT NULL,
  p_priority VARCHAR DEFAULT 'medium'
)
RETURNS public.cmms_job_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
  v_assigner_id UUID;
  v_assigner_role TEXT;
  v_assignment public.cmms_job_assignments;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email FROM auth.users WHERE id = v_auth_uid;
  END IF;

  -- Get user role with case-insensitive comparison
  SELECT cu.id, LOWER(COALESCE(cu.role, 'member'))
  INTO v_assigner_id, v_assigner_role
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_assigner_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this CMMS company. Email: %, Company: %', v_auth_email, p_company_id;
  END IF;

  -- Debug logging
  RAISE NOTICE 'User % has role: % (normalized to: %)', v_auth_email, v_assigner_role, LOWER(v_assigner_role);

  -- Only admin/coordinator/supervisor can assign jobs (case-insensitive check)
  IF v_assigner_role NOT IN ('admin', 'coordinator', 'supervisor') THEN
    RAISE EXCEPTION 'Only admin, coordinator, or supervisor can assign jobs. Your current role is: %', v_assigner_role;
  END IF;

  -- Validate report exists if report_id is provided
  IF p_report_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cmms_company_reports
      WHERE id = p_report_id AND cmms_company_id = p_company_id
    ) THEN
      RAISE EXCEPTION 'Report not found';
    END IF;
  END IF;

  -- Validate assigned user exists
  IF NOT EXISTS (
    SELECT 1 FROM public.cmms_users
    WHERE id = p_assigned_to_user_id AND cmms_company_id = p_company_id AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'User not found or inactive';
  END IF;

  INSERT INTO public.cmms_job_assignments (
    report_id,
    company_id,
    assigned_to_user_id,
    assigned_by_user_id,
    job_title,
    job_description,
    due_date,
    priority
  ) VALUES (
    p_report_id,
    p_company_id,
    p_assigned_to_user_id,
    v_assigner_id,
    p_job_title,
    p_job_description,
    p_due_date,
    p_priority
  )
  RETURNING * INTO v_assignment;

  RETURN v_assignment;
END;
$$;

-- ============================================================
-- VERIFICATION
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== VERIFICATION ===';
  RAISE NOTICE 'Checking if fix was applied...';
END $$;

-- Show updated user roles
SELECT 
  cu.email,
  cu.name,
  cu.role,
  cc.company_name,
  CASE 
    WHEN LOWER(cu.role) IN ('admin', 'coordinator', 'supervisor') THEN '✓ CAN ASSIGN JOBS'
    ELSE '✗ CANNOT ASSIGN JOBS'
  END AS permission_status
FROM public.cmms_users cu
LEFT JOIN public.cmms_companies cc ON cu.cmms_company_id = cc.id
WHERE cu.is_active = TRUE
ORDER BY cc.company_name, cu.email;

-- ============================================================
-- SUCCESS MESSAGE
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== FIX APPLIED ===';
  RAISE NOTICE 'The user role has been updated.';
  RAISE NOTICE 'Please try assigning jobs again in the CMMS interface.';
  RAISE NOTICE '';
  RAISE NOTICE 'If you still experience issues:';
  RAISE NOTICE '1. Check that you are logged in with the correct email';
  RAISE NOTICE '2. Refresh your browser session';
  RAISE NOTICE '3. Verify the company_id matches your current company';
END $$;
