-- ============================================================
-- CMMS ROW-LEVEL SECURITY (RLS) POLICIES
-- ============================================================
-- This script enables RLS and sets up security policies for CMMS tables
-- Run this AFTER CMMS_CREATOR_ADMIN_ENFORCEMENT.sql
-- 
-- RLS ensures:
-- 1) Users can only see/modify their own company data
-- 2) Authenticated users can create company profiles
-- 3) Admins can manage all company data
-- 4) Role-based access control is enforced at database level

-- ============================================================
-- 1) ENSURE REQUIRED TABLES EXIST
-- ============================================================

-- Create notifications table if it does not exist yet
CREATE TABLE IF NOT EXISTS public.cmms_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_user_id UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  notification_type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  icon VARCHAR(10) DEFAULT '📬',
  action_link VARCHAR(255) DEFAULT NULL,
  action_label VARCHAR(100) DEFAULT 'View',
  action_tab VARCHAR(50) DEFAULT NULL,
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmms_notifications_user_id
  ON public.cmms_notifications(cmms_user_id);
CREATE INDEX IF NOT EXISTS idx_cmms_notifications_company_id
  ON public.cmms_notifications(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_cmms_notifications_is_read
  ON public.cmms_notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_cmms_notifications_created_at
  ON public.cmms_notifications(created_at DESC);

-- ============================================================
-- 2) ENABLE RLS ON CMMS TABLES
-- ============================================================

ALTER TABLE public.cmms_company_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_company_creators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_notifications ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3) CMMS_COMPANY_PROFILES POLICIES
-- ============================================================

-- Remove all existing CMMS policies first to avoid conflicts with older scripts
DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'cmms_company_profiles',
        'cmms_users',
        'cmms_user_roles',
        'cmms_roles',
        'cmms_company_creators',
        'cmms_notifications'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- Policy: Allow authenticated users to create their own company
CREATE POLICY "allow_create_company_profile" ON public.cmms_company_profiles
  FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated' AND
    (created_by IS NULL OR created_by = auth.uid())
  );

-- Policy: Allow users to view company profiles where they are a member
CREATE POLICY "allow_view_company_profile" ON public.cmms_company_profiles
  FOR SELECT
  USING (
    auth.role() = 'authenticated' AND (
      -- Bootstrap access so INSERT ... RETURNING works before cmms_users row exists
      created_by = auth.uid()
      OR lower(coalesce(owner_email, '')) = lower(auth.jwt() ->> 'email')
      OR lower(coalesce(email, '')) = lower(auth.jwt() ->> 'email')
      OR public.cmms_current_user_id_for_company(id) IS NOT NULL
    )
  );

-- Policy: Allow admins to update company profile
CREATE POLICY "allow_update_company_profile" ON public.cmms_company_profiles
  FOR UPDATE
  USING (
    auth.role() = 'authenticated' AND
    public.cmms_is_company_admin(id)
  )
  WITH CHECK (
    auth.role() = 'authenticated' AND
    public.cmms_is_company_admin(id)
  );

-- Policy: Allow anon to view cmms_roles (needed for dropdown selection)
CREATE POLICY "allow_anon_view_roles" ON public.cmms_roles
  FOR SELECT
  USING (true);

-- ============================================================
-- 4) CMMS_USERS POLICIES
-- ============================================================

-- Policy: Allow company admins (and creator bootstrap) to create users in their company
CREATE POLICY "allow_create_user" ON public.cmms_users
  FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated' AND (
      public.cmms_is_company_admin(cmms_company_id)
      OR EXISTS (
        SELECT 1
        FROM public.cmms_company_profiles cp
        WHERE cp.id = cmms_users.cmms_company_id
          AND cp.created_by = auth.uid()
      )
    )
  );
-- Policy: Allow users to view other users in same company
CREATE POLICY "allow_view_users_same_company" ON public.cmms_users
  FOR SELECT
  USING (
    auth.role() = 'authenticated' AND
    public.cmms_current_user_id_for_company(cmms_company_id) IS NOT NULL
  );

-- Policy: Allow admins to update/delete users
CREATE POLICY "allow_admin_modify_users" ON public.cmms_users
  FOR UPDATE
  USING (
    auth.role() = 'authenticated' AND
    public.cmms_is_company_admin(cmms_company_id)
  )
  WITH CHECK (
    auth.role() = 'authenticated' AND
    public.cmms_is_company_admin(cmms_company_id)
  );

CREATE POLICY "allow_admin_delete_users" ON public.cmms_users
  FOR DELETE
  USING (
    auth.role() = 'authenticated' AND
    public.cmms_is_company_admin(cmms_company_id)
  );

-- ============================================================
-- 5) CMMS_USER_ROLES POLICIES
-- ============================================================

-- Policy: Allow authenticated users to create roles (via RPC)
CREATE POLICY "allow_admin_assign_roles" ON public.cmms_user_roles
  FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated' AND
    public.cmms_is_company_admin(cmms_company_id)
  );

-- Policy: Allow users to view roles for their company
CREATE POLICY "allow_view_company_roles" ON public.cmms_user_roles
  FOR SELECT
  USING (
    auth.role() = 'authenticated' AND
    public.cmms_current_user_id_for_company(cmms_company_id) IS NOT NULL
  );

-- Policy: Allow admins to update/delete roles
CREATE POLICY "allow_admin_modify_roles" ON public.cmms_user_roles
  FOR UPDATE
  USING (
    auth.role() = 'authenticated' AND
    public.cmms_is_company_admin(cmms_company_id)
  )
  WITH CHECK (
    auth.role() = 'authenticated' AND
    public.cmms_is_company_admin(cmms_company_id)
  );

CREATE POLICY "allow_admin_delete_roles" ON public.cmms_user_roles
  FOR DELETE
  USING (
    auth.role() = 'authenticated' AND
    public.cmms_is_company_admin(cmms_company_id)
  );

-- ============================================================
-- 6) CMMS_COMPANY_CREATORS POLICIES
-- ============================================================

-- Policy: Allow creators to be created by system (via trigger/RPC)
CREATE POLICY "allow_create_creator_record" ON public.cmms_company_creators
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Policy: Allow users to view creator info for their company
CREATE POLICY "allow_view_creator_info" ON public.cmms_company_creators
  FOR SELECT
  USING (
    auth.role() = 'authenticated' AND
    public.cmms_current_user_id_for_company(cmms_company_id) IS NOT NULL
  );

-- ============================================================
-- 7) CMMS_NOTIFICATIONS POLICIES
-- ============================================================

-- Policy: Allow inserting notifications
CREATE POLICY "allow_create_notification" ON public.cmms_notifications
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Policy: Allow users to view their own notifications
CREATE POLICY "allow_view_own_notifications" ON public.cmms_notifications
  FOR SELECT
  USING (
    auth.role() = 'authenticated' AND
    cmms_user_id = public.cmms_current_user_id_for_company(cmms_company_id)
  );

-- Policy: Allow users to update their own notifications (mark as read)
CREATE POLICY "allow_update_own_notifications" ON public.cmms_notifications
  FOR UPDATE
  USING (
    auth.role() = 'authenticated' AND
    cmms_user_id = public.cmms_current_user_id_for_company(cmms_company_id)
  )
  WITH CHECK (
    auth.role() = 'authenticated' AND
    cmms_user_id = public.cmms_current_user_id_for_company(cmms_company_id)
  );

-- ============================================================
-- 8) VERIFICATION
-- ============================================================

-- Show RLS status for all CMMS tables
SELECT 
  schemaname, 
  tablename, 
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public' 
  AND tablename LIKE 'cmms_%'
ORDER BY tablename;

-- Show all RLS policies
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename LIKE 'cmms_%'
ORDER BY tablename, policyname;




