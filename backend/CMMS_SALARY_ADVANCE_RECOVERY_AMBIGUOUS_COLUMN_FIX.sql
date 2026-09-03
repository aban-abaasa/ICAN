-- ============================================================================
-- Fix: apply_salary_advance_recovery() always failed with
-- 'column reference "employee_user_id" is ambiguous'.
-- Run after CMMS_SALARY_ADVANCE_REQUESTS.sql.
--
-- BUG: this function's RETURNS TABLE names its output columns
-- payroll_entry_id and employee_user_id — the exact same names as real
-- columns on business_salary_advances (employee_user_id) and
-- business_salary_advance_recoveries (payroll_entry_id). PL/pgSQL's default
-- #variable_conflict setting is 'error': any bare column reference that
-- matches both a table column and one of these OUT-parameter-like RETURNS
-- TABLE names raises "column reference ... is ambiguous" instead of picking
-- one, so the WHERE employee_user_id = v_row.employee_user_id lookup (and
-- the payroll_entry_id = v_row.entry_id check right after it) never ran —
-- recovery failed on every call, for every business.
--
-- This is the same gotcha already hit and fixed in get_attendance_summary
-- (CMMS_ATTENDANCE_SUMMARY_AND_MANUAL_CHECKIN.sql) — see its comment. Same
-- fix here: #variable_conflict use_column tells PL/pgSQL to prefer the real
-- table column whenever a bare name collides with one of these output
-- columns, so the queries resolve to the table data instead of erroring.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_salary_advance_recovery(
  p_payroll_period_id UUID
)
RETURNS TABLE (
  payroll_entry_id UUID,
  employee_user_id UUID,
  advance_recovered NUMERIC(15,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_period public.business_payroll_periods;
  v_company public.cmms_company_profiles;
  v_row RECORD;
  v_advance public.business_salary_advances;
  v_outstanding NUMERIC(15,2);
  v_available NUMERIC(15,2);
  v_take NUMERIC(15,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required to apply salary advance recovery';
  END IF;

  SELECT * INTO v_period FROM public.business_payroll_periods WHERE id = p_payroll_period_id FOR UPDATE;
  IF v_period.id IS NULL THEN RAISE EXCEPTION 'Payroll period not found'; END IF;
  IF v_period.status NOT IN ('draft', 'pending_approval') THEN
    RAISE EXCEPTION 'Salary advance recovery can only be applied to draft or pending payroll periods';
  END IF;

  SELECT * INTO v_company
  FROM public.cmms_company_profiles
  WHERE pichin_business_profile_id = v_period.business_profile_id
  LIMIT 1;
  IF v_company.id IS NULL THEN RAISE EXCEPTION 'No CMMS company is linked to this payroll business'; END IF;
  IF NOT public.cmms_can_manage_salary_advances(v_company.id) THEN
    RAISE EXCEPTION 'You do not have permission to manage salary advances for this company';
  END IF;

  FOR v_row IN
    SELECT pe.id AS entry_id, pe.employee_user_id, pe.base_amount, pe.allowances, pe.incentives, pe.deductions
    FROM public.business_payroll_entries pe
    WHERE pe.payroll_period_id = v_period.id AND pe.status = 'draft'
  LOOP
    SELECT * INTO v_advance
      FROM public.business_salary_advances
     WHERE employee_user_id = v_row.employee_user_id
       AND status = 'confirmed'
       AND amount > recovered_amount
     ORDER BY paid_at ASC NULLS LAST
     LIMIT 1;

    CONTINUE WHEN v_advance.id IS NULL;

    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.business_salary_advance_recoveries
      WHERE salary_advance_id = v_advance.id AND payroll_entry_id = v_row.entry_id
    );

    v_outstanding := v_advance.amount - v_advance.recovered_amount;
    v_available := GREATEST(v_row.base_amount + v_row.allowances + v_row.incentives - v_row.deductions, 0);
    v_take := LEAST(v_outstanding, v_available);
    CONTINUE WHEN v_take <= 0;

    INSERT INTO public.business_salary_advance_recoveries (salary_advance_id, payroll_entry_id, amount)
    VALUES (v_advance.id, v_row.entry_id, v_take);

    UPDATE public.business_payroll_entries
    SET deductions = deductions + v_take, updated_at = now()
    WHERE id = v_row.entry_id;

    UPDATE public.business_salary_advances
    SET recovered_amount = recovered_amount + v_take,
        status = CASE WHEN recovered_amount + v_take >= amount THEN 'settled' ELSE status END,
        settled_at = CASE WHEN recovered_amount + v_take >= amount THEN now() ELSE settled_at END,
        updated_at = now()
    WHERE id = v_advance.id;

    payroll_entry_id := v_row.entry_id; employee_user_id := v_row.employee_user_id; advance_recovered := v_take;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_salary_advance_recovery(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_salary_advance_recovery(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'apply_salary_advance_recovery no longer errors on ambiguous employee_user_id / payroll_entry_id' AS status;
