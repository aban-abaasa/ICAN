-- ============================================================================
-- Fix: an employee who ALSO holds Payroll -> Approve for some company (or
-- full CMMS admin) saw every other employee's salary advance requests on
-- their own "My salary" self-service screen, not just their own.
-- Run after CMMS_SALARY_ADVANCE_REQUESTS.sql.
--
-- BUG: getMySalaryAdvances() (businessManagementService.js) reads straight
-- off business_salary_advances with no filter, relying entirely on RLS to
-- scope it. business_salary_advances_read is:
--
--   USING (employee_user_id = auth.uid() OR public.cmms_can_manage_salary_advances(cmms_company_id))
--
-- That OR is correct for an admin/approver screen (getCompanySalaryAdvances,
-- filtered by cmms_company_id, used on the manager's approvals panel) — a
-- Payroll-approve holder is supposed to see the whole company's requests
-- there. But CMMSEmployeeSelfService.jsx calls the SAME unfiltered query for
-- its own "my requests" list, so anyone who both requests advances AND has
-- manage permission somewhere (a common combination — HR/finance staff are
-- salaried too) sees every co-worker's advance, across every company they
-- manage, mixed into their personal history.
--
-- FIX: a dedicated, always-self-scoped read path that ignores the manage
-- clause entirely, the same pattern already used for
-- get_my_cmms_salary_wallet_transactions (CMMS_MY_SALARY_ATTENDANCE_WALLET_LEDGER.sql).
-- The RLS policy itself is untouched — getCompanySalaryAdvances still needs
-- the manage-permission OR for the admin panel to work.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_my_salary_advances()
RETURNS SETOF public.business_salary_advances
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.business_salary_advances
   WHERE employee_user_id = auth.uid()
   ORDER BY requested_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_salary_advances() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_salary_advances() TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'get_my_salary_advances now always scopes to the caller''s own requests' AS status;
