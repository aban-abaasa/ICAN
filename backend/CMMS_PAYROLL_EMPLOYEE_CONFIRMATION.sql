-- Employee acknowledgement for CMMS salary payments.
-- Run after SHARED_BUSINESS_AUTHORITY_AND_PAYROLL.sql and the CMMS payroll scripts.
-- A manager can record a cash or ICAN-wallet salary payment, but the payroll
-- entry becomes paid only after the employee confirms receipt.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.cmms_payroll_payment_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_entry_id UUID NOT NULL UNIQUE REFERENCES public.business_payroll_entries(id) ON DELETE CASCADE,
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  employee_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'ican')),
  wallet_transaction_id UUID,
  status TEXT NOT NULL DEFAULT 'pending_employee_confirmation'
    CHECK (status IN ('pending_employee_confirmation', 'acknowledged', 'disputed')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  employee_note TEXT,
  confirmation_code TEXT NOT NULL UNIQUE DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
);

CREATE INDEX IF NOT EXISTS idx_cmms_payroll_confirmations_employee
  ON public.cmms_payroll_payment_confirmations(employee_user_id, status, requested_at DESC);

ALTER TABLE public.cmms_payroll_payment_confirmations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cmms_payroll_confirmation_employee_read ON public.cmms_payroll_payment_confirmations;
CREATE POLICY cmms_payroll_confirmation_employee_read ON public.cmms_payroll_payment_confirmations
  FOR SELECT TO authenticated USING (employee_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.request_cmms_payroll_payment_confirmation(
  p_payroll_entry_id UUID, p_payment_method TEXT, p_wallet_transaction_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_entry public.business_payroll_entries; v_company UUID; v_confirmation public.cmms_payroll_payment_confirmations;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in is required'; END IF;
  SELECT * INTO v_entry FROM public.business_payroll_entries WHERE id = p_payroll_entry_id FOR UPDATE;
  IF v_entry.id IS NULL THEN RAISE EXCEPTION 'Payroll entry not found'; END IF;
  SELECT id INTO v_company FROM public.cmms_company_profiles WHERE pichin_business_profile_id = v_entry.business_profile_id LIMIT 1;
  IF v_company IS NULL OR NOT public.cmms_has_permission(v_company, 'manage_payroll') THEN RAISE EXCEPTION 'You do not have permission to record this salary payment'; END IF;
  IF v_entry.status IN ('paid', 'cancelled') THEN RAISE EXCEPTION 'This payroll entry cannot be submitted for confirmation'; END IF;
  IF lower(trim(p_payment_method)) NOT IN ('cash', 'ican') THEN RAISE EXCEPTION 'Invalid payment method'; END IF;
  INSERT INTO public.cmms_payroll_payment_confirmations (payroll_entry_id, business_profile_id, employee_user_id, requested_by, payment_method, wallet_transaction_id)
  VALUES (v_entry.id, v_entry.business_profile_id, v_entry.employee_user_id, auth.uid(), lower(trim(p_payment_method)), p_wallet_transaction_id)
  ON CONFLICT (payroll_entry_id) DO UPDATE SET requested_by = EXCLUDED.requested_by, payment_method = EXCLUDED.payment_method,
    wallet_transaction_id = EXCLUDED.wallet_transaction_id, status = 'pending_employee_confirmation', requested_at = now(), responded_at = NULL, employee_note = NULL
  RETURNING * INTO v_confirmation;
  UPDATE public.business_payroll_entries SET status = 'approved', metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'payment_method', v_confirmation.payment_method, 'wallet_transaction_id', v_confirmation.wallet_transaction_id,
    'employee_confirmation_status', 'pending_employee_confirmation', 'employee_confirmation_code', v_confirmation.confirmation_code), updated_at = now() WHERE id = v_entry.id;
  RETURN jsonb_build_object('success', true, 'confirmation_id', v_confirmation.id, 'confirmation_code', v_confirmation.confirmation_code, 'status', v_confirmation.status);
END; $$;

CREATE OR REPLACE FUNCTION public.respond_cmms_payroll_payment_confirmation(
  p_confirmation_id UUID, p_decision TEXT, p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_confirmation public.cmms_payroll_payment_confirmations; v_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in is required'; END IF;
  SELECT * INTO v_confirmation FROM public.cmms_payroll_payment_confirmations WHERE id = p_confirmation_id FOR UPDATE;
  IF v_confirmation.id IS NULL OR v_confirmation.employee_user_id <> auth.uid() THEN RAISE EXCEPTION 'This salary confirmation is not assigned to you'; END IF;
  IF v_confirmation.status <> 'pending_employee_confirmation' THEN RAISE EXCEPTION 'This salary confirmation has already been answered'; END IF;
  IF lower(trim(p_decision)) NOT IN ('acknowledged', 'disputed') THEN RAISE EXCEPTION 'Choose acknowledged or disputed'; END IF;
  v_status := lower(trim(p_decision));
  UPDATE public.cmms_payroll_payment_confirmations SET status = v_status, employee_note = NULLIF(trim(COALESCE(p_note, '')), ''), responded_at = now() WHERE id = v_confirmation.id;
  UPDATE public.business_payroll_entries SET status = CASE WHEN v_status = 'acknowledged' THEN 'paid' ELSE 'approved' END,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('employee_confirmation_status', v_status, 'employee_confirmed_at', now(), 'employee_confirmation_id', v_confirmation.id), updated_at = now()
  WHERE id = v_confirmation.payroll_entry_id;
  RETURN jsonb_build_object('success', true, 'status', v_status);
END; $$;

REVOKE ALL ON FUNCTION public.request_cmms_payroll_payment_confirmation(UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.respond_cmms_payroll_payment_confirmation(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_cmms_payroll_payment_confirmation(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_cmms_payroll_payment_confirmation(UUID, TEXT, TEXT) TO authenticated;
NOTIFY pgrst, 'reload schema';
