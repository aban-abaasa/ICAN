-- ============================================================
-- TITHE_CASH_WALLET_AND_NO_DOUBLE_TITHE.sql
-- ============================================================
-- Purpose:
--   1. Let a tithe payment be recorded as CASH (given by hand, no wallet
--      impact) or WALLET (deducted from the in-app wallet balance).
--   2. Tag every tithe with WHO it's for: 'personal' (tied to one specific
--      income transaction) or 'business' (the owner's own aggregate, paid
--      on the owner's own schedule).
--   3. Give the database itself a way to say "this income was already
--      tithed" so no UI code path can double-charge a personal income.
--
-- Safe to re-run. Additive only — no existing column is dropped or
-- renamed, so anything already reading ican_tithe_records keeps working.
-- ============================================================

-- ------------------------------------------------------------
-- 1. New columns on ican_tithe_records
-- ------------------------------------------------------------
ALTER TABLE public.ican_tithe_records
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'wallet'
    CHECK (payment_method IN ('wallet', 'cash')),
  ADD COLUMN IF NOT EXISTS tithe_type TEXT NOT NULL DEFAULT 'personal'
    CHECK (tithe_type IN ('personal', 'business')),
  ADD COLUMN IF NOT EXISTS source_transaction_id UUID;
    -- The specific income record (ican_transactions.id) this PERSONAL tithe
    -- is paying against. NULL for business tithes, which are not tied to
    -- one transaction — the owner pays whenever they choose.

COMMENT ON COLUMN public.ican_tithe_records.payment_method IS
  'How the giver actually settled it: wallet (deducted from in-app balance) or cash (given by hand, wallet untouched).';
COMMENT ON COLUMN public.ican_tithe_records.source_transaction_id IS
  'For personal tithes only: the income transaction this tithe covers. Enforced unique (non-removed) so one income can never be tithed twice.';

-- One income transaction can have at most one active (non-removed) tithe
-- record against it. This is the actual guard against double-tithing a
-- personal income — enforced by Postgres, not by client-side judgement.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tithe_one_per_income
  ON public.ican_tithe_records (user_id, source_transaction_id)
  WHERE source_transaction_id IS NOT NULL AND blockchain_status <> 'removed';

-- ------------------------------------------------------------
-- 2. fn_add_tithe — now payment-method aware + double-tithe guarded
-- ------------------------------------------------------------
-- Adding new parameters changes the function's signature, so Postgres would
-- otherwise keep the old 10-argument version around as a separate overload.
-- Drop it explicitly so there is exactly one fn_add_tithe.
DROP FUNCTION IF EXISTS public.fn_add_tithe(
  VARCHAR, DECIMAL, TEXT, VARCHAR, TEXT, DECIMAL, DECIMAL, DATE, TEXT, BOOLEAN
);

CREATE OR REPLACE FUNCTION public.fn_add_tithe(
  p_giving_type VARCHAR,
  p_amount DECIMAL,
  p_currency TEXT DEFAULT 'UGX',
  p_recipient_type VARCHAR DEFAULT 'church',
  p_recipient_name_encrypted TEXT DEFAULT NULL,
  p_tithe_percentage DECIMAL DEFAULT 10.0,
  p_income_reference_amount DECIMAL DEFAULT NULL,
  p_giving_date DATE DEFAULT CURRENT_DATE,
  p_notes_encrypted TEXT DEFAULT NULL,
  p_is_anonymous BOOLEAN DEFAULT FALSE,
  p_payment_method TEXT DEFAULT 'wallet',
  p_tithe_type TEXT DEFAULT 'personal',
  p_source_transaction_id UUID DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  tithe_record_id UUID,
  transaction_id UUID,
  audit_log_id UUID,
  action_hash VARCHAR,
  new_wallet_balance DECIMAL,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_current_balance DECIMAL;
  v_new_balance DECIMAL;
  v_tithe_record_id UUID;
  v_transaction_id UUID;
  v_audit_log_id UUID;
  v_action_hash VARCHAR;
  v_previous_hash VARCHAR;
  v_already_tithed_date DATE;
BEGIN
  -- STEP 1: Get authenticated user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::UUID, NULL::VARCHAR, NULL::DECIMAL, 'Not authenticated'::TEXT;
    RETURN;
  END IF;

  -- STEP 2: Validate tithe amount
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::UUID, NULL::VARCHAR, NULL::DECIMAL, 'Tithe amount must be greater than 0'::TEXT;
    RETURN;
  END IF;

  IF p_payment_method NOT IN ('wallet', 'cash') THEN
    p_payment_method := 'wallet';
  END IF;

  IF p_tithe_type NOT IN ('personal', 'business') THEN
    p_tithe_type := 'personal';
  END IF;

  -- STEP 2b: Smart guard — never let one income get tithed twice.
  -- Applies only to personal tithes tied to a specific income transaction.
  IF p_tithe_type = 'personal' AND p_source_transaction_id IS NOT NULL THEN
    SELECT tr.giving_date INTO v_already_tithed_date
    FROM public.ican_tithe_records tr
    WHERE tr.user_id = v_user_id
      AND tr.source_transaction_id = p_source_transaction_id
      AND tr.blockchain_status <> 'removed'
    LIMIT 1;

    IF v_already_tithed_date IS NOT NULL THEN
      RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::UUID, NULL::VARCHAR, NULL::DECIMAL,
        ('This income was already tithed on ' || v_already_tithed_date::TEXT || '. Pick a different income, or remove that tithe first if it was a mistake.')::TEXT;
      RETURN;
    END IF;
  END IF;

  -- STEP 3-4: Wallet balance — only relevant when actually paying from the wallet.
  -- Cash is given by hand: nothing to check, nothing to deduct.
  IF p_payment_method = 'wallet' THEN
    SELECT balance INTO v_current_balance
    FROM public.wallet_accounts
    WHERE user_id = v_user_id AND currency = p_currency
    LIMIT 1;

    IF v_current_balance IS NULL THEN
      v_current_balance := 0;
      INSERT INTO public.wallet_accounts (user_id, currency, balance, created_at, updated_at)
      VALUES (v_user_id, p_currency, 0, NOW(), NOW());
    END IF;

    IF v_current_balance < p_amount THEN
      RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::UUID, NULL::VARCHAR, v_current_balance,
        'Insufficient wallet balance. You have ' || v_current_balance::TEXT || ' ' || p_currency || ' but need ' || p_amount::TEXT || '. Choose Cash if you are giving this by hand.';
      RETURN;
    END IF;

    v_new_balance := v_current_balance - p_amount;
  ELSE
    v_current_balance := COALESCE((SELECT balance FROM public.wallet_accounts WHERE user_id = v_user_id AND currency = p_currency LIMIT 1), 0);
    v_new_balance := v_current_balance; -- wallet untouched for cash
  END IF;

  -- STEP 5: Create tithe record
  INSERT INTO public.ican_tithe_records (
    user_id, giving_type, amount, currency, recipient_type, recipient_name_encrypted,
    tithe_percentage, income_reference_amount, giving_date, notes_encrypted, is_anonymous,
    blockchain_status, payment_method, tithe_type, source_transaction_id
  ) VALUES (
    v_user_id, p_giving_type, p_amount, p_currency, p_recipient_type, p_recipient_name_encrypted,
    p_tithe_percentage, p_income_reference_amount, p_giving_date, p_notes_encrypted, p_is_anonymous,
    'local', p_payment_method, p_tithe_type, p_source_transaction_id
  ) RETURNING id INTO v_tithe_record_id;

  -- STEP 6: Deduct from wallet only if paid from wallet
  IF p_payment_method = 'wallet' THEN
    UPDATE public.wallet_accounts
    SET balance = v_new_balance, updated_at = NOW()
    WHERE user_id = v_user_id AND currency = p_currency;
  END IF;

  -- STEP 7: Record transaction in ican_financial_transactions (for reports)
  INSERT INTO public.ican_financial_transactions (
    user_id, transaction_type, amount, currency, category, sub_category, description,
    source, transaction_date, status, data_hash, metadata
  ) VALUES (
    v_user_id, 'tithe', p_amount, p_currency, 'giving', p_giving_type,
    'Tithe/Charitable Giving - ' || COALESCE(p_recipient_type, 'church'),
    'manual', p_giving_date, 'completed',
    md5(p_amount::TEXT || v_user_id::TEXT || NOW()::TEXT),
    jsonb_build_object(
      'tithe_record_id', v_tithe_record_id::TEXT,
      'recipient_type', p_recipient_type,
      'tithe_percentage', p_tithe_percentage,
      'income_reference_amount', p_income_reference_amount,
      'giving_type', p_giving_type,
      'is_anonymous', p_is_anonymous,
      'payment_method', p_payment_method,
      'tithe_type', p_tithe_type,
      'source_transaction_id', p_source_transaction_id::TEXT
    )
  ) RETURNING id INTO v_transaction_id;

  -- STEP 8: Link transaction to tithe record
  UPDATE public.ican_tithe_records SET transaction_id = v_transaction_id WHERE id = v_tithe_record_id;

  -- STEP 9-10: Blockchain-style hash chain
  SELECT action_hash INTO v_previous_hash FROM public.tithe_audit_log WHERE user_id = v_user_id ORDER BY created_at DESC LIMIT 1;
  v_action_hash := md5('tithe_added' || v_user_id::TEXT || v_tithe_record_id::TEXT || p_amount::TEXT || COALESCE(v_previous_hash, '') || NOW()::TEXT);

  -- STEP 11: Audit trail
  INSERT INTO public.tithe_audit_log (
    user_id, tithe_record_id, transaction_id, action_type, amount, currency,
    wallet_deducted, previous_balance, new_balance, action_hash, previous_hash, action_details
  ) VALUES (
    v_user_id, v_tithe_record_id, v_transaction_id, 'tithe_added', p_amount, p_currency,
    (p_payment_method = 'wallet'), v_current_balance, v_new_balance, v_action_hash, v_previous_hash,
    jsonb_build_object(
      'giving_type', p_giving_type, 'recipient_type', p_recipient_type,
      'action', 'tithe_payment_recorded', 'status', 'confirmed',
      'payment_method', p_payment_method, 'tithe_type', p_tithe_type
    )
  ) RETURNING id INTO v_audit_log_id;

  RETURN QUERY SELECT
    TRUE, v_tithe_record_id, v_transaction_id, v_audit_log_id, v_action_hash, v_new_balance,
    CASE WHEN p_payment_method = 'wallet'
      THEN 'Tithe recorded successfully. Deducted ' || p_amount::TEXT || ' ' || p_currency || ' from wallet.'
      ELSE 'Tithe recorded successfully as cash given. Wallet balance unchanged.'
    END::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_add_tithe(
  VARCHAR, DECIMAL, TEXT, VARCHAR, TEXT, DECIMAL, DECIMAL, DATE, TEXT, BOOLEAN, TEXT, TEXT, UUID
) TO authenticated;

-- ------------------------------------------------------------
-- 3. fn_remove_tithe — only restore the wallet if it was actually deducted
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_remove_tithe(
  p_tithe_record_id UUID,
  p_reason TEXT DEFAULT 'manual_reversal'
)
RETURNS TABLE (
  success BOOLEAN,
  transaction_id UUID,
  audit_log_id UUID,
  action_hash VARCHAR,
  restored_balance DECIMAL,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_tithe_amount DECIMAL;
  v_tithe_currency TEXT;
  v_payment_method TEXT;
  v_current_balance DECIMAL;
  v_restored_balance DECIMAL;
  v_transaction_id UUID;
  v_audit_log_id UUID;
  v_action_hash VARCHAR;
  v_previous_hash VARCHAR;
  v_reverse_transaction_id UUID;
  v_owner_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::VARCHAR, NULL::DECIMAL, 'Not authenticated'::TEXT;
    RETURN;
  END IF;

  SELECT tr.amount, tr.currency, tr.transaction_id, tr.user_id, tr.payment_method
  INTO v_tithe_amount, v_tithe_currency, v_transaction_id, v_owner_id, v_payment_method
  FROM public.ican_tithe_records tr
  WHERE tr.id = p_tithe_record_id
  LIMIT 1;

  IF v_tithe_amount IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::VARCHAR, NULL::DECIMAL, 'Tithe record not found'::TEXT;
    RETURN;
  END IF;

  IF v_owner_id != v_user_id THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::VARCHAR, NULL::DECIMAL, 'Unauthorized. Can only remove your own tithes.'::TEXT;
    RETURN;
  END IF;

  SELECT balance INTO v_current_balance FROM public.wallet_accounts WHERE user_id = v_user_id AND currency = v_tithe_currency LIMIT 1;
  v_current_balance := COALESCE(v_current_balance, 0);

  IF v_payment_method = 'wallet' THEN
    v_restored_balance := v_current_balance + v_tithe_amount;
    UPDATE public.wallet_accounts SET balance = v_restored_balance, updated_at = NOW()
    WHERE user_id = v_user_id AND currency = v_tithe_currency;
  ELSE
    -- Cash tithe: nothing was deducted, so there's nothing to restore.
    v_restored_balance := v_current_balance;
  END IF;

  INSERT INTO public.ican_financial_transactions (
    user_id, transaction_type, amount, currency, category, sub_category, description,
    source, transaction_date, status, data_hash, metadata
  ) VALUES (
    v_user_id, 'tithe_reversal', v_tithe_amount, v_tithe_currency, 'giving', 'tithe_removed',
    'Tithe Reversal/Removal - ' || p_reason, 'manual', CURRENT_DATE, 'completed',
    md5(v_tithe_amount::TEXT || v_user_id::TEXT || NOW()::TEXT || 'reverse'),
    jsonb_build_object('original_tithe_id', p_tithe_record_id::TEXT, 'reversal_reason', p_reason, 'original_transaction_id', v_transaction_id::TEXT)
  ) RETURNING id INTO v_reverse_transaction_id;

  -- Freeing source_transaction_id lets that income be tithed again if this removal was a correction.
  UPDATE public.ican_tithe_records
  SET blockchain_status = 'removed',
      source_transaction_id = NULL,
      notes_encrypted = COALESCE(notes_encrypted, '') || ' [REMOVED: ' || p_reason || ']'
  WHERE id = p_tithe_record_id;

  SELECT action_hash INTO v_previous_hash FROM public.tithe_audit_log WHERE user_id = v_user_id ORDER BY created_at DESC LIMIT 1;
  v_action_hash := md5('tithe_removed' || v_user_id::TEXT || p_tithe_record_id::TEXT || v_tithe_amount::TEXT || COALESCE(v_previous_hash, '') || NOW()::TEXT);

  INSERT INTO public.tithe_audit_log (
    user_id, tithe_record_id, transaction_id, action_type, amount, currency,
    wallet_deducted, previous_balance, new_balance, action_hash, previous_hash, action_details
  ) VALUES (
    v_user_id, p_tithe_record_id, v_reverse_transaction_id, 'tithe_removed', v_tithe_amount, v_tithe_currency,
    FALSE, v_current_balance, v_restored_balance, v_action_hash, v_previous_hash,
    jsonb_build_object('reason', p_reason, 'action', 'tithe_reversal', 'status', 'confirmed', 'payment_method', v_payment_method)
  ) RETURNING id INTO v_audit_log_id;

  RETURN QUERY SELECT
    TRUE, v_reverse_transaction_id, v_audit_log_id, v_action_hash, v_restored_balance,
    CASE WHEN v_payment_method = 'wallet'
      THEN 'Tithe removed successfully. Restored ' || v_tithe_amount::TEXT || ' ' || v_tithe_currency || ' to wallet.'
      ELSE 'Tithe removed successfully. It was paid as cash, so your wallet balance is unchanged.'
    END::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_remove_tithe TO authenticated;

-- ------------------------------------------------------------
-- 4. fn_get_user_tithes — surface the new fields so the UI can tell
--    at a glance what's paid, how, and against which income
-- ------------------------------------------------------------
-- Adding columns to RETURNS TABLE changes the return type, which
-- CREATE OR REPLACE refuses to do in place — drop first.
DROP FUNCTION IF EXISTS public.fn_get_user_tithes(DATE, DATE, VARCHAR, INT);

CREATE OR REPLACE FUNCTION public.fn_get_user_tithes(
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_giving_type VARCHAR DEFAULT NULL,
  p_limit INT DEFAULT 100
)
RETURNS TABLE (
  tithe_id UUID,
  amount DECIMAL,
  currency TEXT,
  giving_type VARCHAR,
  recipient_type VARCHAR,
  giving_date DATE,
  tithe_percentage DECIMAL,
  income_reference_amount DECIMAL,
  transaction_id UUID,
  blockchain_status VARCHAR,
  created_at TIMESTAMPTZ,
  is_anonymous BOOLEAN,
  payment_method TEXT,
  tithe_type TEXT,
  source_transaction_id UUID,
  notes_encrypted TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    tr.id, tr.amount, tr.currency, tr.giving_type, tr.recipient_type, tr.giving_date,
    tr.tithe_percentage, tr.income_reference_amount, tr.transaction_id, tr.blockchain_status,
    tr.created_at, tr.is_anonymous, tr.payment_method, tr.tithe_type, tr.source_transaction_id,
    tr.notes_encrypted
  FROM public.ican_tithe_records tr
  WHERE tr.user_id = auth.uid()
    AND (p_start_date IS NULL OR tr.giving_date >= p_start_date)
    AND (p_end_date IS NULL OR tr.giving_date <= p_end_date)
    AND (p_giving_type IS NULL OR tr.giving_type = p_giving_type)
    AND tr.blockchain_status != 'removed'
  ORDER BY tr.giving_date DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_user_tithes TO authenticated;

-- ============================================================
-- VERIFY
-- ============================================================
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'ican_tithe_records' AND column_name IN ('payment_method','tithe_type','source_transaction_id');
-- SELECT * FROM public.fn_get_user_tithes(NULL, NULL, NULL, 5);
-- ============================================================
-- END
-- ============================================================
