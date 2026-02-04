-- ════════════════════════════════════════════════════════════════════════════
-- 🚀 ICAN WALLET WITHDRAWAL SYSTEM - SUPABASE SQL SETUP
-- Copy and paste this into Supabase SQL Editor and run
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- PART 1: Create wallet_accounts table (if not exists)
-- ════════════════════════════════════════════════════════════════════════════

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

-- Enable RLS
ALTER TABLE public.wallet_accounts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY IF NOT EXISTS "Users can view own wallet"
  ON public.wallet_accounts
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Users can update own wallet"
  ON public.wallet_accounts
  FOR UPDATE
  USING (auth.uid() = user_id);

-- ════════════════════════════════════════════════════════════════════════════
-- PART 2: Create withdrawal_history table
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.withdrawal_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  
  -- Withdrawal Details
  amount DECIMAL(15, 2) NOT NULL,
  fee DECIMAL(10, 2) DEFAULT 0,
  net_amount DECIMAL(15, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'UGX',
  
  -- Destination Information
  provider VARCHAR(20),
  phone_number VARCHAR(20),
  account_number VARCHAR(50),
  bank_name VARCHAR(100),
  
  -- Status & Tracking
  status VARCHAR(20) DEFAULT 'pending',
  momo_reference VARCHAR(100),
  bank_reference VARCHAR(100),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_withdrawal_user_id ON public.withdrawal_history(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_status ON public.withdrawal_history(status);
CREATE INDEX IF NOT EXISTS idx_withdrawal_created_at ON public.withdrawal_history(created_at);
CREATE INDEX IF NOT EXISTS idx_withdrawal_provider ON public.withdrawal_history(provider);

-- Enable RLS
ALTER TABLE public.withdrawal_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY IF NOT EXISTS "Users can view their own withdrawals"
  ON public.withdrawal_history
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Users can create their own withdrawals"
  ON public.withdrawal_history
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "System can update withdrawal status"
  ON public.withdrawal_history
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- ════════════════════════════════════════════════════════════════════════════
-- PART 3: Create functions and triggers
-- ════════════════════════════════════════════════════════════════════════════

-- Auto-create wallet for new users
CREATE OR REPLACE FUNCTION public.create_wallet_for_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.wallet_accounts (user_id, balance, currency, status)
  VALUES (NEW.id, 0.00, 'UGX', 'active')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger if it doesn't exist
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_wallet_for_user();

-- Update timestamps
CREATE OR REPLACE FUNCTION update_wallet_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wallet_update_timestamp ON public.wallet_accounts;
CREATE TRIGGER wallet_update_timestamp
  BEFORE UPDATE ON public.wallet_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_wallet_timestamp();

DROP TRIGGER IF EXISTS withdrawal_update_timestamp ON public.withdrawal_history;
CREATE TRIGGER withdrawal_update_timestamp
  BEFORE UPDATE ON public.withdrawal_history
  FOR EACH ROW
  EXECUTE FUNCTION update_wallet_timestamp();

-- ════════════════════════════════════════════════════════════════════════════
-- PART 4: Create views for analytics
-- ════════════════════════════════════════════════════════════════════════════

-- Daily withdrawal summary
DROP VIEW IF EXISTS public.withdrawal_daily_summary CASCADE;
CREATE VIEW public.withdrawal_daily_summary AS
SELECT 
  DATE(created_at) as withdrawal_date,
  provider,
  status,
  COUNT(*) as total_withdrawals,
  COALESCE(SUM(amount), 0) as total_amount,
  COALESCE(SUM(fee), 0) as total_fees,
  COALESCE(SUM(net_amount), 0) as net_total,
  COUNT(DISTINCT user_id) as unique_users,
  currency
FROM public.withdrawal_history
GROUP BY DATE(created_at), provider, status, currency
ORDER BY withdrawal_date DESC;

-- User withdrawal summary
DROP VIEW IF EXISTS public.user_withdrawal_summary CASCADE;
CREATE VIEW public.user_withdrawal_summary AS
SELECT 
  user_id,
  COUNT(*) as total_withdrawals,
  COALESCE(SUM(amount), 0) as total_withdrawn,
  COALESCE(SUM(fee), 0) as total_fees,
  COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful_withdrawals,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_withdrawals,
  MAX(created_at) as last_withdrawal_date,
  currency
FROM public.withdrawal_history
GROUP BY user_id, currency;

-- ════════════════════════════════════════════════════════════════════════════
-- PART 5: Create stored procedures
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_user_withdrawal_history(p_user_id UUID, p_limit INT DEFAULT 20)
RETURNS TABLE (
  id UUID,
  amount DECIMAL,
  fee DECIMAL,
  net_amount DECIMAL,
  provider VARCHAR,
  status VARCHAR,
  created_at TIMESTAMP WITH TIME ZONE,
  phone_number VARCHAR,
  account_number VARCHAR,
  bank_name VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    wh.id,
    wh.amount,
    wh.fee,
    wh.net_amount,
    wh.provider,
    wh.status,
    wh.created_at,
    wh.phone_number,
    wh.account_number,
    wh.bank_name
  FROM public.withdrawal_history wh
  WHERE wh.user_id = p_user_id
  ORDER BY wh.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ════════════════════════════════════════════════════════════════════════════
-- PART 6: Grant permissions
-- ════════════════════════════════════════════════════════════════════════════

GRANT SELECT, INSERT, UPDATE ON public.wallet_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.withdrawal_history TO authenticated;
GRANT SELECT ON public.withdrawal_daily_summary TO authenticated;
GRANT SELECT ON public.user_withdrawal_summary TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_withdrawal_history(UUID, INT) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ✅ SETUP COMPLETE!
-- ════════════════════════════════════════════════════════════════════════════
-- 
-- Your ICAN Wallet withdrawal system is now ready!
-- 
-- Next steps:
-- 1. Go back to your backend terminal
-- 2. Make sure node server.js is still running
-- 3. Open http://localhost:5173 in your browser
-- 4. Login and test the withdrawal feature!
-- 
-- You can now:
-- ✅ Withdraw to mobile money (instant)
-- ✅ Withdraw to bank (24-48 hours)
-- ✅ Track withdrawal history
-- ✅ View withdrawal analytics
--
-- ════════════════════════════════════════════════════════════════════════════
