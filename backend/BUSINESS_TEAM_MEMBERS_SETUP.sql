-- =====================================================
-- BUSINESS TEAM MEMBERS TABLE SETUP
-- =====================================================
-- Lets a business owner grant an existing ICAN account holder
-- access to record transactions for their business, without
-- giving them equity/ownership share and without touching the
-- shareholder / cap-table tables (business_co_owners,
-- business_profile_members). Purely a transaction-tagging
-- access grant.
-- =====================================================

CREATE TABLE IF NOT EXISTS business_team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,

  -- The existing ICAN account being granted access
  user_id UUID NOT NULL,
  member_email TEXT NOT NULL,
  member_name TEXT NOT NULL,

  added_by UUID NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'removed')),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- One membership row per user per business
  UNIQUE(business_profile_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_business_team_members_business_profile_id
  ON business_team_members(business_profile_id);

CREATE INDEX IF NOT EXISTS idx_business_team_members_user_id
  ON business_team_members(user_id);

ALTER TABLE business_team_members ENABLE ROW LEVEL SECURITY;

-- Owner can see their business's team members; a member can see their own row
DROP POLICY IF EXISTS "Business owners can view team members" ON business_team_members;
CREATE POLICY "Business owners can view team members"
ON business_team_members FOR SELECT
USING (
  business_profile_id IN (SELECT id FROM business_profiles WHERE user_id = auth.uid())
  OR user_id = auth.uid()
);

-- Only the business owner can add team members
DROP POLICY IF EXISTS "Business owners can add team members" ON business_team_members;
CREATE POLICY "Business owners can add team members"
ON business_team_members FOR INSERT
WITH CHECK (
  business_profile_id IN (SELECT id FROM business_profiles WHERE user_id = auth.uid())
);

-- Only the business owner can update team members
DROP POLICY IF EXISTS "Business owners can update team members" ON business_team_members;
CREATE POLICY "Business owners can update team members"
ON business_team_members FOR UPDATE
USING (business_profile_id IN (SELECT id FROM business_profiles WHERE user_id = auth.uid()))
WITH CHECK (business_profile_id IN (SELECT id FROM business_profiles WHERE user_id = auth.uid()));

-- Only the business owner can remove team members
DROP POLICY IF EXISTS "Business owners can remove team members" ON business_team_members;
CREATE POLICY "Business owners can remove team members"
ON business_team_members FOR DELETE
USING (business_profile_id IN (SELECT id FROM business_profiles WHERE user_id = auth.uid()));
