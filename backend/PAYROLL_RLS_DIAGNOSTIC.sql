-- Read-only diagnostic for the "new row violates row-level-security policy
-- for table business_payroll_periods" error. Paste into the Supabase SQL
-- Editor and run. Nothing here modifies data.

-- 1) Which policies are actually live on the payroll tables right now?
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('business_payroll_periods', 'business_payroll_entries', 'business_compensation_profiles')
ORDER BY tablename, policyname;

-- 2) Fill in the staff member's login email below, then run this block to see
--    their CMMS role, whether that role can manage payroll, and how they're
--    linked to the business.
DO $$
DECLARE
  v_email TEXT := 'PUT_STAFF_EMAIL_HERE';
BEGIN
  RAISE NOTICE '--- CMMS user / role ---';
END $$;

SELECT
  cu.email,
  cu.cmms_company_id,
  cu.role AS cmms_user_role_text,
  cu.is_creator,
  r.role_name,
  r.can_manage_payroll,
  cp.pichin_business_profile_id
FROM public.cmms_users cu
LEFT JOIN public.cmms_user_roles ur ON ur.cmms_user_id = cu.id AND ur.is_active = TRUE
LEFT JOIN public.cmms_roles r ON r.id = ur.cmms_role_id
LEFT JOIN public.cmms_company_profiles cp ON cp.id = cu.cmms_company_id
WHERE lower(cu.email) = lower('PUT_STAFF_EMAIL_HERE');
