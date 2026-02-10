-- =====================================================
-- COMPREHENSIVE APPROVAL SYSTEM SCHEMA
-- =====================================================
-- Fresh creation with all required tables
-- =====================================================

-- =====================================================
-- TABLE 1: SHAREHOLDER_NOTIFICATIONS
-- =====================================================
-- Stores investment approval requests sent to shareholders
-- One notification per shareholder per investment

CREATE TABLE IF NOT EXISTS shareholder_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  shareholder_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  shareholder_email VARCHAR(255) NOT NULL,
  shareholder_name VARCHAR(255),
  
  -- Investment details
  investment_agreement_id UUID,
  notification_title VARCHAR(255) NOT NULL,
  notification_message TEXT,
  investment_amount DECIMAL(20, 2),
  investment_currency VARCHAR(10) DEFAULT 'UGX',
  
  -- Approval status
  read_at TIMESTAMP WITH TIME ZONE,
  approved_at TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sn_business_profile_id ON shareholder_notifications(business_profile_id);
CREATE INDEX IF NOT EXISTS idx_sn_shareholder_id ON shareholder_notifications(shareholder_id);
CREATE INDEX IF NOT EXISTS idx_sn_read_at ON shareholder_notifications(read_at);

-- RLS
ALTER TABLE shareholder_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sn_all" ON shareholder_notifications;
CREATE POLICY "sn_all"
  ON shareholder_notifications
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- TABLE 2: PENDING_EDITS
-- =====================================================
-- Stores proposed changes requiring member approval
-- Used for: Add member, remove member, update member, investment signed

CREATE TABLE IF NOT EXISTS pending_edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  
  -- Who proposed the change
  proposed_by_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  proposed_by_email VARCHAR(255) NOT NULL,
  proposed_by_name VARCHAR(255),
  
  -- What is being changed
  edit_type VARCHAR(100) NOT NULL, -- 'add_member', 'remove_member', 'update_member', 'investment_signed'
  field_name VARCHAR(255),
  old_value JSONB,
  new_value JSONB,
  description TEXT,
  
  -- Approval tracking
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'expired'
  approval_required_count INT DEFAULT 1,
  approval_received_count INT DEFAULT 0,
  
  -- Timeline
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  finalized_at TIMESTAMP WITH TIME ZONE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pe_business_profile_id ON pending_edits(business_profile_id);
CREATE INDEX IF NOT EXISTS idx_pe_status ON pending_edits(status);
CREATE INDEX IF NOT EXISTS idx_pe_created_at ON pending_edits(created_at);

-- RLS
ALTER TABLE pending_edits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pe_all" ON pending_edits;
CREATE POLICY "pe_all"
  ON pending_edits
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- TABLE 3: MEMBER_APPROVALS
-- =====================================================
-- Stores individual member approvals for pending edits
-- One row per member per pending edit

CREATE TABLE IF NOT EXISTS member_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_edit_id UUID NOT NULL REFERENCES pending_edits(id) ON DELETE CASCADE,
  
  -- Member who is approving
  member_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  member_email VARCHAR(255) NOT NULL,
  member_name VARCHAR(255),
  
  -- Approval status
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  comment TEXT,
  responded_at TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ma_pending_edit_id ON member_approvals(pending_edit_id);
CREATE INDEX IF NOT EXISTS idx_ma_member_id ON member_approvals(member_id);
CREATE INDEX IF NOT EXISTS idx_ma_status ON member_approvals(status);

-- RLS
ALTER TABLE member_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ma_all" ON member_approvals;
CREATE POLICY "ma_all"
  ON member_approvals
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- TABLE 4: INVESTMENT_AGREEMENTS
-- =====================================================
-- Stores investment agreements between investor and business

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
-- TABLE 5: INVESTMENT_APPROVALS
-- =====================================================
-- Stores individual shareholder approvals for investments

CREATE TABLE IF NOT EXISTS investment_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID NOT NULL REFERENCES investment_agreements(id) ON DELETE CASCADE,
  shareholder_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  shareholder_email VARCHAR(255) NOT NULL,
  
  -- Approval status
  approval_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  approved_at TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_invappr_agreement_id ON investment_approvals(agreement_id);
CREATE INDEX IF NOT EXISTS idx_invappr_shareholder_id ON investment_approvals(shareholder_id);
CREATE INDEX IF NOT EXISTS idx_invappr_status ON investment_approvals(approval_status);

-- RLS
ALTER TABLE investment_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invappr_all" ON investment_approvals;
CREATE POLICY "invappr_all"
  ON investment_approvals
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- TABLE 6: INVESTMENT_NOTIFICATIONS
-- =====================================================
-- Notifications for investors and business owners

CREATE TABLE IF NOT EXISTS investment_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID REFERENCES business_profiles(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  notification_type VARCHAR(100), -- 'investment_created', 'investment_approved', etc.
  title VARCHAR(255),
  message TEXT,
  agreement_id UUID,
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

SELECT 
  'shareholder_notifications' as table_name,
  COUNT(*) as row_count
FROM shareholder_notifications
UNION ALL
SELECT 'pending_edits', COUNT(*) FROM pending_edits
UNION ALL
SELECT 'member_approvals', COUNT(*) FROM member_approvals
UNION ALL
SELECT 'investment_agreements', COUNT(*) FROM investment_agreements
UNION ALL
SELECT 'investment_approvals', COUNT(*) FROM investment_approvals
UNION ALL
SELECT 'investment_notifications', COUNT(*) FROM investment_notifications;

-- =====================================================
-- ✅ APPROVAL SYSTEM SCHEMA CREATED
-- =====================================================
