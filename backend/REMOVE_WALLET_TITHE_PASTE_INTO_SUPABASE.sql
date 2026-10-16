-- Remove tithe from the IcanEra wallet (every app: ican, mybodaguy, digital-city-era, farm-agentera).
--
-- Tithe is no longer a wallet concept. Nothing is taken out of an earning or a business-wallet payment any more,
-- and no 'tithe' ledger row is written. Tithe now lives only in the ICAN app's Tithe tab, where a person chooses to
-- give to a church (see 20261014100000_church_tithe_giving.sql) -- those functions are not touched here.
--
-- What changes
--   credit_ican_earning()              credits the FULL amount (was 90%), records one 'earn' row, no 'tithe' row
--   transfer_ican_to_business()        the business wallet receives the FULL amount (was 90%)
--   transfer_agent_fiat_to_business()  the business wallet receives the FULL amount (was 90%)
-- The JSON they return still carries tithe_deducted = 0 so a client that has not updated yet keeps working.
--
-- What does NOT change: the total_tithe_paid column and the old 'tithe' ledger rows stay, as history. Nothing is deleted.
-- Safe to run more than once.


CREATE OR REPLACE FUNCTION public.credit_ican_earning(
  p_user_id      UUID,
  p_amount       DECIMAL,
  p_source_app   TEXT    DEFAULT 'ican',
  p_note         TEXT    DEFAULT '',
  p_reference_id TEXT    DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_actor_role TEXT;
  v_earn_tx_id UUID;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  v_actor_role := ican_resolve_caller_role();

  PERFORM get_or_create_ican_wallet(p_user_id);

  -- Credit the full amount.
  UPDATE ican_user_wallets
  SET ican_balance = ican_balance + p_amount,
      total_earned = total_earned + p_amount
  WHERE user_id = p_user_id;

  INSERT INTO ican_coin_transactions
    (recipient_user_id, ican_amount,
     transaction_type, source_app, reference_id, note, actor_role)
  VALUES
    (p_user_id, p_amount,
     'earn', p_source_app, p_reference_id, p_note, v_actor_role)
  RETURNING id INTO v_earn_tx_id;

  RETURN jsonb_build_object(
    'success',        true,
    'tx_id',          v_earn_tx_id,
    'gross_earned',   p_amount,
    'tithe_deducted', 0,
    'net_credited',   p_amount,
    'actor_role',     v_actor_role
  );
END;
$$;

DROP FUNCTION IF EXISTS public.transfer_ican_to_business(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.transfer_ican_to_business(
  p_from_user UUID,
  p_business_profile_id UUID,
  p_amount NUMERIC,
  p_note TEXT DEFAULT '',
  p_source_app TEXT DEFAULT 'ican',
  p_reference_id TEXT DEFAULT NULL,
  p_pin_attempt TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_balance NUMERIC;
  v_coin_price NUMERIC;
  v_local_currency TEXT;
  v_net NUMERIC;
  v_wallet public.ican_business_wallets;
  v_out_tx UUID;
  v_in_tx UUID;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_from_user THEN
    RAISE EXCEPTION 'Only the authenticated sender can initiate this transfer';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;
  IF p_source_app NOT IN ('ican', 'digital-city-era', 'farm-agent', 'mybodaguy') THEN
    RAISE EXCEPTION 'Invalid source_app';
  END IF;

  -- Value this ledger entry in the receiving business's operating currency,
  -- using the current global ICAN rate, not a fixed UGX conversion.
  SELECT p.currency_code, p.price_local
    INTO v_local_currency, v_coin_price
    FROM public.business_profiles bp
    LEFT JOIN public.user_accounts ua ON ua.user_id = bp.user_id
    CROSS JOIN LATERAL public.ican_get_price_by_country(
      COALESCE(NULLIF(TRIM(ua.country_code), ''), 'US')
    ) p
   WHERE bp.id = p_business_profile_id
   LIMIT 1;
  IF v_coin_price IS NULL OR v_coin_price <= 0 THEN
    RAISE EXCEPTION 'Current ICAN price unavailable';
  END IF;

  -- Agent BIZ transfers require the authenticated agent's wallet PIN.
  IF p_source_app = 'farm-agent' THEN
    IF p_pin_attempt IS NULL OR NOT EXISTS (
      SELECT 1
        FROM public.user_accounts ua
       WHERE ua.user_id = auth.uid()
         AND ua.pin_hash = p_pin_attempt
         AND COALESCE(ua.status, 'active') = 'active'
    ) THEN
      RAISE EXCEPTION 'Invalid agent wallet PIN';
    END IF;
  END IF;

  SELECT * INTO v_wallet
    FROM public.ican_business_wallets
   WHERE business_profile_id = p_business_profile_id
     AND status = 'active'
   FOR UPDATE;
  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Business wallet not found or inactive';
  END IF;

  SELECT ican_balance INTO v_sender_balance
    FROM public.ican_user_wallets
   WHERE user_id = p_from_user
   FOR UPDATE;
  IF v_sender_balance IS NULL THEN
    RAISE EXCEPTION 'Sender wallet not found';
  END IF;
  IF v_sender_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient ICAN balance';
  END IF;

  v_net := p_amount;

  UPDATE public.ican_user_wallets
     SET ican_balance = ican_balance - p_amount,
         total_spent = total_spent + p_amount
   WHERE user_id = p_from_user;

  UPDATE public.ican_business_wallets
     SET ican_balance = ican_balance + v_net,
         total_earned = total_earned + v_net,
         updated_at = now()
   WHERE business_profile_id = p_business_profile_id;

  INSERT INTO public.ican_coin_transactions
    (sender_user_id, ican_amount, type, transaction_type, status, local_amount, local_currency,
     source_app, reference_id, note, business_profile_id)
  VALUES
    (p_from_user, p_amount, 'transfer_out', 'transfer_out', 'completed', round(p_amount * v_coin_price, 2), v_local_currency, p_source_app,
     p_reference_id, coalesce(p_note, ''), p_business_profile_id)
  RETURNING id INTO v_out_tx;

  -- This is a business-wallet receipt, not a credit to the owner's personal
  -- ICAN wallet/trading account.
  INSERT INTO public.ican_coin_transactions
    (sender_user_id, ican_amount, type, transaction_type, status, local_amount, local_currency,
     source_app, reference_id, note, business_profile_id)
  VALUES
    (NULL, v_net, 'transfer_in', 'transfer_in', 'completed', round(v_net * v_coin_price, 2), v_local_currency, p_source_app,
     p_reference_id, coalesce(p_note, ''), p_business_profile_id)
  RETURNING id INTO v_in_tx;

  RETURN jsonb_build_object(
    'success', true,
    'out_tx_id', v_out_tx,
    'in_tx_id', v_in_tx,
    'amount_sent', p_amount,
    'tithe_deducted', 0,
    'business_received', v_net,
    'business_profile_id', p_business_profile_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_ican_to_business(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_ican_to_business(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.transfer_agent_fiat_to_business(
  p_agent_id UUID,
  p_business_profile_id UUID,
  p_amount_local NUMERIC,
  p_currency TEXT DEFAULT 'UGX',
  p_pin_attempt TEXT DEFAULT NULL,
  p_wallet_address TEXT DEFAULT NULL,
  p_note TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent public.agents;
  v_float public.agent_floats;
  v_wallet public.ican_business_wallets;
  v_coin_price NUMERIC;
  v_ican_amount NUMERIC;
  v_net NUMERIC;
  v_tx UUID;
BEGIN
  SELECT * INTO v_agent
    FROM public.agents
   WHERE id = p_agent_id
     AND user_id = auth.uid()
     AND status = 'active'
   FOR UPDATE;
  IF v_agent.id IS NULL THEN RAISE EXCEPTION 'Agent not found or inactive'; END IF;
  IF p_amount_local IS NULL OR p_amount_local <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF upper(trim(COALESCE(p_currency, ''))) !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Unsupported agent currency: %', p_currency;
  END IF;
  IF p_pin_attempt IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_accounts ua
     WHERE ua.user_id = auth.uid()
       AND ua.pin_hash = p_pin_attempt
       AND COALESCE(ua.status, 'active') = 'active'
  ) THEN RAISE EXCEPTION 'Invalid agent wallet PIN'; END IF;

  SELECT * INTO v_wallet
    FROM public.ican_business_wallets
   WHERE business_profile_id = p_business_profile_id
     AND status = 'active'
     AND (p_wallet_address IS NULL OR upper(trim(wallet_address)) = upper(trim(p_wallet_address)))
   FOR UPDATE;
  IF v_wallet.id IS NULL THEN RAISE EXCEPTION 'Business wallet not found or inactive'; END IF;

  SELECT * INTO v_float
    FROM public.agent_floats
   WHERE agent_id = p_agent_id
     AND upper(currency) = upper(trim(p_currency))
     AND NOT is_frozen
   FOR UPDATE;
  IF v_float.id IS NULL THEN RAISE EXCEPTION '% agent float not found or frozen', upper(p_currency); END IF;
  IF v_float.current_balance < p_amount_local THEN
    RAISE EXCEPTION 'Insufficient % float', upper(p_currency);
  END IF;

  SELECT price_local INTO v_coin_price
    FROM public.ican_get_price_in_currency(upper(trim(p_currency)))
   LIMIT 1;
  IF v_coin_price IS NULL OR v_coin_price <= 0 THEN RAISE EXCEPTION 'Current ICAN price unavailable'; END IF;

  v_ican_amount := round(p_amount_local / v_coin_price, 8);
  v_net := v_ican_amount;

  UPDATE public.agent_floats
     SET current_balance = current_balance - p_amount_local,
         total_withdrawn = COALESCE(total_withdrawn, 0) + p_amount_local,
         updated_at = now()
   WHERE id = v_float.id;
  UPDATE public.ican_business_wallets
     SET ican_balance = ican_balance + v_net,
         total_earned = total_earned + v_net,
         updated_at = now()
   WHERE id = v_wallet.id;

  INSERT INTO public.ican_coin_transactions
    (sender_user_id, ican_amount, type, transaction_type, status, local_amount, local_currency,
     source_app, note, business_profile_id)
  VALUES
     (auth.uid(), v_ican_amount, 'transfer_out', 'transfer_out', 'completed', p_amount_local,
     upper(trim(p_currency)), 'farm-agent',
     COALESCE(p_note, '') || ' (' || upper(p_currency) || ' agent float)',
     p_business_profile_id);

  INSERT INTO public.agent_transactions
    (agent_id, user_id, transaction_type, amount, currency, commission_amount,
     net_amount, user_account_id, reference_number, status, completed_at, metadata)
  VALUES
     (p_agent_id, NULL, 'cash_out', p_amount_local, upper(p_currency), 0, p_amount_local,
     COALESCE(p_wallet_address, v_wallet.wallet_address), 'BIZ-ICAN-' || gen_random_uuid(),
     'completed', now(), jsonb_build_object('business_profile_id', p_business_profile_id,
       'ican_amount', v_ican_amount, 'coin_price', v_coin_price,
       'currency', upper(p_currency)));

  RETURN jsonb_build_object('success', true, 'amount_local', p_amount_local,
    'currency', upper(p_currency), 'coin_price', v_coin_price, 'ican_amount', v_ican_amount,
    'tithe_deducted', 0, 'business_received', v_net,
    'business_profile_id', p_business_profile_id);
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_agent_fiat_to_business(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_agent_fiat_to_business(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO authenticated;
