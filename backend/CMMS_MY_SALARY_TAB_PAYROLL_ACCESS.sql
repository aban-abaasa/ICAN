-- ============================================================================
-- CMMS "MY SALARY" TAB — let a Payroll role scoped to "own" records use its
-- Create / Approve actions, not just view its own salary.
-- Run after CMMS_ATTENDANCE_PAYROLL_INTEGRATION.sql,
-- CMMS_ATTENDANCE_ROLE_BASED_PERMISSIONS.sql, and
-- SHARED_BUSINESS_AUTHORITY_AND_PAYROLL.sql / CMMS_DEPARTMENT_PAYROLL_RLS_FIX.sql.
--
-- CONTEXT: "Role and tool configuration" already lets an admin grant a role
-- the Payroll tool with Data scope = "Own records only". Until now that
-- always produced a read-only self-service screen — Create/Approve on
-- Payroll were never read for an "own"-scoped role. The frontend "My Salary"
-- tab (CMMSMySalaryPanel.jsx) now shows, in addition to the employee's own
-- salary:
--   Create ticked  -> a form to add another employee to salary
--   Approve ticked -> the attendance work schedule + manual day credit
-- Those UI sections call the same write paths the full company Payroll tab
-- already uses (saveBusinessCompensation, cmms_attendance_payroll_settings,
-- admin_add_attendance_days). This migration is what makes the underlying
-- RLS/RPCs actually accept those writes from a Payroll create/approve role
-- instead of only from a full company admin or "business admin".
-- ============================================================================

-- ============================================================
-- 1. business_compensation_profiles — Payroll create/edit unlocks writes
-- ============================================================
-- ican_business_admin() only recognizes the coarse "owns/co-owns/manages
-- the business" concept. A role granted Payroll -> Create (or Edit) via
-- cmms_roles.tool_access should also be able to save a salary profile,
-- without being promoted to a full business admin.
CREATE OR REPLACE FUNCTION public.cmms_can_manage_payroll_compensation(p_business_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.ican_business_admin(p_business_profile_id)
      OR EXISTS (
        SELECT 1
          FROM public.cmms_company_profiles cp
          JOIN public.cmms_users cu ON cu.cmms_company_id = cp.id
          JOIN public.cmms_user_roles ur ON ur.cmms_user_id = cu.id AND ur.is_active
          JOIN public.cmms_roles r ON r.id = ur.cmms_role_id AND r.is_active
         WHERE cp.pichin_business_profile_id = p_business_profile_id
           AND cu.is_active
           AND lower(cu.email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
           AND (
             COALESCE((r.tool_access -> 'payroll' ->> 'create')::BOOLEAN, FALSE)
             OR COALESCE((r.tool_access -> 'payroll' ->> 'edit')::BOOLEAN, FALSE)
           )
      );
$$;

REVOKE ALL ON FUNCTION public.cmms_can_manage_payroll_compensation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_can_manage_payroll_compensation(UUID) TO authenticated;

DROP POLICY IF EXISTS compensation_business_access ON public.business_compensation_profiles;
CREATE POLICY compensation_business_access ON public.business_compensation_profiles
  FOR ALL TO authenticated
  USING (public.cmms_can_manage_payroll_compensation(business_profile_id))
  WITH CHECK (public.cmms_can_manage_payroll_compensation(business_profile_id));

-- ============================================================
-- 2. cmms_attendance_payroll_settings — Payroll approve unlocks the
--    work-schedule write, same as any attendance tool grant already does.
-- ============================================================
CREATE OR REPLACE FUNCTION public.cmms_can_manage_attendance_payroll(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.cmms_has_permission(p_company_id, 'manage_payroll')
      OR EXISTS (
        SELECT 1
          FROM public.cmms_user_roles ur
          JOIN public.cmms_roles r ON r.id = ur.cmms_role_id
         WHERE ur.cmms_company_id = p_company_id
           AND ur.cmms_user_id = public.cmms_current_user_id_for_company(p_company_id)
           AND ur.is_active
           AND r.is_active
           AND (
             r.tool_access ->> 'attendance' = 'true'
             OR COALESCE((r.tool_access -> 'attendance' ->> 'view')::BOOLEAN, FALSE)
             OR COALESCE((r.tool_access -> 'attendance' ->> 'create')::BOOLEAN, FALSE)
             OR COALESCE((r.tool_access -> 'attendance' ->> 'edit')::BOOLEAN, FALSE)
             OR COALESCE((r.tool_access -> 'attendance' ->> 'approve')::BOOLEAN, FALSE)
             OR COALESCE((r.tool_access -> 'payroll' ->> 'approve')::BOOLEAN, FALSE)
           )
      );
$$;

-- ============================================================
-- 3. cmms_attendance_has_action — Payroll approve is treated as the 'days'
--    action so a My Salary role can credit attendance days without also
--    needing a separate Attendance tool grant.
-- ============================================================
CREATE OR REPLACE FUNCTION public.cmms_attendance_has_action(
  p_company_id UUID,
  p_action TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_tool_access JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Full company admins always retain every attendance power.
  IF public.cmms_attendance_qr_admin(p_company_id) THEN
    RETURN TRUE;
  END IF;

  SELECT r.tool_access INTO v_tool_access
    FROM public.cmms_users cu
    JOIN public.cmms_user_roles ur ON ur.cmms_user_id = cu.id AND ur.is_active
    JOIN public.cmms_roles r ON r.id = ur.cmms_role_id AND r.is_active
   WHERE cu.cmms_company_id = p_company_id
     AND cu.is_active
     AND lower(cu.email) = lower(auth.jwt() ->> 'email')
   LIMIT 1;

  IF p_action = 'days' AND COALESCE((v_tool_access #> ARRAY['payroll', 'approve'])::TEXT::BOOLEAN, FALSE) THEN
    RETURN TRUE;
  END IF;

  RETURN COALESCE((v_tool_access #> ARRAY['attendance', p_action])::TEXT::BOOLEAN, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_attendance_has_action(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_attendance_has_action(UUID, TEXT) TO authenticated;
