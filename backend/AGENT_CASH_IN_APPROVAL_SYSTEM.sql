/**
 * 🏪 AGENT CASH-IN - SIMPLE TWO-STEP FLOW
 * 
 * Step 1: Agent creates pending cash-in (user sees notification)
 * Step 2: User confirms with PIN (money transfers)
 */

-- ============================================
-- STORE PENDING CASH-IN REQUESTS (no FK constraints)
-- ============================================
DROP TABLE IF EXISTS public.pending_cash_in_requests CASCADE;

CREATE TABLE public.pending_cash_in_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  amount numeric NOT NULL,
  currency text NOT NULL,
  status text DEFAULT 'pending', -- pending, approved, rejected, expired
  created_at timestamp DEFAULT now(),
  expires_at timestamp DEFAULT (now() + interval '1 day'),
  confirmed_at timestamp,
  metadata jsonb DEFAULT '{}'::jsonb
);

-- Enable RLS
ALTER TABLE public.pending_cash_in_requests ENABLE ROW LEVEL SECURITY;

-- RLS: Users can only see their own pending requests
DROP POLICY IF EXISTS "Users see own pending cash-in requests" ON public.pending_cash_in_requests;
CREATE POLICY "Users see own pending cash-in requests"
  ON public.pending_cash_in_requests FOR SELECT
  USING (user_id = auth.uid());

-- Indexes for performance
CREATE INDEX idx_pending_cashin_user ON public.pending_cash_in_requests(user_id);
CREATE INDEX idx_pending_cashin_status ON public.pending_cash_in_requests(status);
CREATE INDEX idx_pending_cashin_created ON public.pending_cash_in_requests(created_at);

-- ============================================
-- AGENT: CREATE PENDING CASH-IN REQUEST
-- ============================================
DROP FUNCTION IF EXISTS public.create_pending_cash_in(uuid, uuid, text, numeric);

CREATE OR REPLACE FUNCTION public.create_pending_cash_in(
  p_user_id uuid,
  p_agent_id uuid,
  p_curr text,
  p_amount numeric
)
RETURNS TABLE (success boolean, message text, request_id uuid) AS $$
DECLARE
  v_request_id uuid;
BEGIN
  v_request_id := gen_random_uuid();
  
  -- Create pending request (no FK constraints, simple)
  INSERT INTO public.pending_cash_in_requests (
    id, user_id, agent_id, amount, currency, status, metadata
  ) VALUES (
    v_request_id,
    p_user_id,
    p_agent_id,
    p_amount,
    p_curr,
    'pending',
    jsonb_build_object('initiated_at', now())
  );
  
  RETURN QUERY SELECT true, 'Cash-in request created. User must confirm with PIN.', v_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.create_pending_cash_in(uuid, uuid, text, numeric) TO authenticated;

-- ============================================
-- USER: CONFIRM PENDING CASH-IN WITH PIN
-- ============================================
DROP FUNCTION IF EXISTS public.confirm_pending_cash_in(uuid, text);

CREATE OR REPLACE FUNCTION public.confirm_pending_cash_in(
  p_request_id uuid,
  p_pin_attempt text
)
RETURNS TABLE (success boolean, message text, user_balance numeric, agent_balance numeric) AS $$
DECLARE
  v_user_id uuid;
  v_agent_id uuid;
  v_amount numeric;
  v_currency text;
  v_pin_hash text;
  v_pin_attempts int;
  v_user_balance numeric := 0;
  v_agent_balance numeric := 0;
  v_commission numeric;
BEGIN
  -- Get the pending request
  SELECT user_id, agent_id, amount, currency INTO v_user_id, v_agent_id, v_amount, v_currency
  FROM public.pending_cash_in_requests
  WHERE id = p_request_id AND status = 'pending';
  
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, 'Request not found or already processed', 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- Verify user's PIN
  SELECT pin_hash, failed_pin_attempts INTO v_pin_hash, v_pin_attempts
  FROM public.user_accounts WHERE user_id = v_user_id;

  IF v_pin_hash IS NULL THEN
    RETURN QUERY SELECT false, 'User account not found', 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- Check if account locked
  IF v_pin_attempts > 3 THEN
    RETURN QUERY SELECT false, 'Account locked. Too many failed PIN attempts.', 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- Verify PIN matches
  IF v_pin_hash != p_pin_attempt THEN
    UPDATE public.user_accounts 
    SET failed_pin_attempts = COALESCE(failed_pin_attempts, 0) + 1 
    WHERE user_id = v_user_id;
    
    RETURN QUERY SELECT false, 'Invalid PIN. Attempts remaining: ' || (3 - v_pin_attempts)::text, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- PIN correct - reset attempts
  UPDATE public.user_accounts SET failed_pin_attempts = 0 WHERE user_id = v_user_id;

  -- ============================================
  -- PROCESS THE TRANSACTION
  -- ============================================
  
  -- Step 1: Deduct from user wallet (user is withdrawing cash)
  UPDATE public.wallet_accounts
  SET balance = balance - v_amount, updated_at = now()
  WHERE user_id = v_user_id AND currency = v_currency AND balance >= v_amount;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Insufficient wallet balance', 0::numeric, 0::numeric;
    RETURN;
  END IF;

  SELECT balance INTO v_user_balance FROM public.wallet_accounts 
  WHERE user_id = v_user_id AND currency = v_currency;

  -- Step 2: Add to agent float (agent receives the cash)
  UPDATE public.agent_floats
  SET current_balance = current_balance + v_amount, updated_at = now()
  WHERE agent_id = v_agent_id AND currency = v_currency;

  IF NOT FOUND THEN
    -- Create agent float if doesn't exist
    INSERT INTO public.agent_floats (agent_id, currency, current_balance, created_at, updated_at)
    VALUES (v_agent_id, v_currency, v_amount, now(), now());
  END IF;

  SELECT current_balance INTO v_agent_balance FROM public.agent_floats 
  WHERE agent_id = v_agent_id AND currency = v_currency;

  -- Step 3: Add commission to agent (2.5% bonus for the transaction)
  v_commission := (v_amount * 2.5) / 100;
  UPDATE public.agent_floats
  SET current_balance = current_balance + v_commission, updated_at = now()
  WHERE agent_id = v_agent_id AND currency = v_currency;

  SELECT current_balance INTO v_agent_balance FROM public.agent_floats 
  WHERE agent_id = v_agent_id AND currency = v_currency;

  -- Step 4: Mark request as confirmed
  UPDATE public.pending_cash_in_requests
  SET status = 'approved', confirmed_at = now()
  WHERE id = p_request_id;

  -- Step 5: Log transaction
  INSERT INTO public.wallet_transactions (user_id, transaction_type, amount, currency, status, created_at, metadata)
  VALUES (v_user_id, 'cash_in', v_amount, v_currency, 'completed', now(),
    jsonb_build_object('agent_id', v_agent_id, 'commission', v_commission, 'request_id', p_request_id));

  RETURN QUERY SELECT true, 'PIN verified. Cash-in completed successfully', v_user_balance, v_agent_balance;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, 'Error confirming cash-in: ' || SQLERRM, 0::numeric, 0::numeric;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.confirm_pending_cash_in(uuid, text) TO authenticated;

-- ============================================
-- ✅ SETUP COMPLETE
-- ============================================
SELECT 'Pending cash-in system created:
- create_pending_cash_in() for agents
- confirm_pending_cash_in() for users' as status;
