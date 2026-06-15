-- =============================================
-- WALLET TRANSACTIONS TABLE
-- For tracking all wallet transactions
-- (MOMO, Cards, Bank transfers, etc.)
-- =============================================

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- User & Account
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Transaction Details
    type VARCHAR(50) NOT NULL CHECK (type IN ('collection', 'disbursement', 'transfer', 'topup', 'withdrawal')),
    provider VARCHAR(50) NOT NULL CHECK (provider IN ('mtn_momo', 'airtel_money', 'card', 'bank_transfer', 'internal')),
    amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'UGX',
    
    -- References
    reference_id VARCHAR(255) UNIQUE,
    transaction_id VARCHAR(255) UNIQUE,
    phone_number VARCHAR(20),
    
    -- Status
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
    
    -- Metadata
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    
    -- Indexes for performance
    UNIQUE(reference_id),
    UNIQUE(transaction_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id ON public.wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_status ON public.wallet_transactions(status);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_provider ON public.wallet_transactions(provider);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created_at ON public.wallet_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_reference_id ON public.wallet_transactions(reference_id);

-- =============================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

-- Users can only see their own transactions
CREATE POLICY "Users can view own wallet transactions" ON public.wallet_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own transactions (though normally backend does this)
CREATE POLICY "Users can create own wallet transactions" ON public.wallet_transactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Only backend can update transactions
CREATE POLICY "Service role can update transactions" ON public.wallet_transactions
  FOR UPDATE USING (auth.role() = 'service_role');

-- =============================================
-- WALLET BALANCES VIEW
-- Summarizes user wallet balances by currency
-- =============================================

CREATE OR REPLACE VIEW public.wallet_balances AS
SELECT 
    user_id,
    currency,
    COALESCE(SUM(CASE WHEN type IN ('collection', 'topup', 'transfer') THEN amount ELSE -amount END), 0) as balance,
    COUNT(*) as transaction_count,
    MAX(updated_at) as last_updated
FROM public.wallet_transactions
WHERE status = 'completed'
GROUP BY user_id, currency;

-- =============================================
-- SAMPLE QUERIES
-- =============================================

-- Get user wallet balance for specific currency
-- SELECT balance FROM public.wallet_balances
-- WHERE user_id = 'user-uuid' AND currency = 'UGX';

-- Get recent transactions
-- SELECT * FROM public.wallet_transactions
-- WHERE user_id = 'user-uuid'
-- ORDER BY created_at DESC
-- LIMIT 10;

-- Get transaction by reference ID
-- SELECT * FROM public.wallet_transactions
-- WHERE reference_id = 'REC-xxx' OR transaction_id = 'REC-xxx';
