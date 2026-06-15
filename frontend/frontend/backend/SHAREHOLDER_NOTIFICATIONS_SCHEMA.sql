-- =====================================================
-- SHAREHOLDER NOTIFICATIONS SCHEMA
-- =====================================================
-- Adds notification preferences to business profiles
-- Enables notifications when investors buy shares,
-- become partners, or provide support
-- =====================================================

-- Step 1: Add notification preference columns to business_profiles
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS notify_on_share_purchase BOOLEAN DEFAULT true;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS notify_on_partner_investment BOOLEAN DEFAULT true;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS notify_on_support BOOLEAN DEFAULT true;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS notify_on_investment_signed BOOLEAN DEFAULT true;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS notify_via_email BOOLEAN DEFAULT true;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS notify_via_push_notification BOOLEAN DEFAULT true;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS notify_via_in_app BOOLEAN DEFAULT true;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS shareholder_notification_level TEXT DEFAULT 'all' CHECK (shareholder_notification_level IN ('all', 'majority', 'only_founders'));

-- Step 2: Create shareholder_notifications table to track sent notifications
DROP TABLE IF EXISTS shareholder_notifications CASCADE;

CREATE TABLE shareholder_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  shareholder_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shareholder_email TEXT NOT NULL,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('share_purchase', 'partner_investment', 'support_contribution', 'investment_signed')),
  notification_title TEXT NOT NULL,
  notification_message TEXT NOT NULL,
  investor_name TEXT,
  investor_email TEXT,
  investment_amount DECIMAL(15, 2),
  investment_currency TEXT DEFAULT 'UGX',
  investment_shares DECIMAL(10, 4),
  read_at TIMESTAMP WITH TIME ZONE,
  notification_sent_via TEXT DEFAULT 'email' CHECK (notification_sent_via IN ('email', 'push', 'in_app', 'all')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(business_profile_id, shareholder_id, notification_type, investment_shares)
);

-- Create indexes for performance
CREATE INDEX idx_shareholder_notifications_business_profile_id 
ON shareholder_notifications(business_profile_id);

CREATE INDEX idx_shareholder_notifications_shareholder_id 
ON shareholder_notifications(shareholder_id);

CREATE INDEX idx_shareholder_notifications_created_at 
ON shareholder_notifications(created_at DESC);

CREATE INDEX idx_shareholder_notifications_read_at 
ON shareholder_notifications(read_at);

-- Enable RLS
ALTER TABLE shareholder_notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Shareholders can view their own notifications" ON shareholder_notifications;
CREATE POLICY "Shareholders can view their own notifications"
ON shareholder_notifications FOR SELECT
USING (auth.uid() = shareholder_id);

DROP POLICY IF EXISTS "Business owners can view shareholder notifications" ON shareholder_notifications;
CREATE POLICY "Business owners can view shareholder notifications"
ON shareholder_notifications FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM business_profile_members bpm
    WHERE bpm.business_profile_id = shareholder_notifications.business_profile_id
    AND bpm.user_id = auth.uid()
    AND bpm.role IN ('Owner', 'Co-Owner')
  )
);

-- Step 3: Create function to send notifications to shareholders
DROP FUNCTION IF EXISTS notify_shareholders_on_share_purchase(UUID, UUID, TEXT, TEXT, DECIMAL, TEXT, DECIMAL);
CREATE OR REPLACE FUNCTION notify_shareholders_on_share_purchase(
  p_business_profile_id UUID,
  p_investor_id UUID,
  p_investor_name TEXT,
  p_investor_email TEXT,
  p_investment_amount DECIMAL,
  p_investment_currency TEXT,
  p_investment_shares DECIMAL
) RETURNS TABLE (notification_id UUID, shareholder_email TEXT) AS $$
DECLARE
  v_business_name TEXT;
  v_notification_title TEXT;
  v_notification_message TEXT;
  v_shareholder_record RECORD;
  v_notification_count INT := 0;
BEGIN
  -- Get business name
  SELECT business_name INTO v_business_name
  FROM business_profiles
  WHERE id = p_business_profile_id;
  
  -- Prepare notification message
  v_notification_title := 'New Share Purchase - ' || v_business_name;
  v_notification_message := p_investor_name || ' has purchased ' || p_investment_shares || 
                           ' shares for ' || p_investment_amount || ' ' || p_investment_currency;
  
  -- Insert notifications for all eligible shareholders
  FOR v_shareholder_record IN
    SELECT DISTINCT bpm.user_id, bpm.user_email
    FROM business_profile_members bpm
    WHERE bpm.business_profile_id = p_business_profile_id
    AND bpm.status = 'active'
    AND bpm.can_receive_notifications = true
    AND (
      -- Apply notification level filtering
      (
        SELECT shareholder_notification_level FROM business_profiles 
        WHERE id = p_business_profile_id
      ) = 'all'
      OR (
        (
          SELECT shareholder_notification_level FROM business_profiles 
          WHERE id = p_business_profile_id
        ) = 'majority' AND bpm.ownership_share >= 5
      )
      OR (
        (
          SELECT shareholder_notification_level FROM business_profiles 
          WHERE id = p_business_profile_id
        ) = 'only_founders' AND bpm.role IN ('Owner', 'Co-Owner', 'Founder')
      )
    )
  LOOP
    INSERT INTO shareholder_notifications (
      business_profile_id,
      shareholder_id,
      shareholder_email,
      notification_type,
      notification_title,
      notification_message,
      investor_name,
      investor_email,
      investment_amount,
      investment_currency,
      investment_shares,
      notification_sent_via
    ) VALUES (
      p_business_profile_id,
      v_shareholder_record.user_id,
      v_shareholder_record.user_email,
      'share_purchase',
      v_notification_title,
      v_notification_message,
      p_investor_name,
      p_investor_email,
      p_investment_amount,
      p_investment_currency,
      p_investment_shares,
      'all'
    );
    
    v_notification_count := v_notification_count + 1;
    RETURN QUERY SELECT shareholder_notifications.id, v_shareholder_record.user_email
    FROM shareholder_notifications 
    WHERE shareholder_notifications.shareholder_id = v_shareholder_record.user_id
    ORDER BY created_at DESC LIMIT 1;
  END LOOP;
  
  RAISE NOTICE 'Notifications sent to % shareholders', v_notification_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 4: Create function to notify on partner investment
DROP FUNCTION IF EXISTS notify_shareholders_on_partner_investment(UUID, UUID, TEXT, TEXT, DECIMAL, TEXT);
CREATE OR REPLACE FUNCTION notify_shareholders_on_partner_investment(
  p_business_profile_id UUID,
  p_partner_id UUID,
  p_partner_name TEXT,
  p_partner_email TEXT,
  p_equity_stake DECIMAL,
  p_announcement_text TEXT DEFAULT NULL
) RETURNS TABLE (notification_id UUID, shareholder_email TEXT) AS $$
DECLARE
  v_business_name TEXT;
  v_notification_title TEXT;
  v_notification_message TEXT;
  v_shareholder_record RECORD;
BEGIN
  SELECT business_name INTO v_business_name
  FROM business_profiles
  WHERE id = p_business_profile_id;
  
  v_notification_title := 'New Business Partner - ' || v_business_name;
  v_notification_message := p_partner_name || ' has joined as a business partner with ' || 
                           p_equity_stake || '% equity stake' || 
                           COALESCE('. ' || p_announcement_text, '');
  
  FOR v_shareholder_record IN
    SELECT DISTINCT bpm.user_id, bpm.user_email
    FROM business_profile_members bpm
    WHERE bpm.business_profile_id = p_business_profile_id
    AND bpm.status = 'active'
    AND bpm.can_receive_notifications = true
    AND (
      (SELECT shareholder_notification_level FROM business_profiles WHERE id = p_business_profile_id) = 'all'
      OR ((SELECT shareholder_notification_level FROM business_profiles WHERE id = p_business_profile_id) = 'majority' AND bpm.ownership_share >= 5)
      OR ((SELECT shareholder_notification_level FROM business_profiles WHERE id = p_business_profile_id) = 'only_founders' AND bpm.role IN ('Owner', 'Co-Owner', 'Founder'))
    )
  LOOP
    INSERT INTO shareholder_notifications (
      business_profile_id,
      shareholder_id,
      shareholder_email,
      notification_type,
      notification_title,
      notification_message,
      investor_name,
      investor_email,
      investment_shares,
      notification_sent_via
    ) VALUES (
      p_business_profile_id,
      v_shareholder_record.user_id,
      v_shareholder_record.user_email,
      'partner_investment',
      v_notification_title,
      v_notification_message,
      p_partner_name,
      p_partner_email,
      p_equity_stake,
      'all'
    );
    
    RETURN QUERY SELECT shareholder_notifications.id, v_shareholder_record.user_email
    FROM shareholder_notifications 
    WHERE shareholder_notifications.shareholder_id = v_shareholder_record.user_id
    ORDER BY created_at DESC LIMIT 1;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 5: Create function to notify on support contribution
DROP FUNCTION IF EXISTS notify_shareholders_on_support(UUID, UUID, TEXT, TEXT, DECIMAL, TEXT);
CREATE OR REPLACE FUNCTION notify_shareholders_on_support(
  p_business_profile_id UUID,
  p_supporter_id UUID,
  p_supporter_name TEXT,
  p_supporter_email TEXT,
  p_support_amount DECIMAL,
  p_support_currency TEXT DEFAULT 'UGX'
) RETURNS TABLE (notification_id UUID, shareholder_email TEXT) AS $$
DECLARE
  v_business_name TEXT;
  v_notification_title TEXT;
  v_notification_message TEXT;
  v_shareholder_record RECORD;
BEGIN
  SELECT business_name INTO v_business_name
  FROM business_profiles
  WHERE id = p_business_profile_id;
  
  v_notification_title := 'Support Contribution Received - ' || v_business_name;
  v_notification_message := p_supporter_name || ' has provided support of ' || 
                           p_support_amount || ' ' || p_support_currency || 
                           ' to the business';
  
  FOR v_shareholder_record IN
    SELECT DISTINCT bpm.user_id, bpm.user_email
    FROM business_profile_members bpm
    WHERE bpm.business_profile_id = p_business_profile_id
    AND bpm.status = 'active'
    AND bpm.can_receive_notifications = true
    AND (
      (SELECT shareholder_notification_level FROM business_profiles WHERE id = p_business_profile_id) = 'all'
      OR ((SELECT shareholder_notification_level FROM business_profiles WHERE id = p_business_profile_id) = 'majority' AND bpm.ownership_share >= 5)
      OR ((SELECT shareholder_notification_level FROM business_profiles WHERE id = p_business_profile_id) = 'only_founders' AND bpm.role IN ('Owner', 'Co-Owner', 'Founder'))
    )
  LOOP
    INSERT INTO shareholder_notifications (
      business_profile_id,
      shareholder_id,
      shareholder_email,
      notification_type,
      notification_title,
      notification_message,
      investor_name,
      investor_email,
      investment_amount,
      investment_currency,
      notification_sent_via
    ) VALUES (
      p_business_profile_id,
      v_shareholder_record.user_id,
      v_shareholder_record.user_email,
      'support_contribution',
      v_notification_title,
      v_notification_message,
      p_supporter_name,
      p_supporter_email,
      p_support_amount,
      p_support_currency,
      'all'
    );
    
    RETURN QUERY SELECT shareholder_notifications.id, v_shareholder_record.user_email
    FROM shareholder_notifications 
    WHERE shareholder_notifications.shareholder_id = v_shareholder_record.user_id
    ORDER BY created_at DESC LIMIT 1;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 6: Create trigger to mark notifications as read
DROP TRIGGER IF EXISTS update_notification_read_at ON shareholder_notifications;
CREATE TRIGGER update_notification_read_at
BEFORE UPDATE ON shareholder_notifications
FOR EACH ROW
WHEN (NEW.read_at IS NULL AND OLD.read_at IS NULL)
EXECUTE FUNCTION update_updated_at_column();

-- Create function to get shareholder notifications dashboard
DROP FUNCTION IF EXISTS get_shareholder_notifications(UUID);
CREATE OR REPLACE FUNCTION get_shareholder_notifications(p_shareholder_id UUID)
RETURNS TABLE (
  notification_id UUID,
  business_name TEXT,
  notification_type TEXT,
  notification_title TEXT,
  notification_message TEXT,
  investor_name TEXT,
  investment_amount DECIMAL,
  investment_currency TEXT,
  created_at TIMESTAMP WITH TIME ZONE,
  is_read BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    sn.id,
    bp.business_name,
    sn.notification_type,
    sn.notification_title,
    sn.notification_message,
    sn.investor_name,
    sn.investment_amount,
    sn.investment_currency,
    sn.created_at,
    (sn.read_at IS NOT NULL) as is_read
  FROM shareholder_notifications sn
  JOIN business_profiles bp ON sn.business_profile_id = bp.id
  WHERE sn.shareholder_id = p_shareholder_id
  ORDER BY sn.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
