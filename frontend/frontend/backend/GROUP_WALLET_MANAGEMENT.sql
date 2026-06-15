/**
 * 🏦 GROUP WALLET MANAGEMENT SYSTEM
 * Manages ICAN wallets for Trust Groups
 * Features: PIN protection, transaction rules, approval workflow
 */

-- ============================================================================
-- STEP 1: Create group_accounts table (similar to user_accounts but for groups)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.group_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.trust_groups(id) ON DELETE CASCADE,
  
  -- Wallet Identification
  account_number VARCHAR(50) UNIQUE NOT NULL, -- ICAN-GROUP-XXXXXXXXXXXXX
  wallet_address VARCHAR(255) UNIQUE, -- ICAN blockchain address
  
  -- Security
  pin_hash VARCHAR(255) NOT NULL, -- Hashed 4-6 digit PIN
  pin_attempts INT DEFAULT 0, -- Failed PIN attempts
  pin_locked_until TIMESTAMP WITH TIME ZONE, -- Lock account if too many attempts
  
  -- Account Status
  account_type VARCHAR(50) DEFAULT 'group', -- 'group', 'business_group'
  status VARCHAR(50) DEFAULT 'active', -- 'active', 'paused', 'closed', 'suspended'
  
  -- Balance Information
  balance_ican NUMERIC(20, 8) DEFAULT 0, -- ICAN coin balance with 8 decimal places
  balance_ican_locked NUMERIC(20, 8) DEFAULT 0, -- Locked in pending approvals
  pending_balance NUMERIC(20, 8) DEFAULT 0, -- Pending member contributions
  
  -- Wallet Configuration
  min_withdrawal NUMERIC(20, 8) DEFAULT 10, -- Minimum withdrawal amount in ICAN
  approval_threshold INT DEFAULT 60, -- % of members needed for approval
  auto_deposit BOOLEAN DEFAULT TRUE, -- Auto-accept member contributions
  
  -- Transaction Rules
  daily_limit NUMERIC(20, 8), -- Daily transaction limit
  max_transaction NUMERIC(20, 8), -- Max per transaction
  requires_mfa BOOLEAN DEFAULT TRUE, -- Multi-factor auth for transactions
  
  -- Creator Information (for security backup)
  creator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Unique constraint per group
  UNIQUE(group_id),
  CONSTRAINT valid_approval_threshold CHECK (approval_threshold >= 0 AND approval_threshold <= 100)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_group_accounts_group_id ON public.group_accounts(group_id);
CREATE INDEX IF NOT EXISTS idx_group_accounts_creator_id ON public.group_accounts(creator_id);
CREATE INDEX IF NOT EXISTS idx_group_accounts_status ON public.group_accounts(status);
CREATE INDEX IF NOT EXISTS idx_group_accounts_wallet_address ON public.group_accounts(wallet_address);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_group_accounts_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_group_accounts_updated_at ON public.group_accounts;
CREATE TRIGGER trigger_group_accounts_updated_at
BEFORE UPDATE ON public.group_accounts
FOR EACH ROW
EXECUTE FUNCTION update_group_accounts_timestamp();

-- ============================================================================
-- STEP 2: Create group_wallet_transactions table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.group_wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_account_id UUID NOT NULL REFERENCES public.group_accounts(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.trust_groups(id) ON DELETE CASCADE,
  
  -- Transaction Type
  transaction_type VARCHAR(50) NOT NULL, -- 'deposit', 'withdrawal', 'member_contribution', 'dividend', 'fee', 'refund'
  description TEXT,
  
  -- Amount Details
  amount NUMERIC(20, 8) NOT NULL,
  currency VARCHAR(10) DEFAULT 'ICAN',
  
  -- User Information
  initiated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- Who initiated
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- Who approved (if applicable)
  
  -- Approval Status
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'approved', 'completed', 'rejected', 'failed'
  approval_votes INT DEFAULT 0, -- Number of members who approved
  approval_percentage NUMERIC(5, 2), -- % of members who approved
  
  -- Transaction Details
  tx_hash VARCHAR(255), -- Blockchain transaction hash
  related_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- For member contributions
  metadata JSONB, -- Additional data (e.g., payment method, notes)
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  approved_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  
  CONSTRAINT valid_amount CHECK (amount > 0)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_group_wallet_transactions_group_id ON public.group_wallet_transactions(group_id);
CREATE INDEX IF NOT EXISTS idx_group_wallet_transactions_group_account_id ON public.group_wallet_transactions(group_account_id);
CREATE INDEX IF NOT EXISTS idx_group_wallet_transactions_status ON public.group_wallet_transactions(status);
CREATE INDEX IF NOT EXISTS idx_group_wallet_transactions_type ON public.group_wallet_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_group_wallet_transactions_created_at ON public.group_wallet_transactions(created_at);

-- ============================================================================
-- STEP 3: Create group_wallet_approvals table (for tracking member votes)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.group_wallet_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.group_wallet_transactions(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.trust_groups(id) ON DELETE CASCADE,
  
  -- Voter Information
  member_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vote VARCHAR(20) NOT NULL, -- 'approve', 'reject', 'pending'
  
  -- Comments
  comment TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(transaction_id, member_user_id) -- Each member votes once per transaction
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_group_wallet_approvals_transaction_id ON public.group_wallet_approvals(transaction_id);
CREATE INDEX IF NOT EXISTS idx_group_wallet_approvals_member_user_id ON public.group_wallet_approvals(member_user_id);
CREATE INDEX IF NOT EXISTS idx_group_wallet_approvals_vote ON public.group_wallet_approvals(vote);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_group_wallet_approvals_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_group_wallet_approvals_updated_at ON public.group_wallet_approvals;
CREATE TRIGGER trigger_group_wallet_approvals_updated_at
BEFORE UPDATE ON public.group_wallet_approvals
FOR EACH ROW
EXECUTE FUNCTION update_group_wallet_approvals_timestamp();

-- ============================================================================
-- STEP 4: Create group_pin_changes table (for PIN change history)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.group_pin_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_account_id UUID NOT NULL REFERENCES public.group_accounts(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.trust_groups(id) ON DELETE CASCADE,
  
  -- PIN Change Details
  changed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  old_pin_hash VARCHAR(255), -- Keep for audit (optional)
  reason VARCHAR(100), -- 'user_request', 'security_reset', 'recovery', 'admin_reset'
  
  -- Status
  status VARCHAR(50) DEFAULT 'completed', -- 'pending', 'completed', 'failed'
  
  -- Timestamp
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_group_pin_changes_group_account_id ON public.group_pin_changes(group_account_id);
CREATE INDEX IF NOT EXISTS idx_group_pin_changes_group_id ON public.group_pin_changes(group_id);

-- ============================================================================
-- STEP 5: Create group_wallet_settings table (advanced config)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.group_wallet_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_account_id UUID NOT NULL UNIQUE REFERENCES public.group_accounts(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.trust_groups(id) ON DELETE CASCADE,
  
  -- Advanced Settings
  require_pin_for_deposit BOOLEAN DEFAULT FALSE, -- PIN needed for deposits
  require_pin_for_withdrawal BOOLEAN DEFAULT TRUE, -- PIN needed for withdrawals
  require_pin_for_member_removal BOOLEAN DEFAULT TRUE, -- PIN to remove member
  
  -- Notification Settings
  notify_on_deposit BOOLEAN DEFAULT TRUE,
  notify_on_withdrawal BOOLEAN DEFAULT TRUE,
  notify_on_low_balance BOOLEAN DEFAULT TRUE,
  low_balance_threshold NUMERIC(20, 8) DEFAULT 100, -- Notify if balance drops below this
  
  -- Reconciliation
  auto_reconcile BOOLEAN DEFAULT TRUE,
  reconciliation_date VARCHAR(50), -- e.g., "01" (1st of month)
  
  -- Created/Updated
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_group_wallet_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_group_wallet_settings_updated_at ON public.group_wallet_settings;
CREATE TRIGGER trigger_group_wallet_settings_updated_at
BEFORE UPDATE ON public.group_wallet_settings
FOR EACH ROW
EXECUTE FUNCTION update_group_wallet_settings_timestamp();

-- ============================================================================
-- STEP 6: Disable RLS temporarily to set up (will add policies in separate file)
-- ============================================================================
ALTER TABLE public.group_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_wallet_transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_wallet_approvals DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_pin_changes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_wallet_settings DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STEP 7: Grant permissions
-- ============================================================================
GRANT ALL PRIVILEGES ON public.group_accounts TO authenticated;
GRANT ALL PRIVILEGES ON public.group_wallet_transactions TO authenticated;
GRANT ALL PRIVILEGES ON public.group_wallet_approvals TO authenticated;
GRANT ALL PRIVILEGES ON public.group_pin_changes TO authenticated;
GRANT ALL PRIVILEGES ON public.group_wallet_settings TO authenticated;

GRANT SELECT ON public.group_accounts TO anon;
GRANT SELECT ON public.group_wallet_transactions TO anon;
GRANT SELECT ON public.group_wallet_approvals TO anon;

-- ============================================================================
-- STEP 8: Create helper functions
-- ============================================================================

-- Function to generate unique account number
CREATE OR REPLACE FUNCTION generate_group_account_number()
RETURNS VARCHAR AS $$
BEGIN
  RETURN 'ICAN-GROUP-' || SUBSTRING(MD5(RANDOM()::TEXT), 1, 16);
END;
$$ LANGUAGE plpgsql;

-- Function to check if group has wallet
CREATE OR REPLACE FUNCTION group_has_wallet(group_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.group_accounts 
    WHERE group_id = group_uuid AND status != 'closed'
  );
END;
$$ LANGUAGE plpgsql;

-- Function to get group wallet balance
CREATE OR REPLACE FUNCTION get_group_wallet_balance(group_uuid UUID)
RETURNS NUMERIC AS $$
DECLARE
  total_balance NUMERIC;
BEGIN
  SELECT balance_ican INTO total_balance
  FROM public.group_accounts
  WHERE group_id = group_uuid AND status = 'active';
  
  RETURN COALESCE(total_balance, 0);
END;
$$ LANGUAGE plpgsql;

-- Function to update group balance after transaction
CREATE OR REPLACE FUNCTION update_group_wallet_balance(
  p_group_account_id UUID,
  p_amount NUMERIC,
  p_transaction_type VARCHAR
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.group_accounts
  SET balance_ican = CASE
    WHEN p_transaction_type IN ('deposit', 'member_contribution', 'dividend') 
      THEN balance_ican + p_amount
    WHEN p_transaction_type IN ('withdrawal', 'fee')
      THEN balance_ican - p_amount
    ELSE balance_ican
  END,
  updated_at = NOW()
  WHERE id = p_group_account_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 9: Create audit table for security
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.group_wallet_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES public.trust_groups(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  action_type VARCHAR(50), -- 'pin_change', 'withdrawal', 'approval', 'settings_change'
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  details JSONB,
  ip_address INET,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_wallet_audit_group_id ON public.group_wallet_audit(group_id);
CREATE INDEX IF NOT EXISTS idx_group_wallet_audit_action_type ON public.group_wallet_audit(action_type);

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- Tables created:
-- ✅ group_accounts - Core wallet account per group
-- ✅ group_wallet_transactions - Transaction history with approval tracking
-- ✅ group_wallet_approvals - Member voting on transactions
-- ✅ group_pin_changes - PIN change audit trail
-- ✅ group_wallet_settings - Advanced wallet configuration
-- ✅ group_wallet_audit - Security audit log
--
-- Helper functions created:
-- ✅ generate_group_account_number() - Generate unique ICAN-GROUP-XXX account numbers
-- ✅ group_has_wallet() - Check if group has active wallet
-- ✅ get_group_wallet_balance() - Get current balance
-- ✅ update_group_wallet_balance() - Update balance after transactions
--
-- Next: Add RLS policies in separate file and integrate with frontend service
