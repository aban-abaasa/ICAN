-- ============================================
-- ADD AGENT ID FIELD (Unique Display ID)
-- ============================================
-- Run this migration to add agent_id field to agents table

-- Add agent_id column if it doesn't exist
ALTER TABLE public.agents
ADD COLUMN IF NOT EXISTS agent_id TEXT UNIQUE;

-- Create index for agent_id
CREATE INDEX IF NOT EXISTS idx_agents_agent_id ON public.agents(agent_id);

-- Update existing agents with generated agent_id (if any)
UPDATE public.agents
SET agent_id = 'ICAN-AGENT-' || LPAD(ROW_NUMBER() OVER (ORDER BY created_at)::TEXT, 10, '0')
WHERE agent_id IS NULL;

-- Add unique constraint
ALTER TABLE public.agents
ADD CONSTRAINT unique_agent_id UNIQUE (agent_id);

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name='agents' 
ORDER BY ordinal_position;

SELECT id, agent_code, agent_id, agent_name 
FROM public.agents 
ORDER BY created_at DESC 
LIMIT 5;
