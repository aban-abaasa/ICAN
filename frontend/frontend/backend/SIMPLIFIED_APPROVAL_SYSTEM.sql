-- =====================================================
-- SIMPLIFIED APPROVAL SYSTEM SCHEMA
-- =====================================================
-- All members are shareholders (no non-shareholder members)
-- Focus: Investment approval workflow only
-- =====================================================

-- =====================================================
-- TABLE 1: INVESTMENT_AGREEMENTS
-- =====================================================
-- Core agreement between investor and business

CREATE TABLE IF NOT EXISTS investment_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  investor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  investor_email VARCHAR(255),
  
  -- Investment details
  pitch_id UUID,
  amount DECIMAL(20, 2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'UGX',
  equity_share DECIMAL(5, 2), -- Percentage (0-100)
  
  -- Agreement status
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'sealed', 'completed', 'cancelled'
  escrow_id UUID,
  
  -- Shareholder approval tracking
  approval_threshold DECIMAL(3, 1) DEFAULT 60.0, -- 60% required
  approved_shareholder_count INT DEFAULT 0,
  total_shareholder_count INT DEFAULT 0,
  
  -- Timeline
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  sealed_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ia_business_profile_id ON investment_agreements(business_profile_id);
CREATE INDEX IF NOT EXISTS idx_ia_investor_id ON investment_agreements(investor_id);
CREATE INDEX IF NOT EXISTS idx_ia_status ON investment_agreements(status);
CREATE INDEX IF NOT EXISTS idx_ia_pitch_id ON investment_agreements(pitch_id);

-- RLS
ALTER TABLE investment_agreements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ia_all" ON investment_agreements;
CREATE POLICY "ia_all"
  ON investment_agreements
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- TABLE 2: SHAREHOLDER_NOTIFICATIONS
-- =====================================================
-- Investment approval requests sent to shareholders
-- One notification per shareholder per investment

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
  notification_type VARCHAR(100), -- 'investment_signed', etc.
  notification_title VARCHAR(255) NOT NULL,
  notification_message TEXT,
  investment_amount DECIMAL(20, 2),
  investment_currency VARCHAR(10) DEFAULT 'UGX',
  investment_shares DECIMAL(10, 4),
  
  -- Delivery method
  notification_sent_via VARCHAR(50) DEFAULT 'in_app', -- 'in_app', 'email', 'sms'
  
  -- Approval status
  read_at TIMESTAMP WITH TIME ZONE, -- When shareholder saw it
  approved_at TIMESTAMP WITH TIME ZONE, -- When shareholder approved
  
  -- Metadata
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
-- TABLE 3: INVESTMENT_NOTIFICATIONS
-- =====================================================
-- Notifications for investors and business owners

CREATE TABLE IF NOT EXISTS investment_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID REFERENCES business_profiles(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  notification_type VARCHAR(100), -- 'investment_created', 'investment_approved', 'threshold_reached', etc.
  title VARCHAR(255),
  message TEXT,
  agreement_id UUID REFERENCES investment_agreements(id) ON DELETE CASCADE,
  pitch_id UUID,
  
  priority VARCHAR(50) DEFAULT 'normal', -- 'high', 'normal', 'low'
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
SELECT 'shareholder_notifications', COUNT(*) FROM shareholder_notifications
UNION ALL
SELECT 'investment_notifications', COUNT(*) FROM investment_notifications;

-- =====================================================
-- ✅ SIMPLIFIED APPROVAL SYSTEM CREATED
-- =====================================================
-- 3 core tables:
-- 1. investment_agreements - The investment deal
-- 2. shareholder_notifications - Requests sent to shareholders
-- 3. investment_notifications - Updates to investors/business owners
-- 
-- Workflow:
-- 1. Investor creates investment → creates investment_agreement
-- 2. System creates shareholder_notifications (one per shareholder)
-- 3. Shareholders approve by setting approved_at
-- 4. When 60% approve → agreement auto-seals
-- 5. investment_notifications track milestone updates
