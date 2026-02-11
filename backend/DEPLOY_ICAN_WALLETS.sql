-- =============================================
-- DEPLOY ICAN WALLETS TABLE
-- Run this script in Supabase SQL Editor to create the table
-- =============================================

-- =============================================
-- CREATE ICAN WALLETS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.ican_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
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
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id, wallet_address)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ican_wallets_user_id ON public.ican_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_ican_wallets_is_primary ON public.ican_wallets(is_primary);
CREATE INDEX IF NOT EXISTS idx_ican_wallets_is_verified ON public.ican_wallets(is_verified);
CREATE INDEX IF NOT EXISTS idx_ican_wallets_wallet_address ON public.ican_wallets(wallet_address);

-- Enable Row Level Security
ALTER TABLE public.ican_wallets ENABLE ROW LEVEL SECURITY;

-- =============================================
-- RLS POLICIES
-- =============================================

-- Users can view their own wallets
DROP POLICY IF EXISTS "Users can view their own wallets" ON public.ican_wallets;
CREATE POLICY "Users can view their own wallets" 
    ON public.ican_wallets FOR SELECT 
    USING (auth.uid() = user_id);

-- Users can manage their own wallets
DROP POLICY IF EXISTS "Users can manage their own wallets" ON public.ican_wallets;
CREATE POLICY "Users can manage their own wallets" 
    ON public.ican_wallets FOR ALL 
    USING (auth.uid() = user_id);

-- =============================================
-- VERIFICATION
-- =============================================
SELECT '✅ ICAN Wallets Table Created!' as status;
SELECT 
    tablename,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = tablename) as column_count
FROM pg_tables 
WHERE tablename = 'ican_wallets';
