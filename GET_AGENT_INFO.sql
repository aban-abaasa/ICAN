/**
 * 🔍 Query Agent Information from Supabase
 * Retrieve registered agent details including auth user ID
 */

-- First: Check agents table schema
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'agents'
ORDER BY ordinal_position;

-- Get all agent info
SELECT * FROM public.agents
ORDER BY created_at DESC
LIMIT 10;

-- Get specific agent by code (AGENT-KAM-5560)
SELECT * FROM public.agents a
WHERE a.agent_code = 'AGENT-KAM-5560' 
   OR a.id = 'ca4e73f3-4af5-4291-a4a1-59646d74bc1a';

-- Check if agent wallet already exists
SELECT * FROM public.wallet_accounts 
WHERE user_id IN (
  SELECT user_id FROM public.agents 
  WHERE agent_code = 'AGENT-KAM-5560' 
     OR id = 'ca4e73f3-4af5-4291-a4a1-59646d74bc1a'
);
