-- Automatically bridge transport-related CMMS requisitions into BodaGo.
-- Run after CMMS_DEPARTMENT_INVENTORY_REQUISITIONS.sql and
-- mybodaguy/backend/database/SHARED_CORPORATE_TRANSPORT_AND_MONTHLY_RIDERS.sql.

ALTER TABLE IF EXISTS public.cmms_requisitions
  ADD COLUMN IF NOT EXISTS boda_transport_request_id UUID;

CREATE INDEX IF NOT EXISTS idx_cmms_requisitions_boda_transport
  ON public.cmms_requisitions(boda_transport_request_id);

CREATE OR REPLACE FUNCTION public.cmms_auto_create_bodago_transport_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_business_profile_id UUID;
  v_contract_id UUID;
  v_request_id UUID;
  v_requested_by UUID;
  v_transport_text TEXT;
BEGIN
  v_transport_text := LOWER(CONCAT_WS(' ', NEW.purpose, NEW.justification));
  IF v_transport_text !~ '(transport|logistics|fleet|delivery|rider|vehicle|pickup|drop.?off)' THEN
    RETURN NEW;
  END IF;

  SELECT cp.pichin_business_profile_id INTO v_business_profile_id
  FROM public.cmms_company_profiles cp WHERE cp.id = NEW.cmms_company_id;
  IF v_business_profile_id IS NULL THEN RETURN NEW; END IF;

  SELECT c.id INTO v_contract_id
  FROM public.mbg_corporate_transport_contracts c
  WHERE c.business_profile_id = v_business_profile_id AND c.status = 'active'
    AND c.starts_on <= CURRENT_DATE AND (c.ends_on IS NULL OR c.ends_on >= CURRENT_DATE)
  ORDER BY c.created_at DESC LIMIT 1;
  IF v_contract_id IS NULL THEN RETURN NEW; END IF;

  -- CMMS stores its own user id; use the linked ICAN/auth id for BodaGo.
  SELECT COALESCE(cu.ican_user_id, cu.id) INTO v_requested_by
  FROM public.cmms_users cu
  WHERE cu.id = NEW.requested_by AND cu.is_active = true;
  IF v_requested_by IS NULL THEN RETURN NEW; END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = v_requested_by) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.mbg_corporate_ride_requests (
    contract_id, business_profile_id, requested_by, ride_count,
    requested_vehicle_type, recurrence, scheduled_for, status
  ) VALUES (
    v_contract_id, v_business_profile_id, v_requested_by, 1,
    NULL, 'once', NEW.required_by_date::timestamptz, 'pending'
  ) RETURNING id INTO v_request_id;

  NEW.boda_transport_request_id := v_request_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cmms_auto_bodago_transport ON public.cmms_requisitions;
CREATE TRIGGER trg_cmms_auto_bodago_transport
BEFORE INSERT ON public.cmms_requisitions FOR EACH ROW
EXECUTE FUNCTION public.cmms_auto_create_bodago_transport_request();

-- Developer monitor is authenticated and role-gated. No anonymous token access.
CREATE OR REPLACE FUNCTION public.ican_dev_get_transport_orders()
RETURNS TABLE (
  request_id UUID, contract_id UUID, business_profile_id UUID,
  contract_name TEXT, request_status TEXT, ride_count INTEGER,
  vehicle_type TEXT, pickup_location TEXT, dropoff_location TEXT,
  scheduled_for TIMESTAMPTZ, created_at TIMESTAMPTZ,
  cmms_requisition_id UUID, cmms_requisition_number TEXT, cmms_status TEXT
)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.mbg_users
    WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  SELECT r.id, r.contract_id, r.business_profile_id, c.contract_name,
         r.status, r.ride_count, r.requested_vehicle_type,
         r.pickup_location, r.dropoff_location, r.scheduled_for, r.created_at,
         q.id, q.requisition_number, q.status
  FROM public.mbg_corporate_ride_requests r
  JOIN public.mbg_corporate_transport_contracts c ON c.id = r.contract_id
  LEFT JOIN public.cmms_requisitions q ON q.boda_transport_request_id = r.id
  ORDER BY r.created_at DESC LIMIT 250;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ican_dev_get_transport_orders() TO authenticated;
