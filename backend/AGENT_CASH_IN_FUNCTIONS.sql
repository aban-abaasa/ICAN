/**
 * 🏪 AGENT CASH-IN SYSTEM
 * 
 * Purpose: Handle user withdrawals through agents
 * - Deduct from user wallet
 * - Add to agent float
 * - Record transaction
 * Uses SECURITY DEFINER to bypass RLS policies
 */

-- ============================================
-- 1. DEDUCT FROM USER WALLET (Bypass RLS)
-- ============================================
DROP FUNCTION IF EXISTS public.process_user_cash_out(uuid, text, numeric);

CREATE OR REPLACE FUNCTION public.process_user_cash_out(
  p_user_id uuid,
  p_curr text,
  p_amount numeric
)
RETURNS SETOF public.wallet_accounts AS $$
BEGIN
  -- Deduct from user's wallet
  UPDATE public.wallet_accounts
  SET balance = balance - p_amount,
      updated_at = now()
  WHERE user_id = p_user_id AND currency = p_curr AND balance >= p_amount;
  
  -- Return the updated wallet
  RETURN QUERY SELECT * FROM public.wallet_accounts 
  WHERE user_id = p_user_id AND currency = p_curr;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.process_user_cash_out(uuid, text, numeric) TO authenticated;

-- ============================================
-- 2. ADD TO AGENT FLOAT (Bypass RLS)
-- ============================================
DROP FUNCTION IF EXISTS public.process_agent_float_increase(bigint, text, numeric);
DROP FUNCTION IF EXISTS public.process_agent_float_increase(uuid, text, numeric);

CREATE OR REPLACE FUNCTION public.process_agent_float_increase(
  p_agent_id uuid,
  p_curr text,
  p_amount numeric
)
RETURNS SETOF public.agent_floats AS $$
BEGIN
  -- Try to update existing float
  UPDATE public.agent_floats
  SET current_balance = current_balance + p_amount,
      updated_at = now()
  WHERE agent_id = p_agent_id AND currency = p_curr;
  
  -- If no rows updated, insert new float entry
  IF NOT FOUND THEN
    INSERT INTO public.agent_floats (agent_id, currency, current_balance)
    VALUES (p_agent_id, p_curr, p_amount);
  END IF;
  
  -- Return the updated float
  RETURN QUERY SELECT * FROM public.agent_floats 
  WHERE agent_id = p_agent_id AND currency = p_curr;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.process_agent_float_increase(uuid, text, numeric) TO authenticated;

-- ============================================
-- 3. RECORD CASH-IN TRANSACTION
-- ============================================
DROP FUNCTION IF EXISTS public.record_cash_in_transaction(uuid, bigint, text, numeric, text);
DROP FUNCTION IF EXISTS public.record_cash_in_transaction(uuid, uuid, text, numeric, text);

CREATE OR REPLACE FUNCTION public.record_cash_in_transaction(
  p_user_id uuid,
  p_agent_id uuid,
  p_curr text,
  p_amount numeric,
  p_transaction_id text
)
RETURNS TABLE (transaction_id text, status text, created_at timestamp) AS $$
DECLARE
  v_transaction_id text;
BEGIN
  v_transaction_id := p_transaction_id;
  
  -- Insert transaction record
  INSERT INTO public.wallet_transactions (
    user_id,
    transaction_type,
    amount,
    currency,
    payment_method,
    transaction_id,
    description,
    status,
    created_at,
    metadata
  ) VALUES (
    p_user_id,
    'cash_out',
    p_amount,
    p_curr,
    'AGENT_CASH_IN',
    v_transaction_id,
    'Cash-in to agent: ' || p_agent_id::text,
    'completed',
    now(),
    jsonb_build_object(
      'agent_id', p_agent_id,
      'transaction_type', 'cash_in'
    )
  );
  
  RETURN QUERY SELECT v_transaction_id, 'completed'::text, now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.record_cash_in_transaction(uuid, uuid, text, numeric, text) TO authenticated;

-- ============================================
-- VERIFY ALL FUNCTIONS
-- ============================================
SELECT 'All Agent Cash-In functions created successfully' as status;
