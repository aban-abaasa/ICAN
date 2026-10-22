-- What the migration meets on a real database, besides the real ICAN_FIAT_MOBILE_MONEY_SEND_MIGRATION.sql (loaded before this).
\set ON_ERROR_STOP on

-- VERBATIM from backend/ADD_CARD_PIN_PAY_ACCOUNT_AND_BANK.sql section 2: the bank send as it is live today (six arguments, no fee).
ALTER TABLE public.ican_fiat_send_requests ADD COLUMN IF NOT EXISTS bank_code TEXT;
ALTER TABLE public.ican_fiat_send_requests ADD COLUMN IF NOT EXISTS beneficiary_name TEXT;
ALTER TABLE public.ican_fiat_send_requests DROP CONSTRAINT IF EXISTS ican_fiat_send_requests_recipient_network_check;
ALTER TABLE public.ican_fiat_send_requests ADD CONSTRAINT ican_fiat_send_requests_recipient_network_check
  CHECK (recipient_network IN ('MTN', 'AIRTEL', 'BANK'));

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

-- Stand-ins for the two coin functions: only the three rate statements are copied exactly as the LIVE database has them
-- (read from pg_proc): ROUND(v_ugx_gross * 0.03, 2) and ROUND(p_ican_amount * 0.03, 8) in sell_ican_coins, and
-- ROUND(v_request.ican_amount * 0.03, 8) in resolve_ican_payout. Everything else about them is irrelevant to the migration.
CREATE FUNCTION public.sell_ican_coins(p_user_id UUID, p_ican_amount NUMERIC, p_source_app TEXT DEFAULT 'ican', p_reference TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ugx_gross  DECIMAL;
  v_fee        DECIMAL;
  v_credit     DECIMAL;
BEGIN
  v_ugx_gross  := p_ican_amount * 5000;
  v_fee        := ROUND(v_ugx_gross * 0.03, 2);
  v_credit     := ROUND(p_ican_amount * 0.03, 8);
  RETURN jsonb_build_object('fee_ugx', v_fee, 'platform_credit_ican', v_credit);
END $$;

CREATE FUNCTION public.resolve_ican_payout(p_reference TEXT, p_success BOOLEAN, p_flutterwave_transfer_id TEXT DEFAULT NULL, p_failure_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_request RECORD;
BEGIN
  SELECT 100::NUMERIC AS ican_amount INTO v_request;
  RETURN jsonb_build_object('platform_credit_ican', ROUND(v_request.ican_amount * 0.03, 8));
END $$;

CREATE FUNCTION public.request_ican_payout(p_user_id UUID, p_ican_amount NUMERIC, p_channel TEXT, p_destination JSONB, p_source_app TEXT, p_fee_ugx NUMERIC DEFAULT 0)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER AS $$ SELECT jsonb_build_object('success', true) $$;
