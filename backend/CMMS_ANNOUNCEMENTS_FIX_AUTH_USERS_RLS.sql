-- ============================================================
-- FIX: cmms_announcements SELECT policy -- "permission denied for table users"
-- ============================================================
-- CMMS_ANNOUNCEMENTS_AND_JOBS.sql's original cmms_announcements_company_select
-- policy queried auth.users directly inside the RLS USING clause:
--   lower(u.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
-- An RLS policy body runs under the CALLING role's own grants (unlike a
-- SECURITY DEFINER function), and `authenticated` has no SELECT grant on
-- auth.users in this project -- so any read of cmms_announcements (including
-- the embedded join used by the Applications tab: cmms_job_applications ->
-- cmms_announcements) throws "permission denied for table users" (42501).
-- This is the same bug class already fixed once for shareholder_notifications
-- -- see FIX_AUTH_USERS_PERMISSION_ERROR.sql.
--
-- Fix: replace the inline auth.users lookup with
-- cmms_current_user_id_for_company(), which is already SECURITY DEFINER
-- (runs with the function owner's grants, not the caller's) and does the
-- exact same "is this person an active member of this company" check.
--
-- Run this once. Safe to run more than once.
-- ============================================================

DROP POLICY IF EXISTS cmms_announcements_company_select ON public.cmms_announcements;
CREATE POLICY cmms_announcements_company_select ON public.cmms_announcements
  FOR SELECT USING (
    public.cmms_current_user_id_for_company(cmms_announcements.cmms_company_id) IS NOT NULL
  );

NOTIFY pgrst, 'reload schema';

SELECT 'cmms_announcements_company_select policy fixed (no more auth.users lookup)' AS status;
