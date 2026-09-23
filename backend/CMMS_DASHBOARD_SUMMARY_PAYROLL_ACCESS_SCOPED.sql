-- ============================================================
-- CMMS Activity Dashboard -- stop leaking payroll/cash-ledger numbers to
-- every company member regardless of their actual role
-- ============================================================
-- fn_get_cmms_dashboard_summary (CMMS_DASHBOARD_SUMMARY_FULL_DAILY_METRICS.sql,
-- CMMS_DASHBOARD_SUMMARY_TIMEZONE_FIX.sql) only checked
-- cmms_current_user_id_for_company(p_company_id) IS NOT NULL -- i.e. "is this
-- person a member of the company at all" -- before computing and returning
-- salary_paid_today_ugx, salary_owed_ugx, salary_owed_count,
-- transactions_today_ugx and transactions_today_count. Because the function
-- is SECURITY DEFINER it bypasses the business_payroll_entries /
-- ican_coin_transactions RLS policies entirely, so a storeman, technician,
-- or any other role with no payroll tool access still got the company's
-- real salary-paid, salary-owed and cash-transaction figures pushed straight
-- to their home screen's Business Activity card. Everywhere else in the app
-- (CMMS_MY_SALARY_TAB_PAYROLL_ACCESS.sql, CMMS_SALARY_ADVANCE_REQUESTS.sql,
-- CMMS_PAYROLL_EMPLOYEE_DOCUMENTS.sql) gates payroll visibility behind
-- cmms_has_tool_action(company_id, 'payroll', 'view') -- company admin/
-- creator always pass, everyone else needs their role's
-- tool_access->'payroll'->>'view' grant. This brings the dashboard summary
-- in line with that same rule instead of leaving a side door open.
--
-- When the caller doesn't have payroll view access, the five fields above
-- come back NULL (not 0 -- a real "nothing owed today" is a fact the
-- payroll-viewer is entitled to see; NULL means "not shown to you", and the
-- frontend (CmmsActivityWidget.jsx) only renders those slides when the
-- values are present). Every other field is unchanged.
--
-- Run after: CMMS_DASHBOARD_SUMMARY_TIMEZONE_FIX.sql,
-- CMMS_ANNOUNCEMENTS_AND_JOBS.sql (defines cmms_has_tool_action).
-- Safe to run more than once.
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_get_cmms_dashboard_summary(UUID);
CREATE OR REPLACE FUNCTION public.fn_get_cmms_dashboard_summary(p_company_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
  v_timezone TEXT;
  v_today TIMESTAMPTZ;
  v_business_profile_id UUID;
  v_can_view_payroll BOOLEAN;
BEGIN
  -- Only a member of this CMMS company may read its dashboard.
  IF public.cmms_current_user_id_for_company(p_company_id) IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT pichin_business_profile_id INTO v_business_profile_id
  FROM public.cmms_company_profiles
  WHERE id = p_company_id;

  SELECT timezone INTO v_timezone
  FROM public.cmms_attendance_payroll_settings
  WHERE cmms_company_id = p_company_id;
  v_timezone := COALESCE(v_timezone, 'UTC');

  -- Local midnight today, as a real instant -- e.g. for Africa/Kampala
  -- (UTC+3) this is 21:00 UTC the previous day, not 00:00 UTC.
  v_today := date_trunc('day', now() AT TIME ZONE v_timezone) AT TIME ZONE v_timezone;

  -- Same rule every other payroll surface in the app already enforces:
  -- company admin/creator always sees it; anyone else needs their role's
  -- Payroll -> View grant (cmms_roles.tool_access->'payroll'->>'view').
  v_can_view_payroll := public.cmms_has_tool_action(p_company_id, 'payroll', 'view');

  SELECT json_build_object(
    'company_name', (SELECT company_name FROM public.cmms_company_profiles WHERE id = p_company_id),
    'total_departments', (
      SELECT COUNT(*) FROM public.cmms_departments
      WHERE cmms_company_id = p_company_id AND is_active = TRUE
    ),
    'total_users', (
      SELECT COUNT(*) FROM public.cmms_users
      WHERE cmms_company_id = p_company_id AND is_active = TRUE
    ),
    'total_inventory_items', (
      SELECT COUNT(*) FROM public.cmms_inventory_items
      WHERE cmms_company_id = p_company_id AND is_active = TRUE
    ),
    'total_inventory_value', (
      SELECT COALESCE(SUM(quantity_in_stock * unit_price), 0) FROM public.cmms_inventory_items
      WHERE cmms_company_id = p_company_id AND is_active = TRUE
    ),
    'low_stock_items', (
      SELECT COUNT(*) FROM public.cmms_inventory_items
      WHERE cmms_company_id = p_company_id AND is_active = TRUE
        AND quantity_in_stock <= reorder_level AND quantity_in_stock > 0
    ),
    'out_of_stock_items', (
      SELECT COUNT(*) FROM public.cmms_inventory_items
      WHERE cmms_company_id = p_company_id AND is_active = TRUE AND quantity_in_stock = 0
    ),
    'pending_requisitions', (
      SELECT COUNT(*) FROM public.cmms_requisitions
      WHERE cmms_company_id = p_company_id AND status LIKE 'pending%'
    ),
    'urgent_requisitions', (
      SELECT COUNT(*) FROM public.cmms_requisitions
      WHERE cmms_company_id = p_company_id AND status LIKE 'pending%' AND urgency_level = 'urgent'
    ),

    -- Payroll: real amount paid today + real amount still owed right now --
    -- only for callers with actual payroll view access (see v_can_view_payroll
    -- above). NULL, not 0, for everyone else.
    'salary_paid_today_ugx', (
      CASE WHEN NOT v_can_view_payroll OR v_business_profile_id IS NULL THEN NULL ELSE (
        SELECT COALESCE(SUM(net_amount), 0) FROM public.business_payroll_entries
        WHERE business_profile_id = v_business_profile_id
          AND status = 'paid' AND updated_at >= v_today
      ) END
    ),
    'salary_owed_ugx', (
      CASE WHEN NOT v_can_view_payroll OR v_business_profile_id IS NULL THEN NULL ELSE (
        SELECT COALESCE(SUM(net_amount), 0) FROM public.business_payroll_entries
        WHERE business_profile_id = v_business_profile_id
          AND status IN ('draft', 'approved')
      ) END
    ),
    'salary_owed_count', (
      CASE WHEN NOT v_can_view_payroll OR v_business_profile_id IS NULL THEN NULL ELSE (
        SELECT COUNT(*) FROM public.business_payroll_entries
        WHERE business_profile_id = v_business_profile_id
          AND status IN ('draft', 'approved')
      ) END
    ),

    -- Staff attendance today.
    'staff_checked_in_today', (
      SELECT COUNT(*) FROM public.cmms_staff_attendance
      WHERE cmms_company_id = p_company_id AND check_in_time >= v_today
    ),
    'staff_checked_out_today', (
      SELECT COUNT(*) FROM public.cmms_staff_attendance
      WHERE cmms_company_id = p_company_id AND check_out_time >= v_today
    ),
    'staff_currently_on_site', (
      SELECT COUNT(*) FROM public.cmms_staff_attendance
      WHERE cmms_company_id = p_company_id AND check_in_time >= v_today AND status = 'checked_in'
    ),

    -- Visitors today.
    'visitors_checked_in_today', (
      SELECT COUNT(*) FROM public.cmms_visitor_checkin
      WHERE cmms_company_id = p_company_id AND check_in_time >= v_today
    ),

    -- Job postings: real, live view/application counters on the posting
    -- itself, plus how many applications actually came in today.
    'open_job_postings', (
      SELECT COUNT(*) FROM public.cmms_announcements
      WHERE cmms_company_id = p_company_id AND post_type = 'job' AND status = 'published'
    ),
    'job_posting_views', (
      SELECT COALESCE(SUM(views_count), 0) FROM public.cmms_announcements
      WHERE cmms_company_id = p_company_id AND post_type = 'job' AND status = 'published'
    ),
    'job_applications_total', (
      SELECT COALESCE(SUM(applications_count), 0) FROM public.cmms_announcements
      WHERE cmms_company_id = p_company_id AND post_type = 'job' AND status = 'published'
    ),
    'job_applications_today', (
      SELECT COUNT(*) FROM public.cmms_job_applications
      WHERE cmms_company_id = p_company_id AND created_at >= v_today
    ),

    -- Tasks (cmms_job_assignments) today.
    'tasks_assigned_today', (
      SELECT COUNT(*) FROM public.cmms_job_assignments
      WHERE company_id = p_company_id AND created_at >= v_today
    ),
    'tasks_completed_today', (
      SELECT COUNT(*) FROM public.cmms_job_assignments
      WHERE company_id = p_company_id AND assignment_status = 'completed' AND updated_at >= v_today
    ),
    'tasks_open', (
      SELECT COUNT(*) FROM public.cmms_job_assignments
      WHERE company_id = p_company_id AND assignment_status IN ('pending', 'accepted', 'in_progress')
    ),

    -- Reports submitted today.
    'reports_submitted_today', (
      SELECT COUNT(*) FROM public.cmms_company_reports
      WHERE cmms_company_id = p_company_id AND created_at >= v_today
    ),
    'reports_open', (
      SELECT COUNT(*) FROM public.cmms_company_reports
      WHERE cmms_company_id = p_company_id AND status = 'open'
    ),

    -- Real cash-ledger transactions today (payroll payouts, salary
    -- advances, service-provider payments, etc. all land here) -- the same
    -- payroll view gate applies, since this is payroll-adjacent cash-flow
    -- data, not general operational activity. Summed in UGX only, to avoid
    -- adding amounts across mismatched currencies.
    'transactions_today_count', (
      CASE WHEN NOT v_can_view_payroll OR v_business_profile_id IS NULL THEN NULL ELSE (
        SELECT COUNT(*) FROM public.ican_coin_transactions
        WHERE business_profile_id = v_business_profile_id
          AND created_at >= v_today AND status = 'completed'
      ) END
    ),
    'transactions_today_ugx', (
      CASE WHEN NOT v_can_view_payroll OR v_business_profile_id IS NULL THEN NULL ELSE (
        SELECT COALESCE(SUM(local_amount), 0) FROM public.ican_coin_transactions
        WHERE business_profile_id = v_business_profile_id
          AND created_at >= v_today AND status = 'completed'
          AND COALESCE(local_currency, 'UGX') = 'UGX'
      ) END
    ),

    'recent_activity', (
      SELECT COALESCE(json_agg(a), '[]'::json) FROM (
        SELECT actor_name, activity_type, description, icon, created_at
        FROM public.cmms_activity_log
        WHERE cmms_company_id = p_company_id
        ORDER BY created_at DESC
        LIMIT 8
      ) a
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_cmms_dashboard_summary(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS dashboard summary now hides payroll/cash-transaction figures from members without payroll view access' AS status;
