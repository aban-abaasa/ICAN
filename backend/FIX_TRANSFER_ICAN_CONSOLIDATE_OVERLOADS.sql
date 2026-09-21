-- ============================================================================
-- Fix: two live, different-signature versions of transfer_ican() — a
-- PostgREST overload trap this codebase normally avoids on purpose.
-- ============================================================================
-- ICAN_TRANSACTION_CONTEXT_MIGRATION.sql created the 12-parameter
-- transfer_ican() (local currency, merchant/expense classification,
-- business-wallet transfers) that mybodaguy/digital-city-era/ican's
-- sendICAN() all actually call today, and it drops the OLDER 6-param
-- signature first — the correct, established pattern (see also
-- ADD_JOURNEY_FARE_EXPENSE_CLASSIFICATION.sql, ADD_RIDER_CONFIRMED_PAYMENT_
-- METHOD_AT_COMPLETION.sql).
--
-- FIX_SHARED_ICAN_TRANSFER_TYPE.sql, written afterwards from the
-- digital-city-era side to fix a "null value in column type violates
-- not-null constraint" error, recreated transfer_ican() with only 6
-- parameters and no DROP FUNCTION first — so instead of replacing the
-- 12-param version it just added a second overload alongside it. (Its fix
-- was also already redundant: the 12-param version already populates the
-- `type` column, just under a different diagnosis.) The one genuinely new
-- thing that 6-param version has is a one-time migration of legacy
-- user_accounts.ican_coin_balance into ican_user_wallets — worth keeping,
-- just not worth a second overload for.
--
-- Every current sendICAN() call (all three apps) passes all 12 named
-- parameters, so PostgREST should already be routing to the 12-param
-- overload correctly — but leaving two signatures of the same real-money
-- function alive, each with different logic, is exactly the drift this
-- migration removes: the 6-param overload is dropped, and the 12-param
-- version gains its legacy-balance migration step so nothing from either
-- file is lost.
-- ============================================================================

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
  v_legacy_balance DECIMAL := 0;
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

  SELECT ican_balance INTO v_from_balance
  FROM public.ican_user_wallets WHERE user_id = p_from_user FOR UPDATE;

  -- Older ICAN screens stored balances in user_accounts.ican_coin_balance —
  -- migrate that into the shared wallet the moment it's needed, so a legacy
  -- user's coins aren't invisible to transfer_ican just because nothing else
  -- happened to trigger the migration first (from FIX_SHARED_ICAN_TRANSFER_
  -- TYPE.sql's 6-param overload, folded in here instead of left as a
  -- separate signature).
  IF COALESCE(v_from_balance, 0) = 0 THEN
    BEGIN
      SELECT COALESCE(ican_coin_balance, 0) INTO v_legacy_balance
      FROM public.user_accounts WHERE user_id = p_from_user FOR UPDATE;
      IF v_legacy_balance > 0 THEN
        PERFORM public.get_or_create_ican_wallet(p_from_user);
        UPDATE public.ican_user_wallets
        SET ican_balance = v_legacy_balance, updated_at = now()
        WHERE user_id = p_from_user;
        UPDATE public.user_accounts SET ican_coin_balance = 0 WHERE user_id = p_from_user;
        v_from_balance := v_legacy_balance;
      END IF;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      v_legacy_balance := 0;
    END;
  END IF;

  IF v_from_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sender wallet not found');
  END IF;
  IF v_from_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('Insufficient ICAN balance. Have: %s, Need: %s', v_from_balance, p_amount));
  END IF;

  v_local_amount := COALESCE(p_local_amount, ROUND(p_amount * 5000, 2));
  v_counterparty_type := lower(trim(COALESCE(
    p_counterparty_type,
    CASE WHEN NULLIF(trim(p_merchant_name), '') IS NOT NULL THEN 'business' ELSE 'person' END
  )));
  IF v_counterparty_type NOT IN ('person', 'business', 'unknown') THEN
    v_counterparty_type := 'unknown';
  END IF;
  v_expense_classification := lower(trim(COALESCE(
    p_expense_classification,
    CASE WHEN v_counterparty_type = 'business' THEN 'business_expense' ELSE 'person_transfer' END
  )));
  IF v_expense_classification NOT IN (
    'person_transfer', 'personal_expense', 'business_expense',
    'income', 'refund', 'cash_out', 'other'
  ) THEN
    v_expense_classification := 'other';
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
    (sender_user_id, recipient_user_id, ican_amount, type, status, local_amount, local_currency,
     merchant_name, counterparty_type, expense_classification, classification_source, business_profile_id,
     transaction_type, source_app, reference_id, note, actor_role)
  VALUES
    (p_from_user, p_to_user, p_amount, 'transfer_out', 'completed', v_local_amount, upper(COALESCE(p_local_currency, 'UGX')),
     NULLIF(trim(p_merchant_name), ''), v_counterparty_type, v_expense_classification, 'rules', p_business_profile_id,
     'transfer_out', p_source_app, p_reference_id, p_note, v_actor_role)
  RETURNING id INTO v_out_tx_id;

  INSERT INTO public.ican_coin_transactions
    (sender_user_id, recipient_user_id, ican_amount, type, status, local_amount, local_currency,
     merchant_name, counterparty_type, expense_classification, classification_source, business_profile_id,
     transaction_type, source_app, reference_id, note, actor_role)
  VALUES
    (p_from_user, p_to_user, p_amount, 'transfer_in', 'completed', v_local_amount, upper(COALESCE(p_local_currency, 'UGX')),
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

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ transfer_ican() consolidated to a single 12-parameter overload — the stray 6-param version is dropped, and its legacy user_accounts.ican_coin_balance migration is folded into the version every app actually calls.';
END $$;
