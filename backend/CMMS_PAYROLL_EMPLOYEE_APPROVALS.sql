-- Employee acknowledgement for CMMS payroll. Run after shared payroll schema.
CREATE TABLE IF NOT EXISTS public.cmms_payroll_employee_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_entry_id UUID NOT NULL UNIQUE REFERENCES public.business_payroll_entries(id) ON DELETE CASCADE,
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  employee_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  net_amount NUMERIC(15,2) NOT NULL CHECK (net_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'UGX',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'paid', 'cancelled')),
  employee_note TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  payment_method TEXT CHECK (payment_method IN ('cash', 'ican')),
  wallet_transaction_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_cmms_payroll_employee_approvals_employee ON public.cmms_payroll_employee_approvals(employee_user_id, status, requested_at DESC);
ALTER TABLE public.cmms_payroll_employee_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cmms_payroll_employee_approvals_parties ON public.cmms_payroll_employee_approvals;
CREATE POLICY cmms_payroll_employee_approvals_parties ON public.cmms_payroll_employee_approvals
  FOR SELECT TO authenticated USING (auth.uid() IN (employee_user_id, requested_by));

CREATE OR REPLACE FUNCTION public.request_cmms_payroll_employee_approval(p_payroll_entry_id UUID)
RETURNS public.cmms_payroll_employee_approvals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_entry public.business_payroll_entries; v_request public.cmms_payroll_employee_approvals; v_currency TEXT;
BEGIN
  SELECT * INTO v_entry FROM public.business_payroll_entries WHERE id = p_payroll_entry_id;
  IF v_entry.id IS NULL THEN RAISE EXCEPTION 'Payroll entry not found'; END IF;
  IF NOT public.ican_business_admin(v_entry.business_profile_id) THEN RAISE EXCEPTION 'You cannot request approval for this payroll entry'; END IF;
  IF v_entry.status = 'paid' THEN RAISE EXCEPTION 'This payroll entry has already been paid'; END IF;
  v_currency := COALESCE(v_entry.metadata->>'currency', 'UGX');
  INSERT INTO public.cmms_payroll_employee_approvals (payroll_entry_id, business_profile_id, employee_user_id, requested_by, net_amount, currency)
  VALUES (v_entry.id, v_entry.business_profile_id, v_entry.employee_user_id, auth.uid(), v_entry.net_amount, v_currency)
  ON CONFLICT (payroll_entry_id) DO UPDATE SET requested_by = EXCLUDED.requested_by, net_amount = EXCLUDED.net_amount, currency = EXCLUDED.currency, status = 'pending', employee_note = NULL, requested_at = now(), responded_at = NULL
  WHERE public.cmms_payroll_employee_approvals.status IN ('rejected', 'cancelled')
  RETURNING * INTO v_request;
  IF v_request.id IS NULL THEN SELECT * INTO v_request FROM public.cmms_payroll_employee_approvals WHERE payroll_entry_id = v_entry.id; END IF;
  RETURN v_request;
END; $$;

CREATE OR REPLACE FUNCTION public.respond_cmms_payroll_employee_approval(p_approval_id UUID, p_approved BOOLEAN, p_note TEXT DEFAULT NULL)
RETURNS public.cmms_payroll_employee_approvals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_request public.cmms_payroll_employee_approvals;
BEGIN
  SELECT * INTO v_request FROM public.cmms_payroll_employee_approvals WHERE id = p_approval_id FOR UPDATE;
  IF v_request.id IS NULL THEN RAISE EXCEPTION 'Payroll approval not found'; END IF;
  IF v_request.employee_user_id <> auth.uid() THEN RAISE EXCEPTION 'Only the employee can approve or reject this salary'; END IF;
  IF v_request.status <> 'pending' THEN RAISE EXCEPTION 'This salary approval has already been answered'; END IF;
  UPDATE public.cmms_payroll_employee_approvals SET status = CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END, employee_note = NULLIF(trim(p_note), ''), responded_at = now() WHERE id = v_request.id RETURNING * INTO v_request;
  RETURN v_request;
END; $$;

CREATE OR REPLACE FUNCTION public.complete_cmms_payroll_payment(p_payroll_entry_id UUID, p_payment_method TEXT, p_wallet_transaction_id TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_request public.cmms_payroll_employee_approvals; v_entry public.business_payroll_entries;
BEGIN
  SELECT * INTO v_entry FROM public.business_payroll_entries WHERE id = p_payroll_entry_id FOR UPDATE;
  IF NOT public.ican_business_admin(v_entry.business_profile_id) THEN RAISE EXCEPTION 'You cannot complete this payroll payment'; END IF;
  SELECT * INTO v_request FROM public.cmms_payroll_employee_approvals WHERE payroll_entry_id = p_payroll_entry_id FOR UPDATE;
  IF v_request.status <> 'approved' THEN RAISE EXCEPTION 'Employee approval is required before salary payment'; END IF;
  IF p_payment_method NOT IN ('cash', 'ican') THEN RAISE EXCEPTION 'Invalid payment method'; END IF;
  UPDATE public.business_payroll_entries SET status = 'paid', metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('payment_method', p_payment_method, 'wallet_transaction_id', p_wallet_transaction_id, 'paid_at', now()), updated_at = now() WHERE id = p_payroll_entry_id;
  UPDATE public.cmms_payroll_employee_approvals SET status = 'paid', payment_method = p_payment_method, wallet_transaction_id = p_wallet_transaction_id, paid_at = now() WHERE id = v_request.id;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION public.request_cmms_payroll_employee_approval(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.respond_cmms_payroll_employee_approval(UUID, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_cmms_payroll_payment(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_cmms_payroll_employee_approval(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_cmms_payroll_employee_approval(UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_cmms_payroll_payment(UUID, TEXT, TEXT) TO authenticated;
NOTIFY pgrst, 'reload schema';
