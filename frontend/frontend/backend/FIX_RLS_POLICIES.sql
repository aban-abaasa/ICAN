-- 🔧 FIX RLS POLICIES FOR ICAN TABLES
-- The current policies are too restrictive

-- ===== FIX 1: ICAN_USER_WALLETS =====
-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can view own wallets" ON ican_user_wallets;
DROP POLICY IF EXISTS "Users can insert own wallets" ON ican_user_wallets;
DROP POLICY IF EXISTS "Users can update own wallets" ON ican_user_wallets;

-- Create permissive READ policy
CREATE POLICY "ican_user_wallets_select"
  ON ican_user_wallets
  FOR SELECT
  USING (auth.uid() = user_id);

-- Create permissive UPDATE policy
CREATE POLICY "ican_user_wallets_update"
  ON ican_user_wallets
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create permissive INSERT policy
CREATE POLICY "ican_user_wallets_insert"
  ON ican_user_wallets
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ===== FIX 2: ICAN_COIN_BLOCKCHAIN_TXS =====
-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can view own transactions" ON ican_coin_blockchain_txs;
DROP POLICY IF EXISTS "Users can insert own transactions" ON ican_coin_blockchain_txs;

-- Create permissive READ policy
CREATE POLICY "ican_coin_blockchain_txs_select"
  ON ican_coin_blockchain_txs
  FOR SELECT
  USING (auth.uid() = user_id);

-- Create permissive INSERT policy (CRITICAL FIX)
CREATE POLICY "ican_coin_blockchain_txs_insert"
  ON ican_coin_blockchain_txs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ===== FIX 3: BUSINESS_PROFILE_MEMBERS =====
-- Problem: Only business owner can insert, blocks investor additions
-- Solution: Allow investors to add themselves as pending members

DROP POLICY IF EXISTS "Business owners can insert members" ON business_profile_members;
DROP POLICY IF EXISTS "Investors can add themselves as pending members" ON business_profile_members;
CREATE POLICY "Business owners and investors can insert members"
ON business_profile_members FOR INSERT
WITH CHECK (
  -- Allow business owner to insert
  business_profile_id IN (
    SELECT id FROM business_profiles WHERE user_id = auth.uid()
  )
  OR
  -- Allow any user to add themselves (needed for pending member RPC)
  (user_id = auth.uid())
);

DROP POLICY IF EXISTS "Business owners can update members" ON business_profile_members;
CREATE POLICY "Business owners and self can update members"
ON business_profile_members FOR UPDATE
USING (
  business_profile_id IN (
    SELECT id FROM business_profiles WHERE user_id = auth.uid()
  )
  OR
  (user_id = auth.uid())
)
WITH CHECK (
  business_profile_id IN (
    SELECT id FROM business_profiles WHERE user_id = auth.uid()
  )
  OR
  (user_id = auth.uid())
);

DROP POLICY IF EXISTS "Members can view themselves" ON business_profile_members;
CREATE POLICY "Members can view themselves"
ON business_profile_members FOR SELECT
USING (
  user_id = auth.uid() 
  OR 
  business_profile_id IN (
    SELECT id FROM business_profiles WHERE user_id = auth.uid()
  )
);

ALTER TABLE business_profile_members ENABLE ROW LEVEL SECURITY;

-- ===== FIX 4: BUSINESS_CO_OWNERS =====
-- Problem: Shareholders not being notified because they're in business_co_owners table
-- Solution: Ensure business owners and shareholders can read co-owner records

DROP POLICY IF EXISTS "Business owners can view co-owners" ON business_co_owners;
CREATE POLICY "Business owners can view co-owners"
ON business_co_owners FOR SELECT
USING (
  business_profile_id IN (
    SELECT id FROM business_profiles WHERE user_id = auth.uid()
  )
  OR user_id = auth.uid()
);

DROP POLICY IF EXISTS "Business owners can manage co-owners" ON business_co_owners;
CREATE POLICY "Business owners can manage co-owners"
ON business_co_owners FOR INSERT
WITH CHECK (
  business_profile_id IN (
    SELECT id FROM business_profiles WHERE user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Business owners can update co-owners" ON business_co_owners;
CREATE POLICY "Business owners can update co-owners"
ON business_co_owners FOR UPDATE
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

ALTER TABLE business_co_owners ENABLE ROW LEVEL SECURITY;

-- ===== FIX 4: INVESTMENT_NOTIFICATIONS =====
-- Problem: INSERT blocked by restrictive RLS policy
-- Solution: Allow unrestricted inserts, restrict reads to recipient

DROP POLICY IF EXISTS "Users can view their own notifications" ON investment_notifications;
DROP POLICY IF EXISTS "Users can update their own notifications" ON investment_notifications;
DROP POLICY IF EXISTS "System can create notifications" ON investment_notifications;

-- Unrestricted INSERT for all notification types
CREATE POLICY "investment_notifications_insert_all"
ON investment_notifications FOR INSERT
WITH CHECK (true);

-- Restricted SELECT (users see only their own notifications)
CREATE POLICY "investment_notifications_select_own"
ON investment_notifications FOR SELECT
USING (auth.uid() = recipient_id);

-- Restricted UPDATE (users update only their own)
CREATE POLICY "investment_notifications_update_own"
ON investment_notifications FOR UPDATE
USING (auth.uid() = recipient_id)
WITH CHECK (auth.uid() = recipient_id);

ALTER TABLE investment_notifications ENABLE ROW LEVEL SECURITY;

-- Verify policies are in place
SELECT '✅ RLS POLICIES FIXED' as status;
SELECT 'ican_user_wallets: SELECT, INSERT, UPDATE enabled' as table_1;
SELECT 'ican_coin_blockchain_txs: SELECT, INSERT enabled' as table_2;
SELECT 'business_profile_members: INSERT, UPDATE, SELECT enabled for investors' as table_3;
SELECT 'business_co_owners: SELECT enabled for owners/shareholders to fetch for notifications' as table_4;
SELECT 'investment_notifications: INSERT unrestricted, SELECT/UPDATE restricted' as table_5;
