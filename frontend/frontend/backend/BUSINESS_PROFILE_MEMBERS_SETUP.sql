-- =====================================================
-- BUSINESS PROFILE MEMBERS TABLE SETUP
-- =====================================================
-- Ensures all shareholders are properly linked
-- to their business profile for approval and notification system
-- =====================================================

-- Drop existing table if exists
DROP TABLE IF EXISTS business_profile_members CASCADE;

-- Create business_profile_members table
CREATE TABLE business_profile_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  user_name TEXT NOT NULL,
  role TEXT DEFAULT 'Co-Owner' CHECK (role IN ('Owner', 'Co-Owner', 'Shareholder', 'Founder', 'CTO', 'CFO', 'CEO', 'Partner', 'Investor')),
  ownership_share DECIMAL(5, 2) DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending', 'removed')),
  can_sign BOOLEAN DEFAULT true,
  can_receive_notifications BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Prevent duplicate memberships
  UNIQUE(business_profile_id, user_id),
  
  -- Ensure at least one owner
  CONSTRAINT valid_ownership_share CHECK (ownership_share >= 0 AND ownership_share <= 100)
);

-- Create indexes for performance
CREATE INDEX idx_business_profile_members_business_profile_id 
ON business_profile_members(business_profile_id);

CREATE INDEX idx_business_profile_members_user_id 
ON business_profile_members(user_id);

CREATE INDEX idx_business_profile_members_user_email 
ON business_profile_members(user_email);

-- Enable RLS
ALTER TABLE business_profile_members ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Policy 1: Business owners can view their own members
DROP POLICY IF EXISTS "Business owners can view members" ON business_profile_members;
CREATE POLICY "Business owners can view members"
ON business_profile_members FOR SELECT
USING (
  business_profile_id IN (
    SELECT id FROM business_profiles WHERE user_id = auth.uid()
  )
  OR user_id = auth.uid()
);

-- Policy 2: Business owners can insert members
DROP POLICY IF EXISTS "Business owners can insert members" ON business_profile_members;
CREATE POLICY "Business owners can insert members"
ON business_profile_members FOR INSERT
WITH CHECK (
  business_profile_id IN (
    SELECT id FROM business_profiles WHERE user_id = auth.uid()
  )
);

-- Policy 3: Business owners can update members
DROP POLICY IF EXISTS "Business owners can update members" ON business_profile_members;
CREATE POLICY "Business owners can update members"
ON business_profile_members FOR UPDATE
USING (
  business_profile_id IN (
    SELECT id FROM business_profiles WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  business_profile_id IN (
    SELECT id FROM business_profiles WHERE user_id = auth.uid()
  )
);

-- Policy 4: Business owners can delete members
DROP POLICY IF EXISTS "Business owners can delete members" ON business_profile_members;
CREATE POLICY "Business owners can delete members"
ON business_profile_members FOR DELETE
USING (
  business_profile_id IN (
    SELECT id FROM business_profiles WHERE user_id = auth.uid()
  )
);

-- Policy 5: Members can view themselves
DROP POLICY IF EXISTS "Members can view themselves" ON business_profile_members;
CREATE POLICY "Members can view themselves"
ON business_profile_members FOR SELECT
USING (user_id = auth.uid());

-- =====================================================
-- POPULATE MEMBERS FROM BUSINESS_CO_OWNERS
-- =====================================================
-- This function migrates existing co-owners to members table

CREATE OR REPLACE FUNCTION migrate_co_owners_to_members()
RETURNS TABLE(processed INT, errors INT) AS $$
DECLARE
  v_processed INT := 0;
  v_errors INT := 0;
  v_co_owner RECORD;
  v_user_id UUID;
BEGIN
  -- Loop through all co-owners
  FOR v_co_owner IN 
    SELECT * FROM business_co_owners WHERE user_id IS NOT NULL OR owner_email IS NOT NULL
  LOOP
    BEGIN
      -- Find the user ID from email if not already set
      IF v_co_owner.user_id IS NOT NULL THEN
        v_user_id := v_co_owner.user_id;
      ELSE
        SELECT id INTO v_user_id 
        FROM auth.users 
        WHERE email ILIKE v_co_owner.owner_email
        LIMIT 1;
        
        IF v_user_id IS NULL THEN
          -- Try to find in profiles table
          SELECT id INTO v_user_id 
          FROM profiles 
          WHERE email ILIKE v_co_owner.owner_email
          LIMIT 1;
        END IF;
      END IF;
      
      -- If we found a user, insert into members table
      IF v_user_id IS NOT NULL THEN
        INSERT INTO business_profile_members (
          business_profile_id,
          user_id,
          user_email,
          user_name,
          role,
          ownership_share,
          status,
          can_sign,
          can_receive_notifications
        ) VALUES (
          v_co_owner.business_profile_id,
          v_user_id,
          COALESCE(v_co_owner.owner_email, ''),
          COALESCE(v_co_owner.owner_name, ''),
          COALESCE(v_co_owner.role, 'Co-Owner'),
          COALESCE(v_co_owner.ownership_share, 0),
          'active',
          true,
          true
        )
        ON CONFLICT (business_profile_id, user_id) DO UPDATE
        SET 
          user_email = EXCLUDED.user_email,
          user_name = EXCLUDED.user_name,
          role = EXCLUDED.role,
          ownership_share = EXCLUDED.ownership_share,
          updated_at = CURRENT_TIMESTAMP;
          
        v_processed := v_processed + 1;
      ELSE
        v_errors := v_errors + 1;
        RAISE WARNING 'Could not find user for co-owner: %', v_co_owner.owner_email;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      RAISE WARNING 'Error processing co-owner %: %', v_co_owner.owner_email, SQLERRM;
    END;
  END LOOP;
  
  RETURN QUERY SELECT v_processed, v_errors;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- FUNCTION: Add investor as shareholder AFTER approval
-- =====================================================
-- Only call this AFTER shareholders approve (60% threshold met)
-- This ensures investor doesn't become shareholder until proven

CREATE OR REPLACE FUNCTION confirm_investor_as_shareholder_after_approval(
  p_investment_id UUID,
  p_business_profile_id UUID,
  p_investor_id UUID,
  p_investor_email TEXT,
  p_investor_name TEXT,
  p_ownership_share DECIMAL DEFAULT 0
)
RETURNS TABLE(success BOOLEAN, message TEXT) AS $$
DECLARE
  v_existing_member BOOLEAN;
BEGIN
  -- Check if investor is already a member
  SELECT EXISTS(
    SELECT 1 FROM business_profile_members 
    WHERE business_profile_id = p_business_profile_id 
    AND user_id = p_investor_id
  ) INTO v_existing_member;
  
  IF v_existing_member THEN
    -- Update existing member to confirm shareholder status
    UPDATE business_profile_members
    SET 
      role = 'Shareholder',
      ownership_share = COALESCE(p_ownership_share, ownership_share),
      status = 'active',
      updated_at = CURRENT_TIMESTAMP
    WHERE business_profile_id = p_business_profile_id 
    AND user_id = p_investor_id;
    
    RETURN QUERY SELECT true, 'Investor confirmed as shareholder after approval';
  ELSE
    -- Insert new shareholder member (only after approval)
    INSERT INTO business_profile_members (
      business_profile_id,
      user_id,
      user_email,
      user_name,
      role,
      ownership_share,
      status,
      can_sign,
      can_receive_notifications
    ) VALUES (
      p_business_profile_id,
      p_investor_id,
      COALESCE(p_investor_email, ''),
      COALESCE(p_investor_name, 'Shareholder'),
      'Shareholder',
      COALESCE(p_ownership_share, 0),
      'active',
      false,
      true
    );
    
    RETURN QUERY SELECT true, 'Investor added as shareholder after approval';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- FUNCTION: Track investor as pending (before approval)
-- =====================================================
-- Add investor as PENDING member (not shareholder yet)
-- Will be confirmed after 60% approval threshold

CREATE OR REPLACE FUNCTION add_investor_as_pending_member(
  p_investment_id UUID,
  p_business_profile_id UUID,
  p_investor_id UUID,
  p_investor_email TEXT,
  p_investor_name TEXT
)
RETURNS TABLE(success BOOLEAN, message TEXT) AS $$
BEGIN
  -- Add investor as PENDING member (not shareholder yet)
  INSERT INTO business_profile_members (
    business_profile_id,
    user_id,
    user_email,
    user_name,
    role,
    ownership_share,
    status,
    can_sign,
    can_receive_notifications
  ) VALUES (
    p_business_profile_id,
    p_investor_id,
    COALESCE(p_investor_email, ''),
    COALESCE(p_investor_name, 'Investor'),
    'Investor',
    0,
    'pending',
    false,
    true
  )
  ON CONFLICT (business_profile_id, user_id) DO UPDATE
  SET 
    status = 'pending',
    role = 'Investor',
    updated_at = CURRENT_TIMESTAMP;
  
  RETURN QUERY SELECT true, 'Investor added as pending member (awaiting shareholder approval)';
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- FUNCTION: Get pending investors waiting for approval
-- =====================================================

CREATE OR REPLACE FUNCTION get_pending_investors(p_business_profile_id UUID)
RETURNS TABLE(
  id UUID,
  user_id UUID,
  user_email TEXT,
  user_name TEXT,
  status TEXT,
  created_at TIMESTAMP
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    bpm.id,
    bpm.user_id,
    bpm.user_email,
    bpm.user_name,
    bpm.status,
    bpm.created_at
  FROM business_profile_members bpm
  WHERE bpm.business_profile_id = p_business_profile_id
  AND bpm.status = 'pending'
  AND bpm.role = 'Investor'
  ORDER BY bpm.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- FUNCTION: Get shareholders for investment
-- =====================================================

CREATE OR REPLACE FUNCTION get_shareholders_for_investment(p_business_profile_id UUID)
RETURNS TABLE(
  id UUID,
  user_id UUID,
  user_email TEXT,
  user_name TEXT,
  role TEXT,
  ownership_share DECIMAL,
  can_sign BOOLEAN,
  can_receive_notifications BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    bpm.id,
    bpm.user_id,
    bpm.user_email,
    bpm.user_name,
    bpm.role,
    bpm.ownership_share,
    bpm.can_sign,
    bpm.can_receive_notifications
  FROM business_profile_members bpm
  WHERE bpm.business_profile_id = p_business_profile_id
  AND bpm.status = 'active'
  AND bpm.can_sign = true
  ORDER BY bpm.ownership_share DESC, bpm.created_at ASC;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- GRANTS
-- =====================================================

GRANT SELECT ON business_profile_members TO authenticated;
GRANT INSERT, UPDATE ON business_profile_members TO authenticated;
GRANT EXECUTE ON FUNCTION migrate_co_owners_to_members TO authenticated;
GRANT EXECUTE ON FUNCTION add_investor_as_pending_member TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_investor_as_shareholder_after_approval TO authenticated;
GRANT EXECUTE ON FUNCTION get_shareholders_for_investment TO authenticated;
GRANT EXECUTE ON FUNCTION get_pending_investors TO authenticated;

-- =====================================================
-- TEST/VERIFICATION QUERIES
-- =====================================================

-- View all business profile members
-- SELECT * FROM business_profile_members;

-- View shareholders by business profile
-- SELECT bpm.* FROM business_profile_members bpm 
-- WHERE bpm.business_profile_id = 'your-uuid-here'
-- ORDER BY bpm.ownership_share DESC;

-- Count members per business profile
-- SELECT 
--   bp.id,
--   bp.business_name,
--   COUNT(bpm.id) as member_count,
--   SUM(CASE WHEN bpm.can_sign THEN 1 ELSE 0 END) as signers_count
-- FROM business_profiles bp
-- LEFT JOIN business_profile_members bpm ON bp.id = bpm.business_profile_id
-- GROUP BY bp.id, bp.business_name;
