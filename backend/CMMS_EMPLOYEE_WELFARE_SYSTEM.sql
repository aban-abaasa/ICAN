-- ============================================================================
-- CMMS EMPLOYEE WELFARE SYSTEM — Leave, Sick Leave, Probation & general HR
-- welfare requests. Deliberately NOT a new CMMS tool/tab: the employee side
-- lives inside the existing "My Salary" self-service screen
-- (CMMSEmployeeSelfService.jsx / CMMSMySalaryPanel.jsx, Payroll tool scoped
-- to "own"), and the HR/admin side lives inside the existing Staff
-- Attendance tab (CMSSAttendancePanel.jsx) as an extra "Leave & Welfare"
-- sub-tab. Run after CMMS_STAFF_ATTENDANCE_VISITOR_MANAGEMENT.sql (for
-- cmms_active_staff / cmms_attendance_qr_admin / cmms_attendance_has_action)
-- CMMS_MY_SALARY_TAB_PAYROLL_ACCESS.sql (for cmms_attendance_has_action),
-- and CMMS_ADD_USER_SCHEMA.sql (for cmms_users).
--
-- Mirrors the request -> decide -> (employee self-service) shape already used
-- by CMMS_SALARY_ADVANCE_REQUESTS.sql:
--   * Any active staff member can ALWAYS submit a request from their own
--     "My Salary" screen -- submitting is never permission-gated.
--   * Deciding one is a real, admin-configurable permission: a dedicated
--     "welfare" action on the existing Staff Attendance tool (Role and tool
--     configuration -> Staff attendance & QR check-in -> "Welfare"
--     checkbox), separate from Manual/Add-days/Payroll-Approve so an admin
--     can grant HR approval power to exactly the roles they choose, without
--     it riding along on an unrelated attendance/payroll grant. A full
--     company admin always has it. See
--     cmms_can_manage_welfare()/cmms_can_view_welfare() below, and the
--     "welfare" entry in frontend/src/components/CMMSRoleConfiguration.jsx.
--   * "My ..." reads go through a dedicated self-scoped RPC (not a plain
--     table select) so an HR approver's broader RLS grant never leaks into
--     what an "own records" call returns for themselves.
--
-- COVERS FOUR THINGS:
--   1. Leave management  — configurable leave types, a per-employee/per-year
--      balance, and a request/approve/reject/cancel workflow
--      (cmms_leave_types, cmms_leave_balances, cmms_leave_requests).
--   2. Probation tracking — start probation on hire, HR review(s) partway
--      through, and a confirm/extend/terminate decision at the end
--      (cmms_probation_records, cmms_probation_reviews).
--   3. General welfare requests — everything that isn't a dated leave
--      booking: grievances/complaints, counseling & wellness support,
--      flexible-work requests, training/study sponsorship, and medical or
--      bereavement assistance (cmms_welfare_requests). Salary advances
--      already have their own dedicated flow — see
--      CMMS_SALARY_ADVANCE_REQUESTS.sql — so "loan/advance" is deliberately
--      not duplicated here.
--   4. A small HR dashboard summary RPC (pending counts, probations coming
--      due) so the admin screen doesn't need four separate round trips just
--      to render its headline numbers.
-- ============================================================================

-- ============================================================
-- 0. Shared helpers
-- ============================================================

-- Weekday count between two dates, inclusive of both ends. Deliberately
-- simple (no public-holiday calendar yet) -- good enough for entitlement
-- accounting today; a holiday table can subtract from this later without
-- changing any caller.
CREATE OR REPLACE FUNCTION public.cmms_count_leave_days(p_start DATE, p_end DATE)
RETURNS NUMERIC
LANGUAGE sql IMMUTABLE
AS $$
  SELECT COUNT(*)::NUMERIC
    FROM generate_series(p_start, p_end, interval '1 day') AS d
   WHERE EXTRACT(ISODOW FROM d) < 6;
$$;

-- The caller's own cmms_users.id for this company, resolved the same way
-- every other CMMS RLS check does it (email match against the JWT) -- kept
-- as one helper so every welfare table can store a stable cmms_user_id
-- snapshot for admin lists (department, job title, name) without each RPC
-- re-deriving it.
CREATE OR REPLACE FUNCTION public.cmms_current_cmms_user_id(p_company_id UUID)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT cu.id
    FROM public.cmms_users cu
   WHERE cu.cmms_company_id = p_company_id
     AND cu.is_active
     AND lower(cu.email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.cmms_current_cmms_user_id(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_current_cmms_user_id(UUID) TO authenticated;

-- There is deliberately no separate "Welfare" tool -- but deciding leave,
-- probation, and general HR requests is still its own real, admin-picked
-- permission: a dedicated "welfare" action on the existing Staff Attendance
-- tool (Role and tool configuration -> Staff attendance & QR check-in ->
-- "Welfare" checkbox), read the same way every other attendance action is
-- via cmms_attendance_has_action(). This is deliberately NOT folded into
-- Manual/Add-days/Payroll-Approve -- those exist for other reasons (moving
-- another staff member's clock, crediting attendance days, deciding salary
-- advances) and an admin should be free to grant any of them without
-- automatically also granting HR approval power, or the reverse. Every
-- employee can always submit a request regardless of this flag -- it only
-- gates deciding one.
CREATE OR REPLACE FUNCTION public.cmms_can_manage_welfare(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT public.cmms_attendance_qr_admin(p_company_id)
      OR public.cmms_attendance_has_action(p_company_id, 'welfare');
$$;

REVOKE ALL ON FUNCTION public.cmms_can_manage_welfare(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_can_manage_welfare(UUID) TO authenticated;

-- Read-only visibility of the company-wide welfare dashboard -- anyone who
-- can manage it, plus a plain Attendance "view" role (the same "see every
-- staff member's records" grant that already unlocks the attendance Records
-- tab for someone else).
CREATE OR REPLACE FUNCTION public.cmms_can_view_welfare(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT public.cmms_can_manage_welfare(p_company_id)
      OR public.cmms_attendance_has_action(p_company_id, 'view');
$$;

REVOKE ALL ON FUNCTION public.cmms_can_view_welfare(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_can_view_welfare(UUID) TO authenticated;

-- ============================================================
-- 1. Leave types + balances
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_leave_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  -- Yearly entitlement a fresh balance row is seeded with. 0 means
  -- "uncapped" (no balance check on request) -- used for unpaid leave by
  -- default, but any type can be set to 0 by an admin who wants it uncapped.
  default_annual_days NUMERIC(6,2) NOT NULL DEFAULT 0,
  is_paid BOOLEAN NOT NULL DEFAULT TRUE,
  -- UI hint only ("please attach a doctor's note / supporting letter") --
  -- not enforced server-side so a request is never blocked by a missing
  -- upload.
  requires_document BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cmms_company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_leave_types_company ON public.cmms_leave_types(cmms_company_id, is_active);

-- Lazily seeds a sensible default set of leave types the first time a
-- company touches the welfare module, instead of needing a signup-time
-- trigger. Safe to call repeatedly (ON CONFLICT DO NOTHING).
CREATE OR REPLACE FUNCTION public.cmms_ensure_default_leave_types(p_company_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Guard against an unrelated signed-in user seeding rows for a company
  -- they have nothing to do with -- harmless template data, but no reason
  -- to allow it from outside the company.
  IF NOT (public.cmms_active_staff(p_company_id) OR public.cmms_can_view_welfare(p_company_id)) THEN
    RETURN;
  END IF;

  INSERT INTO public.cmms_leave_types (cmms_company_id, code, name, description, default_annual_days, is_paid, requires_document)
  VALUES
    (p_company_id, 'annual', 'Annual Leave', 'Yearly paid time off for rest and personal time.', 21, TRUE, FALSE),
    (p_company_id, 'sick', 'Sick Leave', 'Time off to recover from illness or injury.', 30, TRUE, TRUE),
    (p_company_id, 'maternity', 'Maternity Leave', 'Leave around the birth of a child.', 60, TRUE, TRUE),
    (p_company_id, 'paternity', 'Paternity Leave', 'Leave for a father following the birth of a child.', 4, TRUE, FALSE),
    (p_company_id, 'compassionate', 'Compassionate / Bereavement Leave', 'Leave following the death or serious illness of a close family member.', 5, TRUE, FALSE),
    (p_company_id, 'study', 'Study Leave', 'Leave to sit exams or attend approved further education.', 10, FALSE, TRUE),
    (p_company_id, 'emergency', 'Emergency Leave', 'Short-notice leave for an urgent personal matter.', 3, TRUE, FALSE),
    (p_company_id, 'unpaid', 'Unpaid Leave', 'Leave without pay, by agreement with the company.', 0, FALSE, FALSE)
  ON CONFLICT (cmms_company_id, code) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_ensure_default_leave_types(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_ensure_default_leave_types(UUID) TO authenticated;

CREATE TABLE IF NOT EXISTS public.cmms_leave_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  employee_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  leave_type_id UUID NOT NULL REFERENCES public.cmms_leave_types(id) ON DELETE CASCADE,
  leave_year INTEGER NOT NULL,
  entitled_days NUMERIC(6,2) NOT NULL DEFAULT 0,
  used_days NUMERIC(6,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_user_id, leave_type_id, leave_year)
);

CREATE INDEX IF NOT EXISTS idx_leave_balances_company ON public.cmms_leave_balances(cmms_company_id, leave_year);
CREATE INDEX IF NOT EXISTS idx_leave_balances_employee ON public.cmms_leave_balances(employee_user_id, leave_year);

CREATE OR REPLACE FUNCTION public.cmms_ensure_leave_balance(
  p_company_id UUID, p_employee_user_id UUID, p_leave_type_id UUID, p_year INTEGER
)
RETURNS public.cmms_leave_balances
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_balance public.cmms_leave_balances;
  v_default NUMERIC(6,2);
BEGIN
  SELECT * INTO v_balance FROM public.cmms_leave_balances
   WHERE employee_user_id = p_employee_user_id AND leave_type_id = p_leave_type_id AND leave_year = p_year;
  IF v_balance.id IS NOT NULL THEN RETURN v_balance; END IF;

  SELECT default_annual_days INTO v_default FROM public.cmms_leave_types WHERE id = p_leave_type_id;

  INSERT INTO public.cmms_leave_balances (cmms_company_id, employee_user_id, leave_type_id, leave_year, entitled_days)
  VALUES (p_company_id, p_employee_user_id, p_leave_type_id, p_year, COALESCE(v_default, 0))
  ON CONFLICT (employee_user_id, leave_type_id, leave_year) DO UPDATE SET leave_year = EXCLUDED.leave_year
  RETURNING * INTO v_balance;
  RETURN v_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_ensure_leave_balance(UUID, UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_ensure_leave_balance(UUID, UUID, UUID, INTEGER) TO authenticated;

-- ============================================================
-- 2. Leave requests
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  employee_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cmms_user_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  leave_type_id UUID NOT NULL REFERENCES public.cmms_leave_types(id) ON DELETE RESTRICT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_days NUMERIC(6,2) NOT NULL,
  reason TEXT,
  supporting_document_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_company ON public.cmms_leave_requests(cmms_company_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON public.cmms_leave_requests(employee_user_id, status);

-- ============================================================
-- 3. Probation
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_probation_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  employee_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cmms_user_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  start_date DATE NOT NULL,
  -- Exactly one of these is set, per the duration unit HR picked when
  -- starting probation (e.g. "14 days" for a short trial, "3 months" for a
  -- standard one) -- see the duration_days/duration_months ALTER below and
  -- start_employee_probation's p_duration_unit.
  duration_months NUMERIC(4,1),
  probation_end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'on_probation'
    CHECK (status IN ('on_probation', 'confirmed', 'extended', 'terminated')),
  outcome_note TEXT,
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ALTER (not just a column in the CREATE above) so this still applies if
-- the table already exists from an earlier run of this file, back when
-- probation duration was months-only.
ALTER TABLE public.cmms_probation_records ALTER COLUMN duration_months DROP NOT NULL;
ALTER TABLE public.cmms_probation_records ALTER COLUMN duration_months DROP DEFAULT;
ALTER TABLE public.cmms_probation_records ADD COLUMN IF NOT EXISTS duration_days INTEGER;

CREATE INDEX IF NOT EXISTS idx_probation_company ON public.cmms_probation_records(cmms_company_id, status);
-- Only one currently-active probation spell per employee.
CREATE UNIQUE INDEX IF NOT EXISTS uq_probation_one_active_per_employee
  ON public.cmms_probation_records(employee_user_id)
  WHERE status IN ('on_probation', 'extended');

CREATE TABLE IF NOT EXISTS public.cmms_probation_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  probation_id UUID NOT NULL REFERENCES public.cmms_probation_records(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  review_date DATE NOT NULL DEFAULT CURRENT_DATE,
  rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
  strengths TEXT,
  areas_for_improvement TEXT,
  recommendation TEXT CHECK (recommendation IN ('confirm', 'extend', 'terminate')),
  comments TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_probation_reviews_probation ON public.cmms_probation_reviews(probation_id);

-- ============================================================
-- 4. General welfare requests (grievances, wellness, flexible work,
--    training sponsorship, medical/bereavement assistance, other)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cmms_welfare_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  employee_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cmms_user_id UUID REFERENCES public.cmms_users(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN (
    'grievance', 'wellness_counseling', 'flexible_work',
    'training_sponsorship', 'medical_assistance', 'bereavement_support', 'other'
  )),
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  -- A grievance/counseling request marked confidential is still visible to
  -- HR (they must act on it) but the frontend hides it from any general
  -- "team activity" style views -- HR-only detail, never department-wide.
  is_confidential BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'in_review', 'resolved', 'declined')),
  response TEXT,
  responded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_welfare_requests_company ON public.cmms_welfare_requests(cmms_company_id, status);
CREATE INDEX IF NOT EXISTS idx_welfare_requests_employee ON public.cmms_welfare_requests(employee_user_id, status);

-- ============================================================
-- 5. RLS — direct reads only; every write goes through a SECURITY DEFINER
--    function below, same convention as CMMS_SALARY_ADVANCE_REQUESTS.sql.
-- ============================================================

ALTER TABLE public.cmms_leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_probation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_probation_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_welfare_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cmms_leave_types_read ON public.cmms_leave_types;
CREATE POLICY cmms_leave_types_read ON public.cmms_leave_types
  FOR SELECT TO authenticated
  USING (public.cmms_active_staff(cmms_company_id) OR public.cmms_can_view_welfare(cmms_company_id));

DROP POLICY IF EXISTS cmms_leave_types_manage ON public.cmms_leave_types;
CREATE POLICY cmms_leave_types_manage ON public.cmms_leave_types
  FOR ALL TO authenticated
  USING (public.cmms_can_manage_welfare(cmms_company_id))
  WITH CHECK (public.cmms_can_manage_welfare(cmms_company_id));

DROP POLICY IF EXISTS cmms_leave_balances_read ON public.cmms_leave_balances;
CREATE POLICY cmms_leave_balances_read ON public.cmms_leave_balances
  FOR SELECT TO authenticated
  USING (employee_user_id = auth.uid() OR public.cmms_can_view_welfare(cmms_company_id));

DROP POLICY IF EXISTS cmms_leave_requests_read ON public.cmms_leave_requests;
CREATE POLICY cmms_leave_requests_read ON public.cmms_leave_requests
  FOR SELECT TO authenticated
  USING (employee_user_id = auth.uid() OR public.cmms_can_view_welfare(cmms_company_id));

DROP POLICY IF EXISTS cmms_probation_records_read ON public.cmms_probation_records;
CREATE POLICY cmms_probation_records_read ON public.cmms_probation_records
  FOR SELECT TO authenticated
  USING (employee_user_id = auth.uid() OR public.cmms_can_view_welfare(cmms_company_id));

DROP POLICY IF EXISTS cmms_probation_reviews_read ON public.cmms_probation_reviews;
CREATE POLICY cmms_probation_reviews_read ON public.cmms_probation_reviews
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cmms_probation_records p
      WHERE p.id = probation_id
        AND (p.employee_user_id = auth.uid() OR public.cmms_can_view_welfare(p.cmms_company_id))
    )
  );

DROP POLICY IF EXISTS cmms_welfare_requests_read ON public.cmms_welfare_requests;
CREATE POLICY cmms_welfare_requests_read ON public.cmms_welfare_requests
  FOR SELECT TO authenticated
  USING (employee_user_id = auth.uid() OR public.cmms_can_view_welfare(cmms_company_id));

-- ============================================================
-- 6. Leave request workflow RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.request_leave(
  p_cmms_company_id UUID,
  p_leave_type_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_reason TEXT DEFAULT NULL,
  p_supporting_document_url TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_leave_type public.cmms_leave_types;
  v_balance public.cmms_leave_balances;
  v_days NUMERIC(6,2);
  v_year INTEGER;
  v_request_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required to request leave';
  END IF;
  IF NOT public.cmms_active_staff(p_cmms_company_id) THEN
    RAISE EXCEPTION 'You are not an active member of this company';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'The end date cannot be before the start date';
  END IF;

  PERFORM public.cmms_ensure_default_leave_types(p_cmms_company_id);

  SELECT * INTO v_leave_type FROM public.cmms_leave_types
   WHERE id = p_leave_type_id AND cmms_company_id = p_cmms_company_id AND is_active;
  IF v_leave_type.id IS NULL THEN
    RAISE EXCEPTION 'Select a valid leave type';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cmms_leave_requests
     WHERE employee_user_id = auth.uid()
       AND status IN ('pending', 'approved')
       AND cmms_company_id = p_cmms_company_id
       AND start_date <= p_end_date AND end_date >= p_start_date
  ) THEN
    RAISE EXCEPTION 'You already have a pending or approved leave request overlapping these dates';
  END IF;

  v_days := public.cmms_count_leave_days(p_start_date, p_end_date);
  v_year := EXTRACT(YEAR FROM p_start_date)::INTEGER;
  v_balance := public.cmms_ensure_leave_balance(p_cmms_company_id, auth.uid(), p_leave_type_id, v_year);

  IF v_balance.entitled_days > 0 AND (v_balance.used_days + v_days) > v_balance.entitled_days THEN
    RAISE EXCEPTION 'This request needs % day(s) but only % day(s) remain of your % balance for %',
      v_days, (v_balance.entitled_days - v_balance.used_days), v_leave_type.name, v_year;
  END IF;

  INSERT INTO public.cmms_leave_requests (
    cmms_company_id, employee_user_id, cmms_user_id, leave_type_id,
    start_date, end_date, total_days, reason, supporting_document_url
  ) VALUES (
    p_cmms_company_id, auth.uid(), public.cmms_current_cmms_user_id(p_cmms_company_id), p_leave_type_id,
    p_start_date, p_end_date, v_days, NULLIF(TRIM(p_reason), ''), NULLIF(TRIM(p_supporting_document_url), '')
  ) RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_leave(UUID, UUID, DATE, DATE, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_leave(UUID, UUID, DATE, DATE, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.decide_leave_request(
  p_request_id UUID, p_decision TEXT, p_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_request public.cmms_leave_requests;
  v_leave_type public.cmms_leave_types;
  v_company public.cmms_company_profiles;
  v_comp public.business_compensation_profiles;
  v_period public.business_payroll_periods;
BEGIN
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected';
  END IF;

  SELECT * INTO v_request FROM public.cmms_leave_requests WHERE id = p_request_id FOR UPDATE;
  IF v_request.id IS NULL THEN RAISE EXCEPTION 'Leave request not found'; END IF;
  IF v_request.status <> 'pending' THEN RAISE EXCEPTION 'This request has already been decided'; END IF;
  IF NOT public.cmms_can_manage_welfare(v_request.cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to decide leave requests for this company';
  END IF;

  UPDATE public.cmms_leave_requests
     SET status = p_decision, decided_by = auth.uid(), decided_at = now(),
         decision_note = NULLIF(TRIM(p_note), ''), updated_at = now()
   WHERE id = p_request_id;

  IF p_decision <> 'approved' THEN RETURN; END IF;

  UPDATE public.cmms_leave_balances
     SET used_days = used_days + v_request.total_days, updated_at = now()
   WHERE employee_user_id = v_request.employee_user_id
     AND leave_type_id = v_request.leave_type_id
     AND leave_year = EXTRACT(YEAR FROM v_request.start_date)::INTEGER;

  -- PAYROLL SAFETY NET, part 1: a daily-paid employee only ever earns pay
  -- for a day by physically checking out (cmms_settle_attendance_pay) --
  -- which never happens on a day they're on approved leave, so that pay
  -- would otherwise simply vanish. Give them a normal DRAFT payroll entry
  -- for the leave span instead: it lands in the exact same payroll review
  -- queue as every other entry (CMMSPayrollPanel / "My Salary" already show
  -- draft entries as "waiting to be paid"), so HR/payroll still explicitly
  -- reviews and pays it through the existing approve -> pay flow. Nothing
  -- is auto-paid here. Unpaid leave and every non-daily pay type is instead
  -- handled live by cmms_checkout_pay_status / get_attendance_summary /
  -- cmms_apply_leave_payroll_deductions below, with no write needed here.
  SELECT * INTO v_leave_type FROM public.cmms_leave_types WHERE id = v_request.leave_type_id;
  IF NOT v_leave_type.is_paid THEN RETURN; END IF;

  SELECT * INTO v_company FROM public.cmms_company_profiles WHERE id = v_request.cmms_company_id;
  IF v_company.pichin_business_profile_id IS NULL THEN RETURN; END IF;

  SELECT * INTO v_comp FROM public.business_compensation_profiles
   WHERE business_profile_id = v_company.pichin_business_profile_id
     AND employee_user_id = v_request.employee_user_id
     AND payroll_status = 'on_pay' AND pay_frequency = 'daily'
     AND effective_from <= v_request.end_date
     AND (effective_to IS NULL OR effective_to >= v_request.start_date)
   ORDER BY effective_from DESC LIMIT 1;
  IF v_comp.id IS NULL THEN RETURN; END IF; -- not a daily-paid employee, or no active compensation profile

  INSERT INTO public.business_payroll_periods (business_profile_id, period_start, period_end, created_by)
  VALUES (v_company.pichin_business_profile_id, v_request.start_date, v_request.end_date, auth.uid())
  ON CONFLICT (business_profile_id, period_start, period_end) DO UPDATE SET business_profile_id = EXCLUDED.business_profile_id
  RETURNING * INTO v_period;

  INSERT INTO public.business_payroll_entries (
    payroll_period_id, business_profile_id, employee_user_id, base_amount, status, metadata
  ) VALUES (
    v_period.id, v_company.pichin_business_profile_id, v_request.employee_user_id,
    ROUND(v_comp.base_salary * v_request.total_days, 2), 'draft',
    jsonb_build_object('currency', v_comp.currency, 'pay_frequency', 'daily', 'source', 'paid_leave',
      'leave_request_id', v_request.id, 'leave_type', v_leave_type.code, 'leave_days', v_request.total_days)
  )
  -- Only ever touches an entry still sitting in draft (never one already
  -- approved/paid, e.g. from a genuine same-range checkout) -- an update
  -- that doesn't match the WHERE is simply a safe no-op.
  ON CONFLICT (payroll_period_id, employee_user_id) DO UPDATE SET
    base_amount = EXCLUDED.base_amount, metadata = public.business_payroll_entries.metadata || EXCLUDED.metadata, updated_at = now()
  WHERE public.business_payroll_entries.status = 'draft';
END;
$$;

REVOKE ALL ON FUNCTION public.decide_leave_request(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_leave_request(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_leave_request(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_request public.cmms_leave_requests;
BEGIN
  SELECT * INTO v_request FROM public.cmms_leave_requests WHERE id = p_request_id FOR UPDATE;
  IF v_request.id IS NULL THEN RAISE EXCEPTION 'Leave request not found'; END IF;

  IF v_request.employee_user_id <> auth.uid() AND NOT public.cmms_can_manage_welfare(v_request.cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to cancel this request';
  END IF;
  IF v_request.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'Only a pending or approved request can be cancelled';
  END IF;
  IF v_request.status = 'approved' AND v_request.start_date <= CURRENT_DATE THEN
    RAISE EXCEPTION 'This leave has already started and can no longer be cancelled here -- contact HR';
  END IF;

  IF v_request.status = 'approved' THEN
    UPDATE public.cmms_leave_balances
       SET used_days = GREATEST(used_days - v_request.total_days, 0), updated_at = now()
     WHERE employee_user_id = v_request.employee_user_id
       AND leave_type_id = v_request.leave_type_id
       AND leave_year = EXTRACT(YEAR FROM v_request.start_date)::INTEGER;

    -- Undo the draft payroll entry decide_leave_request may have created for
    -- a daily-paid employee's paid leave (see there). Only ever cancels an
    -- entry still in draft -- one already approved/paid means HR has since
    -- acted on it, and this cancel path is already blocked once the leave
    -- has started, so that shouldn't happen in practice.
    UPDATE public.business_payroll_entries
       SET status = 'cancelled', updated_at = now()
     WHERE status = 'draft' AND (metadata->>'leave_request_id') = v_request.id::TEXT;
  END IF;

  UPDATE public.cmms_leave_requests SET status = 'cancelled', updated_at = now() WHERE id = p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_leave_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_leave_request(UUID) TO authenticated;

-- Self-scoped reads (see the module header note on why these are dedicated
-- RPCs rather than a plain table select from the frontend).
CREATE OR REPLACE FUNCTION public.get_my_leave_requests(p_cmms_company_id UUID)
RETURNS SETOF public.cmms_leave_requests
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.cmms_leave_requests
   WHERE cmms_company_id = p_cmms_company_id AND employee_user_id = auth.uid()
   ORDER BY created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_leave_requests(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_leave_requests(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_leave_balances(p_cmms_company_id UUID, p_year INTEGER DEFAULT NULL)
RETURNS TABLE (
  leave_type_id UUID, code TEXT, name TEXT, is_paid BOOLEAN, requires_document BOOLEAN,
  leave_year INTEGER, entitled_days NUMERIC, used_days NUMERIC, remaining_days NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_year INTEGER := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER);
  v_type RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  PERFORM public.cmms_ensure_default_leave_types(p_cmms_company_id);

  FOR v_type IN
    SELECT * FROM public.cmms_leave_types
     WHERE cmms_company_id = p_cmms_company_id AND is_active
     ORDER BY name
  LOOP
    PERFORM public.cmms_ensure_leave_balance(p_cmms_company_id, auth.uid(), v_type.id, v_year);
    RETURN QUERY
      SELECT v_type.id, v_type.code, v_type.name, v_type.is_paid, v_type.requires_document,
             b.leave_year, b.entitled_days, b.used_days,
             GREATEST(b.entitled_days - b.used_days, 0) AS remaining_days
        FROM public.cmms_leave_balances b
       WHERE b.employee_user_id = auth.uid() AND b.leave_type_id = v_type.id AND b.leave_year = v_year;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_leave_balances(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_leave_balances(UUID, INTEGER) TO authenticated;

-- ============================================================
-- 7. Probation workflow RPCs
-- ============================================================

-- A new parameter means CREATE OR REPLACE below would ADD an overload
-- rather than replace the old 4-arg version (Postgres identifies a function
-- by name + argument types) -- drop it explicitly so callers, and
-- PostgREST's RPC dispatch, only ever see the one current signature.
DROP FUNCTION IF EXISTS public.start_employee_probation(UUID, UUID, DATE, NUMERIC);

CREATE OR REPLACE FUNCTION public.start_employee_probation(
  p_cmms_company_id UUID, p_cmms_user_id UUID, p_start_date DATE DEFAULT CURRENT_DATE,
  p_duration_value NUMERIC DEFAULT 3, p_duration_unit TEXT DEFAULT 'months'
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_target public.cmms_users;
  v_probation_id UUID;
  v_end_date DATE;
BEGIN
  IF NOT public.cmms_can_manage_welfare(p_cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to start a probation record for this company';
  END IF;
  IF p_duration_unit NOT IN ('days', 'months') THEN
    RAISE EXCEPTION 'Probation duration unit must be days or months';
  END IF;
  IF p_duration_value IS NULL OR p_duration_value <= 0 THEN
    RAISE EXCEPTION 'Probation duration must be greater than zero';
  END IF;

  SELECT * INTO v_target FROM public.cmms_users WHERE id = p_cmms_user_id AND cmms_company_id = p_cmms_company_id;
  IF v_target.id IS NULL THEN RAISE EXCEPTION 'Employee not found in this company'; END IF;
  IF v_target.ican_user_id IS NULL THEN
    RAISE EXCEPTION 'This employee is not linked to an ICAN account yet, so a probation record cannot be created for them';
  END IF;

  v_end_date := CASE
    WHEN p_duration_unit = 'days' THEN p_start_date + ROUND(p_duration_value)::INTEGER
    ELSE (p_start_date + (p_duration_value || ' months')::INTERVAL)::DATE
  END;

  BEGIN
    INSERT INTO public.cmms_probation_records (
      cmms_company_id, employee_user_id, cmms_user_id, start_date,
      duration_months, duration_days, probation_end_date, created_by
    ) VALUES (
      p_cmms_company_id, v_target.ican_user_id, v_target.id, p_start_date,
      CASE WHEN p_duration_unit = 'months' THEN p_duration_value ELSE NULL END,
      CASE WHEN p_duration_unit = 'days' THEN ROUND(p_duration_value)::INTEGER ELSE NULL END,
      v_end_date, auth.uid()
    ) RETURNING id INTO v_probation_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This employee already has an active probation record';
  END;

  RETURN v_probation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.start_employee_probation(UUID, UUID, DATE, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_employee_probation(UUID, UUID, DATE, NUMERIC, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_probation_review(
  p_probation_id UUID, p_rating SMALLINT DEFAULT NULL, p_strengths TEXT DEFAULT NULL,
  p_areas_for_improvement TEXT DEFAULT NULL, p_recommendation TEXT DEFAULT NULL, p_comments TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_probation public.cmms_probation_records;
  v_review_id UUID;
BEGIN
  SELECT * INTO v_probation FROM public.cmms_probation_records WHERE id = p_probation_id;
  IF v_probation.id IS NULL THEN RAISE EXCEPTION 'Probation record not found'; END IF;
  IF NOT public.cmms_can_manage_welfare(v_probation.cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to review probation for this company';
  END IF;
  IF v_probation.status NOT IN ('on_probation', 'extended') THEN
    RAISE EXCEPTION 'This probation has already been closed out';
  END IF;

  INSERT INTO public.cmms_probation_reviews (
    probation_id, reviewer_id, rating, strengths, areas_for_improvement, recommendation, comments
  ) VALUES (
    p_probation_id, auth.uid(), p_rating, NULLIF(TRIM(p_strengths), ''),
    NULLIF(TRIM(p_areas_for_improvement), ''), NULLIF(p_recommendation, ''), NULLIF(TRIM(p_comments), '')
  ) RETURNING id INTO v_review_id;

  RETURN v_review_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_probation_review(UUID, SMALLINT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_probation_review(UUID, SMALLINT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.decide_probation(
  p_probation_id UUID, p_decision TEXT, p_note TEXT DEFAULT NULL, p_new_end_date DATE DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_probation public.cmms_probation_records;
BEGIN
  IF p_decision NOT IN ('confirmed', 'extended', 'terminated') THEN
    RAISE EXCEPTION 'Decision must be confirmed, extended, or terminated';
  END IF;

  SELECT * INTO v_probation FROM public.cmms_probation_records WHERE id = p_probation_id FOR UPDATE;
  IF v_probation.id IS NULL THEN RAISE EXCEPTION 'Probation record not found'; END IF;
  IF NOT public.cmms_can_manage_welfare(v_probation.cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to decide probation outcomes for this company';
  END IF;
  IF v_probation.status NOT IN ('on_probation', 'extended') THEN
    RAISE EXCEPTION 'This probation has already been closed out';
  END IF;
  IF p_decision = 'extended' AND p_new_end_date IS NULL THEN
    RAISE EXCEPTION 'A new end date is required to extend probation';
  END IF;

  UPDATE public.cmms_probation_records
     SET status = p_decision,
         probation_end_date = CASE WHEN p_decision = 'extended' THEN p_new_end_date ELSE probation_end_date END,
         outcome_note = NULLIF(TRIM(p_note), ''), decided_by = auth.uid(), decided_at = now(), updated_at = now()
   WHERE id = p_probation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.decide_probation(UUID, TEXT, TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_probation(UUID, TEXT, TEXT, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_probation_status(p_cmms_company_id UUID)
RETURNS SETOF public.cmms_probation_records
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.cmms_probation_records
   WHERE cmms_company_id = p_cmms_company_id AND employee_user_id = auth.uid()
   ORDER BY created_at DESC LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_my_probation_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_probation_status(UUID) TO authenticated;

-- ============================================================
-- 8. General welfare requests RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.submit_welfare_request(
  p_cmms_company_id UUID, p_category TEXT, p_subject TEXT, p_description TEXT, p_is_confidential BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_request_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required to submit a welfare request';
  END IF;
  IF NOT public.cmms_active_staff(p_cmms_company_id) THEN
    RAISE EXCEPTION 'You are not an active member of this company';
  END IF;
  IF NULLIF(TRIM(p_subject), '') IS NULL THEN
    RAISE EXCEPTION 'A subject is required';
  END IF;
  IF NULLIF(TRIM(p_description), '') IS NULL THEN
    RAISE EXCEPTION 'Please describe your request';
  END IF;

  INSERT INTO public.cmms_welfare_requests (
    cmms_company_id, employee_user_id, cmms_user_id, category, subject, description, is_confidential
  ) VALUES (
    p_cmms_company_id, auth.uid(), public.cmms_current_cmms_user_id(p_cmms_company_id), p_category,
    TRIM(p_subject), TRIM(p_description), COALESCE(p_is_confidential, FALSE)
  ) RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_welfare_request(UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_welfare_request(UUID, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_to_welfare_request(
  p_request_id UUID, p_status TEXT, p_response TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_request public.cmms_welfare_requests;
BEGIN
  IF p_status NOT IN ('in_review', 'resolved', 'declined') THEN
    RAISE EXCEPTION 'Status must be in_review, resolved, or declined';
  END IF;

  SELECT * INTO v_request FROM public.cmms_welfare_requests WHERE id = p_request_id FOR UPDATE;
  IF v_request.id IS NULL THEN RAISE EXCEPTION 'Welfare request not found'; END IF;
  IF NOT public.cmms_can_manage_welfare(v_request.cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to respond to welfare requests for this company';
  END IF;

  UPDATE public.cmms_welfare_requests
     SET status = p_status, response = NULLIF(TRIM(p_response), ''),
         responded_by = auth.uid(), responded_at = now(), updated_at = now()
   WHERE id = p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_welfare_request(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_to_welfare_request(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_welfare_request(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_request public.cmms_welfare_requests;
BEGIN
  SELECT * INTO v_request FROM public.cmms_welfare_requests WHERE id = p_request_id FOR UPDATE;
  IF v_request.id IS NULL THEN RAISE EXCEPTION 'Welfare request not found'; END IF;
  IF v_request.employee_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Only the employee who submitted this request can withdraw it';
  END IF;
  IF v_request.status <> 'submitted' THEN
    RAISE EXCEPTION 'This request is already being handled by HR and can no longer be withdrawn here';
  END IF;

  UPDATE public.cmms_welfare_requests SET status = 'declined', response = 'Withdrawn by employee', updated_at = now()
   WHERE id = p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_welfare_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_welfare_request(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_welfare_requests(p_cmms_company_id UUID)
RETURNS SETOF public.cmms_welfare_requests
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.cmms_welfare_requests
   WHERE cmms_company_id = p_cmms_company_id AND employee_user_id = auth.uid()
   ORDER BY created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_welfare_requests(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_welfare_requests(UUID) TO authenticated;

-- ============================================================
-- 9. HR dashboard summary — headline numbers for the admin welfare screen
--    in one round trip.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_company_welfare_summary(p_cmms_company_id UUID)
RETURNS TABLE (
  pending_leave_requests BIGINT,
  employees_on_probation BIGINT,
  probations_due_within_14_days BIGINT,
  open_welfare_requests BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.cmms_can_view_welfare(p_cmms_company_id) THEN
    RAISE EXCEPTION 'You do not have permission to view the welfare dashboard for this company';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.cmms_leave_requests WHERE cmms_company_id = p_cmms_company_id AND status = 'pending'),
    (SELECT COUNT(*) FROM public.cmms_probation_records WHERE cmms_company_id = p_cmms_company_id AND status IN ('on_probation', 'extended')),
    (SELECT COUNT(*) FROM public.cmms_probation_records
      WHERE cmms_company_id = p_cmms_company_id AND status IN ('on_probation', 'extended')
        AND probation_end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '14 days'),
    (SELECT COUNT(*) FROM public.cmms_welfare_requests WHERE cmms_company_id = p_cmms_company_id AND status IN ('submitted', 'in_review'));
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_welfare_summary(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_welfare_summary(UUID) TO authenticated;

-- ============================================================================
-- 10. PAYROLL SAFETY NET, part 2 — approved leave must actually show up in
-- attendance/payroll, not just in this module's own tables. Three call
-- sites already exist for exactly this purpose and are extended here:
--
--   * get_attendance_summary (CMMS_ATTENDANCE_MANUAL_DAYS_ADJUSTMENT.sql) --
--     "days_present" now also counts approved PAID leave days, live off
--     cmms_leave_requests (never a separate ledger to keep in sync/undo on
--     cancellation). A staff member who was on paid leave the entire period
--     with zero check-ins now correctly appears at all, instead of being
--     silently absent from the summary.
--   * cmms_checkout_pay_status (CMMS_ATTENDANCE_CHECKOUT_PAY_CONFIRMATION.sql)
--     -- the same live paid-leave day count now also counts toward a
--     monthly/weekly/contract employee's monthly_work_days threshold, so
--     approved leave doesn't delay or block their "time to confirm pay"
--     prompt.
--   * cmms_apply_leave_payroll_deductions (new) -- the deduction half:
--     approved UNPAID leave overlapping a DRAFT payroll period prorates a
--     real deduction, the same reviewable-before-approval way
--     cmms_apply_attendance_payroll_deductions and
--     apply_salary_advance_recovery already work. Currently this system has
--     no absence penalty at all for salaried staff (deductions only exist
--     for lateness on days actually worked) -- without this, "unpaid leave"
--     would cost nothing, which is wrong.
--
-- (A daily-paid employee's approved PAID leave is handled separately, in
-- decide_leave_request above, with an immediate draft payroll entry --
-- daily pay is only ever earned per attended day, so it can't be picked up
-- by a period-level summary/deduction the way monthly pay can.)
-- ============================================================================

-- CREATE OR REPLACE cannot add a new OUT column to an existing function, so
-- the old signature must be dropped first (same reason
-- CMMS_ATTENDANCE_MANUAL_DAYS_ADJUSTMENT.sql dropped it before adding
-- manual_days_added).
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
  paid_leave_days_present BIGINT,
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
  ),
  leave_credit AS (
    -- Approved PAID leave, clipped to the requested window, so a leave
    -- request that only partly overlaps [p_start_date, p_end_date] counts
    -- just the overlapping weekdays -- not the whole request.
    SELECT cu.id AS cmms_user_id,
           COALESCE(SUM(public.cmms_count_leave_days(
             GREATEST(r.start_date, COALESCE(p_start_date, r.start_date)),
             LEAST(r.end_date, COALESCE(p_end_date, r.end_date))
           )), 0)::BIGINT AS paid_leave_days
      FROM public.cmms_leave_requests r
      JOIN public.cmms_leave_types lt ON lt.id = r.leave_type_id
      JOIN public.cmms_users cu ON cu.cmms_company_id = p_cmms_company_id AND cu.ican_user_id = r.employee_user_id
     WHERE r.cmms_company_id = p_cmms_company_id
       AND r.status = 'approved'
       AND lt.is_paid
       AND (p_start_date IS NULL OR r.end_date >= p_start_date)
       AND (p_end_date IS NULL OR r.start_date <= p_end_date)
       AND (p_user_id IS NULL OR cu.id = p_user_id)
       AND (v_is_admin OR cu.id = v_current_user_id)
     GROUP BY cu.id
  ),
  -- checkins alone (an INNER JOIN on cmms_staff_attendance) misses anyone
  -- with zero check-ins in the window -- exactly the case that matters most
  -- here: someone on approved paid leave the whole period. Union every
  -- source's user ids first, then LEFT JOIN each source onto that.
  all_users AS (
    SELECT cmms_user_id FROM checkins
    UNION
    SELECT cmms_user_id FROM adjustments
    UNION
    SELECT cmms_user_id FROM leave_credit
  ),
  -- Computed in its own CTE, then ordered from a clean single-relation
  -- SELECT below -- otherwise "days_present"/"user_name" would be ambiguous
  -- between this query's own output alias and the same-named raw columns
  -- still in scope from the joined "checkins"/cmms_users relations (and
  -- ORDER BY would silently prefer the wrong one instead of erroring).
  combined AS (
    SELECT au.cmms_user_id AS out_cmms_user_id,
           COALESCE(c.user_name, COALESCE(u.full_name, u.user_name))::TEXT AS out_user_name,
           COALESCE(c.user_email, u.email)::TEXT AS out_user_email,
           COALESCE(c.check_in_count, 0)::BIGINT AS out_check_in_count,
           COALESCE(c.days_present, 0) + COALESCE(a.manual_days_added, 0) + COALESCE(l.paid_leave_days, 0) AS out_days_present,
           COALESCE(a.manual_days_added, 0) AS out_manual_days_added,
           COALESCE(l.paid_leave_days, 0) AS out_paid_leave_days_present,
           c.first_check_in_time AS out_first_check_in_time,
           c.last_check_in_time AS out_last_check_in_time,
           c.last_check_out_time AS out_last_check_out_time,
           COALESCE(c.currently_checked_in, FALSE) AS out_currently_checked_in
      FROM all_users au
      LEFT JOIN checkins c ON c.cmms_user_id = au.cmms_user_id
      LEFT JOIN adjustments a ON a.cmms_user_id = au.cmms_user_id
      LEFT JOIN leave_credit l ON l.cmms_user_id = au.cmms_user_id
      LEFT JOIN public.cmms_users u ON u.id = au.cmms_user_id
  )
  SELECT out_cmms_user_id, out_user_name, out_user_email, out_check_in_count,
         out_days_present, out_manual_days_added, out_paid_leave_days_present,
         out_first_check_in_time, out_last_check_in_time, out_last_check_out_time, out_currently_checked_in
    FROM combined
   ORDER BY out_days_present DESC, out_user_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_attendance_summary(UUID, DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_attendance_summary(UUID, DATE, DATE, UUID) TO authenticated;

-- cmms_checkout_pay_status keeps its original JSONB-returning signature, so
-- no DROP is needed -- only the body changes (v_days_so_far now also counts
-- approved paid leave live, the same clipped-overlap calculation as above).
CREATE OR REPLACE FUNCTION public.cmms_checkout_pay_status(
  p_cmms_user_id UUID,
  p_cmms_company_id UUID,
  p_attendance_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff public.cmms_users;
  v_business_profile_id UUID;
  v_comp public.business_compensation_profiles;
  v_settings public.cmms_attendance_payroll_settings;
  v_attendance public.cmms_staff_attendance;
  v_tz TEXT;
  v_today DATE;
  v_period_start DATE;
  v_period_end DATE;
  v_days_so_far INTEGER;
  v_leave_days INTEGER;
  v_already_settled BOOLEAN;
  v_required BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_staff FROM public.cmms_users WHERE id = p_cmms_user_id AND cmms_company_id = p_cmms_company_id;
  IF v_staff.id IS NULL OR v_staff.ican_user_id IS NULL THEN
    RETURN jsonb_build_object('required', false, 'reason', 'not_linked');
  END IF;

  SELECT pichin_business_profile_id INTO v_business_profile_id
    FROM public.cmms_company_profiles WHERE id = p_cmms_company_id;
  IF v_business_profile_id IS NULL THEN
    RETURN jsonb_build_object('required', false, 'reason', 'no_business_profile');
  END IF;

  SELECT * INTO v_settings FROM public.cmms_attendance_payroll_settings WHERE cmms_company_id = p_cmms_company_id;
  v_tz := COALESCE(v_settings.timezone, 'UTC');

  -- The pay period must track the day actually worked, not the moment this
  -- function happens to be called (e.g. a late-night check-out crossing
  -- midnight, or an admin settling a backfilled attendance row later). Prefer
  -- the specific attendance record being checked out; fall back to the
  -- staff member's currently open check-in; only use "now" when neither
  -- attendance record is known (a pre-check with no check-in yet).
  IF p_attendance_id IS NOT NULL THEN
    SELECT * INTO v_attendance FROM public.cmms_staff_attendance
     WHERE id = p_attendance_id AND cmms_user_id = p_cmms_user_id AND cmms_company_id = p_cmms_company_id;
  END IF;
  IF v_attendance.id IS NULL THEN
    SELECT * INTO v_attendance FROM public.cmms_staff_attendance
     WHERE cmms_user_id = p_cmms_user_id AND cmms_company_id = p_cmms_company_id AND status = 'checked_in'
     ORDER BY check_in_time DESC LIMIT 1;
  END IF;
  v_today := (COALESCE(v_attendance.check_in_time, now()) AT TIME ZONE v_tz)::date;

  SELECT * INTO v_comp
    FROM public.business_compensation_profiles
   WHERE business_profile_id = v_business_profile_id
     AND employee_user_id = v_staff.ican_user_id
     AND payroll_status = 'on_pay'
     AND effective_from <= v_today
     AND (effective_to IS NULL OR effective_to >= v_today)
   ORDER BY effective_from DESC
   LIMIT 1;

  IF v_comp.id IS NULL THEN
    RETURN jsonb_build_object('required', false, 'reason', 'no_compensation_profile');
  END IF;

  IF COALESCE(v_comp.pay_frequency, 'monthly') = 'daily' THEN
    v_period_start := v_today;
    v_period_end := v_today;
    v_required := TRUE;
  ELSE
    -- Monthly/weekly/hourly/contract staff settle once, at the agreed
    -- number-of-days mark for the current calendar month.
    IF v_settings.cmms_company_id IS NULL OR NOT v_settings.enabled THEN
      RETURN jsonb_build_object('required', false, 'reason', 'attendance_payroll_not_configured');
    END IF;
    v_period_start := date_trunc('month', v_today)::date;
    v_period_end := (date_trunc('month', v_today) + INTERVAL '1 month' - INTERVAL '1 day')::date;

    SELECT COUNT(DISTINCT (a.check_in_time AT TIME ZONE v_tz)::date) INTO v_days_so_far
      FROM public.cmms_staff_attendance a
     WHERE a.cmms_user_id = p_cmms_user_id
       AND a.status = 'checked_out'
       AND (a.check_in_time AT TIME ZONE v_tz)::date BETWEEN v_period_start AND v_period_end;

    -- Approved paid leave counts toward the "days worked this month" mark
    -- too -- otherwise someone on legitimate approved leave for part of the
    -- month could never reach monthly_work_days through check-ins alone,
    -- and their pay confirmation would never trigger.
    SELECT COALESCE(SUM(public.cmms_count_leave_days(
             GREATEST(r.start_date, v_period_start), LEAST(r.end_date, v_period_end)
           )), 0) INTO v_leave_days
      FROM public.cmms_leave_requests r
      JOIN public.cmms_leave_types lt ON lt.id = r.leave_type_id
     WHERE r.employee_user_id = v_staff.ican_user_id
       AND r.cmms_company_id = p_cmms_company_id
       AND r.status = 'approved'
       AND lt.is_paid
       AND r.start_date <= v_period_end AND r.end_date >= v_period_start;

    SELECT EXISTS (
      SELECT 1 FROM public.cmms_attendance_pay_confirmations c
       WHERE c.cmms_user_id = p_cmms_user_id AND c.paid
         AND c.period_start = v_period_start AND c.period_end = v_period_end
    ) INTO v_already_settled;

    v_required := (COALESCE(v_days_so_far, 0) + COALESCE(v_leave_days, 0) + 1) >= v_settings.monthly_work_days AND NOT v_already_settled;
  END IF;

  RETURN jsonb_build_object(
    'required', v_required,
    'pay_frequency', v_comp.pay_frequency,
    'period_start', v_period_start,
    'period_end', v_period_end,
    'amount', v_comp.base_salary,
    'currency', v_comp.currency,
    'employee_user_id', v_staff.ican_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_checkout_pay_status(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_checkout_pay_status(UUID, UUID, UUID) TO authenticated;

-- The deduction half, for approved UNPAID leave -- mirrors
-- cmms_apply_attendance_payroll_deductions exactly: draft/pending periods
-- only, replaces just its own metadata-tracked slice of `deductions` (so
-- re-running it -- e.g. after a leave request is cancelled -- corrects the
-- amount instead of double-deducting), and stays reviewable before the
-- period is approved or paid. Hourly pay_type and daily pay_frequency are
-- both skipped: either one means pay is only ever earned for units actually
-- logged, so there's nothing to prorate a deduction against.
CREATE OR REPLACE FUNCTION public.cmms_apply_leave_payroll_deductions(
  p_payroll_period_id UUID
)
RETURNS TABLE (
  payroll_entry_id UUID,
  employee_user_id UUID,
  unpaid_leave_days NUMERIC(6,2),
  deduction_amount NUMERIC(15,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period public.business_payroll_periods;
  v_company public.cmms_company_profiles;
  v_settings public.cmms_attendance_payroll_settings;
  v_monthly_work_days NUMERIC;
  v_row RECORD;
  v_unpaid_days NUMERIC(6,2);
  v_previous_deduction NUMERIC(15,2);
  v_amount NUMERIC(15,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required to apply leave payroll deductions';
  END IF;

  SELECT * INTO v_period FROM public.business_payroll_periods WHERE id = p_payroll_period_id FOR UPDATE;
  IF v_period.id IS NULL THEN RAISE EXCEPTION 'Payroll period not found'; END IF;
  IF v_period.status NOT IN ('draft', 'pending_approval') THEN
    RAISE EXCEPTION 'Leave deductions can only be applied to draft or pending payroll periods';
  END IF;

  SELECT * INTO v_company FROM public.cmms_company_profiles
   WHERE pichin_business_profile_id = v_period.business_profile_id LIMIT 1;
  IF v_company.id IS NULL THEN RAISE EXCEPTION 'No CMMS company is linked to this payroll business'; END IF;
  IF NOT (public.cmms_can_manage_attendance_payroll(v_company.id) OR public.cmms_can_manage_welfare(v_company.id)) THEN
    RAISE EXCEPTION 'You do not have permission to manage leave payroll deductions for this company';
  END IF;

  SELECT * INTO v_settings FROM public.cmms_attendance_payroll_settings WHERE cmms_company_id = v_company.id;
  -- Unpaid-leave proration only needs monthly_work_days, not the full
  -- lateness-deduction configuration -- default to 22 (a common calendar
  -- work-month) if the company never set up attendance-payroll settings.
  v_monthly_work_days := COALESCE(v_settings.monthly_work_days, 22);

  FOR v_row IN
    -- pay_type ('monthly'/'hourly'/'per_ride'/'hybrid') and pay_frequency
    -- ('hourly'/'daily'/'weekly'/'monthly'/'contract') are two separate
    -- columns on business_compensation_profiles -- "daily-paid" is
    -- pay_frequency = 'daily' (the same field cmms_checkout_pay_status and
    -- decide_leave_request key off), not pay_type. Both hourly pay_type and
    -- daily pay_frequency only ever pay for units actually logged, so
    -- either one excludes an employee from this proration.
    SELECT pe.id AS entry_id, pe.employee_user_id, pe.metadata, cp.base_salary, cp.pay_type, cp.pay_frequency
      FROM public.business_payroll_entries pe
      JOIN LATERAL (
        SELECT * FROM public.business_compensation_profiles c
        WHERE c.business_profile_id = v_period.business_profile_id
          AND c.employee_user_id = pe.employee_user_id
          AND c.payroll_status = 'on_pay'
          AND c.effective_from <= v_period.period_end
          AND (c.effective_to IS NULL OR c.effective_to >= v_period.period_start)
        ORDER BY c.effective_from DESC LIMIT 1
      ) cp ON TRUE
     WHERE pe.payroll_period_id = v_period.id AND pe.status = 'draft'
       AND COALESCE(cp.pay_type, 'monthly') <> 'hourly'
       AND COALESCE(cp.pay_frequency, 'monthly') <> 'daily'
  LOOP
    SELECT COALESCE(SUM(public.cmms_count_leave_days(
             GREATEST(r.start_date, v_period.period_start), LEAST(r.end_date, v_period.period_end)
           )), 0) INTO v_unpaid_days
      FROM public.cmms_leave_requests r
      JOIN public.cmms_leave_types lt ON lt.id = r.leave_type_id
     WHERE r.employee_user_id = v_row.employee_user_id
       AND r.cmms_company_id = v_company.id
       AND r.status = 'approved'
       AND NOT lt.is_paid
       AND r.start_date <= v_period.period_end AND r.end_date >= v_period.period_start;

    v_amount := COALESCE(ROUND((v_unpaid_days / NULLIF(v_monthly_work_days, 0)) * v_row.base_salary, 2), 0);
    v_previous_deduction := COALESCE((v_row.metadata->>'leave_deduction')::NUMERIC, 0);

    UPDATE public.business_payroll_entries
       SET deductions = GREATEST(0, deductions - v_previous_deduction + v_amount),
           metadata = jsonb_set(
             jsonb_set(COALESCE(metadata, '{}'::jsonb), '{leave_deduction}', to_jsonb(v_amount)),
             '{leave_deduction_days}', to_jsonb(v_unpaid_days)
           ),
           updated_at = now()
     WHERE id = v_row.entry_id;

    payroll_entry_id := v_row.entry_id; employee_user_id := v_row.employee_user_id;
    unpaid_leave_days := v_unpaid_days; deduction_amount := v_amount;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_apply_leave_payroll_deductions(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_apply_leave_payroll_deductions(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
