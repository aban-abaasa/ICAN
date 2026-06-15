-- =============================================
-- RECREATE ICAN USER WALLETS TABLE (FIX)
-- Drop and recreate with correct UNIQUE constraint on user_id
-- =============================================

-- Drop old table completely
DROP TABLE IF EXISTS public.ican_user_wallets CASCADE;

-- =============================================
-- CREATE ICAN USER WALLETS TABLE (CORRECTED)
-- =============================================
CREATE TABLE public.ican_user_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Wallet details
    wallet_address TEXT NOT NULL UNIQUE,
    ican_balance DECIMAL(18, 8) DEFAULT 0,
    
    -- Financial tracking
    total_spent DECIMAL(18, 8) DEFAULT 0,
    total_earned DECIMAL(18, 8) DEFAULT 0,
    purchase_count INTEGER DEFAULT 0,
    sale_count INTEGER DEFAULT 0,
    
    -- Security
    private_key_encrypted TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    
    -- Status
    status TEXT DEFAULT 'active',
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ican_user_wallets_user_id ON public.ican_user_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_ican_user_wallets_wallet_address ON public.ican_user_wallets(wallet_address);
CREATE INDEX IF NOT EXISTS idx_ican_user_wallets_is_verified ON public.ican_user_wallets(is_verified);

-- Enable Row Level Security
ALTER TABLE public.ican_user_wallets ENABLE ROW LEVEL SECURITY;

-- =============================================
-- RLS POLICIES
-- =============================================

-- Users can view their own wallets
CREATE POLICY "Users can view their own wallets" 
    ON public.ican_user_wallets FOR SELECT 
    USING (auth.uid() = user_id);

-- Users can insert their own wallets
CREATE POLICY "Users can insert their own wallets"
    ON public.ican_user_wallets FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own wallets
CREATE POLICY "Users can update their own wallets"
    ON public.ican_user_wallets FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- =============================================
-- VERIFICATION
-- =============================================
SELECT '✅ ICAN User Wallets Table RECREATED with correct schema!' as status;

-- Verify constraints
SELECT
    constraint_name,
    constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'ican_user_wallets'
ORDER BY constraint_name;

SELECT '✅ All constraints in place for upsert on user_id' as check_result;
