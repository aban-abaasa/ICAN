/**
 * SACCO Management System - Database Schema
 * Savings and Credit Cooperative Organization
 * Max 30 members, democratic approval (60%), private profiles
 */

-- ============================================
-- SACCO Groups Table
-- ============================================
CREATE TABLE IF NOT EXISTS ican_saccos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  admin_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Group Settings
  max_members INT DEFAULT 30,
  approval_threshold DECIMAL DEFAULT 0.60, -- 60% must approve
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
  
  -- Financial Tracking
  total_pool DECIMAL DEFAULT 0, -- Total savings in group
  total_interest_generated DECIMAL DEFAULT 0,
  member_count INT DEFAULT 1,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- SACCO Members Table
-- ============================================
CREATE TABLE IF NOT EXISTS ican_sacco_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sacco_id UUID NOT NULL REFERENCES ican_saccos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Member Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  
  -- Financial Tracking
  total_contributed DECIMAL DEFAULT 0, -- Total amount contributed
  current_balance DECIMAL DEFAULT 0, -- Current balance in SACCO
  interest_earned DECIMAL DEFAULT 0, -- Interest accrued
  loans_taken DECIMAL DEFAULT 0, -- Total loans borrowed
  loans_repaid DECIMAL DEFAULT 0, -- Amount repaid
  
  -- Approval Tracking
  approved_by_count INT DEFAULT 0, -- How many approved this member
  approval_date TIMESTAMP WITH TIME ZONE,
  
  -- Privacy Settings
  show_profile BOOLEAN DEFAULT FALSE, -- Can others see their profile
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(sacco_id, user_id)
);

-- ============================================
-- Member Approval Votes Table
-- ============================================
CREATE TABLE IF NOT EXISTS ican_sacco_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sacco_id UUID NOT NULL REFERENCES ican_saccos(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES ican_sacco_members(id) ON DELETE CASCADE,
  voter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  vote BOOLEAN, -- true = approve, false = reject
  reason TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(member_id, voter_id)
);

-- ============================================
-- Contributions Table
-- ============================================
CREATE TABLE IF NOT EXISTS ican_sacco_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sacco_id UUID NOT NULL REFERENCES ican_saccos(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES ican_sacco_members(id) ON DELETE CASCADE,
  
  amount DECIMAL NOT NULL,
  contribution_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  description TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Loans Table
-- ============================================
CREATE TABLE IF NOT EXISTS ican_sacco_loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sacco_id UUID NOT NULL REFERENCES ican_saccos(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES ican_sacco_members(id) ON DELETE CASCADE,
  
  principal DECIMAL NOT NULL,
  interest_rate DECIMAL DEFAULT 10, -- % per annum
  duration_months INT DEFAULT 12,
  
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'defaulted')),
  
  disbursed_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  due_date TIMESTAMP WITH TIME ZONE,
  
  amount_repaid DECIMAL DEFAULT 0,
  interest_accrued DECIMAL DEFAULT 0,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Loan Repayments Table
-- ============================================
CREATE TABLE IF NOT EXISTS ican_sacco_repayments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES ican_sacco_loans(id) ON DELETE CASCADE,
  
  amount DECIMAL NOT NULL,
  payment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  payment_method TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Interest Distribution Table
-- ============================================
CREATE TABLE IF NOT EXISTS ican_sacco_interest (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sacco_id UUID NOT NULL REFERENCES ican_saccos(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES ican_sacco_members(id) ON DELETE CASCADE,
  
  amount DECIMAL NOT NULL,
  distribution_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  period_month INT,
  period_year INT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_saccos_admin ON ican_saccos(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_members_sacco ON ican_sacco_members(sacco_id);
CREATE INDEX IF NOT EXISTS idx_sacco_members_user ON ican_sacco_members(user_id);
CREATE INDEX IF NOT EXISTS idx_sacco_members_status ON ican_sacco_members(status);
CREATE INDEX IF NOT EXISTS idx_sacco_votes_member ON ican_sacco_votes(member_id);
CREATE INDEX IF NOT EXISTS idx_sacco_contributions_member ON ican_sacco_contributions(member_id);
CREATE INDEX IF NOT EXISTS idx_sacco_loans_member ON ican_sacco_loans(member_id);
CREATE INDEX IF NOT EXISTS idx_sacco_interest_member ON ican_sacco_interest(member_id);

-- ============================================
-- Row Level Security
-- ============================================
ALTER TABLE ican_saccos ENABLE ROW LEVEL SECURITY;
ALTER TABLE ican_sacco_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE ican_sacco_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ican_sacco_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ican_sacco_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE ican_sacco_repayments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ican_sacco_interest ENABLE ROW LEVEL SECURITY;

-- ============================================
-- SACCO RLS Policies
-- ============================================

-- SACCO: Anyone can see active SACCOs
CREATE POLICY "Anyone can view active saccos" ON ican_saccos
  FOR SELECT USING (status = 'active');

-- SACCO: Only admin can update
CREATE POLICY "Admin can update their sacco" ON ican_saccos
  FOR UPDATE USING (admin_id = auth.uid());

-- SACCO: Only admin can delete
CREATE POLICY "Admin can delete their sacco" ON ican_saccos
  FOR DELETE USING (admin_id = auth.uid());

-- SACCO Members: Members can only see approved members and themselves
CREATE POLICY "Members see approved members in their sacco" ON ican_sacco_members
  FOR SELECT USING (
    auth.uid() IN (
      SELECT user_id FROM ican_sacco_members 
      WHERE sacco_id = ican_sacco_members.sacco_id AND status = 'approved'
    )
    AND status = 'approved'
  );

-- SACCO Members: Members can see their own record
CREATE POLICY "Members see their own record" ON ican_sacco_members
  FOR SELECT USING (user_id = auth.uid());

-- SACCO Members: Admin can see all members in their sacco
CREATE POLICY "Admin sees all members" ON ican_sacco_members
  FOR SELECT USING (
    sacco_id IN (SELECT id FROM ican_saccos WHERE admin_id = auth.uid())
  );

-- SACCO Members: Members can insert themselves
CREATE POLICY "Users can request to join" ON ican_sacco_members
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- SACCO Members: Admin can update member status
CREATE POLICY "Admin updates member status" ON ican_sacco_members
  FOR UPDATE USING (
    sacco_id IN (SELECT id FROM ican_saccos WHERE admin_id = auth.uid())
  );

-- Votes: Members can only see votes for their sacco
CREATE POLICY "Members see votes in their sacco" ON ican_sacco_votes
  FOR SELECT USING (
    sacco_id IN (
      SELECT sacco_id FROM ican_sacco_members 
      WHERE user_id = auth.uid() AND status = 'approved'
    )
  );

-- Votes: Members can vote
CREATE POLICY "Members can vote" ON ican_sacco_votes
  FOR INSERT WITH CHECK (
    voter_id = auth.uid() AND
    sacco_id IN (
      SELECT sacco_id FROM ican_sacco_members 
      WHERE user_id = auth.uid() AND status = 'approved'
    )
  );

-- Contributions: Members see their own contributions
CREATE POLICY "Members see own contributions" ON ican_sacco_contributions
  FOR SELECT USING (
    member_id IN (
      SELECT id FROM ican_sacco_members WHERE user_id = auth.uid()
    )
  );

-- Contributions: Members can contribute
CREATE POLICY "Members can contribute" ON ican_sacco_contributions
  FOR INSERT WITH CHECK (
    member_id IN (
      SELECT id FROM ican_sacco_members 
      WHERE user_id = auth.uid() AND status = 'approved'
    )
  );

-- Loans: Members see their own loans
CREATE POLICY "Members see own loans" ON ican_sacco_loans
  FOR SELECT USING (
    member_id IN (
      SELECT id FROM ican_sacco_members WHERE user_id = auth.uid()
    )
  );

-- Loans: Members can request loans
CREATE POLICY "Members can request loans" ON ican_sacco_loans
  FOR INSERT WITH CHECK (
    member_id IN (
      SELECT id FROM ican_sacco_members 
      WHERE user_id = auth.uid() AND status = 'approved'
    )
  );

-- ============================================
-- Triggers
-- ============================================

-- Update SACCO member count when member is approved
CREATE OR REPLACE FUNCTION update_sacco_member_count()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
    UPDATE ican_saccos 
    SET member_count = (
      SELECT COUNT(*) FROM ican_sacco_members 
      WHERE sacco_id = NEW.sacco_id AND status = 'approved'
    )
    WHERE id = NEW.sacco_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_member_count ON ican_sacco_members;
CREATE TRIGGER trigger_update_member_count
AFTER UPDATE ON ican_sacco_members
FOR EACH ROW
EXECUTE FUNCTION update_sacco_member_count();

-- Update member balance when contribution is made
CREATE OR REPLACE FUNCTION update_member_balance_on_contribution()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE ican_sacco_members 
  SET current_balance = current_balance + NEW.amount,
      total_contributed = total_contributed + NEW.amount
  WHERE id = NEW.member_id;
  
  UPDATE ican_saccos 
  SET total_pool = total_pool + NEW.amount
  WHERE id = NEW.sacco_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_balance_contribution ON ican_sacco_contributions;
CREATE TRIGGER trigger_update_balance_contribution
AFTER INSERT ON ican_sacco_contributions
FOR EACH ROW
EXECUTE FUNCTION update_member_balance_on_contribution();

-- Update loan status and member balance on repayment
CREATE OR REPLACE FUNCTION update_loan_on_repayment()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE ican_sacco_loans 
  SET amount_repaid = amount_repaid + NEW.amount
  WHERE id = NEW.loan_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_loan_repayment ON ican_sacco_repayments;
CREATE TRIGGER trigger_update_loan_repayment
AFTER INSERT ON ican_sacco_repayments
FOR EACH ROW
EXECUTE FUNCTION update_loan_on_repayment();
