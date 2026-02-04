/**
 * TRUST System - Membership Application & Voting Schema
 * Multi-step approval workflow:
 * 1. User submits application
 * 2. Admin reviews and approves/rejects
 * 3. If approved by admin, members vote
 * 4. Auto-approve at 60% threshold
 */

-- =============================================
-- MEMBERSHIP APPLICATIONS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS membership_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES trust_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  user_email TEXT NOT NULL,
  application_text TEXT NOT NULL,
  
  -- Status: pending -> approved_by_admin -> voting_in_progress -> approved
  --         pending -> rejected_by_admin
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'approved_by_admin',
    'rejected_by_admin',
    'voting_in_progress',
    'approved',
    'rejected_by_vote'
  )),
  
  admin_reviewed_at TIMESTAMP WITH TIME ZONE,
  reviewed_by_user_id UUID,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- MEMBERSHIP VOTES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS membership_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES membership_applications(id) ON DELETE CASCADE,
  voter_id UUID NOT NULL,
  
  -- yes or no vote
  vote TEXT NOT NULL CHECK (vote IN ('yes', 'no')),
  
  voted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- One vote per member per application
  UNIQUE(application_id, voter_id)
);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_applications_group_id ON membership_applications(group_id);
CREATE INDEX IF NOT EXISTS idx_applications_user_id ON membership_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON membership_applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_group_status ON membership_applications(group_id, status);

-- Partial unique index: one pending/voting application per user per group
CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_unique_pending
  ON membership_applications(group_id, user_id)
  WHERE status IN ('pending', 'approved_by_admin', 'voting_in_progress');

CREATE INDEX IF NOT EXISTS idx_votes_application_id ON membership_votes(application_id);
CREATE INDEX IF NOT EXISTS idx_votes_voter_id ON membership_votes(voter_id);

-- =============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =============================================

-- Enable RLS
ALTER TABLE membership_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_votes ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view own applications" ON membership_applications;
DROP POLICY IF EXISTS "Group admins can view applications for their groups" ON membership_applications;
DROP POLICY IF EXISTS "Users can submit applications" ON membership_applications;
DROP POLICY IF EXISTS "Admins can approve/reject applications" ON membership_applications;
DROP POLICY IF EXISTS "Group members can view votes" ON membership_votes;
DROP POLICY IF EXISTS "Group members can vote on applications" ON membership_votes;
DROP POLICY IF EXISTS "Admins can add approved members" ON trust_group_members;

-- Applications: Users can see their own, admins can see all for their groups
CREATE POLICY "Users can view own applications" ON membership_applications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Group admins can view applications for their groups" ON membership_applications
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM trust_groups
      WHERE trust_groups.id = membership_applications.group_id
      AND trust_groups.creator_id = auth.uid()
    )
  );

-- Users can insert their own applications
CREATE POLICY "Users can submit applications" ON membership_applications
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Only admins can update applications
CREATE POLICY "Admins can approve/reject applications" ON membership_applications
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM trust_groups
      WHERE trust_groups.id = membership_applications.group_id
      AND trust_groups.creator_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM trust_groups
      WHERE trust_groups.id = membership_applications.group_id
      AND trust_groups.creator_id = auth.uid()
    )
  );

-- Votes: Members can view votes for applications in their groups
CREATE POLICY "Group members can view votes" ON membership_votes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM membership_applications ma
      JOIN trust_group_members tgm ON tgm.group_id = ma.group_id
      WHERE ma.id = membership_votes.application_id
      AND tgm.user_id = auth.uid()
      AND tgm.is_active = true
    )
    OR
    -- Also allow applicants to see votes on their own application
    EXISTS (
      SELECT 1 FROM membership_applications ma
      WHERE ma.id = membership_votes.application_id
      AND ma.user_id = auth.uid()
    )
    OR
    -- Also allow group admins to see votes on applications in their groups
    EXISTS (
      SELECT 1 FROM membership_applications ma
      JOIN trust_groups tg ON tg.id = ma.group_id
      WHERE ma.id = membership_votes.application_id
      AND tg.creator_id = auth.uid()
    )
  );

-- Members can insert votes on applications in their groups
CREATE POLICY "Group members can vote on applications" ON membership_votes
  FOR INSERT WITH CHECK (
    auth.uid() = voter_id
    AND (
      -- Members of the group can vote
      EXISTS (
        SELECT 1 FROM membership_applications ma
        JOIN trust_group_members tgm ON tgm.group_id = ma.group_id
        WHERE ma.id = application_id
        AND tgm.user_id = auth.uid()
        AND tgm.is_active = true
      )
      OR
      -- Applicants can vote on their own application
      EXISTS (
        SELECT 1 FROM membership_applications ma
        WHERE ma.id = application_id
        AND ma.user_id = auth.uid()
      )
      OR
      -- Group admins can vote
      EXISTS (
        SELECT 1 FROM membership_applications ma
        JOIN trust_groups tg ON tg.id = ma.group_id
        WHERE ma.id = application_id
        AND tg.creator_id = auth.uid()
      )
    )
  );

-- Allow admins to insert members when approving applications
CREATE POLICY "Admins can add approved members" ON trust_group_members
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM trust_groups
      WHERE trust_groups.id = trust_group_members.group_id
      AND trust_groups.creator_id = auth.uid()
    )
  );

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

/**
 * Function to check voting results and auto-approve if threshold reached
 */
CREATE OR REPLACE FUNCTION check_application_votes(app_id UUID)
RETURNS TABLE(yes_votes INT, no_votes INT, total_votes INT, percentage NUMERIC, threshold_reached BOOLEAN)
AS $$
DECLARE
  total_members INT;
  v_yes_votes INT;
  v_no_votes INT;
  v_total_votes INT;
  v_percentage NUMERIC;
  v_threshold_reached BOOLEAN;
BEGIN
  -- Get votes
  SELECT 
    COUNT(CASE WHEN vote = 'yes' THEN 1 END),
    COUNT(CASE WHEN vote = 'no' THEN 1 END),
    COUNT(*)
  INTO v_yes_votes, v_no_votes, v_total_votes
  FROM membership_votes
  WHERE application_id = app_id;

  -- Get total members in group
  SELECT COUNT(*)
  INTO total_members
  FROM trust_group_members tgm
  JOIN membership_applications ma ON ma.group_id = tgm.group_id
  WHERE ma.id = app_id
  AND tgm.is_active = true;

  -- Calculate percentage
  IF total_members > 0 AND v_total_votes > 0 THEN
    v_percentage := (v_yes_votes::NUMERIC / total_members::NUMERIC) * 100;
    v_threshold_reached := v_percentage >= 60;
  ELSE
    v_percentage := 0;
    v_threshold_reached := false;
  END IF;

  RETURN QUERY SELECT v_yes_votes, v_no_votes, v_total_votes, v_percentage, v_threshold_reached;
END;
$$ LANGUAGE plpgsql;

/**
 * Function to finalize application status based on votes
 */
CREATE OR REPLACE FUNCTION finalize_application_status(app_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  voting_result RECORD;
  app_record RECORD;
BEGIN
  -- Get voting results
  SELECT * INTO voting_result FROM check_application_votes(app_id);
  
  -- Get application
  SELECT * INTO app_record FROM membership_applications WHERE id = app_id;
  
  IF voting_result.threshold_reached THEN
    -- Approve application
    UPDATE membership_applications
    SET status = 'approved'
    WHERE id = app_id;
    
    -- Add user as group member
    INSERT INTO trust_group_members (
      group_id,
      user_id,
      member_number,
      role
    ) SELECT
      app_record.group_id,
      app_record.user_id,
      (SELECT COALESCE(MAX(member_number), 0) + 1 FROM trust_group_members WHERE group_id = app_record.group_id),
      'member'
    ON CONFLICT DO NOTHING;
    
    RETURN true;
  ELSE
    -- Reject if voting ended
    IF voting_result.total_votes > 0 THEN
      UPDATE membership_applications
      SET status = 'rejected_by_vote'
      WHERE id = app_id;
    END IF;
    
    RETURN false;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- AUDIT TRIGGER
-- =============================================

CREATE OR REPLACE FUNCTION update_membership_applications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_membership_applications_updated_at ON membership_applications;

CREATE TRIGGER trigger_update_membership_applications_updated_at
BEFORE UPDATE ON membership_applications
FOR EACH ROW
EXECUTE FUNCTION update_membership_applications_updated_at();

-- =============================================
-- TRUST TRANSACTIONS TABLE
-- =============================================
-- Drop and recreate to ensure clean state
DROP TABLE IF EXISTS trust_transactions CASCADE;

CREATE TABLE trust_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES trust_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  type TEXT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  description TEXT,
  blockchain_hash TEXT,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- GROUP MESSAGES TABLE (Chat Room)
-- =============================================
-- Drop and recreate to ensure clean state
DROP TABLE IF EXISTS group_messages CASCADE;

CREATE TABLE group_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES trust_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  user_email TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- INDEXES FOR NEW TABLES
-- =============================================
CREATE INDEX idx_transactions_group_id ON trust_transactions(group_id);
CREATE INDEX idx_transactions_user_id ON trust_transactions(user_id);
CREATE INDEX idx_transactions_type ON trust_transactions(type);
CREATE INDEX idx_transactions_created_at ON trust_transactions(created_at);

CREATE INDEX idx_messages_group_id ON group_messages(group_id);
CREATE INDEX idx_messages_user_id ON group_messages(user_id);
CREATE INDEX idx_messages_created_at ON group_messages(created_at);

-- =============================================
-- ROW LEVEL SECURITY FOR NEW TABLES
-- =============================================

-- Enable RLS for new tables
ALTER TABLE trust_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_messages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view own transactions" ON trust_transactions;
DROP POLICY IF EXISTS "Admins can view group transactions" ON trust_transactions;
DROP POLICY IF EXISTS "Users can insert transactions" ON trust_transactions;
DROP POLICY IF EXISTS "Group members can view messages" ON group_messages;
DROP POLICY IF EXISTS "Users can send messages" ON group_messages;

-- Transactions: Users can view their own transactions
CREATE POLICY "Users can view own transactions" ON trust_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- Admins can view all transactions for their groups
CREATE POLICY "Admins can view group transactions" ON trust_transactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM trust_groups tg
      WHERE tg.id = trust_transactions.group_id
      AND tg.creator_id = auth.uid()
    )
  );

-- Users can insert their own transactions
CREATE POLICY "Users can insert transactions" ON trust_transactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Messages: Group members can view messages
CREATE POLICY "Group members can view messages" ON group_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM trust_group_members tgm
      WHERE tgm.group_id = group_messages.group_id
      AND tgm.user_id = auth.uid()
      AND tgm.is_active = true
    )
    OR
    EXISTS (
      SELECT 1 FROM trust_groups tg
      WHERE tg.id = group_messages.group_id
      AND tg.creator_id = auth.uid()
    )
  );

-- Users can send messages if they're members or admins
CREATE POLICY "Users can send messages" ON group_messages
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND (
      EXISTS (
        SELECT 1 FROM trust_group_members tgm
        WHERE tgm.group_id = group_messages.group_id
        AND tgm.user_id = auth.uid()
        AND tgm.is_active = true
      )
      OR
      EXISTS (
        SELECT 1 FROM trust_groups tg
        WHERE tg.id = group_messages.group_id
        AND tg.creator_id = auth.uid()
      )
    )
  );
