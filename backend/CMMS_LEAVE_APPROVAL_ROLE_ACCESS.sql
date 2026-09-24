-- ============================================================================
-- CMMS LEAVE & WELFARE APPROVAL — DEDICATED ROLE ACCESS (ADD-ONLY)
-- ============================================================================
-- Every employee can already request leave / probation review / welfare help
-- (request_leave, submit_welfare_request in CMMS_EMPLOYEE_WELFARE_SYSTEM.sql).
-- DECIDING those requests was only grantable as the "welfare" tick inside the
-- "Staff attendance & QR check-in" tool, which forces attendance "view" on at
-- the same time -- so an admin could not let someone approve leave without
-- also letting them see every staff member's attendance records.
--
-- This adds a dedicated permission the admin picks per role in Role and tool
-- configuration -> "Leave & welfare approvals" (cmms_roles.tool_access
-- ->'leave-welfare'):
--   approve : decide leave, probation and welfare requests
--   see_all : read-only view of the company-wide leave/welfare dashboard
-- The old attendance "welfare"/"view" grants keep working exactly as before.
--
-- Every welfare decision already funnels through cmms_can_manage_welfare()
-- and cmms_can_view_welfare(), so widening just those two covers leave,
-- probation and welfare decisions, their RLS policies, and the dashboard.
--
-- Safe to run multiple times. Run after CMMS_EMPLOYEE_WELFARE_SYSTEM.sql.
-- ============================================================================

-- Does the signed-in person hold this tool action through ANY active role
-- assigned to them in this company? (Checks all their roles, not just one.)
CREATE OR REPLACE FUNCTION public.cmms_role_tool_action(
  p_company_id UUID,
  p_tool TEXT,
  p_action TEXT
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.cmms_users cu
      JOIN public.cmms_user_roles ur ON ur.cmms_user_id = cu.id AND ur.is_active
      JOIN public.cmms_roles r ON r.id = ur.cmms_role_id AND r.is_active
     WHERE cu.cmms_company_id = p_company_id
       AND cu.is_active
       AND lower(cu.email) = lower(auth.jwt() ->> 'email')
       AND (r.tool_access #>> ARRAY[p_tool, p_action]) = 'true'
  );
$$;

REVOKE ALL ON FUNCTION public.cmms_role_tool_action(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_role_tool_action(UUID, TEXT, TEXT) TO authenticated;

-- Deciding requests: full admin, the attendance "welfare" grant (unchanged),
-- or the dedicated Leave & welfare "approve" grant.
CREATE OR REPLACE FUNCTION public.cmms_can_manage_welfare(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT public.cmms_attendance_qr_admin(p_company_id)
      OR public.cmms_attendance_has_action(p_company_id, 'welfare')
      OR public.cmms_role_tool_action(p_company_id, 'leave-welfare', 'approve');
$$;

-- Read-only dashboard: anyone who can manage it, a plain attendance "view"
-- role (unchanged), or the dedicated Leave & welfare "see_all" grant.
CREATE OR REPLACE FUNCTION public.cmms_can_view_welfare(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT public.cmms_can_manage_welfare(p_company_id)
      OR public.cmms_attendance_has_action(p_company_id, 'view')
      OR public.cmms_role_tool_action(p_company_id, 'leave-welfare', 'see_all');
$$;

REVOKE ALL ON FUNCTION public.cmms_can_manage_welfare(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_can_manage_welfare(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.cmms_can_view_welfare(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_can_view_welfare(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'Leave & welfare approval role access installed!' AS status;
