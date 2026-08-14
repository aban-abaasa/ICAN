-- ============================================================
-- CMMS Staff Attendance & Visitor Management System
-- ============================================================
-- Enables QR code-based check-in for staff and visitors
-- Includes location validation and admin review/edit controls
-- Run after CMMS core schema is deployed

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1. STAFF ATTENDANCE TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_staff_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  cmms_user_id UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
  check_in_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  check_out_time TIMESTAMPTZ,
  check_in_location TEXT NOT NULL,
  check_out_location TEXT,
  check_in_latitude NUMERIC(10, 8),
  check_in_longitude NUMERIC(11, 8),
  check_out_latitude NUMERIC(10, 8),
  check_out_longitude NUMERIC(11, 8),
  location_validated BOOLEAN DEFAULT false,
  qr_code_token TEXT UNIQUE,
  status TEXT DEFAULT 'checked_in', -- checked_in, checked_out
  notes TEXT,
  edited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  edited_at TIMESTAMPTZ,
  edit_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cmms_attendance_company_user
  ON public.cmms_staff_attendance(cmms_company_id, cmms_user_id, check_in_time DESC);

-- DATE(timestamptz) depends on the session time zone and cannot be indexed.
-- The application already filters by a timestamp range, so this index supports
-- those lookups without a non-immutable expression.
DROP INDEX IF EXISTS public.idx_cmms_attendance_company_date;
CREATE INDEX IF NOT EXISTS idx_cmms_attendance_company_check_in_time
  ON public.cmms_staff_attendance(cmms_company_id, check_in_time DESC);

CREATE INDEX IF NOT EXISTS idx_cmms_attendance_qr_token
  ON public.cmms_staff_attendance(qr_code_token);

-- A location QR is a capability to open the lightweight attendance page. It
-- never identifies a staff member; the authenticated caller is resolved on
-- the server, so a photographed/shared code cannot be used to impersonate a
-- colleague.
CREATE TABLE IF NOT EXISTS public.cmms_attendance_qr_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  location_name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cmms_attendance_qr_locations_active_name
  ON public.cmms_attendance_qr_locations(cmms_company_id, lower(location_name))
  WHERE is_active;

-- ============================================================
-- 2. VISITOR MANAGEMENT TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_visitor_checkin (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  visitor_name TEXT NOT NULL,
  visitor_email TEXT,
  visitor_phone TEXT,
  check_in_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  check_out_time TIMESTAMPTZ,
  check_in_location TEXT NOT NULL,
  check_out_location TEXT,
  check_in_latitude NUMERIC(10, 8),
  check_in_longitude NUMERIC(11, 8),
  check_out_latitude NUMERIC(10, 8),
  check_out_longitude NUMERIC(11, 8),
  location_validated BOOLEAN DEFAULT false,
  qr_code_token TEXT UNIQUE,
  host_cmms_user_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  host_name TEXT,
  host_email TEXT,
  purpose TEXT,
  status TEXT DEFAULT 'checked_in', -- checked_in, checked_out, flagged_for_review
  flagged_reason TEXT,
  admin_notes TEXT,
  verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

DROP INDEX IF EXISTS public.idx_cmms_visitor_company_date;
CREATE INDEX IF NOT EXISTS idx_cmms_visitor_company_check_in_time
  ON public.cmms_visitor_checkin(cmms_company_id, check_in_time DESC);

CREATE INDEX IF NOT EXISTS idx_cmms_visitor_qr_token
  ON public.cmms_visitor_checkin(qr_code_token);

CREATE INDEX IF NOT EXISTS idx_cmms_visitor_status
  ON public.cmms_visitor_checkin(cmms_company_id, status);

-- ============================================================
-- 3. ATTENDANCE AUDIT LOG (For admin edits)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_attendance_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id UUID NOT NULL REFERENCES public.cmms_staff_attendance(id) ON DELETE CASCADE,
  edited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  change_type TEXT, -- 'check_in_time', 'check_out_time', 'location', 'status', 'notes'
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cmms_audit_attendance
  ON public.cmms_attendance_audit(attendance_id);

CREATE INDEX IF NOT EXISTS idx_cmms_audit_editor
  ON public.cmms_attendance_audit(edited_by);

-- ============================================================
-- 4. GENERATE ATTENDANCE QR CODE TOKEN
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_attendance_qr_token(
  p_cmms_user_id UUID,
  p_cmms_company_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
BEGIN
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_attendance_qr_token(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_attendance_qr_token(UUID, UUID) TO authenticated;

-- ============================================================
-- 5. STAFF CHECK-IN FUNCTION
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
BEGIN
  -- Verify user is authenticated and is a CMMS user at this company
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cmms_users
    WHERE id = p_cmms_user_id
      AND cmms_company_id = p_cmms_company_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'User is not an active member of this company';
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
    status
  )
  VALUES (
    p_cmms_company_id,
    p_cmms_user_id,
    p_location,
    p_latitude,
    p_longitude,
    v_location_match,
    v_qr_token,
    'checked_in'
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
-- 6. STAFF CHECK-OUT FUNCTION
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

  -- Get company location
  SELECT location INTO v_company_location
    FROM public.cmms_company_profiles
   WHERE id = v_attendance.cmms_company_id;

  v_location_match := LOWER(TRIM(COALESCE(p_location, ''))) = LOWER(TRIM(COALESCE(v_company_location, '')));

  UPDATE public.cmms_staff_attendance
     SET check_out_time = now(),
         check_out_location = p_location,
         check_out_latitude = p_latitude,
         check_out_longitude = p_longitude,
         status = 'checked_out',
         updated_at = now()
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
-- 7. VISITOR CHECK-IN FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.visitor_check_in(
  p_cmms_company_id UUID,
  p_visitor_name TEXT,
  p_visitor_email TEXT,
  p_visitor_phone TEXT,
  p_check_in_location TEXT,
  p_latitude NUMERIC DEFAULT NULL,
  p_longitude NUMERIC DEFAULT NULL,
  p_host_email TEXT DEFAULT NULL,
  p_purpose TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qr_token TEXT;
  v_visitor_id UUID;
  v_company_location TEXT;
  v_location_match BOOLEAN;
  v_host_user_id UUID;
  v_host_name TEXT;
BEGIN
  IF p_visitor_name IS NULL OR TRIM(p_visitor_name) = '' THEN
    RAISE EXCEPTION 'Visitor name is required';
  END IF;

  IF p_check_in_location IS NULL OR TRIM(p_check_in_location) = '' THEN
    RAISE EXCEPTION 'Check-in location is required';
  END IF;

  -- Get company location
  SELECT location INTO v_company_location
    FROM public.cmms_company_profiles
   WHERE id = p_cmms_company_id;

  v_location_match := LOWER(TRIM(COALESCE(p_check_in_location, ''))) = LOWER(TRIM(COALESCE(v_company_location, '')));

  -- Find host if provided
  IF p_host_email IS NOT NULL THEN
    SELECT cu.id, cu.full_name INTO v_host_user_id, v_host_name
      FROM public.cmms_users cu
     WHERE cu.cmms_company_id = p_cmms_company_id
       AND LOWER(cu.email) = LOWER(p_host_email)
       AND cu.is_active = true
     LIMIT 1;
  END IF;

  -- Generate QR token
  v_qr_token := public.generate_attendance_qr_token(NULL, p_cmms_company_id);

  -- Create visitor record
  INSERT INTO public.cmms_visitor_checkin (
    cmms_company_id,
    visitor_name,
    visitor_email,
    visitor_phone,
    check_in_location,
    check_in_latitude,
    check_in_longitude,
    location_validated,
    qr_code_token,
    host_cmms_user_id,
    host_name,
    host_email,
    purpose,
    status
  )
  VALUES (
    p_cmms_company_id,
    p_visitor_name,
    p_visitor_email,
    p_visitor_phone,
    p_check_in_location,
    p_latitude,
    p_longitude,
    v_location_match,
    v_qr_token,
    v_host_user_id,
    v_host_name,
    p_host_email,
    p_purpose,
    'checked_in'
  )
  RETURNING id INTO v_visitor_id;

  RETURN jsonb_build_object(
    'success', true,
    'visitor_id', v_visitor_id,
    'qr_token', v_qr_token,
    'check_in_time', now(),
    'location_validated', v_location_match,
    'message', 'Visitor registered successfully'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.visitor_check_in(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.visitor_check_in(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT) TO authenticated;

-- ============================================================
-- 8. VISITOR CHECK-OUT FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.visitor_check_out(
  p_visitor_id UUID,
  p_location TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visitor public.cmms_visitor_checkin;
BEGIN
  SELECT * INTO v_visitor
    FROM public.cmms_visitor_checkin
   WHERE id = p_visitor_id;

  IF v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'Visitor record not found';
  END IF;

  UPDATE public.cmms_visitor_checkin
     SET check_out_time = now(),
         check_out_location = COALESCE(p_location, check_in_location),
         status = 'checked_out',
         updated_at = now()
   WHERE id = p_visitor_id;

  RETURN jsonb_build_object(
    'success', true,
    'visitor_id', p_visitor_id,
    'check_out_time', now(),
    'message', 'Visitor check-out recorded'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.visitor_check_out(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.visitor_check_out(UUID, TEXT) TO authenticated;

-- ============================================================
-- 9. ADMIN EDIT ATTENDANCE FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_edit_attendance(
  p_attendance_id UUID,
  p_check_in_time TIMESTAMPTZ DEFAULT NULL,
  p_check_out_time TIMESTAMPTZ DEFAULT NULL,
  p_location TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_edit_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attendance public.cmms_staff_attendance;
  v_has_admin_role BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  -- Check if user is admin or has approval authority
  SELECT * INTO v_attendance
    FROM public.cmms_staff_attendance
   WHERE id = p_attendance_id;

  IF v_attendance.id IS NULL THEN
    RAISE EXCEPTION 'Attendance record not found';
  END IF;

  -- Verify admin role (simplified - check CMMS admin or company creator)
  v_has_admin_role := EXISTS (
    SELECT 1 FROM public.cmms_users cu
    JOIN public.cmms_user_roles ur ON ur.cmms_user_id = cu.id
    JOIN public.cmms_roles r ON r.id = ur.cmms_role_id
    WHERE cu.cmms_company_id = v_attendance.cmms_company_id
      AND lower(cu.email) = lower(auth.jwt() ->> 'email')
      AND lower(COALESCE(r.role_name, '')) IN ('admin', 'administrator', 'cmms_admin')
      AND ur.is_active = true
  );

  IF NOT v_has_admin_role THEN
    RAISE EXCEPTION 'Only company administrators can edit attendance records';
  END IF;

  -- Log the changes
  IF p_check_in_time IS NOT NULL AND p_check_in_time <> v_attendance.check_in_time THEN
    INSERT INTO public.cmms_attendance_audit (attendance_id, edited_by, change_type, old_value, new_value, reason)
    VALUES (p_attendance_id, auth.uid(), 'check_in_time', v_attendance.check_in_time::TEXT, p_check_in_time::TEXT, p_edit_reason);
  END IF;

  IF p_check_out_time IS NOT NULL AND p_check_out_time <> v_attendance.check_out_time THEN
    INSERT INTO public.cmms_attendance_audit (attendance_id, edited_by, change_type, old_value, new_value, reason)
    VALUES (p_attendance_id, auth.uid(), 'check_out_time', v_attendance.check_out_time::TEXT, p_check_out_time::TEXT, p_edit_reason);
  END IF;

  IF p_location IS NOT NULL AND p_location <> v_attendance.check_in_location THEN
    INSERT INTO public.cmms_attendance_audit (attendance_id, edited_by, change_type, old_value, new_value, reason)
    VALUES (p_attendance_id, auth.uid(), 'location', v_attendance.check_in_location, p_location, p_edit_reason);
  END IF;

  -- Update the record
  UPDATE public.cmms_staff_attendance
     SET check_in_time = COALESCE(p_check_in_time, check_in_time),
         check_out_time = COALESCE(p_check_out_time, check_out_time),
         check_in_location = COALESCE(p_location, check_in_location),
         notes = COALESCE(p_notes, notes),
         edited_by = auth.uid(),
         edited_at = now(),
         edit_reason = p_edit_reason,
         updated_at = now()
   WHERE id = p_attendance_id;

  RETURN jsonb_build_object(
    'success', true,
    'attendance_id', p_attendance_id,
    'message', 'Attendance record updated by admin'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_edit_attendance(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_edit_attendance(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================
-- 10. GET ATTENDANCE RECORDS (RLS-aware)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_attendance_records(
  p_cmms_company_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  cmms_user_id UUID,
  user_email TEXT,
  user_name TEXT,
  check_in_time TIMESTAMPTZ,
  check_out_time TIMESTAMPTZ,
  check_in_location TEXT,
  location_validated BOOLEAN,
  status TEXT,
  notes TEXT,
  edited_at TIMESTAMPTZ,
  edit_reason TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ca.id,
    ca.cmms_user_id,
    cu.email,
    cu.full_name,
    ca.check_in_time,
    ca.check_out_time,
    ca.check_in_location,
    ca.location_validated,
    ca.status,
    ca.notes,
    ca.edited_at,
    ca.edit_reason
  FROM public.cmms_staff_attendance ca
  JOIN public.cmms_users cu ON cu.id = ca.cmms_user_id
  WHERE ca.cmms_company_id = p_cmms_company_id
    AND (p_start_date IS NULL OR DATE(ca.check_in_time) >= p_start_date)
    AND (p_end_date IS NULL OR DATE(ca.check_in_time) <= p_end_date)
    AND (p_user_id IS NULL OR ca.cmms_user_id = p_user_id)
  ORDER BY ca.check_in_time DESC;
$$;

REVOKE ALL ON FUNCTION public.get_attendance_records(UUID, DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_attendance_records(UUID, DATE, DATE, UUID) TO authenticated;

-- ============================================================
-- 11. GET VISITOR RECORDS (RLS-aware)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_visitor_records(
  p_cmms_company_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_status TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  visitor_name TEXT,
  visitor_email TEXT,
  visitor_phone TEXT,
  check_in_time TIMESTAMPTZ,
  check_out_time TIMESTAMPTZ,
  check_in_location TEXT,
  location_validated BOOLEAN,
  host_name TEXT,
  host_email TEXT,
  purpose TEXT,
  status TEXT,
  flagged_reason TEXT,
  admin_notes TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    vc.id,
    vc.visitor_name,
    vc.visitor_email,
    vc.visitor_phone,
    vc.check_in_time,
    vc.check_out_time,
    vc.check_in_location,
    vc.location_validated,
    vc.host_name,
    vc.host_email,
    vc.purpose,
    vc.status,
    vc.flagged_reason,
    vc.admin_notes
  FROM public.cmms_visitor_checkin vc
  WHERE vc.cmms_company_id = p_cmms_company_id
    AND (p_start_date IS NULL OR DATE(vc.check_in_time) >= p_start_date)
    AND (p_end_date IS NULL OR DATE(vc.check_in_time) <= p_end_date)
    AND (p_status IS NULL OR vc.status = p_status)
  ORDER BY vc.check_in_time DESC;
$$;

REVOKE ALL ON FUNCTION public.get_visitor_records(UUID, DATE, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_visitor_records(UUID, DATE, DATE, TEXT) TO authenticated;

-- ============================================================
-- 12. FLAG SUSPICIOUS VISITOR RECORD
-- ============================================================
CREATE OR REPLACE FUNCTION public.flag_visitor_record(
  p_visitor_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visitor public.cmms_visitor_checkin;
  v_has_admin_role BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  SELECT * INTO v_visitor
    FROM public.cmms_visitor_checkin
   WHERE id = p_visitor_id;

  IF v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'Visitor record not found';
  END IF;

  -- Verify admin role
  v_has_admin_role := EXISTS (
    SELECT 1 FROM public.cmms_users cu
    JOIN public.cmms_user_roles ur ON ur.cmms_user_id = cu.id
    JOIN public.cmms_roles r ON r.id = ur.cmms_role_id
    WHERE cu.cmms_company_id = v_visitor.cmms_company_id
      AND lower(cu.email) = lower(auth.jwt() ->> 'email')
      AND lower(COALESCE(r.role_name, '')) IN ('admin', 'administrator', 'cmms_admin')
      AND ur.is_active = true
  );

  IF NOT v_has_admin_role THEN
    RAISE EXCEPTION 'Only company administrators can flag visitor records';
  END IF;

  UPDATE public.cmms_visitor_checkin
     SET status = 'flagged_for_review',
         flagged_reason = p_reason,
         admin_notes = COALESCE(admin_notes, '') || E'\n[Admin Flag] ' || p_reason,
         verified_by = auth.uid(),
         verified_at = now(),
         updated_at = now()
   WHERE id = p_visitor_id;

  RETURN jsonb_build_object(
    'success', true,
    'visitor_id', p_visitor_id,
    'status', 'flagged_for_review',
    'message', 'Visitor record flagged for review'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.flag_visitor_record(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.flag_visitor_record(UUID, TEXT) TO authenticated;

-- ============================================================
-- 13. TOKENIZED, STANDALONE STAFF QR CHECK-IN
-- ============================================================
CREATE OR REPLACE FUNCTION public.cmms_attendance_qr_admin(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.cmms_users cu
      LEFT JOIN public.cmms_user_roles ur ON ur.cmms_user_id = cu.id AND ur.is_active
      LEFT JOIN public.cmms_roles r ON r.id = ur.cmms_role_id AND r.is_active
     WHERE cu.cmms_company_id = p_company_id
       AND cu.is_active
       AND lower(cu.email) = lower(auth.jwt() ->> 'email')
       AND lower(COALESCE(r.role_name, cu.role, '')) IN ('admin', 'administrator', 'cmms_admin', 'business_admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.cmms_active_staff(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.cmms_users cu
    WHERE cu.cmms_company_id = p_company_id
      AND cu.is_active
      AND lower(cu.email) = lower(auth.jwt() ->> 'email')
  );
$$;

CREATE OR REPLACE FUNCTION public.create_cmms_attendance_qr_location(
  p_cmms_company_id UUID,
  p_location_name TEXT
)
RETURNS TABLE (id UUID, location_name TEXT, token TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NULLIF(trim(p_location_name), '') IS NULL THEN
    RAISE EXCEPTION 'Location name is required';
  END IF;
  IF NOT public.cmms_active_staff(p_cmms_company_id) THEN
    RAISE EXCEPTION 'Only an active CMMS staff member can create attendance QR codes';
  END IF;

  UPDATE public.cmms_attendance_qr_locations
     SET is_active = FALSE
   WHERE cmms_company_id = p_cmms_company_id
     AND lower(cmms_attendance_qr_locations.location_name) = lower(trim(p_location_name))
     AND is_active;

  RETURN QUERY
  INSERT INTO public.cmms_attendance_qr_locations (cmms_company_id, location_name, created_by)
  VALUES (p_cmms_company_id, trim(p_location_name), auth.uid())
  RETURNING cmms_attendance_qr_locations.id,
            cmms_attendance_qr_locations.location_name,
            cmms_attendance_qr_locations.token;
END;
$$;

-- This deliberately reveals only the location and company display name. The
-- record action itself requires a logged-in active staff member.
CREATE OR REPLACE FUNCTION public.resolve_cmms_attendance_qr(p_token TEXT)
RETURNS TABLE (cmms_company_id UUID, company_name TEXT, location_name TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT q.cmms_company_id, cp.company_name, q.location_name
    FROM public.cmms_attendance_qr_locations q
    JOIN public.cmms_company_profiles cp ON cp.id = q.cmms_company_id
   WHERE q.token = trim(p_token)
     AND q.is_active
     AND cp.is_active
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.staff_check_in_with_qr(
  p_token TEXT,
  p_latitude NUMERIC DEFAULT NULL,
  p_longitude NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_qr public.cmms_attendance_qr_locations;
  v_staff public.cmms_users;
  v_attendance_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required before checking in';
  END IF;

  SELECT * INTO v_qr
    FROM public.cmms_attendance_qr_locations
   WHERE token = trim(p_token) AND is_active
   FOR UPDATE;
  IF v_qr.id IS NULL THEN
    RAISE EXCEPTION 'This attendance QR code is invalid or has been deactivated';
  END IF;

  SELECT * INTO v_staff
    FROM public.cmms_users
   WHERE cmms_company_id = v_qr.cmms_company_id
     AND is_active
     AND lower(email) = lower(auth.jwt() ->> 'email')
   LIMIT 1;
  IF v_staff.id IS NULL THEN
    RAISE EXCEPTION 'Your signed-in account is not an active staff member for this business';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cmms_staff_attendance
     WHERE cmms_user_id = v_staff.id
       AND DATE(check_in_time) = CURRENT_DATE
       AND status = 'checked_in'
  ) THEN
    RAISE EXCEPTION 'You are already checked in today. Please check out first.';
  END IF;

  INSERT INTO public.cmms_staff_attendance
    (cmms_company_id, cmms_user_id, check_in_location, check_in_latitude,
     check_in_longitude, location_validated, qr_code_token, status)
  VALUES
    (v_qr.cmms_company_id, v_staff.id, v_qr.location_name, p_latitude,
     p_longitude, TRUE, v_qr.token, 'checked_in')
  RETURNING id INTO v_attendance_id;

  UPDATE public.cmms_attendance_qr_locations SET last_used_at = now() WHERE id = v_qr.id;
  RETURN jsonb_build_object('success', TRUE, 'attendance_id', v_attendance_id,
    'company_id', v_qr.cmms_company_id, 'location', v_qr.location_name,
    'message', 'Staff identity verified and check-in recorded');
END;
$$;

-- The QR identifies the location only. The signed-in staff account determines
-- which open attendance record can be checked out.
CREATE OR REPLACE FUNCTION public.staff_check_out_with_qr(
  p_token TEXT,
  p_latitude NUMERIC DEFAULT NULL,
  p_longitude NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_qr public.cmms_attendance_qr_locations;
  v_staff public.cmms_users;
  v_attendance public.cmms_staff_attendance;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in is required before checking out'; END IF;
  SELECT * INTO v_qr FROM public.cmms_attendance_qr_locations WHERE token = trim(p_token) AND is_active FOR UPDATE;
  IF v_qr.id IS NULL THEN RAISE EXCEPTION 'This attendance QR code is invalid or has been deactivated'; END IF;
  SELECT * INTO v_staff FROM public.cmms_users WHERE cmms_company_id = v_qr.cmms_company_id AND is_active AND lower(email) = lower(auth.jwt() ->> 'email') LIMIT 1;
  IF v_staff.id IS NULL THEN RAISE EXCEPTION 'Your signed-in account is not an active staff member for this business'; END IF;
  SELECT * INTO v_attendance FROM public.cmms_staff_attendance
   WHERE cmms_user_id = v_staff.id AND cmms_company_id = v_qr.cmms_company_id AND status = 'checked_in'
   ORDER BY check_in_time DESC LIMIT 1 FOR UPDATE;
  IF v_attendance.id IS NULL THEN RAISE EXCEPTION 'You do not have an active check-in to check out'; END IF;
  UPDATE public.cmms_staff_attendance SET check_out_time = now(), check_out_location = v_qr.location_name,
    check_out_latitude = p_latitude, check_out_longitude = p_longitude, status = 'checked_out', updated_at = now()
   WHERE id = v_attendance.id;
  UPDATE public.cmms_attendance_qr_locations SET last_used_at = now() WHERE id = v_qr.id;
  RETURN jsonb_build_object('success', TRUE, 'attendance_id', v_attendance.id, 'message', 'Staff check-out recorded');
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_attendance_qr_admin(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_active_staff(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_cmms_attendance_qr_location(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_cmms_attendance_qr(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_check_in_with_qr(TEXT, NUMERIC, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_check_out_with_qr(TEXT, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_attendance_qr_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_active_staff(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_cmms_attendance_qr_location(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_cmms_attendance_qr(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_check_in_with_qr(TEXT, NUMERIC, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_check_out_with_qr(TEXT, NUMERIC, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 14. PUBLIC, TOKENIZED VISITOR QR CHECK-IN
-- ============================================================
ALTER TABLE public.cmms_visitor_checkin
  ADD COLUMN IF NOT EXISTS visitor_origin TEXT;

CREATE TABLE IF NOT EXISTS public.cmms_visitor_qr_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  location_name TEXT NOT NULL,
  host_email TEXT,
  purpose TEXT,
  token TEXT NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION public.create_cmms_visitor_qr_location(
  p_cmms_company_id UUID, p_location_name TEXT, p_host_email TEXT DEFAULT NULL, p_purpose TEXT DEFAULT NULL
) RETURNS TABLE (id UUID, location_name TEXT, token TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NULLIF(trim(p_location_name), '') IS NULL THEN RAISE EXCEPTION 'Location name is required'; END IF;
  IF NOT public.cmms_active_staff(p_cmms_company_id) THEN RAISE EXCEPTION 'Only an active CMMS staff member can create visitor QR codes'; END IF;
  UPDATE public.cmms_visitor_qr_locations SET is_active = FALSE
   WHERE cmms_company_id = p_cmms_company_id AND lower(cmms_visitor_qr_locations.location_name) = lower(trim(p_location_name)) AND is_active;
  RETURN QUERY INSERT INTO public.cmms_visitor_qr_locations (cmms_company_id, location_name, host_email, purpose, created_by)
  VALUES (p_cmms_company_id, trim(p_location_name), NULLIF(trim(p_host_email), ''), NULLIF(trim(p_purpose), ''), auth.uid())
  RETURNING cmms_visitor_qr_locations.id, cmms_visitor_qr_locations.location_name, cmms_visitor_qr_locations.token;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_cmms_visitor_qr(p_token TEXT)
RETURNS TABLE (company_name TEXT, location_name TEXT, host_email TEXT, purpose TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT cp.company_name, q.location_name, q.host_email, q.purpose
  FROM public.cmms_visitor_qr_locations q JOIN public.cmms_company_profiles cp ON cp.id = q.cmms_company_id
  WHERE q.token = trim(p_token) AND q.is_active LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.visitor_check_in_with_qr(
  p_token TEXT, p_visitor_name TEXT, p_visitor_email TEXT DEFAULT NULL, p_visitor_phone TEXT DEFAULT NULL,
  p_visitor_origin TEXT DEFAULT NULL, p_host_contact TEXT DEFAULT NULL, p_purpose TEXT DEFAULT NULL,
  p_latitude NUMERIC DEFAULT NULL, p_longitude NUMERIC DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_qr public.cmms_visitor_qr_locations; v_id UUID; v_host public.cmms_users; v_token TEXT;
BEGIN
  IF NULLIF(trim(p_visitor_name), '') IS NULL OR NULLIF(trim(p_visitor_phone), '') IS NULL OR NULLIF(trim(p_host_contact), '') IS NULL THEN
    RAISE EXCEPTION 'Name, phone number, and the person being visited are required';
  END IF;
  SELECT * INTO v_qr FROM public.cmms_visitor_qr_locations WHERE token = trim(p_token) AND is_active FOR UPDATE;
  IF v_qr.id IS NULL THEN RAISE EXCEPTION 'This visitor QR code is invalid or has been deactivated'; END IF;
  SELECT * INTO v_host FROM public.cmms_users WHERE cmms_company_id = v_qr.cmms_company_id AND is_active AND lower(email) = lower(trim(p_host_contact)) LIMIT 1;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  INSERT INTO public.cmms_visitor_checkin (cmms_company_id, visitor_name, visitor_email, visitor_phone, visitor_origin, check_in_location, check_in_latitude, check_in_longitude, location_validated, qr_code_token, host_cmms_user_id, host_name, host_email, purpose, status)
  VALUES (v_qr.cmms_company_id, trim(p_visitor_name), NULLIF(trim(p_visitor_email), ''), trim(p_visitor_phone), NULLIF(trim(p_visitor_origin), ''), v_qr.location_name, p_latitude, p_longitude, TRUE, v_token, v_host.id, COALESCE(v_host.full_name, NULLIF(trim(p_host_contact), '')), CASE WHEN v_host.id IS NULL THEN NULL ELSE v_host.email END, COALESCE(NULLIF(trim(p_purpose), ''), v_qr.purpose), 'checked_in')
  RETURNING id INTO v_id;
  UPDATE public.cmms_visitor_qr_locations SET last_used_at = now() WHERE id = v_qr.id;
  RETURN jsonb_build_object('success', TRUE, 'visitor_id', v_id, 'message', 'Your check-in has been recorded.');
END;
$$;

CREATE OR REPLACE FUNCTION public.visitor_check_out_with_qr(
  p_token TEXT, p_visitor_name TEXT, p_visitor_phone TEXT,
  p_latitude NUMERIC DEFAULT NULL, p_longitude NUMERIC DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_qr public.cmms_visitor_qr_locations; v_visitor public.cmms_visitor_checkin;
BEGIN
  IF NULLIF(trim(p_visitor_name), '') IS NULL OR NULLIF(trim(p_visitor_phone), '') IS NULL THEN
    RAISE EXCEPTION 'Name and phone number are required to check out';
  END IF;
  SELECT * INTO v_qr FROM public.cmms_visitor_qr_locations WHERE token = trim(p_token) AND is_active;
  IF v_qr.id IS NULL THEN RAISE EXCEPTION 'This visitor QR code is invalid or has been deactivated'; END IF;
  SELECT * INTO v_visitor FROM public.cmms_visitor_checkin
   WHERE cmms_company_id = v_qr.cmms_company_id
     AND check_in_location = v_qr.location_name
     AND status = 'checked_in'
     AND lower(visitor_name) = lower(trim(p_visitor_name))
     AND visitor_phone = trim(p_visitor_phone)
   ORDER BY check_in_time DESC LIMIT 1 FOR UPDATE;
  IF v_visitor.id IS NULL THEN RAISE EXCEPTION 'No active check-in was found for that name and phone number at this location'; END IF;
  UPDATE public.cmms_visitor_checkin
     SET check_out_time = now(), check_out_location = v_qr.location_name,
         check_out_latitude = p_latitude, check_out_longitude = p_longitude,
         status = 'checked_out', updated_at = now()
   WHERE id = v_visitor.id;
  UPDATE public.cmms_visitor_qr_locations SET last_used_at = now() WHERE id = v_qr.id;
  RETURN jsonb_build_object('success', TRUE, 'visitor_id', v_visitor.id, 'message', 'Your check-out has been recorded.');
END;
$$;

REVOKE ALL ON FUNCTION public.create_cmms_visitor_qr_location(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_cmms_visitor_qr(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.visitor_check_in_with_qr(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.visitor_check_out_with_qr(TEXT, TEXT, TEXT, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_cmms_visitor_qr_location(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_cmms_visitor_qr(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.visitor_check_in_with_qr(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.visitor_check_out_with_qr(TEXT, TEXT, TEXT, NUMERIC, NUMERIC) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
