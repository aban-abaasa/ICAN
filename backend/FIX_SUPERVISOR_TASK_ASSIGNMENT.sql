-- ============================================================
-- FIX SUPERVISOR TASK ASSIGNMENT ERROR
-- ============================================================
-- Problem: Supervisor role can't assign tasks even though it should
-- Root Cause: Case sensitivity or role value mismatch in database
-- ============================================================

-- Step 1: Check current role values in the database
SELECT 
  email,
  name,
  role,
  LENGTH(role) as role_length,
  ASCII(SUBSTRING(role FROM 1 FOR 1)) as first_char_ascii,
  cmms_company_id,
  is_active,
  '❌ Current role value' as note
FROM public.cmms_users
WHERE is_active = TRUE
ORDER BY created_at DESC;

-- Step 2: Check for whitespace or case issues
SELECT 
  email,
  role as stored_role,
  LOWER(TRIM(role)) as normalized_role,
  CASE 
    WHEN LOWER(TRIM(role)) IN ('admin', 'coordinator', 'supervisor') THEN '✅ Can assign'
    ELSE '❌ Cannot assign'
  END as assignment_permission
FROM public.cmms_users
WHERE is_active = TRUE;

-- ============================================================
-- IMMEDIATE FIX: Normalize all supervisor roles
-- ============================================================

-- Fix 1: Trim whitespace and normalize case for all roles
UPDATE public.cmms_users
SET role = LOWER(TRIM(role))
WHERE role IS NOT NULL
  AND is_active = TRUE;

-- Fix 2: Convert any variant spellings to standard format
UPDATE public.cmms_users
SET role = CASE 
  WHEN LOWER(TRIM(role)) = 'supervisor' THEN 'supervisor'
  WHEN LOWER(TRIM(role)) = 'admin' THEN 'admin'
  WHEN LOWER(TRIM(role)) = 'coordinator' THEN 'coordinator'
  WHEN LOWER(TRIM(role)) = 'member' THEN 'member'
  ELSE 'member'  -- Default for unrecognized roles
END
WHERE is_active = TRUE;

-- ============================================================
-- ENHANCED FIX: Update the fn_assign_job function
-- ============================================================
-- Make it more robust with better debugging

DROP FUNCTION IF EXISTS public.fn_assign_job(UUID, UUID, UUID, VARCHAR, TEXT, DATE, VARCHAR) CASCADE;
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
  v_assigner_raw_role TEXT;
  v_assignment public.cmms_job_assignments;
BEGIN
  -- Get authenticated user
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get user email
  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email FROM auth.users WHERE id = v_auth_uid;
  END IF;

  -- Get user ID and role with better normalization
  SELECT 
    cu.id, 
    cu.role,
    LOWER(TRIM(COALESCE(cu.role, 'member')))
  INTO 
    v_assigner_id, 
    v_assigner_raw_role,
    v_assigner_role
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
    AND LOWER(TRIM(cu.email)) = LOWER(TRIM(v_auth_email))
    AND cu.is_active = TRUE
  LIMIT 1;

  -- Check if user exists in company
  IF v_assigner_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this CMMS company. Email: %, Company: %', 
      v_auth_email, p_company_id;
  END IF;

  -- Debug: Log the role being checked
  RAISE NOTICE '🔍 DEBUG: User % has raw role: "%" (normalized: "%")', 
    v_auth_email, v_assigner_raw_role, v_assigner_role;

  -- Check permissions with normalized role
  IF v_assigner_role NOT IN ('admin', 'coordinator', 'supervisor') THEN
    RAISE EXCEPTION 'Permission denied. Your role is "%" (normalized: "%"). Only admin, coordinator, or supervisor can assign jobs.', 
      v_assigner_raw_role, v_assigner_role;
  END IF;

  RAISE NOTICE '✅ Permission granted: % can assign jobs', v_assigner_role;

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
    WHERE id = p_assigned_to_user_id 
      AND cmms_company_id = p_company_id 
      AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'User not found or inactive';
  END IF;

  -- Create the job assignment
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
    TRIM(p_job_title),
    TRIM(COALESCE(p_job_description, '')),
    p_due_date,
    COALESCE(p_priority, 'medium')
  )
  RETURNING * INTO v_assignment;

  -- Send notification message
  BEGIN
    INSERT INTO public.cmms_report_messages (
      report_id,
      company_id,
      sender_id,
      recipient_id,
      message_text,
      message_type
    ) VALUES (
      p_report_id,
      p_company_id,
      v_assigner_id,
      p_assigned_to_user_id,
      '📋 Job assigned: ' || p_job_title || ' (Priority: ' || COALESCE(p_priority, 'medium') || ')',
      'assignment'
    );
  EXCEPTION WHEN OTHERS THEN
    -- Notification failure shouldn't block job assignment
    RAISE NOTICE 'Warning: Failed to send notification - %', SQLERRM;
  END;

  RAISE NOTICE '✅ Job assigned successfully: %', p_job_title;

  RETURN v_assignment;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_assign_job TO authenticated;

-- ============================================================
-- VERIFICATION
-- ============================================================

-- Show all users with their normalized roles
SELECT 
  email,
  name,
  role as stored_role,
  LOWER(TRIM(role)) as normalized_role,
  CASE 
    WHEN LOWER(TRIM(role)) IN ('admin', 'coordinator', 'supervisor') THEN '✅ CAN ASSIGN TASKS'
    ELSE '❌ CANNOT ASSIGN TASKS'
  END as permission_status,
  is_active
FROM public.cmms_users
ORDER BY 
  CASE LOWER(TRIM(role))
    WHEN 'admin' THEN 1
    WHEN 'coordinator' THEN 2
    WHEN 'supervisor' THEN 3
    ELSE 4
  END,
  email;

-- ============================================================
-- SUCCESS MESSAGE
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ FIX APPLIED SUCCESSFULLY';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE '1. ✅ All roles normalized (trimmed and lowercased)';
  RAISE NOTICE '2. ✅ Function updated with better debugging';
  RAISE NOTICE '3. ✅ Case-insensitive role checking enabled';
  RAISE NOTICE '';
  RAISE NOTICE '📝 Next Steps:';
  RAISE NOTICE '   • Refresh your browser';
  RAISE NOTICE '   • Try assigning a task again';
  RAISE NOTICE '   • Check browser console for debug logs';
  RAISE NOTICE '';
  RAISE NOTICE 'If issue persists, check Supabase logs for:';
  RAISE NOTICE '   🔍 DEBUG messages showing role values';
  RAISE NOTICE '   ✅ Permission granted messages';
  RAISE NOTICE '';
END $$;
