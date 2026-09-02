-- ============================================================================
-- CMMS Employee Rewards — points for attendance, reports, messaging, tasks
-- Run after:
--   CMMS_ATTENDANCE_CHECKOUT_PAY_CONFIRMATION.sql
--   CMMS_ATTENDANCE_PAYROLL_INTEGRATION.sql
--   CMMS_COMPANY_REPORTING_SYSTEM.sql
--   CMMS_REPORT_MESSAGING_SYSTEM.sql
--   CMMS_TASK_PROGRESS_TRACKING_AND_NOTIFICATIONS.sql
--   ICAN_BUSINESS_WALLET_TRANSFERS.sql
--   SHARED_BUSINESS_AUTHORITY_AND_PAYROLL.sql
--
-- WHAT THIS ADDS:
--   Staff automatically earn points for showing up (extra for arriving early),
--   filing a company report, sending CMMS messages (capped per day so it
--   can't be farmed), and completing an assigned job. A company admin sets
--   how many points each of those is worth and, separately, how many ICAN
--   coins one point converts to. Points are just a running ledger balance —
--   nothing gets paid out on its own.
--
--   "Auto-redeem": once an admin turns it on and sets a threshold, crossing
--   that many points automatically files a REDEMPTION REQUEST (reserving
--   those points immediately so they can't be double-spent or double-
--   counted). It does NOT move any money by itself — every real business
--   wallet transfer in this app is gated behind a PIN check inside a
--   SECURITY DEFINER function (see approve_pitchin_business_wallet_transaction
--   in ICAN_BUSINESS_WALLET_TRANSFERS.sql), and there is no existing path in
--   this codebase for a backend job to move wallet money with no PIN
--   involved anywhere in the chain. Building one here would be a new,
--   unreviewed hole in that model. So "auto" means auto-detected and
--   auto-queued for one-click payment — an admin still finishes it with the
--   business-wallet PIN (or records it as cash), exactly like every other
--   payroll payment in this app. Cross-checked against cmms_companies too:
--   that table is a synced mirror of cmms_company_profiles (id-for-id, see
--   FIX_CMMS_COMPANIES_SYNC.sql), so cmms_company_reports/cmms_job_assignments/
--   cmms_report_messages' company_id values line up directly with
--   cmms_company_profiles.id used everywhere else in attendance/payroll.
-- ============================================================================

-- ============================================================
-- 1. SETTINGS (one row per company; admin-configurable)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_rewards_settings (
  cmms_company_id UUID PRIMARY KEY REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  points_per_checkin INTEGER NOT NULL DEFAULT 1 CHECK (points_per_checkin >= 0),
  points_per_early_checkin INTEGER NOT NULL DEFAULT 2 CHECK (points_per_early_checkin >= 0),
  early_checkin_minutes INTEGER NOT NULL DEFAULT 10 CHECK (early_checkin_minutes >= 0),
  points_per_report INTEGER NOT NULL DEFAULT 3 CHECK (points_per_report >= 0),
  points_per_task_completed INTEGER NOT NULL DEFAULT 5 CHECK (points_per_task_completed >= 0),
  points_per_message INTEGER NOT NULL DEFAULT 0 CHECK (points_per_message >= 0),
  message_daily_cap INTEGER NOT NULL DEFAULT 5 CHECK (message_daily_cap >= 0),
  ican_coins_per_point NUMERIC(18,8) NOT NULL DEFAULT 0 CHECK (ican_coins_per_point >= 0),
  auto_redeem_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  auto_redeem_threshold_points INTEGER NOT NULL DEFAULT 100 CHECK (auto_redeem_threshold_points > 0),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cmms_rewards_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cmms_rewards_settings_admin ON public.cmms_rewards_settings;
CREATE POLICY cmms_rewards_settings_admin ON public.cmms_rewards_settings
  FOR ALL TO authenticated
  USING (public.cmms_attendance_qr_admin(cmms_company_id))
  WITH CHECK (public.cmms_attendance_qr_admin(cmms_company_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cmms_rewards_settings TO authenticated;

-- ============================================================
-- 2. LEDGER (insert-only from the app's point of view; every row is written
--    by a SECURITY DEFINER trigger/function below, never directly by a
--    client). Balance for an employee is simply SUM(points).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_reward_points_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  cmms_user_id UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
  points INTEGER NOT NULL CHECK (points <> 0),
  source_type TEXT NOT NULL CHECK (source_type IN (
    'checkin', 'early_checkin', 'report_filed', 'message', 'task_completed',
    'manual_adjustment', 'redeemed', 'redeemed_reversal'
  )),
  source_id UUID,
  reason TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stops the same attendance/report/message/task/redemption event from ever
-- awarding (or reversing) points twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reward_ledger_source_unique
  ON public.cmms_reward_points_ledger(source_type, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reward_ledger_user
  ON public.cmms_reward_points_ledger(cmms_company_id, cmms_user_id, created_at DESC);

ALTER TABLE public.cmms_reward_points_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cmms_reward_ledger_read ON public.cmms_reward_points_ledger;
CREATE POLICY cmms_reward_ledger_read ON public.cmms_reward_points_ledger
  FOR SELECT TO authenticated
  USING (
    public.cmms_attendance_qr_admin(cmms_company_id)
    OR EXISTS (
      SELECT 1 FROM public.cmms_users u
      WHERE u.id = cmms_reward_points_ledger.cmms_user_id
        AND u.ican_user_id = auth.uid()
    )
  );

GRANT SELECT ON public.cmms_reward_points_ledger TO authenticated;

-- ============================================================
-- 3. REDEMPTIONS (a request to cash points out for ICAN coins; queued
--    automatically or by an admin, always finished by an admin with a real
--    payment — cash trusted-as-reported, or a verified wallet transfer)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_reward_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  cmms_user_id UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
  points_redeemed INTEGER NOT NULL CHECK (points_redeemed > 0),
  ican_coins_per_point NUMERIC(18,8) NOT NULL,
  ican_amount NUMERIC(18,8) NOT NULL CHECK (ican_amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  triggered_by TEXT NOT NULL DEFAULT 'manual' CHECK (triggered_by IN ('auto', 'manual')),
  payment_method TEXT CHECK (payment_method IN ('cash', 'ican')),
  wallet_transaction_id UUID REFERENCES public.ican_business_wallet_transactions(id) ON DELETE SET NULL,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  paid_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_reward_redemptions_company_status
  ON public.cmms_reward_redemptions(cmms_company_id, status, requested_at DESC);

-- Mirrors idx_cmms_attendance_pay_confirmations_wallet_tx: one real transfer
-- can only ever settle one redemption.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reward_redemptions_wallet_tx
  ON public.cmms_reward_redemptions(wallet_transaction_id)
  WHERE wallet_transaction_id IS NOT NULL;

ALTER TABLE public.cmms_reward_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cmms_reward_redemptions_read ON public.cmms_reward_redemptions;
CREATE POLICY cmms_reward_redemptions_read ON public.cmms_reward_redemptions
  FOR SELECT TO authenticated
  USING (
    public.cmms_attendance_qr_admin(cmms_company_id)
    OR EXISTS (
      SELECT 1 FROM public.cmms_users u
      WHERE u.id = cmms_reward_redemptions.cmms_user_id
        AND u.ican_user_id = auth.uid()
    )
  );

GRANT SELECT ON public.cmms_reward_redemptions TO authenticated;

-- ============================================================
-- 4. AUTO-REDEEM QUEUEING — reserves points into a pending redemption the
--    moment a balance crosses the company's threshold. Called after every
--    point award below. Never touches money.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_maybe_queue_reward_redemption(
  p_cmms_company_id UUID,
  p_cmms_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.cmms_rewards_settings;
  v_balance INTEGER;
  v_ican_amount NUMERIC(18,8);
  v_redemption_id UUID;
BEGIN
  SELECT * INTO v_settings FROM public.cmms_rewards_settings WHERE cmms_company_id = p_cmms_company_id;
  IF v_settings.cmms_company_id IS NULL OR NOT v_settings.enabled OR NOT v_settings.auto_redeem_enabled THEN
    RETURN;
  END IF;
  IF v_settings.ican_coins_per_point <= 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(points), 0) INTO v_balance
    FROM public.cmms_reward_points_ledger
   WHERE cmms_company_id = p_cmms_company_id AND cmms_user_id = p_cmms_user_id;

  IF v_balance < v_settings.auto_redeem_threshold_points THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cmms_users u
    WHERE u.id = p_cmms_user_id AND u.ican_user_id IS NOT NULL
  ) THEN
    RETURN; -- not linked to an ICAN wallet yet — nowhere to pay this out to
  END IF;

  v_ican_amount := ROUND(v_balance * v_settings.ican_coins_per_point, 8);
  IF v_ican_amount <= 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.cmms_reward_redemptions
    (cmms_company_id, cmms_user_id, points_redeemed, ican_coins_per_point, ican_amount, status, triggered_by)
  VALUES (p_cmms_company_id, p_cmms_user_id, v_balance, v_settings.ican_coins_per_point, v_ican_amount, 'pending', 'auto')
  RETURNING id INTO v_redemption_id;

  -- Reserve the points immediately so a second award landing a moment later
  -- computes its balance against zero, not against points already spoken for.
  INSERT INTO public.cmms_reward_points_ledger
    (cmms_company_id, cmms_user_id, points, source_type, source_id, reason)
  VALUES (p_cmms_company_id, p_cmms_user_id, -v_balance, 'redeemed', v_redemption_id, 'Auto-queued for redemption');
END;
$$;

-- ============================================================
-- 5. POINT-AWARDING TRIGGERS
-- ============================================================

-- 5a. Check-in / early check-in
CREATE OR REPLACE FUNCTION public.fn_award_attendance_points()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.cmms_rewards_settings;
  v_att_settings public.cmms_attendance_payroll_settings;
  v_tz TEXT;
  v_local_time TIME;
  v_early_cutoff TIME;
BEGIN
  SELECT * INTO v_settings FROM public.cmms_rewards_settings WHERE cmms_company_id = NEW.cmms_company_id;
  IF v_settings.cmms_company_id IS NULL OR NOT v_settings.enabled THEN
    RETURN NEW;
  END IF;

  IF v_settings.points_per_checkin > 0 THEN
    INSERT INTO public.cmms_reward_points_ledger
      (cmms_company_id, cmms_user_id, points, source_type, source_id, reason)
    VALUES (NEW.cmms_company_id, NEW.cmms_user_id, v_settings.points_per_checkin, 'checkin', NEW.id, 'Checked in')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_settings.points_per_early_checkin > 0 THEN
    SELECT * INTO v_att_settings FROM public.cmms_attendance_payroll_settings WHERE cmms_company_id = NEW.cmms_company_id;
    IF v_att_settings.cmms_company_id IS NOT NULL THEN
      v_tz := COALESCE(v_att_settings.timezone, 'UTC');
      v_local_time := (NEW.check_in_time AT TIME ZONE v_tz)::time;
      v_early_cutoff := v_att_settings.scheduled_start - make_interval(mins => v_settings.early_checkin_minutes);
      IF v_local_time <= v_early_cutoff THEN
        INSERT INTO public.cmms_reward_points_ledger
          (cmms_company_id, cmms_user_id, points, source_type, source_id, reason)
        VALUES (NEW.cmms_company_id, NEW.cmms_user_id, v_settings.points_per_early_checkin, 'early_checkin', NEW.id,
          format('Arrived %s+ minute(s) early', v_settings.early_checkin_minutes))
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;

  PERFORM public.fn_maybe_queue_reward_redemption(NEW.cmms_company_id, NEW.cmms_user_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_award_attendance_points ON public.cmms_staff_attendance;
CREATE TRIGGER trg_award_attendance_points
  AFTER INSERT ON public.cmms_staff_attendance
  FOR EACH ROW EXECUTE FUNCTION public.fn_award_attendance_points();

-- 5b. Company report filed
CREATE OR REPLACE FUNCTION public.fn_award_report_points()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.cmms_rewards_settings;
BEGIN
  IF NEW.reporter_cmms_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_settings FROM public.cmms_rewards_settings WHERE cmms_company_id = NEW.cmms_company_id;
  IF v_settings.cmms_company_id IS NULL OR NOT v_settings.enabled OR v_settings.points_per_report <= 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.cmms_reward_points_ledger
    (cmms_company_id, cmms_user_id, points, source_type, source_id, reason)
  VALUES (NEW.cmms_company_id, NEW.reporter_cmms_user_id, v_settings.points_per_report, 'report_filed', NEW.id, 'Filed a company report')
  ON CONFLICT DO NOTHING;

  PERFORM public.fn_maybe_queue_reward_redemption(NEW.cmms_company_id, NEW.reporter_cmms_user_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_award_report_points ON public.cmms_company_reports;
CREATE TRIGGER trg_award_report_points
  AFTER INSERT ON public.cmms_company_reports
  FOR EACH ROW EXECUTE FUNCTION public.fn_award_report_points();

-- 5c. Messages — capped per employee per day so this can't be farmed by
-- sending empty chatter.
CREATE OR REPLACE FUNCTION public.fn_award_message_points()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.cmms_rewards_settings;
  v_today_count INTEGER;
BEGIN
  -- cmms_companies.id is a synced mirror of cmms_company_profiles.id
  -- (FIX_CMMS_COMPANIES_SYNC.sql), so NEW.company_id is already the right
  -- key for cmms_rewards_settings.cmms_company_id.
  SELECT * INTO v_settings FROM public.cmms_rewards_settings WHERE cmms_company_id = NEW.company_id;
  IF v_settings.cmms_company_id IS NULL OR NOT v_settings.enabled OR v_settings.points_per_message <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_today_count
    FROM public.cmms_reward_points_ledger
   WHERE cmms_company_id = NEW.company_id
     AND cmms_user_id = NEW.sender_id
     AND source_type = 'message'
     AND created_at >= date_trunc('day', now());

  IF v_today_count >= v_settings.message_daily_cap THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.cmms_reward_points_ledger
    (cmms_company_id, cmms_user_id, points, source_type, source_id, reason)
  VALUES (NEW.company_id, NEW.sender_id, v_settings.points_per_message, 'message', NEW.id, 'Sent a message')
  ON CONFLICT DO NOTHING;

  PERFORM public.fn_maybe_queue_reward_redemption(NEW.company_id, NEW.sender_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_award_message_points ON public.cmms_report_messages;
CREATE TRIGGER trg_award_message_points
  AFTER INSERT ON public.cmms_report_messages
  FOR EACH ROW EXECUTE FUNCTION public.fn_award_message_points();

-- 5d. Task completed
CREATE OR REPLACE FUNCTION public.fn_award_task_completion_points()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.cmms_rewards_settings;
BEGIN
  IF NEW.assignment_status <> 'completed' OR OLD.assignment_status = 'completed' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_settings FROM public.cmms_rewards_settings WHERE cmms_company_id = NEW.company_id;
  IF v_settings.cmms_company_id IS NULL OR NOT v_settings.enabled OR v_settings.points_per_task_completed <= 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.cmms_reward_points_ledger
    (cmms_company_id, cmms_user_id, points, source_type, source_id, reason)
  VALUES (NEW.company_id, NEW.assigned_to_user_id, v_settings.points_per_task_completed, 'task_completed', NEW.id,
    format('Completed: %s', NEW.job_title))
  ON CONFLICT DO NOTHING;

  PERFORM public.fn_maybe_queue_reward_redemption(NEW.company_id, NEW.assigned_to_user_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_award_task_completion_points ON public.cmms_job_assignments;
CREATE TRIGGER trg_award_task_completion_points
  AFTER UPDATE ON public.cmms_job_assignments
  FOR EACH ROW EXECUTE FUNCTION public.fn_award_task_completion_points();

-- ============================================================
-- 6. READ RPCs (admin sees the whole company; an employee is always
--    restricted to their own row/history, regardless of what they pass in)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_employee_reward_points(
  p_cmms_company_id UUID,
  p_cmms_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  cmms_user_id UUID,
  user_name TEXT,
  user_email TEXT,
  balance_points BIGINT,
  pending_redemption_points BIGINT,
  lifetime_earned_points BIGINT
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
  SELECT u.id, COALESCE(u.full_name, u.user_name)::TEXT, u.email::TEXT,
         COALESCE(SUM(l.points), 0)::BIGINT AS balance_points,
         COALESCE(SUM(l.points) FILTER (WHERE l.source_type = 'redeemed' AND EXISTS (
           SELECT 1 FROM public.cmms_reward_redemptions r WHERE r.id = l.source_id AND r.status = 'pending'
         )), 0)::BIGINT * -1 AS pending_redemption_points,
         COALESCE(SUM(l.points) FILTER (WHERE l.points > 0), 0)::BIGINT AS lifetime_earned_points
    FROM public.cmms_users u
    LEFT JOIN public.cmms_reward_points_ledger l
      ON l.cmms_user_id = u.id AND l.cmms_company_id = p_cmms_company_id
   WHERE u.cmms_company_id = p_cmms_company_id
     AND u.is_active
     AND (v_is_admin OR u.id = v_current_user_id)
     AND (p_cmms_user_id IS NULL OR u.id = p_cmms_user_id)
     AND (v_is_admin OR p_cmms_user_id IS NULL OR p_cmms_user_id = v_current_user_id)
   GROUP BY u.id, u.full_name, u.user_name, u.email
   ORDER BY balance_points DESC, user_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_employee_reward_points(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_employee_reward_points(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_reward_points_history(
  p_cmms_company_id UUID,
  p_cmms_user_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  cmms_user_id UUID,
  user_name TEXT,
  points INTEGER,
  source_type TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ
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
  SELECT l.id, l.cmms_user_id, COALESCE(u.full_name, u.user_name)::TEXT, l.points, l.source_type, l.reason, l.created_at
    FROM public.cmms_reward_points_ledger l
    JOIN public.cmms_users u ON u.id = l.cmms_user_id
   WHERE l.cmms_company_id = p_cmms_company_id
     AND (v_is_admin OR l.cmms_user_id = v_current_user_id)
     AND (p_cmms_user_id IS NULL OR l.cmms_user_id = p_cmms_user_id)
     AND (v_is_admin OR p_cmms_user_id IS NULL OR p_cmms_user_id = v_current_user_id)
   ORDER BY l.created_at DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 500);
END;
$$;

REVOKE ALL ON FUNCTION public.get_reward_points_history(UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reward_points_history(UUID, UUID, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_pending_reward_redemptions(p_cmms_company_id UUID)
RETURNS TABLE (
  id UUID,
  cmms_user_id UUID,
  employee_user_id UUID,
  user_name TEXT,
  user_email TEXT,
  points_redeemed INTEGER,
  ican_amount NUMERIC,
  triggered_by TEXT,
  requested_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.cmms_attendance_qr_admin(p_cmms_company_id) THEN
    RAISE EXCEPTION 'Only a company administrator can view reward redemptions';
  END IF;

  RETURN QUERY
  SELECT r.id, r.cmms_user_id, u.ican_user_id, COALESCE(u.full_name, u.user_name)::TEXT, u.email::TEXT,
         r.points_redeemed, r.ican_amount, r.triggered_by, r.requested_at
    FROM public.cmms_reward_redemptions r
    JOIN public.cmms_users u ON u.id = r.cmms_user_id
   WHERE r.cmms_company_id = p_cmms_company_id AND r.status = 'pending'
   ORDER BY r.requested_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_pending_reward_redemptions(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_reward_redemptions(UUID) TO authenticated;

-- ============================================================
-- 7. ADMIN ACTIONS — manual redemption request, cancel, and pay
-- ============================================================

-- Lets an admin cash an employee out on demand, independent of the
-- auto-redeem threshold (e.g. someone is leaving, or a manager wants to
-- reward them today). Defaults to their full available balance.
CREATE OR REPLACE FUNCTION public.cmms_request_reward_redemption(
  p_cmms_company_id UUID,
  p_cmms_user_id UUID,
  p_points INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.cmms_rewards_settings;
  v_balance INTEGER;
  v_points INTEGER;
  v_ican_amount NUMERIC(18,8);
  v_redemption_id UUID;
BEGIN
  IF NOT public.cmms_attendance_qr_admin(p_cmms_company_id) THEN
    RAISE EXCEPTION 'Only a company administrator can request a reward redemption';
  END IF;

  SELECT * INTO v_settings FROM public.cmms_rewards_settings WHERE cmms_company_id = p_cmms_company_id;
  IF v_settings.cmms_company_id IS NULL OR v_settings.ican_coins_per_point <= 0 THEN
    RAISE EXCEPTION 'Set an ICAN coins-per-point rate before redeeming points';
  END IF;

  SELECT COALESCE(SUM(points), 0) INTO v_balance
    FROM public.cmms_reward_points_ledger
   WHERE cmms_company_id = p_cmms_company_id AND cmms_user_id = p_cmms_user_id;

  v_points := COALESCE(p_points, v_balance);
  IF v_points IS NULL OR v_points <= 0 THEN
    RAISE EXCEPTION 'This employee has no reward points available to redeem';
  END IF;
  IF v_points > v_balance THEN
    RAISE EXCEPTION 'Cannot redeem more points than the employee has available (% available)', v_balance;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.cmms_users WHERE id = p_cmms_user_id AND ican_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'This employee is not linked to an ICAN wallet yet';
  END IF;

  v_ican_amount := ROUND(v_points * v_settings.ican_coins_per_point, 8);
  IF v_ican_amount <= 0 THEN
    RAISE EXCEPTION 'The ICAN coins-per-point rate is too low to redeem any points yet';
  END IF;

  INSERT INTO public.cmms_reward_redemptions
    (cmms_company_id, cmms_user_id, points_redeemed, ican_coins_per_point, ican_amount, status, triggered_by, requested_by)
  VALUES (p_cmms_company_id, p_cmms_user_id, v_points, v_settings.ican_coins_per_point, v_ican_amount, 'pending', 'manual', auth.uid())
  RETURNING id INTO v_redemption_id;

  INSERT INTO public.cmms_reward_points_ledger
    (cmms_company_id, cmms_user_id, points, source_type, source_id, reason, created_by)
  VALUES (p_cmms_company_id, p_cmms_user_id, -v_points, 'redeemed', v_redemption_id, 'Redemption requested by admin', auth.uid());

  RETURN jsonb_build_object('redemption_id', v_redemption_id, 'points_redeemed', v_points, 'ican_amount', v_ican_amount);
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_request_reward_redemption(UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_request_reward_redemption(UUID, UUID, INTEGER) TO authenticated;

-- Releases reserved points back to the employee's balance without paying
-- them (e.g. admin queued an auto-redemption too early).
CREATE OR REPLACE FUNCTION public.cmms_cancel_reward_redemption(p_redemption_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_redemption public.cmms_reward_redemptions;
BEGIN
  SELECT * INTO v_redemption FROM public.cmms_reward_redemptions WHERE id = p_redemption_id FOR UPDATE;
  IF v_redemption.id IS NULL THEN
    RAISE EXCEPTION 'Redemption not found';
  END IF;
  IF NOT public.cmms_attendance_qr_admin(v_redemption.cmms_company_id) THEN
    RAISE EXCEPTION 'Only a company administrator can cancel a reward redemption';
  END IF;
  IF v_redemption.status <> 'pending' THEN
    RAISE EXCEPTION 'Only a pending redemption can be cancelled';
  END IF;

  UPDATE public.cmms_reward_redemptions
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
   WHERE id = p_redemption_id;

  INSERT INTO public.cmms_reward_points_ledger
    (cmms_company_id, cmms_user_id, points, source_type, source_id, reason, created_by)
  VALUES (v_redemption.cmms_company_id, v_redemption.cmms_user_id, v_redemption.points_redeemed,
    'redeemed_reversal', p_redemption_id, 'Redemption cancelled', auth.uid());

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_cancel_reward_redemption(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_cancel_reward_redemption(UUID) TO authenticated;

-- Finishes a pending redemption. Cash is trusted as reported (same
-- convention as cmms_settle_attendance_pay); an 'ican' payment must be
-- backed by a real, completed business-wallet transfer to this employee for
-- the right amount, verified here rather than trusted from the client — see
-- the identical check in cmms_settle_attendance_pay for why each condition
-- below exists.
CREATE OR REPLACE FUNCTION public.cmms_pay_reward_redemption(
  p_redemption_id UUID,
  p_payment_method TEXT,
  p_wallet_transaction_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_redemption public.cmms_reward_redemptions;
  v_business_profile_id UUID;
  v_employee_user_id UUID;
  v_employee_name TEXT;
  v_business_name TEXT;
  v_wallet_tx public.ican_business_wallet_transactions;
  v_wallet_tx_id UUID;
BEGIN
  SELECT * INTO v_redemption FROM public.cmms_reward_redemptions WHERE id = p_redemption_id FOR UPDATE;
  IF v_redemption.id IS NULL THEN
    RAISE EXCEPTION 'Redemption not found';
  END IF;
  IF NOT public.cmms_attendance_qr_admin(v_redemption.cmms_company_id) THEN
    RAISE EXCEPTION 'Only a company administrator can pay a reward redemption';
  END IF;
  IF v_redemption.status <> 'pending' THEN
    RAISE EXCEPTION 'This redemption has already been settled';
  END IF;
  IF lower(COALESCE(p_payment_method, '')) NOT IN ('cash', 'ican') THEN
    RAISE EXCEPTION 'Choose cash or wallet to record this payment';
  END IF;

  SELECT pichin_business_profile_id INTO v_business_profile_id
    FROM public.cmms_company_profiles WHERE id = v_redemption.cmms_company_id;

  SELECT ican_user_id, COALESCE(full_name, user_name) INTO v_employee_user_id, v_employee_name
    FROM public.cmms_users WHERE id = v_redemption.cmms_user_id;

  SELECT business_name INTO v_business_name FROM public.business_profiles WHERE id = v_business_profile_id;

  IF lower(p_payment_method) = 'ican' THEN
    BEGIN
      v_wallet_tx_id := NULLIF(trim(p_wallet_transaction_id), '')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      v_wallet_tx_id := NULL;
    END;
    IF v_wallet_tx_id IS NULL THEN
      RAISE EXCEPTION 'A completed IcanEra wallet transfer is required to record this payment';
    END IF;

    SELECT * INTO v_wallet_tx FROM public.ican_business_wallet_transactions WHERE id = v_wallet_tx_id FOR UPDATE;
    IF v_wallet_tx.id IS NULL THEN
      RAISE EXCEPTION 'Wallet transaction not found';
    END IF;
    IF v_wallet_tx.business_profile_id <> v_business_profile_id THEN
      RAISE EXCEPTION 'That wallet transaction does not belong to this business';
    END IF;
    IF v_wallet_tx.recipient_user_id IS DISTINCT FROM v_employee_user_id THEN
      RAISE EXCEPTION 'That wallet transaction was not paid to this employee';
    END IF;
    IF v_wallet_tx.status <> 'completed' THEN
      RAISE EXCEPTION 'This wallet payment is still awaiting business-wallet approval';
    END IF;
    IF ABS(v_wallet_tx.amount_ican - v_redemption.ican_amount) > 0.0001 THEN
      RAISE EXCEPTION 'The wallet payment amount (% ICAN) does not match the amount due (% ICAN)', v_wallet_tx.amount_ican, v_redemption.ican_amount;
    END IF;
  END IF;

  UPDATE public.cmms_reward_redemptions
     SET status = 'paid', payment_method = lower(p_payment_method), wallet_transaction_id = v_wallet_tx_id,
         paid_at = now(), paid_by = auth.uid()
   WHERE id = p_redemption_id;

  -- A wallet payment already has its own ledger row from the transfer we
  -- just verified. Cash never touches the wallet, so give it the same
  -- single echo row cmms_settle_attendance_pay writes for cash salary — see
  -- that function's long comment for exactly why each field here is set
  -- the way it is (sender_user_id NULL, single row, explicit
  -- counterparty_type/expense_classification, source_app 'ican', etc).
  IF lower(p_payment_method) = 'cash' THEN
    INSERT INTO public.ican_coin_transactions
      (recipient_user_id, ican_amount, type, transaction_type, source_app, status,
       local_amount, local_currency, reference_id, note, business_profile_id,
       merchant_name, counterparty_type, expense_classification)
    VALUES (
      v_employee_user_id, v_redemption.ican_amount, 'transfer_out', 'transfer_out', 'ican', 'completed',
      NULL, NULL, p_redemption_id::TEXT,
      'Reward points redeemed (' || COALESCE(v_employee_name, 'Employee') || ')',
      v_business_profile_id, v_business_name, 'business', 'business_expense'
    );
  END IF;

  RETURN jsonb_build_object('paid', true, 'ican_amount', v_redemption.ican_amount, 'points_redeemed', v_redemption.points_redeemed);
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_pay_reward_redemption(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_pay_reward_redemption(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────
-- VERIFY
-- ─────────────────────────────────────────────────────────────────────────
SELECT 'CMMS employee rewards (points + redemption queue) installed' AS status;
