-- ============================================================
-- CMMS Activity Dashboard -- full daily metrics
-- ============================================================
-- Extends fn_get_cmms_dashboard_summary (CMMS_ACTIVITY_DASHBOARD.sql) so
-- the home-screen "Business Activity" card shows what's REALLY happening
-- today, not just inventory/requisition health:
--   - salary paid today vs. still owed (business_payroll_entries, via
--     cmms_company_profiles.pichin_business_profile_id -- the same link
--     already used by complete_cmms_payroll_payment(), see
--     CMMS_PAYROLL_RUN_CASH_TRANSACTION_RECORD.sql)
--   - staff check-in / check-out today (cmms_staff_attendance)
--   - visitor check-ins today (cmms_visitor_checkin)
--   - job postings: real views_count/applications_count on
--     cmms_announcements, plus applications actually submitted today
--     (cmms_job_applications)
--   - tasks assigned/completed today (cmms_job_assignments)
--   - reports submitted today (cmms_company_reports)
--   - real cash-ledger transactions today (ican_coin_transactions, same
--     business_profile_id link as payroll)
--
-- Every number is a real COUNT/SUM for the current calendar day (or, for
-- salary owed, the real current outstanding balance -- that one isn't a
-- "today" figure because unpaid salary doesn't reset at midnight) -- no
-- placeholders, no hardcoded targets. A company with no linked
-- pichin_business_profile_id (small companies only get one once they
-- cross the auto-authority employee threshold -- see
-- CMMS_AUTO_SMALL_BUSINESS_AUTHORITY.sql) simply gets 0s for the
-- payroll/transactions figures instead of erroring.
--
-- Run after: CMMS_ACTIVITY_DASHBOARD.sql, CMMS_ASSET_INVENTORY_FOUNDATION.sql,
-- CMMS_STAFF_ATTENDANCE_VISITOR_MANAGEMENT.sql, CMMS_ANNOUNCEMENTS_AND_JOBS.sql,
-- CMMS_REPORT_MESSAGING_SYSTEM.sql (cmms_job_assignments),
-- CMMS_COMPANY_REPORTING_SYSTEM.sql, SHARED_BUSINESS_AUTHORITY_AND_PAYROLL.sql.
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
  v_today TIMESTAMPTZ := date_trunc('day', now());
  v_business_profile_id UUID;
BEGIN
  -- Only a member of this CMMS company may read its dashboard.
  IF public.cmms_current_user_id_for_company(p_company_id) IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT pichin_business_profile_id INTO v_business_profile_id
  FROM public.cmms_company_profiles
  WHERE id = p_company_id;

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

    -- Payroll: real amount paid today + real amount still owed right now.
    -- 'draft'/'approved' entries are outstanding obligations, not scoped
    -- to today, since salary owed doesn't reset at midnight.
    'salary_paid_today_ugx', (
      CASE WHEN v_business_profile_id IS NULL THEN 0 ELSE (
        SELECT COALESCE(SUM(net_amount), 0) FROM public.business_payroll_entries
        WHERE business_profile_id = v_business_profile_id
          AND status = 'paid' AND updated_at >= v_today
      ) END
    ),
    'salary_owed_ugx', (
      CASE WHEN v_business_profile_id IS NULL THEN 0 ELSE (
        SELECT COALESCE(SUM(net_amount), 0) FROM public.business_payroll_entries
        WHERE business_profile_id = v_business_profile_id
          AND status IN ('draft', 'approved')
      ) END
    ),
    'salary_owed_count', (
      CASE WHEN v_business_profile_id IS NULL THEN 0 ELSE (
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
    -- advances, service-provider payments, etc. all land here). Summed in
    -- UGX only, to avoid adding amounts across mismatched currencies.
    'transactions_today_count', (
      CASE WHEN v_business_profile_id IS NULL THEN 0 ELSE (
        SELECT COUNT(*) FROM public.ican_coin_transactions
        WHERE business_profile_id = v_business_profile_id
          AND created_at >= v_today AND status = 'completed'
      ) END
    ),
    'transactions_today_ugx', (
      CASE WHEN v_business_profile_id IS NULL THEN 0 ELSE (
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

SELECT 'CMMS dashboard summary RPC now returns full daily activity (payroll, attendance, visitors, jobs, tasks, reports, transactions)' AS status;
