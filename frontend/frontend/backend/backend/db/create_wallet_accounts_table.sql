-- =============================================
-- WALLET ACCOUNTS TABLE
-- For tracking user wallet balances
-- =============================================

CREATE TABLE IF NOT EXISTS public.wallet_accounts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- User
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Balance
    balance DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    currency VARCHAR(3) NOT NULL DEFAULT 'UGX',
    
    -- Account Status
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended', 'closed')),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_wallet_accounts_user_id ON public.wallet_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_accounts_status ON public.wallet_accounts(status);

-- =============================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================

ALTER TABLE public.wallet_accounts ENABLE ROW LEVEL SECURITY;

-- Users can view their own wallet
CREATE POLICY "Users can view own wallet"
  ON public.wallet_accounts
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can update their own wallet (via functions only)
CREATE POLICY "Users can update own wallet"
  ON public.wallet_accounts
  FOR UPDATE
  USING (auth.uid() = user_id);

-- =============================================
-- FUNCTION TO CREATE WALLET FOR NEW USER
-- =============================================

CREATE OR REPLACE FUNCTION create_wallet_for_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.wallet_accounts (user_id, balance, currency, status)
  VALUES (NEW.id, 0.00, 'UGX', 'active')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create wallet when user signs up
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_wallet_for_user();

-- =============================================
-- FUNCTION TO UPDATE WALLET TIMESTAMP
-- =============================================

CREATE OR REPLACE FUNCTION update_wallet_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update timestamp on wallet changes
CREATE TRIGGER wallet_update_timestamp
  BEFORE UPDATE ON public.wallet_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_wallet_timestamp();

-- =============================================
-- GRANT PERMISSIONS
-- =============================================

GRANT SELECT, UPDATE ON public.wallet_accounts TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE IF EXISTS public.wallet_accounts_id_seq TO authenticated;
