-- =============================================
-- DEPLOY ICAN COIN TRANSACTIONS TABLE
-- Run this script in Supabase SQL Editor to create the table
-- =============================================

-- Drop table if exists to ensure fresh creation
DROP TABLE IF EXISTS public.ican_coin_transactions CASCADE;

-- =============================================
-- CREATE ICAN COIN TRANSACTIONS TABLE
-- =============================================
CREATE TABLE public.ican_coin_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Transaction details
    type TEXT NOT NULL, -- 'purchase', 'sale', 'transfer', 'reward'
    ican_amount DECIMAL(18, 8) NOT NULL,
    local_amount DECIMAL(18, 8) NOT NULL,
    country_code TEXT,
    currency TEXT, -- 'UGX', 'KES', 'USD', etc.
    
    -- Pricing
    price_per_coin DECIMAL(18, 8),
    exchange_rate DECIMAL(18, 8),
    
    -- Payment details
    payment_method TEXT, -- 'card', 'momo', 'bank_transfer'
    
    -- Status
    status TEXT DEFAULT 'pending', -- 'pending', 'completed', 'failed'
    
    -- User relationships (for transfers)
    sender_user_id UUID REFERENCES auth.users(id),
    recipient_user_id UUID REFERENCES auth.users(id),
    
    -- Timestamp
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ican_coin_tx_user_id ON public.ican_coin_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_ican_coin_tx_type ON public.ican_coin_transactions(type);
CREATE INDEX IF NOT EXISTS idx_ican_coin_tx_status ON public.ican_coin_transactions(status);
CREATE INDEX IF NOT EXISTS idx_ican_coin_tx_currency ON public.ican_coin_transactions(currency);
CREATE INDEX IF NOT EXISTS idx_ican_coin_tx_timestamp ON public.ican_coin_transactions(timestamp);

-- Enable Row Level Security
ALTER TABLE public.ican_coin_transactions ENABLE ROW LEVEL SECURITY;

-- =============================================
-- RLS POLICIES
-- =============================================

-- Users can view their own transactions
CREATE POLICY "Users can view their own coin transactions" 
    ON public.ican_coin_transactions FOR SELECT 
    USING (auth.uid() = user_id OR auth.uid() = sender_user_id OR auth.uid() = recipient_user_id);

-- Users can create transactions
CREATE POLICY "Users can create coin transactions" 
    ON public.ican_coin_transactions FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

-- =============================================
-- VERIFICATION
-- =============================================
SELECT '✅ ICAN Coin Transactions Table Created!' as status;
SELECT 
    tablename,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = tablename) as column_count
FROM pg_tables 
WHERE tablename = 'ican_coin_transactions';
