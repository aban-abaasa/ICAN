-- ============================================================================
-- CMMS VISITOR MANAGEMENT — VEHICLE APPROVALS, ROTATING APPROVER, SELF-DELETING PHOTO
-- Run in Supabase SQL Editor AFTER CMMS_STAFF_ATTENDANCE_VISITOR_MANAGEMENT.sql,
-- CMMS_VISITOR_VEHICLE_NUMBER.sql and CMMS_VISITOR_RATINGS_AND_STAFF_POINTS.sql.
-- Safe to run more than once.
--
-- WHAT THIS ADDS
--   1. An APPROVER POOL per company (admins pick which staff may approve).
--   2. ROTATION: every approval request goes to the approver who was assigned
--      LEAST RECENTLY (round-robin), so the duty always passes to the next
--      person. When the visit was registered by someone who is also an
--      approver, the next approver in line is used instead whenever there is
--      one, so nobody approves their own entry.
--   3. APPROVAL ON CHECK-IN AND CHECK-OUT for visitors who come with a vehicle
--      (a vehicle number or a vehicle photo). The assigned staff member is
--      notified, and only that person (or a company admin) can decide.
--        status flow:  pending_check_in_approval -> checked_in
--                                                -> check_in_rejected
--                      checked_in -> pending_check_out_approval -> checked_out
--                                                              -> checked_in (exit declined)
--      Approvals are only enforced while the company has at least one active
--      approver. With no approvers, visitors behave exactly as before.
--   4. An optional VEHICLE PHOTO in a private bucket. The file is removed from
--      Supabase Storage once the visit is over (checked out, or entry
--      declined) so storage does not fill up. Deleting goes through the
--      Storage API (a SQL DELETE would leave the file in S3 and still bill
--      for it): the staff app calls get_visitor_photos_to_purge() and then
--      remove()s the files; confirm_visitor_photos_purged() clears the path
--      once the file is really gone. Uploads that never got attached to a
--      visit are swept after one day.
-- ============================================================================

-- ------------------------------------------------------------
-- 0. COLUMNS + PRIVATE BUCKET
-- ------------------------------------------------------------
ALTER TABLE public.cmms_visitor_checkin
  ADD COLUMN IF NOT EXISTS vehicle_photo_path TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_photo_uploaded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_cmms_visitor_vehicle_photo_path
  ON public.cmms_visitor_checkin(vehicle_photo_path)
  WHERE vehicle_photo_path IS NOT NULL;

-- Private bucket. The app shrinks photos to a few hundred KB before upload;
-- 2 MB is a hard ceiling in case something else uploads.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('cmms-visitor-vehicle-photos', 'cmms-visitor-vehicle-photos', FALSE, 2097152,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = FALSE,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ------------------------------------------------------------
-- 1. TABLES (no direct access: everything goes through the RPCs below)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cmms_visitor_approvers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  cmms_user_id UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  -- NULL = never assigned yet, so a newly added approver is next in line.
  last_assigned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cmms_company_id, cmms_user_id)
);

CREATE TABLE IF NOT EXISTS public.cmms_visitor_vehicle_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  visitor_checkin_id UUID NOT NULL REFERENCES public.cmms_visitor_checkin(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('check_in', 'check_out')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  assigned_cmms_user_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  assigned_name TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Where/when the visitor asked to leave; applied to the visit if approved.
  request_location TEXT,
  request_latitude NUMERIC(10, 8),
  request_longitude NUMERIC(11, 8),
  decided_at TIMESTAMPTZ,
  decided_by_cmms_user_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  decided_by_name TEXT,
  decision_note TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cmms_visitor_vehicle_approval_pending
  ON public.cmms_visitor_vehicle_approvals(visitor_checkin_id, stage)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_cmms_visitor_vehicle_approval_assignee
  ON public.cmms_visitor_vehicle_approvals(assigned_cmms_user_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_cmms_visitor_vehicle_approval_company
  ON public.cmms_visitor_vehicle_approvals(cmms_company_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_cmms_visitor_vehicle_approval_visit
  ON public.cmms_visitor_vehicle_approvals(visitor_checkin_id);

ALTER TABLE public.cmms_visitor_approvers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_visitor_vehicle_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cmms_visitor_approvers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cmms_visitor_vehicle_approvals FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2. INTERNAL HELPERS (not callable from the API)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cmms_visitor_current_staff_id(p_company_id UUID)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT cu.id
    FROM public.cmms_users cu
   WHERE auth.uid() IS NOT NULL
     AND cu.cmms_company_id = p_company_id
     AND cu.is_active
     AND lower(cu.email) = lower(auth.jwt() ->> 'email')
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.cmms_visitor_approval_active(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.cmms_visitor_approvers a
      JOIN public.cmms_users cu ON cu.id = a.cmms_user_id AND cu.is_active
     WHERE a.cmms_company_id = p_company_id AND a.is_active
  );
$$;

-- Round-robin: the active approver assigned LEAST recently goes next (never
-- assigned = first). The row is locked while picking, and SKIP LOCKED makes two
-- simultaneous requests land on two different people instead of the same one.
CREATE OR REPLACE FUNCTION public.cmms_pick_visitor_approver(
  p_company_id UUID,
  p_exclude_cmms_user_id UUID DEFAULT NULL
)
RETURNS TABLE (approver_user_id UUID, approver_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT a.cmms_user_id INTO v_id
    FROM public.cmms_visitor_approvers a
    JOIN public.cmms_users cu ON cu.id = a.cmms_user_id AND cu.is_active
   WHERE a.cmms_company_id = p_company_id AND a.is_active
   ORDER BY COALESCE(a.cmms_user_id = p_exclude_cmms_user_id, FALSE),
            a.last_assigned_at NULLS FIRST, a.created_at, a.id
   LIMIT 1
   FOR UPDATE OF a SKIP LOCKED;

  IF v_id IS NULL THEN
    -- Everyone eligible was locked by concurrent requests: wait for the best one.
    SELECT a.cmms_user_id INTO v_id
      FROM public.cmms_visitor_approvers a
      JOIN public.cmms_users cu ON cu.id = a.cmms_user_id AND cu.is_active
     WHERE a.cmms_company_id = p_company_id AND a.is_active
     ORDER BY COALESCE(a.cmms_user_id = p_exclude_cmms_user_id, FALSE),
              a.last_assigned_at NULLS FIRST, a.created_at, a.id
     LIMIT 1
     FOR UPDATE OF a;
  END IF;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.cmms_visitor_approvers a
     SET last_assigned_at = clock_timestamp()
   WHERE a.cmms_company_id = p_company_id AND a.cmms_user_id = v_id;

  RETURN QUERY
  SELECT cu.id, COALESCE(NULLIF(cu.full_name, ''), cu.user_name)::TEXT
    FROM public.cmms_users cu
   WHERE cu.id = v_id;
END;
$$;

-- Tells the assigned approver (this table already fires the phone push
-- trigger on INSERT). Never lets a notification problem block the gate.
CREATE OR REPLACE FUNCTION public.cmms_notify_visitor_approver(p_approval_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row public.cmms_visitor_vehicle_approvals;
  v_visit public.cmms_visitor_checkin;
BEGIN
  SELECT * INTO v_row FROM public.cmms_visitor_vehicle_approvals WHERE id = p_approval_id;
  IF v_row.id IS NULL OR v_row.assigned_cmms_user_id IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO v_visit FROM public.cmms_visitor_checkin WHERE id = v_row.visitor_checkin_id;

  BEGIN
    INSERT INTO public.cmms_notifications (
      cmms_user_id, cmms_company_id, notification_type, title, message, icon, action_tab
    ) VALUES (
      v_row.assigned_cmms_user_id,
      v_row.cmms_company_id,
      'visitor_vehicle_approval',
      CASE WHEN v_row.stage = 'check_in' THEN 'Approve vehicle entry' ELSE 'Approve vehicle exit' END,
      v_visit.visitor_name || COALESCE(' · ' || v_visit.vehicle_number, '') || ' is waiting for your approval',
      '🚗',
      'visitor-mgmt'
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.cmms_open_visitor_vehicle_approval(
  p_visitor_id UUID,
  p_stage TEXT,
  p_exclude_cmms_user_id UUID DEFAULT NULL,
  p_location TEXT DEFAULT NULL,
  p_latitude NUMERIC DEFAULT NULL,
  p_longitude NUMERIC DEFAULT NULL
)
RETURNS public.cmms_visitor_vehicle_approvals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_visit public.cmms_visitor_checkin;
  v_pick RECORD;
  v_row public.cmms_visitor_vehicle_approvals;
BEGIN
  SELECT * INTO v_visit FROM public.cmms_visitor_checkin WHERE id = p_visitor_id;
  IF v_visit.id IS NULL THEN
    RAISE EXCEPTION 'Visitor record not found';
  END IF;

  SELECT * INTO v_pick FROM public.cmms_pick_visitor_approver(v_visit.cmms_company_id, p_exclude_cmms_user_id);

  INSERT INTO public.cmms_visitor_vehicle_approvals (
    cmms_company_id, visitor_checkin_id, stage, assigned_cmms_user_id, assigned_name,
    request_location, request_latitude, request_longitude
  ) VALUES (
    v_visit.cmms_company_id, v_visit.id, p_stage, v_pick.approver_user_id, v_pick.approver_name,
    p_location, p_latitude, p_longitude
  )
  RETURNING * INTO v_row;

  PERFORM public.cmms_notify_visitor_approver(v_row.id);
  RETURN v_row;
END;
$$;

-- Shape of an object name this feature accepts: <folder>/<uuid>.<ext> where the
-- folder is a company id (staff upload) or a visitor-QR token (public upload).
CREATE OR REPLACE FUNCTION public.cmms_visitor_photo_name_ok(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
AS $$
  SELECT COALESCE(
    p_name ~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{48})/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$',
    FALSE
  );
$$;

REVOKE ALL ON FUNCTION public.cmms_visitor_current_staff_id(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cmms_visitor_approval_active(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cmms_pick_visitor_approver(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cmms_notify_visitor_approver(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cmms_open_visitor_vehicle_approval(UUID, TEXT, UUID, TEXT, NUMERIC, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_visitor_photo_name_ok(TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- 3. APPROVER POOL (company admins)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_visitor_approvers(UUID);
CREATE OR REPLACE FUNCTION public.get_visitor_approvers(p_cmms_company_id UUID)
RETURNS TABLE (
  cmms_user_id UUID, user_name TEXT, email TEXT, is_approver BOOLEAN,
  last_assigned_at TIMESTAMPTZ, pending_count BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.cmms_attendance_qr_admin(p_cmms_company_id) THEN
    RAISE EXCEPTION 'Company administrator access is required to manage visitor approvers';
  END IF;

  RETURN QUERY
  SELECT cu.id,
         COALESCE(NULLIF(cu.full_name, ''), cu.user_name)::TEXT,
         cu.email::TEXT,
         COALESCE(a.is_active, FALSE),
         a.last_assigned_at,
         (SELECT COUNT(*) FROM public.cmms_visitor_vehicle_approvals p
           WHERE p.assigned_cmms_user_id = cu.id AND p.status = 'pending')
    FROM public.cmms_users cu
    LEFT JOIN public.cmms_visitor_approvers a
           ON a.cmms_user_id = cu.id AND a.cmms_company_id = cu.cmms_company_id
   WHERE cu.cmms_company_id = p_cmms_company_id AND cu.is_active
   ORDER BY COALESCE(a.is_active, FALSE) DESC,
            COALESCE(NULLIF(cu.full_name, ''), cu.user_name);
END;
$$;

DROP FUNCTION IF EXISTS public.set_visitor_approver(UUID, UUID, BOOLEAN);
CREATE OR REPLACE FUNCTION public.set_visitor_approver(
  p_cmms_company_id UUID,
  p_cmms_user_id UUID,
  p_is_approver BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_pick RECORD;
  v_active INT;
BEGIN
  IF NOT public.cmms_attendance_qr_admin(p_cmms_company_id) THEN
    RAISE EXCEPTION 'Company administrator access is required to manage visitor approvers';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cmms_users cu
     WHERE cu.id = p_cmms_user_id AND cu.cmms_company_id = p_cmms_company_id AND cu.is_active
  ) THEN
    RAISE EXCEPTION 'That person is not an active member of this company';
  END IF;

  IF p_is_approver THEN
    INSERT INTO public.cmms_visitor_approvers (cmms_company_id, cmms_user_id, is_active)
    VALUES (p_cmms_company_id, p_cmms_user_id, TRUE)
    ON CONFLICT (cmms_company_id, cmms_user_id) DO UPDATE SET is_active = TRUE;
  ELSE
    UPDATE public.cmms_visitor_approvers a
       SET is_active = FALSE
     WHERE a.cmms_company_id = p_cmms_company_id AND a.cmms_user_id = p_cmms_user_id;

    -- Hand their open requests to whoever is next, so nothing waits on someone
    -- who no longer approves. With no approver left they stay open for an admin.
    FOR v_row IN
      SELECT p.id FROM public.cmms_visitor_vehicle_approvals p
       WHERE p.cmms_company_id = p_cmms_company_id
         AND p.assigned_cmms_user_id = p_cmms_user_id
         AND p.status = 'pending'
       ORDER BY p.requested_at
       FOR UPDATE
    LOOP
      SELECT * INTO v_pick FROM public.cmms_pick_visitor_approver(p_cmms_company_id, NULL);
      UPDATE public.cmms_visitor_vehicle_approvals p
         SET assigned_cmms_user_id = v_pick.approver_user_id,
             assigned_name = v_pick.approver_name
       WHERE p.id = v_row.id;
      PERFORM public.cmms_notify_visitor_approver(v_row.id);
    END LOOP;
  END IF;

  SELECT COUNT(*) INTO v_active
    FROM public.cmms_visitor_approvers a
    JOIN public.cmms_users cu ON cu.id = a.cmms_user_id AND cu.is_active
   WHERE a.cmms_company_id = p_cmms_company_id AND a.is_active;

  RETURN jsonb_build_object('success', TRUE, 'active_approvers', v_active, 'approvals_enforced', v_active > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_visitor_approvers(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_visitor_approver(UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_visitor_approvers(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_visitor_approver(UUID, UUID, BOOLEAN) TO authenticated;

-- ------------------------------------------------------------
-- 4. CHECK-IN (staff app) — optional photo; vehicle visits wait for approval
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.visitor_check_in(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.visitor_check_in(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT);

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
  p_vehicle_number TEXT DEFAULT NULL,
  p_vehicle_photo_path TEXT DEFAULT NULL
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
  v_vehicle TEXT;
  v_photo TEXT;
  v_needs_approval BOOLEAN;
  v_status TEXT;
  v_approval public.cmms_visitor_vehicle_approvals;
BEGIN
  IF p_visitor_name IS NULL OR TRIM(p_visitor_name) = '' THEN
    RAISE EXCEPTION 'Visitor name is required';
  END IF;

  IF p_check_in_location IS NULL OR TRIM(p_check_in_location) = '' THEN
    RAISE EXCEPTION 'Check-in location is required';
  END IF;

  v_vehicle := NULLIF(TRIM(p_vehicle_number), '');
  v_photo := NULLIF(TRIM(p_vehicle_photo_path), '');
  IF v_photo IS NOT NULL AND NOT (
    public.cmms_visitor_photo_name_ok(v_photo)
    AND split_part(v_photo, '/', 1) = p_cmms_company_id::TEXT
  ) THEN
    RAISE EXCEPTION 'The vehicle photo is not valid for this company';
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

  v_needs_approval := (v_vehicle IS NOT NULL OR v_photo IS NOT NULL)
                      AND public.cmms_visitor_approval_active(p_cmms_company_id);
  v_status := CASE WHEN v_needs_approval THEN 'pending_check_in_approval' ELSE 'checked_in' END;

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
    vehicle_photo_path,
    vehicle_photo_uploaded_at,
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
    v_vehicle,
    v_photo,
    CASE WHEN v_photo IS NULL THEN NULL ELSE now() END,
    v_status
  )
  RETURNING id INTO v_visitor_id;

  IF v_needs_approval THEN
    -- The person registering the visit is skipped while another approver exists.
    v_approval := public.cmms_open_visitor_vehicle_approval(
      v_visitor_id, 'check_in', public.cmms_visitor_current_staff_id(p_cmms_company_id)
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'visitor_id', v_visitor_id,
    'qr_token', v_qr_token,
    'check_in_time', now(),
    'location_validated', v_location_match,
    'status', v_status,
    'approval_required', v_needs_approval,
    'approval_id', v_approval.id,
    'approver_name', v_approval.assigned_name,
    'message', CASE WHEN v_needs_approval
                    THEN 'Visitor registered. Entry is waiting for approval.'
                    ELSE 'Visitor registered successfully' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.visitor_check_in(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visitor_check_in(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 5. CHECK-IN (public visitor QR) — same rules, photo tied to the QR token
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.visitor_check_in_with_qr(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC);
DROP FUNCTION IF EXISTS public.visitor_check_in_with_qr(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION public.visitor_check_in_with_qr(
  p_token TEXT, p_visitor_name TEXT, p_visitor_email TEXT DEFAULT NULL, p_visitor_phone TEXT DEFAULT NULL,
  p_visitor_origin TEXT DEFAULT NULL, p_host_contact TEXT DEFAULT NULL, p_purpose TEXT DEFAULT NULL,
  p_latitude NUMERIC DEFAULT NULL, p_longitude NUMERIC DEFAULT NULL, p_vehicle_number TEXT DEFAULT NULL,
  p_vehicle_photo_path TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_qr public.cmms_visitor_qr_locations; v_id UUID; v_host public.cmms_users; v_token TEXT;
  v_vehicle TEXT; v_photo TEXT; v_needs_approval BOOLEAN; v_status TEXT;
  v_approval public.cmms_visitor_vehicle_approvals;
BEGIN
  IF NULLIF(trim(p_visitor_name), '') IS NULL OR NULLIF(trim(p_host_contact), '') IS NULL THEN
    RAISE EXCEPTION 'Name and the person being visited are required';
  END IF;
  SELECT * INTO v_qr FROM public.cmms_visitor_qr_locations WHERE token = trim(p_token) AND is_active FOR UPDATE;
  IF v_qr.id IS NULL THEN RAISE EXCEPTION 'This visitor QR code is invalid or has been deactivated'; END IF;

  v_vehicle := NULLIF(trim(p_vehicle_number), '');
  v_photo := NULLIF(trim(p_vehicle_photo_path), '');
  IF v_photo IS NOT NULL AND NOT (
    public.cmms_visitor_photo_name_ok(v_photo) AND split_part(v_photo, '/', 1) = v_qr.token
  ) THEN
    RAISE EXCEPTION 'The vehicle photo is not valid for this check-in';
  END IF;

  SELECT * INTO v_host FROM public.cmms_users WHERE cmms_company_id = v_qr.cmms_company_id AND is_active AND lower(email) = lower(trim(p_host_contact)) LIMIT 1;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  v_needs_approval := (v_vehicle IS NOT NULL OR v_photo IS NOT NULL)
                      AND public.cmms_visitor_approval_active(v_qr.cmms_company_id);
  v_status := CASE WHEN v_needs_approval THEN 'pending_check_in_approval' ELSE 'checked_in' END;

  INSERT INTO public.cmms_visitor_checkin (cmms_company_id, visitor_name, visitor_email, visitor_phone, visitor_origin, check_in_location, check_in_latitude, check_in_longitude, location_validated, qr_code_token, host_cmms_user_id, host_name, host_email, purpose, vehicle_number, vehicle_photo_path, vehicle_photo_uploaded_at, status)
  VALUES (v_qr.cmms_company_id, trim(p_visitor_name), NULLIF(trim(p_visitor_email), ''), NULLIF(trim(p_visitor_phone), ''), NULLIF(trim(p_visitor_origin), ''), v_qr.location_name, p_latitude, p_longitude, TRUE, v_token, v_host.id, COALESCE(v_host.full_name, NULLIF(trim(p_host_contact), '')), CASE WHEN v_host.id IS NULL THEN NULL ELSE v_host.email END, COALESCE(NULLIF(trim(p_purpose), ''), v_qr.purpose), v_vehicle, v_photo, CASE WHEN v_photo IS NULL THEN NULL ELSE now() END, v_status)
  RETURNING id INTO v_id;
  UPDATE public.cmms_visitor_qr_locations SET last_used_at = now() WHERE id = v_qr.id;

  IF v_needs_approval THEN
    v_approval := public.cmms_open_visitor_vehicle_approval(v_id, 'check_in');
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE, 'visitor_id', v_id,
    'status', v_status,
    'approval_required', v_needs_approval,
    'approver_name', v_approval.assigned_name,
    'message', CASE WHEN v_needs_approval
                    THEN 'Your check-in was received and is waiting for approval.'
                    ELSE 'Your check-in has been recorded.' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.visitor_check_in_with_qr(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.visitor_check_in_with_qr(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- 6. CHECK-OUT (staff app and public QR) — vehicle visits ask for approval
-- ------------------------------------------------------------
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
  v_approval public.cmms_visitor_vehicle_approvals;
BEGIN
  SELECT * INTO v_visitor
    FROM public.cmms_visitor_checkin
   WHERE id = p_visitor_id
   FOR UPDATE;

  IF v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'Visitor record not found';
  END IF;

  IF v_visitor.status = 'pending_check_in_approval' THEN
    RAISE EXCEPTION 'This visitor''s entry is still waiting for approval';
  ELSIF v_visitor.status = 'check_in_rejected' THEN
    RAISE EXCEPTION 'This visitor was not admitted';
  ELSIF v_visitor.status = 'pending_check_out_approval' THEN
    RAISE EXCEPTION 'An exit approval is already waiting for this visitor';
  END IF;

  IF v_visitor.status = 'checked_in'
     AND (v_visitor.vehicle_number IS NOT NULL OR v_visitor.vehicle_photo_path IS NOT NULL)
     AND public.cmms_visitor_approval_active(v_visitor.cmms_company_id) THEN
    v_approval := public.cmms_open_visitor_vehicle_approval(
      v_visitor.id, 'check_out',
      public.cmms_visitor_current_staff_id(v_visitor.cmms_company_id),
      COALESCE(p_location, v_visitor.check_in_location)
    );
    UPDATE public.cmms_visitor_checkin
       SET status = 'pending_check_out_approval', updated_at = now()
     WHERE id = v_visitor.id;

    RETURN jsonb_build_object(
      'success', true,
      'visitor_id', p_visitor_id,
      'pending_approval', true,
      'approval_id', v_approval.id,
      'approver_name', v_approval.assigned_name,
      'message', 'Exit sent for approval'
    );
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

REVOKE ALL ON FUNCTION public.visitor_check_out(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visitor_check_out(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.visitor_check_out_with_qr(
  p_token TEXT, p_visitor_name TEXT, p_visitor_phone TEXT DEFAULT NULL,
  p_latitude NUMERIC DEFAULT NULL, p_longitude NUMERIC DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_qr public.cmms_visitor_qr_locations;
  v_visitor public.cmms_visitor_checkin;
  v_approval public.cmms_visitor_vehicle_approvals;
BEGIN
  IF NULLIF(trim(p_visitor_name), '') IS NULL THEN
    RAISE EXCEPTION 'Name is required to check out';
  END IF;
  SELECT * INTO v_qr FROM public.cmms_visitor_qr_locations WHERE token = trim(p_token) AND is_active;
  IF v_qr.id IS NULL THEN RAISE EXCEPTION 'This visitor QR code is invalid or has been deactivated'; END IF;

  SELECT * INTO v_visitor FROM public.cmms_visitor_checkin
   WHERE cmms_company_id = v_qr.cmms_company_id
     AND check_in_location = v_qr.location_name
     AND status IN ('checked_in', 'pending_check_out_approval')
     AND lower(visitor_name) = lower(trim(p_visitor_name))
     AND (NULLIF(trim(p_visitor_phone), '') IS NULL OR visitor_phone = trim(p_visitor_phone))
   ORDER BY check_in_time DESC LIMIT 1 FOR UPDATE;

  IF v_visitor.id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.cmms_visitor_checkin
       WHERE cmms_company_id = v_qr.cmms_company_id
         AND check_in_location = v_qr.location_name
         AND status = 'pending_check_in_approval'
         AND lower(visitor_name) = lower(trim(p_visitor_name))
         AND (NULLIF(trim(p_visitor_phone), '') IS NULL OR visitor_phone = trim(p_visitor_phone))
    ) THEN
      RAISE EXCEPTION 'Your check-in is still waiting for approval, so you cannot check out yet';
    END IF;
    RAISE EXCEPTION 'No active check-in was found for that name and phone number at this location';
  END IF;

  IF v_visitor.status = 'pending_check_out_approval' THEN
    SELECT * INTO v_approval FROM public.cmms_visitor_vehicle_approvals
     WHERE visitor_checkin_id = v_visitor.id AND stage = 'check_out' AND status = 'pending'
     ORDER BY requested_at DESC LIMIT 1;
    RETURN jsonb_build_object(
      'success', TRUE, 'visitor_id', v_visitor.id, 'pending_approval', TRUE,
      'approver_name', v_approval.assigned_name,
      'message', 'Your exit request is already waiting for approval.'
    );
  END IF;

  IF (v_visitor.vehicle_number IS NOT NULL OR v_visitor.vehicle_photo_path IS NOT NULL)
     AND public.cmms_visitor_approval_active(v_visitor.cmms_company_id) THEN
    v_approval := public.cmms_open_visitor_vehicle_approval(
      v_visitor.id, 'check_out', NULL, v_qr.location_name, p_latitude, p_longitude
    );
    UPDATE public.cmms_visitor_checkin
       SET status = 'pending_check_out_approval', updated_at = now()
     WHERE id = v_visitor.id;
    UPDATE public.cmms_visitor_qr_locations SET last_used_at = now() WHERE id = v_qr.id;
    RETURN jsonb_build_object(
      'success', TRUE, 'visitor_id', v_visitor.id, 'pending_approval', TRUE,
      'approver_name', v_approval.assigned_name,
      'message', 'Your exit request was sent for approval.'
    );
  END IF;

  UPDATE public.cmms_visitor_checkin
     SET check_out_time = now(), check_out_location = v_qr.location_name,
         check_out_latitude = p_latitude, check_out_longitude = p_longitude,
         status = 'checked_out', updated_at = now()
   WHERE id = v_visitor.id;
  UPDATE public.cmms_visitor_qr_locations SET last_used_at = now() WHERE id = v_qr.id;
  RETURN jsonb_build_object('success', TRUE, 'visitor_id', v_visitor.id, 'message', 'Your check-out has been recorded.');
END;
$$;

REVOKE ALL ON FUNCTION public.visitor_check_out_with_qr(TEXT, TEXT, TEXT, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.visitor_check_out_with_qr(TEXT, TEXT, TEXT, NUMERIC, NUMERIC) TO anon, authenticated;

-- ------------------------------------------------------------
-- 7. DECIDING, THE APPROVER'S QUEUE, AND THE VISITOR'S OWN STATUS
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decide_visitor_vehicle_approval(
  p_approval_id UUID,
  p_approve BOOLEAN,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_appr public.cmms_visitor_vehicle_approvals;
  v_visit public.cmms_visitor_checkin;
  v_staff UUID;
  v_staff_name TEXT;
  v_note TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  SELECT * INTO v_appr FROM public.cmms_visitor_vehicle_approvals WHERE id = p_approval_id FOR UPDATE;
  IF v_appr.id IS NULL THEN
    RAISE EXCEPTION 'Approval request not found';
  END IF;
  IF v_appr.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been decided';
  END IF;

  v_staff := public.cmms_visitor_current_staff_id(v_appr.cmms_company_id);
  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'Only active staff of this company can decide visitor approvals';
  END IF;
  -- The assigned approver decides; a company admin can step in (absent approver).
  IF v_appr.assigned_cmms_user_id IS DISTINCT FROM v_staff
     AND NOT public.cmms_attendance_qr_admin(v_appr.cmms_company_id) THEN
    RAISE EXCEPTION 'This approval is assigned to %', COALESCE(v_appr.assigned_name, 'another staff member');
  END IF;

  v_note := NULLIF(trim(p_note), '');
  IF NOT p_approve AND v_note IS NULL THEN
    RAISE EXCEPTION 'Please give a reason for declining';
  END IF;

  SELECT COALESCE(NULLIF(cu.full_name, ''), cu.user_name) INTO v_staff_name
    FROM public.cmms_users cu WHERE cu.id = v_staff;

  SELECT * INTO v_visit FROM public.cmms_visitor_checkin WHERE id = v_appr.visitor_checkin_id FOR UPDATE;

  UPDATE public.cmms_visitor_vehicle_approvals
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         decided_at = now(),
         decided_by_cmms_user_id = v_staff,
         decided_by_name = v_staff_name,
         decision_note = v_note
   WHERE id = v_appr.id;

  -- Only move the visit if it is still in the state this request was about
  -- (an admin may have flagged or closed it in the meantime).
  IF v_appr.stage = 'check_in' AND v_visit.status = 'pending_check_in_approval' THEN
    UPDATE public.cmms_visitor_checkin
       SET status = CASE WHEN p_approve THEN 'checked_in' ELSE 'check_in_rejected' END,
           updated_at = now()
     WHERE id = v_visit.id;
  ELSIF v_appr.stage = 'check_out' AND v_visit.status = 'pending_check_out_approval' THEN
    IF p_approve THEN
      UPDATE public.cmms_visitor_checkin
         SET check_out_time = now(),
             check_out_location = COALESCE(v_appr.request_location, check_in_location),
             check_out_latitude = v_appr.request_latitude,
             check_out_longitude = v_appr.request_longitude,
             status = 'checked_out',
             updated_at = now()
       WHERE id = v_visit.id;
    ELSE
      UPDATE public.cmms_visitor_checkin
         SET status = 'checked_in', updated_at = now()
       WHERE id = v_visit.id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'visitor_id', v_visit.id,
    'stage', v_appr.stage,
    'decision', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    -- The visit is over, so its photo can now be deleted from Storage.
    'purge_photo', v_visit.vehicle_photo_path IS NOT NULL AND (
      (v_appr.stage = 'check_out' AND p_approve) OR (v_appr.stage = 'check_in' AND NOT p_approve)
    )
  );
END;
$$;

DROP FUNCTION IF EXISTS public.get_visitor_vehicle_approvals(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.get_visitor_vehicle_approvals(
  p_cmms_company_id UUID,
  p_view TEXT DEFAULT 'pending'
)
RETURNS TABLE (
  approval_id UUID, stage TEXT, status TEXT, requested_at TIMESTAMPTZ,
  assigned_cmms_user_id UUID, assigned_name TEXT, assigned_to_me BOOLEAN,
  decided_at TIMESTAMPTZ, decided_by_name TEXT, decision_note TEXT,
  visitor_id UUID, visitor_name TEXT, visitor_phone TEXT, vehicle_number TEXT,
  host_name TEXT, purpose TEXT, check_in_location TEXT, check_in_time TIMESTAMPTZ,
  vehicle_photo_path TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_staff UUID;
  v_admin BOOLEAN;
BEGIN
  v_staff := public.cmms_visitor_current_staff_id(p_cmms_company_id);
  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'Only active staff of this company can view visitor approvals';
  END IF;
  v_admin := public.cmms_attendance_qr_admin(p_cmms_company_id);

  -- An approver sees what is assigned to them (and what they decided); admins see all.
  RETURN QUERY
  SELECT a.id, a.stage::TEXT, a.status::TEXT, a.requested_at,
         a.assigned_cmms_user_id, a.assigned_name::TEXT,
         COALESCE(a.assigned_cmms_user_id = v_staff, FALSE),
         a.decided_at, a.decided_by_name::TEXT, a.decision_note::TEXT,
         v.id, v.visitor_name::TEXT, v.visitor_phone::TEXT, v.vehicle_number::TEXT,
         v.host_name::TEXT, v.purpose::TEXT, v.check_in_location::TEXT, v.check_in_time,
         v.vehicle_photo_path::TEXT
    FROM public.cmms_visitor_vehicle_approvals a
    JOIN public.cmms_visitor_checkin v ON v.id = a.visitor_checkin_id
   WHERE a.cmms_company_id = p_cmms_company_id
     AND ((p_view = 'decided' AND a.status <> 'pending') OR (p_view <> 'decided' AND a.status = 'pending'))
     AND (v_admin OR a.assigned_cmms_user_id = v_staff OR a.decided_by_cmms_user_id = v_staff)
   ORDER BY (CASE WHEN p_view = 'decided' THEN a.decided_at END) DESC NULLS LAST, a.requested_at ASC
   LIMIT 100;
END;
$$;

-- What the visitor sees while they wait. The visit id is an unguessable UUID that
-- only the visitor's own check-in/out response contains (same idea as the rating).
CREATE OR REPLACE FUNCTION public.get_visitor_visit_status(p_visitor_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_visit public.cmms_visitor_checkin;
  v_in public.cmms_visitor_vehicle_approvals;
  v_out public.cmms_visitor_vehicle_approvals;
BEGIN
  SELECT * INTO v_visit FROM public.cmms_visitor_checkin WHERE id = p_visitor_id;
  IF v_visit.id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_in FROM public.cmms_visitor_vehicle_approvals
   WHERE visitor_checkin_id = v_visit.id AND stage = 'check_in' ORDER BY requested_at DESC LIMIT 1;
  SELECT * INTO v_out FROM public.cmms_visitor_vehicle_approvals
   WHERE visitor_checkin_id = v_visit.id AND stage = 'check_out' ORDER BY requested_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'status', v_visit.status,
    'check_in_approval', CASE WHEN v_in.id IS NULL THEN NULL ELSE jsonb_build_object(
      'status', v_in.status, 'approver_name', v_in.assigned_name, 'note', v_in.decision_note) END,
    'check_out_approval', CASE WHEN v_out.id IS NULL THEN NULL ELSE jsonb_build_object(
      'status', v_out.status, 'approver_name', v_out.assigned_name, 'note', v_out.decision_note) END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.decide_visitor_vehicle_approval(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_visitor_vehicle_approvals(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_visitor_visit_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_visitor_vehicle_approval(UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_visitor_vehicle_approvals(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_visitor_visit_status(UUID) TO anon, authenticated;

-- ------------------------------------------------------------
-- 8. ADMIN VISITOR RECORDS — now also shows photo path + pending approval
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
  flagged_reason TEXT, admin_notes TEXT,
  vehicle_photo_path TEXT, pending_approval_id UUID,
  pending_approval_stage TEXT, pending_approver_name TEXT
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
         v.vehicle_number::TEXT, v.status::TEXT, v.flagged_reason::TEXT, v.admin_notes::TEXT,
         v.vehicle_photo_path::TEXT, pa.id, pa.stage::TEXT, pa.assigned_name::TEXT
    FROM public.cmms_visitor_checkin v
    LEFT JOIN LATERAL (
      SELECT a.id, a.stage, a.assigned_name
        FROM public.cmms_visitor_vehicle_approvals a
       WHERE a.visitor_checkin_id = v.id AND a.status = 'pending'
       ORDER BY a.requested_at DESC
       LIMIT 1
    ) pa ON TRUE
   WHERE v.cmms_company_id = p_cmms_company_id
     AND (p_start_date IS NULL OR v.check_in_time >= p_start_date::TIMESTAMPTZ)
     AND (p_end_date IS NULL OR v.check_in_time < (p_end_date + 1)::TIMESTAMPTZ)
     AND (p_status IS NULL OR v.status = p_status)
   ORDER BY v.check_in_time DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_visitor_records(UUID, DATE, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_visitor_records(UUID, DATE, DATE, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 9. PHOTO CLEAN-UP + STORAGE POLICIES
-- A photo may be deleted once its visit is over (checked out, or entry
-- declined), or when it was never attached to a visit and is a day old.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cmms_visitor_photo_owner_company(p_name TEXT)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT v.cmms_company_id FROM public.cmms_visitor_checkin v WHERE v.vehicle_photo_path = p_name LIMIT 1),
    (SELECT q.cmms_company_id FROM public.cmms_visitor_qr_locations q WHERE q.token = split_part(p_name, '/', 1) LIMIT 1),
    (SELECT cp.id FROM public.cmms_company_profiles cp
      WHERE split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND cp.id::TEXT = split_part(p_name, '/', 1))
  );
$$;

-- INSERT policy helper. Staff upload into <company id>/…; a visitor on the public
-- page uploads into <their active QR token>/…. Nothing else is accepted.
CREATE OR REPLACE FUNCTION public.cmms_visitor_photo_can_upload(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_folder TEXT := split_part(p_name, '/', 1);
BEGIN
  IF NOT public.cmms_visitor_photo_name_ok(p_name) THEN
    RETURN FALSE;
  END IF;
  IF length(v_folder) = 36 THEN
    RETURN public.cmms_visitor_current_staff_id(v_folder::UUID) IS NOT NULL;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.cmms_visitor_qr_locations q WHERE q.token = v_folder AND q.is_active
  );
END;
$$;

-- SELECT policy helper (viewing / signed URLs): a company admin, or the staff
-- member a request for this visit was assigned to. Visitor records are
-- manager-only, so the photo follows the same rule.
CREATE OR REPLACE FUNCTION public.cmms_visitor_photo_can_view(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.cmms_visitor_checkin v
     WHERE v.vehicle_photo_path = p_name
       AND (
         public.cmms_attendance_qr_admin(v.cmms_company_id)
         OR EXISTS (
           SELECT 1
             FROM public.cmms_visitor_vehicle_approvals a
             JOIN public.cmms_users cu ON cu.id = a.assigned_cmms_user_id AND cu.is_active
            WHERE a.visitor_checkin_id = v.id
              AND auth.uid() IS NOT NULL
              AND lower(cu.email) = lower(auth.jwt() ->> 'email')
         )
       )
  );
$$;

-- DELETE (and the SELECT that Storage needs in order to delete) policy helper.
CREATE OR REPLACE FUNCTION public.cmms_visitor_photo_can_purge(p_name TEXT, p_created_at TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company UUID;
  v_status TEXT;
BEGIN
  SELECT v.cmms_company_id, v.status INTO v_company, v_status
    FROM public.cmms_visitor_checkin v
   WHERE v.vehicle_photo_path = p_name
   LIMIT 1;

  IF v_company IS NOT NULL THEN
    RETURN v_status IN ('checked_out', 'check_in_rejected')
       AND public.cmms_visitor_current_staff_id(v_company) IS NOT NULL;
  END IF;

  -- Not attached to any visit: only once it is clearly abandoned.
  IF p_created_at IS NULL OR p_created_at > now() - INTERVAL '1 day' THEN
    RETURN FALSE;
  END IF;
  v_company := public.cmms_visitor_photo_owner_company(p_name);
  RETURN v_company IS NOT NULL AND public.cmms_visitor_current_staff_id(v_company) IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_visitor_photo_owner_company(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cmms_visitor_photo_can_upload(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_visitor_photo_can_view(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cmms_visitor_photo_can_purge(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
-- Policy expressions run as the calling role, so these must be executable by it.
GRANT EXECUTE ON FUNCTION public.cmms_visitor_photo_can_upload(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_visitor_photo_can_view(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_visitor_photo_can_purge(TEXT, TIMESTAMPTZ) TO authenticated;

DROP POLICY IF EXISTS "cmms_visitor_vehicle_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "cmms_visitor_vehicle_photos_select" ON storage.objects;
DROP POLICY IF EXISTS "cmms_visitor_vehicle_photos_delete" ON storage.objects;

CREATE POLICY "cmms_visitor_vehicle_photos_insert" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'cmms-visitor-vehicle-photos'
    AND public.cmms_visitor_photo_can_upload(name)
  );

CREATE POLICY "cmms_visitor_vehicle_photos_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'cmms-visitor-vehicle-photos'
    AND (public.cmms_visitor_photo_can_view(name) OR public.cmms_visitor_photo_can_purge(name, created_at))
  );

CREATE POLICY "cmms_visitor_vehicle_photos_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'cmms-visitor-vehicle-photos'
    AND public.cmms_visitor_photo_can_purge(name, created_at)
  );

-- The list the cleaner works from. Staff pass their company; the server-side
-- sweep (service role) may pass NULL to cover every company.
DROP FUNCTION IF EXISTS public.get_visitor_photos_to_purge(UUID);
CREATE OR REPLACE FUNCTION public.get_visitor_photos_to_purge(p_cmms_company_id UUID DEFAULT NULL)
RETURNS TABLE (storage_path TEXT, reason TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_service BOOLEAN := COALESCE(auth.jwt() ->> 'role', '') = 'service_role';
BEGIN
  IF NOT v_service AND (
    p_cmms_company_id IS NULL OR public.cmms_visitor_current_staff_id(p_cmms_company_id) IS NULL
  ) THEN
    RAISE EXCEPTION 'Only active staff of this company can clean up visitor photos';
  END IF;

  RETURN QUERY
  SELECT v.vehicle_photo_path::TEXT, 'visit_closed'::TEXT
    FROM public.cmms_visitor_checkin v
   WHERE v.vehicle_photo_path IS NOT NULL
     AND v.status IN ('checked_out', 'check_in_rejected')
     AND (p_cmms_company_id IS NULL OR v.cmms_company_id = p_cmms_company_id)
  UNION ALL
  SELECT o.name::TEXT, 'unattached'::TEXT
    FROM storage.objects o
   WHERE o.bucket_id = 'cmms-visitor-vehicle-photos'
     AND o.created_at < now() - INTERVAL '1 day'
     AND NOT EXISTS (SELECT 1 FROM public.cmms_visitor_checkin v WHERE v.vehicle_photo_path = o.name)
     AND (p_cmms_company_id IS NULL OR public.cmms_visitor_photo_owner_company(o.name) = p_cmms_company_id)
  LIMIT 500;
END;
$$;

-- Clears the stored path only once the file is really gone from Storage, so a
-- failed or interrupted delete is simply retried by the next clean-up.
CREATE OR REPLACE FUNCTION public.confirm_visitor_photos_purged(p_paths TEXT[])
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_service BOOLEAN := COALESCE(auth.jwt() ->> 'role', '') = 'service_role';
  v_count INTEGER;
BEGIN
  IF NOT v_service AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  UPDATE public.cmms_visitor_checkin v
     SET vehicle_photo_path = NULL,
         vehicle_photo_uploaded_at = NULL,
         updated_at = now()
   WHERE v.vehicle_photo_path = ANY (p_paths)
     AND v.status IN ('checked_out', 'check_in_rejected')
     AND (v_service OR public.cmms_visitor_current_staff_id(v.cmms_company_id) IS NOT NULL)
     AND NOT EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'cmms-visitor-vehicle-photos' AND o.name = v.vehicle_photo_path
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.get_visitor_photos_to_purge(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_visitor_photos_purged(TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_visitor_photos_to_purge(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_visitor_photos_purged(TEXT[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- VERIFY
-- ------------------------------------------------------------
SELECT 'visitor vehicle approvals installed' AS status, now() AS run_at;
