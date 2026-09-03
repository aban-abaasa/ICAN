-- ============================================================================
-- CMMS "Today is payday" notification + AI prosperity advisory
-- Run after CMMS_PAYROLL_EMPLOYEE_APPROVALS.sql, CMMS_ATTENDANCE_CHECKOUT_PAY_CONFIRMATION.sql,
-- CMMS_TASK_PROGRESS_TRACKING_AND_NOTIFICATIONS.sql (fn_create_cmms_notification /
-- cmms_notifications), ADD_LIVE_INFLATION_TRACKING.sql (ican_get_price_in_currency),
-- PITCHIN_LIVE_SHARE_AVAILABILITY.sql (fn_get_business_issued_shares), and
-- db/trust_system_schema.sql (trust_groups / trust_group_members).
--
-- WHAT THIS ADDS: the two places an employee's salary is actually marked
-- paid — complete_cmms_payroll_payment (the normal payroll-run payment) and
-- cmms_settle_attendance_pay (the attendance check-out pay-confirmation
-- flow) — now both queue a "today is payday" notification instead of paying
-- silently. Two layers:
--
--   1. INSTANT, fact-only notification (cmms_queue_payday_advisory, run
--      inline inside the same transaction as the payment): "You're being
--      paid X today (~ Y ICAN at today's live rate)" — the live rate comes
--      from ican_get_price_in_currency(), the same function
--      cmms_settle_attendance_pay already uses for its own cash-to-ICAN
--      conversion, so the number the employee sees always matches what the
--      system actually used.
--
--   2. A one-line AI "prosperity adviser" recommendation, added a few
--      seconds later by a Node backend worker (services/cmmsPaydayAdvisoryService.js)
--      polling cmms_payday_advisories — never generated inline, since an
--      OpenAI/Gemini call has no place blocking a payroll payment. The SQL
--      side's only job is to gather real facts into that row's `facts`
--      jsonb — the employee's active Trust Group memberships
--      (trust_groups/trust_group_members) and up to 3 PitchIn businesses
--      that currently have shares available (business_profiles.total_shares
--      minus fn_get_business_issued_shares(), the same live-availability
--      math the PitchIn invest flow itself uses — see
--      pitchinValuationService.js's getLiveShareOffer) — so the AI has
--      something concrete to recommend instead of generic advice, and can
--      never claim a number this migration didn't actually compute.
--
-- cmms_queue_payday_advisory has NO internal caller check (it trusts
-- whatever cmms_company_id/employee_user_id it's given) because it is only
-- ever meant to be called from inside another already-authorized SECURITY
-- DEFINER function (the two payment functions below, which already checked
-- who's allowed to pay). It is deliberately NOT granted to `authenticated`
-- — a direct grant would let any signed-in user spam arbitrary employees
-- with fake "you got paid" notifications naming any amount they like.
-- ============================================================================

-- ============================================================
-- 1. QUEUE TABLE — one row per payday event, holding the facts the AI
--    worker needs and the advice it writes back.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cmms_payday_advisories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  cmms_user_id UUID NOT NULL REFERENCES public.cmms_users(id) ON DELETE CASCADE,
  employee_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_id UUID REFERENCES public.cmms_notifications(id) ON DELETE CASCADE,
  amount NUMERIC(15,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'UGX',
  ican_amount NUMERIC(18,8),
  ican_rate_ugx NUMERIC(18,8),
  source TEXT NOT NULL CHECK (source IN ('payroll_run', 'attendance_checkout')),
  source_id UUID,
  facts JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'advised', 'failed')),
  advice_text TEXT,
  advice_provider TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cmms_payday_advisories_pending
  ON public.cmms_payday_advisories(created_at)
  WHERE status = 'pending';

ALTER TABLE public.cmms_payday_advisories ENABLE ROW LEVEL SECURITY;
-- No policies: this is an internal working table read/written only by the
-- SECURITY DEFINER queue function and the backend worker's service-role key
-- (which bypasses RLS entirely). Employees see the result via
-- cmms_notifications, which already has its own read policy.

-- ============================================================
-- 2. QUEUE FUNCTION — instant fact notification + a pending advisory row
--    for the worker to enrich with AI advice.
-- ============================================================
CREATE OR REPLACE FUNCTION public.cmms_queue_payday_advisory(
  p_cmms_company_id UUID,
  p_employee_user_id UUID,
  p_amount NUMERIC,
  p_currency TEXT,
  p_source TEXT,
  p_source_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cmms_user_id UUID;
  v_currency TEXT;
  v_ican_rate NUMERIC(18,8);
  v_ican_amount NUMERIC(18,8);
  v_trust_groups JSONB;
  v_share_offers JSONB;
  v_facts JSONB;
  v_notification_id UUID;
  v_advisory_id UUID;
BEGIN
  IF p_employee_user_id IS NULL OR p_amount IS NULL OR p_amount <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_cmms_user_id
    FROM public.cmms_users
   WHERE cmms_company_id = p_cmms_company_id AND ican_user_id = p_employee_user_id
   LIMIT 1;
  IF v_cmms_user_id IS NULL THEN
    RETURN NULL; -- not a recognized/linked CMMS staff member — nowhere to notify
  END IF;

  v_currency := upper(COALESCE(NULLIF(TRIM(p_currency), ''), 'UGX'));

  -- Same live rate cmms_settle_attendance_pay already converts cash pay with.
  BEGIN
    SELECT price_local INTO v_ican_rate FROM public.ican_get_price_in_currency(v_currency) LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_ican_rate := NULL;
  END;
  v_ican_rate := COALESCE(NULLIF(v_ican_rate, 0), 5000);
  v_ican_amount := ROUND(p_amount / v_ican_rate, 8);

  BEGIN
    SELECT jsonb_agg(jsonb_build_object(
             'name', tg.name, 'monthly_contribution', tg.monthly_contribution, 'currency', tg.currency
           ))
      INTO v_trust_groups
      FROM public.trust_group_members tgm
      JOIN public.trust_groups tg ON tg.id = tgm.group_id AND tg.status = 'active'
     WHERE tgm.user_id = p_employee_user_id AND tgm.is_active;
  EXCEPTION WHEN OTHERS THEN
    v_trust_groups := NULL;
  END;

  -- Same live availability math PitchIn's own invest flow uses (see
  -- pitchinValuationService.js getLiveShareOffer): total_shares minus what
  -- fn_get_business_issued_shares reports as already issued/pending.
  BEGIN
    SELECT jsonb_agg(x) INTO v_share_offers
      FROM (
        SELECT bp.business_name AS name,
               bp.declared_share_price_ugx AS price_ugx,
               GREATEST(bp.total_shares - public.fn_get_business_issued_shares(bp.id), 0) AS shares_available
          FROM public.business_profiles bp
          JOIN public.pitches pt ON pt.business_profile_id = bp.id AND pt.status = 'published'
         WHERE COALESCE(bp.total_shares, 0) > 0
           AND GREATEST(bp.total_shares - public.fn_get_business_issued_shares(bp.id), 0) > 0
         ORDER BY random()
         LIMIT 3
      ) x;
  EXCEPTION WHEN OTHERS THEN
    v_share_offers := NULL;
  END;

  v_facts := jsonb_build_object(
    'amount', p_amount,
    'currency', v_currency,
    'ican_amount', v_ican_amount,
    'ican_rate_ugx', v_ican_rate,
    'trust_groups', COALESCE(v_trust_groups, '[]'::jsonb),
    'share_offers', COALESCE(v_share_offers, '[]'::jsonb)
  );

  INSERT INTO public.cmms_notifications (
    cmms_user_id, cmms_company_id, notification_type, title, message, icon, action_tab, action_label
  ) VALUES (
    v_cmms_user_id, p_cmms_company_id, 'payday', '💰 Today Is Payday!',
    format('You''re being paid %s %s today (≈ %s ICAN at today''s rate).', v_currency, p_amount, v_ican_amount),
    '💰', 'payroll', 'View'
  ) RETURNING id INTO v_notification_id;

  INSERT INTO public.cmms_payday_advisories (
    cmms_company_id, cmms_user_id, employee_user_id, notification_id,
    amount, currency, ican_amount, ican_rate_ugx, source, source_id, facts
  ) VALUES (
    p_cmms_company_id, v_cmms_user_id, p_employee_user_id, v_notification_id,
    p_amount, v_currency, v_ican_amount, v_ican_rate, p_source, p_source_id, v_facts
  ) RETURNING id INTO v_advisory_id;

  RETURN v_advisory_id;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification/advisory hiccup block or roll back the actual
  -- payroll payment it rides on.
  RAISE NOTICE 'Warning: Failed to queue payday advisory - %', SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.cmms_queue_payday_advisory(UUID, UUID, NUMERIC, TEXT, TEXT, UUID) FROM PUBLIC;
-- Deliberately no GRANT to `authenticated` — see header comment.

-- ============================================================
-- 3. HOOK: complete_cmms_payroll_payment (normal payroll-run payment)
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_cmms_payroll_payment(p_payroll_entry_id UUID, p_payment_method TEXT, p_wallet_transaction_id TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.cmms_payroll_employee_approvals;
  v_entry public.business_payroll_entries;
  v_cmms_company_id UUID;
  v_currency TEXT;
BEGIN
  SELECT * INTO v_entry FROM public.business_payroll_entries WHERE id = p_payroll_entry_id FOR UPDATE;
  IF NOT public.ican_business_admin(v_entry.business_profile_id) THEN RAISE EXCEPTION 'You cannot complete this payroll payment'; END IF;
  SELECT * INTO v_request FROM public.cmms_payroll_employee_approvals WHERE payroll_entry_id = p_payroll_entry_id FOR UPDATE;
  IF v_request.status <> 'approved' THEN RAISE EXCEPTION 'Employee approval is required before salary payment'; END IF;
  IF p_payment_method NOT IN ('cash', 'ican') THEN RAISE EXCEPTION 'Invalid payment method'; END IF;
  UPDATE public.business_payroll_entries SET status = 'paid', metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('payment_method', p_payment_method, 'wallet_transaction_id', p_wallet_transaction_id, 'paid_at', now()), updated_at = now() WHERE id = p_payroll_entry_id;
  UPDATE public.cmms_payroll_employee_approvals SET status = 'paid', payment_method = p_payment_method, wallet_transaction_id = p_wallet_transaction_id, paid_at = now() WHERE id = v_request.id;

  SELECT id INTO v_cmms_company_id FROM public.cmms_company_profiles WHERE pichin_business_profile_id = v_entry.business_profile_id LIMIT 1;
  v_currency := COALESCE(NULLIF(v_entry.metadata->>'currency', ''), v_request.currency, 'UGX');

  IF v_cmms_company_id IS NOT NULL THEN
    PERFORM public.cmms_queue_payday_advisory(
      v_cmms_company_id, v_entry.employee_user_id, v_entry.net_amount, v_currency, 'payroll_run', p_payroll_entry_id
    );
  END IF;

  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION public.complete_cmms_payroll_payment(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_cmms_payroll_payment(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================
-- 4. HOOK: cmms_settle_attendance_pay (attendance check-out pay confirmation)
-- ============================================================
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
  v_coin_price NUMERIC;
  v_cash_ican_amount NUMERIC(18,8);
  v_employee_name TEXT;
  v_business_name TEXT;
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

  SELECT COALESCE(full_name, user_name) INTO v_employee_name
    FROM public.cmms_users WHERE id = v_attendance.cmms_user_id;

  SELECT business_name INTO v_business_name
    FROM public.business_profiles WHERE id = v_business_profile_id;

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

    -- A wallet payment already has a real ledger row (written by
    -- pitchin_execute_business_wallet_transfer when the transfer we just
    -- verified was approved) — it shows up for both sides automatically.
    -- Cash never touches a wallet, so nothing else records it: without this,
    -- a cash-paid check-out is invisible on both the business's transaction
    -- history and the employee's own personal transactions.
    --
    -- Exactly ONE row is written (no balance is touched — it is a record,
    -- not a transfer), matching the single-row pattern
    -- pitchin_execute_business_wallet_transfer itself uses in
    -- ICAN_BUSINESS_WALLET_TRANSFERS.sql for "business wallet pays a real
    -- user" (recipient_user_id IS NOT NULL branch) — as opposed to the
    -- transfer_out/transfer_in PAIR transfer_ican() writes for a genuine
    -- person-to-person transfer, where each side's balance actually moves.
    -- get_ican_record_every_transaction_feed unions on sender_user_id,
    -- recipient_user_id AND business_profile_id independently, so a single
    -- row carrying both recipient_user_id (the employee) and
    -- business_profile_id (the business) already surfaces on both the
    -- employee's personal feed and the business's feed — no second row
    -- needed. ICANWallet.jsx's per-viewer sign is
    -- `sender_user_id === me && type === 'transfer_out' ? -1 : +1`; with
    -- sender_user_id NULL here, the employee (not the sender) reads it as
    -- +income automatically. An earlier version of this function wrote a
    -- second "business's copy" row that also carried recipient_user_id =
    -- the employee (only type/expense_classification differed) — that put
    -- both a transfer_out and a transfer_in under the *same* recipient, so
    -- they net to zero in any per-user sum: nothing appeared to have been
    -- recorded for either party, and the row meant to represent the
    -- business's side was wrongly keyed to the person instead of relying on
    -- business_profile_id alone to carry the business side.
    --
    -- counterparty_type/expense_classification are also set explicitly:
    -- ican_coin_transactions defaults them to 'person'/'person_transfer',
    -- which is what made this read as an ordinary peer-to-peer transfer
    -- instead of a business salary payment. merchant_name carries the real
    -- business name so the UI shows who actually paid instead of a generic
    -- app-level label.
    --
    -- sender_user_id is deliberately left NULL (not auth.uid()): the
    -- business paid this, not whoever happened to click confirm, and no
    -- balance moved out of that person's own wallet. business_profile_id
    -- alone carries the payer.
    --
    -- ican_coin_transactions still carries the legacy NOT NULL "type"
    -- column alongside "transaction_type" (see transfer_ican_to_business
    -- and pitchin_execute_business_wallet_transfer in
    -- ICAN_BUSINESS_WALLET_TRANSFERS.sql, which set both) — omitting it
    -- fails the insert with a not-null violation.
    --
    -- reference_id ties this row back to the same business_payroll_entries
    -- row the CMMS Payroll panel pays and reads from, so the salary record
    -- of truth stays the payroll entry — this is only the ledger echo of it.
    --
    -- source_app is 'ican' (this payment didn't originate in any of the
    -- other three sibling apps sharing the wallet), never 'digital-city-era'
    -- — the report/category UI (MobileView.jsx) hardcodes that value to mean
    -- the SupermartKera app specifically and labels the row accordingly, so
    -- using it here would show a salary payment as a supermarket purchase.
    IF lower(p_payment_method) = 'cash' AND NOT EXISTS (
      SELECT 1 FROM public.ican_coin_transactions
       WHERE reference_id = v_entry.id::TEXT AND note LIKE 'Salary (%'
    ) THEN
      SELECT price_local INTO v_coin_price
        FROM public.ican_get_price_in_currency(upper(COALESCE(v_currency, 'UGX')))
       LIMIT 1;
      v_cash_ican_amount := GREATEST(ROUND(v_base_amount / COALESCE(NULLIF(v_coin_price, 0), 5000), 8), 0.00000001);

      INSERT INTO public.ican_coin_transactions
        (recipient_user_id, ican_amount, type, transaction_type, source_app, status,
         local_amount, local_currency, reference_id, note, business_profile_id,
         merchant_name, counterparty_type, expense_classification)
      VALUES (
        v_employee_user_id, v_cash_ican_amount, 'transfer_out', 'transfer_out', 'ican', 'completed',
        v_base_amount, v_currency, v_entry.id::TEXT,
        'Salary (' || COALESCE(v_employee_name, 'Employee') || ')',
        v_business_profile_id, v_business_name, 'business', 'business_expense'
      );
    END IF;

    PERFORM public.cmms_queue_payday_advisory(
      v_attendance.cmms_company_id, v_employee_user_id, v_entry.net_amount, v_currency, 'attendance_checkout', p_attendance_id
    );
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

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────
-- VERIFY
-- ─────────────────────────────────────────────────────────────────────────
SELECT 'CMMS payday notification + advisory queue installed' AS status;
