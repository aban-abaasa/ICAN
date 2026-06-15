# Supabase Deployment Script

Run this SQL in your Supabase SQL Editor to deploy the membership application system.

## Steps:
1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Click **SQL Editor** (left sidebar)
4. Click **New query**
5. **Copy and paste the entire code block below** (replace any existing code)
6. Click **Run** button
7. Wait for success message

---

## SQL DEPLOYMENT CODE

```sql
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
-- Deployment Complete!
-- =============================================
-- Tables created: ✓ membership_applications, ✓ membership_votes
-- RLS policies: ✓ 7 policies configured
-- Indexes: ✓ 8 indexes created
-- Functions: ✓ 2 helper functions + trigger
-- Ready for use!
```

---

## Verification Checklist

After running the SQL, verify everything worked:

```sql
-- Check 1: Tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('membership_applications', 'membership_votes');

-- Check 2: RLS enabled
SELECT tablename, (SELECT count(*) FROM pg_policies WHERE pg_policies.tablename = t.tablename) as policy_count
FROM pg_tables t
WHERE tablename IN ('membership_applications', 'membership_votes');

-- Check 3: Functions exist
SELECT routine_name FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name LIKE '%application%';
```

---

## Frontend Files Already Updated

✅ **trustService.js** - adminApproveApplication() with admin verification
✅ **AdminApplicationPanel.jsx** - Beautiful new UI with gradients & animations
✅ **SACCOHub.jsx** - Proper filtering for user interface
✅ **Slot.jsx** - Admin dashboard filtering only creator's groups
✅ **VotingInterface.jsx** - Member voting interface

---

## What Happens Next

1. ✅ SQL deployed (you're here)
2. 🟡 Test User Application (user applies → see in "My Applications")
3. 🟡 Test Admin Approval (admin approves → starts voting)
4. 🟡 Test Member Voting (members vote → auto-approval at 60%)
5. 🟡 Verify Database RLS permissions

---

**Questions?** Check the browser console (F12) for error messages when testing.
