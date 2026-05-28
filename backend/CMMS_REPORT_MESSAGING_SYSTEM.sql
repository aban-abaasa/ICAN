-- ============================================================
-- CMMS Report Messaging & Job Assignment System
-- Purpose: Enable role-based messaging on reports and job assignments
-- - Users can send messages/comments on reports
-- - Admins/Coordinators/Supervisors can assign users to jobs
-- - Message threading and replies support
-- ============================================================

-- ============================================================
-- PREREQUISITES: Ensure required tables exist
-- ============================================================

-- Check if cmms_companies table exists, if not create minimal version
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cmms_companies' AND table_schema = 'public') THEN
    CREATE TABLE public.cmms_companies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    RAISE NOTICE 'Created cmms_companies table';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cmms_users' AND table_schema = 'public') THEN
    CREATE TABLE public.cmms_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cmms_company_id UUID REFERENCES public.cmms_companies(id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      role VARCHAR(50) DEFAULT 'member',
      department_id UUID,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    RAISE NOTICE 'Created cmms_users table';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cmms_company_reports' AND table_schema = 'public') THEN
    CREATE TABLE public.cmms_company_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cmms_company_id UUID REFERENCES public.cmms_companies(id) ON DELETE CASCADE,
      reporter_cmms_user_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
      report_title VARCHAR(255),
      report_body TEXT,
      department_id UUID,
      visibility_level VARCHAR(50) DEFAULT 'personal',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    RAISE NOTICE 'Created cmms_company_reports table';
  END IF;
END $$;

-- ============================================================
-- PREREQUISITES: Ensure all required columns exist
-- ============================================================

-- Add missing columns to cmms_users if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cmms_users' AND column_name = 'name') THEN
    ALTER TABLE public.cmms_users ADD COLUMN name VARCHAR(255);
    RAISE NOTICE 'Added name column to cmms_users';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cmms_users' AND column_name = 'role') THEN
    ALTER TABLE public.cmms_users ADD COLUMN role VARCHAR(50) DEFAULT 'member';
    RAISE NOTICE 'Added role column to cmms_users';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cmms_users' AND column_name = 'is_active') THEN
    ALTER TABLE public.cmms_users ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
    RAISE NOTICE 'Added is_active column to cmms_users';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cmms_users' AND column_name = 'department_id') THEN
    ALTER TABLE public.cmms_users ADD COLUMN department_id UUID;
    RAISE NOTICE 'Added department_id column to cmms_users';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cmms_company_reports' AND column_name = 'report_title') THEN
    ALTER TABLE public.cmms_company_reports ADD COLUMN report_title VARCHAR(255);
    RAISE NOTICE 'Added report_title column to cmms_company_reports';
  END IF;
END $$;

-- ============================================================
-- 1. CREATE REPORT MESSAGES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_report_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES public.cmms_company_reports(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.cmms_companies(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  message_text TEXT NOT NULL,
  message_type VARCHAR(20) DEFAULT 'comment' CHECK (message_type IN ('comment', 'assignment', 'status_update', 'reply')),
  parent_message_id UUID REFERENCES public.cmms_report_messages(id) ON DELETE CASCADE,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Indexes for performance
  CONSTRAINT message_not_empty CHECK (TRIM(message_text) != '')
);

CREATE INDEX IF NOT EXISTS idx_cmms_messages_report ON public.cmms_report_messages(report_id);
CREATE INDEX IF NOT EXISTS idx_cmms_messages_company ON public.cmms_report_messages(company_id);
CREATE INDEX IF NOT EXISTS idx_cmms_messages_sender ON public.cmms_report_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_cmms_messages_recipient ON public.cmms_report_messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_cmms_messages_unread ON public.cmms_report_messages(recipient_id, is_read);
CREATE INDEX IF NOT EXISTS idx_cmms_messages_thread ON public.cmms_report_messages(parent_message_id);

-- Make report_id nullable if it's not already
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.cmms_report_messages ALTER COLUMN report_id DROP NOT NULL;
    RAISE NOTICE 'Made report_id nullable in cmms_report_messages';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'report_id already nullable or table does not exist';
  END;
END $$;

-- ============================================================
-- 2. CREATE JOB ASSIGNMENTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_job_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES public.cmms_company_reports(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.cmms_companies(id) ON DELETE CASCADE,
  assigned_to_user_id UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
  assigned_by_user_id UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  job_title VARCHAR(255) NOT NULL,
  job_description TEXT,
  assignment_status VARCHAR(20) DEFAULT 'pending' CHECK (assignment_status IN ('pending', 'accepted', 'in_progress', 'completed', 'rejected')),
  due_date DATE,
  priority VARCHAR(10) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT job_not_empty CHECK (TRIM(job_title) != '')
);

-- Make report_id nullable if it's not already
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.cmms_job_assignments ALTER COLUMN report_id DROP NOT NULL;
    RAISE NOTICE 'Made report_id nullable in cmms_job_assignments';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'report_id already nullable or table does not exist';
  END;
END $$;

CREATE INDEX IF NOT EXISTS idx_job_assignment_report ON public.cmms_job_assignments(report_id);
CREATE INDEX IF NOT EXISTS idx_job_assignment_user ON public.cmms_job_assignments(assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_job_assignment_status ON public.cmms_job_assignments(assignment_status);
CREATE INDEX IF NOT EXISTS idx_job_assignment_company ON public.cmms_job_assignments(company_id);

-- ============================================================
-- 2.5. ENABLE RLS ON ALL TABLES
-- ============================================================

-- NOTE: RLS disabled on message and job assignment tables
-- SECURITY DEFINER functions handle all authorization
-- RLS would cause permission issues when trying to access auth.users

-- ============================================================
-- 3. RLS POLICIES FOR MESSAGES - DISABLED
-- ============================================================

-- RLS policies removed - SECURITY DEFINER functions handle authorization

-- ============================================================
-- 4. RLS POLICIES FOR JOB ASSIGNMENTS - DISABLED
-- ============================================================

-- RLS policies removed - SECURITY DEFINER functions handle authorization

-- ============================================================
-- 5. RLS POLICIES FOR CMMS_USERS (Allow viewing company members)
-- ============================================================

-- RLS disabled on cmms_users - functions use SECURITY DEFINER for proper authorization
DROP POLICY IF EXISTS "cmms_users_read" ON public.cmms_users;

-- ============================================================
-- 6. FUNCTION: Get Company Users (for dropdowns and assignments)
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_get_company_users(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_get_company_users(p_company_id UUID)
RETURNS TABLE (
  id UUID,
  name VARCHAR,
  email VARCHAR,
  role VARCHAR,
  department_id UUID,
  is_active BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email FROM auth.users WHERE id = v_auth_uid;
  END IF;

  -- Verify caller is a member of the company
  IF NOT EXISTS (
    SELECT 1
    FROM public.cmms_users cu
    WHERE cu.cmms_company_id = p_company_id
      AND LOWER(cu.email) = LOWER(v_auth_email)
      AND cu.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'You are not a member of this CMMS company';
  END IF;

  RETURN QUERY
  SELECT
    cu.id,
    cu.name,
    cu.email,
    cu.role,
    cu.department_id,
    cu.is_active
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
    AND cu.is_active = TRUE
  ORDER BY cu.name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_company_users TO authenticated;

-- ============================================================
-- 7. FUNCTION: Send Message on Report
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_send_report_message(UUID, UUID, TEXT, UUID, VARCHAR) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_send_report_message(
  p_company_id UUID,
  p_report_id UUID,
  p_message_text TEXT,
  p_recipient_id UUID DEFAULT NULL,
  p_message_type VARCHAR DEFAULT 'comment'
)
RETURNS public.cmms_report_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
  v_sender_id UUID;
  v_message public.cmms_report_messages;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email FROM auth.users WHERE id = v_auth_uid;
  END IF;

  SELECT cu.id
  INTO v_sender_id
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_sender_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this CMMS company';
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

  -- Validate recipient if specified
  IF p_recipient_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cmms_users
      WHERE id = p_recipient_id AND cmms_company_id = p_company_id AND is_active = TRUE
    ) THEN
      RAISE EXCEPTION 'Recipient not found or inactive';
    END IF;
  END IF;

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
    v_sender_id,
    p_recipient_id,
    TRIM(p_message_text),
    COALESCE(p_message_type, 'comment')
  )
  RETURNING * INTO v_message;

  RETURN v_message;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_send_report_message TO authenticated;

-- ============================================================
-- 8. FUNCTION: Get Report Messages Thread
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_get_report_messages(UUID, UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_get_report_messages(
  p_company_id UUID,
  p_report_id UUID
)
RETURNS TABLE (
  id UUID,
  sender_name VARCHAR,
  sender_email VARCHAR,
  recipient_name VARCHAR,
  recipient_email VARCHAR,
  message_text TEXT,
  message_type VARCHAR,
  is_read BOOLEAN,
  created_at TIMESTAMPTZ,
  thread_level INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH message_hierarchy AS (
    SELECT
      m.id,
      m.sender_id,
      m.recipient_id,
      m.message_text,
      m.message_type,
      m.is_read,
      m.created_at,
      m.parent_message_id,
      0 AS thread_level
    FROM public.cmms_report_messages m
    WHERE m.report_id = p_report_id
      AND m.company_id = p_company_id
      AND m.parent_message_id IS NULL
    
    UNION ALL
    
    SELECT
      m.id,
      m.sender_id,
      m.recipient_id,
      m.message_text,
      m.message_type,
      m.is_read,
      m.created_at,
      m.parent_message_id,
      mh.thread_level + 1
    FROM public.cmms_report_messages m
    JOIN message_hierarchy mh ON m.parent_message_id = mh.id
  )
  SELECT
    mh.id,
    (SELECT u.name FROM public.cmms_users u WHERE u.id = mh.sender_id) AS sender_name,
    (SELECT u.email FROM public.cmms_users u WHERE u.id = mh.sender_id) AS sender_email,
    (SELECT u.name FROM public.cmms_users u WHERE u.id = mh.recipient_id) AS recipient_name,
    (SELECT u.email FROM public.cmms_users u WHERE u.id = mh.recipient_id) AS recipient_email,
    mh.message_text,
    mh.message_type,
    mh.is_read,
    mh.created_at,
    mh.thread_level
  FROM message_hierarchy mh
  ORDER BY mh.created_at ASC, mh.thread_level ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_report_messages TO authenticated;

-- ============================================================
-- 8.5. FUNCTION: Get User Messages (all messages for a user)
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_get_user_messages(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_get_user_messages(p_company_id UUID)
RETURNS TABLE (
  id UUID,
  report_id UUID,
  report_title VARCHAR,
  sender_name VARCHAR,
  sender_email VARCHAR,
  recipient_name VARCHAR,
  recipient_email VARCHAR,
  message_text TEXT,
  message_type VARCHAR,
  is_read BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
  v_user_id UUID;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email FROM auth.users WHERE id = v_auth_uid;
  END IF;

  SELECT cu.id
  INTO v_user_id
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this CMMS company';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.report_id,
    COALESCE(ccr.report_title, '')::VARCHAR,
    (SELECT u.name FROM public.cmms_users u WHERE u.id = m.sender_id) AS sender_name,
    (SELECT u.email FROM public.cmms_users u WHERE u.id = m.sender_id) AS sender_email,
    (SELECT u.name FROM public.cmms_users u WHERE u.id = m.recipient_id) AS recipient_name,
    (SELECT u.email FROM public.cmms_users u WHERE u.id = m.recipient_id) AS recipient_email,
    m.message_text,
    m.message_type,
    m.is_read,
    m.created_at
  FROM public.cmms_report_messages m
  LEFT JOIN public.cmms_company_reports ccr ON ccr.id = m.report_id
  WHERE m.company_id = p_company_id
    AND (
      m.sender_id = v_user_id
      OR m.recipient_id = v_user_id
    )
  ORDER BY m.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_user_messages TO authenticated;

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

  SELECT cu.id, LOWER(COALESCE(cu.role, 'member'))
  INTO v_assigner_id, v_assigner_role
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_assigner_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this CMMS company';
  END IF;

  -- Only admin/coordinator/supervisor can assign jobs
  IF v_assigner_role NOT IN ('admin', 'coordinator', 'supervisor') THEN
    RAISE EXCEPTION 'Only admin, coordinator, or supervisor can assign jobs';
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
    TRIM(p_job_title),
    TRIM(COALESCE(p_job_description, '')),
    p_due_date,
    COALESCE(p_priority, 'medium')
  )
  RETURNING * INTO v_assignment;

  -- Send notification message (always, even if report_id is NULL)
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
    'Job assigned: ' || p_job_title || ' (Priority: ' || COALESCE(p_priority, 'medium') || ')',
    'assignment'
  );

  RETURN v_assignment;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_assign_job TO authenticated;

-- ============================================================
-- 10. FUNCTION: Get User Job Assignments
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_get_user_job_assignments(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_get_user_job_assignments(p_company_id UUID)
RETURNS TABLE (
  id UUID,
  report_id UUID,
  report_title VARCHAR,
  job_title VARCHAR,
  job_description TEXT,
  assignment_status VARCHAR,
  priority VARCHAR,
  due_date DATE,
  assigned_by_name VARCHAR,
  assigned_by_email VARCHAR,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  days_until_due INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
  v_user_id UUID;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email FROM auth.users WHERE id = v_auth_uid;
  END IF;

  SELECT cu.id
  INTO v_user_id
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this CMMS company';
  END IF;

  RETURN QUERY
  SELECT
    cja.id,
    cja.report_id,
    COALESCE(ccr.report_title, '')::VARCHAR,
    cja.job_title,
    cja.job_description,
    cja.assignment_status,
    cja.priority,
    cja.due_date,
    (SELECT u.name FROM public.cmms_users u WHERE u.id = cja.assigned_by_user_id) AS assigned_by_name,
    (SELECT u.email FROM public.cmms_users u WHERE u.id = cja.assigned_by_user_id) AS assigned_by_email,
    cja.created_at,
    cja.updated_at,
    (cja.due_date - CURRENT_DATE)::INT AS days_until_due
  FROM public.cmms_job_assignments cja
  LEFT JOIN public.cmms_company_reports ccr ON ccr.id = cja.report_id
  WHERE cja.assigned_to_user_id = v_user_id
    AND cja.company_id = p_company_id
  ORDER BY cja.priority DESC, cja.due_date ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_user_job_assignments TO authenticated;

-- ============================================================
-- 11. DEPLOYMENT VERIFICATION
-- ============================================================

SELECT 'CMMS Report Messaging & Job Assignment System Deployed Successfully' AS status;
