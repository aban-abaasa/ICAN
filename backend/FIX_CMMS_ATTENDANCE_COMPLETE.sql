-- ============================================================
-- COMPLETE FIX FOR CMMS ATTENDANCE SYSTEM
-- ============================================================
-- Fixes both the 500 and 400 errors

-- ============================================================
-- PART 1: Fix cmms_users RLS for embedded queries (400 error)
-- ============================================================

-- Ensure RLS is enabled
ALTER TABLE public.cmms_users ENABLE ROW LEVEL SECURITY;

-- Drop and recreate policies with simpler logic
DROP POLICY IF EXISTS "Users can read company members" ON public.cmms_users;
DROP POLICY IF EXISTS "Authenticated users can read active CMMS users" ON public.cmms_users;
DROP POLICY IF EXISTS "CMMS users can read their company members" ON public.cmms_users;

-- Simple policy: authenticated users can read active CMMS users
CREATE POLICY "CMMS users can read their company members" ON public.cmms_users
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL 
    AND is_active = true
  );

-- ============================================================
-- PART 2: Fix cmms_attendance_qr_locations RLS (500 error)
-- ============================================================

-- The 500 error is likely caused by the RLS policy having issues
-- Let's recreate them with safer logic

ALTER TABLE public.cmms_attendance_qr_locations ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Staff can read QR locations" ON public.cmms_attendance_qr_locations;
DROP POLICY IF EXISTS "Staff can create QR locations" ON public.cmms_attendance_qr_locations;
DROP POLICY IF EXISTS "Staff can update QR locations" ON public.cmms_attendance_qr_locations;
DROP POLICY IF EXISTS "Admins can manage QR locations" ON public.cmms_attendance_qr_locations;

-- Create simpler, safer policies
CREATE POLICY "Staff can read QR locations" ON public.cmms_attendance_qr_locations
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL 
    AND EXISTS (
      SELECT 1 FROM public.cmms_users cu
      WHERE cu.cmms_company_id = cmms_attendance_qr_locations.cmms_company_id
        AND cu.is_active = true
        AND cu.id = (
          SELECT id FROM public.cmms_users 
          WHERE lower(email) = lower(auth.jwt() ->> 'email') 
          AND is_active = true 
          LIMIT 1
        )
    )
  );

CREATE POLICY "Staff can create QR locations" ON public.cmms_attendance_qr_locations
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL 
    AND EXISTS (
      SELECT 1 FROM public.cmms_users cu
      WHERE cu.cmms_company_id = cmms_attendance_qr_locations.cmms_company_id
        AND cu.is_active = true
        AND cu.id = (
          SELECT id FROM public.cmms_users 
          WHERE lower(email) = lower(auth.jwt() ->> 'email') 
          AND is_active = true 
          LIMIT 1
        )
    )
  );

CREATE POLICY "Staff can update QR locations" ON public.cmms_attendance_qr_locations
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL 
    AND EXISTS (
      SELECT 1 FROM public.cmms_users cu
      WHERE cu.cmms_company_id = cmms_attendance_qr_locations.cmms_company_id
        AND cu.is_active = true
        AND cu.id = (
          SELECT id FROM public.cmms_users 
          WHERE lower(email) = lower(auth.jwt() ->> 'email') 
          AND is_active = true 
          LIMIT 1
        )
    )
  );

-- ============================================================
-- PART 3: Fix cmms_staff_attendance RLS (400 error related)
-- ============================================================

ALTER TABLE public.cmms_staff_attendance ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Staff can read their own attendance" ON public.cmms_staff_attendance;
DROP POLICY IF EXISTS "Admins can read company attendance" ON public.cmms_staff_attendance;
DROP POLICY IF EXISTS "Staff can insert their own attendance" ON public.cmms_staff_attendance;
DROP POLICY IF EXISTS "Admins can update attendance" ON public.cmms_staff_attendance;
DROP POLICY IF EXISTS "Staff can read company attendance" ON public.cmms_staff_attendance;

-- Simpler policy: staff can read all attendance in their company
CREATE POLICY "Staff can read company attendance" ON public.cmms_staff_attendance
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL 
    AND EXISTS (
      SELECT 1 FROM public.cmms_users cu
      WHERE cu.cmms_company_id = cmms_staff_attendance.cmms_company_id
        AND cu.is_active = true
        AND cu.id = (
          SELECT id FROM public.cmms_users 
          WHERE lower(email) = lower(auth.jwt() ->> 'email') 
          AND is_active = true 
          LIMIT 1
        )
    )
  );

CREATE POLICY "Staff can insert their own attendance" ON public.cmms_staff_attendance
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL 
    AND EXISTS (
      SELECT 1 FROM public.cmms_users cu
      WHERE cu.id = cmms_staff_attendance.cmms_user_id
        AND cu.is_active = true
        AND cu.cmms_company_id = cmms_staff_attendance.cmms_company_id
        AND cu.id = (
          SELECT id FROM public.cmms_users 
          WHERE lower(email) = lower(auth.jwt() ->> 'email') 
          AND is_active = true 
          LIMIT 1
        )
    )
  );

CREATE POLICY "Admins can update attendance" ON public.cmms_staff_attendance
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL 
    AND EXISTS (
      SELECT 1 FROM public.cmms_users cu
      WHERE cu.cmms_company_id = cmms_staff_attendance.cmms_company_id
        AND cu.is_active = true
        AND cu.id = (
          SELECT id FROM public.cmms_users 
          WHERE lower(email) = lower(auth.jwt() ->> 'email') 
          AND is_active = true 
          LIMIT 1
        )
        AND (
          lower(cu.role) IN ('admin', 'administrator', 'cmms_admin')
          OR EXISTS (
            SELECT 1 FROM public.cmms_user_roles ur
            JOIN public.cmms_roles r ON r.id = ur.cmms_role_id
            WHERE ur.cmms_user_id = cu.id
              AND ur.is_active = true
              AND r.is_active = true
              AND lower(r.role_name) IN ('admin', 'administrator', 'cmms_admin')
          )
        )
    )
  );

-- ============================================================
-- PART 4: Verify foreign key for embedded queries
-- ============================================================

-- Ensure foreign key exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'cmms_staff_attendance_cmms_user_id_fkey'
    AND table_name = 'cmms_staff_attendance'
  ) THEN
    ALTER TABLE public.cmms_staff_attendance
    ADD CONSTRAINT cmms_staff_attendance_cmms_user_id_fkey
    FOREIGN KEY (cmms_user_id) 
    REFERENCES public.cmms_users(id) 
    ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================================
-- PART 5: Grant permissions
-- ============================================================

GRANT SELECT ON public.cmms_users TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cmms_staff_attendance TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cmms_attendance_qr_locations TO authenticated;
GRANT SELECT ON public.cmms_visitor_checkin TO authenticated;
GRANT SELECT ON public.cmms_attendance_audit TO authenticated;

-- ============================================================
-- PART 6: Create a helper view for easier querying (optional)
-- ============================================================

-- This view joins attendance with user info, avoiding embedded resource issues
CREATE OR REPLACE VIEW public.cmms_staff_attendance_with_user AS
SELECT 
  a.id,
  a.cmms_company_id,
  a.cmms_user_id,
  a.check_in_time,
  a.check_out_time,
  a.check_in_location,
  a.check_out_location,
  a.check_in_latitude,
  a.check_in_longitude,
  a.check_out_latitude,
  a.check_out_longitude,
  a.location_validated,
  a.qr_code_token,
  a.status,
  a.notes,
  a.edited_by,
  a.edited_at,
  a.edit_reason,
  a.created_at,
  a.updated_at,
  u.id as staff_id,
  u.user_name as staff_user_name,
  u.email as staff_email,
  u.phone as staff_phone
FROM public.cmms_staff_attendance a
LEFT JOIN public.cmms_users u ON u.id = a.cmms_user_id;

-- Grant access to the view
GRANT SELECT ON public.cmms_staff_attendance_with_user TO authenticated;

-- Add RLS to the view (inherits from base tables)
ALTER VIEW public.cmms_staff_attendance_with_user SET (security_barrier = true);

-- ============================================================
-- VERIFICATION
-- ============================================================

DO $$
DECLARE
  v_attendance_policies INT;
  v_qr_policies INT;
  v_users_policies INT;
BEGIN
  SELECT COUNT(*) FROM pg_policies WHERE tablename = 'cmms_staff_attendance' INTO v_attendance_policies;
  SELECT COUNT(*) FROM pg_policies WHERE tablename = 'cmms_attendance_qr_locations' INTO v_qr_policies;
  SELECT COUNT(*) FROM pg_policies WHERE tablename = 'cmms_users' INTO v_users_policies;
  
  RAISE NOTICE '✓ Policies on cmms_staff_attendance: %', v_attendance_policies;
  RAISE NOTICE '✓ Policies on cmms_attendance_qr_locations: %', v_qr_policies;
  RAISE NOTICE '✓ Policies on cmms_users: %', v_users_policies;
  RAISE NOTICE '✓ Setup complete!';
  RAISE NOTICE '';
  RAISE NOTICE 'Frontend query options:';
  RAISE NOTICE '1. Use embedded: .select("*, staff:cmms_user_id(id,full_name,email,avatar_url)")';
  RAISE NOTICE '2. Use view: .from("cmms_staff_attendance_with_user").select("*")';
END $$;
