-- 🎯 USER WALLET ACCOUNTS TABLE
-- Stores user account numbers, PIN, and biometric authentication details
-- Run this in Supabase SQL Editor

-- Step 1: Create user_accounts table
CREATE TABLE IF NOT EXISTS public.user_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    
    -- Account Information
    account_number TEXT NOT NULL UNIQUE, -- Format: ICAN-XXXXXXXXXXXXX (16 digits)
    account_type TEXT DEFAULT 'personal', -- 'personal', 'business', etc.
    
    -- Account Status
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended', 'closed')),
    
    -- Account Details
    account_holder_name TEXT,
    phone_number TEXT,
    email TEXT,
    
    -- 🔐 SECURITY - PIN AND BIOMETRICS
    -- PIN (hashed for security)
    pin_hash TEXT, -- Hashed PIN (4-6 digits)
    pin_created_at TIMESTAMP WITH TIME ZONE,
    pin_attempts INTEGER DEFAULT 0,
    pin_locked_until TIMESTAMP WITH TIME ZONE,
    
    -- Biometric Settings
    biometric_enabled BOOLEAN DEFAULT FALSE,
    fingerprint_enabled BOOLEAN DEFAULT FALSE,
    phone_pin_enabled BOOLEAN DEFAULT FALSE,
    biometric_template TEXT, -- Encrypted biometric template (if applicable)
    biometric_last_updated TIMESTAMP WITH TIME ZONE,
    
    -- Currency Preferences
    preferred_currency TEXT DEFAULT 'USD',
    supported_currencies TEXT[] DEFAULT ARRAY['USD', 'UGX', 'KES'],
    
    -- KYC/Verification
    kyc_verified BOOLEAN DEFAULT FALSE,
    kyc_verified_at TIMESTAMP WITH TIME ZONE,
    identity_document TEXT, -- Document type used for verification
    
    -- Balances (for quick access)
    usd_balance DECIMAL(18, 8) DEFAULT 0,
    ugx_balance DECIMAL(18, 8) DEFAULT 0,
    kes_balance DECIMAL(18, 8) DEFAULT 0,
    
    -- Account Settings
    daily_limit DECIMAL(18, 8) DEFAULT 10000, -- Daily transaction limit
    monthly_limit DECIMAL(18, 8) DEFAULT 100000, -- Monthly transaction limit
    allow_agent_transfers BOOLEAN DEFAULT TRUE,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_transaction_at TIMESTAMP WITH TIME ZONE
);

-- Step 1b: Add missing columns if they don't exist
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS pin_created_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS pin_attempts INTEGER DEFAULT 0;
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS biometric_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS fingerprint_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS phone_pin_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS biometric_template TEXT;
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS biometric_last_updated TIMESTAMP WITH TIME ZONE;

-- Enable Row Level Security
ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;

-- Step 2: Create RLS Policies (Drop existing first to avoid conflicts)
-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own account" ON public.user_accounts;
DROP POLICY IF EXISTS "Users can create their own account" ON public.user_accounts;
DROP POLICY IF EXISTS "Users can update their own account" ON public.user_accounts;
DROP POLICY IF EXISTS "Service role can manage user accounts" ON public.user_accounts;

-- Users can view their own account
CREATE POLICY "Users can view their own account"
    ON public.user_accounts FOR SELECT 
    USING (auth.uid() = user_id);

-- Users can create their own account
CREATE POLICY "Users can create their own account"
    ON public.user_accounts FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own account
CREATE POLICY "Users can update their own account"
    ON public.user_accounts FOR UPDATE 
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Service role can query all accounts (for admin purposes)
CREATE POLICY "Service role can manage user accounts"
    ON public.user_accounts FOR ALL 
    USING (auth.role() = 'service_role');

-- Step 3: Create Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_user_accounts_user_id ON public.user_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_accounts_account_number ON public.user_accounts(account_number);
CREATE INDEX IF NOT EXISTS idx_user_accounts_status ON public.user_accounts(status);
CREATE INDEX IF NOT EXISTS idx_user_accounts_created_at ON public.user_accounts(created_at);
CREATE INDEX IF NOT EXISTS idx_user_accounts_biometric_enabled ON public.user_accounts(biometric_enabled);

-- Step 4: Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_user_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_user_accounts_updated_at ON public.user_accounts;
CREATE TRIGGER tr_user_accounts_updated_at
BEFORE UPDATE ON public.user_accounts
FOR EACH ROW
EXECUTE FUNCTION public.update_user_accounts_updated_at();

-- Step 5: Verify table creation
SELECT 
    tablename,
    'Table Created ✅' AS status
FROM pg_tables 
WHERE schemaname = 'public' AND tablename = 'user_accounts';

-- Sample query to check if user has account
-- SELECT * FROM user_accounts WHERE user_id = 'your-user-id' AND status = 'active';
