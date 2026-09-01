-- ============================================================================
-- CMMS VISITOR MANAGEMENT — VEHICLE NUMBER
-- Run in Supabase SQL Editor any time after CMMS_STAFF_ATTENDANCE_VISITOR_MANAGEMENT.sql.
--
-- Adds an optional vehicle registration number to visitor check-in, both for
-- the in-app "Register Visitor" form (visitor_check_in) and the public,
-- tokenized QR check-in page (visitor_check_in_with_qr). The value is
-- surfaced back out through get_visitor_records() for the admin-only
-- Visitor Records view.
-- ============================================================================

ALTER TABLE public.cmms_visitor_checkin
  ADD COLUMN IF NOT EXISTS vehicle_number TEXT;

-- ------------------------------------------------------------
-- 1. In-app visitor check-in — add p_vehicle_number
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.visitor_check_in(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.visitor_check_in(
  p_cmms_company_id UUID,
  p_visitor_name TEXT,
  p_visitor_email TEXT,
  p_visitor_phone TEXT,
  p_check_in_location TEXT,
  p_latitude NUMERIC DEFAULT NULL,
  p_longitude NUMERIC DEFAULT NULL,
  p_host_email TEXT DEFAULT NULL,
  p_purpose TEXT DEFAULT NULL,
  p_vehicle_number TEXT DEFAULT NULL
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

  SELECT location INTO v_company_location
    FROM public.cmms_company_profiles
   WHERE id = p_cmms_company_id;

  v_location_match := LOWER(TRIM(COALESCE(p_check_in_location, ''))) = LOWER(TRIM(COALESCE(v_company_location, '')));

  IF p_host_email IS NOT NULL THEN
    SELECT cu.id, cu.full_name INTO v_host_user_id, v_host_name
      FROM public.cmms_users cu
     WHERE cu.cmms_company_id = p_cmms_company_id
       AND LOWER(cu.email) = LOWER(p_host_email)
       AND cu.is_active = true
     LIMIT 1;
  END IF;

  v_qr_token := public.generate_attendance_qr_token(NULL, p_cmms_company_id);

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
    vehicle_number,
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
    NULLIF(TRIM(p_vehicle_number), ''),
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

REVOKE ALL ON FUNCTION public.visitor_check_in(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.visitor_check_in(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 2. Public, tokenized QR visitor check-in — add p_vehicle_number
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.visitor_check_in_with_qr(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION public.visitor_check_in_with_qr(
  p_token TEXT, p_visitor_name TEXT, p_visitor_email TEXT DEFAULT NULL, p_visitor_phone TEXT DEFAULT NULL,
  p_visitor_origin TEXT DEFAULT NULL, p_host_contact TEXT DEFAULT NULL, p_purpose TEXT DEFAULT NULL,
  p_latitude NUMERIC DEFAULT NULL, p_longitude NUMERIC DEFAULT NULL, p_vehicle_number TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_qr public.cmms_visitor_qr_locations; v_id UUID; v_host public.cmms_users; v_token TEXT;
BEGIN
  IF NULLIF(trim(p_visitor_name), '') IS NULL OR NULLIF(trim(p_host_contact), '') IS NULL THEN
    RAISE EXCEPTION 'Name and the person being visited are required';
  END IF;
  SELECT * INTO v_qr FROM public.cmms_visitor_qr_locations WHERE token = trim(p_token) AND is_active FOR UPDATE;
  IF v_qr.id IS NULL THEN RAISE EXCEPTION 'This visitor QR code is invalid or has been deactivated'; END IF;
  SELECT * INTO v_host FROM public.cmms_users WHERE cmms_company_id = v_qr.cmms_company_id AND is_active AND lower(email) = lower(trim(p_host_contact)) LIMIT 1;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  INSERT INTO public.cmms_visitor_checkin (cmms_company_id, visitor_name, visitor_email, visitor_phone, visitor_origin, check_in_location, check_in_latitude, check_in_longitude, location_validated, qr_code_token, host_cmms_user_id, host_name, host_email, purpose, vehicle_number, status)
  VALUES (v_qr.cmms_company_id, trim(p_visitor_name), NULLIF(trim(p_visitor_email), ''), NULLIF(trim(p_visitor_phone), ''), NULLIF(trim(p_visitor_origin), ''), v_qr.location_name, p_latitude, p_longitude, TRUE, v_token, v_host.id, COALESCE(v_host.full_name, NULLIF(trim(p_host_contact), '')), CASE WHEN v_host.id IS NULL THEN NULL ELSE v_host.email END, COALESCE(NULLIF(trim(p_purpose), ''), v_qr.purpose), NULLIF(trim(p_vehicle_number), ''), 'checked_in')
  RETURNING id INTO v_id;
  UPDATE public.cmms_visitor_qr_locations SET last_used_at = now() WHERE id = v_qr.id;
  RETURN jsonb_build_object('success', TRUE, 'visitor_id', v_id, 'message', 'Your check-in has been recorded.');
END;
$$;

REVOKE ALL ON FUNCTION public.visitor_check_in_with_qr(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.visitor_check_in_with_qr(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- 3. Admin-only visitor records view — surface vehicle_number
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_visitor_records(UUID, DATE, DATE, TEXT);

CREATE OR REPLACE FUNCTION public.get_visitor_records(
  p_cmms_company_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_status TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID, visitor_name TEXT, visitor_email TEXT, visitor_phone TEXT,
  check_in_time TIMESTAMPTZ, check_out_time TIMESTAMPTZ,
  check_in_location TEXT, location_validated BOOLEAN, host_name TEXT,
  host_email TEXT, purpose TEXT, vehicle_number TEXT, status TEXT,
  flagged_reason TEXT, admin_notes TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.cmms_attendance_qr_admin(p_cmms_company_id) THEN
    RAISE EXCEPTION 'Company administrator access is required to view visitor records';
  END IF;
  RETURN QUERY
  SELECT v.id, v.visitor_name::TEXT, v.visitor_email::TEXT, v.visitor_phone::TEXT,
         v.check_in_time, v.check_out_time, v.check_in_location::TEXT,
         v.location_validated, v.host_name::TEXT, v.host_email::TEXT, v.purpose::TEXT,
         v.vehicle_number::TEXT, v.status::TEXT, v.flagged_reason::TEXT, v.admin_notes::TEXT
    FROM public.cmms_visitor_checkin v
   WHERE v.cmms_company_id = p_cmms_company_id
     AND (p_start_date IS NULL OR v.check_in_time >= p_start_date::TIMESTAMPTZ)
     AND (p_end_date IS NULL OR v.check_in_time < (p_end_date + 1)::TIMESTAMPTZ)
     AND (p_status IS NULL OR v.status = p_status)
   ORDER BY v.check_in_time DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_visitor_records(UUID, DATE, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_visitor_records(UUID, DATE, DATE, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- VERIFY
-- ------------------------------------------------------------
SELECT 'visitor vehicle_number installed' AS status, now() AS run_at;
