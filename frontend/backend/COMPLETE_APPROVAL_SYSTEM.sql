-- =====================================================
-- COMPLETE APPROVAL SYSTEM SCHEMA
-- =====================================================
-- Matches frontend requirements exactly
-- Supports 60% shareholder threshold for auto-sealing
-- =====================================================

-- =====================================================
-- TABLE 1: INVESTMENT_AGREEMENTS
-- =====================================================
-- Core agreement between investor and business

CREATE TABLE IF NOT EXISTS investment_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pitch_id UUID NOT NULL REFERENCES pitches(id) ON DELETE CASCADE,
  investor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_profile_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  
  -- Investment Details (MATCHES FRONTEND)
  investment_type TEXT NOT NULL CHECK (investment_type IN ('buy', 'partner', 'support')),
  shares_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
  share_price DECIMAL(15, 2) NOT NULL,
  total_investment DECIMAL(15, 2) NOT NULL,
  
  -- Agreement Status & Escrow
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signing', 'sealed', 'cancelled')),
  escrow_id TEXT UNIQUE,
  
  -- Security (MATCHES FRONTEND)
  device_id TEXT,
  device_location TEXT,
  investor_pin_hash TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  sealed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Constraints
  CONSTRAINT valid_investment CHECK (total_investment > 0),
  CONSTRAINT valid_shares CHECK (shares_amount >= 0),
  CONSTRAINT valid_price CHECK (share_price > 0 OR investment_type != 'buy')
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ia_pitch_id ON investment_agreements(pitch_id);
CREATE INDEX IF NOT EXISTS idx_ia_investor_id ON investment_agreements(investor_id);
CREATE INDEX IF NOT EXISTS idx_ia_business_profile_id ON investment_agreements(business_profile_id);
CREATE INDEX IF NOT EXISTS idx_ia_status ON investment_agreements(status);
CREATE INDEX IF NOT EXISTS idx_ia_escrow_id ON investment_agreements(escrow_id);
CREATE INDEX IF NOT EXISTS idx_ia_created_at ON investment_agreements(created_at DESC);

-- RLS
ALTER TABLE investment_agreements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ia_all" ON investment_agreements;
CREATE POLICY "ia_all"
  ON investment_agreements
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- TABLE 2: INVESTMENT_SIGNATURES
-- =====================================================
-- Shareholder approvals/signatures

CREATE TABLE IF NOT EXISTS investment_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID NOT NULL REFERENCES investment_agreements(id) ON DELETE CASCADE,
  shareholder_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shareholder_name TEXT NOT NULL,
  shareholder_email TEXT NOT NULL,
  
  -- Signature Details
  signature_pin_hash TEXT NOT NULL,
  signature_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  device_id TEXT,
  device_location TEXT,
  
  -- Status
  is_business_owner BOOLEAN DEFAULT false,
  signature_status TEXT NOT NULL DEFAULT 'pending' CHECK (signature_status IN ('signed', 'pending', 'rejected')),
  rejection_reason TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  signed_at TIMESTAMP WITH TIME ZONE,
  
  -- Constraint: One signature per shareholder per agreement
  UNIQUE(agreement_id, shareholder_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_is_agreement_id ON investment_signatures(agreement_id);
CREATE INDEX IF NOT EXISTS idx_is_shareholder_id ON investment_signatures(shareholder_id);
CREATE INDEX IF NOT EXISTS idx_is_signature_status ON investment_signatures(signature_status);
CREATE INDEX IF NOT EXISTS idx_is_agreement_status ON investment_signatures(agreement_id, signature_status);

-- RLS
ALTER TABLE investment_signatures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "is_all" ON investment_signatures;
CREATE POLICY "is_all"
  ON investment_signatures
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- TABLE 3: SHAREHOLDER_NOTIFICATIONS
-- =====================================================
-- Notifications sent to shareholders for approval

CREATE TABLE IF NOT EXISTS shareholder_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  agreement_id UUID REFERENCES investment_agreements(id) ON DELETE CASCADE,
  
  shareholder_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  shareholder_email VARCHAR(255) NOT NULL,
  shareholder_name VARCHAR(255),
  
  -- Investor details
  investor_name VARCHAR(255),
  investor_email VARCHAR(255),
  
  -- Investment details
  notification_type VARCHAR(100),
  notification_title VARCHAR(255) NOT NULL,
  notification_message TEXT,
  investment_amount DECIMAL(20, 2),
  investment_currency VARCHAR(10) DEFAULT 'UGX',
  investment_shares DECIMAL(10, 4),
  
  -- Delivery
  notification_sent_via VARCHAR(50) DEFAULT 'in_app',
  
  -- Approval tracking
  read_at TIMESTAMP WITH TIME ZONE,
  approved_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sn_business_profile_id ON shareholder_notifications(business_profile_id);
CREATE INDEX IF NOT EXISTS idx_sn_agreement_id ON shareholder_notifications(agreement_id);
CREATE INDEX IF NOT EXISTS idx_sn_shareholder_id ON shareholder_notifications(shareholder_id);
CREATE INDEX IF NOT EXISTS idx_sn_read_at ON shareholder_notifications(read_at);
CREATE INDEX IF NOT EXISTS idx_sn_approved_at ON shareholder_notifications(approved_at);

-- RLS
ALTER TABLE shareholder_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sn_all" ON shareholder_notifications;
CREATE POLICY "sn_all"
  ON shareholder_notifications
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- TABLE 4: INVESTMENT_NOTIFICATIONS
-- =====================================================
-- Notifications for investors and business owners

CREATE TABLE IF NOT EXISTS investment_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID REFERENCES business_profiles(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  notification_type VARCHAR(100),
  title VARCHAR(255),
  message TEXT,
  agreement_id UUID REFERENCES investment_agreements(id) ON DELETE CASCADE,
  pitch_id UUID,
  
  priority VARCHAR(50) DEFAULT 'normal',
  action_url TEXT,
  action_label VARCHAR(100),
  metadata JSONB,
  
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_invnotif_business_profile_id ON investment_notifications(business_profile_id);
CREATE INDEX IF NOT EXISTS idx_invnotif_recipient_id ON investment_notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_invnotif_agreement_id ON investment_notifications(agreement_id);

-- RLS
ALTER TABLE investment_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invnotif_all" ON investment_notifications;
CREATE POLICY "invnotif_all"
  ON investment_notifications
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- VERIFICATION
-- =====================================================

SELECT 'investment_agreements' as table_name, COUNT(*) as row_count
FROM investment_agreements
UNION ALL
SELECT 'investment_signatures', COUNT(*) FROM investment_signatures
UNION ALL
SELECT 'shareholder_notifications', COUNT(*) FROM shareholder_notifications
UNION ALL
SELECT 'investment_notifications', COUNT(*) FROM investment_notifications;

-- =====================================================
-- ✅ COMPLETE APPROVAL SYSTEM CREATED
-- =====================================================
-- 4 core tables:
-- 1. investment_agreements - The investment deal (with all frontend fields)
-- 2. investment_signatures - Shareholder signatures/approvals
-- 3. shareholder_notifications - Approval requests sent to shareholders
-- 4. investment_notifications - Updates to investors/business owners
-- 
-- Workflow:
-- 1. Investor creates investment_agreement
-- 2. System creates investment_signatures (one per shareholder)
-- 3. System creates shareholder_notifications (one per shareholder)
-- 4. Shareholders sign (update investment_signatures.signature_status = 'signed')
-- 5. When 60% have signed → agreement auto-seals
-- 6. investment_notifications track milestone updates
