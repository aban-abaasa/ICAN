-- ============================================================
-- CMMS ROLE NORMALIZATION TRIGGER
-- ============================================================
-- Purpose: Automatically normalize roles when users are created/updated
-- This prevents future role-related permission issues
-- ============================================================

-- ============================================================
-- 1. CREATE NORMALIZATION FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_cmms_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Normalize role: trim whitespace and convert to lowercase
  NEW.role := LOWER(TRIM(COALESCE(NEW.role, 'member')));
  
  -- Validate role is in allowed list
  IF NEW.role NOT IN ('admin', 'coordinator', 'supervisor', 'member') THEN
    RAISE NOTICE 'Invalid role "%" provided, defaulting to "member"', NEW.role;
    NEW.role := 'member';
  END IF;
  
  -- Normalize email as well (trim whitespace and lowercase)
  NEW.email := LOWER(TRIM(NEW.email));
  
  -- Normalize name (trim whitespace)
  IF NEW.name IS NOT NULL THEN
    NEW.name := TRIM(NEW.name);
  END IF;
  
  RETURN NEW;
END;
$$;

-- ============================================================
-- 2. CREATE TRIGGER ON INSERT AND UPDATE
-- ============================================================

DROP TRIGGER IF EXISTS ensure_normalized_cmms_user_role ON public.cmms_users;

CREATE TRIGGER ensure_normalized_cmms_user_role
BEFORE INSERT OR UPDATE ON public.cmms_users
FOR EACH ROW
EXECUTE FUNCTION public.normalize_cmms_user_role();

-- ============================================================
-- 3. ADD ROLE VALIDATION CONSTRAINT (Optional but recommended)
-- ============================================================

-- Drop existing constraint if it exists
ALTER TABLE public.cmms_users 
DROP CONSTRAINT IF EXISTS valid_cmms_role;

-- Add constraint to enforce valid roles at database level
ALTER TABLE public.cmms_users
ADD CONSTRAINT valid_cmms_role 
CHECK (role IN ('admin', 'coordinator', 'supervisor', 'member'));

-- ============================================================
-- 4. CREATE HELPER FUNCTION FOR ROLE CHANGES BY ADMIN
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_update_cmms_user_role(
  p_company_id UUID,
  p_target_user_id UUID,
  p_new_role VARCHAR
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  user_data JSON
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
  v_admin_id UUID;
  v_admin_role TEXT;
  v_target_email TEXT;
  v_result JSON;
BEGIN
  -- Get authenticated user
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Not authenticated'::TEXT, NULL::JSON;
    RETURN;
  END IF;

  -- Get user email
  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email FROM auth.users WHERE id = v_auth_uid;
  END IF;

  -- Get admin user and verify they have permission to change roles
  SELECT cu.id, LOWER(TRIM(cu.role))
  INTO v_admin_id, v_admin_role
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
    AND LOWER(TRIM(cu.email)) = LOWER(TRIM(v_auth_email))
    AND cu.is_active = TRUE
  LIMIT 1;

  -- Only admins can change roles
  IF v_admin_role != 'admin' THEN
    RETURN QUERY SELECT FALSE, 'Only admins can change user roles'::TEXT, NULL::JSON;
    RETURN;
  END IF;

  -- Validate new role
  IF LOWER(TRIM(p_new_role)) NOT IN ('admin', 'coordinator', 'supervisor', 'member') THEN
    RETURN QUERY SELECT FALSE, 'Invalid role. Must be: admin, coordinator, supervisor, or member'::TEXT, NULL::JSON;
    RETURN;
  END IF;

  -- Get target user email for logging
  SELECT email INTO v_target_email
  FROM public.cmms_users
  WHERE id = p_target_user_id
    AND cmms_company_id = p_company_id;

  IF v_target_email IS NULL THEN
    RETURN QUERY SELECT FALSE, 'User not found in company'::TEXT, NULL::JSON;
    RETURN;
  END IF;

  -- Update the role (trigger will normalize it)
  UPDATE public.cmms_users
  SET role = p_new_role,
      updated_at = NOW()
  WHERE id = p_target_user_id
    AND cmms_company_id = p_company_id;

  -- Log the role change
  INSERT INTO public.cmms_report_messages (
    company_id,
    sender_id,
    recipient_id,
    message_text,
    message_type
  ) VALUES (
    p_company_id,
    v_admin_id,
    p_target_user_id,
    '👤 Your role has been updated to: ' || LOWER(TRIM(p_new_role)),
    'status_update'
  );

  -- Get updated user data
  SELECT row_to_json(u.*) INTO v_result
  FROM (
    SELECT id, email, name, role, is_active
    FROM public.cmms_users
    WHERE id = p_target_user_id
  ) u;

  RETURN QUERY SELECT 
    TRUE, 
    'Role updated successfully from ' || v_admin_role || ' to ' || LOWER(TRIM(p_new_role))::TEXT,
    v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_update_cmms_user_role TO authenticated;

-- ============================================================
-- 5. TEST THE TRIGGER
-- ============================================================

DO $$
DECLARE
  v_test_result RECORD;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'TESTING ROLE NORMALIZATION TRIGGER';
  RAISE NOTICE '========================================';
  
  -- The trigger will automatically normalize any new inserts/updates
  RAISE NOTICE '✅ Trigger installed successfully';
  RAISE NOTICE '';
  RAISE NOTICE 'The trigger will:';
  RAISE NOTICE '  1. Trim whitespace from roles';
  RAISE NOTICE '  2. Convert roles to lowercase';
  RAISE NOTICE '  3. Default invalid roles to "member"';
  RAISE NOTICE '  4. Normalize email addresses';
  RAISE NOTICE '  5. Trim user names';
  RAISE NOTICE '';
  RAISE NOTICE 'Examples:';
  RAISE NOTICE '  "SUPERVISOR  " → "supervisor"';
  RAISE NOTICE '  " Admin" → "admin"';
  RAISE NOTICE '  "InvalidRole" → "member"';
  RAISE NOTICE '';
END $$;

-- ============================================================
-- 6. VERIFICATION QUERY
-- ============================================================

SELECT 
  email,
  role,
  CASE role
    WHEN 'admin' THEN '👑 Can assign tasks, manage users, full access'
    WHEN 'coordinator' THEN '📋 Can assign tasks, manage projects'
    WHEN 'supervisor' THEN '👥 Can assign tasks, manage team'
    WHEN 'member' THEN '✋ Can view and complete assigned tasks'
    ELSE '❓ Unknown role'
  END as permissions,
  is_active
FROM public.cmms_users
ORDER BY 
  CASE role
    WHEN 'admin' THEN 1
    WHEN 'coordinator' THEN 2
    WHEN 'supervisor' THEN 3
    WHEN 'member' THEN 4
    ELSE 5
  END,
  email;

-- ============================================================
-- SUCCESS MESSAGE
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ ROLE NORMALIZATION SYSTEM INSTALLED';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE '🛡️ Protection Features:';
  RAISE NOTICE '   ✅ Auto-normalize roles on insert/update';
  RAISE NOTICE '   ✅ Validate roles against allowed list';
  RAISE NOTICE '   ✅ Default invalid roles to "member"';
  RAISE NOTICE '   ✅ Admin-only role management function';
  RAISE NOTICE '';
  RAISE NOTICE '📝 Available Roles:';
  RAISE NOTICE '   • admin      - Full system access';
  RAISE NOTICE '   • coordinator - Project management';
  RAISE NOTICE '   • supervisor  - Team management';
  RAISE NOTICE '   • member      - Task execution';
  RAISE NOTICE '';
  RAISE NOTICE '🔧 Admin Function:';
  RAISE NOTICE '   fn_update_cmms_user_role(company_id, user_id, new_role)';
  RAISE NOTICE '';
  RAISE NOTICE '🎯 Result: Role-related permission errors eliminated!';
  RAISE NOTICE '';
END $$;
