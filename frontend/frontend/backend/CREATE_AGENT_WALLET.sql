/**
 * 💰 ICAN Wallet System - Create Agent Float Account
 * Agent AGENT-KAM-5560 has paid 1,000,000 UGX
 * Creates agent_floats records with 1,000,000 UGX float
 */

-- Step 1: Get the agent's ID
WITH agent_info AS (
  SELECT id as agent_id, user_id
  FROM public.agents 
  WHERE agent_code = 'AGENT-KAM-5560' 
     OR id = 'ca4e73f3-4af5-4291-a4a1-59646d74bc1a'
  LIMIT 1
)

-- Step 2: Create or update UGX float in agent_floats table
INSERT INTO public.agent_floats (agent_id, currency, current_balance, total_topups, total_withdrawn)
SELECT agent_id, 'UGX', 1000000.00, 0, 0
FROM agent_info
ON CONFLICT (agent_id, currency) DO UPDATE SET
  current_balance = 1000000.00,
  updated_at = NOW();

-- Step 3: Verify the agent float was created
SELECT 
  af.id,
  af.agent_id,
  af.currency,
  af.current_balance,
  af.total_topups,
  af.total_withdrawn,
  a.agent_code,
  a.agent_name,
  af.created_at,
  af.updated_at
FROM public.agent_floats af
LEFT JOIN public.agents a ON af.agent_id = a.id
WHERE a.agent_code = 'AGENT-KAM-5560' 
   OR a.id = 'ca4e73f3-4af5-4291-a4a1-59646d74bc1a'
ORDER BY af.currency;
