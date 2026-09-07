-- ============================================================
-- CMMS Service Provider Contracts -- REAL payments
-- ============================================================
-- Makes contractor payments in CMMS_SERVICE_PROVIDER_CONTRACTS.sql real in
-- three ways, on top of that file's existing contract/followup/payment
-- tables:
--
--   1. Wallet-to-wallet: a provider can sign up for (or sign into) their own
--      IcanEra Wallet account right on their public contract page, and link
--      it to that one contract. Once linked, staff pay them with the SAME
--      pitchin_business_wallet_transfer() RPC (via icanWalletService.
--      transferFromBusinessWallet) that CMMSPayrollPanel.jsx already uses to
--      pay salary from the company's Pichin business wallet -- no new
--      transfer machinery, just wiring this feature into it. Cash stays
--      available for providers who never link a wallet.
--   2. Every payment (cash or wallet) now carries a payment_method and a
--      confirmed_at the PROVIDER sets themselves from their own contract
--      link (fn_confirm_service_provider_payment) -- staff recording an
--      amount is no longer, on its own, proof the provider got it.
--   3. A wallet payment also carries wallet_transaction_id, pointing at the
--      real ican_business_wallet_transactions row, so its actual status
--      (pending_approval / completed / rejected) is always one join away
--      instead of trusted from the moment it was recorded.
--
-- Run after CMMS_SERVICE_PROVIDER_CONTRACTS.sql and
-- PITCHIN_BUSINESS_WALLET_CMMS_FINANCE_APPROVAL.sql (pitchin_business_
-- wallet_transfer, ican_business_wallet_transactions). Safe to run more
-- than once.
-- ============================================================

-- ============================================================
-- 1. Contract: which IcanEra Wallet account (if any) the provider has
-- linked to THIS contract. Nullable until they sign up/in from their
-- public link and link it -- cash keeps working with no wallet at all.
-- ============================================================

ALTER TABLE public.cmms_service_provider_contracts
  ADD COLUMN IF NOT EXISTS provider_wallet_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_wallet_linked_at TIMESTAMPTZ;

-- ============================================================
-- 2. Payments: structured method (cash | wallet), the real wallet
-- transaction this payment came from (wallet only), and the provider's own
-- confirmation.
-- ============================================================

ALTER TABLE public.cmms_service_provider_payments
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(10) NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS wallet_transaction_id UUID REFERENCES public.ican_business_wallet_transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE public.cmms_service_provider_payments
    ADD CONSTRAINT cmms_sp_payments_method_chk CHECK (payment_method IN ('cash', 'wallet'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 3. fn_link_service_provider_wallet -- the provider, now signed into their
-- own IcanEra Wallet account in the browser tab holding their contract link
-- (see PublicServiceProviderContract.jsx's inline sign in/sign up), proves
-- they still hold this contract's PIN/email and links auth.uid() as the
-- payout recipient. Requires a real session (authenticated only, unlike the
-- anon-callable gate/verify functions below) precisely because linking a
-- wallet has to name a real wallet owner.
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_link_service_provider_wallet(TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_link_service_provider_wallet(p_token TEXT, p_credential TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_contract record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to your IcanEra Wallet account first.';
  END IF;

  SELECT * INTO v_contract
  FROM public.cmms_service_provider_contracts
  WHERE access_token = p_token
    AND status = 'published' AND revoked_at IS NULL AND valid_until > NOW();

  IF v_contract IS NULL THEN
    RAISE EXCEPTION 'This contract link is no longer available.';
  END IF;

  IF v_contract.locked_until IS NOT NULL AND v_contract.locked_until > NOW() THEN
    RAISE EXCEPTION 'Too many failed attempts. Try again later.';
  END IF;

  IF v_contract.access_mode = 'pin' THEN
    IF v_contract.pin_hash IS NULL OR crypt(p_credential, v_contract.pin_hash) != v_contract.pin_hash THEN
      UPDATE public.cmms_service_provider_contracts
      SET failed_attempts = failed_attempts + 1,
          locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE locked_until END,
          updated_at = NOW()
      WHERE id = v_contract.id;
      RAISE EXCEPTION 'Incorrect PIN.';
    END IF;
  ELSE
    IF LOWER(TRIM(COALESCE(p_credential, ''))) != v_contract.allowed_email THEN
      RAISE EXCEPTION 'Email does not match.';
    END IF;
  END IF;

  UPDATE public.cmms_service_provider_contracts
  SET provider_wallet_user_id = auth.uid(),
      provider_wallet_linked_at = NOW(),
      updated_at = NOW()
  WHERE id = v_contract.id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_link_service_provider_wallet(TEXT, TEXT) TO authenticated;

-- ============================================================
-- 4. fn_confirm_service_provider_payment -- the provider's own "I received
-- this" action, re-checking the same gate credential the public page already
-- holds (no session required, matching fn_add_service_provider_followup).
-- Works for both cash and wallet payments -- this IS the "contractor must
-- confirm he has received the money" record.
-- ============================================================

-- Cash confirmation also drops the exact same single-row "cash echo" into
-- ican_coin_transactions that complete_cmms_payroll_payment / pay_salary_
-- advance / cmms_settle_attendance_pay / cmms_pay_reward_redemption already
-- use for every other cash-paid path in CMMS -- no real ICAN moves, but a
-- completed row lands in the same transaction feed (get_ican_record_every_
-- transaction_feed) the provider's own wallet history and the company's
-- business-wallet reports both read. A wallet payment never needs this: its
-- own ican_business_wallet_transactions row (checked above) already is that
-- real completed transaction. NOT EXISTS guards against a double row if this
-- is ever called twice for the same payment.
DROP FUNCTION IF EXISTS public.fn_confirm_service_provider_payment(TEXT, TEXT, UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_confirm_service_provider_payment(p_token TEXT, p_credential TEXT, p_payment_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_contract record;
  v_payment record;
  v_business_profile_id UUID;
  v_coin_price NUMERIC;
  v_cash_ican_amount NUMERIC(18,8);
BEGIN
  SELECT * INTO v_contract
  FROM public.cmms_service_provider_contracts
  WHERE access_token = p_token
    AND status = 'published' AND revoked_at IS NULL AND valid_until > NOW();

  IF v_contract IS NULL THEN
    RAISE EXCEPTION 'This contract link is no longer available.';
  END IF;

  IF v_contract.locked_until IS NOT NULL AND v_contract.locked_until > NOW() THEN
    RAISE EXCEPTION 'Too many failed attempts. Try again later.';
  END IF;

  IF v_contract.access_mode = 'pin' THEN
    IF v_contract.pin_hash IS NULL OR crypt(p_credential, v_contract.pin_hash) != v_contract.pin_hash THEN
      UPDATE public.cmms_service_provider_contracts
      SET failed_attempts = failed_attempts + 1,
          locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE locked_until END,
          updated_at = NOW()
      WHERE id = v_contract.id;
      RAISE EXCEPTION 'Incorrect PIN.';
    END IF;
  ELSE
    IF LOWER(TRIM(COALESCE(p_credential, ''))) != v_contract.allowed_email THEN
      RAISE EXCEPTION 'Email does not match.';
    END IF;
  END IF;

  SELECT p.*, bwt.status AS wallet_status INTO v_payment
  FROM public.cmms_service_provider_payments p
  LEFT JOIN public.ican_business_wallet_transactions bwt ON bwt.id = p.wallet_transaction_id
  WHERE p.id = p_payment_id AND p.contract_id = v_contract.id
  FOR UPDATE OF p;

  IF v_payment IS NULL THEN
    RAISE EXCEPTION 'Payment not found.';
  END IF;
  IF v_payment.confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Already confirmed.';
  END IF;
  -- A wallet payment is only real once its ican_business_wallet_transactions
  -- row is completed -- pitchin_business_wallet_transfer() only ever queues
  -- a pending_approval request, the business admin still has to approve it
  -- with the wallet PIN (staff panel's "Approve & send" or ICANWalletInbox)
  -- before any ICAN actually moves. Confirming before that would record
  -- "received" against a transfer that never happened.
  IF v_payment.payment_method = 'wallet' AND COALESCE(v_payment.wallet_status, '') != 'completed' THEN
    RAISE EXCEPTION 'This wallet payment has not completed yet -- it still needs the business administrator''s approval before it can be confirmed as received.';
  END IF;

  UPDATE public.cmms_service_provider_payments
  SET confirmed_at = NOW()
  WHERE id = v_payment.id;

  IF v_payment.payment_method = 'cash' AND NOT EXISTS (
    SELECT 1 FROM public.ican_coin_transactions
     WHERE reference_id = v_payment.id::TEXT AND note LIKE 'Contractor payment (%'
  ) THEN
    SELECT cp.pichin_business_profile_id INTO v_business_profile_id
    FROM public.cmms_company_profiles cp
    WHERE cp.id = v_contract.cmms_company_id;

    SELECT price_local INTO v_coin_price
      FROM public.ican_get_price_in_currency(upper(COALESCE(v_payment.currency, 'UGX')))
     LIMIT 1;
    v_cash_ican_amount := GREATEST(ROUND(v_payment.amount / COALESCE(NULLIF(v_coin_price, 0), 5000), 8), 0.00000001);

    INSERT INTO public.ican_coin_transactions
      (recipient_user_id, ican_amount, type, transaction_type, source_app, status,
       local_amount, local_currency, reference_id, note, business_profile_id,
       merchant_name, counterparty_type, expense_classification)
    VALUES (
      v_contract.provider_wallet_user_id, v_cash_ican_amount, 'transfer_out', 'transfer_out', 'ican', 'completed',
      v_payment.amount, v_payment.currency, v_payment.id::TEXT,
      'Contractor payment (' || v_contract.provider_name || ')',
      v_business_profile_id, v_contract.provider_name, 'business', 'business_expense'
    );
  END IF;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_confirm_service_provider_payment(TEXT, TEXT, UUID) TO anon, authenticated;

-- ============================================================
-- 5. fn_verify_service_provider_contract_pin / _email -- re-declared to
-- also return wallet_linked, and to include id/payment_method/confirmed_at
-- on each payment so the public page can render confirm buttons and wallet
-- sign-up. Everything else is unchanged from CMMS_SERVICE_PROVIDER_
-- CONTRACTS.sql.
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_verify_service_provider_contract_pin(TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_verify_service_provider_contract_pin(p_token TEXT, p_pin TEXT)
RETURNS TABLE (
  status TEXT,
  locked_until TIMESTAMPTZ,
  title VARCHAR,
  content JSONB,
  provider_name VARCHAR,
  company_name VARCHAR,
  job_title VARCHAR,
  job_status VARCHAR,
  valid_until TIMESTAMPTZ,
  wallet_linked BOOLEAN,
  followups JSONB,
  payments JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_contract record;
BEGIN
  SELECT sp.* INTO v_contract
  FROM public.cmms_service_provider_contracts sp
  WHERE sp.access_token = p_token AND sp.access_mode = 'pin'
    AND sp.status = 'published' AND sp.revoked_at IS NULL AND sp.valid_until > NOW();

  IF v_contract IS NULL THEN
    RETURN QUERY SELECT 'invalid'::TEXT, NULL::TIMESTAMPTZ, NULL::VARCHAR, NULL::JSONB, NULL::VARCHAR,
      NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::TIMESTAMPTZ, NULL::BOOLEAN, NULL::JSONB, NULL::JSONB;
    RETURN;
  END IF;

  IF v_contract.locked_until IS NOT NULL AND v_contract.locked_until > NOW() THEN
    RETURN QUERY SELECT 'locked'::TEXT, v_contract.locked_until, NULL::VARCHAR, NULL::JSONB, NULL::VARCHAR,
      NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::TIMESTAMPTZ, NULL::BOOLEAN, NULL::JSONB, NULL::JSONB;
    RETURN;
  END IF;

  IF v_contract.pin_hash IS NULL OR crypt(p_pin, v_contract.pin_hash) != v_contract.pin_hash THEN
    UPDATE public.cmms_service_provider_contracts
    SET failed_attempts = failed_attempts + 1,
        locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE locked_until END,
        updated_at = NOW()
    WHERE id = v_contract.id;

    RETURN QUERY SELECT 'invalid_pin'::TEXT, NULL::TIMESTAMPTZ, NULL::VARCHAR, NULL::JSONB, NULL::VARCHAR,
      NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::TIMESTAMPTZ, NULL::BOOLEAN, NULL::JSONB, NULL::JSONB;
    RETURN;
  END IF;

  UPDATE public.cmms_service_provider_contracts
  SET failed_attempts = 0, locked_until = NULL, updated_at = NOW()
  WHERE id = v_contract.id;

  RETURN QUERY
  SELECT 'ok'::TEXT, NULL::TIMESTAMPTZ, c.title, c.content, c.provider_name, cp.company_name,
    ja.job_title, ja.assignment_status, c.valid_until,
    (c.provider_wallet_user_id IS NOT NULL),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('author_type', f.author_type, 'note', f.note, 'created_at', f.created_at) ORDER BY f.created_at)
      FROM public.cmms_service_provider_followups f WHERE f.contract_id = c.id
    ), '[]'::JSONB),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'amount', p.amount, 'currency', p.currency, 'method', p.method,
        'payment_method', p.payment_method, 'reference', p.reference, 'payment_date', p.payment_date,
        'confirmed_at', p.confirmed_at, 'wallet_status', bwt.status) ORDER BY p.payment_date)
      FROM public.cmms_service_provider_payments p
      LEFT JOIN public.ican_business_wallet_transactions bwt ON bwt.id = p.wallet_transaction_id
      WHERE p.contract_id = c.id
    ), '[]'::JSONB)
  FROM public.cmms_service_provider_contracts c
  JOIN public.cmms_company_profiles cp ON cp.id = c.cmms_company_id
  LEFT JOIN public.cmms_job_assignments ja ON ja.id = c.job_assignment_id
  WHERE c.id = v_contract.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_verify_service_provider_contract_pin(TEXT, TEXT) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.fn_verify_service_provider_contract_email(TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.fn_verify_service_provider_contract_email(p_token TEXT, p_email TEXT)
RETURNS TABLE (
  status TEXT,
  title VARCHAR,
  content JSONB,
  provider_name VARCHAR,
  company_name VARCHAR,
  job_title VARCHAR,
  job_status VARCHAR,
  valid_until TIMESTAMPTZ,
  wallet_linked BOOLEAN,
  followups JSONB,
  payments JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract record;
  v_email TEXT := LOWER(TRIM(COALESCE(p_email, '')));
BEGIN
  SELECT sp.* INTO v_contract
  FROM public.cmms_service_provider_contracts sp
  WHERE sp.access_token = p_token AND sp.access_mode = 'email'
    AND sp.status = 'published' AND sp.revoked_at IS NULL AND sp.valid_until > NOW();

  IF v_contract IS NULL OR v_email = '' OR v_email != v_contract.allowed_email THEN
    RETURN QUERY SELECT 'not_allowed'::TEXT, NULL::VARCHAR, NULL::JSONB, NULL::VARCHAR,
      NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::TIMESTAMPTZ, NULL::BOOLEAN, NULL::JSONB, NULL::JSONB;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 'ok'::TEXT, c.title, c.content, c.provider_name, cp.company_name,
    ja.job_title, ja.assignment_status, c.valid_until,
    (c.provider_wallet_user_id IS NOT NULL),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('author_type', f.author_type, 'note', f.note, 'created_at', f.created_at) ORDER BY f.created_at)
      FROM public.cmms_service_provider_followups f WHERE f.contract_id = c.id
    ), '[]'::JSONB),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'amount', p.amount, 'currency', p.currency, 'method', p.method,
        'payment_method', p.payment_method, 'reference', p.reference, 'payment_date', p.payment_date,
        'confirmed_at', p.confirmed_at, 'wallet_status', bwt.status) ORDER BY p.payment_date)
      FROM public.cmms_service_provider_payments p
      LEFT JOIN public.ican_business_wallet_transactions bwt ON bwt.id = p.wallet_transaction_id
      WHERE p.contract_id = c.id
    ), '[]'::JSONB)
  FROM public.cmms_service_provider_contracts c
  JOIN public.cmms_company_profiles cp ON cp.id = c.cmms_company_id
  LEFT JOIN public.cmms_job_assignments ja ON ja.id = c.job_assignment_id
  WHERE c.id = v_contract.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_verify_service_provider_contract_email(TEXT, TEXT) TO anon, authenticated;

-- ============================================================
-- 6. BACKFILL -- any cash payment a provider already confirmed under the
-- earlier version of fn_confirm_service_provider_payment (before it wrote
-- the ledger echo above) never got that row. One-time sweep, guarded by the
-- same NOT EXISTS check the function itself uses, matching CMMS_PAYROLL_
-- RUN_CASH_TRANSACTION_RECORD.sql's backfill for the identical gap there.
-- ============================================================

DO $$
DECLARE
  v_payment RECORD;
  v_contract public.cmms_service_provider_contracts;
  v_business_profile_id UUID;
  v_coin_price NUMERIC;
  v_cash_ican_amount NUMERIC(18,8);
BEGIN
  FOR v_payment IN
    SELECT * FROM public.cmms_service_provider_payments
     WHERE payment_method = 'cash'
       AND confirmed_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.ican_coin_transactions
          WHERE reference_id = cmms_service_provider_payments.id::TEXT AND note LIKE 'Contractor payment (%'
       )
  LOOP
    SELECT * INTO v_contract FROM public.cmms_service_provider_contracts WHERE id = v_payment.contract_id;
    IF v_contract.id IS NULL THEN CONTINUE; END IF;

    SELECT cp.pichin_business_profile_id INTO v_business_profile_id
    FROM public.cmms_company_profiles cp
    WHERE cp.id = v_contract.cmms_company_id;

    SELECT price_local INTO v_coin_price
      FROM public.ican_get_price_in_currency(upper(COALESCE(v_payment.currency, 'UGX')))
     LIMIT 1;
    v_cash_ican_amount := GREATEST(ROUND(v_payment.amount / COALESCE(NULLIF(v_coin_price, 0), 5000), 8), 0.00000001);

    INSERT INTO public.ican_coin_transactions
      (recipient_user_id, ican_amount, type, transaction_type, source_app, status,
       local_amount, local_currency, reference_id, note, business_profile_id,
       merchant_name, counterparty_type, expense_classification, created_at)
    VALUES (
      v_contract.provider_wallet_user_id, v_cash_ican_amount, 'transfer_out', 'transfer_out', 'ican', 'completed',
      v_payment.amount, v_payment.currency, v_payment.id::TEXT,
      'Contractor payment (' || v_contract.provider_name || ')',
      v_business_profile_id, v_contract.provider_name, 'business', 'business_expense',
      v_payment.confirmed_at
    );
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS service provider contracts: real cash/wallet payments + provider confirmation installed' AS status;
