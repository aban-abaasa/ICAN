/**
 * 🔐 UNIVERSAL TRANSACTION PIN APPROVAL SYSTEM
 * 
 * Single function that handles PIN verification for ANY transaction type:
 * - Send Money
 * - Receive Money
 * - Withdraw (via Agent)
 * - Deposit (via Agent)
 * - Cash-In (via Agent)
 * - Cash-Out (via Agent)
 * - Top-Up
 * - Any custom transaction type
 */

-- ============================================
-- ENABLE PGCRYPTO EXTENSION (for crypt function)
-- ============================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================
-- 1️⃣ UNIVERSAL TRANSACTION APPROVAL WITH PIN
-- ============================================
DROP FUNCTION IF EXISTS public.process_transaction_with_pin(text, uuid, uuid, text, text, numeric, jsonb);

CREATE OR REPLACE FUNCTION public.process_transaction_with_pin(
  p_transaction_type text,    -- 'send', 'receive', 'withdraw', 'deposit', 'cashIn', 'cashOut', 'topup'
  p_user_id uuid,             -- User being affected by transaction
  p_agent_id uuid,            -- NULL for peer-to-peer or topup
  p_pin_attempt text,
  p_currency text,
  p_amount numeric,
  p_metadata jsonb DEFAULT '{}'::jsonb,  -- recipient, description, commission_rate, etc.
  p_pin_user_id uuid DEFAULT NULL  -- OPTIONAL: User whose PIN should be verified (if different from p_user_id)
)
RETURNS TABLE (
  success boolean,
  message text,
  transaction_id uuid,
  user_balance numeric,
  agent_balance numeric,
  recipient_balance numeric
) AS $$
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
      VALUES (v_transaction_id, v_wallet_id, p_user_id, 'send', p_amount, p_currency, 'completed', now(), 
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
      VALUES (v_transaction_id, v_wallet_id, p_user_id, 'receive', p_amount, p_currency, 'completed', now(), 
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
      VALUES (v_transaction_id, v_wallet_id, p_user_id, 'withdrawal', p_amount, p_currency, 'completed', now(), 
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
      VALUES (v_transaction_id, v_wallet_id, p_user_id, 'deposit', p_amount, p_currency, 'completed', now(), 
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
      VALUES (v_transaction_id, v_wallet_id, p_user_id, 'cash_in', p_amount, p_currency, 'completed', now(), 
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
      VALUES (v_transaction_id, v_wallet_id, p_user_id, 'cash_out', p_amount, p_currency, 'completed', now(), 
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
      VALUES (v_transaction_id, v_wallet_id, p_user_id, 'topup', p_amount, p_currency, 'completed', now(), 
        jsonb_build_object('pin_verified', true));

      RETURN QUERY SELECT true, '✅ Top-up completed successfully'::text, v_transaction_id, v_user_balance, NULL::numeric, NULL::numeric;

    ELSE
      RETURN QUERY SELECT false, 'Unknown transaction type: ' || p_transaction_type, NULL::uuid, 0::numeric, 0::numeric, 0::numeric;
  END CASE;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, '❌ Error processing transaction: ' || SQLERRM, NULL::uuid, 0::numeric, 0::numeric, 0::numeric;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.process_transaction_with_pin(text, uuid, uuid, text, text, numeric, jsonb, uuid) TO authenticated;

-- ============================================
-- 2️⃣ REQUEST TRANSACTION APPROVAL (For any type)
-- ============================================
DROP FUNCTION IF EXISTS public.request_transaction_approval(text, uuid, uuid, text, numeric, jsonb);

CREATE OR REPLACE FUNCTION public.request_transaction_approval(
  p_transaction_type text,
  p_user_id uuid,
  p_agent_id uuid,
  p_currency text,
  p_amount numeric,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (request_id uuid, status text, created_at timestamp) AS $$
DECLARE
  v_request_id uuid;
BEGIN
  v_request_id := gen_random_uuid();
  
  INSERT INTO public.transaction_approval_requests (
    id, transaction_type, user_id, agent_id, currency, amount, metadata, status, created_at
  )
  VALUES (
    v_request_id,
    lower(p_transaction_type),
    p_user_id,
    p_agent_id,
    p_currency,
    p_amount,
    p_metadata,
    'pending',
    now()
  );

  RETURN QUERY SELECT v_request_id, 'pending'::text, now();

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT NULL::uuid, 'error: ' || SQLERRM, now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.request_transaction_approval(text, uuid, uuid, text, numeric, jsonb) TO authenticated;

-- ============================================
-- 3️⃣ APPROVE TRANSACTION FROM REQUEST
-- ============================================
DROP FUNCTION IF EXISTS public.approve_transaction_request(uuid, text);

CREATE OR REPLACE FUNCTION public.approve_transaction_request(
  p_request_id uuid,
  p_pin_attempt text
)
RETURNS TABLE (success boolean, message text, transaction_id uuid) AS $$
DECLARE
  v_transaction_type text;
  v_user_id uuid;
  v_agent_id uuid;
  v_currency text;
  v_amount numeric;
  v_metadata jsonb;
  v_result_record record;
BEGIN
  -- Get request details
  SELECT transaction_type, user_id, agent_id, currency, amount, metadata
  INTO v_transaction_type, v_user_id, v_agent_id, v_currency, v_amount, v_metadata
  FROM public.transaction_approval_requests
  WHERE id = p_request_id AND status = 'pending';

  IF v_transaction_type IS NULL THEN
    RETURN QUERY SELECT false, 'Request not found or already processed', NULL::uuid;
    RETURN;
  END IF;

  -- Process with PIN
  FOR v_result_record IN
    SELECT * FROM public.process_transaction_with_pin(
      v_transaction_type, v_user_id, v_agent_id, p_pin_attempt, v_currency, v_amount, v_metadata
    )
  LOOP
    IF v_result_record.success THEN
      -- Update request status
      UPDATE public.transaction_approval_requests
      SET status = 'approved', updated_at = now()
      WHERE id = p_request_id;

      RETURN QUERY SELECT true, v_result_record.message, v_result_record.transaction_id;
    ELSE
      -- Update request - keep as pending or mark failed
      RETURN QUERY SELECT false, v_result_record.message, NULL::uuid;
    END IF;
  END LOOP;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, 'Error approving transaction: ' || SQLERRM, NULL::uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.approve_transaction_request(uuid, text) TO authenticated;

-- ============================================
-- 4️⃣ REJECT TRANSACTION REQUEST
-- ============================================
DROP FUNCTION IF EXISTS public.reject_transaction_request(uuid);

CREATE OR REPLACE FUNCTION public.reject_transaction_request(p_request_id uuid)
RETURNS TABLE (success boolean, message text) AS $$
BEGIN
  UPDATE public.transaction_approval_requests
  SET status = 'rejected', updated_at = now()
  WHERE id = p_request_id;

  IF FOUND THEN
    RETURN QUERY SELECT true, 'Transaction request rejected'::text;
  ELSE
    RETURN QUERY SELECT false, 'Request not found'::text;
  END IF;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, 'Error rejecting transaction: ' || SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.reject_transaction_request(uuid) TO authenticated;

-- ============================================
-- 📊 TABLE FOR TRACKING APPROVAL REQUESTS
-- ============================================
DROP TABLE IF EXISTS public.transaction_approval_requests CASCADE;

CREATE TABLE public.transaction_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type text NOT NULL,
  user_id uuid NOT NULL,
  agent_id uuid,
  currency text NOT NULL,
  amount numeric NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  expires_at timestamp DEFAULT (now() + interval '5 minutes')
);

CREATE INDEX idx_transaction_approval_user ON public.transaction_approval_requests(user_id);
CREATE INDEX idx_transaction_approval_status ON public.transaction_approval_requests(status);
CREATE INDEX idx_transaction_approval_created ON public.transaction_approval_requests(created_at DESC);

-- ============================================
-- ✅ UNIVERSAL PIN SYSTEM COMPLETE
-- ============================================
SELECT 'Universal Transaction PIN System Created:
✅ process_transaction_with_pin() - Works for any transaction type
✅ request_transaction_approval() - Create approval requests
✅ approve_transaction_request() - Approve with PIN verification
✅ reject_transaction_request() - Reject any request
✅ transaction_approval_requests table - Track all requests' as status;
