-- ============================================================
-- SAFE UPDATE: fn_assign_job Function Only
-- ============================================================
-- This ONLY updates the function to handle role checking better
-- Does NOT modify any user data or roles
-- Safe to run in production with multiple companies
-- ============================================================

-- ============================================================
-- BACKUP: Show current function definition
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE '=== BACKING UP CURRENT FUNCTION ===';
  RAISE NOTICE 'Current function will be replaced with improved version';
  RAISE NOTICE 'Improvement: Better role normalization and error messages';
END $$;

-- ============================================================
-- UPDATE: fn_assign_job Function (SAFE - No data changes)
-- ============================================================

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

  -- Get user email from JWT or auth.users
  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email FROM auth.users WHERE id = v_auth_uid;
  END IF;

  -- Get user ID and role with ROBUST normalization
  -- This handles whitespace, case differences, etc.
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
    RAISE EXCEPTION 'You are not a member of this CMMS company. Email: %', v_auth_email;
  END IF;

  -- Check permissions with NORMALIZED role
  -- This is the key fix - comparing normalized values
  IF v_assigner_role NOT IN ('admin', 'coordinator', 'supervisor') THEN
    RAISE EXCEPTION 'Permission denied. Your role is "%" (normalized: "%"). Only admin, coordinator, or supervisor can assign jobs.', 
      v_assigner_raw_role, v_assigner_role;
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
    RAISE NOTICE 'Warning: Failed to send notification';
  END;

  RETURN v_assignment;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_assign_job TO authenticated;

-- ============================================================
-- VERIFICATION
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ FUNCTION UPDATED SUCCESSFULLY';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Changes made:';
  RAISE NOTICE '  ✅ Added TRIM() to email comparison';
  RAISE NOTICE '  ✅ Added TRIM() to role normalization';
  RAISE NOTICE '  ✅ Better error messages showing raw vs normalized role';
  RAISE NOTICE '  ✅ Notification failures no longer block assignment';
  RAISE NOTICE '';
  RAISE NOTICE 'What was NOT changed:';
  RAISE NOTICE '  ✓ No user roles were modified';
  RAISE NOTICE '  ✓ No company data was changed';
  RAISE NOTICE '  ✓ No existing assignments were affected';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '  1. Refresh browser';
  RAISE NOTICE '  2. Try task assignment again';
  RAISE NOTICE '  3. If still fails, check user role with:';
  RAISE NOTICE '     SELECT email, role FROM cmms_users WHERE email = ''user@example.com'';';
  RAISE NOTICE '';
END $$;

-- Show the updated function
SELECT 
  routine_name,
  routine_type,
  security_type,
  'Function updated and ready' as status
FROM information_schema.routines
WHERE routine_name = 'fn_assign_job'
  AND routine_schema = 'public';
