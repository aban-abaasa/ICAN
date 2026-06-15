-- =============================================
-- TRUST System - Membership Application & Voting Schema
-- Multi-step approval workflow:
-- 1. User submits application
-- 2. Admin reviews and approves/rejects
-- 3. If approved by admin, members vote
-- 4. Auto-approve at 60% threshold
-- =============================================

-- =============================================
-- DROP EXISTING TABLES (if redeploying)
-- =============================================
DROP TABLE IF EXISTS membership_votes CASCADE;
DROP TABLE IF EXISTS membership_applications CASCADE;

-- =============================================
-- MEMBERSHIP APPLICATIONS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS membership_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES trust_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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
  reviewed_by_user_id UUID REFERENCES auth.users(id),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- MEMBERSHIP VOTES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS membership_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES membership_applications(id) ON DELETE CASCADE,
  voter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
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
  );

-- Members can insert votes on applications in their groups
CREATE POLICY "Group members can vote on applications" ON membership_votes
  FOR INSERT WITH CHECK (
    auth.uid() = voter_id
    AND EXISTS (
      SELECT 1 FROM membership_applications ma
      JOIN trust_group_members tgm ON tgm.group_id = ma.group_id
      WHERE ma.id = application_id
      AND tgm.user_id = auth.uid()
      AND tgm.is_active = true
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
-- GRANT PERMISSIONS
-- =============================================
GRANT SELECT, INSERT, UPDATE ON public.membership_applications TO authenticated;
GRANT SELECT, INSERT ON public.membership_votes TO authenticated;

-- =============================================
-- VERIFICATION
-- =============================================
SELECT '✅ MEMBERSHIP APPLICATIONS TABLE CREATED' as status;
SELECT '✅ MEMBERSHIP VOTES TABLE CREATED' as status;
SELECT COUNT(*) as apps_columns FROM information_schema.columns WHERE table_name = 'membership_applications';
SELECT COUNT(*) as votes_columns FROM information_schema.columns WHERE table_name = 'membership_votes';

