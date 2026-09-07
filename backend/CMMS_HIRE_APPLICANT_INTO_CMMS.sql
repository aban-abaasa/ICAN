-- ============================================================
-- CMMS Hiring Pipeline -- auto-add a hired applicant as a CMMS employee
-- ============================================================
-- Closes a gap in the hiring pipeline (CMMS_ANNOUNCEMENTS_AND_JOBS.sql,
-- CMMS_WRITTEN_TESTS.sql, CMMS_INTERVIEW_SCHEDULES.sql,
-- CMMS_EMPLOYMENT_DOCUMENTS.sql): a hired applicant only ever exists as a
-- cmms_job_applications row. With no cmms_users record, they are not
-- actually staff of the company and have no way to reach the CMMS company
-- workspace -- meaning CMMSEmployeeSelfService.jsx's "My employment
-- documents" section (where they review and sign their contract) is
-- unreachable to them.
--
-- fn_hire_applicant_into_cmms is called by CMMSEmploymentDocumentsPanel.jsx
-- the moment an admin issues (approves) an appointment letter or contract
-- for that applicant -- issuing the actual paperwork is the real "you're
-- hired" moment, not just flipping a status dropdown. It mirrors the
-- existing add_cmms_user() field mapping (CMMS_ADD_USER_SCHEMA.sql) but:
--   - runs as SECURITY DEFINER gated by the same 'announcements'/
--     'manage_applications' permission the rest of the hiring pipeline
--     uses, instead of depending on cmms_users' own (separately evolved,
--     see the several FIX_CMMS_USERS_RLS_POLICIES.sql-style files) insert
--     policy, which governs a different admin action (Users & role
--     assignments) with different permission requirements;
--   - is idempotent by e-mail (case-insensitively), so issuing a follow-up
--     employment contract later reuses the same cmms_users row instead of
--     creating a duplicate;
--   - carries over the ICAN account link already made during the written
--     test / interview stages (CMMS_JOB_APPLICATION_ICAN_LINK.sql), so the
--     same account that took the test / joined the interview can now sign
--     in to the CMMS workspace and see its contract.
--
-- Run after: CMMS_ADD_USER_SCHEMA.sql (cmms_users), CMMS_ANNOUNCEMENTS_AND_JOBS.sql,
-- CMMS_JOB_APPLICATION_ICAN_LINK.sql, CMMS_EMPLOYMENT_DOCUMENTS.sql.
-- Safe to run more than once.
-- ============================================================

ALTER TABLE public.cmms_job_applications
  ADD COLUMN IF NOT EXISTS hired_cmms_user_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL;

DROP FUNCTION IF EXISTS public.fn_hire_applicant_into_cmms(UUID);
CREATE OR REPLACE FUNCTION public.fn_hire_applicant_into_cmms(p_job_application_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_application public.cmms_job_applications;
  v_job public.cmms_announcements;
  v_added_by UUID;
  v_cmms_user_id UUID;
BEGIN
  SELECT * INTO v_application FROM public.cmms_job_applications WHERE id = p_job_application_id;
  IF v_application.id IS NULL THEN
    RAISE EXCEPTION 'Application not found.';
  END IF;

  IF NOT public.cmms_has_tool_action(v_application.cmms_company_id, 'announcements', 'manage_applications') THEN
    RAISE EXCEPTION 'You do not have permission to hire applicants for this company.';
  END IF;

  IF v_application.job_posting_id IS NOT NULL THEN
    SELECT * INTO v_job FROM public.cmms_announcements WHERE id = v_application.job_posting_id;
  END IF;

  v_added_by := public.cmms_current_user_id_for_company(v_application.cmms_company_id);

  -- Case-insensitive match, same convention CMMSAnnouncementsPanel.jsx
  -- already uses when resolving a signed-in admin's own cmms_users row --
  -- cmms_users.email has no case-normalizing constraint, so this (not a
  -- plain ON CONFLICT on the unique (company, email) index) is what
  -- actually prevents a second, differently-cased duplicate row.
  SELECT id INTO v_cmms_user_id
  FROM public.cmms_users
  WHERE cmms_company_id = v_application.cmms_company_id
    AND email ILIKE v_application.applicant_email;

  IF v_cmms_user_id IS NOT NULL THEN
    UPDATE public.cmms_users
    SET ican_user_id = COALESCE(ican_user_id, v_application.ican_user_id),
        ican_verified = ican_verified OR v_application.ican_verified,
        ican_verified_at = COALESCE(ican_verified_at, v_application.ican_verified_at),
        is_active = TRUE,
        status = 'active'
    WHERE id = v_cmms_user_id;
  ELSE
    INSERT INTO public.cmms_users (
      cmms_company_id, email, user_name, full_name, phone,
      department, job_title, ican_user_id, ican_verified, ican_verified_at,
      is_active, status, added_by, added_at
    ) VALUES (
      v_application.cmms_company_id, lower(v_application.applicant_email), v_application.applicant_name, v_application.applicant_name, v_application.applicant_phone,
      v_job.department, v_job.title, v_application.ican_user_id, v_application.ican_verified, v_application.ican_verified_at,
      TRUE, 'active', v_added_by, NOW()
    )
    RETURNING id INTO v_cmms_user_id;
  END IF;

  UPDATE public.cmms_job_applications
  SET status = 'hired',
      hired_cmms_user_id = v_cmms_user_id,
      status_note = COALESCE(NULLIF(TRIM(status_note), ''), 'Hired — added to CMMS'),
      status_updated_at = NOW(),
      status_updated_by = v_added_by,
      updated_at = NOW()
  WHERE id = p_job_application_id;

  RETURN v_cmms_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_hire_applicant_into_cmms(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS hire-applicant-into-CMMS installed' AS status;
