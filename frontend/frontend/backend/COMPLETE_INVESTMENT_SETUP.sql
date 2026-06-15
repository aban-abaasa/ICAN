-- =====================================================
-- COMPLETE INVESTMENT WORKFLOW SETUP
-- =====================================================
-- This script runs all dependencies in correct order:
-- 1. Wallet Infrastructure (ICAN Wallet system)
-- 2. Business Profiles & Pitches (base tables)
-- 3. Investment Agreements (reference base tables)
-- 4. Investment Signing Workflow (PIN verification & thresholds)
-- =====================================================

-- NOTE: This assumes 04_business_profiles_blockchain.sql has already been run
-- If not, you MUST run it first in Supabase SQL Editor

-- =====================================================
-- PART 1: ICAN WALLET INFRASTRUCTURE
-- =====================================================

-- User Wallets Table
DROP TABLE IF EXISTS public.user_wallets CASCADE;
CREATE TABLE public.user_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  user_email VARCHAR(255),
  account_type VARCHAR(50) DEFAULT 'investor', -- investor, agent, admin, escrow
  pin VARCHAR(255), -- Hashed PIN
  balance DECIMAL(18, 8) DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'ICAN',
  status VARCHAR(50) DEFAULT 'active', -- active, suspended, closed
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_wallets_user_id ON public.user_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_wallets_email ON public.user_wallets(user_email);
CREATE INDEX IF NOT EXISTS idx_user_wallets_status ON public.user_wallets(status);

-- Wallet Transactions Table
DROP TABLE IF EXISTS public.wallet_transactions CASCADE;
CREATE TABLE public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES public.user_wallets(id) ON DELETE CASCADE,
  user_id UUID,
  transaction_type VARCHAR(50), -- investment_debit, investment_credit, transfer, deposit, withdrawal
  amount DECIMAL(18, 8),
  balance_before DECIMAL(18, 8),
  balance_after DECIMAL(18, 8),
  status VARCHAR(50) DEFAULT 'pending', -- pending, completed, failed, reversed
  description TEXT,
  reference VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet_id ON public.wallet_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id ON public.wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_type ON public.wallet_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_status ON public.wallet_transactions(status);

-- Agent Wallets Table (for escrow accounts)
DROP TABLE IF EXISTS public.agent_wallets CASCADE;
CREATE TABLE public.agent_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id VARCHAR(50) UNIQUE NOT NULL, -- AGENT-KAM-5560, etc
  agent_name VARCHAR(255),
  account_type VARCHAR(50) DEFAULT 'escrow',
  balance DECIMAL(18, 8) DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'ICAN',
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_wallets_agent_id ON public.agent_wallets(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_wallets_status ON public.agent_wallets(status);

-- Enable RLS for wallet tables
ALTER TABLE public.user_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_wallets ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_wallets (users can only see their own wallet)
DROP POLICY IF EXISTS "Users can view their own wallet" ON public.user_wallets;
CREATE POLICY "Users can view their own wallet"
    ON public.user_wallets FOR SELECT
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their own wallet" ON public.user_wallets;
CREATE POLICY "Users can update their own wallet"
    ON public.user_wallets FOR UPDATE
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert their own wallet" ON public.user_wallets;
CREATE POLICY "Users can insert their own wallet"
    ON public.user_wallets FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- RLS Policies for wallet_transactions
DROP POLICY IF EXISTS "Users can view their own transactions" ON public.wallet_transactions;
CREATE POLICY "Users can view their own transactions"
    ON public.wallet_transactions FOR SELECT
    USING (user_id = auth.uid());

-- Agent wallets are readable by all (for escrow transparency)
DROP POLICY IF EXISTS "Anyone can view agent wallets" ON public.agent_wallets;
CREATE POLICY "Anyone can view agent wallets"
    ON public.agent_wallets FOR SELECT
    USING (true);

-- =====================================================
-- PART 2: INVESTMENT AGREEMENTS SCHEMA
-- =====================================================

CREATE TABLE IF NOT EXISTS public.investment_agreements (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Link to pitch and business (validated at application level)
    pitch_id UUID,
    business_profile_id UUID,
    
    -- Agreement details
    agreement_type VARCHAR(50) NOT NULL CHECK (agreement_type IN ('equity', 'partnership', 'grant', 'loan', 'convertible_note', 'revenue_share')),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Financial terms
    total_amount DECIMAL(15,2),
    currency VARCHAR(10) DEFAULT 'USD',
    equity_percentage DECIMAL(5,2),
    share_price DECIMAL(15,4),
    total_shares INTEGER,
    
    -- Terms and conditions
    terms_text TEXT,
    special_conditions TEXT,
    vesting_schedule JSONB,
    milestones JSONB,
    
    -- Status tracking
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'pending_signatures', 'partially_signed', 'fully_signed', 'active', 'completed', 'cancelled', 'expired')),
    
    -- Signature tracking
    owner_signed BOOLEAN DEFAULT FALSE,
    owner_signature_data JSONB,
    owner_signed_at TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    
    -- QR Code data (generated after all signatures)
    qr_code_data JSONB,
    qr_code_hash VARCHAR(255),
    
    -- Legal
    jurisdiction VARCHAR(100),
    governing_law VARCHAR(100),
    dispute_resolution TEXT
);

-- =============================================
-- AGREEMENT SIGNATORIES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.agreement_signatories (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    agreement_id UUID NOT NULL REFERENCES public.investment_agreements(id) ON DELETE CASCADE,
    
    -- Signatory details
    user_id UUID,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    role VARCHAR(50) NOT NULL CHECK (role IN ('investor', 'partner', 'shareholder', 'grantor', 'co_founder', 'witness', 'guarantor')),
    
    -- Investment details for this party
    investment_amount DECIMAL(15,2),
    equity_share DECIMAL(5,2),
    share_count INTEGER,
    
    -- Signature status
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'invited', 'viewed', 'signed', 'declined', 'expired')),
    
    -- Signature data (biometric/secure)
    signature_type VARCHAR(50),
    signature_data JSONB,
    signature_hash VARCHAR(255),
    signed_at TIMESTAMPTZ,
    
    -- Location at signing
    sign_location JSONB,
    device_info JSONB,
    
    -- Verification
    is_verified BOOLEAN DEFAULT FALSE,
    verification_method VARCHAR(50),
    verified_at TIMESTAMPTZ,
    
    -- Timestamps
    invited_at TIMESTAMPTZ,
    viewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(agreement_id, email)
);

-- =============================================
-- AGREEMENT TEMPLATES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.agreement_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    agreement_type VARCHAR(50) NOT NULL,
    template_text TEXT NOT NULL,
    variables JSONB,
    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- AGREEMENT ACTIVITY LOG
-- =============================================
CREATE TABLE IF NOT EXISTS public.agreement_activity_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    agreement_id UUID NOT NULL REFERENCES public.investment_agreements(id) ON DELETE CASCADE,
    user_id UUID,
    action VARCHAR(100) NOT NULL,
    details JSONB,
    ip_address VARCHAR(50),
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- INDEXES FOR AGREEMENTS SCHEMA
-- =============================================
CREATE INDEX IF NOT EXISTS idx_agreements_pitch ON public.investment_agreements(pitch_id);
CREATE INDEX IF NOT EXISTS idx_agreements_business ON public.investment_agreements(business_profile_id);
CREATE INDEX IF NOT EXISTS idx_agreements_status ON public.investment_agreements(status);
CREATE INDEX IF NOT EXISTS idx_signatories_agreement ON public.agreement_signatories(agreement_id);
CREATE INDEX IF NOT EXISTS idx_signatories_user ON public.agreement_signatories(user_id);
CREATE INDEX IF NOT EXISTS idx_signatories_email ON public.agreement_signatories(email);
CREATE INDEX IF NOT EXISTS idx_activity_agreement ON public.agreement_activity_log(agreement_id);

-- =============================================
-- RLS POLICIES FOR AGREEMENTS
-- =============================================
ALTER TABLE public.investment_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agreement_signatories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agreement_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agreement_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can manage their agreements" ON public.investment_agreements;
DROP POLICY IF EXISTS "Signatories can view agreements they're part of" ON public.investment_agreements;
DROP POLICY IF EXISTS "Users can create agreements" ON public.investment_agreements;

CREATE POLICY "Users can create agreements"
    ON public.investment_agreements FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users can view signatories of their agreements" ON public.agreement_signatories;
DROP POLICY IF EXISTS "Agreement owners can manage signatories" ON public.agreement_signatories;
DROP POLICY IF EXISTS "Signatories can update their own record" ON public.agreement_signatories;
DROP POLICY IF EXISTS "Users can view signatories" ON public.agreement_signatories;
DROP POLICY IF EXISTS "Signatories can insert" ON public.agreement_signatories;

CREATE POLICY "Users can view signatories"
    ON public.agreement_signatories FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Signatories can update their own record"
    ON public.agreement_signatories FOR UPDATE
    USING (user_id = auth.uid());

CREATE POLICY "Signatories can insert"
    ON public.agreement_signatories FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Anyone can view active templates" ON public.agreement_templates;
CREATE POLICY "Anyone can view active templates"
    ON public.agreement_templates FOR SELECT
    USING (is_active = true);

DROP POLICY IF EXISTS "Users can view activity on their agreements" ON public.agreement_activity_log;
CREATE POLICY "Users can view activity on their agreements"
    ON public.agreement_activity_log FOR SELECT
    USING (user_id = auth.uid());

-- =====================================================
-- PART 3: INVESTMENT SIGNING WORKFLOW
-- =====================================================

-- Step 1: Create investment_signatures table (for tracking signatures)
DROP TABLE IF EXISTS public.investment_signatures CASCADE;
CREATE TABLE public.investment_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investment_id UUID,
  business_profile_id UUID,
  signer_id UUID,
  signer_email VARCHAR(255),
  signer_name VARCHAR(255),
  signer_type VARCHAR(50), -- 'investor', 'shareholder', 'founder'
  
  -- Signature Status
  signature_status VARCHAR(50) DEFAULT 'pending', -- pending, signed, pin_verified
  signed_at TIMESTAMP WITH TIME ZONE,
  pin_verified_at TIMESTAMP WITH TIME ZONE,
  pin_attempts INTEGER DEFAULT 0,
  pin_locked_until TIMESTAMP WITH TIME ZONE,
  
  -- Signature Data
  signature_data JSONB,
  ip_address INET,
  device_info TEXT,
  
  -- Document Link
  document_link TEXT,
  document_download_token TEXT,
  
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investment_signatures_investment_id ON public.investment_signatures(investment_id);
CREATE INDEX IF NOT EXISTS idx_investment_signatures_signer_id ON public.investment_signatures(signer_id);
CREATE INDEX IF NOT EXISTS idx_investment_signatures_status ON public.investment_signatures(signature_status);

-- Step 2: Create investment_approvals table (track approval progress)
DROP TABLE IF EXISTS public.investment_approvals CASCADE;
CREATE TABLE public.investment_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investment_id UUID UNIQUE,
  business_profile_id UUID,
  
  -- Investor Info
  investor_id UUID,
  investor_email VARCHAR(255),
  investor_signature_status VARCHAR(50) DEFAULT 'pending',
  investor_signed_at TIMESTAMP WITH TIME ZONE,
  
  -- Wallet Transfer
  wallet_account_id UUID,
  wallet_account_number VARCHAR(50),
  transfer_amount DECIMAL(18, 8),
  transfer_status VARCHAR(50) DEFAULT 'pending',
  transfer_completed_at TIMESTAMP WITH TIME ZONE,
  transfer_reference TEXT,
  
  -- Shareholder Approvals
  total_shareholders INTEGER,
  shareholders_signed INTEGER DEFAULT 0,
  approval_threshold_percent DECIMAL(5, 2) DEFAULT 60.00,
  approval_threshold_met BOOLEAN DEFAULT FALSE,
  approval_threshold_met_at TIMESTAMP WITH TIME ZONE,
  
  -- Document Status
  document_status VARCHAR(50) DEFAULT 'pending',
  document_ready_at TIMESTAMP WITH TIME ZONE,
  document_link TEXT,
  
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investment_approvals_investment_id ON public.investment_approvals(investment_id);
CREATE INDEX IF NOT EXISTS idx_investment_approvals_approval_threshold ON public.investment_approvals(approval_threshold_met);

-- Step 3: Create shareholder_notifications table (for PIN entry notifications)
DROP TABLE IF EXISTS public.shareholder_notifications CASCADE;
CREATE TABLE public.shareholder_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investment_id UUID,
  shareholder_id UUID,
  shareholder_email VARCHAR(255),
  shareholder_name VARCHAR(255),
  
  -- Notification Status
  notification_type VARCHAR(50),
  notification_status VARCHAR(50) DEFAULT 'pending',
  
  -- PIN Verification
  pin_entry_required BOOLEAN DEFAULT FALSE,
  pin_verified BOOLEAN DEFAULT FALSE,
  pin_verified_at TIMESTAMP WITH TIME ZONE,
  pin_attempts INTEGER DEFAULT 0,
  pin_locked_until TIMESTAMP WITH TIME ZONE,
  
  -- Approval Progress
  approval_percent DECIMAL(5, 2),
  approval_threshold_met BOOLEAN,
  
  -- Document Link
  document_link TEXT,
  document_download_token VARCHAR(255),
  
  -- Notification Content
  notification_message TEXT,
  notification_sent_at TIMESTAMP WITH TIME ZONE,
  notification_read_at TIMESTAMP WITH TIME ZONE,
  action_taken_at TIMESTAMP WITH TIME ZONE,
  
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shareholder_notifications_investment_id ON public.shareholder_notifications(investment_id);
CREATE INDEX IF NOT EXISTS idx_shareholder_notifications_shareholder_id ON public.shareholder_notifications(shareholder_id);
CREATE INDEX IF NOT EXISTS idx_shareholder_notifications_status ON public.shareholder_notifications(notification_status);

-- Step 3B: Create investor_shares table (track investor share ownership)
DROP TABLE IF EXISTS public.investor_shares CASCADE;
CREATE TABLE public.investor_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id UUID,
  investor_email VARCHAR(255),
  investor_name VARCHAR(255),
  pitch_id UUID,
  business_profile_id UUID,
  investment_id UUID,
  
  -- Share Details
  shares_owned INTEGER,
  share_price DECIMAL(15, 4),
  total_investment DECIMAL(18, 8),
  currency VARCHAR(10) DEFAULT 'USD',
  
  -- Share Status
  status VARCHAR(50) DEFAULT 'pending_approval', -- pending_approval, approved, active, transferred, voided
  locked_until_threshold BOOLEAN DEFAULT TRUE,
  threshold_unlock_date TIMESTAMP WITH TIME ZONE,
  
  -- Transaction Reference
  transaction_reference VARCHAR(255),
  
  -- Notes
  notes TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  activated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_investor_shares_investor ON public.investor_shares(investor_id);
CREATE INDEX IF NOT EXISTS idx_investor_shares_pitch ON public.investor_shares(pitch_id);
CREATE INDEX IF NOT EXISTS idx_investor_shares_business ON public.investor_shares(business_profile_id);
CREATE INDEX IF NOT EXISTS idx_investor_shares_investment ON public.investor_shares(investment_id);
CREATE INDEX IF NOT EXISTS idx_investor_shares_status ON public.investor_shares(status);

-- Step 4: Create function to check approval threshold
CREATE OR REPLACE FUNCTION check_approval_threshold(p_investment_id UUID)
RETURNS TABLE (
  total_shareholders INTEGER,
  signed_shareholders INTEGER,
  approval_percent DECIMAL,
  threshold_met BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(DISTINCT sig.signer_id)::INTEGER as total_shareholders,
    COUNT(DISTINCT CASE WHEN sig.signature_status IN ('signed', 'pin_verified') THEN sig.signer_id END)::INTEGER as signed_shareholders,
    ROUND(
      (COUNT(DISTINCT CASE WHEN sig.signature_status IN ('signed', 'pin_verified') THEN sig.signer_id END)::DECIMAL / 
       COUNT(DISTINCT sig.signer_id)::DECIMAL) * 100, 2
    ) as approval_percent,
    (COUNT(DISTINCT CASE WHEN sig.signature_status IN ('signed', 'pin_verified') THEN sig.signer_id END)::DECIMAL / 
     COUNT(DISTINCT sig.signer_id)::DECIMAL) >= 0.60 as threshold_met
  FROM public.investment_signatures sig
  WHERE sig.investment_id = p_investment_id
    AND sig.signer_type IN ('shareholder', 'founder');
END;
$$ LANGUAGE plpgsql;

-- Step 5: Create function to send PIN request notifications
CREATE OR REPLACE FUNCTION send_pin_request_notification(
  p_investment_id UUID,
  p_shareholder_id UUID,
  p_shareholder_email VARCHAR,
  p_shareholder_name VARCHAR
)
RETURNS TABLE (notification_id UUID, status TEXT) AS $$
DECLARE
  v_notification_id UUID;
  v_approval_percent DECIMAL;
  v_current_approvals INT;
  v_total_shareholders INT;
BEGIN
  -- Get current approval status
  SELECT
    check_approval_threshold.approval_percent,
    check_approval_threshold.signed_shareholders,
    check_approval_threshold.total_shareholders
  INTO v_approval_percent, v_current_approvals, v_total_shareholders
  FROM check_approval_threshold(p_investment_id);
  
  -- Create notification
  INSERT INTO public.shareholder_notifications (
    investment_id,
    shareholder_id,
    shareholder_email,
    shareholder_name,
    notification_type,
    notification_status,
    pin_entry_required,
    pin_verified,
    approval_percent,
    notification_message,
    notification_sent_at
  ) VALUES (
    p_investment_id,
    p_shareholder_id,
    p_shareholder_email,
    p_shareholder_name,
    'pin_request',
    'sent',
    TRUE,
    FALSE,
    v_approval_percent,
    'Investment signature received. Please enter your PIN to verify your approval.',
    NOW()
  )
  RETURNING id INTO v_notification_id;
  
  RETURN QUERY SELECT v_notification_id, 'PIN request notification sent';
END;
$$ LANGUAGE plpgsql;

-- Step 6: Create function to finalize document when threshold met
CREATE OR REPLACE FUNCTION finalize_investment_document(p_investment_id UUID)
RETURNS TABLE (
  status TEXT,
  document_status VARCHAR,
  approval_percent DECIMAL,
  shareholders_remaining INT
) AS $$
DECLARE
  v_approval_percent DECIMAL;
  v_threshold_met BOOLEAN;
  v_signed_count INT;
  v_total_count INT;
BEGIN
  -- Check approval status
  SELECT
    check_approval_threshold.approval_percent,
    check_approval_threshold.threshold_met,
    check_approval_threshold.signed_shareholders,
    check_approval_threshold.total_shareholders
  INTO v_approval_percent, v_threshold_met, v_signed_count, v_total_count
  FROM check_approval_threshold(p_investment_id);
  
  IF v_threshold_met THEN
    -- Update approval record
    UPDATE public.investment_approvals
    SET
      approval_threshold_met = TRUE,
      approval_threshold_met_at = NOW(),
      document_status = 'ready_for_print',
      document_ready_at = NOW()
    WHERE investment_id = p_investment_id;
    
    -- Create document ready notifications for all shareholders
    INSERT INTO public.shareholder_notifications (
      investment_id,
      shareholder_id,
      shareholder_email,
      shareholder_name,
      notification_type,
      notification_status,
      approval_percent,
      approval_threshold_met,
      notification_message,
      notification_sent_at
    )
    SELECT
      p_investment_id,
      sig.signer_id,
      sig.signer_email,
      sig.signer_name,
      'document_ready',
      'sent',
      v_approval_percent,
      TRUE,
      'Investment agreement reached ' || ROUND(v_approval_percent::NUMERIC, 1) || '% approval! Document is ready for download and printing.',
      NOW()
    FROM public.investment_signatures sig
    WHERE sig.investment_id = p_investment_id
      AND sig.signer_type IN ('shareholder', 'founder')
    ON CONFLICT DO NOTHING;
    
    RETURN QUERY SELECT 
      '✅ Threshold reached! Document finalized for printing'::TEXT as status,
      'ready_for_print'::VARCHAR as document_status,
      v_approval_percent as approval_percent,
      0::INT as shareholders_remaining;
  ELSE
    RETURN QUERY SELECT 
      '⏳ Threshold not yet met. ' || (v_total_count - v_signed_count) || ' more signature(s) needed'::TEXT as status,
      'pending'::VARCHAR as document_status,
      v_approval_percent as approval_percent,
      (v_total_count - v_signed_count)::INT as shareholders_remaining;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Step 7: Enable RLS ONLY (policies added after functions)
ALTER TABLE public.investment_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investment_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shareholder_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investor_shares ENABLE ROW LEVEL SECURITY;

-- RLS Policies for investor_shares
DROP POLICY IF EXISTS "Investors can view their own shares" ON public.investor_shares;
DROP POLICY IF EXISTS "Investors can insert their own shares" ON public.investor_shares;

CREATE POLICY "Investors can view their own shares"
    ON public.investor_shares FOR SELECT
    USING (investor_id = auth.uid());

CREATE POLICY "Investors can insert their own shares"
    ON public.investor_shares FOR INSERT
    WITH CHECK (investor_id = auth.uid());

-- RLS Policies for investment_approvals
DROP POLICY IF EXISTS "Users can view investment approvals" ON public.investment_approvals;
DROP POLICY IF EXISTS "Users can insert investment approvals" ON public.investment_approvals;
DROP POLICY IF EXISTS "Users can update investment approvals" ON public.investment_approvals;

CREATE POLICY "Users can view investment approvals"
    ON public.investment_approvals FOR SELECT
    USING (investor_id = auth.uid() OR auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert investment approvals"
    ON public.investment_approvals FOR INSERT
    WITH CHECK (investor_id = auth.uid() OR auth.uid() IS NOT NULL);

CREATE POLICY "Users can update investment approvals"
    ON public.investment_approvals FOR UPDATE
    USING (investor_id = auth.uid());

-- =====================================================
-- INITIALIZE ESCROW WALLETS
-- =====================================================
-- Create or update the main escrow wallet for investment transfers
INSERT INTO public.agent_wallets (agent_id, agent_name, account_type, balance, currency, status)
VALUES ('AGENT-KAM-5560', 'Investment Escrow Account', 'escrow', 0, 'ICAN', 'active')
ON CONFLICT (agent_id) DO UPDATE SET
  status = 'active',
  updated_at = NOW();

