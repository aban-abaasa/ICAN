/**
 * 💰 ICAN Wallet System - Clean Setup
 * Simple table creation without cleanup
 */

-- =============================================
-- 1. TRANSACTIONS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    transaction_type VARCHAR(50),
    amount DECIMAL(15, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'UGX',
    status VARCHAR(20) DEFAULT 'pending',
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON public.transactions(status);

-- =============================================
-- 2. WALLET ACCOUNTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.wallet_accounts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    balance DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    currency VARCHAR(3) NOT NULL DEFAULT 'UGX',
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_wallet_accounts_user_id ON public.wallet_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_accounts_status ON public.wallet_accounts(status);

-- =============================================
-- 3. WALLET TRANSACTIONS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    wallet_id UUID NOT NULL REFERENCES public.wallet_accounts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    transaction_type VARCHAR(50),
    amount DECIMAL(15, 2) NOT NULL,
    previous_balance DECIMAL(15, 2),
    new_balance DECIMAL(15, 2),
    currency VARCHAR(3) DEFAULT 'UGX',
    status VARCHAR(20) DEFAULT 'pending',
    related_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id ON public.wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet_id ON public.wallet_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_status ON public.wallet_transactions(status);

-- =============================================
-- 4. WITHDRAWAL HISTORY TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.withdrawal_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
    amount DECIMAL(15, 2) NOT NULL,
    fee DECIMAL(10, 2) DEFAULT 0,
    net_amount DECIMAL(15, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'UGX',
    provider VARCHAR(20),
    phone_number VARCHAR(20),
    account_number VARCHAR(50),
    bank_name VARCHAR(100),
    status VARCHAR(20) DEFAULT 'pending',
    momo_reference VARCHAR(100),
    bank_reference VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_user_id ON public.withdrawal_history(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_status ON public.withdrawal_history(status);
CREATE INDEX IF NOT EXISTS idx_withdrawal_created_at ON public.withdrawal_history(created_at);
CREATE INDEX IF NOT EXISTS idx_withdrawal_provider ON public.withdrawal_history(provider);

-- =============================================
-- DONE! ✅
-- =============================================
-- All wallet tables created successfully!
