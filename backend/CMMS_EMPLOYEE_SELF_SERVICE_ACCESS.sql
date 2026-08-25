-- Employee self-service access for CMMS.
-- Apply after CMMS_ROLE_PERMISSIONS_AND_PAYROLL_ACCESS.sql.
-- Employees can read only records whose employee/requester identity is auth.uid().

ALTER TABLE IF EXISTS public.business_compensation_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.business_payroll_entries ENABLE ROW LEVEL SECURITY;

-- A legacy attendance repair accidentally allowed every employee in a company
-- to read every other employee's attendance. Restore self-only reads while
-- preserving the company-administrator view.
DROP POLICY IF EXISTS "Staff can read company attendance" ON public.cmms_staff_attendance;
DROP POLICY IF EXISTS cmms_attendance_employee_self_read ON public.cmms_staff_attendance;
CREATE POLICY cmms_attendance_employee_self_read ON public.cmms_staff_attendance
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cmms_users u
      WHERE u.id = cmms_staff_attendance.cmms_user_id
        AND u.is_active = TRUE
        AND lower(u.email) = lower(auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS cmms_attendance_company_admin_read ON public.cmms_staff_attendance;
CREATE POLICY cmms_attendance_company_admin_read ON public.cmms_staff_attendance
  FOR SELECT TO authenticated
  USING (public.cmms_is_company_admin(cmms_company_id));

DROP POLICY IF EXISTS compensation_employee_self_read ON public.business_compensation_profiles;
CREATE POLICY compensation_employee_self_read ON public.business_compensation_profiles
  FOR SELECT TO authenticated
  USING (employee_user_id = auth.uid());

DROP POLICY IF EXISTS payroll_entries_employee_self_read ON public.business_payroll_entries;
CREATE POLICY payroll_entries_employee_self_read ON public.business_payroll_entries
  FOR SELECT TO authenticated
  USING (employee_user_id = auth.uid());

-- Corporate ride requests may be viewed only by the employee who created the
-- request. Keep the existing company administrator policies in place.
DO $$
BEGIN
  IF to_regclass('public.mbg_corporate_ride_requests') IS NOT NULL THEN
    ALTER TABLE public.mbg_corporate_ride_requests ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS transport_requests_employee_self_read ON public.mbg_corporate_ride_requests;
    CREATE POLICY transport_requests_employee_self_read ON public.mbg_corporate_ride_requests
      FOR SELECT TO authenticated
      USING (requested_by = auth.uid());
  END IF;
END;
$$;

GRANT SELECT ON public.business_compensation_profiles, public.business_payroll_entries TO authenticated;
