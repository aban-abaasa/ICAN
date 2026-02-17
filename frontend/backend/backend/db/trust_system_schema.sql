-- =============================================
-- TRUST SYSTEM SCHEMA
-- Cooperative Savings & Blockchain Verification
-- =============================================

-- =============================================
-- TRUST GROUPS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.trust_groups (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    creator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Group settings
    max_members INTEGER DEFAULT 30,
    monthly_contribution DECIMAL(15,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    
    -- Status
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'archived')),
    
    -- Blockchain
    blockchain_address VARCHAR(255), -- Crypto wallet address
    blockchain_verified BOOLEAN DEFAULT FALSE,
    blockchain_hash VARCHAR(255), -- Transaction hash
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ
);

-- =============================================
-- TRUST GROUP MEMBERS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.trust_group_members (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES public.trust_groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Member info
    member_number INTEGER NOT NULL, -- Order in group (1-30)
    role VARCHAR(50) DEFAULT 'member' CHECK (role IN ('creator', 'admin', 'member')),
    
    -- Contribution tracking
    total_contributed DECIMAL(15,2) DEFAULT 0,
    total_received DECIMAL(15,2) DEFAULT 0,
    payment_status VARCHAR(50) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'overdue', 'completed')),
    
    -- Blockchain
    member_wallet VARCHAR(255), -- Personal crypto wallet
    verification_hash VARCHAR(255),
    
    -- Status
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    
    UNIQUE(group_id, user_id)
);

-- =============================================
-- TRUST TRANSACTIONS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.trust_transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES public.trust_groups(id) ON DELETE CASCADE,
    from_user_id UUID NOT NULL REFERENCES auth.users(id),
    to_user_id UUID NOT NULL REFERENCES auth.users(id),
    
    -- Transaction details
    amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    transaction_type VARCHAR(50) CHECK (transaction_type IN ('contribution', 'payout', 'penalty', 'refund')),
    description TEXT,
    
    -- Blockchain verification
    blockchain_hash VARCHAR(255),
    blockchain_status VARCHAR(50) DEFAULT 'pending' CHECK (blockchain_status IN ('pending', 'confirmed', 'failed')),
    is_verified BOOLEAN DEFAULT FALSE,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    verified_at TIMESTAMPTZ
);

-- =============================================
-- TRUST CYCLES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.trust_cycles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES public.trust_groups(id) ON DELETE CASCADE,
    
    -- Cycle details
    cycle_number INTEGER NOT NULL,
    member_receiving_id UUID NOT NULL REFERENCES auth.users(id),
    
    -- Dates
    cycle_start TIMESTAMPTZ NOT NULL,
    cycle_end TIMESTAMPTZ NOT NULL,
    due_date TIMESTAMPTZ NOT NULL,
    
    -- Status
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'delayed')),
    total_amount_due DECIMAL(15,2) NOT NULL,
    amount_collected DECIMAL(15,2) DEFAULT 0,
    
    -- Blockchain
    cycle_hash VARCHAR(255),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(group_id, cycle_number)
);

-- =============================================
-- TRUST DISPUTES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.trust_disputes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES public.trust_groups(id) ON DELETE CASCADE,
    transaction_id UUID REFERENCES public.trust_transactions(id),
    
    -- Dispute info
    raised_by_id UUID NOT NULL REFERENCES auth.users(id),
    description TEXT NOT NULL,
    evidence_url VARCHAR(255),
    
    -- Resolution
    status VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'rejected', 'escalated')),
    resolution_notes TEXT,
    resolved_by_id UUID REFERENCES auth.users(id),
    
    -- Blockchain
    dispute_hash VARCHAR(255),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_trust_groups_creator ON public.trust_groups(creator_id);
CREATE INDEX IF NOT EXISTS idx_trust_groups_status ON public.trust_groups(status);
CREATE INDEX IF NOT EXISTS idx_trust_members_group ON public.trust_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_trust_members_user ON public.trust_group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_trust_transactions_group ON public.trust_transactions(group_id);
CREATE INDEX IF NOT EXISTS idx_trust_transactions_verified ON public.trust_transactions(is_verified);
CREATE INDEX IF NOT EXISTS idx_trust_cycles_group ON public.trust_cycles(group_id);
CREATE INDEX IF NOT EXISTS idx_trust_disputes_group ON public.trust_disputes(group_id);

-- =============================================
-- RLS POLICIES
-- =============================================

ALTER TABLE public.trust_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trust_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trust_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trust_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trust_disputes ENABLE ROW LEVEL SECURITY;

-- Trust Groups Policies
DROP POLICY IF EXISTS "Anyone can view active trust groups" ON public.trust_groups;
DROP POLICY IF EXISTS "Users can view their groups" ON public.trust_groups;
DROP POLICY IF EXISTS "Users can create groups" ON public.trust_groups;
DROP POLICY IF EXISTS "Creators can update their groups" ON public.trust_groups;

CREATE POLICY "Anyone can view active trust groups" 
    ON public.trust_groups FOR SELECT 
    USING (status = 'active');

CREATE POLICY "Users can view their groups" 
    ON public.trust_groups FOR SELECT 
    USING (creator_id = auth.uid() OR id IN (
        SELECT group_id FROM public.trust_group_members WHERE user_id = auth.uid()
    ));

CREATE POLICY "Users can create groups" 
    ON public.trust_groups FOR INSERT 
    WITH CHECK (creator_id = auth.uid());

CREATE POLICY "Creators can update their groups" 
    ON public.trust_groups FOR UPDATE 
    USING (creator_id = auth.uid());

-- Trust Members Policies
DROP POLICY IF EXISTS "Users can view group members" ON public.trust_group_members;
DROP POLICY IF EXISTS "Users can join groups" ON public.trust_group_members;

CREATE POLICY "Users can view group members" 
    ON public.trust_group_members FOR SELECT 
    USING (true);

CREATE POLICY "Users can join groups" 
    ON public.trust_group_members FOR INSERT 
    WITH CHECK (auth.uid() IS NOT NULL);

-- Transactions Policies
DROP POLICY IF EXISTS "Users can view group transactions" ON public.trust_transactions;
DROP POLICY IF EXISTS "Users can create transactions" ON public.trust_transactions;

CREATE POLICY "Users can view group transactions" 
    ON public.trust_transactions FOR SELECT 
    USING (true);

CREATE POLICY "Users can create transactions" 
    ON public.trust_transactions FOR INSERT 
    WITH CHECK (auth.uid() IS NOT NULL);

-- Cycles Policies
DROP POLICY IF EXISTS "Users can view cycles" ON public.trust_cycles;

CREATE POLICY "Users can view cycles" 
    ON public.trust_cycles FOR SELECT 
    USING (true);

-- Disputes Policies
DROP POLICY IF EXISTS "Users can view disputes" ON public.trust_disputes;
DROP POLICY IF EXISTS "Users can create disputes" ON public.trust_disputes;

CREATE POLICY "Users can view disputes" 
    ON public.trust_disputes FOR SELECT 
    USING (true);

CREATE POLICY "Users can create disputes" 
    ON public.trust_disputes FOR INSERT 
    WITH CHECK (auth.uid() IS NOT NULL);

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Get member count for a group
CREATE OR REPLACE FUNCTION public.get_group_member_count(group_id UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN (SELECT COUNT(*) FROM public.trust_group_members WHERE trust_group_members.group_id = get_group_member_count.group_id AND is_active = true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Calculate group balance
CREATE OR REPLACE FUNCTION public.get_group_balance(group_id UUID)
RETURNS DECIMAL AS $$
BEGIN
  RETURN (
    SELECT COALESCE(SUM(amount), 0) FROM public.trust_transactions 
    WHERE trust_transactions.group_id = get_group_balance.group_id 
    AND transaction_type = 'contribution'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- VERIFY
-- =============================================
SELECT '✅ TRUST System Schema Created!' as status;
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name LIKE 'trust_%';
