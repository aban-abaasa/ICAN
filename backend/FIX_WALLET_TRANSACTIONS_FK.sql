-- ============================================================
-- FIX: process_transaction_with_pin() wallet_id FK mismatch
-- Run once in Supabase SQL editor (safe to re-run)
--
-- wallet_transactions.wallet_id has:
--   FOREIGN KEY (wallet_id) REFERENCES user_wallets(id) ON DELETE SET NULL
--
-- But this function sources v_wallet_id from public.wallet_accounts.id —
-- a completely different table with a different id space. Any send,
-- receive, withdraw, deposit, cash-in, cash-out, or top-up where the
-- user already had a wallet_accounts row would hit:
--   "insert or update on table wallet_transactions violates foreign key
--    constraint wallet_transactions_wallet_id_fkey"
-- because that wallet_accounts-sourced id essentially never exists in
-- user_wallets. (Where v_wallet_id happened to be NULL instead — send/
-- receive/withdraw/deposit's first-time-wallet case — it silently
-- worked, since NULL satisfies a nullable FK.)
--
-- v_wallet_id is never read again after being written into
-- wallet_transactions in any branch — every balance lookup goes through
-- wallet_accounts directly, keyed by (user_id, currency), not through
-- this id. So the fix is simply to stop passing a wrong-table id into a
-- nullable FK column: pass NULL instead. wallet_accounts creation logic
-- (the "IF v_wallet_id IS NULL THEN ... INSERT INTO wallet_accounts"
-- blocks in cashin/cashout/topup) is untouched — only the value written
-- into wallet_transactions.wallet_id changes.
--
-- This is a byte-for-byte copy of the live function (confirmed via
-- pg_get_functiondef) with only that one substitution applied.
-- ============================================================

CREATE OR REPLACE FUNCTION public.process_transaction_with_pin(
  p_transaction_type text,
  p_user_id uuid,
  p_agent_id uuid,
  p_pin_attempt text,
  p_currency text,
  p_amount numeric,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_pin_user_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(success boolean, message text, transaction_id uuid, user_balance numeric, agent_balance numeric, recipient_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pin_verify_user_id uuid;  -- The user whose PIN we're actually verifying
  v_user_pin_hash text;
  v_pin_attempts int;
  v_user_balance numeric := 0;
  v_agent_balance numeric := 0;
  v_recipient_balance numeric := 0;
  v_commission numeric := 0;
  v_net_amount numeric;
  v_transaction_id uuid;
  v_recipient_id uuid;
  v_wallet_id uuid;
BEGIN
  -- Determine which user's PIN to verify
  v_pin_verify_user_id := COALESCE(p_pin_user_id, p_user_id);

  -- ========== PIN VERIFICATION ==========
  SELECT pin_hash, failed_pin_attempts INTO v_user_pin_hash, v_pin_attempts
  FROM public.user_accounts
  WHERE user_id = v_pin_verify_user_id;

  IF v_user_pin_hash IS NULL THEN
    RETURN QUERY SELECT false, 'User account not found'::text, NULL::uuid, 0::numeric, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- Check account lock
  IF v_pin_attempts > 3 THEN
    RETURN QUERY SELECT false, '🔒 Account locked. Too many failed PIN attempts. Contact support.'::text, NULL::uuid, 0::numeric, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- Verify PIN using direct hash comparison
  -- The PIN is already hashed on the frontend before being sent, so we compare directly
  IF v_user_pin_hash IS NULL OR v_user_pin_hash != p_pin_attempt THEN
    UPDATE public.user_accounts
    SET failed_pin_attempts = COALESCE(failed_pin_attempts, 0) + 1
    WHERE user_id = v_pin_verify_user_id;

    v_pin_attempts := COALESCE(v_pin_attempts, 0) + 1;
    RETURN QUERY SELECT false, '❌ Invalid PIN. Attempts remaining: ' || (3 - v_pin_attempts)::text, NULL::uuid, 0::numeric, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- PIN correct - reset attempts
  UPDATE public.user_accounts
  SET failed_pin_attempts = 0
  WHERE user_id = v_pin_verify_user_id;

  -- ========== TRANSACTION ROUTING ==========
  CASE lower(p_transaction_type)
    -- ===== SEND MONEY (P2P) =====
    WHEN 'send' THEN
      v_recipient_id := (p_metadata->>'recipient_id')::uuid;

      IF v_recipient_id IS NULL THEN
        RETURN QUERY SELECT false, 'Recipient ID not provided'::text, NULL::uuid, 0::numeric, 0::numeric, 0::numeric;
        RETURN;
      END IF;

      -- Get sender's wallet ID
      SELECT id INTO v_wallet_id FROM public.wallet_accounts
      WHERE user_id = p_user_id AND currency = p_currency
      LIMIT 1;

      -- Deduct from sender
      UPDATE public.wallet_accounts
      SET balance = balance - p_amount, updated_at = now()
      WHERE user_id = p_user_id AND currency = p_currency AND balance >= p_amount;

      -- Add to recipient
      UPDATE public.wallet_accounts
      SET balance = balance + p_amount, updated_at = now()
      WHERE user_id = v_recipient_id AND currency = p_currency;

      IF NOT FOUND THEN
        INSERT INTO public.wallet_accounts (user_id, currency, balance, created_at, updated_at)
        VALUES (v_recipient_id, p_currency, p_amount, now(), now());
      END IF;

      -- Record transaction
      v_transaction_id := gen_random_uuid();
      INSERT INTO public.wallet_transactions (id, wallet_id, user_id, transaction_type, amount, currency, status, created_at, metadata)
      VALUES (v_transaction_id, NULL::uuid, p_user_id, 'send', p_amount, p_currency, 'completed', now(),
        jsonb_build_object('recipient_id', v_recipient_id::text, 'pin_verified', true));

      SELECT balance INTO v_user_balance FROM public.wallet_accounts WHERE user_id = p_user_id AND currency = p_currency;
      SELECT balance INTO v_recipient_balance FROM public.wallet_accounts WHERE user_id = v_recipient_id AND currency = p_currency;

      RETURN QUERY SELECT true, '✅ Money sent successfully'::text, v_transaction_id, v_user_balance, NULL::numeric, v_recipient_balance;

    -- ===== RECEIVE MONEY (P2P) =====
    WHEN 'receive' THEN
      v_recipient_id := (p_metadata->>'sender_id')::uuid;

      -- Get receiver's wallet ID
      SELECT id INTO v_wallet_id FROM public.wallet_accounts
      WHERE user_id = p_user_id AND currency = p_currency
      LIMIT 1;

      -- Deduct from sender
      UPDATE public.wallet_accounts
      SET balance = balance - p_amount, updated_at = now()
      WHERE user_id = v_recipient_id AND currency = p_currency AND balance >= p_amount;

      -- Add to receiver (p_user_id)
      UPDATE public.wallet_accounts
      SET balance = balance + p_amount, updated_at = now()
      WHERE user_id = p_user_id AND currency = p_currency;

      IF NOT FOUND THEN
        INSERT INTO public.wallet_accounts (user_id, currency, balance, created_at, updated_at)
        VALUES (p_user_id, p_currency, p_amount, now(), now());
      END IF;

      v_transaction_id := gen_random_uuid();
      INSERT INTO public.wallet_transactions (id, wallet_id, user_id, transaction_type, amount, currency, status, created_at, metadata)
      VALUES (v_transaction_id, NULL::uuid, p_user_id, 'receive', p_amount, p_currency, 'completed', now(),
        jsonb_build_object('sender_id', v_recipient_id::text, 'pin_verified', true));

      SELECT balance INTO v_user_balance FROM public.wallet_accounts WHERE user_id = p_user_id AND currency = p_currency;
      SELECT balance INTO v_recipient_balance FROM public.wallet_accounts WHERE user_id = v_recipient_id AND currency = p_currency;

      RETURN QUERY SELECT true, '✅ Money received successfully'::text, v_transaction_id, v_user_balance, NULL::numeric, v_recipient_balance;

    -- ===== WITHDRAW (via Agent) =====
    WHEN 'withdraw' THEN
      -- Get user's wallet ID
      SELECT id INTO v_wallet_id FROM public.wallet_accounts
      WHERE user_id = p_user_id AND currency = p_currency
      LIMIT 1;

      -- Deduct from user wallet
      UPDATE public.wallet_accounts
      SET balance = balance - p_amount, updated_at = now()
      WHERE user_id = p_user_id AND currency = p_currency AND balance >= p_amount;

      -- Add to agent float
      UPDATE public.agent_floats
      SET current_balance = current_balance + p_amount, updated_at = now()
      WHERE agent_id = p_agent_id AND currency = p_currency;

      IF NOT FOUND THEN
        INSERT INTO public.agent_floats (agent_id, currency, current_balance, created_at, updated_at)
        VALUES (p_agent_id, p_currency, p_amount, now(), now());
      END IF;

      SELECT balance INTO v_user_balance FROM public.wallet_accounts WHERE user_id = p_user_id AND currency = p_currency;
      SELECT current_balance INTO v_agent_balance FROM public.agent_floats WHERE agent_id = p_agent_id AND currency = p_currency;

      v_transaction_id := gen_random_uuid();
      INSERT INTO public.wallet_transactions (id, wallet_id, user_id, transaction_type, amount, currency, status, created_at, metadata)
      VALUES (v_transaction_id, NULL::uuid, p_user_id, 'withdrawal', p_amount, p_currency, 'completed', now(),
        jsonb_build_object('agent_id', p_agent_id::text, 'pin_verified', true));

      RETURN QUERY SELECT true, '✅ Withdrawal completed'::text, v_transaction_id, v_user_balance, v_agent_balance, NULL::numeric;

    -- ===== DEPOSIT (Agent → User) =====
    WHEN 'deposit' THEN
      -- Get user's wallet ID
      SELECT id INTO v_wallet_id FROM public.wallet_accounts
      WHERE user_id = p_user_id AND currency = p_currency
      LIMIT 1;

      -- Deduct from agent float
      UPDATE public.agent_floats
      SET current_balance = current_balance - p_amount, updated_at = now()
      WHERE agent_id = p_agent_id AND currency = p_currency AND current_balance >= p_amount;

      -- Add to user wallet
      UPDATE public.wallet_accounts
      SET balance = balance + p_amount, updated_at = now()
      WHERE user_id = p_user_id AND currency = p_currency;

      IF NOT FOUND THEN
        INSERT INTO public.wallet_accounts (user_id, currency, balance, created_at, updated_at)
        VALUES (p_user_id, p_currency, p_amount, now(), now());
      END IF;

      SELECT balance INTO v_user_balance FROM public.wallet_accounts WHERE user_id = p_user_id AND currency = p_currency;
      SELECT current_balance INTO v_agent_balance FROM public.agent_floats WHERE agent_id = p_agent_id AND currency = p_currency;

      v_transaction_id := gen_random_uuid();
      INSERT INTO public.wallet_transactions (id, wallet_id, user_id, transaction_type, amount, currency, status, created_at, metadata)
      VALUES (v_transaction_id, NULL::uuid, p_user_id, 'deposit', p_amount, p_currency, 'completed', now(),
        jsonb_build_object('agent_id', p_agent_id::text, 'pin_verified', true));

      RETURN QUERY SELECT true, '✅ Deposit completed'::text, v_transaction_id, v_user_balance, v_agent_balance, NULL::numeric;

    -- ===== CASH-IN (Agent receives cash from user) =====
    WHEN 'cashin' THEN
      -- Get or create wallet
      SELECT id INTO v_wallet_id FROM public.wallet_accounts
      WHERE user_id = p_user_id AND currency = p_currency
      LIMIT 1;

      IF v_wallet_id IS NULL THEN
        v_wallet_id := gen_random_uuid();
        INSERT INTO public.wallet_accounts (id, user_id, currency, balance, created_at, updated_at)
        VALUES (v_wallet_id, p_user_id, p_currency, 0, now(), now());
      END IF;

      -- ✅ DEBIT user wallet (user gives cash to agent)
      UPDATE public.wallet_accounts
      SET balance = balance - p_amount, updated_at = now()
      WHERE user_id = p_user_id AND currency = p_currency AND balance >= p_amount;

      -- Check if user wallet was debited (should have enough balance)
      IF NOT FOUND THEN
        RETURN QUERY SELECT false, '❌ Insufficient user balance. Cannot complete cash-in.'::text, NULL::uuid, 0::numeric, 0::numeric, 0::numeric;
        RETURN;
      END IF;

      -- ✅ CREDIT agent float (agent receives cash from user)
      UPDATE public.agent_floats
      SET current_balance = current_balance + p_amount, updated_at = now()
      WHERE agent_id = p_agent_id AND currency = p_currency;

      IF NOT FOUND THEN
        INSERT INTO public.agent_floats (agent_id, currency, current_balance, created_at, updated_at)
        VALUES (p_agent_id, p_currency, p_amount, now(), now());
      END IF;

      SELECT balance INTO v_user_balance FROM public.wallet_accounts WHERE user_id = p_user_id AND currency = p_currency;
      SELECT current_balance INTO v_agent_balance FROM public.agent_floats WHERE agent_id = p_agent_id AND currency = p_currency;

      v_transaction_id := gen_random_uuid();
      INSERT INTO public.wallet_transactions (id, wallet_id, user_id, transaction_type, amount, currency, status, created_at, metadata)
      VALUES (v_transaction_id, NULL::uuid, p_user_id, 'cash_in', p_amount, p_currency, 'completed', now(),
        jsonb_build_object('agent_id', p_agent_id::text, 'pin_verified', true));

      RETURN QUERY SELECT true, '✅ Cash-in completed! User paid ' || p_amount::text || ' ' || p_currency || ' to agent'::text, v_transaction_id, v_user_balance, v_agent_balance, NULL::numeric;

    -- ===== CASH-OUT (Agent gives cash to user, commission applied) =====
    WHEN 'cashout' THEN
      -- Get or create wallet for customer
      SELECT id INTO v_wallet_id FROM public.wallet_accounts
      WHERE user_id = p_user_id AND currency = p_currency
      LIMIT 1;

      IF v_wallet_id IS NULL THEN
        v_wallet_id := gen_random_uuid();
        INSERT INTO public.wallet_accounts (id, user_id, currency, balance, created_at, updated_at)
        VALUES (v_wallet_id, p_user_id, p_currency, 0, now(), now());
      END IF;

      v_commission := (p_amount * (COALESCE((p_metadata->>'commission_rate')::numeric, 2.5))) / 100;
      v_net_amount := p_amount - v_commission;

      -- ✅ CREDIT customer wallet (customer receives cash from agent)
      UPDATE public.wallet_accounts
      SET balance = balance + p_amount, updated_at = now()
      WHERE user_id = p_user_id AND currency = p_currency;

      -- Check if customer wallet was updated (should exist now)
      IF NOT FOUND THEN
        RETURN QUERY SELECT false, '❌ Customer wallet not found. Cannot complete cash-out.'::text, NULL::uuid, 0::numeric, 0::numeric, 0::numeric;
        RETURN;
      END IF;

      -- ✅ DEBIT agent float (agent gives out cash + commission fee)
      UPDATE public.agent_floats
      SET current_balance = current_balance - (p_amount + v_commission), updated_at = now()
      WHERE agent_id = p_agent_id AND currency = p_currency AND current_balance >= (p_amount + v_commission);

      IF NOT FOUND THEN
        -- Agent doesn't have enough float - ROLLBACK customer credit by reversing it
        UPDATE public.wallet_accounts
        SET balance = balance - p_amount, updated_at = now()
        WHERE user_id = p_user_id AND currency = p_currency;

        RETURN QUERY SELECT false, '❌ Insufficient agent float. Cannot complete cash-out.'::text, NULL::uuid, 0::numeric, 0::numeric, 0::numeric;
        RETURN;
      END IF;

      SELECT balance INTO v_user_balance FROM public.wallet_accounts WHERE user_id = p_user_id AND currency = p_currency;
      SELECT current_balance INTO v_agent_balance FROM public.agent_floats WHERE agent_id = p_agent_id AND currency = p_currency;

      v_transaction_id := gen_random_uuid();
      INSERT INTO public.wallet_transactions (id, wallet_id, user_id, transaction_type, amount, currency, status, created_at, metadata)
      VALUES (v_transaction_id, NULL::uuid, p_user_id, 'cash_out', p_amount, p_currency, 'completed', now(),
        jsonb_build_object('agent_id', p_agent_id::text, 'commission', v_commission, 'net_amount', v_net_amount, 'pin_verified', true));

      RETURN QUERY SELECT true, '✅ Cash-out completed! Customer received ' || p_amount::text || ' ' || p_currency || '. Agent commission: ' || v_commission::text, v_transaction_id, v_user_balance, v_agent_balance, NULL::numeric;

    -- ===== TOP-UP (User adds credit) =====
    WHEN 'topup' THEN
      -- Get or create wallet
      SELECT id INTO v_wallet_id FROM public.wallet_accounts
      WHERE user_id = p_user_id AND currency = p_currency
      LIMIT 1;

      IF v_wallet_id IS NULL THEN
        v_wallet_id := gen_random_uuid();
        INSERT INTO public.wallet_accounts (id, user_id, currency, balance, created_at, updated_at)
        VALUES (v_wallet_id, p_user_id, p_currency, 0, now(), now());
      END IF;

      -- Add to wallet
      UPDATE public.wallet_accounts
      SET balance = balance + p_amount, updated_at = now()
      WHERE user_id = p_user_id AND currency = p_currency;

      SELECT balance INTO v_user_balance FROM public.wallet_accounts WHERE user_id = p_user_id AND currency = p_currency;

      v_transaction_id := gen_random_uuid();
      INSERT INTO public.wallet_transactions (id, wallet_id, user_id, transaction_type, amount, currency, status, created_at, metadata)
      VALUES (v_transaction_id, NULL::uuid, p_user_id, 'topup', p_amount, p_currency, 'completed', now(),
        jsonb_build_object('pin_verified', true));

      RETURN QUERY SELECT true, '✅ Top-up completed successfully'::text, v_transaction_id, v_user_balance, NULL::numeric, NULL::numeric;

    ELSE
      RETURN QUERY SELECT false, 'Unknown transaction type: ' || p_transaction_type, NULL::uuid, 0::numeric, 0::numeric, 0::numeric;
  END CASE;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, '❌ Error processing transaction: ' || SQLERRM, NULL::uuid, 0::numeric, 0::numeric, 0::numeric;
END;
$function$;

SELECT 'process_transaction_with_pin fixed — wallet_transactions.wallet_id no longer references the wrong table (user_wallets vs wallet_accounts).' AS status;
