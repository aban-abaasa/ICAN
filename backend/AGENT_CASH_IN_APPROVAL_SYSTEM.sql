/**
 * 🏪 AGENT CASH-IN WITH APPROVAL SYSTEM
 * 
 * Two-step process:
 * 1. Request: Create pending cash-in request (user sees it)
 * 2. Approve: User confirms → money transferred, float updated
 * Uses SECURITY DEFINER to bypass RLS policies
 */

-- ============================================
-- 1. CREATE PENDING CASH-IN REQUEST
-- ============================================
DROP FUNCTION IF EXISTS public.request_cash_in(uuid, uuid, text, numeric);

CREATE OR REPLACE FUNCTION public.request_cash_in(
  p_user_id uuid,
  p_agent_id uuid,
  p_curr text,
  p_amount numeric
)
RETURNS TABLE (request_id uuid, status text) AS $$
DECLARE
  v_request_id uuid;
  v_wallet_id uuid;
BEGIN
  v_request_id := gen_random_uuid();
  
  -- Get wallet ID for this user and currency
  SELECT id INTO v_wallet_id FROM public.wallet_accounts
  WHERE user_id = p_user_id AND currency = p_curr
  LIMIT 1;
  
  IF v_wallet_id IS NULL THEN
    -- Create wallet if it doesn't exist
    INSERT INTO public.wallet_accounts (user_id, currency, balance, created_at, updated_at)
    VALUES (p_user_id, p_curr, 0, now(), now())
    RETURNING id INTO v_wallet_id;
  END IF;
  
  -- Create pending cash-in request
  INSERT INTO public.wallet_transactions (
    id,
    wallet_id,
    user_id,
    transaction_type,
    amount,
    currency,
    status,
    created_at,
    metadata
  ) VALUES (
    v_request_id,
    v_wallet_id,
    p_user_id,
    'cash_in',
    p_amount,
    p_curr,
    'pending',
    now(),
    jsonb_build_object(
      'agent_id', p_agent_id,
      'requires_approval', true,
      'approval_status', 'pending'
    )
  );
  
  RETURN QUERY SELECT v_request_id, 'pending'::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.request_cash_in(uuid, uuid, text, numeric) TO authenticated;

-- ============================================
-- 2. APPROVE & COMPLETE CASH-IN
-- ============================================
DROP FUNCTION IF EXISTS public.approve_cash_in(uuid, uuid, uuid, text, numeric);

CREATE OR REPLACE FUNCTION public.approve_cash_in(
  p_request_id uuid,
  p_user_id uuid,
  p_agent_id uuid,
  p_curr text,
  p_amount numeric
)
RETURNS TABLE (success boolean, message text, user_balance numeric, agent_balance numeric) AS $$
DECLARE
  v_user_balance numeric;
  v_agent_balance numeric;
BEGIN
  -- Step 1: Deduct from user's wallet
  UPDATE public.wallet_accounts
  SET balance = balance - p_amount,
      updated_at = now()
  WHERE user_id = p_user_id AND currency = p_curr AND balance >= p_amount;
  
  -- Get new user balance
  SELECT balance INTO v_user_balance FROM public.wallet_accounts 
  WHERE user_id = p_user_id AND currency = p_curr;
  
  IF v_user_balance IS NULL THEN
    RETURN QUERY SELECT false, 'Insufficient balance or wallet not found', 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- Step 2: Add to agent's float
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

  -- Step 3: Update transaction status to completed
  UPDATE public.wallet_transactions
  SET status = 'completed',
      created_at = now(),
      metadata = jsonb_set(metadata, '{approval_status}', '"approved"'::jsonb)
  WHERE id = p_request_id;
  
  RETURN QUERY SELECT true, 'Cash-in approved and completed', v_user_balance, v_agent_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.approve_cash_in(uuid, uuid, uuid, text, numeric) TO authenticated;

-- ============================================
-- 3. REJECT/CANCEL CASH-IN REQUEST
-- ============================================
DROP FUNCTION IF EXISTS public.reject_cash_in(uuid);

CREATE OR REPLACE FUNCTION public.reject_cash_in(
  p_request_id uuid
)
RETURNS TABLE (success boolean, message text) AS $$
BEGIN
  -- Update transaction status to rejected
  UPDATE public.wallet_transactions
  SET status = 'rejected',
      metadata = jsonb_set(metadata, '{approval_status}', '"rejected"'::jsonb)
  WHERE id = p_request_id;
  
  RETURN QUERY SELECT true, 'Cash-in request rejected';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.reject_cash_in(uuid) TO authenticated;

-- ============================================
-- VERIFY ALL FUNCTIONS
-- ============================================
SELECT 'All approval-based Cash-In functions created successfully' as status;
