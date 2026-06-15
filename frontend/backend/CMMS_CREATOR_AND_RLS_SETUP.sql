-- ============================================================
-- CMMS CREATOR + RLS UNIFIED DEPLOYMENT SCRIPT
-- ============================================================
-- Run this entire file in Supabase SQL Editor.
-- It executes creator/admin enforcement first, then RLS policies.

-- >>> BEGIN: CMMS_CREATOR_ADMIN_ENFORCEMENT.sql
-- ============================================================
-- CMMS CREATOR + ADMIN ENFORCEMENT
-- ============================================================
-- What this script does:
-- 1) Makes company creator become Admin automatically
-- 2) Normalizes role names (admin / CMMS_Admin, etc.)
-- 3) Ensures mark_company_creator also grants Admin role
-- 4) Rebuilds cmms_users_with_roles with stable effective_role
--
-- Run this in Supabase SQL Editor.

-- ------------------------------------------------------------
-- 1) Creator tracking columns/table
-- ------------------------------------------------------------
ALTER TABLE public.cmms_company_profiles
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES public.cmms_users(id),
  ADD COLUMN IF NOT EXISTS owner_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS is_creator_marked BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.cmms_company_creators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL UNIQUE REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  creator_user_id UUID NOT NULL UNIQUE REFERENCES public.cmms_users(id) ON DELETE CASCADE,
  creator_email VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmms_company_creators_company_id
  ON public.cmms_company_creators(cmms_company_id);

CREATE INDEX IF NOT EXISTS idx_cmms_company_creators_user_id
  ON public.cmms_company_creators(creator_user_id);

CREATE INDEX IF NOT EXISTS idx_cmms_company_creators_email
  ON public.cmms_company_creators(creator_email);

-- ------------------------------------------------------------
-- 2) Role normalization helper
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cmms_normalize_role_key(p_role TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF p_role IS NULL THEN
    RETURN NULL;
  END IF;

  v_role := lower(trim(p_role));
  v_role := regexp_replace(v_role, '^cmms[_-]', '');
  v_role := regexp_replace(v_role, '[\s_]+', '-', 'g');

  CASE v_role
    WHEN 'administrator' THEN RETURN 'admin';
    WHEN 'admin' THEN RETURN 'admin';
    WHEN 'department-coordinator' THEN RETURN 'coordinator';
    WHEN 'coordinator' THEN RETURN 'coordinator';
    WHEN 'financial-officer' THEN RETURN 'finance';
    WHEN 'finance-officer' THEN RETURN 'finance';
    WHEN 'finance' THEN RETURN 'finance';
    WHEN 'supervisor' THEN RETURN 'supervisor';
    WHEN 'technician' THEN RETURN 'technician';
    WHEN 'storeman' THEN RETURN 'storeman';
    WHEN 'service-provider' THEN RETURN 'service-provider';
    WHEN 'serviceprovider' THEN RETURN 'service-provider';
    WHEN 'viewer' THEN RETURN 'viewer';
    ELSE
      RETURN v_role;
  END CASE;
END;
$$;

-- ------------------------------------------------------------
-- 3) Ensure creator always has Admin role
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_cmms_creator_admin(
  p_company_id UUID,
  p_user_id UUID,
  p_creator_email VARCHAR DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_role_id public.cmms_user_roles.cmms_role_id%TYPE;
  v_creator_email VARCHAR(255);
BEGIN
  v_creator_email := COALESCE(
    NULLIF(trim(p_creator_email), ''),
    (SELECT email FROM public.cmms_users WHERE id = p_user_id LIMIT 1)
  );

  SELECT r.id
  INTO v_admin_role_id
  FROM public.cmms_roles r
  WHERE public.cmms_normalize_role_key(r.role_name) = 'admin'
  ORDER BY COALESCE(r.permission_level, 0) DESC
  LIMIT 1;

  IF v_admin_role_id IS NULL THEN
    RAISE EXCEPTION 'CMMS Admin role not found in cmms_roles';
  END IF;

  INSERT INTO public.cmms_user_roles (
    cmms_company_id,
    cmms_user_id,
    cmms_role_id,
    assigned_by,
    assigned_at,
    is_active
  )
  VALUES (
    p_company_id,
    p_user_id,
    v_admin_role_id,
    p_user_id,
    NOW(),
    TRUE
  )
  ON CONFLICT (cmms_company_id, cmms_user_id, cmms_role_id)
  DO UPDATE SET
    is_active = TRUE,
    assigned_by = COALESCE(public.cmms_user_roles.assigned_by, EXCLUDED.assigned_by),
    assigned_at = COALESCE(public.cmms_user_roles.assigned_at, EXCLUDED.assigned_at);

  INSERT INTO public.cmms_company_creators (
    cmms_company_id,
    creator_user_id,
    creator_email
  )
  VALUES (
    p_company_id,
    p_user_id,
    v_creator_email
  )
  ON CONFLICT (cmms_company_id)
  DO UPDATE SET
    creator_user_id = EXCLUDED.creator_user_id,
    creator_email = COALESCE(EXCLUDED.creator_email, public.cmms_company_creators.creator_email);

  UPDATE public.cmms_company_profiles
  SET
    created_by_user_id = p_user_id,
    owner_email = COALESCE(v_creator_email, owner_email),
    is_creator_marked = TRUE
  WHERE id = p_company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_cmms_creator_admin(UUID, UUID, VARCHAR) TO authenticated;

-- ------------------------------------------------------------
-- 4) Helper functions for admin checks + secure role assignment
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cmms_current_user_id_for_company(p_company_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_auth_email TEXT;
  v_cmms_user_id UUID;
BEGIN
  SELECT au.email
  INTO v_auth_email
  FROM auth.users au
  WHERE au.id = auth.uid();

  IF v_auth_email IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT u.id
  INTO v_cmms_user_id
  FROM public.cmms_users u
  WHERE u.cmms_company_id = p_company_id
    AND lower(u.email) = lower(v_auth_email)
    AND u.is_active = TRUE
  ORDER BY u.created_at ASC
  LIMIT 1;

  RETURN v_cmms_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cmms_is_company_admin(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_cmms_user_id UUID;
BEGIN
  v_current_cmms_user_id := public.cmms_current_user_id_for_company(p_company_id);
  IF v_current_cmms_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cmms_company_profiles cp
    WHERE cp.id = p_company_id
      AND cp.created_by_user_id = v_current_cmms_user_id
  ) THEN
    RETURN TRUE;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cmms_company_creators cc
    WHERE cc.cmms_company_id = p_company_id
      AND cc.creator_user_id = v_current_cmms_user_id
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.cmms_user_roles ur
    JOIN public.cmms_roles r ON r.id = ur.cmms_role_id
    WHERE ur.cmms_company_id = p_company_id
      AND ur.cmms_user_id = v_current_cmms_user_id
      AND ur.is_active = TRUE
      AND public.cmms_normalize_role_key(r.role_name) = 'admin'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_cmms_user_role_by_key(
  p_company_id UUID,
  p_user_id UUID,
  p_role_key TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_id public.cmms_user_roles.cmms_role_id%TYPE;
  v_assigned_by UUID;
BEGIN
  IF NOT public.cmms_is_company_admin(p_company_id) THEN
    RAISE EXCEPTION 'Only Admin users can assign roles in this company';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cmms_users u
    WHERE u.id = p_user_id
      AND u.cmms_company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Target CMMS user does not belong to this company';
  END IF;

  SELECT r.id
  INTO v_role_id
  FROM public.cmms_roles r
  WHERE public.cmms_normalize_role_key(r.role_name) = public.cmms_normalize_role_key(p_role_key)
  ORDER BY COALESCE(r.permission_level, 0) DESC
  LIMIT 1;

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'Requested role "%" was not found in cmms_roles', p_role_key;
  END IF;

  v_assigned_by := public.cmms_current_user_id_for_company(p_company_id);

  INSERT INTO public.cmms_user_roles (
    cmms_company_id,
    cmms_user_id,
    cmms_role_id,
    assigned_by,
    assigned_at,
    is_active
  )
  VALUES (
    p_company_id,
    p_user_id,
    v_role_id,
    v_assigned_by,
    NOW(),
    TRUE
  )
  ON CONFLICT (cmms_company_id, cmms_user_id, cmms_role_id)
  DO UPDATE SET
    is_active = TRUE,
    assigned_by = COALESCE(EXCLUDED.assigned_by, public.cmms_user_roles.assigned_by),
    assigned_at = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION public.cmms_current_user_id_for_company(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_is_company_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_cmms_user_role_by_key(UUID, UUID, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 5) Backward-compatible RPC wrapper
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_company_creator(
  p_company_id UUID,
  p_user_id UUID,
  p_creator_email VARCHAR
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_cmms_creator_admin(p_company_id, p_user_id, p_creator_email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_company_creator(UUID, UUID, VARCHAR) TO authenticated;

-- ------------------------------------------------------------
-- 6) Auto-creator trigger on first cmms_users row
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cmms_auto_assign_creator_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_email VARCHAR(255);
  v_created_by_user_id UUID;
  v_company_user_count INTEGER;
BEGIN
  SELECT cp.owner_email, cp.created_by_user_id
  INTO v_owner_email, v_created_by_user_id
  FROM public.cmms_company_profiles cp
  WHERE cp.id = NEW.cmms_company_id;

  SELECT COUNT(*)
  INTO v_company_user_count
  FROM public.cmms_users u
  WHERE u.cmms_company_id = NEW.cmms_company_id;

  IF v_created_by_user_id IS NULL AND v_company_user_count = 1 THEN
    PERFORM public.ensure_cmms_creator_admin(NEW.cmms_company_id, NEW.id, NEW.email);
  ELSIF v_created_by_user_id = NEW.id THEN
    PERFORM public.ensure_cmms_creator_admin(NEW.cmms_company_id, NEW.id, NEW.email);
  ELSIF v_owner_email IS NOT NULL AND lower(v_owner_email) = lower(NEW.email) THEN
    PERFORM public.ensure_cmms_creator_admin(NEW.cmms_company_id, NEW.id, NEW.email);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cmms_auto_assign_creator_admin ON public.cmms_users;
CREATE TRIGGER trg_cmms_auto_assign_creator_admin
AFTER INSERT ON public.cmms_users
FOR EACH ROW
EXECUTE FUNCTION public.cmms_auto_assign_creator_admin();

-- ------------------------------------------------------------
-- 7) Stable users-with-roles view used by frontend
-- ------------------------------------------------------------
DROP VIEW IF EXISTS public.cmms_users_with_roles;

CREATE VIEW public.cmms_users_with_roles AS
SELECT
  u.id,
  u.cmms_company_id,
  u.email,
  u.user_name,
  u.full_name,
  u.phone,
  u.department,
  u.job_title,
  u.is_active,
  u.created_at,
  COALESCE(
    STRING_AGG(
      DISTINCT public.cmms_normalize_role_key(r.role_name),
      ', '
      ORDER BY public.cmms_normalize_role_key(r.role_name)
    ),
    ''
  ) AS role_labels,
  CASE
    WHEN cp.created_by_user_id = u.id OR cc.creator_user_id = u.id THEN 'admin'
    ELSE COALESCE(
      (ARRAY_AGG(
        public.cmms_normalize_role_key(r.role_name)
        ORDER BY COALESCE(r.permission_level, 0) DESC, r.role_name
      ))[1],
      'viewer'
    )
  END AS effective_role,
  CASE
    WHEN cp.created_by_user_id = u.id OR cc.creator_user_id = u.id THEN TRUE
    ELSE FALSE
  END AS is_creator
FROM public.cmms_users u
LEFT JOIN public.cmms_user_roles ur
  ON u.id = ur.cmms_user_id
  AND ur.is_active = TRUE
LEFT JOIN public.cmms_roles r
  ON ur.cmms_role_id = r.id
LEFT JOIN public.cmms_company_profiles cp
  ON cp.id = u.cmms_company_id
LEFT JOIN public.cmms_company_creators cc
  ON cc.cmms_company_id = u.cmms_company_id
GROUP BY
  u.id,
  u.cmms_company_id,
  u.email,
  u.user_name,
  u.full_name,
  u.phone,
  u.department,
  u.job_title,
  u.is_active,
  u.created_at,
  cp.created_by_user_id,
  cc.creator_user_id;

GRANT SELECT ON public.cmms_users_with_roles TO authenticated, anon;

-- ------------------------------------------------------------
-- 8) Backfill: first user in each company becomes creator/admin
-- ------------------------------------------------------------
DO $$
DECLARE
  v_company RECORD;
  v_first_user_id UUID;
  v_first_user_email VARCHAR(255);
BEGIN
  FOR v_company IN
    SELECT cp.id AS company_id
    FROM public.cmms_company_profiles cp
  LOOP
    SELECT u.id, u.email
    INTO v_first_user_id, v_first_user_email
    FROM public.cmms_users u
    WHERE u.cmms_company_id = v_company.company_id
      AND u.is_active = TRUE
    ORDER BY u.created_at ASC
    LIMIT 1;

    IF v_first_user_id IS NOT NULL THEN
      PERFORM public.ensure_cmms_creator_admin(
        v_company.company_id,
        v_first_user_id,
        v_first_user_email
      );
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 9) Quick verification
-- ------------------------------------------------------------
SELECT
  cp.id AS company_id,
  cp.company_name,
  cp.owner_email,
  cp.created_by_user_id,
  cp.is_creator_marked
FROM public.cmms_company_profiles cp
ORDER BY cp.created_at DESC
LIMIT 20;

-- >>> BEGIN: CMMS_RLS_POLICIES.sql
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
-- 1) ENABLE RLS ON CMMS TABLES
-- ============================================================

ALTER TABLE public.cmms_company_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_company_creators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_notifications ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2) CMMS_COMPANY_PROFILES POLICIES
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
-- 3) CMMS_USERS POLICIES
-- ============================================================

-- Policy: Allow authenticated users to create themselves in a company
CREATE POLICY "allow_create_user" ON public.cmms_users
  FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated' AND
    lower(email) = lower(auth.jwt() ->> 'email')
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
-- 4) CMMS_USER_ROLES POLICIES
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
-- 5) CMMS_COMPANY_CREATORS POLICIES
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
-- 6) CMMS_NOTIFICATIONS POLICIES
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
-- 7) VERIFICATION
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
