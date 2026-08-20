-- ============================================================
-- FIX CMMS ATTENDANCE FOREIGN KEY RELATIONSHIP
-- ============================================================
-- This fixes the 400 Bad Request error when querying with embedded resources
-- Error: staff:cmms_user_id(id,full_name,email,avatar_url)

-- The foreign key already exists, but we need to ensure PostgREST can detect it
-- First, let's verify the foreign key constraint exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'cmms_staff_attendance_cmms_user_id_fkey'
    AND table_name = 'cmms_staff_attendance'
  ) THEN
    -- Add the foreign key if it doesn't exist
    ALTER TABLE public.cmms_staff_attendance
    ADD CONSTRAINT cmms_staff_attendance_cmms_user_id_fkey
    FOREIGN KEY (cmms_user_id) 
    REFERENCES public.cmms_users(id) 
    ON DELETE CASCADE;
    
    RAISE NOTICE 'Added foreign key constraint cmms_staff_attendance_cmms_user_id_fkey';
  ELSE
    RAISE NOTICE 'Foreign key constraint already exists';
  END IF;
END $$;

-- Ensure the cmms_users table has proper RLS policies for embedded queries
-- PostgREST needs to be able to read the related records

-- Check if RLS is enabled on cmms_users
ALTER TABLE public.cmms_users ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can read company members" ON public.cmms_users;
DROP POLICY IF EXISTS "Authenticated users can read active CMMS users" ON public.cmms_users;

-- Allow authenticated users to read CMMS users in their company
CREATE POLICY "Authenticated users can read active CMMS users" ON public.cmms_users
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL 
    AND is_active = true
    AND (
      -- User can see members of their own company
      EXISTS (
        SELECT 1 FROM public.cmms_users cu
        WHERE cu.cmms_company_id = cmms_users.cmms_company_id
          AND cu.is_active = true
          AND lower(cu.email) = lower(auth.jwt() ->> 'email')
      )
      -- OR user is an admin/staff who needs to see attendance records
      OR EXISTS (
        SELECT 1 FROM public.cmms_users cu
        JOIN public.cmms_staff_attendance ca ON ca.cmms_user_id = cmms_users.id
        WHERE cu.is_active = true
          AND lower(cu.email) = lower(auth.jwt() ->> 'email')
          AND cu.cmms_company_id = ca.cmms_company_id
      )
    )
  );

-- Verify the setup
DO $$
DECLARE
  v_fk_exists BOOLEAN;
  v_rls_enabled BOOLEAN;
  v_policy_count INT;
BEGIN
  -- Check foreign key
  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name LIKE '%cmms_user_id%'
    AND table_name = 'cmms_staff_attendance'
    AND constraint_type = 'FOREIGN KEY'
  ) INTO v_fk_exists;
  
  -- Check RLS
  SELECT relrowsecurity 
  FROM pg_class 
  WHERE relname = 'cmms_users' 
  INTO v_rls_enabled;
  
  -- Count policies
  SELECT COUNT(*) 
  FROM pg_policies 
  WHERE tablename = 'cmms_users' 
  INTO v_policy_count;
  
  RAISE NOTICE '✓ Foreign key exists: %', v_fk_exists;
  RAISE NOTICE '✓ RLS enabled on cmms_users: %', v_rls_enabled;
  RAISE NOTICE '✓ Policies on cmms_users: %', v_policy_count;
  
  IF v_fk_exists AND v_rls_enabled AND v_policy_count > 0 THEN
    RAISE NOTICE '✓ Setup complete! The embedded resource query should now work.';
  ELSE
    RAISE WARNING '⚠ Some checks failed. Review the output above.';
  END IF;
END $$;

-- Grant necessary permissions
GRANT SELECT ON public.cmms_users TO authenticated;
GRANT SELECT ON public.cmms_staff_attendance TO authenticated;
