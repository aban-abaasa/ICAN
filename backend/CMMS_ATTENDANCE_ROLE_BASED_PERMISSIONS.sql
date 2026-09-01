-- ============================================================================
-- CMMS STAFF ATTENDANCE — GRANULAR, ROLE-CONFIGURABLE PERMISSIONS
-- Run in Supabase SQL Editor any time after
-- CMMS_ATTENDANCE_MANUAL_DAYS_ADJUSTMENT.sql.
--
-- PROBLEM: every attendance-manager action (manual check-in/out, adding
-- attendance days, seeing everyone's records) was gated by ONE hardcoded
-- check — cmms_attendance_qr_admin() — which only recognizes role NAMES
-- 'admin' / 'administrator' / 'cmms_admin' / 'business_admin'. A company's
-- custom role (e.g. "HR Clerk", "Shift Supervisor") could never be granted
-- just ONE of these powers; it was all-or-nothing and admin-only, and the
-- per-tool "Role and tool configuration" screen (cmms_roles.tool_access)
-- already lets an admin grant/withhold tools per action but nothing in
-- attendance ever READ that column.
--
-- WHAT THIS ADDS:
--   cmms_attendance_has_action(company, action) — the single check every
--   attendance RPC below now calls. A full company admin always passes
--   (fast path, unchanged behavior). Anyone else passes only if their
--   assigned role's cmms_roles.tool_access->'attendance'->>action is true,
--   as configured on the Role and tool configuration screen. Action keys:
--     'view'   — see every staff member's records/summary, not just your own
--     'manual' — manually check another staff member in or out
--     'days'   — add (never reduce) a staff member's attendance day count
--   ('print'/export is a frontend-only concern — no backend gate needed.)
-- ============================================================================

-- ============================================================
-- 1. THE GENERIC CHECK — admin fast path, else role's tool_access
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

  RETURN COALESCE((v_tool_access #> ARRAY['attendance', p_action])::TEXT::BOOLEAN, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_attendance_has_action(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_attendance_has_action(UUID, TEXT) TO authenticated;

-- ============================================================
-- 2. STAFF CHECK-IN — 'manual' action instead of full admin
-- ============================================================
CREATE OR REPLACE FUNCTION public.staff_check_in(
  p_cmms_user_id UUID,
  p_cmms_company_id UUID,
  p_location TEXT,
  p_latitude NUMERIC DEFAULT NULL,
  p_longitude NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qr_token TEXT;
  v_attendance_id UUID;
  v_company_location TEXT;
  v_location_match BOOLEAN;
  v_caller_user_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  IF NULLIF(trim(p_location), '') IS NULL THEN
    RAISE EXCEPTION 'Check-in location is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cmms_users
    WHERE id = p_cmms_user_id
      AND cmms_company_id = p_cmms_company_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'User is not an active member of this company';
  END IF;

  -- Self check-in (QR flow) or someone with the 'manual' attendance power
  -- checking in someone else.
  SELECT cu.id INTO v_caller_user_id
    FROM public.cmms_users cu
   WHERE cu.cmms_company_id = p_cmms_company_id
     AND cu.is_active
     AND lower(cu.email) = lower(auth.jwt() ->> 'email')
   LIMIT 1;

  IF v_caller_user_id IS DISTINCT FROM p_cmms_user_id
     AND NOT public.cmms_attendance_has_action(p_cmms_company_id, 'manual') THEN
    RAISE EXCEPTION 'You do not have permission to check in another staff member';
  END IF;

  -- Get company location for validation
  SELECT location INTO v_company_location
    FROM public.cmms_company_profiles
   WHERE id = p_cmms_company_id;

  -- Simple location matching (can be enhanced with geolocation APIs)
  v_location_match := LOWER(TRIM(COALESCE(p_location, ''))) = LOWER(TRIM(COALESCE(v_company_location, '')));

  -- Check if user already checked in today
  IF EXISTS (
    SELECT 1 FROM public.cmms_staff_attendance
    WHERE cmms_user_id = p_cmms_user_id
      AND DATE(check_in_time) = DATE(now())
      AND status = 'checked_in'
  ) THEN
    RAISE EXCEPTION 'User already checked in today. Please check out first.';
  END IF;

  -- Generate QR token
  v_qr_token := public.generate_attendance_qr_token(p_cmms_user_id, p_cmms_company_id);

  -- Create attendance record
  INSERT INTO public.cmms_staff_attendance (
    cmms_company_id,
    cmms_user_id,
    check_in_location,
    check_in_latitude,
    check_in_longitude,
    location_validated,
    qr_code_token,
    status,
    notes
  )
  VALUES (
    p_cmms_company_id,
    p_cmms_user_id,
    p_location,
    p_latitude,
    p_longitude,
    v_location_match,
    v_qr_token,
    'checked_in',
    CASE WHEN v_caller_user_id IS DISTINCT FROM p_cmms_user_id THEN 'Manually checked in by ' || COALESCE(auth.jwt() ->> 'email', 'staff') ELSE NULL END
  )
  RETURNING id INTO v_attendance_id;

  RETURN jsonb_build_object(
    'success', true,
    'attendance_id', v_attendance_id,
    'qr_token', v_qr_token,
    'check_in_time', now(),
    'location_validated', v_location_match,
    'message', CASE WHEN v_location_match
      THEN 'Check-in successful at valid location'
      ELSE 'Check-in recorded but location does not match company location'
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.staff_check_in(UUID, UUID, TEXT, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_check_in(UUID, UUID, TEXT, NUMERIC, NUMERIC) TO authenticated;

-- ============================================================
-- 3. STAFF CHECK-OUT — 'manual' action instead of full admin
-- ============================================================
CREATE OR REPLACE FUNCTION public.staff_check_out(
  p_attendance_id UUID,
  p_location TEXT,
  p_latitude NUMERIC DEFAULT NULL,
  p_longitude NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attendance public.cmms_staff_attendance;
  v_company_location TEXT;
  v_location_match BOOLEAN;
  v_is_owner BOOLEAN;
  v_can_manual BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  SELECT * INTO v_attendance
    FROM public.cmms_staff_attendance
   WHERE id = p_attendance_id;

  IF v_attendance.id IS NULL THEN
    RAISE EXCEPTION 'Attendance record not found';
  END IF;

  IF v_attendance.status = 'checked_out' THEN
    RAISE EXCEPTION 'This attendance record is already checked out';
  END IF;

  v_is_owner := EXISTS (
    SELECT 1 FROM public.cmms_users cu
    WHERE cu.id = v_attendance.cmms_user_id
      AND lower(cu.email) = lower(auth.jwt() ->> 'email')
  );
  v_can_manual := public.cmms_attendance_has_action(v_attendance.cmms_company_id, 'manual');

  IF NOT v_is_owner AND NOT v_can_manual THEN
    RAISE EXCEPTION 'You do not have permission to check out this staff member''s attendance record';
  END IF;

  -- Get company location
  SELECT location INTO v_company_location
    FROM public.cmms_company_profiles
   WHERE id = v_attendance.cmms_company_id;

  v_location_match := LOWER(TRIM(COALESCE(p_location, ''))) = LOWER(TRIM(COALESCE(v_company_location, '')));

  UPDATE public.cmms_staff_attendance
     SET check_out_time = now(),
         check_out_location = COALESCE(NULLIF(trim(p_location), ''), check_in_location),
         check_out_latitude = p_latitude,
         check_out_longitude = p_longitude,
         status = 'checked_out',
         updated_at = now(),
         notes = CASE WHEN NOT v_is_owner THEN trim(both ' ' from concat_ws(' ', notes, '· Manually checked out by ' || COALESCE(auth.jwt() ->> 'email', 'staff'))) ELSE notes END
   WHERE id = p_attendance_id;

  RETURN jsonb_build_object(
    'success', true,
    'attendance_id', p_attendance_id,
    'check_out_time', now(),
    'location_validated', v_location_match,
    'message', 'Check-out successful'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.staff_check_out(UUID, TEXT, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_check_out(UUID, TEXT, NUMERIC, NUMERIC) TO authenticated;

-- ============================================================
-- 4. ACTIVE CHECK-INS PICKLIST — 'manual' action
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_active_staff_check_ins(p_cmms_company_id UUID)
RETURNS TABLE (
  id UUID,
  cmms_user_id UUID,
  user_name TEXT,
  user_email TEXT,
  check_in_time TIMESTAMPTZ,
  check_in_location TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.cmms_attendance_has_action(p_cmms_company_id, 'manual') THEN
    RAISE EXCEPTION 'You do not have permission to view active check-ins';
  END IF;

  RETURN QUERY
  SELECT a.id, a.cmms_user_id, COALESCE(u.full_name, u.user_name)::TEXT, u.email::TEXT,
         a.check_in_time, a.check_in_location::TEXT
    FROM public.cmms_staff_attendance a
    JOIN public.cmms_users u ON u.id = a.cmms_user_id
   WHERE a.cmms_company_id = p_cmms_company_id
     AND a.status = 'checked_in'
   ORDER BY a.check_in_time ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_active_staff_check_ins(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_staff_check_ins(UUID) TO authenticated;

-- ============================================================
-- 5. ADD ATTENDANCE DAYS — 'days' action instead of full admin
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_add_attendance_days(
  p_cmms_company_id UUID,
  p_cmms_user_id UUID,
  p_days INTEGER,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_adjustment_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  IF NOT public.cmms_attendance_has_action(p_cmms_company_id, 'days') THEN
    RAISE EXCEPTION 'You do not have permission to add attendance days';
  END IF;

  IF p_days IS NULL OR p_days <= 0 THEN
    RAISE EXCEPTION 'Days to add must be a positive whole number. Attendance days cannot be reduced.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cmms_users
    WHERE id = p_cmms_user_id
      AND cmms_company_id = p_cmms_company_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'User is not an active member of this company';
  END IF;

  INSERT INTO public.cmms_attendance_day_adjustments (
    cmms_company_id, cmms_user_id, days_added, reason, added_by
  )
  VALUES (
    p_cmms_company_id, p_cmms_user_id, p_days, NULLIF(trim(p_reason), ''), auth.uid()
  )
  RETURNING id INTO v_adjustment_id;

  RETURN jsonb_build_object(
    'success', true,
    'adjustment_id', v_adjustment_id,
    'days_added', p_days,
    'message', format('%s day(s) added', p_days)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_add_attendance_days(UUID, UUID, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_add_attendance_days(UUID, UUID, INTEGER, TEXT) TO authenticated;

-- ============================================================
-- 6. DAY-ADJUSTMENT AUDIT LIST — 'days' action
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_attendance_day_adjustments(
  p_cmms_company_id UUID,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  cmms_user_id UUID,
  user_name TEXT,
  user_email TEXT,
  days_added INTEGER,
  reason TEXT,
  added_by_name TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.cmms_attendance_has_action(p_cmms_company_id, 'days') THEN
    RAISE EXCEPTION 'You do not have permission to view attendance day adjustments';
  END IF;

  RETURN QUERY
  SELECT d.id, d.cmms_user_id, COALESCE(u.full_name, u.user_name)::TEXT, u.email::TEXT,
         d.days_added, d.reason, COALESCE(added_by_user.full_name, added_by_user.user_name, added_by_user.email)::TEXT,
         d.created_at
    FROM public.cmms_attendance_day_adjustments d
    JOIN public.cmms_users u ON u.id = d.cmms_user_id
    LEFT JOIN public.cmms_users added_by_user
      ON added_by_user.cmms_company_id = d.cmms_company_id
     AND lower(added_by_user.email) = lower((SELECT email FROM auth.users WHERE id = d.added_by))
   WHERE d.cmms_company_id = p_cmms_company_id
     AND (p_user_id IS NULL OR d.cmms_user_id = p_user_id)
   ORDER BY d.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_attendance_day_adjustments(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_attendance_day_adjustments(UUID, UUID) TO authenticated;

DROP POLICY IF EXISTS "Admins can read attendance day adjustments" ON public.cmms_attendance_day_adjustments;
CREATE POLICY "Admins can read attendance day adjustments"
  ON public.cmms_attendance_day_adjustments FOR SELECT
  USING (public.cmms_attendance_has_action(cmms_company_id, 'days'));

-- ============================================================
-- 7. RECORDS + SUMMARY — 'view' action controls seeing OTHER staff
--    (everyone can still always see their own attendance regardless)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_attendance_records(
  p_cmms_company_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID, cmms_user_id UUID, user_email TEXT, user_name TEXT,
  check_in_time TIMESTAMPTZ, check_out_time TIMESTAMPTZ,
  check_in_location TEXT, location_validated BOOLEAN, status TEXT,
  notes TEXT, edited_at TIMESTAMPTZ, edit_reason TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_current_user_id UUID;
  v_is_admin BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in is required'; END IF;
  -- `id` is also a RETURNS TABLE output variable in this PL/pgSQL function.
  -- Qualifying the column prevents PostgreSQL error 42702 (ambiguous id).
  SELECT cu.id INTO v_current_user_id
    FROM public.cmms_users AS cu
   WHERE cu.cmms_company_id = p_cmms_company_id AND cu.is_active
     AND lower(cu.email) = lower(auth.jwt() ->> 'email')
   LIMIT 1;
  IF v_current_user_id IS NULL THEN RAISE EXCEPTION 'Active CMMS staff membership is required'; END IF;
  v_is_admin := public.cmms_attendance_has_action(p_cmms_company_id, 'view');

  RETURN QUERY
  SELECT a.id, a.cmms_user_id, u.email::TEXT, COALESCE(u.full_name, u.user_name)::TEXT,
         a.check_in_time, a.check_out_time, a.check_in_location::TEXT,
         a.location_validated, a.status::TEXT, a.notes::TEXT, a.edited_at, a.edit_reason::TEXT
    FROM public.cmms_staff_attendance a
    JOIN public.cmms_users u ON u.id = a.cmms_user_id
   WHERE a.cmms_company_id = p_cmms_company_id
     AND (p_start_date IS NULL OR a.check_in_time >= p_start_date::TIMESTAMPTZ)
     AND (p_end_date IS NULL OR a.check_in_time < (p_end_date + 1)::TIMESTAMPTZ)
     AND (p_user_id IS NULL OR a.cmms_user_id = p_user_id)
     AND (v_is_admin OR a.cmms_user_id = v_current_user_id)
   ORDER BY a.check_in_time DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_attendance_records(UUID, DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_attendance_records(UUID, DATE, DATE, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_attendance_summary(
  p_cmms_company_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  cmms_user_id UUID,
  user_name TEXT,
  user_email TEXT,
  check_in_count BIGINT,
  days_present BIGINT,
  manual_days_added BIGINT,
  first_check_in_time TIMESTAMPTZ,
  last_check_in_time TIMESTAMPTZ,
  last_check_out_time TIMESTAMPTZ,
  currently_checked_in BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_current_user_id UUID;
  v_is_admin BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in is required'; END IF;

  SELECT cu.id INTO v_current_user_id
    FROM public.cmms_users AS cu
   WHERE cu.cmms_company_id = p_cmms_company_id AND cu.is_active
     AND lower(cu.email) = lower(auth.jwt() ->> 'email')
   LIMIT 1;
  IF v_current_user_id IS NULL THEN RAISE EXCEPTION 'Active CMMS staff membership is required'; END IF;
  v_is_admin := public.cmms_attendance_has_action(p_cmms_company_id, 'view');

  RETURN QUERY
  WITH checkins AS (
    SELECT a.cmms_user_id,
           COALESCE(u.full_name, u.user_name)::TEXT AS user_name,
           u.email::TEXT AS user_email,
           COUNT(*)::BIGINT AS check_in_count,
           COUNT(DISTINCT DATE(a.check_in_time))::BIGINT AS days_present,
           MIN(a.check_in_time) AS first_check_in_time,
           MAX(a.check_in_time) AS last_check_in_time,
           MAX(a.check_out_time) AS last_check_out_time,
           BOOL_OR(a.status = 'checked_in') AS currently_checked_in
      FROM public.cmms_staff_attendance a
      JOIN public.cmms_users u ON u.id = a.cmms_user_id
     WHERE a.cmms_company_id = p_cmms_company_id
       AND (p_start_date IS NULL OR a.check_in_time >= p_start_date::TIMESTAMPTZ)
       AND (p_end_date IS NULL OR a.check_in_time < (p_end_date + 1)::TIMESTAMPTZ)
       AND (p_user_id IS NULL OR a.cmms_user_id = p_user_id)
       AND (v_is_admin OR a.cmms_user_id = v_current_user_id)
     GROUP BY a.cmms_user_id, u.full_name, u.user_name, u.email
  ),
  adjustments AS (
    SELECT d.cmms_user_id, COALESCE(SUM(d.days_added), 0)::BIGINT AS manual_days_added
      FROM public.cmms_attendance_day_adjustments d
     WHERE d.cmms_company_id = p_cmms_company_id
       AND (p_start_date IS NULL OR d.created_at >= p_start_date::TIMESTAMPTZ)
       AND (p_end_date IS NULL OR d.created_at < (p_end_date + 1)::TIMESTAMPTZ)
       AND (p_user_id IS NULL OR d.cmms_user_id = p_user_id)
       AND (v_is_admin OR d.cmms_user_id = v_current_user_id)
     GROUP BY d.cmms_user_id
  )
  SELECT c.cmms_user_id, c.user_name, c.user_email, c.check_in_count,
         c.days_present + COALESCE(a.manual_days_added, 0) AS days_present,
         COALESCE(a.manual_days_added, 0) AS manual_days_added,
         c.first_check_in_time, c.last_check_in_time, c.last_check_out_time, c.currently_checked_in
    FROM checkins c
    LEFT JOIN adjustments a ON a.cmms_user_id = c.cmms_user_id
   ORDER BY days_present DESC, c.user_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_attendance_summary(UUID, DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_attendance_summary(UUID, DATE, DATE, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────
-- VERIFY
-- ─────────────────────────────────────────────────────────────────────────
SELECT 'attendance role-based permissions installed' AS status;
