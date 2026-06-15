-- =====================================================
-- INVESTMENT SIGNING WORKFLOW WITH PIN VERIFICATION
-- =====================================================
-- This script sets up the complete investment signing flow:
-- 1. Investor signs → Money moves to wallet
-- 2. Shareholders receive notifications → Enter PIN
-- 3. 60% threshold triggers document finalization
-- 4. Print-ready document sent to all shareholders

-- Step 1: Create investment_signatures table (for tracking signatures)
CREATE TABLE IF NOT EXISTS public.investment_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investment_id UUID REFERENCES public.investment_agreements(id) ON DELETE CASCADE,
  business_profile_id UUID REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  signer_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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
  signature_data JSONB, -- Contains signature image/verification data
  ip_address INET,
  device_info TEXT,
  
  -- Document Link
  document_link TEXT,
  document_download_token TEXT,
  
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_investment_signatures_investment_id ON public.investment_signatures(investment_id);
CREATE INDEX idx_investment_signatures_signer_id ON public.investment_signatures(signer_id);
CREATE INDEX idx_investment_signatures_status ON public.investment_signatures(signature_status);

-- Step 2: Create investment_approvals table (track approval progress)
CREATE TABLE IF NOT EXISTS public.investment_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investment_id UUID UNIQUE REFERENCES public.investment_agreements(id) ON DELETE CASCADE,
  business_profile_id UUID REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  
  -- Investor Info
  investor_id UUID REFERENCES auth.users(id),
  investor_email VARCHAR(255),
  investor_signature_status VARCHAR(50) DEFAULT 'pending',
  investor_signed_at TIMESTAMP WITH TIME ZONE,
  
  -- Wallet Transfer
  wallet_account_id UUID REFERENCES public.user_accounts(id),
  wallet_account_number VARCHAR(50), -- e.g., AGENT-KAM-5560
  transfer_amount DECIMAL(18, 8),
  transfer_status VARCHAR(50) DEFAULT 'pending', -- pending, completed, failed
  transfer_completed_at TIMESTAMP WITH TIME ZONE,
  transfer_reference TEXT,
  
  -- Shareholder Approvals
  total_shareholders INTEGER,
  shareholders_signed INTEGER DEFAULT 0,
  approval_threshold_percent DECIMAL(5, 2) DEFAULT 60.00,
  approval_threshold_met BOOLEAN DEFAULT FALSE,
  approval_threshold_met_at TIMESTAMP WITH TIME ZONE,
  
  -- Document Status
  document_status VARCHAR(50) DEFAULT 'pending', -- pending, ready_for_print, printed, archived
  document_ready_at TIMESTAMP WITH TIME ZONE,
  document_link TEXT,
  
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_investment_approvals_investment_id ON public.investment_approvals(investment_id);
CREATE INDEX idx_investment_approvals_approval_threshold ON public.investment_approvals(approval_threshold_met);

-- Step 3: Create shareholder_notifications table (for PIN entry notifications)
CREATE TABLE IF NOT EXISTS public.shareholder_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investment_id UUID REFERENCES public.investment_agreements(id) ON DELETE CASCADE,
  shareholder_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  shareholder_email VARCHAR(255),
  shareholder_name VARCHAR(255),
  
  -- Notification Status
  notification_type VARCHAR(50), -- 'pin_request', 'approval_complete', 'document_ready'
  notification_status VARCHAR(50) DEFAULT 'pending', -- pending, sent, read, actioned
  
  -- PIN Verification
  pin_entry_required BOOLEAN DEFAULT FALSE,
  pin_verified BOOLEAN DEFAULT FALSE,
  pin_verified_at TIMESTAMP WITH TIME ZONE,
  pin_attempts INTEGER DEFAULT 0,
  pin_locked_until TIMESTAMP WITH TIME ZONE,
  
  -- Approval Progress
  approval_percent DECIMAL(5, 2), -- Current approval percentage when notification sent
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

CREATE INDEX idx_shareholder_notifications_investment_id ON public.shareholder_notifications(investment_id);
CREATE INDEX idx_shareholder_notifications_shareholder_id ON public.shareholder_notifications(shareholder_id);
CREATE INDEX idx_shareholder_notifications_status ON public.shareholder_notifications(notification_status);

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

-- Step 7: Enable RLS
ALTER TABLE public.investment_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investment_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shareholder_notifications ENABLE ROW LEVEL SECURITY;

-- Step 8: Create RLS Policies
CREATE POLICY "Users can view their signatures"
  ON public.investment_signatures FOR SELECT
  USING (auth.uid() = signer_id OR auth.uid() IN (
    SELECT user_id FROM public.business_profiles 
    WHERE id = business_profile_id
  ));

CREATE POLICY "Authenticated users can create signatures"
  ON public.investment_signatures FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update their signatures"
  ON public.investment_signatures FOR UPDATE
  USING (auth.uid() = signer_id)
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can view approval records they're involved in"
  ON public.investment_approvals FOR SELECT
  USING (auth.uid() IN (
    SELECT investor_id FROM public.investment_approvals
    UNION
    SELECT user_id FROM public.business_profiles WHERE id = business_profile_id
  ));

CREATE POLICY "Users can view their notifications"
  ON public.shareholder_notifications FOR SELECT
  USING (auth.uid() = shareholder_id);

CREATE POLICY "Authenticated users can receive notifications"
  ON public.shareholder_notifications FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update their notifications"
  ON public.shareholder_notifications FOR UPDATE
  USING (auth.uid() = shareholder_id);

-- =====================================================
-- USAGE WORKFLOW
-- =====================================================
-- Step 1: Investor Signs
--   INSERT INTO investment_signatures (investment_id, signer_id, signer_type='investor', signature_status='signed')
--
-- Step 2: Move Money to Wallet
--   UPDATE investment_approvals SET transfer_status='completed', wallet_account_number='AGENT-KAM-5560'
--
-- Step 3: Send PIN Requests to Shareholders
--   SELECT send_pin_request_notification(investment_id, shareholder_id, email, name)
--
-- Step 4: Shareholders Enter PIN
--   UPDATE investment_signatures SET signature_status='pin_verified' WHERE shareholder_id=? AND pin_verified_at=NOW()
--   SELECT finalize_investment_document(investment_id) -- Check if 60% threshold met
--
-- Step 5: Document Ready for Print (when 60% reached)
--   Shareholders receive notification with print-ready document link

COMMIT;
