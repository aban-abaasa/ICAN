-- ================================================================
-- FIX: Add Missing UPDATE, INSERT, DELETE Policies for cmms_users
-- ================================================================
-- Problem: cmms_users table only has SELECT policy, blocking all updates
-- This prevents department_id assignment from working

-- Drop existing incomplete policies
DROP POLICY IF EXISTS "user_select_policy" ON public.cmms_users;

-- Recreate all policies for cmms_users
ALTER TABLE public.cmms_users ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can view users in their company
CREATE POLICY user_select_policy ON public.cmms_users
FOR SELECT USING (
  cmms_company_id = public.get_user_company_id()
);

-- INSERT: Allow creation of new users in the company
CREATE POLICY user_insert_policy ON public.cmms_users
FOR INSERT WITH CHECK (
  cmms_company_id = public.get_user_company_id()
);

-- UPDATE: Allow updates to users in the company (including department_id)
CREATE POLICY user_update_policy ON public.cmms_users
FOR UPDATE USING (
  cmms_company_id = public.get_user_company_id()
) WITH CHECK (
  cmms_company_id = public.get_user_company_id()
);

-- DELETE: Allow deletion of users from the company
CREATE POLICY user_delete_policy ON public.cmms_users
FOR DELETE USING (
  cmms_company_id = public.get_user_company_id()
);

-- ================================================================
-- VERIFICATION
-- ================================================================
SELECT 'cmms_users RLS policies fixed! UPDATE now allowed for department_id.' as status;

-- Check policies are in place
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  cmd
FROM pg_policies 
WHERE tablename = 'cmms_users'
ORDER BY policyname;
