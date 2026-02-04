-- 🔧 RUN THIS IN SUPABASE SQL EDITOR
-- This creates the missing ican_transactions table with proper permissions

-- Step 1: Create the ican_transactions table
CREATE TABLE IF NOT EXISTS public.ican_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    
    -- Transaction details
    transaction_type TEXT NOT NULL,
    amount DECIMAL(18, 8) NOT NULL,
    currency TEXT DEFAULT 'USD',
    description TEXT,
    
    -- Status tracking
    status TEXT DEFAULT 'pending',
    
    -- Blockchain sync
    blockchain_status TEXT DEFAULT 'not_synced',
    blockchain_tx_hash TEXT,
    blockchain_block_number BIGINT,
    blockchain_network TEXT DEFAULT 'ethereum',
    blockchain_synced_at TIMESTAMP WITH TIME ZONE,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

-- Step 2: Enable Row Level Security
ALTER TABLE public.ican_transactions ENABLE ROW LEVEL SECURITY;

-- Step 3: Create policies for user access
CREATE POLICY "Users can view their own transactions"
    ON public.ican_transactions FOR SELECT 
    USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own transactions"
    ON public.ican_transactions FOR INSERT 
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own transactions"
    ON public.ican_transactions FOR UPDATE 
    USING (user_id = auth.uid());

-- Step 4: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ican_transactions_user_id ON public.ican_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_ican_transactions_status ON public.ican_transactions(status);
CREATE INDEX IF NOT EXISTS idx_ican_transactions_created_at ON public.ican_transactions(created_at);

-- Verify the table was created
SELECT 
    tablename,
    'Table Created ✅' AS status
FROM pg_tables 
WHERE schemaname = 'public' AND tablename = 'ican_transactions';
