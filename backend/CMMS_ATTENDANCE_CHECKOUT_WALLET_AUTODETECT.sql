-- ============================================================================
-- CMMS Attendance Check-out -> Pay Confirmation: self-service wallet lookup
-- Run after CMMS_ATTENDANCE_CHECKOUT_PAY_CONFIRMATION.sql.
--
-- GAP THIS CLOSES: cmms_settle_attendance_pay (see
-- CMMS_ATTENDANCE_CHECKOUT_PAY_CONFIRMATION.sql) requires a real, completed
-- ican_business_wallet_transactions id to settle an "ican" pay confirmation
-- — it will not just trust the client. The admin-run manual check-out flow
-- (CMSSAttendancePanel.jsx) satisfies that by initiating the wallet transfer
-- itself (with the business-wallet PIN) and passing back the id it gets.
-- The employee's own self check-out (PublicStaffAttendanceCheckIn.jsx),
-- however, has no wallet PIN and no way to initiate a transfer — it let the
-- employee pick "IcanEra wallet" as how they were paid but never had an id
-- to send, so confirming always failed with "A completed IcanEra wallet
-- transfer is required to record this payment", even when the business had
-- genuinely already paid them.
--
-- This adds a read-only lookup the self check-out page can call once the
-- employee says "yes, paid via wallet": does a completed business-wallet
-- transfer to *this employee*, for the amount actually due this period,
-- already exist and not already be claimed by a different check-out? If so,
-- hand back its id so check-out can pass it straight through; if not, the
-- page can tell the employee to ask for the wallet payment first instead of
-- letting them hit a raw database error.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cmms_find_wallet_payment_for_checkout(
  p_cmms_user_id UUID,
  p_cmms_company_id UUID,
  p_attendance_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status JSONB;
  v_business_profile_id UUID;
  v_employee_user_id UUID;
  v_expected_ican NUMERIC(18,8);
  v_wallet_tx_id UUID;
BEGIN
  v_status := public.cmms_checkout_pay_status(p_cmms_user_id, p_cmms_company_id, p_attendance_id);
  IF NOT COALESCE((v_status->>'required')::BOOLEAN, FALSE) THEN
    RETURN NULL;
  END IF;
  IF upper(COALESCE(v_status->>'currency', 'UGX')) <> 'UGX' THEN
    RETURN NULL;
  END IF;

  v_employee_user_id := (v_status->>'employee_user_id')::UUID;
  SELECT pichin_business_profile_id INTO v_business_profile_id
    FROM public.cmms_company_profiles WHERE id = p_cmms_company_id;
  IF v_business_profile_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Same shared ICAN/UGX floor rate cmms_settle_attendance_pay checks the
  -- wallet payment against.
  v_expected_ican := ROUND((v_status->>'amount')::NUMERIC / 5000, 8);

  SELECT tx.id INTO v_wallet_tx_id
    FROM public.ican_business_wallet_transactions tx
   WHERE tx.business_profile_id = v_business_profile_id
     AND tx.recipient_user_id = v_employee_user_id
     AND tx.status = 'completed'
     AND ABS(tx.amount_ican - v_expected_ican) <= 0.0001
     AND NOT EXISTS (
       SELECT 1 FROM public.cmms_attendance_pay_confirmations c
        WHERE c.wallet_transaction_id = tx.id
          AND (p_attendance_id IS NULL OR c.attendance_id <> p_attendance_id)
     )
   ORDER BY COALESCE(tx.executed_at, tx.created_at) DESC
   LIMIT 1;

  RETURN v_wallet_tx_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_find_wallet_payment_for_checkout(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_find_wallet_payment_for_checkout(UUID, UUID, UUID) TO authenticated;

-- Same lookup for the public QR self check-out page, which only knows the
-- token and the signed-in staff session (mirrors
-- cmms_checkout_pay_status_by_qr's own staff resolution).
CREATE OR REPLACE FUNCTION public.cmms_find_wallet_payment_for_checkout_by_qr(p_token TEXT)
RETURNS UUID
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
    RETURN NULL;
  END IF;

  SELECT * INTO v_qr FROM public.cmms_attendance_qr_locations WHERE token = trim(p_token) AND is_active;
  IF v_qr.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_staff FROM public.cmms_users
   WHERE cmms_company_id = v_qr.cmms_company_id AND is_active AND lower(email) = lower(auth.jwt() ->> 'email')
   LIMIT 1;
  IF v_staff.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN public.cmms_find_wallet_payment_for_checkout(v_staff.id, v_qr.cmms_company_id);
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_find_wallet_payment_for_checkout_by_qr(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_find_wallet_payment_for_checkout_by_qr(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
