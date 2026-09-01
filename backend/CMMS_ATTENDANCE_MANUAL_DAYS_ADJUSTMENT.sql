-- ============================================================================
-- CMMS STAFF ATTENDANCE — ADMIN MANUAL "DAYS PRESENT" ADJUSTMENT (ADD-ONLY)
-- Run in Supabase SQL Editor any time after
-- CMMS_ATTENDANCE_SUMMARY_AND_MANUAL_CHECKIN.sql.
--
-- WHAT THIS ADDS:
--   A company admin can credit a staff member with extra "days present"
--   (e.g. approved field work, an outage that stopped QR check-in, an
--   approved leave day counted as present) on top of what the check-in
--   history already proves. This is deliberately ADD-ONLY:
--     - the ledger table only accepts positive day counts (CHECK constraint)
--     - there is no update/delete RPC and no admin UI path to remove or
--       shrink an adjustment once made
--   so admins can top up a staff member's day count but can never use this
--   feature to erase or reduce attendance that already happened.
-- ============================================================================

-- ============================================================
-- 1. LEDGER TABLE (insert-only; never updated or deleted by app code)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_attendance_day_adjustments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id   UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  cmms_user_id      UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
  days_added        INTEGER NOT NULL CHECK (days_added > 0),
  reason            TEXT,
  added_by          UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cmms_attendance_day_adj_company_user
  ON public.cmms_attendance_day_adjustments(cmms_company_id, cmms_user_id);

ALTER TABLE public.cmms_attendance_day_adjustments ENABLE ROW LEVEL SECURITY;

-- Table writes only ever happen through admin_add_attendance_days() below
-- (SECURITY DEFINER, owned by a role that bypasses RLS). These policies only
-- cover direct reads/writes attempted straight from the client.
DROP POLICY IF EXISTS "Admins can read attendance day adjustments" ON public.cmms_attendance_day_adjustments;
CREATE POLICY "Admins can read attendance day adjustments"
  ON public.cmms_attendance_day_adjustments FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1
        FROM public.cmms_users cu
        LEFT JOIN public.cmms_user_roles ur ON ur.cmms_user_id = cu.id AND ur.is_active
        LEFT JOIN public.cmms_roles r ON r.id = ur.cmms_role_id AND r.is_active
       WHERE cu.cmms_company_id = cmms_attendance_day_adjustments.cmms_company_id
         AND cu.is_active
         AND lower(cu.email) = lower(auth.jwt() ->> 'email')
         AND lower(COALESCE(r.role_name, cu.role, '')) IN ('admin', 'administrator', 'cmms_admin', 'business_admin')
    )
  );

GRANT SELECT ON public.cmms_attendance_day_adjustments TO authenticated;

-- ============================================================
-- 2. ADD DAYS (admin-only, positive counts only)
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

  IF NOT public.cmms_attendance_qr_admin(p_cmms_company_id) THEN
    RAISE EXCEPTION 'Only a company administrator can add attendance days';
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
-- 3. AUDIT LIST — admin view of every add-only adjustment made
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
-- RETURNS TABLE output columns (user_name, days_added, reason, created_at, ...)
-- share names with real table columns of the same names below; without this,
-- PL/pgSQL can raise "column reference is ambiguous" even on qualified uses.
#variable_conflict use_column
BEGIN
  IF NOT public.cmms_attendance_qr_admin(p_cmms_company_id) THEN
    RAISE EXCEPTION 'Only a company administrator can view attendance day adjustments';
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

-- ============================================================
-- 4. FOLD ADJUSTMENTS INTO THE SUMMARY (adds on top; never subtracts)
-- ============================================================
-- CREATE OR REPLACE cannot change a function's OUT-parameter row type (this
-- adds manual_days_added), so the old signature must be dropped first.
DROP FUNCTION IF EXISTS public.get_attendance_summary(UUID, DATE, DATE, UUID);

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
-- RETURNS TABLE output columns (user_name, days_present, ...) share names
-- with real table/CTE columns of the same names below; without this,
-- PL/pgSQL can raise "column reference is ambiguous" even on qualified uses.
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
  v_is_admin := public.cmms_attendance_qr_admin(p_cmms_company_id);

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
SELECT 'admin add-only attendance days adjustment installed' AS status;
