/**
 * 🔐 PIN VERIFICATION FOR ALL FINANCIAL OPERATIONS
 * 
 * Complete PIN-verified functions for:
 * - Cash-In (agent receives physical cash)
 * - Withdrawal (user withdraws via agent)
 * - Deposit (user deposits via agent)
 * - Cash-Out (agent gives physical cash)
 * - Top-Up (user adds credit)
 */

-- ============================================
-- 1️⃣ CASH-IN WITH PIN
-- ============================================
DROP FUNCTION IF EXISTS public.approve_cash_in_with_pin(uuid, uuid, uuid, text, text, numeric);

CREATE OR REPLACE FUNCTION public.approve_cash_in_with_pin(
  p_request_id uuid,
  p_user_id uuid,
  p_agent_id uuid,
  p_pin_attempt text,
  p_curr text,
  p_amount numeric
)
RETURNS TABLE (success boolean, message text, user_balance numeric, agent_balance numeric) AS $$
DECLARE
  v_user_pin_hash text;
  v_pin_attempts int;
  v_is_locked boolean;
  v_user_balance numeric := 0;
  v_agent_balance numeric := 0;
BEGIN
  -- Get user's PIN hash and attempt count
  SELECT pin_hash, failed_pin_attempts INTO v_user_pin_hash, v_pin_attempts
  FROM public.user_accounts
  WHERE user_id = p_user_id;

  IF v_user_pin_hash IS NULL THEN
    RETURN QUERY SELECT false, 'User account not found', 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- Check if account is locked
  IF v_pin_attempts > 3 THEN
    RETURN QUERY SELECT false, 'Account locked. Too many failed PIN attempts. Contact support.', 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- Verify PIN
  IF v_user_pin_hash != p_pin_attempt THEN
    UPDATE public.user_accounts
    SET failed_pin_attempts = COALESCE(failed_pin_attempts, 0) + 1
    WHERE user_id = p_user_id;
    
    RETURN QUERY SELECT false, 'Invalid PIN. Attempts remaining: ' || (3 - v_pin_attempts)::text, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- PIN correct - reset attempts
  UPDATE public.user_accounts
  SET failed_pin_attempts = 0
  WHERE user_id = p_user_id;

  -- Deduct from user wallet (customer gives physical cash to agent)
  UPDATE public.wallet_accounts
  SET balance = balance - p_amount,
      updated_at = now()
  WHERE user_id = p_user_id AND currency = p_curr AND balance >= p_amount;

  -- Check if wallet deduction was successful
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Insufficient wallet balance', 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- Get new user balance
  SELECT balance INTO v_user_balance FROM public.wallet_accounts 
  WHERE user_id = p_user_id AND currency = p_curr;

  -- Add to agent float (agent receives the cash)
  UPDATE public.agent_floats
  SET current_balance = current_balance + p_amount,
      updated_at = now()
  WHERE agent_id = p_agent_id AND currency = p_curr;

  -- Insert if doesn't exist
  IF NOT FOUND THEN
    INSERT INTO public.agent_floats (agent_id, currency, current_balance, created_at, updated_at)
    VALUES (p_agent_id, p_curr, p_amount, now(), now());
  END IF;

  -- Get new agent balance
  SELECT current_balance INTO v_agent_balance FROM public.agent_floats 
  WHERE agent_id = p_agent_id AND currency = p_curr;

  -- Update transaction status
  UPDATE public.wallet_transactions
  SET status = 'completed',
      created_at = now(),
      metadata = jsonb_set(metadata, '{pin_verified}', 'true'::jsonb)
  WHERE id = p_request_id;

  RETURN QUERY SELECT true, 'PIN verified. Cash-in completed successfully', v_user_balance, v_agent_balance;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, 'Error processing cash-in: ' || SQLERRM, 0::numeric, 0::numeric;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.approve_cash_in_with_pin(uuid, uuid, uuid, text, text, numeric) TO authenticated;

-- ============================================
-- 2️⃣ WITHDRAWAL WITH PIN (User → Agent)
-- ============================================
DROP FUNCTION IF EXISTS public.process_withdrawal_with_pin(uuid, uuid, text, text, numeric);

CREATE OR REPLACE FUNCTION public.process_withdrawal_with_pin(
  p_user_id uuid,
  p_agent_id uuid,
  p_pin_attempt text,
  p_curr text,
  p_amount numeric
)
RETURNS TABLE (success boolean, message text, user_balance numeric, agent_balance numeric) AS $$
DECLARE
  v_user_pin_hash text;
  v_pin_attempts int;
  v_user_balance numeric := 0;
  v_agent_balance numeric := 0;
BEGIN
  -- Get PIN hash
  SELECT pin_hash, failed_pin_attempts INTO v_user_pin_hash, v_pin_attempts
  FROM public.user_accounts
  WHERE user_id = p_user_id;

  IF v_user_pin_hash IS NULL THEN
    RETURN QUERY SELECT false, 'User account not found', 0::numeric, 0::numeric;
    RETURN;
  END IF;

  IF v_pin_attempts > 3 THEN
    RETURN QUERY SELECT false, 'Account locked due to failed PIN attempts', 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- Verify PIN
  IF v_user_pin_hash != p_pin_attempt THEN
    UPDATE public.user_accounts SET failed_pin_attempts = COALESCE(failed_pin_attempts, 0) + 1 WHERE user_id = p_user_id;
    RETURN QUERY SELECT false, 'Invalid PIN. Attempts remaining: ' || (3 - v_pin_attempts)::text, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- Reset failed attempts
  UPDATE public.user_accounts SET failed_pin_attempts = 0 WHERE user_id = p_user_id;

  -- Deduct from user wallet
  UPDATE public.wallet_accounts
  SET balance = balance - p_amount, updated_at = now()
  WHERE user_id = p_user_id AND currency = p_curr AND balance >= p_amount;

  SELECT balance INTO v_user_balance FROM public.wallet_accounts 
  WHERE user_id = p_user_id AND currency = p_curr;

  -- Add to agent float
  UPDATE public.agent_floats
  SET current_balance = current_balance + p_amount, updated_at = now()
  WHERE agent_id = p_agent_id AND currency = p_curr;

  IF NOT FOUND THEN
    INSERT INTO public.agent_floats (agent_id, currency, current_balance, created_at, updated_at)
    VALUES (p_agent_id, p_curr, p_amount, now(), now());
  END IF;

  SELECT current_balance INTO v_agent_balance FROM public.agent_floats 
  WHERE agent_id = p_agent_id AND currency = p_curr;

  -- Record transaction
  INSERT INTO public.wallet_transactions (user_id, transaction_type, amount, currency, status, created_at)
  VALUES (p_user_id, 'withdrawal', p_amount, p_curr, 'completed', now());

  RETURN QUERY SELECT true, 'PIN verified. Withdrawal completed', v_user_balance, v_agent_balance;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, 'Error processing withdrawal: ' || SQLERRM, 0::numeric, 0::numeric;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.process_withdrawal_with_pin(uuid, uuid, text, text, numeric) TO authenticated;

-- ============================================
-- 3️⃣ DEPOSIT WITH PIN (Agent → User)
-- ============================================
DROP FUNCTION IF EXISTS public.process_deposit_with_pin(uuid, uuid, text, text, numeric);

CREATE OR REPLACE FUNCTION public.process_deposit_with_pin(
  p_user_id uuid,
  p_agent_id uuid,
  p_pin_attempt text,
  p_curr text,
  p_amount numeric
)
RETURNS TABLE (success boolean, message text, user_balance numeric, agent_balance numeric) AS $$
DECLARE
  v_user_pin_hash text;
  v_pin_attempts int;
  v_user_balance numeric := 0;
  v_agent_balance numeric := 0;
BEGIN
  SELECT pin_hash, failed_pin_attempts INTO v_user_pin_hash, v_pin_attempts
  FROM public.user_accounts WHERE user_id = p_user_id;

  IF v_user_pin_hash IS NULL THEN
    RETURN QUERY SELECT false, 'User account not found', 0::numeric, 0::numeric;
    RETURN;
  END IF;

  IF v_pin_attempts > 3 THEN
    RETURN QUERY SELECT false, 'Account locked', 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- Verify PIN
  IF v_user_pin_hash != p_pin_attempt THEN
    UPDATE public.user_accounts SET failed_pin_attempts = COALESCE(failed_pin_attempts, 0) + 1 WHERE user_id = p_user_id;
    RETURN QUERY SELECT false, 'Invalid PIN. Attempts remaining: ' || (3 - v_pin_attempts)::text, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  UPDATE public.user_accounts SET failed_pin_attempts = 0 WHERE user_id = p_user_id;

  -- Deduct from agent float
  UPDATE public.agent_floats
  SET current_balance = current_balance - p_amount, updated_at = now()
  WHERE agent_id = p_agent_id AND currency = p_curr AND current_balance >= p_amount;

  SELECT current_balance INTO v_agent_balance FROM public.agent_floats 
  WHERE agent_id = p_agent_id AND currency = p_curr;

  -- Add to user wallet
  UPDATE public.wallet_accounts
  SET balance = balance + p_amount, updated_at = now()
  WHERE user_id = p_user_id AND currency = p_curr;

  IF NOT FOUND THEN
    INSERT INTO public.wallet_accounts (user_id, currency, balance, created_at, updated_at)
    VALUES (p_user_id, p_curr, p_amount, now(), now());
  END IF;

  SELECT balance INTO v_user_balance FROM public.wallet_accounts 
  WHERE user_id = p_user_id AND currency = p_curr;

  INSERT INTO public.wallet_transactions (user_id, transaction_type, amount, currency, status, created_at)
  VALUES (p_user_id, 'deposit', p_amount, p_curr, 'completed', now());

  RETURN QUERY SELECT true, 'PIN verified. Deposit completed', v_user_balance, v_agent_balance;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, 'Error processing deposit: ' || SQLERRM, 0::numeric, 0::numeric;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.process_deposit_with_pin(uuid, uuid, text, text, numeric) TO authenticated;

-- ============================================
-- 4️⃣ CASH-OUT WITH PIN (Agent gives cash)
-- ============================================
DROP FUNCTION IF EXISTS public.process_cashout_with_pin(uuid, uuid, text, text, numeric);

CREATE OR REPLACE FUNCTION public.process_cashout_with_pin(
  p_user_id uuid,
  p_agent_id uuid,
  p_pin_attempt text,
  p_curr text,
  p_amount numeric
)
RETURNS TABLE (success boolean, message text, user_balance numeric, agent_balance numeric) AS $$
DECLARE
  v_user_pin_hash text;
  v_pin_attempts int;
  v_user_balance numeric := 0;
  v_agent_balance numeric := 0;
  v_commission numeric;
  v_net_amount numeric;
BEGIN
  SELECT pin_hash, failed_pin_attempts INTO v_user_pin_hash, v_pin_attempts
  FROM public.user_accounts WHERE user_id = p_user_id;

  IF v_user_pin_hash IS NULL THEN
    RETURN QUERY SELECT false, 'User account not found', 0::numeric, 0::numeric;
    RETURN;
  END IF;

  IF v_pin_attempts > 3 THEN
    RETURN QUERY SELECT false, 'Account locked', 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- Verify PIN
  IF v_user_pin_hash != p_pin_attempt THEN
    UPDATE public.user_accounts SET failed_pin_attempts = COALESCE(failed_pin_attempts, 0) + 1 WHERE user_id = p_user_id;
    RETURN QUERY SELECT false, 'Invalid PIN. Attempts remaining: ' || (3 - v_pin_attempts)::text, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  UPDATE public.user_accounts SET failed_pin_attempts = 0 WHERE user_id = p_user_id;

  -- Calculate commission (2.5% default)
  v_commission := (p_amount * 2.5) / 100;
  v_net_amount := p_amount - v_commission;

  -- Step 1: Deduct full amount from agent's float (agent gives cash to customer)
  UPDATE public.agent_floats
  SET current_balance = current_balance - p_amount, updated_at = now()
  WHERE agent_id = p_agent_id AND currency = p_curr AND current_balance >= p_amount;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Insufficient agent float balance', 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- Step 2: Add full amount to customer wallet (customer receives cash)
  UPDATE public.wallet_accounts
  SET balance = balance + p_amount, updated_at = now()
  WHERE user_id = p_user_id AND currency = p_curr;

  IF NOT FOUND THEN
    -- Wallet doesn't exist, create it
    INSERT INTO public.wallet_accounts (user_id, currency, balance, created_at, updated_at)
    VALUES (p_user_id, p_curr, p_amount, now(), now());
  END IF;

  SELECT balance INTO v_user_balance FROM public.wallet_accounts 
  WHERE user_id = p_user_id AND currency = p_curr;

  -- Step 3: Add commission back to agent (agent earns commission on the transaction)
  UPDATE public.agent_floats
  SET current_balance = current_balance + v_commission, updated_at = now()
  WHERE agent_id = p_agent_id AND currency = p_curr;

  SELECT current_balance INTO v_agent_balance FROM public.agent_floats 
  WHERE agent_id = p_agent_id AND currency = p_curr;

  INSERT INTO public.wallet_transactions (user_id, transaction_type, amount, currency, status, created_at, metadata)
  VALUES (p_user_id, 'cashout', p_amount, p_curr, 'completed', now(), 
    jsonb_build_object('commission', v_commission, 'gross_amount', p_amount, 'agent_id', p_agent_id));

  RETURN QUERY SELECT true, 'PIN verified. Cash-out completed', v_user_balance, v_agent_balance;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, 'Error processing cash-out: ' || SQLERRM, 0::numeric, 0::numeric;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.process_cashout_with_pin(uuid, uuid, text, text, numeric) TO authenticated;

-- ============================================
-- 5️⃣ TOP-UP WITH PIN (User adds credit)
-- ============================================
DROP FUNCTION IF EXISTS public.process_topup_with_pin(uuid, text, text, numeric);

CREATE OR REPLACE FUNCTION public.process_topup_with_pin(
  p_user_id uuid,
  p_pin_attempt text,
  p_curr text,
  p_amount numeric
)
RETURNS TABLE (success boolean, message text, new_balance numeric) AS $$
DECLARE
  v_user_pin_hash text;
  v_pin_attempts int;
  v_new_balance numeric := 0;
BEGIN
  SELECT pin_hash, failed_pin_attempts INTO v_user_pin_hash, v_pin_attempts
  FROM public.user_accounts WHERE user_id = p_user_id;

  IF v_user_pin_hash IS NULL THEN
    RETURN QUERY SELECT false, 'User account not found', 0::numeric;
    RETURN;
  END IF;

  IF v_pin_attempts > 3 THEN
    RETURN QUERY SELECT false, 'Account locked', 0::numeric;
    RETURN;
  END IF;

  -- Verify PIN
  IF v_user_pin_hash != p_pin_attempt THEN
    UPDATE public.user_accounts SET failed_pin_attempts = COALESCE(failed_pin_attempts, 0) + 1 WHERE user_id = p_user_id;
    RETURN QUERY SELECT false, 'Invalid PIN. Attempts remaining: ' || (3 - v_pin_attempts)::text, 0::numeric;
    RETURN;
  END IF;

  UPDATE public.user_accounts SET failed_pin_attempts = 0 WHERE user_id = p_user_id;

  -- Add to wallet
  UPDATE public.wallet_accounts
  SET balance = balance + p_amount, updated_at = now()
  WHERE user_id = p_user_id AND currency = p_curr;

  IF NOT FOUND THEN
    INSERT INTO public.wallet_accounts (user_id, currency, balance, created_at, updated_at)
    VALUES (p_user_id, p_curr, p_amount, now(), now());
  END IF;

  SELECT balance INTO v_new_balance FROM public.wallet_accounts 
  WHERE user_id = p_user_id AND currency = p_curr;

  INSERT INTO public.wallet_transactions (user_id, transaction_type, amount, currency, status, created_at)
  VALUES (p_user_id, 'topup', p_amount, p_curr, 'completed', now());

  RETURN QUERY SELECT true, 'PIN verified. Top-up completed successfully', v_new_balance;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, 'Error processing top-up: ' || SQLERRM, 0::numeric;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.process_topup_with_pin(uuid, text, text, numeric) TO authenticated;

-- ============================================
-- ✅ ALL PIN FUNCTIONS CREATED
-- ============================================
SELECT 'All PIN verification functions created successfully:
1. approve_cash_in_with_pin()
2. process_withdrawal_with_pin()
3. process_deposit_with_pin()
4. process_cashout_with_pin()
5. process_topup_with_pin()' as status;
