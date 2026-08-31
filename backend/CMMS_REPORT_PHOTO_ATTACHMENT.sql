-- ============================================================
-- CMMS Written Report Photo Attachments
-- Purpose: Let employees attach one photo to a written report, and keep
-- that photo behind the SAME role-based access rules already enforced on
-- the report text itself:
--   - Admin: any photo in the company
--   - Coordinator/Supervisor: photos from reports in their department
--   - Everyone else: only their own photos
-- Photos are stored in Cloudflare R2 via the same presigned-URL flow
-- already used for pitches/statuses/avatars (see
-- backend/routes/storageRoutes.js and
-- frontend/src/services/r2StorageService.js) -- not Supabase Storage.
-- There is no per-object RLS on the R2 key; access is enforced the same
-- way the report TEXT already is: fn_get_filtered_reports only ever
-- returns photo_url for rows a given caller is already allowed to see,
-- so an unauthorized user never even receives the key needed to resolve
-- a live URL.
-- ============================================================

-- ============================================================
-- 1. COLUMNS ON THE REPORT ROW
-- photo_url stores an "r2://<key>" marker (resolved client-side to a live
-- presigned URL via resolveMediaValue/resolveMediaValues); photo_path
-- stores the raw R2 key.
-- ============================================================

ALTER TABLE public.cmms_company_reports
ADD COLUMN IF NOT EXISTS photo_url TEXT;

ALTER TABLE public.cmms_company_reports
ADD COLUMN IF NOT EXISTS photo_path TEXT;

-- ============================================================
-- 2. CLEANUP -- an earlier version of this feature uploaded straight to a
-- private Supabase Storage bucket guarded by storage.objects RLS. That
-- approach is replaced by R2 above. Safe to run: no upload ever succeeded
-- against the old policy (that's the bug this migration fixes), so there
-- are no orphaned files to worry about.
--
-- The bucket row itself is NOT dropped here -- Supabase blocks direct
-- DELETEs on storage.buckets/storage.objects ("Direct deletion from
-- storage tables is not allowed. Use the Storage API instead."). With its
-- policies gone, RLS denies all access to it by default, so leaving the
-- empty bucket behind is inert. To remove it too, delete the
-- "cmms-report-photos" bucket from the Supabase Dashboard's Storage page
-- (or via the Management API), not SQL.
-- ============================================================

DROP POLICY IF EXISTS "cmms_report_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "cmms_report_photos_select" ON storage.objects;
DROP POLICY IF EXISTS "cmms_report_photos_delete" ON storage.objects;
DROP FUNCTION IF EXISTS public.fn_current_auth_email();

-- ============================================================
-- 3. fn_create_filtered_report: accept the uploaded photo
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_create_filtered_report(UUID, TEXT, VARCHAR, VARCHAR, TEXT, UUID, VARCHAR) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_create_filtered_report(
  p_company_id UUID,
  p_report_title TEXT,
  p_report_category VARCHAR DEFAULT 'general',
  p_severity VARCHAR DEFAULT 'medium',
  p_report_body TEXT DEFAULT '',
  p_department_id UUID DEFAULT NULL,
  p_visibility_level VARCHAR DEFAULT 'department',
  p_photo_url TEXT DEFAULT NULL,
  p_photo_path TEXT DEFAULT NULL
)
RETURNS public.cmms_company_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
  v_cmms_user_id UUID;
  v_cmms_role TEXT;
  v_department_id UUID;
  v_report public.cmms_company_reports;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email
    FROM auth.users
    WHERE id = v_auth_uid;
  END IF;

  SELECT cu.id, LOWER(COALESCE(cu.role, 'member')), cu.department_id
  INTO v_cmms_user_id, v_cmms_role, v_department_id
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_cmms_user_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this CMMS company';
  END IF;

  -- Use user's department if not specified
  IF p_department_id IS NULL THEN
    p_department_id := v_department_id;
  END IF;

  -- Ensure department belongs to company
  IF p_department_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cmms_departments
      WHERE id = p_department_id
        AND cmms_company_id = p_company_id
    ) THEN
      RAISE EXCEPTION 'Department does not belong to this company';
    END IF;
  END IF;

  -- Set visibility based on role if admin can override
  -- Coordinators/Supervisors can only set department visibility
  -- Regular members can only set personal visibility
  IF v_cmms_role NOT IN ('admin', 'coordinator', 'supervisor') THEN
    p_visibility_level := 'personal';
  ELSIF v_cmms_role NOT IN ('admin') AND p_visibility_level = 'company' THEN
    p_visibility_level := 'department';
  END IF;

  INSERT INTO public.cmms_company_reports (
    cmms_company_id,
    department_id,
    report_title,
    report_category,
    severity,
    report_body,
    reporter_cmms_user_id,
    reporter_name,
    reporter_email,
    reporter_role,
    visibility_level,
    photo_url,
    photo_path,
    status,
    created_at,
    updated_at
  ) VALUES (
    p_company_id,
    p_department_id,
    COALESCE(NULLIF(TRIM(COALESCE(p_report_title, '')), ''), 'Company Report'),
    COALESCE(NULLIF(TRIM(COALESCE(p_report_category, '')), ''), 'general'),
    CASE
      WHEN LOWER(COALESCE(p_severity, 'medium')) IN ('low', 'medium', 'high', 'critical')
      THEN LOWER(COALESCE(p_severity, 'medium'))
      ELSE 'medium'
    END,
    COALESCE(NULLIF(TRIM(COALESCE(p_report_body, '')), ''), 'No details provided'),
    v_cmms_user_id,
    (SELECT name FROM public.cmms_users WHERE id = v_cmms_user_id),
    v_auth_email,
    v_cmms_role,
    p_visibility_level,
    NULLIF(TRIM(COALESCE(p_photo_url, '')), ''),
    NULLIF(TRIM(COALESCE(p_photo_path, '')), ''),
    'open',
    NOW(),
    NOW()
  )
  RETURNING * INTO v_report;

  RETURN v_report;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_create_filtered_report(UUID, TEXT, VARCHAR, VARCHAR, TEXT, UUID, VARCHAR, TEXT, TEXT) TO authenticated;

-- ============================================================
-- 4. fn_get_filtered_reports: return the photo alongside the report
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_get_filtered_reports(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_get_filtered_reports(p_company_id UUID)
RETURNS TABLE (
  id UUID,
  report_title TEXT,
  report_category VARCHAR,
  severity VARCHAR,
  report_body TEXT,
  status VARCHAR,
  reporter_name VARCHAR,
  reporter_email VARCHAR,
  reporter_role VARCHAR,
  department_id UUID,
  visibility_level VARCHAR,
  photo_url TEXT,
  photo_path TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  is_own_report BOOLEAN,
  access_level VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_auth_email TEXT;
  v_cmms_user_id UUID;
  v_cmms_role TEXT;
  v_department_id UUID;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get current user details
  v_auth_email := NULLIF(TRIM(COALESCE(auth.jwt() ->> 'email', '')), '');
  IF v_auth_email IS NULL THEN
    SELECT email INTO v_auth_email
    FROM auth.users
    WHERE id = v_auth_uid;
  END IF;

  SELECT cu.id, LOWER(COALESCE(cu.role, 'member')), cu.department_id
  INTO v_cmms_user_id, v_cmms_role, v_department_id
  FROM public.cmms_users cu
  WHERE cu.cmms_company_id = p_company_id
    AND LOWER(cu.email) = LOWER(v_auth_email)
    AND cu.is_active = TRUE
  LIMIT 1;

  IF v_cmms_user_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this CMMS company';
  END IF;

  -- Return reports based on user role.
  -- Every column is explicitly cast to its declared OUT type below. This is
  -- deliberate: "structure of query does not match function result type" is
  -- thrown by Postgres whenever a selected column's real type doesn't bit-for-bit
  -- match the RETURNS TABLE declaration (e.g. a text/varchar mismatch introduced
  -- by an older migration). Casting removes that ambiguity entirely.
  RETURN QUERY
  SELECT
    ccr.id::UUID,
    ccr.report_title::TEXT,
    ccr.report_category::VARCHAR,
    ccr.severity::VARCHAR,
    ccr.report_body::TEXT,
    ccr.status::VARCHAR,
    ccr.reporter_name::VARCHAR,
    ccr.reporter_email::VARCHAR,
    ccr.reporter_role::VARCHAR,
    ccr.department_id::UUID,
    ccr.visibility_level::VARCHAR,
    ccr.photo_url::TEXT,
    ccr.photo_path::TEXT,
    ccr.created_at::TIMESTAMPTZ,
    ccr.updated_at::TIMESTAMPTZ,
    (ccr.reporter_cmms_user_id = v_cmms_user_id)::BOOLEAN AS is_own_report,
    (CASE
      WHEN v_cmms_role = 'admin' THEN 'admin_full_access'
      WHEN v_cmms_role IN ('coordinator', 'supervisor') AND ccr.department_id = v_department_id THEN 'department_access'
      WHEN ccr.reporter_cmms_user_id = v_cmms_user_id THEN 'personal_access'
      ELSE 'no_access'
    END)::VARCHAR AS access_level
  FROM public.cmms_company_reports ccr
  WHERE ccr.cmms_company_id = p_company_id
    AND (
      -- ADMIN: See all reports
      v_cmms_role = 'admin'
      -- COORDINATOR/SUPERVISOR: See their department reports
      OR (v_cmms_role IN ('coordinator', 'supervisor')
        AND ccr.department_id = v_department_id)
      -- EVERYONE: See their own reports
      OR ccr.reporter_cmms_user_id = v_cmms_user_id
    )
  ORDER BY ccr.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_filtered_reports(UUID) TO authenticated;

-- ============================================================
-- 5. DIAGNOSTICS — only needed if fn_get_filtered_reports still errors
-- with "structure of query does not match function result type" after
-- re-running this file. Run these two SELECTs by hand in the Supabase
-- SQL editor and compare the output to the RETURNS TABLE list above.
-- ============================================================

-- 6a. Actual live columns on cmms_company_reports (name/type/order)
-- SELECT column_name, data_type, character_maximum_length, ordinal_position
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'cmms_company_reports'
-- ORDER BY ordinal_position;

-- 6b. Check for a leftover overload of fn_get_filtered_reports with a
-- different argument list (would explain PostgREST calling the wrong one)
-- SELECT pg_get_function_identity_arguments(p.oid) AS args,
--        pg_get_function_result(p.oid) AS returns
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'fn_get_filtered_reports';
