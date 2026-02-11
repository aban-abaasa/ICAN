-- =============================================
-- DEPLOY USER BALANCES TABLE
-- Run this script in Supabase SQL Editor to create the table
-- =============================================

-- =============================================
-- CREATE USER BALANCES TABLE
-- Stores user's coin/currency balances
-- =============================================
CREATE TABLE IF NOT EXISTS public.user_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Balance details
    currency TEXT NOT NULL, -- 'ICAN', 'UGX', 'KES', etc.
    balance DECIMAL(18, 8) DEFAULT 0,
    locked_balance DECIMAL(18, 8) DEFAULT 0, -- Balance in pending transactions
    
    -- Status
    status TEXT DEFAULT 'active', -- 'active', 'suspended', 'archived'
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id, currency)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_balances_user_id ON public.user_balances(user_id);
CREATE INDEX IF NOT EXISTS idx_user_balances_currency ON public.user_balances(currency);
CREATE INDEX IF NOT EXISTS idx_user_balances_user_currency ON public.user_balances(user_id, currency);

-- Enable Row Level Security
ALTER TABLE public.user_balances ENABLE ROW LEVEL SECURITY;

-- =============================================
-- RLS POLICIES
-- =============================================

-- Users can view their own balances
DROP POLICY IF EXISTS "Users can view their own balances" ON public.user_balances;
CREATE POLICY "Users can view their own balances" 
    ON public.user_balances FOR SELECT 
    USING (auth.uid() = user_id);

-- Users can update their own balances (for admin/system use)
DROP POLICY IF EXISTS "Users can update their own balances" ON public.user_balances;
CREATE POLICY "Users can update their own balances" 
    ON public.user_balances FOR UPDATE 
    USING (auth.uid() = user_id);

-- =============================================
-- VERIFICATION
-- =============================================
SELECT '✅ User Balances Table Created!' as status;
SELECT 
    tablename,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = tablename) as column_count
FROM pg_tables 
WHERE tablename = 'user_balances';
