-- ============================================================================
-- CMMS Attendance Check-out -> Pay Confirmation
-- ============================================================================
-- Run after:
--   CMMS_STAFF_ATTENDANCE_VISITOR_MANAGEMENT.sql
--   SHARED_BUSINESS_AUTHORITY_AND_PAYROLL.sql
--   CMMS_ATTENDANCE_PAYROLL_INTEGRATION.sql
--   CMMS_PAYROLL_EMPLOYEE_APPROVALS.sql
--
-- A daily-paid staff member settles every single day at check-out. A
-- monthly/weekly/hourly/contract staff member only settles once their
-- check-outs so far this calendar month reach the company's configured
-- cmms_attendance_payroll_settings.monthly_work_days. Either way, check-out
-- itself is blocked until the pay decision is answered (staff_check_out and
-- staff_check_out_with_qr raise PAY_CONFIRMATION_REQUIRED and roll back
-- before anything is written), and settling "paid" reuses the exact same
-- business_payroll_periods / business_payroll_entries / cmms_payroll_
-- employee_approvals tables the CMMS Payroll panel already reads and pays
-- from, so the entry is visible there and lines up with the wallet ledger
-- the same way a payroll-panel payment does.

CREATE TABLE IF NOT EXISTS public.cmms_attendance_pay_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id UUID NOT NULL UNIQUE REFERENCES public.cmms_staff_attendance(id) ON DELETE CASCADE,
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  cmms_user_id UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
  pay_frequency TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  paid BOOLEAN NOT NULL,
  payment_method TEXT CHECK (payment_method IN ('cash', 'ican')),
  payroll_entry_id UUID REFERENCES public.business_payroll_entries(id) ON DELETE SET NULL,
  confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cmms_attendance_pay_confirmations_user
  ON public.cmms_attendance_pay_confirmations(cmms_user_id, period_start DESC);

-- Ties a wallet ('ican') payment to the real business-wallet transfer that
-- moved the money, so cmms_settle_attendance_pay below can verify it (not
-- just trust a client-supplied id) and so the confirmation is queryable
-- alongside the rest of the employee's wallet activity. NULL for cash and
-- for "not yet paid" rows. The unique index stops one real transfer from
-- being reused to falsely settle a second attendance record.
ALTER TABLE public.cmms_attendance_pay_confirmations
  ADD COLUMN IF NOT EXISTS wallet_transaction_id UUID REFERENCES public.ican_business_wallet_transactions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cmms_attendance_pay_confirmations_wallet_tx
  ON public.cmms_attendance_pay_confirmations(wallet_transaction_id)
  WHERE wallet_transaction_id IS NOT NULL;

ALTER TABLE public.cmms_attendance_pay_confirmations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cmms_attendance_pay_confirmations_read ON public.cmms_attendance_pay_confirmations;
CREATE POLICY cmms_attendance_pay_confirmations_read ON public.cmms_attendance_pay_confirmations
  FOR SELECT TO authenticated
  USING (
    public.cmms_can_manage_attendance_payroll(cmms_company_id)
    OR EXISTS (
      SELECT 1 FROM public.cmms_users u
      WHERE u.id = cmms_attendance_pay_confirmations.cmms_user_id
        AND u.ican_user_id = auth.uid()
    )
  );

-- Read-only: tells the attendance UI, before check-out is attempted, whether
-- a pay decision is due today so it can show (or skip) the pay question.
DROP FUNCTION IF EXISTS public.cmms_checkout_pay_status(UUID, UUID);
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

    SELECT EXISTS (
      SELECT 1 FROM public.cmms_attendance_pay_confirmations c
       WHERE c.cmms_user_id = p_cmms_user_id AND c.paid
         AND c.period_start = v_period_start AND c.period_end = v_period_end
    ) INTO v_already_settled;

    v_required := (COALESCE(v_days_so_far, 0) + 1) >= v_settings.monthly_work_days AND NOT v_already_settled;
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

-- Same lookup, but for the public self check-out page, which only knows the
-- QR token and the signed-in staff session (mirrors staff_check_out_with_qr's
-- own staff resolution).
CREATE OR REPLACE FUNCTION public.cmms_checkout_pay_status_by_qr(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qr public.cmms_attendance_qr_locations;
  v_staff public.cmms_users;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('required', false, 'reason', 'signed_out');
  END IF;

  SELECT * INTO v_qr FROM public.cmms_attendance_qr_locations WHERE token = trim(p_token) AND is_active;
  IF v_qr.id IS NULL THEN
    RETURN jsonb_build_object('required', false, 'reason', 'invalid_qr');
  END IF;

  SELECT * INTO v_staff FROM public.cmms_users
   WHERE cmms_company_id = v_qr.cmms_company_id AND is_active AND lower(email) = lower(auth.jwt() ->> 'email')
   LIMIT 1;
  IF v_staff.id IS NULL THEN
    RETURN jsonb_build_object('required', false, 'reason', 'not_staff');
  END IF;

  RETURN public.cmms_checkout_pay_status(v_staff.id, v_qr.cmms_company_id);
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_checkout_pay_status_by_qr(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_checkout_pay_status_by_qr(TEXT) TO authenticated;

-- Settles (or logs "not yet paid" for) the pay decision tied to one
-- check-out. Always recomputes whether pay is actually due server-side —
-- an earlier cmms_checkout_pay_status read is only a UI hint. A no-op when
-- nothing is due, so it is always safe to call ahead of check-out.
CREATE OR REPLACE FUNCTION public.cmms_settle_attendance_pay(
  p_attendance_id UUID,
  p_paid BOOLEAN DEFAULT NULL,
  p_payment_method TEXT DEFAULT NULL,
  p_wallet_transaction_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attendance public.cmms_staff_attendance;
  v_status JSONB;
  v_period_start DATE;
  v_period_end DATE;
  v_employee_user_id UUID;
  v_business_profile_id UUID;
  v_period public.business_payroll_periods;
  v_entry public.business_payroll_entries;
  v_base_amount NUMERIC(15,2);
  v_currency TEXT;
  v_wallet_tx public.ican_business_wallet_transactions;
  v_wallet_tx_id UUID;
  v_expected_ican NUMERIC(18,8);
BEGIN
  SELECT * INTO v_attendance FROM public.cmms_staff_attendance WHERE id = p_attendance_id;
  IF v_attendance.id IS NULL THEN
    RAISE EXCEPTION 'Attendance record not found';
  END IF;

  v_status := public.cmms_checkout_pay_status(v_attendance.cmms_user_id, v_attendance.cmms_company_id, v_attendance.id);
  IF NOT (v_status->>'required')::BOOLEAN THEN
    RETURN jsonb_build_object('settled', false, 'required', false);
  END IF;

  IF p_paid IS NULL THEN
    RAISE EXCEPTION 'PAY_CONFIRMATION_REQUIRED';
  END IF;

  v_period_start := (v_status->>'period_start')::date;
  v_period_end := (v_status->>'period_end')::date;
  v_employee_user_id := (v_status->>'employee_user_id')::uuid;
  v_currency := v_status->>'currency';
  v_base_amount := (v_status->>'amount')::numeric;

  SELECT pichin_business_profile_id INTO v_business_profile_id
    FROM public.cmms_company_profiles WHERE id = v_attendance.cmms_company_id;

  IF p_paid THEN
    IF lower(COALESCE(p_payment_method, '')) NOT IN ('cash', 'ican') THEN
      RAISE EXCEPTION 'Choose cash or wallet to record this payment';
    END IF;

    -- Cash cannot be verified in-system and is trusted as reported. A wallet
    -- ('ican') payment is money that actually moved through the business
    -- wallet, so it must be backed by a real, completed transfer to this
    -- employee for the right amount — never just a client-supplied id.
    IF lower(p_payment_method) = 'ican' THEN
      BEGIN
        v_wallet_tx_id := NULLIF(trim(p_wallet_transaction_id), '')::UUID;
      EXCEPTION WHEN invalid_text_representation THEN
        v_wallet_tx_id := NULL;
      END;
      IF v_wallet_tx_id IS NULL THEN
        RAISE EXCEPTION 'A completed IcanEra wallet transfer is required to record this payment';
      END IF;

      SELECT * INTO v_wallet_tx FROM public.ican_business_wallet_transactions
       WHERE id = v_wallet_tx_id FOR UPDATE;
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
        RAISE EXCEPTION 'This wallet payment is still awaiting business-wallet approval; approve it in Business Wallet, or pay cash to finish check-out';
      END IF;
      IF upper(COALESCE(v_currency, 'UGX')) <> 'UGX' THEN
        RAISE EXCEPTION 'The IcanEra wallet currently supports UGX pay only; choose cash for another currency';
      END IF;
      -- Same shared ICAN/UGX floor rate used everywhere else money is
      -- converted to ICAN coin (see CMMS_SUPPLIER_PURCHASE_ORDERS.sql,
      -- CMMS_SCHOOL_FEES.sql, ICAN_CROSS_APP_WALLET_MIGRATION.sql, etc.).
      v_expected_ican := ROUND(v_base_amount / 5000, 8);
      IF ABS(v_wallet_tx.amount_ican - v_expected_ican) > 0.0001 THEN
        RAISE EXCEPTION 'The wallet payment amount (% ICAN) does not match the % due (% ICAN)', v_wallet_tx.amount_ican, v_currency, v_expected_ican;
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.cmms_attendance_pay_confirmations
         WHERE wallet_transaction_id = v_wallet_tx_id AND attendance_id <> p_attendance_id
      ) THEN
        RAISE EXCEPTION 'That wallet transaction has already been used to settle a different check-out';
      END IF;
    END IF;

    INSERT INTO public.business_payroll_periods (business_profile_id, period_start, period_end, created_by)
    VALUES (v_business_profile_id, v_period_start, v_period_end, auth.uid())
    ON CONFLICT (business_profile_id, period_start, period_end) DO UPDATE SET business_profile_id = EXCLUDED.business_profile_id
    RETURNING * INTO v_period;

    INSERT INTO public.business_payroll_entries (payroll_period_id, business_profile_id, employee_user_id, base_amount, status, metadata)
    VALUES (v_period.id, v_business_profile_id, v_employee_user_id, v_base_amount, 'paid',
      jsonb_build_object('currency', v_currency, 'pay_frequency', v_status->>'pay_frequency', 'source', 'attendance_checkout',
        'payment_method', lower(p_payment_method), 'wallet_transaction_id', p_wallet_transaction_id, 'paid_at', now()))
    ON CONFLICT (payroll_period_id, employee_user_id) DO UPDATE SET
      base_amount = EXCLUDED.base_amount, status = 'paid',
      metadata = public.business_payroll_entries.metadata || EXCLUDED.metadata, updated_at = now()
    RETURNING * INTO v_entry;

    INSERT INTO public.cmms_payroll_employee_approvals
      (payroll_entry_id, business_profile_id, employee_user_id, requested_by, net_amount, currency, status, responded_at, paid_at, payment_method, wallet_transaction_id)
    VALUES (v_entry.id, v_business_profile_id, v_employee_user_id, auth.uid(), v_entry.net_amount, v_currency, 'paid', now(), now(), lower(p_payment_method), p_wallet_transaction_id)
    ON CONFLICT (payroll_entry_id) DO UPDATE SET
      status = 'paid', responded_at = now(), paid_at = now(),
      payment_method = EXCLUDED.payment_method, wallet_transaction_id = EXCLUDED.wallet_transaction_id, net_amount = EXCLUDED.net_amount;
  END IF;

  INSERT INTO public.cmms_attendance_pay_confirmations
    (attendance_id, cmms_company_id, cmms_user_id, pay_frequency, period_start, period_end, paid, payment_method, payroll_entry_id, wallet_transaction_id, confirmed_by)
  VALUES (p_attendance_id, v_attendance.cmms_company_id, v_attendance.cmms_user_id, v_status->>'pay_frequency', v_period_start, v_period_end,
    p_paid, CASE WHEN p_paid THEN lower(p_payment_method) ELSE NULL END, v_entry.id, v_wallet_tx_id, auth.uid())
  ON CONFLICT (attendance_id) DO UPDATE SET
    paid = EXCLUDED.paid, payment_method = EXCLUDED.payment_method, payroll_entry_id = EXCLUDED.payroll_entry_id,
    wallet_transaction_id = EXCLUDED.wallet_transaction_id, confirmed_at = now();

  RETURN jsonb_build_object('settled', true, 'paid', p_paid, 'entry_id', v_entry.id, 'amount', v_base_amount, 'currency', v_currency);
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_settle_attendance_pay(UUID, BOOLEAN, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_settle_attendance_pay(UUID, BOOLEAN, TEXT, TEXT) TO authenticated;

-- ============================================================
-- staff_check_out / staff_check_out_with_qr: gate check-out on the pay
-- decision. Both now accept the same three extra, defaulted parameters and
-- settle pay BEFORE the attendance row is marked checked_out, so an
-- unanswered pay decision (PAY_CONFIRMATION_REQUIRED) rolls back the whole
-- call — nothing is written and the staff member is not checked out.
-- ============================================================

CREATE OR REPLACE FUNCTION public.staff_check_out(
  p_attendance_id UUID,
  p_location TEXT,
  p_latitude NUMERIC DEFAULT NULL,
  p_longitude NUMERIC DEFAULT NULL,
  p_paid BOOLEAN DEFAULT NULL,
  p_payment_method TEXT DEFAULT NULL,
  p_wallet_transaction_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attendance public.cmms_staff_attendance;
  v_company_location TEXT;
  v_location_match BOOLEAN;
  v_pay_result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  SELECT * INTO v_attendance
    FROM public.cmms_staff_attendance
   WHERE id = p_attendance_id;

  IF v_attendance.id IS NULL THEN
    RAISE EXCEPTION 'Attendance record not found';
  END IF;

  v_pay_result := public.cmms_settle_attendance_pay(v_attendance.id, p_paid, p_payment_method, p_wallet_transaction_id);

  -- Get company location
  SELECT location INTO v_company_location
    FROM public.cmms_company_profiles
   WHERE id = v_attendance.cmms_company_id;

  v_location_match := LOWER(TRIM(COALESCE(p_location, ''))) = LOWER(TRIM(COALESCE(v_company_location, '')));

  UPDATE public.cmms_staff_attendance
     SET check_out_time = now(),
         check_out_location = p_location,
         check_out_latitude = p_latitude,
         check_out_longitude = p_longitude,
         status = 'checked_out',
         updated_at = now()
   WHERE id = p_attendance_id;

  RETURN jsonb_build_object(
    'success', true,
    'attendance_id', p_attendance_id,
    'check_out_time', now(),
    'location_validated', v_location_match,
    'message', 'Check-out successful',
    'pay', v_pay_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.staff_check_out(UUID, TEXT, NUMERIC, NUMERIC, BOOLEAN, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_check_out(UUID, TEXT, NUMERIC, NUMERIC, BOOLEAN, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_check_out_with_qr(
  p_token TEXT,
  p_latitude NUMERIC DEFAULT NULL,
  p_longitude NUMERIC DEFAULT NULL,
  p_paid BOOLEAN DEFAULT NULL,
  p_payment_method TEXT DEFAULT NULL,
  p_wallet_transaction_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qr public.cmms_attendance_qr_locations;
  v_staff public.cmms_users;
  v_attendance public.cmms_staff_attendance;
  v_pay_result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required before checking out';
  END IF;

  SELECT * INTO v_qr
    FROM public.cmms_attendance_qr_locations
   WHERE token = trim(p_token) AND is_active
   FOR UPDATE;
  IF v_qr.id IS NULL THEN
    RAISE EXCEPTION 'This attendance QR code is invalid or has been deactivated';
  END IF;

  SELECT * INTO v_staff
    FROM public.cmms_users
   WHERE cmms_company_id = v_qr.cmms_company_id
     AND is_active
     AND lower(email) = lower(auth.jwt() ->> 'email')
   LIMIT 1;
  IF v_staff.id IS NULL THEN
    RAISE EXCEPTION 'Your signed-in account is not an active staff member for this business';
  END IF;

  SELECT * INTO v_attendance
    FROM public.cmms_staff_attendance
   WHERE cmms_user_id = v_staff.id
     AND cmms_company_id = v_qr.cmms_company_id
     AND status = 'checked_in'
   ORDER BY check_in_time DESC
   LIMIT 1
   FOR UPDATE;
  IF v_attendance.id IS NULL THEN
    RAISE EXCEPTION 'You do not have an active check-in to check out';
  END IF;

  v_pay_result := public.cmms_settle_attendance_pay(v_attendance.id, p_paid, p_payment_method, p_wallet_transaction_id);

  UPDATE public.cmms_staff_attendance
     SET check_out_time = now(),
         check_out_location = v_qr.location_name,
         check_out_latitude = p_latitude,
         check_out_longitude = p_longitude,
         status = 'checked_out',
         updated_at = now()
   WHERE id = v_attendance.id;

  UPDATE public.cmms_attendance_qr_locations SET last_used_at = now() WHERE id = v_qr.id;

  RETURN jsonb_build_object(
    'success', true,
    'attendance_id', v_attendance.id,
    'check_out_time', now(),
    'message', 'Check-out recorded.',
    'pay', v_pay_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.staff_check_out_with_qr(TEXT, NUMERIC, NUMERIC, BOOLEAN, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_check_out_with_qr(TEXT, NUMERIC, NUMERIC, BOOLEAN, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
