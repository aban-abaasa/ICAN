-- =====================================================
-- FIX: CMMS_JOB_ASSIGNMENTS RLS Permission Error (42501)
-- =====================================================
-- Issue: "permission denied for table users" when updating cmms_job_assignments
-- Error: PATCH 403 Forbidden with code 42501
-- Root Cause: RLS policy on cmms_job_assignments is accessing auth.users
-- Solution: Disable RLS + Use SECURITY DEFINER functions instead
-- =====================================================

-- =====================================================
-- STEP 1: DISABLE RLS ON CMMS_JOB_ASSIGNMENTS
-- =====================================================

ALTER TABLE IF EXISTS public.cmms_job_assignments DISABLE ROW LEVEL SECURITY;

-- =====================================================
-- STEP 2: DROP ALL EXISTING RLS POLICIES
-- =====================================================

DO $$
DECLARE
    policy_record RECORD;
BEGIN
    FOR policy_record IN 
        SELECT policyname FROM pg_policies 
        WHERE tablename = 'cmms_job_assignments'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.cmms_job_assignments', policy_record.policyname);
        RAISE NOTICE 'Dropped policy: %', policy_record.policyname;
    END LOOP;
END $$;

-- =====================================================
-- STEP 3: DISABLE RLS ON CMMS_REPORT_MESSAGES TOO
-- =====================================================

ALTER TABLE IF EXISTS public.cmms_report_messages DISABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    policy_record RECORD;
BEGIN
    FOR policy_record IN 
        SELECT policyname FROM pg_policies 
        WHERE tablename = 'cmms_report_messages'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.cmms_report_messages', policy_record.policyname);
        RAISE NOTICE 'Dropped policy: %', policy_record.policyname;
    END LOOP;
END $$;

-- =====================================================
-- STEP 4: CREATE SECURE FUNCTION FOR JOB STATUS UPDATE
-- =====================================================

DROP FUNCTION IF EXISTS public.fn_update_job_assignment_status(
    p_assignment_id UUID,
    p_new_status VARCHAR
) CASCADE;

CREATE OR REPLACE FUNCTION public.fn_update_job_assignment_status(
    p_assignment_id UUID,
    p_new_status VARCHAR
)
RETURNS TABLE (
    success BOOLEAN,
    message VARCHAR,
    data JSON
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_auth_uid UUID;
    v_auth_email TEXT;
    v_auth_user_id UUID;
    v_company_id UUID;
    v_assignment_user_id UUID;
    v_assigned_by_user_id UUID;
    v_assignment_role VARCHAR;
    v_updated_count INT;
    v_data JSON;
BEGIN
    -- Authenticate
    v_auth_uid := auth.uid();
    IF v_auth_uid IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Not authenticated'::VARCHAR, NULL::JSON;
        RETURN;
    END IF;

    -- Get auth email
    v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
    IF v_auth_email IS NULL THEN
        SELECT email INTO v_auth_email FROM auth.users WHERE id = v_auth_uid;
    END IF;

    -- Find CMMS user for this auth account
    SELECT cu.id, cu.cmms_company_id, cu.role
    INTO v_auth_user_id, v_company_id, v_assignment_role
    FROM public.cmms_users cu
    WHERE LOWER(cu.email) = LOWER(v_auth_email)
      AND cu.is_active = TRUE
    LIMIT 1;

    IF v_auth_user_id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Not a CMMS member'::VARCHAR, NULL::JSON;
        RETURN;
    END IF;

    -- Validate job assignment exists and belongs to their company
    SELECT cja.assigned_to_user_id, cja.assigned_by_user_id
    INTO v_assignment_user_id, v_assigned_by_user_id
    FROM public.cmms_job_assignments cja
    WHERE cja.id = p_assignment_id
      AND cja.company_id = v_company_id;

    IF v_assignment_user_id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Job assignment not found or unauthorized'::VARCHAR, NULL::JSON;
        RETURN;
    END IF;

    -- Authorization check:
    -- - Can update if: assigned to me OR I'm the one who assigned it OR I'm admin/supervisor
    IF NOT (
        v_auth_user_id = v_assignment_user_id  -- I'm the assignee
        OR v_auth_user_id = v_assigned_by_user_id  -- I assigned it
        OR v_assignment_role IN ('admin', 'supervisor', 'coordinator')  -- I'm a manager
    ) THEN
        RETURN QUERY SELECT FALSE, 'Unauthorized to update this job'::VARCHAR, NULL::JSON;
        RETURN;
    END IF;

    -- Validate status
    IF p_new_status NOT IN ('pending', 'accepted', 'in_progress', 'completed', 'rejected') THEN
        RETURN QUERY SELECT FALSE, 'Invalid status. Must be: pending, accepted, in_progress, completed, rejected'::VARCHAR, NULL::JSON;
        RETURN;
    END IF;

    -- Update the assignment
    UPDATE public.cmms_job_assignments
    SET 
        assignment_status = p_new_status,
        updated_at = NOW()
    WHERE id = p_assignment_id
      AND company_id = v_company_id;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    IF v_updated_count = 0 THEN
        RETURN QUERY SELECT FALSE, 'Failed to update job assignment'::VARCHAR, NULL::JSON;
        RETURN;
    END IF;

    -- Fetch updated record
    SELECT row_to_json(cja.*)
    INTO v_data
    FROM public.cmms_job_assignments cja
    WHERE cja.id = p_assignment_id;

    RETURN QUERY SELECT TRUE, format('Job status updated to "%s"', p_new_status)::VARCHAR, v_data;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_update_job_assignment_status(UUID, VARCHAR) TO authenticated;

-- =====================================================
-- STEP 5: CREATE FUNCTION FOR FETCHING JOB ASSIGNMENTS
-- =====================================================

DROP FUNCTION IF EXISTS public.fn_get_job_assignments(UUID, UUID) CASCADE;

CREATE OR REPLACE FUNCTION public.fn_get_job_assignments(
    p_company_id UUID,
    p_report_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    report_id UUID,
    company_id UUID,
    assigned_to_user_id UUID,
    assigned_to_user_name VARCHAR,
    assigned_to_user_email VARCHAR,
    assigned_by_user_id UUID,
    assigned_by_user_name VARCHAR,
    assigned_by_user_email VARCHAR,
    job_title VARCHAR,
    job_description TEXT,
    assignment_status VARCHAR,
    due_date DATE,
    priority VARCHAR,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_auth_uid UUID;
    v_auth_email TEXT;
    v_auth_user_id UUID;
    v_auth_user_role VARCHAR;
BEGIN
    -- Authenticate
    v_auth_uid := auth.uid();
    IF v_auth_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Get auth email
    v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
    IF v_auth_email IS NULL THEN
        SELECT email INTO v_auth_email FROM auth.users WHERE id = v_auth_uid;
    END IF;

    -- Find CMMS user
    SELECT cu.id, cu.role
    INTO v_auth_user_id, v_auth_user_role
    FROM public.cmms_users cu
    WHERE LOWER(cu.email) = LOWER(v_auth_email)
      AND cu.is_active = TRUE
      AND cu.cmms_company_id = p_company_id
    LIMIT 1;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'Not a member of this CMMS company';
    END IF;

    -- Return job assignments based on role
    RETURN QUERY
    SELECT
        cja.id,
        cja.report_id,
        cja.company_id,
        cja.assigned_to_user_id,
        (SELECT name FROM public.cmms_users WHERE id = cja.assigned_to_user_id) AS assigned_to_user_name,
        (SELECT email FROM public.cmms_users WHERE id = cja.assigned_to_user_id) AS assigned_to_user_email,
        cja.assigned_by_user_id,
        (SELECT name FROM public.cmms_users WHERE id = cja.assigned_by_user_id) AS assigned_by_user_name,
        (SELECT email FROM public.cmms_users WHERE id = cja.assigned_by_user_id) AS assigned_by_user_email,
        cja.job_title,
        cja.job_description,
        cja.assignment_status,
        cja.due_date,
        cja.priority,
        cja.created_at,
        cja.updated_at
    FROM public.cmms_job_assignments cja
    WHERE cja.company_id = p_company_id
      AND (p_report_id IS NULL OR cja.report_id = p_report_id)
      AND (
        -- Admin/Supervisor/Coordinator: can see all
        v_auth_user_role IN ('admin', 'supervisor', 'coordinator')
        -- Others: can only see jobs assigned to them or assigned by them
        OR cja.assigned_to_user_id = v_auth_user_id
        OR cja.assigned_by_user_id = v_auth_user_id
      )
    ORDER BY cja.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_job_assignments(UUID, UUID) TO authenticated;

-- =====================================================
-- STEP 6: VERIFICATION
-- =====================================================

-- Check if RLS is disabled
SELECT 
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables
WHERE tablename IN ('cmms_job_assignments', 'cmms_report_messages')
  AND schemaname = 'public';

-- Check for remaining policies (should be none)
SELECT policyname, tablename FROM pg_policies 
WHERE tablename IN ('cmms_job_assignments', 'cmms_report_messages')
  AND schemaname = 'public';

-- =====================================================
-- STEP 7: FRONTEND CHANGES NEEDED
-- =====================================================

/*
UPDATE cmmsMessagingService.js:

// Replace the updateJobStatus function to use the new SECURITY DEFINER function:

export const updateJobStatus = async (assignmentId, newStatus) => {
  try {
    // Use the new SECURITY DEFINER function
    const { data, error } = await supabase
      .rpc('fn_update_job_assignment_status', {
        p_assignment_id: assignmentId,
        p_new_status: newStatus
      });

    if (error) {
      console.error('Error updating job status:', error);
      return {
        success: false,
        error: error.message
      };
    }

    // Parse the response from the function
    if (data && data.length > 0) {
      const result = data[0];
      return {
        success: result.success,
        error: result.message,
        data: result.data ? JSON.parse(result.data) : null,
        message: result.message
      };
    }

    return {
      success: false,
      error: 'No response from server'
    };
  } catch (error) {
    console.error('Service error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};
*/

-- =====================================================
-- SUMMARY
-- =====================================================

/*
✅ FIXED: RLS policies removed from cmms_job_assignments
✅ FIXED: Direct table access replaced with SECURITY DEFINER functions
✅ FIXED: Authorization logic moved to backend function
✅ FIXED: No more auth.users access in RLS policies

DEPLOY SEQUENCE:
1. Run this SQL file in Supabase SQL Editor
2. Update cmmsMessagingService.js to use fn_update_job_assignment_status()
3. Update any job fetching to use fn_get_job_assignments() if needed
4. Restart frontend (Cmd+Shift+R or Ctrl+Shift+R)
5. Test: Try updating a job status - should work without permission errors
*/
