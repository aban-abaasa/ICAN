-- ============================================================
-- FIX: attendance QR duplicate-key error + real employee removal
-- ============================================================
-- Run this once against the database that already has
-- CMMS_STAFF_ATTENDANCE_VISITOR_MANAGEMENT.sql and
-- CMMS_CREATOR_ADMIN_ENFORCEMENT.sql deployed.
--
-- PART 1 fixes:
--   duplicate key value violates unique constraint
--   "cmms_staff_attendance_qr_code_token_key"
--
-- Root cause: staff_check_in_with_qr() stores the *location's* QR token
-- (public.cmms_attendance_qr_locations.token) into
-- cmms_staff_attendance.qr_code_token on every check-in. That location QR
-- is meant to be scanned by many different employees (and the same
-- employee on many different days), but the column had a UNIQUE
-- constraint, so the second person (or the same person on day two) to use
-- that location QR failed with a duplicate-key error. Dropping the
-- constraint lets one QR code legitimately serve many employees.
--
-- PART 2 fixes:
--   the "Remove" button in the CMMS Users panel only removed the row from
--   local React state (frontend-only) - the employee was never actually
--   removed from the database, so admins could not actually remove staff.
--   This adds a real, admin-only RPC that deletes (or optionally
--   deactivates) the employee, and the frontend now calls it.
-- ============================================================

-- ------------------------------------------------------------
-- PART 1: allow one QR token to be shared by many attendance rows
-- ------------------------------------------------------------
ALTER TABLE public.cmms_staff_attendance
  DROP CONSTRAINT IF EXISTS cmms_staff_attendance_qr_code_token_key;

COMMENT ON COLUMN public.cmms_staff_attendance.qr_code_token IS
  'Which location QR was scanned for this check-in. Not unique: the same '
  'location QR is reused by every employee at that location.';

-- ------------------------------------------------------------
-- PART 2: real, admin-only employee removal
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_cmms_employee(
  p_company_id UUID,
  p_user_id UUID,
  p_hard_delete BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target public.cmms_users;
  v_current_cmms_user_id UUID;
BEGIN
  IF NOT public.cmms_is_company_admin(p_company_id) THEN
    RAISE EXCEPTION 'Only Admin users can remove employees from this company';
  END IF;

  SELECT * INTO v_target
    FROM public.cmms_users
   WHERE id = p_user_id
     AND cmms_company_id = p_company_id;

  IF v_target.id IS NULL THEN
    RAISE EXCEPTION 'Target CMMS user does not belong to this company';
  END IF;

  IF v_target.is_creator THEN
    RAISE EXCEPTION 'The company creator cannot be removed';
  END IF;

  v_current_cmms_user_id := public.cmms_current_user_id_for_company(p_company_id);
  IF v_current_cmms_user_id = v_target.id THEN
    RAISE EXCEPTION 'You cannot remove your own account';
  END IF;

  IF p_hard_delete THEN
    DELETE FROM public.cmms_users WHERE id = p_user_id;
    RETURN jsonb_build_object(
      'success', true,
      'hard_deleted', true,
      'message', v_target.user_name || ' was permanently removed from this company'
    );
  ELSE
    UPDATE public.cmms_users SET is_active = FALSE, updated_at = now() WHERE id = p_user_id;
    UPDATE public.cmms_user_roles SET is_active = FALSE WHERE cmms_user_id = p_user_id AND cmms_company_id = p_company_id;
    RETURN jsonb_build_object(
      'success', true,
      'hard_deleted', false,
      'message', v_target.user_name || ' was deactivated'
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_cmms_employee(UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_cmms_employee(UUID, UUID, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';
