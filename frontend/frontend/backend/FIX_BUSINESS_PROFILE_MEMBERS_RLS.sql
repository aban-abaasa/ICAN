-- =====================================================
-- STEP 6: FIX BUSINESS_PROFILE_MEMBERS RLS
-- =====================================================
-- Ensure the business_profile_members table allows inserts

-- Enable RLS if not already
ALTER TABLE business_profile_members ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies
DROP POLICY IF EXISTS "business_profile_members_insert_unrestricted" ON business_profile_members;
DROP POLICY IF EXISTS "business_profile_members_select_own" ON business_profile_members;
DROP POLICY IF EXISTS "business_profile_members_update_own" ON business_profile_members;
DROP POLICY IF EXISTS "Users can view their own business members" ON business_profile_members;
DROP POLICY IF EXISTS "Users can update member info for their business" ON business_profile_members;
DROP POLICY IF EXISTS "Members can view profiles they're part of" ON business_profile_members;
DROP POLICY IF EXISTS "Owners can manage their business members" ON business_profile_members;

-- INSERT policy: Anyone can insert (business owners adding members)
CREATE POLICY "business_profile_members_insert_unrestricted"
  ON business_profile_members FOR INSERT
  WITH CHECK (true);

-- SELECT policy: Users can see members of their own business
CREATE POLICY "business_profile_members_select_own_business"
  ON business_profile_members FOR SELECT
  USING (
    business_profile_id IN (
      SELECT id FROM business_profiles WHERE user_id = auth.uid()
    )
    OR
    user_id = auth.uid()
  );

-- UPDATE policy: Business owners can update members of their business
CREATE POLICY "business_profile_members_update_own_business"
  ON business_profile_members FOR UPDATE
  USING (
    business_profile_id IN (
      SELECT id FROM business_profiles WHERE user_id = auth.uid()
    )
    OR
    user_id = auth.uid()
  );

-- =====================================================
-- STEP 7: VERIFY BUSINESS_PROFILE_MEMBERS
-- =====================================================

SELECT 
  policyname,
  permissive,
  cmd
FROM pg_policies
WHERE tablename = 'business_profile_members'
ORDER BY policyname;

-- =====================================================
-- SUCCESS
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '✅ BUSINESS_PROFILE_MEMBERS RLS FIXED!';
  RAISE NOTICE '📋 Changes:';
  RAISE NOTICE '   ✅ Set INSERT policy to unrestricted (true)';
  RAISE NOTICE '   ✅ Set SELECT/UPDATE policies appropriately';
  RAISE NOTICE '🔐 RLS policies now allow members to be added';
  RAISE NOTICE '✨ RPC function will work correctly!';
END $$;
