-- ===========================================================================
-- ICAN DIGITAL CARD: pay an ICANera account or a BANK account (not only
-- mobile money) when the card PIN is approved on the scan page.
--
-- Run AFTER: ICAN_DIGITAL_CARD_QR.sql and ICAN_FIAT_MOBILE_MONEY_SEND_MIGRATION.sql
-- Redeploy:  supabase functions deploy card-pay-with-pin
--
--  * ICANera account -> one atomic UGX wallet debit + credit (both rows
--    locked in one transaction, so there is nothing to refund). Personal
--    accounts only for now.
--  * Bank account    -> Flutterwave transfer. Reuses the MOMOSEND- reference
--    prefix on purpose: flutterwave-transfer-webhook already routes that prefix
--    to resolve_fiat_momo_send, which refunds the wallet on failure, so the
--    webhook needs no change.
--
-- Flutterwave cannot resolve a Ugandan bank account name before sending, so
-- the approver types the account name and it is NOT verified. Safe to re-run.
-- ===========================================================================

-- ─── 1. Scan history can describe all three destinations ────────────────────
ALTER TABLE public.ican_card_qr_requests ADD COLUMN IF NOT EXISTS dest_type TEXT NOT NULL DEFAULT 'momo';
ALTER TABLE public.ican_card_qr_requests ADD COLUMN IF NOT EXISTS bank_code TEXT;
ALTER TABLE public.ican_card_qr_requests ADD COLUMN IF NOT EXISTS beneficiary_name TEXT;

-- recipient_phone holds the phone for momo, or the account number otherwise.
ALTER TABLE public.ican_card_qr_requests DROP CONSTRAINT IF EXISTS ican_card_qr_requests_recipient_network_check;
ALTER TABLE public.ican_card_qr_requests ADD CONSTRAINT ican_card_qr_requests_recipient_network_check
  CHECK (recipient_network IN ('MTN', 'AIRTEL', 'ICANERA', 'BANK'));

-- ─── 2. Fiat send requests can be bank sends ────────────────────────────────
ALTER TABLE public.ican_fiat_send_requests ADD COLUMN IF NOT EXISTS bank_code TEXT;
ALTER TABLE public.ican_fiat_send_requests ADD COLUMN IF NOT EXISTS beneficiary_name TEXT;
ALTER TABLE public.ican_fiat_send_requests DROP CONSTRAINT IF EXISTS ican_fiat_send_requests_recipient_network_check;
ALTER TABLE public.ican_fiat_send_requests ADD CONSTRAINT ican_fiat_send_requests_recipient_network_check
  CHECK (recipient_network IN ('MTN', 'AIRTEL', 'BANK'));

-- Debit the wallet and open a bank send (service_role only; the Edge Function
-- has already verified the card owner's PIN).
CREATE OR REPLACE FUNCTION public.request_fiat_bank_send(
  p_user_id        UUID,
  p_amount         DECIMAL,
  p_account_number TEXT,
  p_bank_code      TEXT,
  p_beneficiary    TEXT,
  p_note           TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new_balance DECIMAL;
  v_reference   TEXT;
  v_request_id  UUID;
BEGIN
  IF p_account_number IS NULL OR p_account_number !~ '^[0-9]{5,20}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter a valid bank account number');
  END IF;
  IF p_bank_code IS NULL OR length(trim(p_bank_code)) = 0 OR length(trim(coalesce(p_beneficiary, ''))) < 2 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bank and account name are required');
  END IF;
  IF NOT (p_amount > 0) THEN
    RETURN jsonb_build_object('success', false, 'error', 'amount must be a positive number');
  END IF;

  UPDATE public.wallet_accounts
     SET balance = balance - p_amount
   WHERE user_id = p_user_id AND currency = 'UGX' AND balance >= p_amount
  RETURNING balance INTO v_new_balance;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance or wallet not found');
  END IF;

  -- MOMOSEND- prefix => webhook resolves via resolve_fiat_momo_send (refunds on failure).
  v_reference := 'MOMOSEND-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' ||
                 upper(substr(md5(gen_random_uuid()::text), 1, 8));

  INSERT INTO public.ican_fiat_send_requests
    (sender_user_id, amount, fee, net_amount, currency, recipient_phone, recipient_network,
     note, status, flutterwave_reference, bank_code, beneficiary_name)
  VALUES
    (p_user_id, p_amount, 0, p_amount, 'UGX', p_account_number, 'BANK',
     p_note, 'pending', v_reference, trim(p_bank_code), left(trim(p_beneficiary), 80))
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object('success', true, 'request_id', v_request_id, 'reference', v_reference,
                            'amount', p_amount, 'fee', 0, 'net_amount', p_amount, 'balance', v_new_balance);
END $$;

REVOKE ALL ON FUNCTION public.request_fiat_bank_send(UUID, DECIMAL, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_fiat_bank_send(UUID, DECIMAL, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ─── 3. Wallet -> ICANera account, atomic ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.card_pin_send_to_account(
  p_from_user      UUID,
  p_account_number TEXT,
  p_amount         DECIMAL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_to_user UUID;
  v_to_name TEXT;
BEGIN
  IF NOT (p_amount > 0) THEN
    RETURN jsonb_build_object('success', false, 'error', 'amount must be a positive number');
  END IF;

  SELECT user_id, account_holder_name INTO v_to_user, v_to_name
    FROM public.user_accounts
   WHERE account_number = p_account_number AND business_id IS NULL AND coalesce(status, 'active') = 'active'
   LIMIT 1;
  IF v_to_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active personal ICANera account with that number');
  END IF;
  IF v_to_user = p_from_user THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot pay the card owner''s own account');
  END IF;

  -- Lock both wallets in a fixed order (no deadlocks), recipient must have a UGX wallet.
  PERFORM 1 FROM public.wallet_accounts
   WHERE user_id IN (p_from_user, v_to_user) AND currency = 'UGX'
   ORDER BY user_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.wallet_accounts WHERE user_id = v_to_user AND currency = 'UGX') THEN
    RETURN jsonb_build_object('success', false, 'error', 'That account has no UGX wallet yet');
  END IF;

  UPDATE public.wallet_accounts SET balance = balance - p_amount
   WHERE user_id = p_from_user AND currency = 'UGX' AND balance >= p_amount;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance or wallet not found');
  END IF;

  UPDATE public.wallet_accounts SET balance = balance + p_amount
   WHERE user_id = v_to_user AND currency = 'UGX';

  RETURN jsonb_build_object('success', true, 'recipient_name', v_to_name);
END $$;

REVOKE ALL ON FUNCTION public.card_pin_send_to_account(UUID, TEXT, DECIMAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.card_pin_send_to_account(UUID, TEXT, DECIMAL) TO service_role;

-- ─── 4. Scan page: show who an account number belongs to (masked) ───────────
-- Needs the card's QR token so it can't be used as an open name directory.
CREATE OR REPLACE FUNCTION public.get_card_qr_account_name(p_token TEXT, p_account_number TEXT)
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  -- Most accounts have no account_holder_name stored, so fall back to the
  -- sign-up name, then a generic label (never NULL for a real account).
  SELECT CASE
           WHEN n.full_name IS NULL THEN 'ICANera member'
           ELSE initcap(split_part(n.full_name, ' ', 1)) ||
                CASE WHEN position(' ' in n.full_name) > 0
                     THEN ' ' || upper(left(split_part(n.full_name, ' ', 2), 1)) || '.' ELSE '' END
         END
    FROM public.user_accounts ua
    LEFT JOIN auth.users au ON au.id = ua.user_id
    CROSS JOIN LATERAL (
      SELECT coalesce(
               nullif(trim(ua.account_holder_name), ''),
               nullif(trim(au.raw_user_meta_data->>'full_name'), ''),
               nullif(trim(au.raw_user_meta_data->>'name'), '')
             ) AS full_name
    ) n
   WHERE ua.account_number = p_account_number AND ua.business_id IS NULL
     AND coalesce(ua.status, 'active') = 'active'
     AND EXISTS (SELECT 1 FROM public.ican_digital_cards c
                  WHERE c.qr_token = p_token AND c.qr_enabled AND c.status = 'active')
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_card_qr_account_name(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_card_qr_account_name(TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
