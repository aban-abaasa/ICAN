-- ============================================================================
-- CMMS STAFF ATTENDANCE — CHECK-IN SUMMARY + ADMIN MANUAL CHECK-IN/OUT
-- Run in Supabase SQL Editor any time after CMMS_STAFF_ATTENDANCE_VISITOR_MANAGEMENT.sql.
--
-- WHAT THIS ADDS:
--   1. get_attendance_summary(): one row per staff member with a check-in
--      COUNT and a distinct-days-present count for a date range, instead of
--      the raw per-day rows (which repeat the same staff name once per day).
--   2. get_active_staff_check_ins(): the current "who is checked in right
--      now" list (with attendance_id), so an admin can pick someone to
--      manually check out without re-deriving it from the dated record list.
--   3. staff_check_in()/staff_check_out() are redefined to allow a company
--      admin to act on behalf of another staff member — the same manual
--      register/check-out pattern already used for visitors — while closing
--      a gap where staff_check_out had NO ownership/admin check at all (any
--      signed-in CMMS user could check out anyone's attendance record).
-- ============================================================================

-- ============================================================
-- 1. STAFF CHECK-IN — allow admin to check in another staff member
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

  -- Self check-in (QR flow) or an admin manually checking in someone else.
  SELECT cu.id INTO v_caller_user_id
    FROM public.cmms_users cu
   WHERE cu.cmms_company_id = p_cmms_company_id
     AND cu.is_active
     AND lower(cu.email) = lower(auth.jwt() ->> 'email')
   LIMIT 1;

  IF v_caller_user_id IS DISTINCT FROM p_cmms_user_id
     AND NOT public.cmms_attendance_qr_admin(p_cmms_company_id) THEN
    RAISE EXCEPTION 'Only a company administrator can check in another staff member';
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
    CASE WHEN v_caller_user_id IS DISTINCT FROM p_cmms_user_id THEN 'Manually checked in by admin' ELSE NULL END
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
-- 2. STAFF CHECK-OUT — require ownership or admin (previously unchecked)
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
  v_is_admin BOOLEAN;
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
  v_is_admin := public.cmms_attendance_qr_admin(v_attendance.cmms_company_id);

  IF NOT v_is_owner AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Only the checked-in staff member or a company administrator can check out this record';
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
         notes = CASE WHEN NOT v_is_owner THEN trim(both ' ' from concat_ws(' ', notes, '· Manually checked out by admin')) ELSE notes END
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
-- 3. CHECK-IN SUMMARY — one row per staff member, not per day
-- ============================================================
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
  first_check_in_time TIMESTAMPTZ,
  last_check_in_time TIMESTAMPTZ,
  last_check_out_time TIMESTAMPTZ,
  currently_checked_in BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
  v_is_admin := public.cmms_attendance_qr_admin(p_cmms_company_id);

  RETURN QUERY
  SELECT a.cmms_user_id,
         COALESCE(u.full_name, u.user_name)::TEXT,
         u.email::TEXT,
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
   ORDER BY check_in_count DESC, user_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_attendance_summary(UUID, DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_attendance_summary(UUID, DATE, DATE, UUID) TO authenticated;

-- ============================================================
-- 4. ACTIVE CHECK-INS — admin picklist for manual check-out
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
  IF NOT public.cmms_attendance_qr_admin(p_cmms_company_id) THEN
    RAISE EXCEPTION 'Only a company administrator can view active check-ins';
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

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────
-- VERIFY
-- ─────────────────────────────────────────────────────────────────────────
SELECT 'attendance summary + admin manual check-in/out installed' AS status;
