-- =============================================
-- ICAN CAPITAL ENGINE TABLES
-- Shared Supabase database with FARM-AGENT
-- For blockchain integration
-- =============================================

-- =============================================
-- ICAN TRANSACTIONS TABLE
-- Financial transactions for Capital Engine
-- =============================================
CREATE TABLE IF NOT EXISTS public.ican_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    
    -- Transaction details
    transaction_type TEXT NOT NULL, -- 'deposit', 'withdrawal', 'transfer', 'investment'
    amount DECIMAL(18, 8) NOT NULL,
    currency TEXT DEFAULT 'USD',
    description TEXT,
    
    -- Status tracking
    status TEXT DEFAULT 'pending', -- 'pending', 'completed', 'failed', 'cancelled'
    
    -- Blockchain sync
    blockchain_status TEXT DEFAULT 'not_synced', -- 'not_synced', 'pending', 'synced', 'failed'
    blockchain_tx_hash TEXT,
    blockchain_block_number BIGINT,
    blockchain_network TEXT DEFAULT 'ethereum',
    blockchain_synced_at TIMESTAMP WITH TIME ZONE,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.ican_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own transactions" 
    ON public.ican_transactions FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own transactions" 
    ON public.ican_transactions FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own pending transactions" 
    ON public.ican_transactions FOR UPDATE 
    USING (auth.uid() = user_id AND status = 'pending');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ican_transactions_user_id ON public.ican_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_ican_transactions_blockchain_status ON public.ican_transactions(blockchain_status);
CREATE INDEX IF NOT EXISTS idx_ican_transactions_status ON public.ican_transactions(status);


-- =============================================
-- ICAN CONTRACT ANALYSES TABLE
-- AI-powered contract vetting results
-- =============================================
CREATE TABLE IF NOT EXISTS public.ican_contract_analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    
    -- Contract data
    contract_hash TEXT NOT NULL UNIQUE, -- SHA256 hash of contract
    contract_text_encrypted TEXT, -- Encrypted contract text
    
    -- Analysis results
    safety_score INTEGER CHECK (safety_score >= 0 AND safety_score <= 100),
    risk_level TEXT, -- 'low', 'medium', 'high', 'critical'
    liability_flags JSONB DEFAULT '[]',
    recommendations JSONB DEFAULT '[]',
    legal_insights JSONB DEFAULT '{}',
    
    -- AI metadata
    ai_model_version TEXT,
    analysis_duration_ms INTEGER,
    
    -- Security
    biometric_verified BOOLEAN DEFAULT FALSE,
    
    -- Blockchain sync
    blockchain_status TEXT DEFAULT 'not_synced',
    blockchain_tx_hash TEXT,
    blockchain_block_number BIGINT,
    blockchain_synced_at TIMESTAMP WITH TIME ZONE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.ican_contract_analyses ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own contract analyses" 
    ON public.ican_contract_analyses FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create contract analyses" 
    ON public.ican_contract_analyses FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ican_contracts_user_id ON public.ican_contract_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_ican_contracts_hash ON public.ican_contract_analyses(contract_hash);
CREATE INDEX IF NOT EXISTS idx_ican_contracts_blockchain_status ON public.ican_contract_analyses(blockchain_status);


-- =============================================
-- ICAN USER WALLETS TABLE
-- Cryptocurrency wallet addresses for users
-- =============================================
CREATE TABLE IF NOT EXISTS public.ican_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    
    -- Wallet details
    wallet_address TEXT NOT NULL,
    wallet_type TEXT DEFAULT 'ethereum', -- 'ethereum', 'polygon', 'solana', etc.
    is_primary BOOLEAN DEFAULT FALSE,
    is_verified BOOLEAN DEFAULT FALSE,
    
    -- Security
    verification_signature TEXT,
    verified_at TIMESTAMP WITH TIME ZONE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE,
    
    UNIQUE(user_id, wallet_address)
);

-- Enable RLS
ALTER TABLE public.ican_wallets ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own wallets" 
    ON public.ican_wallets FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own wallets" 
    ON public.ican_wallets FOR ALL 
    USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ican_wallets_user_id ON public.ican_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_ican_wallets_address ON public.ican_wallets(wallet_address);


-- =============================================
-- BLOCKCHAIN SYNC LOG TABLE
-- Shared table for tracking blockchain sync across both apps
-- =============================================
CREATE TABLE IF NOT EXISTS public.blockchain_sync_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Record reference
    sync_type TEXT NOT NULL, -- 'transaction', 'contract', 'listing', 'profile'
    record_id UUID NOT NULL,
    record_table TEXT NOT NULL,
    
    -- Data integrity
    data_hash TEXT NOT NULL, -- Hash of data being synced
    
    -- Blockchain details
    blockchain_network TEXT DEFAULT 'ethereum',
    tx_hash TEXT,
    block_number BIGINT,
    gas_used BIGINT,
    
    -- Status
    status TEXT DEFAULT 'pending', -- 'pending', 'submitted', 'confirmed', 'failed'
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    submitted_at TIMESTAMP WITH TIME ZONE,
    confirmed_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.blockchain_sync_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies (Admin only for sync logs)
CREATE POLICY "Service role can manage sync logs" 
    ON public.blockchain_sync_log FOR ALL 
    USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_blockchain_sync_status ON public.blockchain_sync_log(status);
CREATE INDEX IF NOT EXISTS idx_blockchain_sync_record ON public.blockchain_sync_log(record_table, record_id);
CREATE INDEX IF NOT EXISTS idx_blockchain_sync_tx_hash ON public.blockchain_sync_log(tx_hash);


-- =============================================
-- ADD BLOCKCHAIN COLUMNS TO FARM-AGENT TABLES
-- =============================================

-- Add blockchain sync column to marketplace_listings if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'marketplace_listings' 
        AND column_name = 'blockchain_synced'
    ) THEN
        ALTER TABLE public.marketplace_listings 
        ADD COLUMN blockchain_synced BOOLEAN DEFAULT FALSE,
        ADD COLUMN blockchain_tx_hash TEXT,
        ADD COLUMN blockchain_synced_at TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- Add blockchain sync column to profiles if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'blockchain_verified'
    ) THEN
        ALTER TABLE public.profiles 
        ADD COLUMN blockchain_verified BOOLEAN DEFAULT FALSE,
        ADD COLUMN blockchain_wallet_address TEXT,
        ADD COLUMN blockchain_verified_at TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;


-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Function to get user's blockchain readiness score
CREATE OR REPLACE FUNCTION get_blockchain_readiness(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    profile_complete BOOLEAN;
    has_wallet BOOLEAN;
    tx_count INTEGER;
BEGIN
    -- Check profile completeness
    SELECT 
        (first_name IS NOT NULL AND last_name IS NOT NULL AND is_verified = true)
    INTO profile_complete
    FROM public.profiles
    WHERE id = p_user_id;
    
    -- Check if user has verified wallet
    SELECT EXISTS(
        SELECT 1 FROM public.ican_wallets 
        WHERE user_id = p_user_id AND is_verified = true
    ) INTO has_wallet;
    
    -- Count transactions
    SELECT COUNT(*) INTO tx_count
    FROM public.ican_transactions
    WHERE user_id = p_user_id AND status = 'completed';
    
    result := jsonb_build_object(
        'profileComplete', COALESCE(profile_complete, false),
        'hasVerifiedWallet', has_wallet,
        'transactionCount', tx_count,
        'readinessScore', 
            CASE 
                WHEN profile_complete AND has_wallet THEN 100
                WHEN profile_complete THEN 50
                WHEN has_wallet THEN 30
                ELSE 10
            END
    );
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
