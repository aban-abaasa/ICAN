-- ============================================================================
-- Fix: cmms_apply_attendance_payroll_deductions() always failed with
-- 'column reference "payroll_entry_id" is ambiguous'.
-- Run after CMMS_ATTENDANCE_PAYROLL_INTEGRATION.sql.
--
-- BUG: this function's RETURNS TABLE names an output column payroll_entry_id
-- — the exact same name as the real payroll_entry_id column on
-- cmms_attendance_payroll_adjustments. The
-- `DELETE FROM cmms_attendance_payroll_adjustments WHERE payroll_entry_id =
-- v_row.entry_id` clause is a bare reference, and PL/pgSQL's default
-- #variable_conflict setting ('error') refuses to guess between the table
-- column and the RETURNS TABLE output column of the same name — it raises
-- "column reference \"payroll_entry_id\" is ambiguous" instead. This
-- function is the one behind "Calculate attendance deductions" AND the
-- automatic current-month draft creation in CMMSPayrollPanel.jsx (it runs
-- unconditionally whenever attendance deductions are enabled), so this has
-- been failing silently on every payroll page load, not just on manual
-- clicks.
--
-- Same gotcha, same fix as get_attendance_summary
-- (CMMS_ATTENDANCE_SUMMARY_AND_MANUAL_CHECKIN.sql),
-- apply_salary_advance_recovery
-- (CMMS_SALARY_ADVANCE_RECOVERY_AMBIGUOUS_COLUMN_FIX.sql), and
-- get_my_cmms_salary_wallet_transactions
-- (CMMS_MY_SALARY_WALLET_TRANSACTIONS_AMBIGUOUS_COLUMN_FIX.sql):
-- #variable_conflict use_column tells PL/pgSQL to prefer the real table
-- column whenever a bare name collides with one of these output columns.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cmms_apply_attendance_payroll_deductions(
  p_payroll_period_id UUID
)
RETURNS TABLE (
  payroll_entry_id UUID,
  employee_user_id UUID,
  late_minutes INTEGER,
  early_leave_minutes INTEGER,
  deduction_amount NUMERIC(15,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_period public.business_payroll_periods;
  v_company public.cmms_company_profiles;
  v_settings public.cmms_attendance_payroll_settings;
  v_row RECORD;
  v_previous_deduction NUMERIC(15,2);
  v_hourly_rate NUMERIC(15,4);
  v_shift_hours NUMERIC(10,4);
  v_late INTEGER;
  v_early INTEGER;
  v_amount NUMERIC(15,2);
  v_total_late INTEGER;
  v_total_early INTEGER;
  v_total_amount NUMERIC(15,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required to apply attendance payroll deductions';
  END IF;

  SELECT * INTO v_period FROM public.business_payroll_periods WHERE id = p_payroll_period_id FOR UPDATE;
  IF v_period.id IS NULL THEN RAISE EXCEPTION 'Payroll period not found'; END IF;
  IF v_period.status NOT IN ('draft', 'pending_approval') THEN
    RAISE EXCEPTION 'Attendance deductions can only be applied to draft or pending payroll periods';
  END IF;

  SELECT * INTO v_company
  FROM public.cmms_company_profiles
  WHERE pichin_business_profile_id = v_period.business_profile_id
  LIMIT 1;
  IF v_company.id IS NULL THEN RAISE EXCEPTION 'No CMMS company is linked to this payroll business'; END IF;
  IF NOT public.cmms_can_manage_attendance_payroll(v_company.id) THEN
    RAISE EXCEPTION 'You do not have permission to manage attendance payroll deductions for this company';
  END IF;

  SELECT * INTO v_settings FROM public.cmms_attendance_payroll_settings WHERE cmms_company_id = v_company.id;
  IF v_settings.cmms_company_id IS NULL OR NOT v_settings.enabled THEN
    RAISE EXCEPTION 'Attendance payroll deductions are not enabled for this company';
  END IF;

  -- Replace only the attendance-derived portion of each entry. Manual and tax
  -- deductions remain intact because the previous attendance total is tracked
  -- in entry metadata.
  FOR v_row IN
    SELECT pe.id AS entry_id, pe.employee_user_id, pe.deductions, pe.metadata,
           cp.pay_type, cp.base_salary,
           cu.id AS cmms_user_id
    FROM public.business_payroll_entries pe
    JOIN public.cmms_users cu
      ON cu.cmms_company_id = v_company.id
     AND cu.ican_user_id = pe.employee_user_id
     AND cu.is_active
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
  LOOP
    v_shift_hours := EXTRACT(EPOCH FROM (v_settings.scheduled_end - v_settings.scheduled_start)) / 3600.0;
    IF v_shift_hours <= 0 THEN RAISE EXCEPTION 'Scheduled end time must be after scheduled start time'; END IF;
    v_hourly_rate := CASE WHEN v_row.pay_type = 'hourly' THEN v_row.base_salary
      ELSE v_row.base_salary / v_settings.monthly_work_days / v_shift_hours END;
    v_total_late := 0; v_total_early := 0; v_total_amount := 0;

    DELETE FROM public.cmms_attendance_payroll_adjustments WHERE payroll_entry_id = v_row.entry_id;

    FOR v_late, v_early, v_amount IN
      SELECT
        CASE WHEN v_settings.deduct_late_arrivals THEN GREATEST(0, (EXTRACT(EPOCH FROM ((a.check_in_time AT TIME ZONE v_settings.timezone)::time - v_settings.scheduled_start)) / 60)::INTEGER - v_settings.grace_minutes) ELSE 0 END,
        CASE WHEN v_settings.deduct_early_departures AND a.check_out_time IS NOT NULL THEN GREATEST(0, (EXTRACT(EPOCH FROM (v_settings.scheduled_end - (a.check_out_time AT TIME ZONE v_settings.timezone)::time)) / 60)::INTEGER) ELSE 0 END,
        0::NUMERIC
      FROM public.cmms_staff_attendance a
      WHERE a.cmms_company_id = v_company.id
        AND a.cmms_user_id = v_row.cmms_user_id
        AND a.status = 'checked_out'
        AND (a.check_in_time AT TIME ZONE v_settings.timezone)::date BETWEEN v_period.period_start AND v_period.period_end
        AND EXTRACT(ISODOW FROM (a.check_in_time AT TIME ZONE v_settings.timezone))::SMALLINT = ANY(v_settings.work_days)
    LOOP
      v_amount := ROUND(((v_late + v_early)::NUMERIC / 60) * v_hourly_rate, 2);
      v_total_late := v_total_late + v_late; v_total_early := v_total_early + v_early; v_total_amount := v_total_amount + v_amount;
    END LOOP;

    -- A second pass writes one audit item per attendance record with the same
    -- calculation used above, allowing payroll staff to review the source.
    INSERT INTO public.cmms_attendance_payroll_adjustments
      (payroll_entry_id, attendance_id, cmms_company_id, late_minutes, early_leave_minutes, hourly_rate, deduction_amount, calculation, calculated_by)
    SELECT v_row.entry_id, a.id, v_company.id,
      CASE WHEN v_settings.deduct_late_arrivals THEN GREATEST(0, (EXTRACT(EPOCH FROM ((a.check_in_time AT TIME ZONE v_settings.timezone)::time - v_settings.scheduled_start)) / 60)::INTEGER - v_settings.grace_minutes) ELSE 0 END,
      CASE WHEN v_settings.deduct_early_departures THEN GREATEST(0, (EXTRACT(EPOCH FROM (v_settings.scheduled_end - (a.check_out_time AT TIME ZONE v_settings.timezone)::time)) / 60)::INTEGER) ELSE 0 END,
      v_hourly_rate,
      ROUND(((CASE WHEN v_settings.deduct_late_arrivals THEN GREATEST(0, (EXTRACT(EPOCH FROM ((a.check_in_time AT TIME ZONE v_settings.timezone)::time - v_settings.scheduled_start)) / 60)::INTEGER - v_settings.grace_minutes) ELSE 0 END + CASE WHEN v_settings.deduct_early_departures THEN GREATEST(0, (EXTRACT(EPOCH FROM (v_settings.scheduled_end - (a.check_out_time AT TIME ZONE v_settings.timezone)::time)) / 60)::INTEGER) ELSE 0 END)::NUMERIC / 60) * v_hourly_rate, 2),
      jsonb_build_object('scheduled_start', v_settings.scheduled_start, 'scheduled_end', v_settings.scheduled_end, 'grace_minutes', v_settings.grace_minutes, 'timezone', v_settings.timezone), auth.uid()
    FROM public.cmms_staff_attendance a
    WHERE a.cmms_company_id = v_company.id AND a.cmms_user_id = v_row.cmms_user_id AND a.status = 'checked_out'
      AND (a.check_in_time AT TIME ZONE v_settings.timezone)::date BETWEEN v_period.period_start AND v_period.period_end
      AND EXTRACT(ISODOW FROM (a.check_in_time AT TIME ZONE v_settings.timezone))::SMALLINT = ANY(v_settings.work_days);

    v_previous_deduction := COALESCE((v_row.metadata->>'attendance_deduction')::NUMERIC, 0);
    UPDATE public.business_payroll_entries
    SET deductions = GREATEST(0, deductions - v_previous_deduction + v_total_amount),
        metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{attendance_deduction}', to_jsonb(v_total_amount)),
        updated_at = now()
    WHERE id = v_row.entry_id;

    payroll_entry_id := v_row.entry_id; employee_user_id := v_row.employee_user_id;
    late_minutes := v_total_late; early_leave_minutes := v_total_early; deduction_amount := v_total_amount;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_apply_attendance_payroll_deductions(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_apply_attendance_payroll_deductions(UUID) TO authenticated;

COMMENT ON FUNCTION public.cmms_apply_attendance_payroll_deductions(UUID) IS
  'Applies configured, reviewable attendance deductions to draft payroll entries only.';

NOTIFY pgrst, 'reload schema';

SELECT 'cmms_apply_attendance_payroll_deductions no longer errors on ambiguous payroll_entry_id' AS status;
