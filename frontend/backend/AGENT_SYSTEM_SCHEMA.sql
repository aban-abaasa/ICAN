-- 🏪 AGENT OPERATIONS SYSTEM - DATABASE SCHEMA
-- Dual-Currency Terminal for Agents (UGX & USD)
-- Run this in Supabase SQL Editor

-- ============================================
-- 1️⃣ AGENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    
    -- Agent Details
    agent_name TEXT NOT NULL,
    agent_code TEXT UNIQUE NOT NULL, -- e.g., AGENT-001, AGENT-UGX-KLA
    phone_number TEXT NOT NULL,
    email TEXT,
    
    -- Location
    location_name TEXT,
    location_city TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    
    -- Status
    status TEXT DEFAULT 'active', -- 'active', 'inactive', 'suspended', 'pending_approval'
    is_verified BOOLEAN DEFAULT false,
    
    -- Commission Settings
    deposit_commission_percentage DECIMAL(5, 2) DEFAULT 0, -- 0% to encourage deposits
    withdrawal_commission_percentage DECIMAL(5, 2) DEFAULT 2.5, -- Agent & Aban share
    fx_margin_percentage DECIMAL(5, 2) DEFAULT 1.5, -- FX conversion margin
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE,
    verified_at TIMESTAMP WITH TIME ZONE,
    last_activity_at TIMESTAMP WITH TIME ZONE
);

-- ============================================
-- 2️⃣ AGENT FLOAT ACCOUNTS (Dual Currency)
-- ============================================
CREATE TABLE IF NOT EXISTS public.agent_floats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
    
    -- Separate ledgers for USD and UGX
    currency TEXT NOT NULL, -- 'USD', 'UGX'
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

-- ============================================
-- 3️⃣ AGENT TRANSACTIONS
-- ============================================
CREATE TABLE IF NOT EXISTS public.agent_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    
    -- Transaction Type
    transaction_type TEXT NOT NULL, -- 'cash_in', 'cash_out', 'float_topup', 'adjustment'
    
    -- Amounts
    amount DECIMAL(18, 8) NOT NULL,
    currency TEXT NOT NULL, -- 'USD', 'UGX'
    commission_amount DECIMAL(18, 8) DEFAULT 0,
    net_amount DECIMAL(18, 8),
    
    -- References
    user_account_id TEXT, -- Which customer account
    momo_transaction_id TEXT,
    reference_number TEXT UNIQUE, -- e.g., TXN-20250120-001
    
    -- Status
    status TEXT DEFAULT 'pending', -- 'pending', 'completed', 'failed', 'reversed'
    
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

-- ============================================
-- 4️⃣ AGENT SETTLEMENTS (Daily/Shift Reports)
-- ============================================
CREATE TABLE IF NOT EXISTS public.agent_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
    
    -- Period
    settlement_date DATE NOT NULL,
    shift_number INTEGER DEFAULT 1, -- Morning, Afternoon, Evening
    shift_start_time TIME,
    shift_end_time TIME,
    
    -- USD Ledger
    usd_opening_balance DECIMAL(18, 8),
    usd_cash_in_total DECIMAL(18, 8) DEFAULT 0,
    usd_cash_out_total DECIMAL(18, 8) DEFAULT 0,
    usd_closing_balance DECIMAL(18, 8),
    usd_variance DECIMAL(18, 8), -- Difference between expected and actual
    
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
    status TEXT DEFAULT 'open', -- 'open', 'submitted', 'verified', 'closed'
    notes TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    submitted_at TIMESTAMP WITH TIME ZONE,
    verified_at TIMESTAMP WITH TIME ZONE
);

-- ============================================
-- 5️⃣ ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- Agents table RLS
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

-- Allow users to view their own agent profile
CREATE POLICY "Agents can view own profile"
    ON public.agents FOR SELECT
    USING (user_id = auth.uid());

-- Allow users to create their own agent account
CREATE POLICY "Users can create own agent account"
    ON public.agents FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- Allow users to update their own agent profile
CREATE POLICY "Agents can update own profile"
    ON public.agents FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Allow admins to view all agents
CREATE POLICY "Admins can view all agents"
    ON public.agents FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role = 'admin'
    ));

-- Agent floats RLS
ALTER TABLE public.agent_floats ENABLE ROW LEVEL SECURITY;

-- Allow agents to view own float
CREATE POLICY "Agents can view own float"
    ON public.agent_floats FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.agents
        WHERE id = agent_id AND user_id = auth.uid()
    ));

-- Allow agents to create float accounts during registration
CREATE POLICY "Agents can create own float accounts"
    ON public.agent_floats FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.agents
        WHERE id = agent_id AND user_id = auth.uid()
    ));

-- Allow agents to update own float (balance changes)
CREATE POLICY "Agents can update own float"
    ON public.agent_floats FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM public.agents
        WHERE id = agent_id AND user_id = auth.uid()
    ));

-- Agent transactions RLS
ALTER TABLE public.agent_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents can view own transactions"
    ON public.agent_transactions FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.agents
        WHERE id = agent_id AND user_id = auth.uid()
    ));

CREATE POLICY "Agents can insert own transactions"
    ON public.agent_transactions FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.agents
        WHERE id = agent_id AND user_id = auth.uid()
    ));

-- Agent settlements RLS
ALTER TABLE public.agent_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents can view own settlements"
    ON public.agent_settlements FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.agents
        WHERE id = agent_id AND user_id = auth.uid()
    ));

CREATE POLICY "Agents can create own settlements"
    ON public.agent_settlements FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.agents
        WHERE id = agent_id AND user_id = auth.uid()
    ));

-- ============================================
-- 6️⃣ INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX idx_agents_user_id ON public.agents(user_id);
CREATE INDEX idx_agents_status ON public.agents(status);
CREATE INDEX idx_agents_location ON public.agents(location_city);

CREATE INDEX idx_agent_floats_agent_id ON public.agent_floats(agent_id);
CREATE INDEX idx_agent_floats_currency ON public.agent_floats(currency);
CREATE INDEX idx_agent_floats_balance ON public.agent_floats(current_balance);

CREATE INDEX idx_agent_transactions_agent_id ON public.agent_transactions(agent_id);
CREATE INDEX idx_agent_transactions_user_id ON public.agent_transactions(user_id);
CREATE INDEX idx_agent_transactions_type ON public.agent_transactions(transaction_type);
CREATE INDEX idx_agent_transactions_status ON public.agent_transactions(status);
CREATE INDEX idx_agent_transactions_created ON public.agent_transactions(created_at);

CREATE INDEX idx_agent_settlements_agent_id ON public.agent_settlements(agent_id);
CREATE INDEX idx_agent_settlements_date ON public.agent_settlements(settlement_date);

-- ============================================
-- 7️⃣ VERIFY CREATION
-- ============================================

SELECT 
    table_name,
    'Created ✅' AS status
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('agents', 'agent_floats', 'agent_transactions', 'agent_settlements');
