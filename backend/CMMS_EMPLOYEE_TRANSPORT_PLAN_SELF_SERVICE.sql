-- ============================================================================
-- CMMS Employee Transport Plan — self-service view of the company's active
-- BodaGoEra corporate transport contract.
-- Run after:
--   CMMS_EMPLOYEE_SELF_SERVICE_ACCESS.sql
--   CMMS_PICHIN_ADMIN_AUTHORITY.sql (adds cmms_company_profiles.pichin_business_profile_id)
--   mybodaguy/backend/database/SHARED_CORPORATE_TRANSPORT_AND_MONTHLY_RIDERS.sql
--     (safe to run even if that file hasn't been applied yet — this reads
--     nothing if mbg_corporate_transport_contracts doesn't exist)
--
-- WHAT THIS ADDS:
--   A regular employee has no reason to see the company's transport CONTRACT
--   row directly (it's business-admin data), but they do need to know what
--   they're allowed to order (which vehicle types, monthly vs prepaid) and
--   how much of this month's shared budget is already used, so they can
--   judge whether it's worth requesting a ride. This RPC hands back only
--   that read-only summary — never the contract's billing IDs, and never
--   any other employee's individual ride requests.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cmms_get_my_transport_plan(p_cmms_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_business_profile_id UUID;
  -- Deliberately a generic RECORD, not %ROWTYPE off the mbg_* table: a
  -- composite-type declaration is resolved the first time this function is
  -- called, which would break the whole function (not just this branch) if
  -- the BodaGoEra migration hasn't been applied yet — the to_regclass guard
  -- above only protects code reachable *after* it, not variable types.
  v_contract RECORD;
  v_month_start DATE := date_trunc('month', CURRENT_DATE)::date;
  v_spend NUMERIC(15,2);
  v_days_covered INTEGER;
  v_ride_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cmms_users u
    WHERE u.cmms_company_id = p_cmms_company_id
      AND u.is_active
      AND lower(u.email) = lower(auth.jwt() ->> 'email')
  ) THEN
    RAISE EXCEPTION 'Active CMMS staff membership is required';
  END IF;

  IF to_regclass('public.mbg_corporate_transport_contracts') IS NULL
     OR to_regclass('public.mbg_corporate_ride_requests') IS NULL THEN
    RETURN jsonb_build_object('has_plan', false);
  END IF;

  SELECT pichin_business_profile_id INTO v_business_profile_id
    FROM public.cmms_company_profiles WHERE id = p_cmms_company_id;
  IF v_business_profile_id IS NULL THEN
    RETURN jsonb_build_object('has_plan', false);
  END IF;

  -- Reached only once both tables are confirmed to exist above, so this can
  -- stay plain SQL rather than dynamic EXECUTE.
  SELECT * INTO v_contract
    FROM public.mbg_corporate_transport_contracts
   WHERE business_profile_id = v_business_profile_id AND status = 'active'
   ORDER BY created_at DESC LIMIT 1;

  IF v_contract.id IS NULL THEN
    RETURN jsonb_build_object('has_plan', false);
  END IF;

  SELECT COALESCE(SUM(GREATEST(COALESCE(actual_total, 0), COALESCE(estimated_total, 0))), 0),
         COUNT(DISTINCT DATE(COALESCE(scheduled_for, created_at))),
         COUNT(*)
    INTO v_spend, v_days_covered, v_ride_count
    FROM public.mbg_corporate_ride_requests
   WHERE contract_id = v_contract.id
     AND COALESCE(scheduled_for, created_at) >= v_month_start::timestamptz
     AND status NOT IN ('cancelled', 'rejected');

  RETURN jsonb_build_object(
    'has_plan', true,
    'contract_name', v_contract.contract_name,
    'billing_cycle', v_contract.billing_cycle,
    'status', v_contract.status,
    'currency', v_contract.currency,
    'monthly_limit', v_contract.monthly_limit,
    'allowed_vehicle_types', to_jsonb(v_contract.allowed_vehicle_types),
    'spend_this_month', v_spend,
    'percent_used', CASE WHEN v_contract.monthly_limit > 0
      THEN ROUND(LEAST(v_spend / v_contract.monthly_limit * 100, 999), 1)
      ELSE NULL END,
    'days_covered_this_month', v_days_covered,
    'rides_this_month', v_ride_count,
    'month', to_char(v_month_start, 'YYYY-MM')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_get_my_transport_plan(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_get_my_transport_plan(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────
-- VERIFY
-- ─────────────────────────────────────────────────────────────────────────
SELECT 'CMMS employee transport plan self-service installed' AS status;
