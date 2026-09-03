-- ============================================================
-- CMMS Announcements, Job Postings & Public Notice Board
-- ============================================================
-- Lets a company post two kinds of items from inside CMMS:
--   - "announcement": a poster/notice (company news, event, policy)
--   - "job": a vacancy applicants can apply to
-- Each item has a visibility:
--   - "public"   -> shown on the no-login notice board at /notices/<companyId>
--   - "internal" -> shown only to signed-in staff of that company
-- Job applicants never need an ICAN account: they apply with name/email/
-- phone/CV and get a reference code back, then look up status later with
-- that code + the same email or phone (no account, no password).
--
-- Access control follows the company's existing admin-configurable role
-- model (cmms_roles.tool_access JSONB, configured from CMMS > Role
-- configuration) instead of a hardcoded "admin only" check: the company
-- admin can grant the "announcements" tool -- and its individual actions
-- (create/edit/delete/manage_applications) -- to any role, exactly like
-- every other CMMS tool. See CMMS_ADMIN_MANAGED_ROLES.sql and
-- CMMS_ROLE_PERMISSIONS_AND_PAYROLL_ACCESS.sql for the existing pattern
-- this reuses.
--
-- Posters/PDFs upload via the same Cloudflare R2 presigned-URL flow CMMS
-- report photos already use (backend/routes/storageRoutes.js), not
-- Supabase Storage -- see CMMS_REPORT_PHOTO_ATTACHMENT.sql for why.
--
-- Run after: CMMS_CREATOR_ADMIN_ENFORCEMENT.sql, CMMS_ADMIN_MANAGED_ROLES.sql,
-- CMMS_ROLE_PERMISSIONS_AND_PAYROLL_ACCESS.sql, CMMS_NOTIFICATIONS_TABLE.sql,
-- ICAN_CMMS_PUSH_NOTIFICATIONS.sql (so publishing/applications also push to
-- phones), UNIFIED_BUSINESS_MANAGEMENT_AND_SUPPLIER_MARKETPLACE.sql (for
-- business_profile_modules).
-- Safe to run more than once.
-- ============================================================

-- ============================================================
-- 1. Company logo, for the public notice board header
-- ============================================================
ALTER TABLE public.cmms_company_profiles
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS logo_path TEXT;

-- ============================================================
-- 2. Permission helpers: does a given (or the calling) CMMS user have a
-- specific action on a specific tool, per their assigned role's
-- tool_access JSONB? Company admin/creator always TRUE. This generalizes
-- the inline hasToolAction()/getToolScope() logic already used on the
-- frontend (CMSSModule.jsx) so RPCs/RLS can enforce the same rule
-- server-side, and so notification fan-out can ask "which staff members
-- are allowed to see this?" for an arbitrary user, not just the caller.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cmms_user_has_tool_action(
  p_cmms_user_id UUID,
  p_company_id UUID,
  p_tool_id TEXT,
  p_action TEXT DEFAULT 'view'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin_or_creator BOOLEAN;
  v_access JSONB;
BEGIN
  IF p_cmms_user_id IS NULL OR p_company_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.cmms_company_profiles cp
    WHERE cp.id = p_company_id AND cp.created_by_user_id = p_cmms_user_id
    UNION ALL
    SELECT 1 FROM public.cmms_company_creators cc
    WHERE cc.cmms_company_id = p_company_id AND cc.creator_user_id = p_cmms_user_id
    UNION ALL
    SELECT 1 FROM public.cmms_user_roles ur
    JOIN public.cmms_roles r ON r.id = ur.cmms_role_id
    WHERE ur.cmms_company_id = p_company_id
      AND ur.cmms_user_id = p_cmms_user_id
      AND ur.is_active = TRUE
      AND public.cmms_normalize_role_key(r.role_name) = 'admin'
  ) INTO v_is_admin_or_creator;

  IF v_is_admin_or_creator THEN
    RETURN TRUE;
  END IF;

  SELECT r.tool_access -> p_tool_id
  INTO v_access
  FROM public.cmms_user_roles ur
  JOIN public.cmms_roles r ON r.id = ur.cmms_role_id
  WHERE ur.cmms_company_id = p_company_id
    AND ur.cmms_user_id = p_cmms_user_id
    AND ur.is_active = TRUE
    AND r.is_active = TRUE
  ORDER BY COALESCE(r.permission_level, 0) DESC
  LIMIT 1;

  IF v_access IS NULL THEN
    RETURN FALSE;
  END IF;

  IF jsonb_typeof(v_access) = 'boolean' THEN
    RETURN (v_access)::text::boolean;
  END IF;

  RETURN COALESCE((v_access ->> p_action)::boolean, FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.cmms_has_tool_action(
  p_company_id UUID,
  p_tool_id TEXT,
  p_action TEXT DEFAULT 'view'
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.cmms_user_has_tool_action(
    public.cmms_current_user_id_for_company(p_company_id),
    p_company_id,
    p_tool_id,
    p_action
  );
$$;

GRANT EXECUTE ON FUNCTION public.cmms_user_has_tool_action(UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_has_tool_action(UUID, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.cmms_has_tool_action(UUID, TEXT, TEXT)
  IS 'Checks the calling users tool_access permission for a CMMS company tool/action, with admin/creator override.';

-- ============================================================
-- 3. cmms_announcements -- the poster / notice / job posting itself
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  created_by_cmms_user_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,

  post_type VARCHAR(20) NOT NULL DEFAULT 'announcement'
    CHECK (post_type IN ('announcement', 'job')),
  visibility VARCHAR(20) NOT NULL DEFAULT 'internal'
    CHECK (visibility IN ('public', 'internal')),
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'closed', 'archived')),

  title VARCHAR(255) NOT NULL,
  summary VARCHAR(500),
  body TEXT NOT NULL,

  -- Poster image and/or a PDF attachment, both via R2 (r2://<key> markers).
  poster_url TEXT,
  poster_path TEXT,
  document_url TEXT,
  document_path TEXT,

  -- Job-only fields (NULL for plain announcements)
  department VARCHAR(150),
  location VARCHAR(255),
  employment_type VARCHAR(30)
    CHECK (employment_type IS NULL OR employment_type IN
      ('full_time', 'part_time', 'contract', 'internship', 'temporary', 'volunteer')),
  positions_available INTEGER CHECK (positions_available IS NULL OR positions_available > 0),
  salary_range VARCHAR(150),
  application_deadline DATE,
  application_instructions TEXT,

  views_count INTEGER NOT NULL DEFAULT 0,
  applications_count INTEGER NOT NULL DEFAULT 0,

  published_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmms_announcements_company ON public.cmms_announcements(cmms_company_id);
CREATE INDEX IF NOT EXISTS idx_cmms_announcements_public_feed
  ON public.cmms_announcements(cmms_company_id, post_type, status, published_at DESC)
  WHERE visibility = 'public';
CREATE INDEX IF NOT EXISTS idx_cmms_announcements_status ON public.cmms_announcements(cmms_company_id, status);

-- ============================================================
-- 4. cmms_job_applications -- anonymous applicants, tracked by reference code
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_job_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_posting_id UUID NOT NULL REFERENCES public.cmms_announcements(id) ON DELETE CASCADE,
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,

  reference_code VARCHAR(20) NOT NULL UNIQUE,
  applicant_name VARCHAR(255) NOT NULL,
  applicant_email VARCHAR(255) NOT NULL,
  applicant_phone VARCHAR(50),
  cover_note TEXT,
  resume_url TEXT,
  resume_path TEXT,

  status VARCHAR(30) NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'under_review', 'shortlisted', 'interview', 'rejected', 'hired', 'withdrawn')),
  status_note TEXT,
  status_updated_at TIMESTAMPTZ,
  status_updated_by UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmms_job_applications_job ON public.cmms_job_applications(job_posting_id);
CREATE INDEX IF NOT EXISTS idx_cmms_job_applications_company ON public.cmms_job_applications(cmms_company_id, status);
CREATE INDEX IF NOT EXISTS idx_cmms_job_applications_reference ON public.cmms_job_applications(reference_code);

-- ============================================================
-- 5. updated_at triggers
-- ============================================================

CREATE OR REPLACE FUNCTION public.cmms_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cmms_announcements_touch_updated_at ON public.cmms_announcements;
CREATE TRIGGER trg_cmms_announcements_touch_updated_at
  BEFORE UPDATE ON public.cmms_announcements
  FOR EACH ROW EXECUTE FUNCTION public.cmms_touch_updated_at();

DROP TRIGGER IF EXISTS trg_cmms_job_applications_touch_updated_at ON public.cmms_job_applications;
CREATE TRIGGER trg_cmms_job_applications_touch_updated_at
  BEFORE UPDATE ON public.cmms_job_applications
  FOR EACH ROW EXECUTE FUNCTION public.cmms_touch_updated_at();

-- Stamp published_at the first time a post goes live, and default a job's
-- initial insert-as-published straight to "now" too.
CREATE OR REPLACE FUNCTION public.cmms_stamp_announcement_published_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cmms_announcements_stamp_published_at ON public.cmms_announcements;
CREATE TRIGGER trg_cmms_announcements_stamp_published_at
  BEFORE INSERT OR UPDATE ON public.cmms_announcements
  FOR EACH ROW EXECUTE FUNCTION public.cmms_stamp_announcement_published_at();

-- ============================================================
-- 6. RLS -- cmms_announcements
-- Any active company member can see every post for their company
-- (internal notices are meant for staff eyes; public posts obviously too).
-- Only someone whose role grants the relevant "announcements" tool action
-- may create/edit/delete -- company admin/creator always can.
-- ============================================================

ALTER TABLE public.cmms_announcements ENABLE ROW LEVEL SECURITY;

-- NOTE: deliberately NOT an inline `... = (SELECT email FROM auth.users ...)`
-- check here -- unlike a SECURITY DEFINER function, an RLS policy body runs
-- under the CALLING role's own grants, and `authenticated` has no SELECT
-- grant on auth.users in this project. That exact anti-pattern is why
-- CMMS_ADMIN_MANAGED_ROLES.sql's cmms_roles_company_select policy and this
-- one both throw "permission denied for table users" (see
-- FIX_AUTH_USERS_PERMISSION_ERROR.sql for the same bug elsewhere). Routing
-- through cmms_current_user_id_for_company() -- already SECURITY DEFINER,
-- so it runs with the function owner's grants -- does the identical
-- "active member of this company" check without touching auth.users from
-- inside the policy itself.
DROP POLICY IF EXISTS cmms_announcements_company_select ON public.cmms_announcements;
CREATE POLICY cmms_announcements_company_select ON public.cmms_announcements
  FOR SELECT USING (
    public.cmms_current_user_id_for_company(cmms_announcements.cmms_company_id) IS NOT NULL
  );

DROP POLICY IF EXISTS cmms_announcements_insert ON public.cmms_announcements;
CREATE POLICY cmms_announcements_insert ON public.cmms_announcements
  FOR INSERT WITH CHECK (
    public.cmms_has_tool_action(cmms_company_id, 'announcements', 'create')
  );

DROP POLICY IF EXISTS cmms_announcements_update ON public.cmms_announcements;
CREATE POLICY cmms_announcements_update ON public.cmms_announcements
  FOR UPDATE USING (
    public.cmms_has_tool_action(cmms_company_id, 'announcements', 'edit')
  ) WITH CHECK (
    public.cmms_has_tool_action(cmms_company_id, 'announcements', 'edit')
  );

DROP POLICY IF EXISTS cmms_announcements_delete ON public.cmms_announcements;
CREATE POLICY cmms_announcements_delete ON public.cmms_announcements
  FOR DELETE USING (
    public.cmms_has_tool_action(cmms_company_id, 'announcements', 'delete')
  );

-- ============================================================
-- 7. RLS -- cmms_job_applications
-- No INSERT/DELETE policy for authenticated users at all -- applications
-- are only ever created by fn_submit_public_job_application (SECURITY
-- DEFINER, runs as table owner, bypasses RLS) so the public-facing apply
-- flow is the single, validated entry point. Staff who can manage
-- applications may view and update status.
-- ============================================================

ALTER TABLE public.cmms_job_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cmms_job_applications_company_select ON public.cmms_job_applications;
CREATE POLICY cmms_job_applications_company_select ON public.cmms_job_applications
  FOR SELECT USING (
    public.cmms_has_tool_action(cmms_company_id, 'announcements', 'manage_applications')
  );

DROP POLICY IF EXISTS cmms_job_applications_company_update ON public.cmms_job_applications;
CREATE POLICY cmms_job_applications_company_update ON public.cmms_job_applications
  FOR UPDATE USING (
    public.cmms_has_tool_action(cmms_company_id, 'announcements', 'manage_applications')
  ) WITH CHECK (
    public.cmms_has_tool_action(cmms_company_id, 'announcements', 'manage_applications')
  );

-- ============================================================
-- 8. Notifications -- publish a post -> notify every active staff member;
-- a new application arrives -> notify only staff who can manage applications.
-- These insert into the existing cmms_notifications table, which already
-- has a push-notification trigger (ICAN_CMMS_PUSH_NOTIFICATIONS.sql) that
-- fires on INSERT, so this also reaches phones with no extra wiring.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cmms_notify_new_announcement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    INSERT INTO public.cmms_notifications (
      cmms_user_id, cmms_company_id, notification_type, title, message, icon, action_tab
    )
    SELECT
      u.id,
      NEW.cmms_company_id,
      CASE WHEN NEW.post_type = 'job' THEN 'job_posting_published' ELSE 'company_notice_published' END,
      CASE WHEN NEW.post_type = 'job' THEN 'New job posting: ' || NEW.title ELSE 'New notice: ' || NEW.title END,
      COALESCE(NULLIF(TRIM(COALESCE(NEW.summary, '')), ''), LEFT(NEW.body, 140)),
      CASE WHEN NEW.post_type = 'job' THEN '💼' ELSE '📢' END,
      'announcements'
    FROM public.cmms_users u
    WHERE u.cmms_company_id = NEW.cmms_company_id
      AND u.is_active = TRUE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cmms_notify_new_announcement ON public.cmms_announcements;
CREATE TRIGGER trg_cmms_notify_new_announcement
  AFTER INSERT OR UPDATE ON public.cmms_announcements
  FOR EACH ROW EXECUTE FUNCTION public.cmms_notify_new_announcement();

CREATE OR REPLACE FUNCTION public.cmms_notify_new_job_application()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_title TEXT;
BEGIN
  SELECT title INTO v_job_title FROM public.cmms_announcements WHERE id = NEW.job_posting_id;

  INSERT INTO public.cmms_notifications (
    cmms_user_id, cmms_company_id, notification_type, title, message, icon, action_tab
  )
  SELECT
    u.id,
    NEW.cmms_company_id,
    'job_application_received',
    'New application: ' || COALESCE(v_job_title, 'Job posting'),
    NEW.applicant_name || ' applied (ref ' || NEW.reference_code || ')',
    '🧑‍💼',
    'announcements'
  FROM public.cmms_users u
  WHERE u.cmms_company_id = NEW.cmms_company_id
    AND u.is_active = TRUE
    AND public.cmms_user_has_tool_action(u.id, NEW.cmms_company_id, 'announcements', 'manage_applications');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cmms_notify_new_job_application ON public.cmms_job_applications;
CREATE TRIGGER trg_cmms_notify_new_job_application
  AFTER INSERT ON public.cmms_job_applications
  FOR EACH ROW EXECUTE FUNCTION public.cmms_notify_new_job_application();

-- ============================================================
-- 9. Public RPCs -- no login required. Every function below returns only
-- a narrow, safe column set (same principle as fn_get_public_profile_info
-- in PITCHIN_PUBLIC_PROFILE_INFO_RPC.sql) and is granted to anon.
-- ============================================================

-- 9a. Company header for the public notice board (/notices/<companyId>)
DROP FUNCTION IF EXISTS public.fn_get_public_cmms_company_header(UUID);
CREATE OR REPLACE FUNCTION public.fn_get_public_cmms_company_header(p_company_id UUID)
RETURNS TABLE (
  id UUID,
  company_name VARCHAR,
  industry VARCHAR,
  location VARCHAR,
  website VARCHAR,
  logo_url TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cp.id, cp.company_name, cp.industry, cp.location, cp.website, cp.logo_url
  FROM public.cmms_company_profiles cp
  WHERE cp.id = p_company_id;
$$;

-- 9b. Published + public posts for the board, newest first
DROP FUNCTION IF EXISTS public.fn_get_public_cmms_notices(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.fn_get_public_cmms_notices(p_company_id UUID, p_post_type TEXT DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  post_type VARCHAR,
  title VARCHAR,
  summary VARCHAR,
  body TEXT,
  poster_url TEXT,
  document_url TEXT,
  department VARCHAR,
  location VARCHAR,
  employment_type VARCHAR,
  positions_available INTEGER,
  salary_range VARCHAR,
  application_deadline DATE,
  application_instructions TEXT,
  published_at TIMESTAMPTZ,
  views_count INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id, a.post_type, a.title, a.summary, a.body, a.poster_url, a.document_url,
    a.department, a.location, a.employment_type, a.positions_available, a.salary_range,
    a.application_deadline, a.application_instructions, a.published_at, a.views_count
  FROM public.cmms_announcements a
  WHERE a.cmms_company_id = p_company_id
    AND a.visibility = 'public'
    AND a.status = 'published'
    AND (a.expires_at IS NULL OR a.expires_at > NOW())
    AND (p_post_type IS NULL OR a.post_type = p_post_type)
  ORDER BY a.published_at DESC NULLS LAST;
$$;

-- 9c. Single post detail (job apply page / poster detail view) -- counts a view
DROP FUNCTION IF EXISTS public.fn_get_public_cmms_notice(UUID);
CREATE OR REPLACE FUNCTION public.fn_get_public_cmms_notice(p_notice_id UUID)
RETURNS TABLE (
  id UUID,
  cmms_company_id UUID,
  post_type VARCHAR,
  title VARCHAR,
  summary VARCHAR,
  body TEXT,
  poster_url TEXT,
  document_url TEXT,
  department VARCHAR,
  location VARCHAR,
  employment_type VARCHAR,
  positions_available INTEGER,
  salary_range VARCHAR,
  application_deadline DATE,
  application_instructions TEXT,
  published_at TIMESTAMPTZ,
  is_open BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.cmms_announcements a
  SET views_count = a.views_count + 1
  WHERE a.id = p_notice_id
    AND a.visibility = 'public'
    AND a.status = 'published';

  RETURN QUERY
  SELECT
    a.id, a.cmms_company_id, a.post_type, a.title, a.summary, a.body, a.poster_url, a.document_url,
    a.department, a.location, a.employment_type, a.positions_available, a.salary_range,
    a.application_deadline, a.application_instructions, a.published_at,
    (
      a.status = 'published'
      AND (a.expires_at IS NULL OR a.expires_at > NOW())
      AND (a.application_deadline IS NULL OR a.application_deadline >= CURRENT_DATE)
    ) AS is_open
  FROM public.cmms_announcements a
  WHERE a.id = p_notice_id
    AND a.visibility = 'public'
    AND a.status = 'published';
END;
$$;

-- 9d. Submit a job application -- no account needed
DROP FUNCTION IF EXISTS public.fn_submit_public_job_application(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.fn_submit_public_job_application(
  p_job_posting_id UUID,
  p_applicant_name TEXT,
  p_applicant_email TEXT,
  p_applicant_phone TEXT DEFAULT NULL,
  p_cover_note TEXT DEFAULT NULL,
  p_resume_url TEXT DEFAULT NULL,
  p_resume_path TEXT DEFAULT NULL
)
RETURNS TABLE (reference_code VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cmms_announcements;
  v_reference_code VARCHAR(20);
BEGIN
  SELECT * INTO v_job
  FROM public.cmms_announcements
  WHERE id = p_job_posting_id
    AND post_type = 'job'
    AND visibility = 'public'
    AND status = 'published'
  FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'This job posting is not open for applications.';
  END IF;

  IF v_job.application_deadline IS NOT NULL AND v_job.application_deadline < CURRENT_DATE THEN
    RAISE EXCEPTION 'The application deadline for this job has passed.';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_applicant_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Applicant name is required.';
  END IF;
  IF NULLIF(TRIM(COALESCE(p_applicant_email, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Applicant email is required.';
  END IF;

  v_reference_code := 'JOB-' || UPPER(SUBSTR(REPLACE(gen_random_uuid()::text, '-', ''), 1, 8));

  INSERT INTO public.cmms_job_applications (
    job_posting_id, cmms_company_id, reference_code,
    applicant_name, applicant_email, applicant_phone,
    cover_note, resume_url, resume_path, status
  ) VALUES (
    v_job.id, v_job.cmms_company_id, v_reference_code,
    TRIM(p_applicant_name), LOWER(TRIM(p_applicant_email)), NULLIF(TRIM(COALESCE(p_applicant_phone, '')), ''),
    NULLIF(TRIM(COALESCE(p_cover_note, '')), ''),
    NULLIF(TRIM(COALESCE(p_resume_url, '')), ''), NULLIF(TRIM(COALESCE(p_resume_path, '')), ''),
    'submitted'
  );

  UPDATE public.cmms_announcements
  SET applications_count = applications_count + 1
  WHERE id = v_job.id;

  RETURN QUERY SELECT v_reference_code;
END;
$$;

-- 9e. Track an application -- reference code + the email or phone used to apply
DROP FUNCTION IF EXISTS public.fn_track_public_job_application(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.fn_track_public_job_application(p_reference_code TEXT, p_contact TEXT)
RETURNS TABLE (
  reference_code VARCHAR,
  job_title VARCHAR,
  company_name VARCHAR,
  status VARCHAR,
  status_note TEXT,
  submitted_at TIMESTAMPTZ,
  status_updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ja.reference_code, a.title, cp.company_name, ja.status, ja.status_note,
    ja.created_at, ja.status_updated_at
  FROM public.cmms_job_applications ja
  JOIN public.cmms_announcements a ON a.id = ja.job_posting_id
  JOIN public.cmms_company_profiles cp ON cp.id = ja.cmms_company_id
  WHERE ja.reference_code = UPPER(TRIM(p_reference_code))
    AND (
      lower(ja.applicant_email) = lower(TRIM(p_contact))
      OR ja.applicant_phone = TRIM(p_contact)
    );
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_public_cmms_company_header(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_public_cmms_notices(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_public_cmms_notice(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_submit_public_job_application(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_track_public_job_application(TEXT, TEXT) TO anon, authenticated;

-- ============================================================
-- 10. Make "Announcements & jobs" a selectable-but-off module for every
-- existing company, matching CMMS_ADMIN_SELECTED_MODULES.sql's approach:
-- appears in CMMS > Configure modules immediately, enabled by no one
-- until that company's administrator turns it on.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.business_profile_modules') IS NOT NULL THEN
    INSERT INTO public.business_profile_modules (business_profile_id, module_key, enabled)
    SELECT bp.id, 'announcements', FALSE
    FROM public.business_profiles bp
    ON CONFLICT (business_profile_id, module_key) DO NOTHING;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS announcements, job postings and public notice board installed' AS status;
