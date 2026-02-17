-- =============================================
-- DEPLOY ICAN TRANSACTIONS TABLE
-- Run this script in Supabase SQL Editor to create the table
-- =============================================

-- =============================================
-- CREATE ICAN TRANSACTIONS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.ican_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Transaction details
    transaction_type TEXT NOT NULL, -- 'deposit', 'withdrawal', 'transfer', 'investment'
    amount DECIMAL(18, 8) NOT NULL,
    currency TEXT DEFAULT 'ICAN',
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
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ican_transactions_user_id ON public.ican_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_ican_transactions_blockchain_status ON public.ican_transactions(blockchain_status);
CREATE INDEX IF NOT EXISTS idx_ican_transactions_status ON public.ican_transactions(status);
CREATE INDEX IF NOT EXISTS idx_ican_transactions_type ON public.ican_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_ican_transactions_currency ON public.ican_transactions(currency);

-- Enable Row Level Security
ALTER TABLE public.ican_transactions ENABLE ROW LEVEL SECURITY;

-- =============================================
-- RLS POLICIES
-- =============================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own transactions" ON public.ican_transactions;
DROP POLICY IF EXISTS "Users can create their own transactions" ON public.ican_transactions;
DROP POLICY IF EXISTS "Users can update their own pending transactions" ON public.ican_transactions;

-- Users can view their own transactions
CREATE POLICY "Users can view their own transactions" 
    ON public.ican_transactions FOR SELECT 
    USING (auth.uid() = user_id);

-- Users can create their own transactions
CREATE POLICY "Users can create their own transactions" 
    ON public.ican_transactions FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own pending transactions
CREATE POLICY "Users can update their own pending transactions" 
    ON public.ican_transactions FOR UPDATE 
    USING (auth.uid() = user_id AND status = 'pending');

-- =============================================
-- VERIFICATION
-- =============================================
SELECT '✅ ICAN Transactions Table Created!' as status;
SELECT 
    tablename,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = tablename) as column_count
FROM pg_tables 
WHERE tablename = 'ican_transactions';
