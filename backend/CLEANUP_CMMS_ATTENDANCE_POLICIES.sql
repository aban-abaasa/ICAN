-- ============================================================
-- CLEANUP CMMS ATTENDANCE POLICIES
-- ============================================================
-- Run this BEFORE running CMMS_STAFF_ATTENDANCE_VISITOR_MANAGEMENT.sql
-- if you encounter "policy already exists" errors

-- Drop all policies for cmms_staff_attendance
DROP POLICY IF EXISTS "Staff can read their own attendance" ON public.cmms_staff_attendance;
DROP POLICY IF EXISTS "Admins can read company attendance" ON public.cmms_staff_attendance;
DROP POLICY IF EXISTS "Staff can insert their own attendance" ON public.cmms_staff_attendance;
DROP POLICY IF EXISTS "Admins can update attendance" ON public.cmms_staff_attendance;

-- Drop all policies for cmms_visitor_checkin
DROP POLICY IF EXISTS "Anyone can check in visitors" ON public.cmms_visitor_checkin;
DROP POLICY IF EXISTS "Admins can read visitor records" ON public.cmms_visitor_checkin;
DROP POLICY IF EXISTS "Admins can update visitor records" ON public.cmms_visitor_checkin;

-- Drop all policies for cmms_attendance_audit
DROP POLICY IF EXISTS "Admins can read audit logs" ON public.cmms_attendance_audit;

-- Drop all policies for cmms_attendance_qr_locations
DROP POLICY IF EXISTS "Staff can read QR locations" ON public.cmms_attendance_qr_locations;
DROP POLICY IF EXISTS "Staff can create QR locations" ON public.cmms_attendance_qr_locations;
DROP POLICY IF EXISTS "Staff can update QR locations" ON public.cmms_attendance_qr_locations;

-- Confirmation message
DO $$
BEGIN
  RAISE NOTICE 'All CMMS attendance policies have been dropped successfully';
  RAISE NOTICE 'You can now run CMMS_STAFF_ATTENDANCE_VISITOR_MANAGEMENT.sql';
END $$;
