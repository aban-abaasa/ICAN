-- =====================================================
-- MEMBER APPROVAL SYSTEM FOR BUSINESS PROFILE EDITS
-- =====================================================
-- Tracks pending edits to shareholder roster
-- Requires unanimous approval from all members
-- Sends notifications to all members for approval
-- =====================================================

-- Step 1: Create pending_edits table to track proposed changes
DROP TABLE IF EXISTS pending_edits CASCADE;

CREATE TABLE pending_edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  proposed_by_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  proposed_by_email TEXT NOT NULL,
  proposed_by_name TEXT NOT NULL,
  edit_type TEXT NOT NULL CHECK (edit_type IN ('add_member', 'remove_member', 'update_member', 'investment_signed', 'other')),
  field_name TEXT,
  old_value JSONB,
  new_value JSONB,
  description TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'applied')),
  approval_required_count INT DEFAULT 0,
  approval_received_count INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP + INTERVAL '7 days',
  applied_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes
CREATE INDEX idx_pending_edits_business_profile_id 
ON pending_edits(business_profile_id);

CREATE INDEX idx_pending_edits_status 
ON pending_edits(status);

CREATE INDEX idx_pending_edits_proposed_by_id 
ON pending_edits(proposed_by_id);

CREATE INDEX idx_pending_edits_created_at 
ON pending_edits(created_at DESC);

-- Enable RLS
ALTER TABLE pending_edits ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Members can view pending edits for their business" ON pending_edits;
CREATE POLICY "Members can view pending edits for their business"
ON pending_edits FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM business_profile_members bpm
    WHERE bpm.business_profile_id = pending_edits.business_profile_id
    AND bpm.user_id = auth.uid()
    AND bpm.status = 'active'
  )
);

DROP POLICY IF EXISTS "Members can create pending edits" ON pending_edits;
CREATE POLICY "Members can create pending edits"
ON pending_edits FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM business_profile_members bpm
    WHERE bpm.business_profile_id = pending_edits.business_profile_id
    AND bpm.user_id = auth.uid()
    AND bpm.status = 'active'
  )
);

-- Step 2: Create member_approvals table to track individual approvals
DROP TABLE IF EXISTS member_approvals CASCADE;

CREATE TABLE member_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_edit_id UUID NOT NULL REFERENCES pending_edits(id) ON DELETE CASCADE,
  business_profile_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_email TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  comment TEXT,
  responded_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(pending_edit_id, member_id)
);

-- Create indexes
CREATE INDEX idx_member_approvals_pending_edit_id 
ON member_approvals(pending_edit_id);

CREATE INDEX idx_member_approvals_member_id 
ON member_approvals(member_id);

CREATE INDEX idx_member_approvals_status 
ON member_approvals(status);

-- Enable RLS
ALTER TABLE member_approvals ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Members can view their own approvals" ON member_approvals;
CREATE POLICY "Members can view their own approvals"
ON member_approvals FOR SELECT
USING (auth.uid() = member_id);

DROP POLICY IF EXISTS "Business owners can view all approvals" ON member_approvals;
CREATE POLICY "Business owners can view all approvals"
ON member_approvals FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM business_profile_members bpm
    WHERE bpm.business_profile_id = member_approvals.business_profile_id
    AND bpm.user_id = auth.uid()
    AND bpm.role IN ('Owner', 'Co-Owner')
  )
);

DROP POLICY IF EXISTS "Members can update their own approval" ON member_approvals;
CREATE POLICY "Members can update their own approval"
ON member_approvals FOR UPDATE
USING (auth.uid() = member_id);

-- Step 3: Create function to propose an edit
DROP FUNCTION IF EXISTS propose_member_edit(UUID, UUID, TEXT, TEXT, TEXT, JSONB, JSONB);
CREATE OR REPLACE FUNCTION propose_member_edit(
  p_business_profile_id UUID,
  p_proposed_by_id UUID,
  p_proposed_by_email TEXT,
  p_proposed_by_name TEXT,
  p_edit_type TEXT,
  p_old_value JSONB,
  p_new_value JSONB,
  p_description TEXT DEFAULT NULL
) RETURNS TABLE (pending_edit_id UUID, approval_count INT) AS $$
DECLARE
  v_edit_id UUID;
  v_member_count INT;
  v_field_name TEXT;
BEGIN
  -- Get the edit field name from description
  v_field_name := p_description;
  
  -- Count active members
  SELECT COUNT(*) INTO v_member_count
  FROM business_profile_members
  WHERE business_profile_id = p_business_profile_id
  AND status = 'active'
  AND can_receive_notifications = true;
  
  -- Insert the pending edit
  INSERT INTO pending_edits (
    business_profile_id,
    proposed_by_id,
    proposed_by_email,
    proposed_by_name,
    edit_type,
    field_name,
    old_value,
    new_value,
    description,
    approval_required_count
  ) VALUES (
    p_business_profile_id,
    p_proposed_by_id,
    p_proposed_by_email,
    p_proposed_by_name,
    p_edit_type,
    v_field_name,
    p_old_value,
    p_new_value,
    p_description,
    v_member_count
  ) RETURNING id INTO v_edit_id;
  
  -- Create approval records for ALL members (including the proposer)
  INSERT INTO member_approvals (
    pending_edit_id,
    business_profile_id,
    member_id,
    member_email
  )
  SELECT 
    v_edit_id,
    p_business_profile_id,
    user_id,
    user_email
  FROM business_profile_members
  WHERE business_profile_id = p_business_profile_id
  AND status = 'active'
  AND can_receive_notifications = true;
  
  -- Auto-approve for the proposer
  UPDATE member_approvals
  SET status = 'approved', responded_at = CURRENT_TIMESTAMP
  WHERE pending_edit_id = v_edit_id
  AND member_id = p_proposed_by_id;
  
  -- Update approval count
  UPDATE pending_edits
  SET approval_received_count = (
    SELECT COUNT(*) FROM member_approvals
    WHERE pending_edit_id = v_edit_id
    AND status = 'approved'
  )
  WHERE id = v_edit_id;
  
  RETURN QUERY SELECT v_edit_id, v_member_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 4: Create function to approve or reject an edit
DROP FUNCTION IF EXISTS respond_to_edit(UUID, UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION respond_to_edit(
  p_approval_id UUID,
  p_member_id UUID,
  p_response TEXT,
  p_comment TEXT DEFAULT NULL
) RETURNS TABLE (approved BOOLEAN, approval_count INT, total_required INT) AS $$
DECLARE
  v_pending_edit_id UUID;
  v_business_profile_id UUID;
  v_approved_count INT;
  v_required_count INT;
  v_edit_ready_to_apply BOOLEAN;
BEGIN
  -- Validate response
  IF p_response NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid response. Must be approved or rejected.';
  END IF;
  
  -- Get pending edit ID
  SELECT pending_edit_id, business_profile_id
  INTO v_pending_edit_id, v_business_profile_id
  FROM member_approvals
  WHERE id = p_approval_id
  AND member_id = p_member_id;
  
  IF v_pending_edit_id IS NULL THEN
    RAISE EXCEPTION 'Approval record not found or unauthorized.';
  END IF;
  
  -- Update the approval
  UPDATE member_approvals
  SET status = p_response::member_approvals.status, 
      comment = p_comment,
      responded_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = p_approval_id;
  
  -- Get approval counts
  SELECT 
    COUNT(*) FILTER (WHERE status = 'approved'),
    COUNT(*)
  INTO v_approved_count, v_required_count
  FROM member_approvals
  WHERE pending_edit_id = v_pending_edit_id;
  
  -- Update pending edit approval count
  UPDATE pending_edits
  SET approval_received_count = v_approved_count,
      updated_at = CURRENT_TIMESTAMP,
      status = CASE 
        WHEN v_approved_count = v_required_count THEN 'approved'
        WHEN EXISTS (SELECT 1 FROM member_approvals WHERE pending_edit_id = v_pending_edit_id AND status = 'rejected') THEN 'rejected'
        ELSE 'pending'
      END
  WHERE id = v_pending_edit_id;
  
  RETURN QUERY SELECT 
    (p_response = 'approved'), 
    v_approved_count, 
    v_required_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 5: Create function to get pending edits with approval status
DROP FUNCTION IF EXISTS get_pending_edits_with_approval(UUID);
CREATE OR REPLACE FUNCTION get_pending_edits_with_approval(p_business_profile_id UUID)
RETURNS TABLE (
  edit_id UUID,
  proposed_by_name TEXT,
  edit_type TEXT,
  description TEXT,
  status TEXT,
  approval_received INT,
  approval_required INT,
  created_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pe.id,
    pe.proposed_by_name,
    pe.edit_type,
    pe.description,
    pe.status,
    pe.approval_received_count,
    pe.approval_required_count,
    pe.created_at,
    pe.expires_at
  FROM pending_edits pe
  WHERE pe.business_profile_id = p_business_profile_id
  ORDER BY pe.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 6: Create function to apply approved changes
DROP FUNCTION IF EXISTS apply_approved_edit(UUID);
CREATE OR REPLACE FUNCTION apply_approved_edit(p_edit_id UUID)
RETURNS TABLE (success BOOLEAN, message TEXT) AS $$
DECLARE
  v_edit RECORD;
  v_business_profile_id UUID;
BEGIN
  -- Get the edit
  SELECT * INTO v_edit
  FROM pending_edits
  WHERE id = p_edit_id;
  
  IF v_edit IS NULL THEN
    RETURN QUERY SELECT false, 'Edit not found'::TEXT;
    RETURN;
  END IF;
  
  -- Check if all members have approved
  IF v_edit.approval_received_count < v_edit.approval_required_count THEN
    RETURN QUERY SELECT false, 'Not all members have approved yet'::TEXT;
    RETURN;
  END IF;
  
  -- Mark as applied
  UPDATE pending_edits
  SET status = 'applied', 
      applied_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = p_edit_id;
  
  RETURN QUERY SELECT true, 'Edit applied successfully'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 7: Create function to auto-approve pending edits that expire
DROP FUNCTION IF EXISTS handle_expired_edits();
CREATE OR REPLACE FUNCTION handle_expired_edits()
RETURNS TRIGGER AS $$
DECLARE
  v_expired INT;
BEGIN
  -- Mark expired edits as rejected
  UPDATE pending_edits
  SET status = 'rejected'
  WHERE status = 'pending'
  AND expires_at < CURRENT_TIMESTAMP;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 8: Add approval status columns to shareholder_notifications
ALTER TABLE shareholder_notifications 
ADD COLUMN IF NOT EXISTS approval_request_id UUID REFERENCES pending_edits(id) ON DELETE CASCADE;
ALTER TABLE shareholder_notifications 
ADD COLUMN IF NOT EXISTS approval_type TEXT CHECK (approval_type IN ('add_member', 'remove_member', 'update_member', NULL));
ALTER TABLE shareholder_notifications 
ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN DEFAULT false;

-- Step 9: Create function to send approval request notifications
DROP FUNCTION IF EXISTS notify_members_approval_needed(UUID, UUID, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION notify_members_approval_needed(
  p_business_profile_id UUID,
  p_pending_edit_id UUID,
  p_proposed_by_name TEXT,
  p_edit_type TEXT,
  p_description TEXT
) RETURNS TABLE (notification_id UUID, member_email TEXT) AS $$
DECLARE
  v_business_name TEXT;
  v_notification_title TEXT;
  v_notification_message TEXT;
  v_member_record RECORD;
BEGIN
  -- Get business name
  SELECT business_name INTO v_business_name
  FROM business_profiles
  WHERE id = p_business_profile_id;
  
  -- Prepare notification
  v_notification_title := 'Approval Needed - ' || v_business_name;
  v_notification_message := p_proposed_by_name || ' has proposed to ' || 
                           CASE p_edit_type
                             WHEN 'add_member' THEN 'add a new member'
                             WHEN 'remove_member' THEN 'remove a member'
                             WHEN 'update_member' THEN 'update member details'
                             ELSE 'make changes'
                           END || '. ' || COALESCE(p_description, '');
  
  -- Send notification to all members
  FOR v_member_record IN
    SELECT DISTINCT bpm.user_id, bpm.user_email
    FROM business_profile_members bpm
    WHERE bpm.business_profile_id = p_business_profile_id
    AND bpm.status = 'active'
    AND bpm.can_receive_notifications = true
  LOOP
    INSERT INTO shareholder_notifications (
      business_profile_id,
      shareholder_id,
      shareholder_email,
      notification_type,
      notification_title,
      notification_message,
      approval_request_id,
      approval_type,
      requires_approval,
      notification_sent_via
    ) VALUES (
      p_business_profile_id,
      v_member_record.user_id,
      v_member_record.user_email,
      'approval_request',
      v_notification_title,
      v_notification_message,
      p_pending_edit_id,
      p_edit_type,
      true,
      'all'
    );
    
    RETURN QUERY SELECT shareholder_notifications.id, v_member_record.user_email
    FROM shareholder_notifications 
    WHERE shareholder_notifications.shareholder_id = v_member_record.user_id
    ORDER BY created_at DESC LIMIT 1;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 10: Create trigger for automatic cleanup of expired edits
DROP TRIGGER IF EXISTS cleanup_expired_edits_trigger ON pending_edits;
CREATE TRIGGER cleanup_expired_edits_trigger
AFTER INSERT ON pending_edits
FOR EACH STATEMENT
EXECUTE FUNCTION handle_expired_edits();
