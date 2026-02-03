-- =====================================================
-- INVESTMENT AGREEMENT NOTIFICATIONS SCHEMA
-- =====================================================
-- Enhanced notification system for investment agreements,
-- shareholder signatures, and document reviews
-- =====================================================

-- Drop existing tables if they exist
DROP TABLE IF EXISTS investment_signatures CASCADE;
DROP TABLE IF EXISTS investment_notifications CASCADE;
DROP TABLE IF EXISTS investment_agreements CASCADE;

-- Investment Agreements Table
CREATE TABLE IF NOT EXISTS investment_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pitch_id UUID REFERENCES pitches(id) ON DELETE CASCADE,
  investor_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  business_profile_id UUID REFERENCES business_profiles(id) ON DELETE CASCADE,
  
  -- Investment Details
  investment_type TEXT NOT NULL CHECK (investment_type IN ('buy', 'partner', 'support')),
  shares_amount DECIMAL(15, 2) NOT NULL,
  share_price DECIMAL(15, 2) NOT NULL,
  total_investment DECIMAL(15, 2) NOT NULL,
  
  -- Agreement Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'signing', 'sealed', 'cancelled')),
  escrow_id TEXT UNIQUE,
  qr_code_url TEXT,
  
  -- Machine Data
  device_id TEXT,
  device_location TEXT,
  investor_pin_hash TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  sealed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT valid_amounts CHECK (shares_amount > 0 AND total_investment > 0)
);

-- Investment Signatures Table
CREATE TABLE IF NOT EXISTS investment_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID REFERENCES investment_agreements(id) ON DELETE CASCADE,
  shareholder_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  shareholder_name TEXT NOT NULL,
  shareholder_email TEXT NOT NULL,
  
  -- Signature Details
  signature_pin_hash TEXT NOT NULL,
  signature_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  device_id TEXT,
  device_location TEXT,
  
  -- Status
  is_business_owner BOOLEAN DEFAULT false,
  signature_status TEXT DEFAULT 'signed' CHECK (signature_status IN ('signed', 'pending', 'rejected')),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Prevent duplicate signatures
  UNIQUE(agreement_id, shareholder_id)
);

-- Investment Notifications Table (Enhanced)
CREATE TABLE IF NOT EXISTS investment_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Notification Content
  notification_type TEXT NOT NULL CHECK (notification_type IN (
    'new_investment',
    'signature_request',
    'signature_completed',
    'agreement_sealed',
    'document_review',
    'escrow_released',
    'shareholder_added'
  )),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  
  -- Related Entities
  agreement_id UUID REFERENCES investment_agreements(id) ON DELETE CASCADE,
  pitch_id UUID REFERENCES pitches(id) ON DELETE CASCADE,
  business_profile_id UUID REFERENCES business_profiles(id) ON DELETE CASCADE,
  
  -- Notification State
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMP WITH TIME ZONE,
  
  -- Priority
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  
  -- Action URL (for deep linking)
  action_url TEXT,
  action_label TEXT,
  
  -- Metadata (JSON for flexible data)
  metadata JSONB DEFAULT '{}'::jsonb,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_agreements_pitch ON investment_agreements(pitch_id);
CREATE INDEX IF NOT EXISTS idx_agreements_investor ON investment_agreements(investor_id);
CREATE INDEX IF NOT EXISTS idx_agreements_status ON investment_agreements(status);
CREATE INDEX IF NOT EXISTS idx_agreements_created ON investment_agreements(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signatures_agreement ON investment_signatures(agreement_id);
CREATE INDEX IF NOT EXISTS idx_signatures_shareholder ON investment_signatures(shareholder_id);
CREATE INDEX IF NOT EXISTS idx_signatures_timestamp ON investment_signatures(signature_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON investment_notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON investment_notifications(notification_type);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON investment_notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON investment_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_agreement ON investment_notifications(agreement_id);

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE investment_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_notifications ENABLE ROW LEVEL SECURITY;

-- Investment Agreements Policies
DROP POLICY IF EXISTS "Users can view agreements they're involved in" ON investment_agreements;
CREATE POLICY "Users can view agreements they're involved in" ON investment_agreements
  FOR SELECT USING (
    auth.uid() = investor_id OR
    auth.uid() IN (
      SELECT user_id FROM business_profiles WHERE id = business_profile_id
    ) OR
    auth.uid() IN (
      SELECT shareholder_id FROM investment_signatures WHERE agreement_id = id
    )
  );

DROP POLICY IF EXISTS "Investors can create agreements" ON investment_agreements;
CREATE POLICY "Investors can create agreements" ON investment_agreements
  FOR INSERT WITH CHECK (auth.uid() = investor_id);

DROP POLICY IF EXISTS "Investors can update their agreements" ON investment_agreements;
CREATE POLICY "Investors can update their agreements" ON investment_agreements
  FOR UPDATE USING (auth.uid() = investor_id);

-- Investment Signatures Policies
DROP POLICY IF EXISTS "Users can view signatures for their agreements" ON investment_signatures;
CREATE POLICY "Users can view signatures for their agreements" ON investment_signatures
  FOR SELECT USING (
    auth.uid() = shareholder_id OR
    auth.uid() IN (
      SELECT investor_id FROM investment_agreements WHERE id = agreement_id
    )
  );

DROP POLICY IF EXISTS "Shareholders can sign agreements" ON investment_signatures;
CREATE POLICY "Shareholders can sign agreements" ON investment_signatures
  FOR INSERT WITH CHECK (auth.uid() = shareholder_id);

-- Investment Notifications Policies
DROP POLICY IF EXISTS "Users can view their own notifications" ON investment_notifications;
CREATE POLICY "Users can view their own notifications" ON investment_notifications
  FOR SELECT USING (auth.uid() = recipient_id);

DROP POLICY IF EXISTS "Users can update their own notifications" ON investment_notifications;
CREATE POLICY "Users can update their own notifications" ON investment_notifications
  FOR UPDATE USING (auth.uid() = recipient_id);

DROP POLICY IF EXISTS "System can create notifications" ON investment_notifications;
CREATE POLICY "System can create notifications" ON investment_notifications
  FOR INSERT WITH CHECK (true);

-- =====================================================
-- FUNCTIONS AND TRIGGERS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for investment_agreements
DROP TRIGGER IF EXISTS update_investment_agreements_updated_at ON investment_agreements;
CREATE TRIGGER update_investment_agreements_updated_at
    BEFORE UPDATE ON investment_agreements
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to check if agreement has 60% signatures
CREATE OR REPLACE FUNCTION check_signature_threshold(agreement_uuid UUID)
RETURNS BOOLEAN AS $$
DECLARE
  signature_count INTEGER;
  total_shareholders INTEGER;
  threshold_percentage DECIMAL;
BEGIN
  -- Count signatures
  SELECT COUNT(*) INTO signature_count
  FROM investment_signatures
  WHERE agreement_id = agreement_uuid AND signature_status = 'signed';
  
  -- For now, assume 12 total shareholders (in real app, get from business profile)
  total_shareholders := 12;
  
  -- Calculate percentage
  threshold_percentage := (signature_count::DECIMAL / total_shareholders::DECIMAL) * 100;
  
  RETURN threshold_percentage >= 60;
END;
$$ LANGUAGE plpgsql;

-- Function to auto-seal agreement when 60% threshold reached
CREATE OR REPLACE FUNCTION auto_seal_agreement()
RETURNS TRIGGER AS $$
DECLARE
  is_threshold_met BOOLEAN;
BEGIN
  -- Check if threshold is met
  SELECT check_signature_threshold(NEW.agreement_id) INTO is_threshold_met;
  
  IF is_threshold_met THEN
    -- Update agreement status to sealed
    UPDATE investment_agreements
    SET status = 'sealed', sealed_at = CURRENT_TIMESTAMP
    WHERE id = NEW.agreement_id AND status = 'signing';
    
    -- Create notification for investor
    INSERT INTO investment_notifications (
      recipient_id,
      sender_id,
      notification_type,
      title,
      message,
      agreement_id,
      priority,
      action_label,
      metadata
    )
    SELECT
      investor_id,
      NULL,
      'agreement_sealed',
      '🎉 Investment Agreement Sealed!',
      'Your investment agreement has reached 60% shareholder approval and has been sealed.',
      id,
      'high',
      'View Agreement',
      jsonb_build_object(
        'escrow_id', escrow_id,
        'total_investment', total_investment,
        'shares_amount', shares_amount
      )
    FROM investment_agreements
    WHERE id = NEW.agreement_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-seal when signature threshold met
DROP TRIGGER IF EXISTS trigger_auto_seal_agreement ON investment_signatures;
CREATE TRIGGER trigger_auto_seal_agreement
    AFTER INSERT ON investment_signatures
    FOR EACH ROW
    EXECUTE FUNCTION auto_seal_agreement();

-- Function to notify shareholders when new signature request
CREATE OR REPLACE FUNCTION notify_shareholders_signature_request()
RETURNS TRIGGER AS $$
BEGIN
  -- Notify all shareholders (business profile members)
  INSERT INTO investment_notifications (
    recipient_id,
    sender_id,
    notification_type,
    title,
    message,
    agreement_id,
    pitch_id,
    business_profile_id,
    priority,
    action_label
  )
  SELECT
    bp_members.user_id,
    NEW.investor_id,
    'signature_request',
    '✍️ New Signature Request',
    'A new investment agreement requires your signature.',
    NEW.id,
    NEW.pitch_id,
    NEW.business_profile_id,
    'high',
    'Review & Sign'
  FROM business_profile_members bp_members
  WHERE bp_members.business_profile_id = NEW.business_profile_id
  AND bp_members.user_id != NEW.investor_id; -- Don't notify investor
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to notify shareholders
DROP TRIGGER IF EXISTS trigger_notify_shareholders ON investment_agreements;
CREATE TRIGGER trigger_notify_shareholders
    AFTER INSERT ON investment_agreements
    FOR EACH ROW
    WHEN (NEW.status = 'signing')
    EXECUTE FUNCTION notify_shareholders_signature_request();

-- =====================================================
-- SAMPLE DATA (Optional - for testing)
-- =====================================================

-- Note: Comment out in production
/*
-- Sample notifications for testing
INSERT INTO investment_notifications (
  recipient_id,
  notification_type,
  title,
  message,
  priority
) VALUES
(
  (SELECT id FROM auth.users LIMIT 1),
  'new_investment',
  'New Investment Opportunity',
  'A new investment opportunity is available for your review.',
  'normal'
);
*/

-- =====================================================
-- HELPER VIEWS
-- =====================================================

-- View for unread notifications count
CREATE OR REPLACE VIEW unread_notifications_count AS
SELECT
  recipient_id,
  COUNT(*) as unread_count
FROM investment_notifications
WHERE is_read = false
GROUP BY recipient_id;

-- View for agreement signatures progress
CREATE OR REPLACE VIEW agreement_signatures_progress AS
SELECT
  ia.id as agreement_id,
  ia.escrow_id,
  ia.status,
  COUNT(isg.id) as signatures_count,
  12 as total_required, -- Replace with dynamic count from business profile
  ROUND((COUNT(isg.id)::DECIMAL / 12::DECIMAL) * 100, 2) as completion_percentage
FROM investment_agreements ia
LEFT JOIN investment_signatures isg ON ia.id = isg.agreement_id AND isg.signature_status = 'signed'
GROUP BY ia.id, ia.escrow_id, ia.status;

-- =====================================================
-- GRANT PERMISSIONS
-- =====================================================

-- Grant access to authenticated users
GRANT SELECT, INSERT, UPDATE ON investment_agreements TO authenticated;
GRANT SELECT, INSERT ON investment_signatures TO authenticated;
GRANT SELECT, UPDATE ON investment_notifications TO authenticated;

GRANT SELECT ON agreement_signatures_progress TO authenticated;
GRANT SELECT ON unread_notifications_count TO authenticated;

-- =====================================================
-- SUCCESS MESSAGE
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Investment Notifications Schema created successfully!';
  RAISE NOTICE '📊 Tables: investment_agreements, investment_signatures, investment_notifications';
  RAISE NOTICE '🔐 RLS policies enabled for all tables';
  RAISE NOTICE '⚡ Real-time triggers configured for auto-sealing and notifications';
  RAISE NOTICE '📈 Helper views created for analytics';
END $$;
