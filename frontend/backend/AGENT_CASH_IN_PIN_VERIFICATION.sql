/**
 * 🔐 PIN-VERIFIED CASH-IN APPROVAL
 * 
 * Requires user to enter PIN before approving cash-in
 * Enhanced security for cash withdrawals
 */

-- ============================================
-- APPROVE CASH-IN WITH PIN VERIFICATION
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
  v_user_balance numeric;
  v_agent_balance numeric;
BEGIN
  -- Step 1: Get user's PIN hash
  SELECT pin_hash, failed_pin_attempts INTO v_user_pin_hash, v_pin_attempts
  FROM public.user_accounts
  WHERE user_id = p_user_id;

  IF v_user_pin_hash IS NULL THEN
    RETURN QUERY SELECT false, 'User account not found', 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- Step 2: Check if account is locked (too many failed attempts)
  SELECT failed_pin_attempts > 3 INTO v_is_locked
  FROM public.user_accounts
  WHERE user_id = p_user_id;

  IF v_is_locked THEN
    RETURN QUERY SELECT false, 'Account locked due to too many failed PIN attempts. Contact support.', 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- Step 3: Verify PIN (simple hash comparison - in production use bcrypt or similar)
  -- This is a basic implementation. In production, use proper crypto libraries
  IF crypt(p_pin_attempt, v_user_pin_hash) IS NOT NULL AND crypt(p_pin_attempt, v_user_pin_hash) = v_user_pin_hash THEN
    -- PIN is correct - reset failed attempts
    UPDATE public.user_accounts
    SET failed_pin_attempts = 0
    WHERE user_id = p_user_id;
  ELSE
    -- PIN is incorrect - increment failed attempts
    UPDATE public.user_accounts
    SET failed_pin_attempts = COALESCE(failed_pin_attempts, 0) + 1
    WHERE user_id = p_user_id;
    
    RETURN QUERY SELECT false, 'Invalid PIN. Attempts remaining: ' || (3 - v_pin_attempts)::text, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- Step 4: PIN verified - process cash-in

  -- Deduct from user's wallet
  UPDATE public.wallet_accounts
  SET balance = balance - p_amount,
      updated_at = now()
  WHERE user_id = p_user_id AND currency = p_curr AND balance >= p_amount;

  -- Get new user balance
  SELECT balance INTO v_user_balance FROM public.wallet_accounts 
  WHERE user_id = p_user_id AND currency = p_curr;

  -- Add to agent's float
  UPDATE public.agent_floats
  SET current_balance = current_balance + p_amount,
      updated_at = now()
  WHERE agent_id = p_agent_id AND currency = p_curr;

  -- If no rows updated, insert new float entry
  IF NOT FOUND THEN
    INSERT INTO public.agent_floats (agent_id, currency, current_balance)
    VALUES (p_agent_id, p_curr, p_amount);
  END IF;

  -- Get new agent balance
  SELECT current_balance INTO v_agent_balance FROM public.agent_floats 
  WHERE agent_id = p_agent_id AND currency = p_curr;

  -- Update transaction status to completed
  UPDATE public.wallet_transactions
  SET status = 'completed',
      created_at = now(),
      metadata = jsonb_set(metadata, '{approval_status}', '"approved"'::jsonb),
      metadata = jsonb_set(metadata, '{pin_verified}', 'true'::jsonb)
  WHERE id = p_request_id;

  RETURN QUERY SELECT true, 'PIN verified. Cash-in approved and completed', v_user_balance, v_agent_balance;

EXCEPTION WHEN OTHERS THEN
  -- Fallback for simple PIN hash comparison if crypt is not available
  -- This is a basic string comparison (NOT SECURE - for demo only)
  IF v_user_pin_hash = p_pin_attempt THEN
    UPDATE public.user_accounts
    SET failed_pin_attempts = 0
    WHERE user_id = p_user_id;

    -- Process cash-in
    UPDATE public.wallet_accounts
    SET balance = balance - p_amount,
        updated_at = now()
    WHERE user_id = p_user_id AND currency = p_curr AND balance >= p_amount;

    SELECT balance INTO v_user_balance FROM public.wallet_accounts 
    WHERE user_id = p_user_id AND currency = p_curr;

    UPDATE public.agent_floats
    SET current_balance = current_balance + p_amount,
        updated_at = now()
    WHERE agent_id = p_agent_id AND currency = p_curr;

    IF NOT FOUND THEN
      INSERT INTO public.agent_floats (agent_id, currency, current_balance)
      VALUES (p_agent_id, p_curr, p_amount);
    END IF;

    SELECT current_balance INTO v_agent_balance FROM public.agent_floats 
    WHERE agent_id = p_agent_id AND currency = p_curr;

    UPDATE public.wallet_transactions
    SET status = 'completed',
        created_at = now(),
        metadata = jsonb_set(metadata, '{approval_status}', '"approved"'::jsonb),
        metadata = jsonb_set(metadata, '{pin_verified}', 'true'::jsonb)
    WHERE id = p_request_id;

    RETURN QUERY SELECT true, 'PIN verified. Cash-in approved and completed', v_user_balance, v_agent_balance;
  ELSE
    UPDATE public.user_accounts
    SET failed_pin_attempts = COALESCE(failed_pin_attempts, 0) + 1
    WHERE user_id = p_user_id;
    
    RETURN QUERY SELECT false, 'Invalid PIN. Attempts remaining: ' || (3 - v_pin_attempts)::text, 0::numeric, 0::numeric;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.approve_cash_in_with_pin(uuid, uuid, uuid, text, text, numeric) TO authenticated;

-- ============================================
-- VERIFY
-- ============================================
SELECT 'PIN verification function created successfully' as status;
