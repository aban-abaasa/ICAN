-- ============================================================================
-- CMMS Visitor Ratings — visitors optionally rate staff/department at
-- check-out, feeding a positive rating into the same reward-points ledger.
-- Run after:
--   CMMS_STAFF_ATTENDANCE_VISITOR_MANAGEMENT.sql
--   CMMS_EMPLOYEE_REWARDS_POINTS.sql
--
-- WHAT THIS ADDS:
--   Right after a visitor checks out (public QR self-checkout — anonymous,
--   no sign-in — or the front-desk admin checkout), they can OPTIONALLY
--   rate the staff member who hosted them and/or that staff member's
--   department, 1-5 stars, plus a free-text comment. Nothing here is
--   required — a visitor who skips it just checked out normally.
--
--   "Smart" points contribution: a rating only awards points to the HOST
--   staff member, and only when it is genuinely positive (>= the company's
--   configured threshold, default 4/5) — so this can't be used to reward
--   poor service, can't be farmed (one rating per visit, only after that
--   visit's own check-out, points via the same source_type/source_id
--   dedup the rest of the ledger already relies on), and never touches any
--   money by itself (it only adds a ledger row and, like every other point
--   source, may queue a redemption for an admin to pay with the wallet PIN
--   — see fn_maybe_queue_reward_redemption in CMMS_EMPLOYEE_REWARDS_POINTS.sql).
--   A department rating is stored for reporting only — a department is not
--   a person and does not itself earn points.
-- ============================================================================

-- ============================================================
-- 1. RATINGS TABLE — one row per visit, at most (unique on visitor_checkin_id)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_visitor_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_checkin_id UUID NOT NULL UNIQUE REFERENCES public.cmms_visitor_checkin(id) ON DELETE CASCADE,
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  host_cmms_user_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  department_id UUID REFERENCES public.cmms_departments(id) ON DELETE SET NULL,
  staff_rating SMALLINT CHECK (staff_rating BETWEEN 1 AND 5),
  department_rating SMALLINT CHECK (department_rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (staff_rating IS NOT NULL OR department_rating IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_visitor_ratings_host
  ON public.cmms_visitor_ratings(cmms_company_id, host_cmms_user_id);
CREATE INDEX IF NOT EXISTS idx_visitor_ratings_department
  ON public.cmms_visitor_ratings(cmms_company_id, department_id);

ALTER TABLE public.cmms_visitor_ratings ENABLE ROW LEVEL SECURITY;

-- Writes only ever happen through submit_visitor_rating() below (SECURITY
-- DEFINER, callable anonymously — a visitor is never signed in). This policy
-- only covers direct reads attempted straight from an authenticated client:
-- a company admin sees everything, and a staff member can see ratings left
-- about them.
DROP POLICY IF EXISTS cmms_visitor_ratings_read ON public.cmms_visitor_ratings;
CREATE POLICY cmms_visitor_ratings_read ON public.cmms_visitor_ratings
  FOR SELECT TO authenticated
  USING (
    public.cmms_attendance_qr_admin(cmms_company_id)
    OR EXISTS (
      SELECT 1 FROM public.cmms_users u
      WHERE u.id = cmms_visitor_ratings.host_cmms_user_id AND u.ican_user_id = auth.uid()
    )
  );

GRANT SELECT ON public.cmms_visitor_ratings TO authenticated;

-- ============================================================
-- 2. SETTINGS — extend the existing rewards settings row rather than a new
--    table, since this is just another point source alongside check-ins/
--    reports/messages/tasks.
-- ============================================================
ALTER TABLE public.cmms_rewards_settings
  ADD COLUMN IF NOT EXISTS points_per_positive_visitor_rating INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS visitor_rating_positive_threshold SMALLINT NOT NULL DEFAULT 4;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cmms_rewards_settings_positive_rating_pts_check'
  ) THEN
    ALTER TABLE public.cmms_rewards_settings
      ADD CONSTRAINT cmms_rewards_settings_positive_rating_pts_check
      CHECK (points_per_positive_visitor_rating >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cmms_rewards_settings_rating_threshold_check'
  ) THEN
    ALTER TABLE public.cmms_rewards_settings
      ADD CONSTRAINT cmms_rewards_settings_rating_threshold_check
      CHECK (visitor_rating_positive_threshold BETWEEN 1 AND 5);
  END IF;
END $$;

-- cmms_reward_points_ledger.source_type was created with a fixed CHECK list
-- in CMMS_EMPLOYEE_REWARDS_POINTS.sql that doesn't include 'visitor_rating'.
-- Widen whatever that constraint is actually named (found dynamically, since
-- an inline CREATE TABLE CHECK gets an auto-generated name) rather than
-- assuming it — safe to run whether or not that file has been deployed yet.
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT conname INTO v_conname
    FROM pg_constraint
   WHERE conrelid = 'public.cmms_reward_points_ledger'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%source_type%';
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.cmms_reward_points_ledger DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE public.cmms_reward_points_ledger
    ADD CONSTRAINT cmms_reward_points_ledger_source_type_check
    CHECK (source_type IN (
      'checkin', 'early_checkin', 'report_filed', 'message', 'task_completed',
      'manual_adjustment', 'redeemed', 'redeemed_reversal', 'visitor_rating'
    ));
END $$;

-- ============================================================
-- 3. SUBMIT A RATING — anonymous-callable (a visitor is never signed in),
--    at most once per visit, only after that visit's own check-out.
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_visitor_rating(
  p_visitor_id UUID,
  p_staff_rating SMALLINT DEFAULT NULL,
  p_department_rating SMALLINT DEFAULT NULL,
  p_comment TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visitor public.cmms_visitor_checkin;
  v_department_id UUID;
  v_settings public.cmms_rewards_settings;
  v_rating_id UUID;
BEGIN
  IF p_staff_rating IS NULL AND p_department_rating IS NULL THEN
    RAISE EXCEPTION 'Give at least one rating';
  END IF;
  IF p_staff_rating IS NOT NULL AND p_staff_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Staff rating must be between 1 and 5';
  END IF;
  IF p_department_rating IS NOT NULL AND p_department_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Department rating must be between 1 and 5';
  END IF;

  SELECT * INTO v_visitor FROM public.cmms_visitor_checkin WHERE id = p_visitor_id FOR UPDATE;
  IF v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'Visitor record not found';
  END IF;
  IF v_visitor.status <> 'checked_out' THEN
    RAISE EXCEPTION 'A rating can only be left after checking out';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cmms_visitor_ratings WHERE visitor_checkin_id = p_visitor_id) THEN
    RAISE EXCEPTION 'This visit has already been rated';
  END IF;

  IF v_visitor.host_cmms_user_id IS NOT NULL THEN
    SELECT department_id INTO v_department_id FROM public.cmms_users WHERE id = v_visitor.host_cmms_user_id;
  END IF;

  INSERT INTO public.cmms_visitor_ratings
    (visitor_checkin_id, cmms_company_id, host_cmms_user_id, department_id, staff_rating, department_rating, comment)
  VALUES (p_visitor_id, v_visitor.cmms_company_id, v_visitor.host_cmms_user_id, v_department_id,
    p_staff_rating, p_department_rating, NULLIF(trim(p_comment), ''))
  RETURNING id INTO v_rating_id;

  IF p_staff_rating IS NOT NULL AND v_visitor.host_cmms_user_id IS NOT NULL THEN
    SELECT * INTO v_settings FROM public.cmms_rewards_settings WHERE cmms_company_id = v_visitor.cmms_company_id;
    IF v_settings.cmms_company_id IS NOT NULL AND v_settings.enabled
       AND v_settings.points_per_positive_visitor_rating > 0
       AND p_staff_rating >= v_settings.visitor_rating_positive_threshold THEN
      INSERT INTO public.cmms_reward_points_ledger
        (cmms_company_id, cmms_user_id, points, source_type, source_id, reason)
      VALUES (v_visitor.cmms_company_id, v_visitor.host_cmms_user_id, v_settings.points_per_positive_visitor_rating,
        'visitor_rating', v_rating_id, format('A visitor rated them %s/5', p_staff_rating))
      ON CONFLICT DO NOTHING;

      PERFORM public.fn_maybe_queue_reward_redemption(v_visitor.cmms_company_id, v_visitor.host_cmms_user_id);
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'rating_id', v_rating_id);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_visitor_rating(UUID, SMALLINT, SMALLINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_visitor_rating(UUID, SMALLINT, SMALLINT, TEXT) TO anon, authenticated;

-- ============================================================
-- 4. READ RPCs — per-staff (self-restricted, so it can sit on an employee's
--    own attendance/rewards view) and per-department (admin only) averages.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_staff_visitor_ratings(
  p_cmms_company_id UUID,
  p_cmms_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  cmms_user_id UUID,
  user_name TEXT,
  rating_count BIGINT,
  average_rating NUMERIC
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
    FROM public.cmms_users cu
   WHERE cu.cmms_company_id = p_cmms_company_id AND cu.is_active
     AND lower(cu.email) = lower(auth.jwt() ->> 'email')
   LIMIT 1;
  IF v_current_user_id IS NULL THEN RAISE EXCEPTION 'Active CMMS staff membership is required'; END IF;
  v_is_admin := public.cmms_attendance_qr_admin(p_cmms_company_id);

  RETURN QUERY
  SELECT u.id, COALESCE(u.full_name, u.user_name)::TEXT,
         COUNT(r.id) FILTER (WHERE r.staff_rating IS NOT NULL)::BIGINT AS rating_count,
         ROUND(AVG(r.staff_rating) FILTER (WHERE r.staff_rating IS NOT NULL), 2) AS average_rating
    FROM public.cmms_users u
    LEFT JOIN public.cmms_visitor_ratings r
      ON r.host_cmms_user_id = u.id AND r.cmms_company_id = p_cmms_company_id
   WHERE u.cmms_company_id = p_cmms_company_id
     AND u.is_active
     AND (v_is_admin OR u.id = v_current_user_id)
     AND (p_cmms_user_id IS NULL OR u.id = p_cmms_user_id)
     AND (v_is_admin OR p_cmms_user_id IS NULL OR p_cmms_user_id = v_current_user_id)
   GROUP BY u.id, u.full_name, u.user_name
   ORDER BY average_rating DESC NULLS LAST, user_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_staff_visitor_ratings(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_staff_visitor_ratings(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_department_visitor_ratings(p_cmms_company_id UUID)
RETURNS TABLE (
  department_id UUID,
  department_name TEXT,
  rating_count BIGINT,
  average_rating NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.cmms_attendance_qr_admin(p_cmms_company_id) THEN
    RAISE EXCEPTION 'Only a company administrator can view department ratings';
  END IF;

  RETURN QUERY
  SELECT d.id, d.department_name::TEXT,
         COUNT(r.id) FILTER (WHERE r.department_rating IS NOT NULL)::BIGINT AS rating_count,
         ROUND(AVG(r.department_rating) FILTER (WHERE r.department_rating IS NOT NULL), 2) AS average_rating
    FROM public.cmms_departments d
    LEFT JOIN public.cmms_visitor_ratings r
      ON r.department_id = d.id AND r.cmms_company_id = p_cmms_company_id
   WHERE d.cmms_company_id = p_cmms_company_id
   GROUP BY d.id, d.department_name
   ORDER BY average_rating DESC NULLS LAST, department_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_department_visitor_ratings(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_department_visitor_ratings(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────
-- VERIFY
-- ─────────────────────────────────────────────────────────────────────────
SELECT 'Visitor ratings (staff + department, optional at check-out) installed' AS status;
