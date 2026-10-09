-- ============================================================
-- Pay a business into its own business wallet account
-- ============================================================
-- Follow-up to 20261014100000_church_tithe_giving.sql. When the person you pay is a business,
-- the money now lands in that business's wallet account (user_accounts: account_type = 'business',
-- business_id = the business, ugx_balance) instead of the owner's personal wallet. A business
-- that has no active wallet account yet falls back to its owner's wallet so the payment is never
-- lost, and the record notes where it went (ican_tithe_records.credited_to).
-- Safe to re-run. Run 20261014100000_church_tithe_giving.sql first.
-- ============================================================

ALTER TABLE public.ican_tithe_records ADD COLUMN IF NOT EXISTS credited_to TEXT;
COMMENT ON COLUMN public.ican_tithe_records.credited_to IS
  'Where a wallet / flutterwave payment landed: business_wallet (the business''s own wallet account) or owner_wallet (fallback when the business has none).';

-- Credit the business wallet account if it has one, else the owner's wallet. Returns where it went.
CREATE OR REPLACE FUNCTION public.fn_credit_business_wallet_ugx(p_business_id UUID, p_owner_id UUID, p_amount DECIMAL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  SELECT ua.id INTO v_account_id
  FROM public.user_accounts ua
  WHERE ua.business_id = p_business_id
    AND ua.account_type = 'business'
    AND COALESCE(ua.status, 'active') = 'active'
  ORDER BY ua.created_at
  LIMIT 1
  FOR UPDATE;

  IF v_account_id IS NOT NULL THEN
    UPDATE public.user_accounts ua
       SET ugx_balance = COALESCE(ua.ugx_balance, 0) + p_amount,
           last_transaction_at = NOW(), updated_at = NOW()
     WHERE ua.id = v_account_id;
    RETURN 'business_wallet';
  END IF;

  PERFORM public.fn_credit_wallet_ugx(p_owner_id, p_amount);
  RETURN 'owner_wallet';
END;
$$;

REVOKE ALL ON FUNCTION public.fn_credit_business_wallet_ugx(UUID, UUID, DECIMAL) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5. Give by wallet or cash
-- ------------------------------------------------------------
-- The wallet PIN is checked by the app before this is called (same as every other wallet
-- spend in the app). Everything the database can enforce, it does: the recipient must be an
-- active business that is not the giver's own, the amount must be positive, the giver's wallet
-- row is locked while it is debited, and debit + credit + record succeed or fail together.
-- Self-contained on purpose (it writes the same tithe / report / audit rows fn_add_tithe does)
-- so a church tithe does not depend on that function's current body.
CREATE OR REPLACE FUNCTION public.fn_give_tithe_to_church(
  p_business_id    UUID,
  p_amount         DECIMAL,
  p_giving_type    VARCHAR DEFAULT 'tithe',
  p_payment_method TEXT    DEFAULT 'wallet',
  p_is_anonymous   BOOLEAN DEFAULT FALSE,
  p_message        TEXT    DEFAULT NULL,
  p_tithe_type     TEXT    DEFAULT 'personal',
  p_giving_date    DATE    DEFAULT CURRENT_DATE
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
  v_type     TEXT := CASE WHEN p_tithe_type = 'business' THEN 'business' ELSE 'personal' END;
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
  IF v_owner_id = v_user_id THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DECIMAL, v_church,
      'You own this church, so there is nowhere to send it. Use the normal tithe tabs to record your own giving.'::TEXT;
    RETURN;
  END IF;

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

  INSERT INTO public.ican_tithe_records (
    user_id, giving_type, amount, currency, recipient_type, recipient_name_encrypted,
    tithe_percentage, giving_date, notes_encrypted, is_anonymous, blockchain_status,
    payment_method, tithe_type, recipient_business_id, recipient_name, giver_message
  ) VALUES (
    v_user_id, p_giving_type, p_amount, 'UGX', 'church', v_church,
    10.0, v_date, 'CHURCH:' || p_business_id::TEXT || '|' || v_church, COALESCE(p_is_anonymous, FALSE), 'local',
    p_payment_method, v_type, p_business_id, v_church, v_msg
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
      THEN 'Sent to ' || v_church || CASE WHEN v_credited = 'business_wallet' THEN '''s business wallet' ELSE ' (credited to the owner''s wallet — it has no business wallet yet)' END || ' from your IcanEra wallet.'
      ELSE 'Tithe recorded as cash given to ' || v_church || '. They will confirm when it reaches them.'
    END::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_give_tithe_to_church(UUID, DECIMAL, VARCHAR, TEXT, BOOLEAN, TEXT, TEXT, DATE) TO authenticated;

-- ------------------------------------------------------------
-- 6. Settle a verified Flutterwave payment (service role only)
-- ------------------------------------------------------------
-- Called only by the verify-tithe-payment Edge Function AFTER it has confirmed with
-- Flutterwave that the charge succeeded, in UGX, for at least p_amount. Idempotent on
-- p_tx_ref: replaying the same charge returns the original record instead of paying twice.
CREATE OR REPLACE FUNCTION public.fn_settle_church_tithe_flutterwave(
  p_user_id       UUID,
  p_business_id   UUID,
  p_amount        DECIMAL,
  p_giving_type   TEXT,
  p_is_anonymous  BOOLEAN,
  p_message       TEXT,
  p_tithe_type    TEXT,
  p_tx_ref        TEXT,
  p_flw_transaction_id TEXT
)
RETURNS TABLE (success BOOLEAN, tithe_record_id UUID, church_name TEXT, already_processed BOOLEAN, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id UUID;
  v_church   TEXT;
  v_status   TEXT;
  v_existing UUID;
  v_tithe_id UUID;
  v_txn_id   UUID;
  v_hash     VARCHAR;
  v_prev     VARCHAR;
  v_credited TEXT;
  v_type     TEXT := CASE WHEN p_tithe_type = 'business' THEN 'business' ELSE 'personal' END;
BEGIN
  IF p_user_id IS NULL OR p_tx_ref IS NULL OR p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, FALSE, 'Missing payment details'::TEXT;
    RETURN;
  END IF;

  SELECT tr.id INTO v_existing FROM public.ican_tithe_records tr WHERE tr.payment_reference = p_tx_ref;
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_existing, NULL::TEXT, TRUE, 'This payment was already settled'::TEXT;
    RETURN;
  END IF;

  SELECT bp.user_id, bp.business_name::TEXT, COALESCE(bp.status, 'active')
    INTO v_owner_id, v_church, v_status
  FROM public.business_profiles bp WHERE bp.id = p_business_id;

  IF v_owner_id IS NULL OR v_status <> 'active' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, FALSE, 'That church is not available to receive tithe'::TEXT;
    RETURN;
  END IF;

  INSERT INTO public.ican_tithe_records (
    user_id, giving_type, amount, currency, recipient_type, recipient_name_encrypted,
    tithe_percentage, giving_date, notes_encrypted, is_anonymous, blockchain_status,
    payment_method, tithe_type, recipient_business_id, recipient_name, payment_reference, giver_message
  ) VALUES (
    p_user_id, COALESCE(NULLIF(p_giving_type, ''), 'tithe'), p_amount, 'UGX', 'church', v_church,
    10.0, CURRENT_DATE, 'CHURCH:' || p_business_id::TEXT || '|' || v_church || '|FLW:' || COALESCE(p_flw_transaction_id, ''),
    COALESCE(p_is_anonymous, FALSE), 'local',
    'flutterwave', v_type, p_business_id, v_church, p_tx_ref, NULLIF(left(btrim(COALESCE(p_message, '')), 500), '')
  ) RETURNING id INTO v_tithe_id;

  INSERT INTO public.ican_financial_transactions (
    user_id, transaction_type, amount, currency, category, sub_category, description,
    source, transaction_date, status, data_hash, metadata
  ) VALUES (
    p_user_id, 'tithe', p_amount, 'UGX', 'giving', COALESCE(NULLIF(p_giving_type, ''), 'tithe'),
    'Tithe/Charitable Giving - church (' || v_church || ')',
    'flutterwave', CURRENT_DATE, 'completed',
    md5(p_amount::TEXT || p_user_id::TEXT || p_tx_ref),
    jsonb_build_object('tithe_record_id', v_tithe_id::TEXT, 'recipient_business_id', p_business_id::TEXT,
      'payment_method', 'flutterwave', 'tx_ref', p_tx_ref, 'flutterwave_transaction_id', p_flw_transaction_id,
      'tithe_type', v_type, 'is_anonymous', COALESCE(p_is_anonymous, FALSE))
  ) RETURNING id INTO v_txn_id;

  UPDATE public.ican_tithe_records SET transaction_id = v_txn_id, payment_status = 'paid', settled_date = NOW()
   WHERE id = v_tithe_id;

  SELECT al.action_hash INTO v_prev FROM public.tithe_audit_log al WHERE al.user_id = p_user_id ORDER BY al.created_at DESC LIMIT 1;
  v_hash := md5('tithe_added' || p_user_id::TEXT || v_tithe_id::TEXT || p_amount::TEXT || COALESCE(v_prev, '') || NOW()::TEXT);
  INSERT INTO public.tithe_audit_log (
    user_id, tithe_record_id, transaction_id, action_type, amount, currency,
    wallet_deducted, action_hash, previous_hash, action_details
  ) VALUES (
    p_user_id, v_tithe_id, v_txn_id, 'tithe_added', p_amount, 'UGX', FALSE, v_hash, v_prev,
    jsonb_build_object('action', 'tithe_payment_recorded', 'status', 'confirmed', 'payment_method', 'flutterwave',
      'recipient_business_id', p_business_id::TEXT, 'tx_ref', p_tx_ref)
  );

  v_credited := public.fn_credit_business_wallet_ugx(p_business_id, v_owner_id, p_amount);
  UPDATE public.ican_tithe_records tr SET credited_to = v_credited WHERE tr.id = v_tithe_id;

  RETURN QUERY SELECT TRUE, v_tithe_id, v_church, FALSE,
    ('Sent to ' || v_church || CASE WHEN v_credited = 'business_wallet' THEN '''s business wallet' ELSE ' (credited to the owner''s wallet)' END)::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_settle_church_tithe_flutterwave(UUID, UUID, DECIMAL, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_settle_church_tithe_flutterwave(UUID, UUID, DECIMAL, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

