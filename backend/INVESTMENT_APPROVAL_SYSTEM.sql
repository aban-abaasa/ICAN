-- =====================================================
-- INVESTMENT APPROVAL SYSTEM SCHEMA
-- =====================================================
-- Complete approval workflow for investment agreements
-- Supporting 60% shareholder threshold for auto-sealing
-- =====================================================

-- =====================================================
-- DROP EXISTING OBJECTS (Clean slate for schema update)
-- =====================================================

DROP TRIGGER IF EXISTS trigger_auto_seal_on_new_signature ON investment_signatures CASCADE;
DROP TRIGGER IF EXISTS trigger_auto_seal_on_signature ON investment_signatures CASCADE;
DROP TRIGGER IF EXISTS trigger_auto_link_approval_on_investor_signature ON investment_signatures CASCADE;
DROP TRIGGER IF EXISTS update_signature_signed_at ON investment_signatures CASCADE;
DROP TRIGGER IF EXISTS update_approvals_updated_at ON investment_approvals CASCADE;
DROP TRIGGER IF EXISTS update_agreements_updated_at ON investment_agreements CASCADE;

DROP VIEW IF EXISTS investor_approval_status CASCADE;
DROP VIEW IF EXISTS pending_shareholder_approvals CASCADE;
DROP VIEW IF EXISTS agreement_approval_progress CASCADE;

DROP FUNCTION IF EXISTS auto_seal_agreement_on_signature() CASCADE;
DROP FUNCTION IF EXISTS auto_link_approval_to_agreement() CASCADE;
DROP FUNCTION IF EXISTS record_investor_investment(UUID, UUID, UUID, UUID, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL) CASCADE;
DROP FUNCTION IF EXISTS link_approval_to_agreement(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS update_signed_at_timestamp() CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
DROP FUNCTION IF EXISTS check_approval_threshold(UUID) CASCADE;
DROP FUNCTION IF EXISTS get_total_shareholders(UUID) CASCADE;
DROP FUNCTION IF EXISTS count_signed_signatures(UUID) CASCADE;

DROP TABLE IF EXISTS investment_approvals CASCADE;
DROP TABLE IF EXISTS investment_signatures CASCADE;
DROP TABLE IF EXISTS investment_agreements CASCADE;

-- =====================================================
-- CORE TABLES
-- =====================================================

-- Investment Agreements (Core deal records)
CREATE TABLE investment_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pitch_id UUID NOT NULL REFERENCES pitches(id) ON DELETE CASCADE,
  investor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_profile_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  
  -- Investment Details
  investment_type TEXT NOT NULL CHECK (investment_type IN ('buy', 'partner', 'support')),
  shares_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
  share_price DECIMAL(15, 2) NOT NULL,
  total_investment DECIMAL(15, 2) NOT NULL,
  
  -- Agreement Status & Escrow
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signing', 'sealed', 'cancelled')),
  escrow_id TEXT UNIQUE,
  escrow_recipient_wallet TEXT,
  
  -- Security
  device_id TEXT,
  device_location TEXT,
  investor_pin_hash TEXT,
  qr_code_url TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  sealed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Constraints
  CONSTRAINT valid_investment CHECK (total_investment > 0),
  CONSTRAINT valid_shares CHECK (shares_amount >= 0),
  CONSTRAINT valid_price CHECK (share_price > 0 OR investment_type != 'buy')
);

-- Investment Signatures (Shareholder approvals)
CREATE TABLE investment_signatures (
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
  
  -- Status & Classification
  is_business_owner BOOLEAN DEFAULT false,
  signature_status TEXT NOT NULL DEFAULT 'pending' CHECK (signature_status IN ('signed', 'pending', 'rejected')),
  rejection_reason TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  signed_at TIMESTAMP WITH TIME ZONE,
  
  -- Constraints
  UNIQUE(agreement_id, shareholder_id)
);

-- Investment Approvals (Tracking approval progress)
CREATE TABLE investment_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investment_id UUID NOT NULL UNIQUE,
  agreement_id UUID REFERENCES investment_agreements(id) ON DELETE SET NULL,
  business_profile_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  
  -- Investor Details
  investor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  investor_email TEXT NOT NULL,
  investor_signature_status TEXT DEFAULT 'pending' CHECK (investor_signature_status IN ('signed', 'pin_verified', 'pending')),
  investor_signed_at TIMESTAMP WITH TIME ZONE,
  
  -- Wallet Transfer Details
  wallet_account_number TEXT,
  transfer_amount DECIMAL(15, 2) NOT NULL,
  transfer_status TEXT DEFAULT 'pending' CHECK (transfer_status IN ('completed', 'pending', 'failed', 'reversed')),
  transfer_completed_at TIMESTAMP WITH TIME ZONE,
  transfer_reference TEXT UNIQUE,
  
  -- Shareholder Approval Tracking
  total_shareholders INTEGER DEFAULT 0,
  shareholders_signed INTEGER DEFAULT 0,
  approval_threshold_percent DECIMAL(5, 2) DEFAULT 60.0,
  approval_threshold_met BOOLEAN DEFAULT false,
  auto_sealed_at TIMESTAMP WITH TIME ZONE,
  
  -- Document Status
  document_status TEXT DEFAULT 'pending' CHECK (document_status IN ('pending', 'signed', 'finalized', 'cancelled')),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  approval_deadline TIMESTAMP WITH TIME ZONE
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

-- Investment Agreements Indexes
CREATE INDEX idx_agreements_pitch ON investment_agreements(pitch_id);
CREATE INDEX idx_agreements_investor ON investment_agreements(investor_id);
CREATE INDEX idx_agreements_business ON investment_agreements(business_profile_id);
CREATE INDEX idx_agreements_status ON investment_agreements(status);
CREATE INDEX idx_agreements_escrow ON investment_agreements(escrow_id);
CREATE INDEX idx_agreements_created ON investment_agreements(created_at DESC);

-- Investment Signatures Indexes
CREATE INDEX idx_signatures_agreement ON investment_signatures(agreement_id);
CREATE INDEX idx_signatures_shareholder ON investment_signatures(shareholder_id);
CREATE INDEX idx_signatures_status ON investment_signatures(signature_status);
CREATE INDEX idx_signatures_timestamp ON investment_signatures(signature_timestamp DESC);
CREATE INDEX idx_signatures_agreement_status ON investment_signatures(agreement_id, signature_status);

-- Investment Approvals Indexes
CREATE INDEX idx_approvals_investor ON investment_approvals(investor_id);
CREATE INDEX idx_approvals_business ON investment_approvals(business_profile_id);
CREATE INDEX idx_approvals_agreement ON investment_approvals(agreement_id);
CREATE INDEX idx_approvals_status ON investment_approvals(approval_threshold_met);
CREATE INDEX idx_approvals_transfer_ref ON investment_approvals(transfer_reference);
CREATE INDEX idx_approvals_created ON investment_approvals(created_at DESC);

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE investment_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_approvals ENABLE ROW LEVEL SECURITY;

-- Investment Agreements RLS Policies
DROP POLICY IF EXISTS "investors_view_own_agreements" ON investment_agreements;
CREATE POLICY "investors_view_own_agreements" ON investment_agreements
  FOR SELECT USING (auth.uid() = investor_id);

DROP POLICY IF EXISTS "business_owners_view_agreements" ON investment_agreements;
DROP POLICY IF EXISTS "shareholders_view_agreements" ON investment_agreements;
DROP POLICY IF EXISTS "investors_create_agreements" ON investment_agreements;
CREATE POLICY "investors_create_agreements" ON investment_agreements
  FOR INSERT WITH CHECK (auth.uid() = investor_id);

DROP POLICY IF EXISTS "investors_update_agreements" ON investment_agreements;
CREATE POLICY "investors_update_agreements" ON investment_agreements
  FOR UPDATE USING (auth.uid() = investor_id);

DROP POLICY IF EXISTS "system_update_agreements" ON investment_agreements;

-- Investment Signatures RLS Policies
DROP POLICY IF EXISTS "shareholders_view_own_signatures" ON investment_signatures;
CREATE POLICY "shareholders_view_own_signatures" ON investment_signatures
  FOR SELECT USING (auth.uid() = shareholder_id);

DROP POLICY IF EXISTS "investors_view_signatures" ON investment_signatures;
DROP POLICY IF EXISTS "business_owners_view_signatures" ON investment_signatures;
DROP POLICY IF EXISTS "shareholders_sign_agreements" ON investment_signatures;
CREATE POLICY "shareholders_sign_agreements" ON investment_signatures
  FOR INSERT WITH CHECK (auth.uid() = shareholder_id);

DROP POLICY IF EXISTS "shareholders_update_own_signatures" ON investment_signatures;
CREATE POLICY "shareholders_update_own_signatures" ON investment_signatures
  FOR UPDATE USING (auth.uid() = shareholder_id);

-- Investment Approvals RLS Policies
DROP POLICY IF EXISTS "investors_view_own_approvals" ON investment_approvals;
CREATE POLICY "investors_view_own_approvals" ON investment_approvals
  FOR SELECT USING (auth.uid() = investor_id);

DROP POLICY IF EXISTS "business_owners_view_approvals" ON investment_approvals;
DROP POLICY IF EXISTS "investors_create_approvals" ON investment_approvals;
CREATE POLICY "investors_create_approvals" ON investment_approvals
  FOR INSERT WITH CHECK (auth.uid() = investor_id);

DROP POLICY IF EXISTS "investors_update_approvals" ON investment_approvals;
CREATE POLICY "investors_update_approvals" ON investment_approvals
  FOR UPDATE USING (auth.uid() = investor_id);

DROP POLICY IF EXISTS "system_update_approvals" ON investment_approvals;

-- =====================================================
-- FUNCTIONS AND TRIGGERS
-- =====================================================

-- Update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_agreements_updated_at ON investment_agreements;
CREATE TRIGGER update_agreements_updated_at
  BEFORE UPDATE ON investment_agreements
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_approvals_updated_at ON investment_approvals;
CREATE TRIGGER update_approvals_updated_at
  BEFORE UPDATE ON investment_approvals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-update signed_at timestamp
CREATE OR REPLACE FUNCTION update_signed_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.signature_status = 'signed' AND OLD.signature_status != 'signed' THEN
    NEW.signed_at = CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_signature_signed_at ON investment_signatures;
CREATE TRIGGER update_signature_signed_at
  BEFORE UPDATE ON investment_signatures
  FOR EACH ROW
  EXECUTE FUNCTION update_signed_at_timestamp();

-- Count current signatures for agreement
CREATE OR REPLACE FUNCTION count_signed_signatures(agreement_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
  signed_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO signed_count
  FROM investment_signatures
  WHERE agreement_id = agreement_uuid 
  AND signature_status = 'signed';
  
  RETURN COALESCE(signed_count, 0);
END;
$$ LANGUAGE plpgsql;

-- Get total shareholders for business
CREATE OR REPLACE FUNCTION get_total_shareholders(business_id UUID)
RETURNS INTEGER AS $$
DECLARE
  total_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_count
  FROM business_co_owners
  WHERE business_profile_id = business_id
  AND (status = 'active' OR status IS NULL);
  
  RETURN COALESCE(total_count, 0);
END;
$$ LANGUAGE plpgsql;

-- Check if approval threshold (60%) is met
CREATE OR REPLACE FUNCTION check_approval_threshold(agreement_uuid UUID)
RETURNS BOOLEAN AS $$
DECLARE
  signed_count INTEGER;
  total_shareholders INTEGER;
  threshold_percent DECIMAL;
BEGIN
  SELECT count_signed_signatures(agreement_uuid) INTO signed_count;
  
  SELECT get_total_shareholders(ia.business_profile_id) 
  INTO total_shareholders
  FROM investment_agreements ia
  WHERE ia.id = agreement_uuid;
  
  IF total_shareholders = 0 THEN
    RETURN false;
  END IF;
  
  threshold_percent := (signed_count::DECIMAL / total_shareholders::DECIMAL) * 100;
  
  RETURN threshold_percent >= 60;
END;
$$ LANGUAGE plpgsql;

-- Link investment approval to agreement after investor signature
CREATE OR REPLACE FUNCTION link_approval_to_agreement(p_investment_id UUID, p_agreement_id UUID)
RETURNS TABLE(success BOOLEAN, message TEXT) AS $$
DECLARE
  v_updated_count INTEGER;
BEGIN
  UPDATE investment_approvals
  SET agreement_id = p_agreement_id
  WHERE investment_id = p_investment_id AND agreement_id IS NULL;
  
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  
  IF v_updated_count > 0 THEN
    RETURN QUERY SELECT true::BOOLEAN, 'Approval linked to agreement'::TEXT;
  ELSE
    RETURN QUERY SELECT false::BOOLEAN, 'No approval found to link'::TEXT;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Record investor signature in investment_agreements and investment_signatures
-- This function ensures investor is tracked correctly
CREATE OR REPLACE FUNCTION record_investor_investment(
  p_investment_id UUID,
  p_agreement_id UUID,
  p_investor_id UUID,
  p_business_profile_id UUID,
  p_pitch_id UUID,
  p_investment_type TEXT,
  p_shares_amount DECIMAL,
  p_share_price DECIMAL,
  p_total_investment DECIMAL
)
RETURNS TABLE(
  agreement_id UUID,
  signature_id UUID,
  success BOOLEAN,
  message TEXT
) AS $$
DECLARE
  v_agreement_id UUID;
  v_signature_id UUID;
  v_investor_email TEXT;
  v_investor_name TEXT;
BEGIN
  -- Get investor details
  SELECT email, COALESCE(raw_user_meta_data->>'full_name', email) 
  INTO v_investor_email, v_investor_name
  FROM auth.users
  WHERE id = p_investor_id;
  
  -- Update or create investment_agreements if it doesn't exist
  INSERT INTO investment_agreements (
    id, pitch_id, investor_id, business_profile_id,
    investment_type, shares_amount, share_price, total_investment,
    status, escrow_id, device_id, device_location
  )
  VALUES (
    p_agreement_id, p_pitch_id, p_investor_id, p_business_profile_id,
    p_investment_type, p_shares_amount, p_share_price, p_total_investment,
    'signing', p_investment_id, 'web_platform', 'in_app'
  )
  ON CONFLICT (id) DO UPDATE SET
    status = 'signing'
  RETURNING id INTO v_agreement_id;
  
  -- Record investor signature
  INSERT INTO investment_signatures (
    agreement_id, shareholder_id, shareholder_email, shareholder_name,
    signature_pin_hash, device_id, device_location, is_business_owner, signature_status
  )
  VALUES (
    v_agreement_id, p_investor_id, v_investor_email, v_investor_name,
    'INVESTOR_PIN_HASH', 'web_platform', 'in_app', false, 'signed'
  )
  ON CONFLICT (agreement_id, shareholder_id) DO UPDATE SET
    signature_status = 'signed',
    signature_timestamp = CURRENT_TIMESTAMP
  RETURNING id INTO v_signature_id;
  
  -- Link approval to this agreement
  UPDATE investment_approvals
  SET agreement_id = v_agreement_id
  WHERE investment_id = p_investment_id;
  
  RETURN QUERY SELECT 
    v_agreement_id,
    v_signature_id,
    true::BOOLEAN,
    'Investor investment recorded successfully'::TEXT;
    
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT 
    NULL::UUID,
    NULL::UUID,
    false::BOOLEAN,
    'Error recording investor investment: ' || SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- Auto-seal agreement when 60% threshold reached
CREATE OR REPLACE FUNCTION auto_seal_agreement_on_signature()
RETURNS TRIGGER AS $$
DECLARE
  threshold_met BOOLEAN;
  agreement_business_id UUID;
  signed_count INTEGER;
  total_shareholders INTEGER;
BEGIN
  -- Only process if signature is now signed
  IF NEW.signature_status = 'signed' AND (OLD IS NULL OR OLD.signature_status != 'signed') THEN
    
    -- Get agreement business profile ID first
    SELECT business_profile_id INTO agreement_business_id
    FROM investment_agreements 
    WHERE id = NEW.agreement_id;
    
    -- Check threshold
    SELECT check_approval_threshold(NEW.agreement_id) INTO threshold_met;
    
    -- Get current signature counts
    SELECT count_signed_signatures(NEW.agreement_id) INTO signed_count;
    SELECT get_total_shareholders(agreement_business_id) INTO total_shareholders;
    
    IF threshold_met THEN
      -- Update agreement status to sealed
      UPDATE investment_agreements
      SET status = 'sealed', sealed_at = CURRENT_TIMESTAMP
      WHERE id = NEW.agreement_id AND status = 'signing';
      
      -- Update approval record if exists
      UPDATE investment_approvals
      SET 
        approval_threshold_met = true,
        shareholders_signed = signed_count,
        total_shareholders = total_shareholders,
        auto_sealed_at = CURRENT_TIMESTAMP,
        document_status = 'finalized'
      WHERE agreement_id = NEW.agreement_id;
      
    ELSE
      -- Update approval counts even if threshold not met
      UPDATE investment_approvals
      SET 
        shareholders_signed = signed_count,
        total_shareholders = total_shareholders
      WHERE agreement_id = NEW.agreement_id;
      
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-seal on signature
DROP TRIGGER IF EXISTS trigger_auto_seal_on_signature ON investment_signatures;
CREATE TRIGGER trigger_auto_seal_on_signature
  AFTER UPDATE ON investment_signatures
  FOR EACH ROW
  EXECUTE FUNCTION auto_seal_agreement_on_signature();

-- Also trigger on INSERT for new signatures
DROP TRIGGER IF EXISTS trigger_auto_seal_on_new_signature ON investment_signatures;
CREATE TRIGGER trigger_auto_seal_on_new_signature
  AFTER INSERT ON investment_signatures
  FOR EACH ROW
  WHEN (NEW.signature_status = 'signed')
  EXECUTE FUNCTION auto_seal_agreement_on_signature();

-- Auto-link approval to agreement when investor signature is created
CREATE OR REPLACE FUNCTION auto_link_approval_to_agreement()
RETURNS TRIGGER AS $$
DECLARE
  v_investment_id UUID;
BEGIN
  -- Get the investment_id from the agreement's escrow_id
  SELECT escrow_id INTO v_investment_id
  FROM investment_agreements
  WHERE id = NEW.agreement_id;
  
  -- Link the approval record to this agreement
  UPDATE investment_approvals
  SET agreement_id = NEW.agreement_id
  WHERE investment_id = v_investment_id AND agreement_id IS NULL;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_auto_link_approval_on_investor_signature ON investment_signatures;
CREATE TRIGGER trigger_auto_link_approval_on_investor_signature
  AFTER INSERT ON investment_signatures
  FOR EACH ROW
  WHEN (NEW.is_business_owner = false)
  EXECUTE FUNCTION auto_link_approval_to_agreement();

-- =====================================================
-- VIEWS FOR APPROVAL TRACKING
-- =====================================================

-- View: Agreement approval progress
CREATE OR REPLACE VIEW agreement_approval_progress AS
SELECT
  ia.id as agreement_id,
  ia.escrow_id,
  ia.investor_id,
  ia.business_profile_id,
  ia.status,
  ia.created_at,
  COUNT(CASE WHEN isg.signature_status = 'signed' THEN 1 END) as signatures_signed,
  COUNT(DISTINCT isg.shareholder_id) as total_signatories,
  get_total_shareholders(ia.business_profile_id) as total_shareholders,
  ROUND(
    (COUNT(CASE WHEN isg.signature_status = 'signed' THEN 1 END)::DECIMAL / 
     NULLIF(get_total_shareholders(ia.business_profile_id), 0)::DECIMAL) * 100, 
    1
  ) as approval_percentage,
  CASE 
    WHEN (COUNT(CASE WHEN isg.signature_status = 'signed' THEN 1 END)::DECIMAL / 
          NULLIF(get_total_shareholders(ia.business_profile_id), 0)::DECIMAL) >= 0.60
    THEN true 
    ELSE false 
  END as threshold_met
FROM investment_agreements ia
LEFT JOIN investment_signatures isg ON ia.id = isg.agreement_id
GROUP BY ia.id, ia.escrow_id, ia.investor_id, ia.business_profile_id, ia.status, ia.created_at;

-- View: Pending approvals for shareholders
CREATE OR REPLACE VIEW pending_shareholder_approvals AS
SELECT
  ia.id as agreement_id,
  ia.escrow_id,
  ia.investor_id,
  ia.business_profile_id,
  ia.total_investment,
  ia.investment_type,
  ia.shares_amount,
  COUNT(DISTINCT bco.id) as total_shareholders_to_approve,
  COUNT(DISTINCT CASE WHEN isg.signature_status = 'signed' THEN bco.id END) as shareholders_approved,
  ARRAY_AGG(DISTINCT CASE WHEN isg.id IS NULL THEN bco.user_id END) as pending_shareholder_ids
FROM investment_agreements ia
JOIN business_co_owners bco ON ia.business_profile_id = bco.business_profile_id AND (bco.status = 'active' OR bco.status IS NULL)
LEFT JOIN investment_signatures isg ON ia.id = isg.agreement_id AND bco.user_id = isg.shareholder_id
WHERE ia.status = 'signing'
GROUP BY ia.id, ia.escrow_id, ia.investor_id, ia.business_profile_id, ia.total_investment, ia.investment_type, ia.shares_amount;

-- View: Investor approval tracking
CREATE OR REPLACE VIEW investor_approval_status AS
SELECT
  ia.id as agreement_id,
  ia.investor_id,
  ia.business_profile_id,
  ia.status as agreement_status,
  iapr.investor_signature_status,
  iapr.wallet_account_number,
  iapr.transfer_status,
  iapr.transfer_reference,
  iapr.shareholders_signed,
  iapr.total_shareholders,
  iapr.approval_threshold_percent,
  iapr.approval_threshold_met,
  iapr.document_status,
  CEIL(iapr.total_shareholders * (iapr.approval_threshold_percent / 100.0)) as required_approvals,
  CEIL(iapr.total_shareholders * (iapr.approval_threshold_percent / 100.0)) - iapr.shareholders_signed as remaining_approvals
FROM investment_agreements ia
LEFT JOIN investment_approvals iapr ON ia.id = iapr.agreement_id;

-- =====================================================
-- GRANT PERMISSIONS
-- =====================================================

GRANT SELECT, INSERT, UPDATE ON investment_agreements TO authenticated;
GRANT SELECT, INSERT, UPDATE ON investment_signatures TO authenticated;
GRANT SELECT, INSERT, UPDATE ON investment_approvals TO authenticated;

GRANT SELECT ON agreement_approval_progress TO authenticated;
GRANT SELECT ON pending_shareholder_approvals TO authenticated;
GRANT SELECT ON investor_approval_status TO authenticated;

GRANT EXECUTE ON FUNCTION check_approval_threshold(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION count_signed_signatures(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_total_shareholders(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION link_approval_to_agreement(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION record_investor_investment(UUID, UUID, UUID, UUID, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL) TO authenticated;

-- =====================================================
-- SUCCESS MESSAGE
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Investment Approval System Schema created successfully!';
  RAISE NOTICE '📊 Core Tables: investment_agreements, investment_signatures, investment_approvals';
  RAISE NOTICE '🔐 RLS enabled on all tables for multi-role access control';
  RAISE NOTICE '⚡ Auto-sealing triggers: 60%% threshold detection and auto-seal';
  RAISE NOTICE '📈 Approval tracking views: progress, pending, investor status';
  RAISE NOTICE '🎯 Functions: threshold checking, shareholder counting, signature counting';
END $$;
