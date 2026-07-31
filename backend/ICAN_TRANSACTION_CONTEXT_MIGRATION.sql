-- ICAN_TRANSACTION_CONTEXT_MIGRATION.sql
-- Run after ICAN_CROSS_APP_WALLET_MIGRATION.sql / ICAN_FEE_STRUCTURE_UPDATE.sql.
-- Keeps the shared wallet ledger useful outside the ICAN coin unit: every
-- transfer now records its local-currency value and an auditable context.

ALTER TABLE public.ican_coin_transactions
  ADD COLUMN IF NOT EXISTS local_amount DECIMAL(18, 2),
  ADD COLUMN IF NOT EXISTS local_currency VARCHAR(3) DEFAULT 'UGX',
  ADD COLUMN IF NOT EXISTS merchant_name TEXT,
  ADD COLUMN IF NOT EXISTS counterparty_type TEXT DEFAULT 'person',
  ADD COLUMN IF NOT EXISTS expense_classification TEXT DEFAULT 'person_transfer',
  ADD COLUMN IF NOT EXISTS classification_source TEXT DEFAULT 'rules';
ALTER TABLE public.ican_coin_transactions
  ADD COLUMN IF NOT EXISTS business_profile_id UUID;

ALTER TABLE public.ican_coin_transactions
  DROP CONSTRAINT IF EXISTS ican_coin_transactions_counterparty_type_check,
  DROP CONSTRAINT IF EXISTS ican_coin_transactions_expense_classification_check;

ALTER TABLE public.ican_coin_transactions
  ADD CONSTRAINT ican_coin_transactions_counterparty_type_check
    CHECK (counterparty_type IN ('person', 'business', 'unknown')),
  ADD CONSTRAINT ican_coin_transactions_expense_classification_check
    CHECK (expense_classification IN (
      'person_transfer', 'personal_expense', 'business_expense',
      'income', 'refund', 'cash_out', 'other'
    ));

CREATE INDEX IF NOT EXISTS idx_ican_tx_merchant
  ON public.ican_coin_transactions(merchant_name);
CREATE INDEX IF NOT EXISTS idx_ican_tx_expense_classification
  ON public.ican_coin_transactions(expense_classification);

-- Replace the currently deployed 7-argument function. Defaults preserve old
-- callers from the other applications while allowing newer callers to supply
-- a precise local amount and merchant context.
DROP FUNCTION IF EXISTS public.transfer_ican(UUID, UUID, DECIMAL, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.transfer_ican(
  p_from_user              UUID,
  p_to_user                UUID,
  p_amount                 DECIMAL,
  p_note                   TEXT DEFAULT '',
  p_source_app             TEXT DEFAULT 'ican',
  p_reference_id           TEXT DEFAULT NULL,
  p_local_amount           DECIMAL DEFAULT NULL,
  p_local_currency         TEXT DEFAULT 'UGX',
  p_merchant_name          TEXT DEFAULT NULL,
  p_counterparty_type      TEXT DEFAULT NULL,
  p_expense_classification TEXT DEFAULT NULL,
  p_business_profile_id    UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_from_balance DECIMAL;
  v_local_amount DECIMAL;
  v_counterparty_type TEXT;
  v_expense_classification TEXT;
  v_actor_role TEXT;
  v_out_tx_id UUID;
  v_in_tx_id UUID;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;
  IF p_source_app NOT IN ('ican','digital-city-era','farm-agent','mybodaguy') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid source_app');
  END IF;
  IF p_local_amount IS NOT NULL AND p_local_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Local amount cannot be negative');
  END IF;

  v_local_amount := COALESCE(p_local_amount, ROUND(p_amount * 5000, 2));
  v_counterparty_type := lower(trim(COALESCE(
    p_counterparty_type,
    CASE WHEN NULLIF(trim(p_merchant_name), '') IS NOT NULL THEN 'business'
         ELSE 'person' END
  )));
  IF v_counterparty_type NOT IN ('person', 'business', 'unknown') THEN
    v_counterparty_type := 'unknown';
  END IF;
  v_expense_classification := lower(trim(COALESCE(
    p_expense_classification,
    CASE WHEN v_counterparty_type = 'business' THEN 'business_expense'
         ELSE 'person_transfer' END
  )));
  IF v_expense_classification NOT IN (
    'person_transfer', 'personal_expense', 'business_expense',
    'income', 'refund', 'cash_out', 'other'
  ) THEN
    v_expense_classification := 'other';
  END IF;

  SELECT ican_balance INTO v_from_balance
  FROM public.ican_user_wallets WHERE user_id = p_from_user FOR UPDATE;
  IF v_from_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sender wallet not found');
  END IF;
  IF v_from_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('Insufficient ICAN balance. Have: %s, Need: %s', v_from_balance, p_amount));
  END IF;

  v_actor_role := public.ican_resolve_caller_role();
  UPDATE public.ican_user_wallets
  SET ican_balance = ican_balance - p_amount,
      total_spent = total_spent + p_amount
  WHERE user_id = p_from_user;

  PERFORM public.get_or_create_ican_wallet(p_to_user);
  UPDATE public.ican_user_wallets
  SET ican_balance = ican_balance + p_amount,
      total_earned = total_earned + p_amount
  WHERE user_id = p_to_user;

  INSERT INTO public.ican_coin_transactions
    (sender_user_id, recipient_user_id, ican_amount, type, local_amount, local_currency,
     merchant_name, counterparty_type, expense_classification, classification_source, business_profile_id,
     transaction_type, source_app, reference_id, note, actor_role)
  VALUES
    (p_from_user, p_to_user, p_amount, 'transfer_out', v_local_amount, upper(COALESCE(p_local_currency, 'UGX')),
     NULLIF(trim(p_merchant_name), ''), v_counterparty_type, v_expense_classification, 'rules', p_business_profile_id,
     'transfer_out', p_source_app, p_reference_id, p_note, v_actor_role)
  RETURNING id INTO v_out_tx_id;

  INSERT INTO public.ican_coin_transactions
    (sender_user_id, recipient_user_id, ican_amount, type, local_amount, local_currency,
     merchant_name, counterparty_type, expense_classification, classification_source, business_profile_id,
     transaction_type, source_app, reference_id, note, actor_role)
  VALUES
    (p_from_user, p_to_user, p_amount, 'transfer_in', v_local_amount, upper(COALESCE(p_local_currency, 'UGX')),
     NULLIF(trim(p_merchant_name), ''), v_counterparty_type, v_expense_classification, 'rules', p_business_profile_id,
     'transfer_in', p_source_app, p_reference_id, p_note, v_actor_role)
  RETURNING id INTO v_in_tx_id;

  RETURN jsonb_build_object(
    'success', true, 'out_tx_id', v_out_tx_id, 'in_tx_id', v_in_tx_id,
    'amount_sent', p_amount, 'local_amount', v_local_amount,
    'local_currency', upper(COALESCE(p_local_currency, 'UGX')),
    'merchant_name', NULLIF(trim(p_merchant_name), ''),
    'counterparty_type', v_counterparty_type,
    'expense_classification', v_expense_classification,
    'business_profile_id', p_business_profile_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_ican(UUID, UUID, DECIMAL, TEXT, TEXT, TEXT, DECIMAL, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_ican(UUID, UUID, DECIMAL, TEXT, TEXT, TEXT, DECIMAL, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;
