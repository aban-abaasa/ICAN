-- ============================================================
-- A business tithe is paid BY the business (its own wallet account)
-- ============================================================
-- Follow-up to 20261014110000_church_tithe_business_wallet.sql. When a tithe is for a business,
-- the giver picks which business they own is paying and the money leaves THAT business's wallet
-- account (user_accounts: account_type = 'business', ugx_balance) instead of their personal wallet.
-- The business wallet's own PIN is checked in the app first. Rules the database enforces: the
-- caller must own the paying business, it must have an active wallet account with enough balance,
-- and a business cannot pay itself. Personal tithes are unchanged.
-- Safe to re-run. Run the two earlier church_tithe migrations first.
-- ============================================================

ALTER TABLE public.ican_tithe_records ADD COLUMN IF NOT EXISTS payer_business_id UUID;
COMMENT ON COLUMN public.ican_tithe_records.payer_business_id IS
  'For a business tithe paid from a business wallet: the business that paid (business_profiles.id).';

-- A new trailing parameter would leave the old 8-argument version as a second overload; drop it so
-- there is exactly one fn_give_tithe_to_church.
DROP FUNCTION IF EXISTS public.fn_give_tithe_to_church(UUID, DECIMAL, VARCHAR, TEXT, BOOLEAN, TEXT, TEXT, DATE);

CREATE OR REPLACE FUNCTION public.fn_give_tithe_to_church(
  p_business_id    UUID,
  p_amount         DECIMAL,
  p_giving_type    VARCHAR DEFAULT 'tithe',
  p_payment_method TEXT    DEFAULT 'wallet',
  p_is_anonymous   BOOLEAN DEFAULT FALSE,
  p_message        TEXT    DEFAULT NULL,
  p_tithe_type     TEXT    DEFAULT 'personal',
  p_giving_date    DATE    DEFAULT CURRENT_DATE,
  p_payer_business_id UUID DEFAULT NULL
)
RETURNS TABLE (
  success            BOOLEAN,
  tithe_record_id    UUID,
  new_wallet_balance DECIMAL,
  church_name        TEXT,
  message            TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID := auth.uid();
  v_owner_id UUID;
  v_church   TEXT;
  v_status   TEXT;
  v_balance  DECIMAL;
  v_new_bal  DECIMAL;
  v_tithe_id UUID;
  v_txn_id   UUID;
  v_hash     VARCHAR;
  v_prev     VARCHAR;
  v_credited TEXT;
  v_payer_name TEXT;
  v_payer_acct UUID;
  v_type     TEXT := CASE WHEN p_tithe_type = 'business' OR p_payer_business_id IS NOT NULL THEN 'business' ELSE 'personal' END;
  v_date     DATE := COALESCE(p_giving_date, CURRENT_DATE);
  v_msg      TEXT := NULLIF(left(btrim(COALESCE(p_message, '')), 500), '');
BEGIN
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, NULL::TEXT, 'Not authenticated'::TEXT;
    RETURN;
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, NULL::TEXT, 'Enter an amount greater than 0'::TEXT;
    RETURN;
  END IF;
  IF p_payment_method NOT IN ('wallet', 'cash') THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, NULL::TEXT,
      'Use the Flutterwave checkout to give by mobile money or card'::TEXT;
    RETURN;
  END IF;
  IF p_giving_type NOT IN ('tithe', 'offering', 'charity', 'mission', 'building_fund', 'alms', 'other') THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, NULL::TEXT, 'Unknown type of giving'::TEXT;
    RETURN;
  END IF;

  SELECT bp.user_id, bp.business_name::TEXT, COALESCE(bp.status, 'active')
    INTO v_owner_id, v_church, v_status
  FROM public.business_profiles bp
  WHERE bp.id = p_business_id;

  IF v_owner_id IS NULL OR v_status <> 'active' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, NULL::TEXT, 'That church is not available to receive tithe'::TEXT;
    RETURN;
  END IF;
  IF v_owner_id = v_user_id AND p_payer_business_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, v_church,
      'You own this church, so there is nowhere to send it. Use the normal tithe tabs to record your own giving.'::TEXT;
    RETURN;
  END IF;

  -- A business tithe is paid BY the business: it must be one the caller owns, and it cannot pay itself.
  IF p_payer_business_id IS NOT NULL THEN
    SELECT bp.business_name::TEXT INTO v_payer_name
    FROM public.business_profiles bp
    WHERE bp.id = p_payer_business_id AND bp.user_id = v_user_id AND COALESCE(bp.status, 'active') = 'active';
    IF v_payer_name IS NULL THEN
      RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, v_church, 'You can only pay from a business you own'::TEXT;
      RETURN;
    END IF;
    IF p_payer_business_id = p_business_id THEN
      RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, v_church, 'A business cannot pay itself'::TEXT;
      RETURN;
    END IF;
  END IF;

  IF p_payer_business_id IS NOT NULL AND p_payment_method = 'wallet' THEN
    -- Business pays: lock ITS wallet account, then check and debit.
    SELECT ua.id, COALESCE(ua.ugx_balance, 0) INTO v_payer_acct, v_balance
    FROM public.user_accounts ua
    WHERE ua.business_id = p_payer_business_id
      AND ua.account_type = 'business'
      AND COALESCE(ua.status, 'active') = 'active'
    ORDER BY ua.created_at
    LIMIT 1
    FOR UPDATE;
    IF v_payer_acct IS NULL THEN
      RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, v_church,
        (v_payer_name || ' has no business wallet account yet. Create one, or pay by mobile money / cash.')::TEXT;
      RETURN;
    END IF;
    IF v_balance < p_amount THEN
      RETURN QUERY SELECT FALSE, NULL::UUID, v_balance, v_church,
        ('Insufficient business wallet balance. ' || v_payer_name || ' has ' || v_balance::TEXT || ' UGX but needs ' || p_amount::TEXT || '.')::TEXT;
      RETURN;
    END IF;
    v_new_bal := v_balance - p_amount;
    UPDATE public.user_accounts ua
       SET ugx_balance = v_new_bal, last_transaction_at = NOW(), updated_at = NOW()
     WHERE ua.id = v_payer_acct;
  ELSE
    -- Wallet: lock the giver's row, then check and debit.
    SELECT COALESCE(wa.balance, 0) INTO v_balance
    FROM public.wallet_accounts wa
    WHERE wa.user_id = v_user_id AND wa.currency = 'UGX'
    ORDER BY wa.created_at
    LIMIT 1
    FOR UPDATE;
    v_balance := COALESCE(v_balance, 0);
    v_new_bal := v_balance;

    IF p_payment_method = 'wallet' THEN
      IF v_balance < p_amount THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, v_balance, v_church,
          ('Insufficient wallet balance. You have ' || v_balance::TEXT || ' UGX but need ' || p_amount::TEXT || '. Choose mobile money or cash instead.')::TEXT;
        RETURN;
      END IF;
      v_new_bal := v_balance - p_amount;
      UPDATE public.wallet_accounts wa SET balance = v_new_bal, updated_at = NOW()
       WHERE wa.user_id = v_user_id AND wa.currency = 'UGX';
    END IF;
  END IF;

  INSERT INTO public.ican_tithe_records (
    user_id, giving_type, amount, currency, recipient_type, recipient_name_encrypted,
    tithe_percentage, giving_date, notes_encrypted, is_anonymous, blockchain_status,
    payment_method, tithe_type, recipient_business_id, recipient_name, giver_message, payer_business_id
  ) VALUES (
    v_user_id, p_giving_type, p_amount, 'UGX', 'church', v_church,
    10.0, v_date, 'CHURCH:' || p_business_id::TEXT || '|' || v_church, COALESCE(p_is_anonymous, FALSE), 'local',
    p_payment_method, v_type, p_business_id, v_church, v_msg, p_payer_business_id
  ) RETURNING id INTO v_tithe_id;

  INSERT INTO public.ican_financial_transactions (
    user_id, transaction_type, amount, currency, category, sub_category, description,
    source, transaction_date, status, data_hash, metadata
  ) VALUES (
    v_user_id, 'tithe', p_amount, 'UGX', 'giving', p_giving_type,
    'Tithe/Charitable Giving - church (' || v_church || ')',
    'manual', v_date, 'completed',
    md5(p_amount::TEXT || v_user_id::TEXT || NOW()::TEXT),
    jsonb_build_object('tithe_record_id', v_tithe_id::TEXT, 'recipient_business_id', p_business_id::TEXT,
      'payment_method', p_payment_method, 'tithe_type', v_type, 'is_anonymous', COALESCE(p_is_anonymous, FALSE))
  ) RETURNING id INTO v_txn_id;

  UPDATE public.ican_tithe_records tr SET transaction_id = v_txn_id WHERE tr.id = v_tithe_id;

  SELECT al.action_hash INTO v_prev FROM public.tithe_audit_log al WHERE al.user_id = v_user_id ORDER BY al.created_at DESC LIMIT 1;
  v_hash := md5('tithe_added' || v_user_id::TEXT || v_tithe_id::TEXT || p_amount::TEXT || COALESCE(v_prev, '') || NOW()::TEXT);
  INSERT INTO public.tithe_audit_log (
    user_id, tithe_record_id, transaction_id, action_type, amount, currency,
    wallet_deducted, previous_balance, new_balance, action_hash, previous_hash, action_details
  ) VALUES (
    v_user_id, v_tithe_id, v_txn_id, 'tithe_added', p_amount, 'UGX',
    (p_payment_method = 'wallet'), v_balance, v_new_bal, v_hash, v_prev,
    jsonb_build_object('action', 'tithe_payment_recorded', 'status', 'confirmed', 'payment_method', p_payment_method,
      'tithe_type', v_type, 'recipient_business_id', p_business_id::TEXT)
  );

  IF p_payment_method = 'wallet' THEN
    v_credited := public.fn_credit_business_wallet_ugx(p_business_id, v_owner_id, p_amount);
    UPDATE public.ican_tithe_records tr SET credited_to = v_credited WHERE tr.id = v_tithe_id;
  END IF;

  RETURN QUERY SELECT TRUE, v_tithe_id, v_new_bal, v_church,
    CASE WHEN p_payment_method = 'wallet'
      THEN 'Sent to ' || v_church || CASE WHEN v_credited = 'business_wallet' THEN '''s business wallet' ELSE ' (credited to the owner''s wallet — it has no business wallet yet)' END || ' from ' || COALESCE(v_payer_name || '''s business wallet', 'your IcanEra wallet') || '.'
      ELSE 'Tithe recorded as cash given to ' || v_church || '. They will confirm when it reaches them.'
    END::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_give_tithe_to_church(UUID, DECIMAL, VARCHAR, TEXT, BOOLEAN, TEXT, TEXT, DATE, UUID) TO authenticated;
