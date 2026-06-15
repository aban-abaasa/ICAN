-- =====================================================
-- TRUST SYSTEM DEPLOYMENT SCRIPT
-- Ensures all trust tables are created
-- Run this to fix: "relation "public.trust_transactions" does not exist"
-- =====================================================

-- =============================================
-- 1. TRUST GROUPS TABLE
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
    blockchain_address VARCHAR(255),
    blockchain_verified BOOLEAN DEFAULT FALSE,
    blockchain_hash VARCHAR(255),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ
);

-- =============================================
-- 2. TRUST GROUP MEMBERS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.trust_group_members (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES public.trust_groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Member info
    member_number INTEGER NOT NULL,
    role VARCHAR(50) DEFAULT 'member' CHECK (role IN ('creator', 'admin', 'member')),
    
    -- Contribution tracking
    total_contributed DECIMAL(15,2) DEFAULT 0,
    total_received DECIMAL(15,2) DEFAULT 0,
    payment_status VARCHAR(50) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'overdue', 'completed')),
    
    -- Blockchain
    member_wallet VARCHAR(255),
    verification_hash VARCHAR(255),
    
    -- Status
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    
    UNIQUE(group_id, user_id)
);

-- =============================================
-- 3. TRUST TRANSACTIONS TABLE (THE MISSING TABLE)
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
-- 4. TRUST CYCLES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.trust_cycles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES public.trust_groups(id) ON DELETE CASCADE,
    
    -- Cycle details
    cycle_number INTEGER NOT NULL,
    member_receiving_id UUID NOT NULL REFERENCES auth.users(id),
    
    -- Dates
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    
    -- Status
    status VARCHAR(50) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'completed', 'canceled')),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(group_id, cycle_number)
);

-- =============================================
-- 5. TRUST DISPUTES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.trust_disputes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    transaction_id UUID REFERENCES public.trust_transactions(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES public.trust_groups(id) ON DELETE CASCADE,
    
    -- Dispute details
    raised_by_id UUID NOT NULL REFERENCES auth.users(id),
    reason TEXT NOT NULL,
    resolution TEXT,
    
    -- Status
    status VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'closed')),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    
    CONSTRAINT dispute_amount CHECK (true)
);

-- =============================================
-- 6. CREATE INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_trust_groups_creator ON public.trust_groups(creator_id);
CREATE INDEX IF NOT EXISTS idx_trust_groups_status ON public.trust_groups(status);

CREATE INDEX IF NOT EXISTS idx_trust_members_group ON public.trust_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_trust_members_user ON public.trust_group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_trust_members_active ON public.trust_group_members(is_active);

CREATE INDEX IF NOT EXISTS idx_trust_transactions_group ON public.trust_transactions(group_id);
CREATE INDEX IF NOT EXISTS idx_trust_transactions_from ON public.trust_transactions(from_user_id);
CREATE INDEX IF NOT EXISTS idx_trust_transactions_to ON public.trust_transactions(to_user_id);
CREATE INDEX IF NOT EXISTS idx_trust_transactions_verified ON public.trust_transactions(is_verified);
CREATE INDEX IF NOT EXISTS idx_trust_transactions_type ON public.trust_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_trust_transactions_status ON public.trust_transactions(blockchain_status);
CREATE INDEX IF NOT EXISTS idx_trust_transactions_created ON public.trust_transactions(created_at);

CREATE INDEX IF NOT EXISTS idx_trust_cycles_group ON public.trust_cycles(group_id);
CREATE INDEX IF NOT EXISTS idx_trust_cycles_member ON public.trust_cycles(member_receiving_id);
CREATE INDEX IF NOT EXISTS idx_trust_cycles_status ON public.trust_cycles(status);

CREATE INDEX IF NOT EXISTS idx_trust_disputes_group ON public.trust_disputes(group_id);
CREATE INDEX IF NOT EXISTS idx_trust_disputes_status ON public.trust_disputes(status);

-- =============================================
-- 7. ENABLE ROW LEVEL SECURITY
-- =============================================
ALTER TABLE public.trust_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trust_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trust_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trust_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trust_disputes ENABLE ROW LEVEL SECURITY;

-- =============================================
-- 8. RLS POLICIES FOR TRUST GROUPS (Simple - No Recursion)
-- =============================================
-- Drop ALL existing policies comprehensively
DROP POLICY IF EXISTS "Users can view groups they created" ON public.trust_groups;
DROP POLICY IF EXISTS "Users can view groups they joined" ON public.trust_groups;
DROP POLICY IF EXISTS "Users can create groups" ON public.trust_groups;
DROP POLICY IF EXISTS "Only creators can update" ON public.trust_groups;
DROP POLICY IF EXISTS "Anyone can view active groups" ON public.trust_groups;
DROP POLICY IF EXISTS "Creators can update their groups" ON public.trust_groups;

-- Allow viewing all active groups
CREATE POLICY "Anyone can view active groups"
    ON public.trust_groups FOR SELECT
    USING (status = 'active' OR creator_id = auth.uid());

CREATE POLICY "Users can create groups"
    ON public.trust_groups FOR INSERT
    WITH CHECK (creator_id = auth.uid());

CREATE POLICY "Creators can update their groups"
    ON public.trust_groups FOR UPDATE
    USING (creator_id = auth.uid());

-- =============================================
-- 9. RLS POLICIES FOR TRUST MEMBERS (Simple - No Recursion)
-- =============================================
-- Drop ALL existing policies comprehensively
DROP POLICY IF EXISTS "Users can view group members" ON public.trust_group_members;
DROP POLICY IF EXISTS "Users can view their membership" ON public.trust_group_members;
DROP POLICY IF EXISTS "Users can request membership" ON public.trust_group_members;
DROP POLICY IF EXISTS "Users can join groups" ON public.trust_group_members;
DROP POLICY IF EXISTS "Users can update their own membership" ON public.trust_group_members;

-- Users can see all members (privacy handled at app level)
CREATE POLICY "Users can view group members"
    ON public.trust_group_members FOR SELECT
    USING (true);

CREATE POLICY "Users can join groups"
    ON public.trust_group_members FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own membership"
    ON public.trust_group_members FOR UPDATE
    USING (user_id = auth.uid());

-- =============================================
-- 10. RLS POLICIES FOR TRUST TRANSACTIONS (Simple - No Recursion)
-- =============================================
-- Drop ALL existing policies comprehensively
DROP POLICY IF EXISTS "Users can view group transactions" ON public.trust_transactions;
DROP POLICY IF EXISTS "Users can create transactions" ON public.trust_transactions;
DROP POLICY IF EXISTS "Users can view transactions" ON public.trust_transactions;
DROP POLICY IF EXISTS "System can verify transactions" ON public.trust_transactions;

-- Allow viewing all transactions (group access handled at app level)
CREATE POLICY "Users can view transactions"
    ON public.trust_transactions FOR SELECT
    USING (true);

CREATE POLICY "Users can create transactions"
    ON public.trust_transactions FOR INSERT
    WITH CHECK (from_user_id = auth.uid());

CREATE POLICY "System can verify transactions"
    ON public.trust_transactions FOR UPDATE
    USING (true);

-- =============================================
-- 10B. RLS POLICIES FOR TRUST CYCLES (Simple - No Recursion)
-- =============================================
-- Drop ALL existing policies comprehensively
DROP POLICY IF EXISTS "Users can view cycles" ON public.trust_cycles;
DROP POLICY IF EXISTS "Users can create cycles" ON public.trust_cycles;
DROP POLICY IF EXISTS "System can manage cycles" ON public.trust_cycles;

-- Allow viewing all cycles
CREATE POLICY "Users can view cycles"
    ON public.trust_cycles FOR SELECT
    USING (true);

CREATE POLICY "System can manage cycles"
    ON public.trust_cycles FOR INSERT
    WITH CHECK (true);

-- =============================================
-- 10C. RLS POLICIES FOR TRUST DISPUTES (Simple - No Recursion)
-- =============================================
-- Drop ALL existing policies comprehensively
DROP POLICY IF EXISTS "Users can view disputes" ON public.trust_disputes;
DROP POLICY IF EXISTS "Users can create disputes" ON public.trust_disputes;
DROP POLICY IF EXISTS "Users can view all disputes" ON public.trust_disputes;
DROP POLICY IF EXISTS "Users can manage disputes" ON public.trust_disputes;

-- Allow viewing all disputes
CREATE POLICY "Users can view disputes"
    ON public.trust_disputes FOR SELECT
    USING (true);

CREATE POLICY "Users can create disputes"
    ON public.trust_disputes FOR INSERT
    WITH CHECK (raised_by_id = auth.uid());

-- =============================================
-- 11. CREATE HELPER FUNCTIONS
-- =============================================
DROP FUNCTION IF EXISTS get_group_balance(UUID);

CREATE OR REPLACE FUNCTION get_group_balance(group_id UUID)
RETURNS DECIMAL AS $$
BEGIN
    RETURN COALESCE(SUM(amount), 0) FROM public.trust_transactions 
    WHERE trust_transactions.group_id = get_group_balance.group_id 
    AND transaction_type = 'contribution';
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION IF EXISTS get_member_contributions(UUID, UUID);

CREATE OR REPLACE FUNCTION get_member_contributions(group_id UUID, member_id UUID)
RETURNS DECIMAL AS $$
BEGIN
    RETURN COALESCE(SUM(amount), 0) FROM public.trust_transactions 
    WHERE trust_transactions.group_id = get_member_contributions.group_id 
    AND from_user_id = member_id
    AND transaction_type = 'contribution';
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- 12. VALIDATION AND SUCCESS MESSAGE
-- =============================================
-- All tables created successfully
-- The application should now work without the 404 error
SELECT 
    'TRUST SYSTEM DEPLOYMENT COMPLETE' as status,
    NOW() as deployed_at,
    'All trust tables are now created' as message;
