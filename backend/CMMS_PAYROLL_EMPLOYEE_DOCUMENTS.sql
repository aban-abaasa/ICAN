-- ============================================================================
-- CMMS PAYROLL — EMPLOYEE CREDENTIAL DOCUMENTS ("Employee files")
-- ============================================================================
-- Adds a real per-employee document vault to the Payroll tool: National ID /
-- passport, academic & professional certificates, CV, bank details, tax PIN
-- (URA TIN) and NSSF certificates, next-of-kin form, police clearance,
-- medical certificate, work permit, a signed contract copy, or anything
-- else HR needs on file for that employee's payroll record.
--
-- Files are real uploads through the app's existing Cloudflare R2 storage
-- (frontend/src/services/r2StorageService.js -> backend/routes/storageRoutes.js),
-- the SAME mechanism CMMSAnnouncementsPanel.jsx and
-- CMMSEmploymentDocumentsPanel.jsx already use — not a bare URL text field
-- like cmms_leave_requests.supporting_document_url. Deliberately reuses the
-- already-allowlisted 'cmms-employment-documents' R2 folder rather than
-- adding a new one: the backend is deployed as a fixed set of Vercel
-- serverless functions, so this file introduces zero backend route/function
-- changes -- it only creates the database side (table + RPCs).
--
-- Also lets a document be auto-picked from the hiring pipeline instead of
-- re-uploaded: an applicant's résumé/CV on file in
-- cmms_job_applications.resume_url (CMMS_ANNOUNCEMENTS_AND_JOBS.sql) can be
-- imported straight into this vault once they're hired -- see
-- import_application_document below. This is a metadata copy of an
-- already-uploaded R2 object's reference, never a re-upload.
--
-- WHO CAN DO WHAT (deliberately reuses the existing Payroll tool's actions
-- instead of inventing a new admin-configurable checkbox — see
-- frontend/src/components/CMMSRoleConfiguration.jsx's
-- { id: 'payroll', actions: ['view','create','edit','approve'] }):
--   * Any active staff member can ALWAYS add, list, and remove their OWN
--     documents from "My Salary" -- never permission-gated, same principle
--     as leave/welfare requests in CMMS_EMPLOYEE_WELFARE_SYSTEM.sql.
--   * Adding/removing a document on ANOTHER employee's behalf, or marking
--     one verified, requires the Payroll "edit" action
--     (cmms_can_manage_employee_documents() below) — the same permission
--     that already lets someone manage salary profiles in
--     CMMSPayrollPanel.jsx (its `canEdit` prop). A full company admin
--     always has it.
--   * Read-only visibility of every employee's documents (without edit
--     rights) additionally works for the Payroll "view" action
--     (cmms_can_view_employee_documents() below), mirroring how
--     attendance's 'view' flag works for records that aren't your own.
--
-- Run after: CMMS_ADD_USER_SCHEMA.sql (cmms_users),
-- CMMS_STAFF_ATTENDANCE_VISITOR_MANAGEMENT.sql (cmms_active_staff),
-- CMMS_ANNOUNCEMENTS_AND_JOBS.sql (cmms_has_tool_action, cmms_touch_updated_at,
-- cmms_job_applications). The auto-pick RPC additionally expects
-- CMMS_JOB_APPLICATION_ICAN_LINK.sql (cmms_job_applications.ican_user_id)
-- and CMMS_HIRE_APPLICANT_INTO_CMMS.sql (cmms_job_applications.hired_cmms_user_id)
-- -- both already part of the same hiring-pipeline suite.
-- Safe to run more than once.
-- ============================================================================

-- ============================================================
-- 1. Table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_employee_credential_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  employee_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cmms_user_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,

  category TEXT NOT NULL CHECK (category IN (
    'national_id', 'academic_certificate', 'professional_certificate', 'cv_resume',
    'bank_details', 'tax_pin_certificate', 'nssf_certificate', 'next_of_kin_form',
    'police_clearance', 'medical_certificate', 'work_permit', 'signed_contract', 'other'
  )),
  label TEXT NOT NULL,

  -- Real file, via R2 (r2://<key> marker) -- see r2StorageService.js. Either
  -- a fresh upload, or (source = 'job_application') a copied reference to a
  -- résumé/CV already uploaded during the hiring pipeline.
  -- file_url is the resolvable r2:// value; file_path is the raw key.
  file_url TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT,
  file_size_bytes BIGINT,

  source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'job_application')),
  source_job_application_id UUID REFERENCES public.cmms_job_applications(id) ON DELETE SET NULL,

  uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),

  -- HR/payroll can mark a submitted document as checked against the
  -- original -- e.g. confirming a National ID copy matches the person on
  -- file. Never required to upload or use a document elsewhere.
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent for a re-run against a table created by an earlier version of
-- this same file (before the "auto-pick" columns existed).
ALTER TABLE public.cmms_employee_credential_documents
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS source_job_application_id UUID REFERENCES public.cmms_job_applications(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cmms_employee_credential_documents_source_check'
  ) THEN
    ALTER TABLE public.cmms_employee_credential_documents
      ADD CONSTRAINT cmms_employee_credential_documents_source_check CHECK (source IN ('upload', 'job_application'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_employee_credential_documents_company ON public.cmms_employee_credential_documents(cmms_company_id, status);
CREATE INDEX IF NOT EXISTS idx_employee_credential_documents_employee ON public.cmms_employee_credential_documents(employee_user_id, status);

DROP TRIGGER IF EXISTS trg_employee_credential_documents_touch_updated_at ON public.cmms_employee_credential_documents;
CREATE TRIGGER trg_employee_credential_documents_touch_updated_at
  BEFORE UPDATE ON public.cmms_employee_credential_documents
  FOR EACH ROW EXECUTE FUNCTION public.cmms_touch_updated_at();

-- ============================================================
-- 2. Shared permission helpers -- both reuse the existing Payroll tool's
--    "edit"/"view" actions (see the header note above).
-- ============================================================

CREATE OR REPLACE FUNCTION public.cmms_can_manage_employee_documents(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.cmms_has_tool_action(p_company_id, 'payroll', 'edit');
$$;

REVOKE ALL ON FUNCTION public.cmms_can_manage_employee_documents(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_can_manage_employee_documents(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.cmms_can_view_employee_documents(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.cmms_can_manage_employee_documents(p_company_id)
      OR public.cmms_has_tool_action(p_company_id, 'payroll', 'view');
$$;

REVOKE ALL ON FUNCTION public.cmms_can_view_employee_documents(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_can_view_employee_documents(UUID) TO authenticated;

-- ============================================================
-- 3. RLS -- direct reads only; every write goes through a SECURITY DEFINER
--    RPC below (same convention as CMMS_EMPLOYEE_WELFARE_SYSTEM.sql), since
--    "self vs. on-behalf-of" and verification both need real validation.
-- ============================================================

ALTER TABLE public.cmms_employee_credential_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cmms_employee_credential_documents_read ON public.cmms_employee_credential_documents;
CREATE POLICY cmms_employee_credential_documents_read ON public.cmms_employee_credential_documents
  FOR SELECT TO authenticated
  USING (
    employee_user_id = auth.uid()
    OR public.cmms_can_view_employee_documents(cmms_company_id)
  );

-- ============================================================
-- 4. Upload -- self-service always allowed; on someone else's behalf
--    requires the Payroll "edit" action.
-- ============================================================

CREATE OR REPLACE FUNCTION public.upload_employee_document(
  p_cmms_company_id UUID,
  p_employee_user_id UUID,
  p_category TEXT,
  p_label TEXT,
  p_file_url TEXT,
  p_file_path TEXT,
  p_file_name TEXT DEFAULT NULL,
  p_mime_type TEXT DEFAULT NULL,
  p_file_size_bytes BIGINT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_is_self BOOLEAN;
  v_cmms_user_id UUID;
  v_document_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required to add a document';
  END IF;
  IF NULLIF(TRIM(p_label), '') IS NULL THEN
    RAISE EXCEPTION 'A label describing the document is required';
  END IF;
  IF NULLIF(TRIM(p_file_url), '') IS NULL OR NULLIF(TRIM(p_file_path), '') IS NULL THEN
    RAISE EXCEPTION 'The file did not upload correctly -- please try again';
  END IF;
  IF p_employee_user_id IS NULL THEN
    RAISE EXCEPTION 'An employee must be selected';
  END IF;

  v_is_self := (p_employee_user_id = auth.uid());

  IF v_is_self THEN
    IF NOT public.cmms_active_staff(p_cmms_company_id) THEN
      RAISE EXCEPTION 'You are not an active member of this company';
    END IF;
  ELSE
    IF NOT public.cmms_can_manage_employee_documents(p_cmms_company_id) THEN
      RAISE EXCEPTION 'You do not have permission to add documents on behalf of another employee';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.cmms_users
       WHERE cmms_company_id = p_cmms_company_id AND ican_user_id = p_employee_user_id AND is_active
    ) THEN
      RAISE EXCEPTION 'That employee is not an active member of this company';
    END IF;
  END IF;

  SELECT id INTO v_cmms_user_id FROM public.cmms_users
   WHERE cmms_company_id = p_cmms_company_id AND ican_user_id = p_employee_user_id
   LIMIT 1;

  INSERT INTO public.cmms_employee_credential_documents (
    cmms_company_id, employee_user_id, cmms_user_id, category, label,
    file_url, file_path, file_name, mime_type, file_size_bytes, uploaded_by, source
  ) VALUES (
    p_cmms_company_id, p_employee_user_id, v_cmms_user_id, p_category, TRIM(p_label),
    TRIM(p_file_url), TRIM(p_file_path), NULLIF(TRIM(p_file_name), ''), NULLIF(TRIM(p_mime_type), ''),
    p_file_size_bytes, auth.uid(), 'upload'
  ) RETURNING id INTO v_document_id;

  RETURN v_document_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upload_employee_document(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upload_employee_document(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) TO authenticated;

-- ============================================================
-- 5. Remove (soft-delete) -- the employee themself, or Payroll "edit"
-- ============================================================

CREATE OR REPLACE FUNCTION public.revoke_employee_document(p_document_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_doc public.cmms_employee_credential_documents;
BEGIN
  SELECT * INTO v_doc FROM public.cmms_employee_credential_documents WHERE id = p_document_id FOR UPDATE;
  IF v_doc.id IS NULL THEN RAISE EXCEPTION 'Document not found'; END IF;
  IF v_doc.employee_user_id <> auth.uid() AND NOT public.cmms_can_manage_employee_documents(v_doc.cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to remove this document';
  END IF;
  IF v_doc.status = 'revoked' THEN
    RAISE EXCEPTION 'This document has already been removed';
  END IF;

  UPDATE public.cmms_employee_credential_documents
     SET status = 'revoked', updated_at = now()
   WHERE id = p_document_id;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_employee_document(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_employee_document(UUID) TO authenticated;

-- ============================================================
-- 6. Verify -- Payroll "edit" only; an employee can never self-verify
-- ============================================================

CREATE OR REPLACE FUNCTION public.verify_employee_document(
  p_document_id UUID,
  p_verified BOOLEAN,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_doc public.cmms_employee_credential_documents;
BEGIN
  SELECT * INTO v_doc FROM public.cmms_employee_credential_documents WHERE id = p_document_id FOR UPDATE;
  IF v_doc.id IS NULL THEN RAISE EXCEPTION 'Document not found'; END IF;
  IF NOT public.cmms_can_manage_employee_documents(v_doc.cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to verify employee documents';
  END IF;
  IF v_doc.status = 'revoked' THEN
    RAISE EXCEPTION 'This document has been removed and cannot be verified';
  END IF;

  UPDATE public.cmms_employee_credential_documents
     SET verified = COALESCE(p_verified, FALSE),
         verified_by = CASE WHEN COALESCE(p_verified, FALSE) THEN auth.uid() ELSE NULL END,
         verified_at = CASE WHEN COALESCE(p_verified, FALSE) THEN now() ELSE NULL END,
         notes = NULLIF(TRIM(p_notes), ''),
         updated_at = now()
   WHERE id = p_document_id;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_employee_document(UUID, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_employee_document(UUID, BOOLEAN, TEXT) TO authenticated;

-- ============================================================
-- 7. Reads
-- ============================================================

-- Self-scoped (see the module header note on why this is a dedicated RPC
-- rather than a plain table select from the frontend -- same reasoning as
-- get_my_leave_requests/get_my_welfare_requests).
CREATE OR REPLACE FUNCTION public.get_my_employee_documents(p_cmms_company_id UUID)
RETURNS SETOF public.cmms_employee_credential_documents
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.cmms_employee_credential_documents
   WHERE cmms_company_id = p_cmms_company_id AND employee_user_id = auth.uid() AND status = 'active'
   ORDER BY created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_employee_documents(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_employee_documents(UUID) TO authenticated;

-- Company-wide list for the Payroll admin screen -- Payroll "edit" or
-- "view" required. Optionally scoped to one employee (the "Staff on
-- payroll" row's "Files" button).
-- CREATE OR REPLACE cannot change a function's OUT-parameter row type (this
-- one gained `source`/`source_job_application_id` after an earlier version
-- of this file was already run), so the old signature must be dropped
-- first -- same reason CMMS_ATTENDANCE_MANUAL_DAYS_ADJUSTMENT.sql dropped
-- get_attendance_summary before adding a column.
DROP FUNCTION IF EXISTS public.get_company_employee_documents(UUID, UUID);
CREATE OR REPLACE FUNCTION public.get_company_employee_documents(
  p_cmms_company_id UUID,
  p_employee_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  employee_user_id UUID,
  cmms_user_id UUID,
  employee_name TEXT,
  category TEXT,
  label TEXT,
  file_url TEXT,
  file_path TEXT,
  file_name TEXT,
  mime_type TEXT,
  file_size_bytes BIGINT,
  source TEXT,
  source_job_application_id UUID,
  uploaded_by UUID,
  uploaded_by_name TEXT,
  status TEXT,
  verified BOOLEAN,
  verified_by UUID,
  verified_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.cmms_can_view_employee_documents(p_cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to view company employee documents';
  END IF;

  RETURN QUERY
  SELECT
    d.id, d.employee_user_id, d.cmms_user_id,
    COALESCE(u.full_name, u.user_name, u.email)::TEXT,
    d.category, d.label, d.file_url, d.file_path, d.file_name,
    d.mime_type, d.file_size_bytes, d.source, d.source_job_application_id, d.uploaded_by,
    COALESCE(up.full_name, up.user_name, up.email)::TEXT,
    d.status, d.verified, d.verified_by, d.verified_at, d.notes, d.created_at
  FROM public.cmms_employee_credential_documents d
  LEFT JOIN public.cmms_users u ON u.id = d.cmms_user_id
  LEFT JOIN public.cmms_users up
    ON up.cmms_company_id = d.cmms_company_id AND up.ican_user_id = d.uploaded_by
  WHERE d.cmms_company_id = p_cmms_company_id
    AND d.status = 'active'
    AND (p_employee_user_id IS NULL OR d.employee_user_id = p_employee_user_id)
  ORDER BY d.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_employee_documents(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_employee_documents(UUID, UUID) TO authenticated;

-- ============================================================
-- 8. Auto-pick from the hiring pipeline (Announcements & Jobs) -- a
--    résumé/CV already on file from a job application can be imported
--    straight into this vault, with zero re-upload.
-- ============================================================

-- Candidate documents available to import for one employee: every job
-- application with a résumé on file that is linked to them, either
-- directly (ja.ican_user_id -- set the moment they signed in to apply,
-- CMMS_JOB_APPLICATION_ICAN_LINK.sql) or via the cmms_users row they were
-- hired into (ja.hired_cmms_user_id -- CMMS_HIRE_APPLICANT_INTO_CMMS.sql).
CREATE OR REPLACE FUNCTION public.get_application_documents_for_employee(
  p_cmms_company_id UUID,
  p_employee_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  job_application_id UUID,
  reference_code TEXT,
  applicant_name TEXT,
  resume_url TEXT,
  resume_path TEXT,
  submitted_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_target UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required';
  END IF;

  v_target := COALESCE(p_employee_user_id, auth.uid());

  IF v_target <> auth.uid() AND NOT public.cmms_can_manage_employee_documents(p_cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to view another employee''s application documents';
  END IF;

  RETURN QUERY
  SELECT ja.id, ja.reference_code::TEXT, ja.applicant_name::TEXT, ja.resume_url, ja.resume_path, ja.created_at
    FROM public.cmms_job_applications ja
    LEFT JOIN public.cmms_users hired ON hired.id = ja.hired_cmms_user_id
   WHERE ja.cmms_company_id = p_cmms_company_id
     AND ja.resume_url IS NOT NULL
     AND (ja.ican_user_id = v_target OR hired.ican_user_id = v_target)
   ORDER BY ja.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_application_documents_for_employee(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_application_documents_for_employee(UUID, UUID) TO authenticated;

-- Copies a job application's résumé reference into the vault -- the same
-- R2 object, never a new upload. Permission model mirrors
-- upload_employee_document exactly (self-service always allowed; on
-- someone else's behalf needs Payroll "edit"), plus an ownership check
-- that the chosen application actually belongs to that employee.
CREATE OR REPLACE FUNCTION public.import_application_document(
  p_cmms_company_id UUID,
  p_employee_user_id UUID,
  p_job_application_id UUID,
  p_category TEXT DEFAULT 'cv_resume',
  p_label TEXT DEFAULT 'CV / Resume (from job application)'
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_application public.cmms_job_applications;
  v_hired_ican_user_id UUID;
  v_cmms_user_id UUID;
  v_document_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required to add a document';
  END IF;
  IF p_employee_user_id IS NULL THEN
    RAISE EXCEPTION 'An employee must be selected';
  END IF;

  IF p_employee_user_id <> auth.uid() AND NOT public.cmms_can_manage_employee_documents(p_cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to add documents on behalf of another employee';
  END IF;

  SELECT * INTO v_application FROM public.cmms_job_applications
   WHERE id = p_job_application_id AND cmms_company_id = p_cmms_company_id;
  IF v_application.id IS NULL THEN
    RAISE EXCEPTION 'Application not found';
  END IF;
  IF v_application.resume_url IS NULL THEN
    RAISE EXCEPTION 'This application has no resume/CV on file to import';
  END IF;

  IF v_application.hired_cmms_user_id IS NOT NULL THEN
    SELECT ican_user_id INTO v_hired_ican_user_id FROM public.cmms_users WHERE id = v_application.hired_cmms_user_id;
  END IF;

  IF v_application.ican_user_id IS DISTINCT FROM p_employee_user_id
     AND v_hired_ican_user_id IS DISTINCT FROM p_employee_user_id THEN
    RAISE EXCEPTION 'This application does not belong to that employee';
  END IF;

  IF p_employee_user_id = auth.uid() THEN
    IF NOT public.cmms_active_staff(p_cmms_company_id) THEN
      RAISE EXCEPTION 'You are not an active member of this company';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.cmms_users
       WHERE cmms_company_id = p_cmms_company_id AND ican_user_id = p_employee_user_id AND is_active
    ) THEN
      RAISE EXCEPTION 'That employee is not an active member of this company';
    END IF;
  END IF;

  SELECT id INTO v_cmms_user_id FROM public.cmms_users
   WHERE cmms_company_id = p_cmms_company_id AND ican_user_id = p_employee_user_id
   LIMIT 1;

  INSERT INTO public.cmms_employee_credential_documents (
    cmms_company_id, employee_user_id, cmms_user_id, category, label,
    file_url, file_path, uploaded_by, source, source_job_application_id
  ) VALUES (
    p_cmms_company_id, p_employee_user_id, v_cmms_user_id,
    COALESCE(NULLIF(TRIM(p_category), ''), 'cv_resume'),
    COALESCE(NULLIF(TRIM(p_label), ''), 'CV / Resume (from job application)'),
    v_application.resume_url, v_application.resume_path, auth.uid(), 'job_application', v_application.id
  ) RETURNING id INTO v_document_id;

  RETURN v_document_id;
END;
$$;

REVOKE ALL ON FUNCTION public.import_application_document(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_application_document(UUID, UUID, UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS payroll employee credential documents installed' AS status;
