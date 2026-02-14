/**
 * 🏪 FIX: CREATE MISSING AGENT TRANSACTIONS TABLE
 * This script creates the agent_transactions table and related agent system tables
 * Run this if you get: "relation "public.agent_transactions" does not exist"
 */

-- ============================================================================
-- DROP EXISTING TABLES (if they exist - be careful!)
-- Uncomment only if you want to recreate from scratch
-- ============================================================================
-- DROP TABLE IF EXISTS public.agent_settlements CASCADE;
-- DROP TABLE IF EXISTS public.agent_transactions CASCADE;
-- DROP TABLE IF EXISTS public.agent_floats CASCADE;
-- DROP TABLE IF EXISTS public.agents CASCADE;

-- ============================================================================
-- 1️⃣ CREATE AGENTS TABLE (if not exists)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    
    -- Agent Details
    agent_name TEXT NOT NULL,
    agent_code TEXT UNIQUE NOT NULL,
    phone_number TEXT NOT NULL,
    email TEXT,
    
    -- Location
    location_name TEXT,
    location_city TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    
    -- Status
    status TEXT DEFAULT 'active',
    is_verified BOOLEAN DEFAULT false,
    
    -- Commission Settings
    deposit_commission_percentage DECIMAL(5, 2) DEFAULT 0,
    withdrawal_commission_percentage DECIMAL(5, 2) DEFAULT 2.5,
    fx_margin_percentage DECIMAL(5, 2) DEFAULT 1.5,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE,
    verified_at TIMESTAMP WITH TIME ZONE,
    last_activity_at TIMESTAMP WITH TIME ZONE
);

-- ============================================================================
-- 2️⃣ CREATE AGENT FLOAT ACCOUNTS TABLE (if not exists)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.agent_floats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
    
    -- Separate ledgers for USD and UGX
    currency TEXT NOT NULL,
    current_balance DECIMAL(18, 8) NOT NULL DEFAULT 0,
    total_deposited DECIMAL(18, 8) DEFAULT 0,
    total_withdrawn DECIMAL(18, 8) DEFAULT 0,
    
    -- Float history
    last_topup_amount DECIMAL(18, 8),
    last_topup_at TIMESTAMP WITH TIME ZONE,
    total_topups DECIMAL(18, 8) DEFAULT 0,
    
    -- Status
    is_frozen BOOLEAN DEFAULT false,
    frozen_reason TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE,
    
    UNIQUE(agent_id, currency)
);

-- ============================================================================
-- 3️⃣ CREATE AGENT TRANSACTIONS TABLE (the missing one!)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.agent_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    
    -- Transaction Type
    transaction_type TEXT NOT NULL,
    
    -- Amounts
    amount DECIMAL(18, 8) NOT NULL,
    currency TEXT NOT NULL,
    commission_amount DECIMAL(18, 8) DEFAULT 0,
    net_amount DECIMAL(18, 8),
    
    -- References
    user_account_id TEXT,
    momo_transaction_id TEXT,
    reference_number TEXT UNIQUE,
    
    -- Status
    status TEXT DEFAULT 'pending',
    
    -- Reconciliation
    is_reconciled BOOLEAN DEFAULT false,
    reconciled_at TIMESTAMP WITH TIME ZONE,
    reconciled_by TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
);

-- ============================================================================
-- 4️⃣ CREATE AGENT SETTLEMENTS TABLE (if not exists)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.agent_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
    
    -- Period
    settlement_date DATE NOT NULL,
    shift_number INTEGER DEFAULT 1,
    shift_start_time TIME,
    shift_end_time TIME,
    
    -- USD Ledger
    usd_opening_balance DECIMAL(18, 8),
    usd_cash_in_total DECIMAL(18, 8) DEFAULT 0,
    usd_cash_out_total DECIMAL(18, 8) DEFAULT 0,
    usd_closing_balance DECIMAL(18, 8),
    usd_variance DECIMAL(18, 8),
    
    -- UGX Ledger
    ugx_opening_balance DECIMAL(18, 8),
    ugx_cash_in_total DECIMAL(18, 8) DEFAULT 0,
    ugx_cash_out_total DECIMAL(18, 8) DEFAULT 0,
    ugx_closing_balance DECIMAL(18, 8),
    ugx_variance DECIMAL(18, 8),
    
    -- Summary
    total_transactions INTEGER DEFAULT 0,
    total_commission_earned DECIMAL(18, 8) DEFAULT 0,
    
    -- Status
    status TEXT DEFAULT 'open',
    notes TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    submitted_at TIMESTAMP WITH TIME ZONE,
    verified_at TIMESTAMP WITH TIME ZONE
);

-- ============================================================================
-- 5️⃣ CREATE INDEXES FOR PERFORMANCE
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_agent_transactions_agent_id ON public.agent_transactions(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_transactions_user_id ON public.agent_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_transactions_type ON public.agent_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_agent_transactions_status ON public.agent_transactions(status);
CREATE INDEX IF NOT EXISTS idx_agent_transactions_created ON public.agent_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_agents_user_id ON public.agents(user_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON public.agents(status);
CREATE INDEX IF NOT EXISTS idx_agent_floats_agent_currency ON public.agent_floats(agent_id, currency);
CREATE INDEX IF NOT EXISTS idx_agent_settlements_agent_date ON public.agent_settlements(agent_id, settlement_date);

-- ============================================================================
-- 6️⃣ ENABLE ROW LEVEL SECURITY (RLS)
-- ============================================================================
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_floats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_settlements ENABLE ROW LEVEL SECURITY;

-- Add RLS to agent_floats
DROP POLICY IF EXISTS agent_floats_select_policy ON public.agent_floats;
CREATE POLICY agent_floats_select_policy ON public.agent_floats FOR SELECT
    USING (auth.uid() IN (SELECT user_id FROM public.agents WHERE id = agent_id));

-- ============================================================================
-- 7️⃣ RLS POLICIES FOR AGENTS
-- ============================================================================
DROP POLICY IF EXISTS agents_select_policy ON public.agents;
CREATE POLICY agents_select_policy ON public.agents FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS agents_insert_policy ON public.agents;
CREATE POLICY agents_insert_policy ON public.agents FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 8️⃣ RLS POLICIES FOR AGENT TRANSACTIONS
-- ============================================================================
DROP POLICY IF EXISTS agent_transactions_select_policy ON public.agent_transactions;
CREATE POLICY agent_transactions_select_policy ON public.agent_transactions FOR SELECT
    USING (
        auth.uid() IN (SELECT user_id FROM public.agents WHERE id = agent_id)
        OR auth.uid() = user_id
    );

DROP POLICY IF EXISTS agent_transactions_insert_policy ON public.agent_transactions;
CREATE POLICY agent_transactions_insert_policy ON public.agent_transactions FOR INSERT
    WITH CHECK (auth.uid() IN (SELECT user_id FROM public.agents WHERE id = agent_id));

-- ============================================================================
-- 9️⃣ VERIFY TABLES CREATED
-- ============================================================================
SELECT 'Tables created successfully!' as status,
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_name IN ('agents', 'agent_floats', 'agent_transactions', 'agent_settlements')) as tables_created,
       NOW() as timestamp;

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- ✅ agent_transactions table created
-- ✅ agents table created
-- ✅ agent_floats table created
-- ✅ agent_settlements table created
-- ✅ Indexes created for performance
-- ✅ RLS policies enabled
-- ✅ Database ready for agent operations
-- 
-- Next steps:
-- 1. Refresh your browser to reload the app
-- 2. Create an agent profile from the UI
-- 3. Set up initial float balances
-- 4. Start processing transactions
