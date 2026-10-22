-- Rolls back 20261106100000_fee_rates.sql
--
--   * sell_ican_coins / resolve_ican_payout go back to the fixed 3% typed into them
--   * request_fiat_bank_send goes back to its six-argument form (no fee, net = amount)
--   * the rates table and ican_fee_rate() are dropped
--
-- It deliberately does NOT hand anon / authenticated their EXECUTE on the server-only money functions back: that was the
-- security hole, not a feature. Bank sends sent with a fee while the migration was live keep their recorded fee and net amount.
-- Safe to run twice.

DO $unpatch$
DECLARE
  v_name TEXT;
  v_oid  OID;
  v_def  TEXT;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['sell_ican_coins', 'resolve_ican_payout'] LOOP
    FOR v_oid IN
      SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = v_name
    LOOP
      v_def := pg_get_functiondef(v_oid);
      CONTINUE WHEN position('public.ican_fee_rate(''coin_cash_out'')' IN v_def) = 0;
      EXECUTE replace(v_def, 'public.ican_fee_rate(''coin_cash_out'')', '0.03');
    END LOOP;
  END LOOP;
END $unpatch$;

DROP FUNCTION IF EXISTS public.request_fiat_bank_send(UUID, DECIMAL, TEXT, TEXT, TEXT, TEXT, DECIMAL);

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

REVOKE ALL ON FUNCTION public.request_fiat_bank_send(UUID, DECIMAL, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_fiat_bank_send(UUID, DECIMAL, TEXT, TEXT, TEXT, TEXT) TO service_role;

DROP FUNCTION IF EXISTS public.ican_fee_rate(TEXT);
DROP TABLE IF EXISTS public.ican_fee_rates;
DROP FUNCTION IF EXISTS public.ican_fee_rates_touch();
