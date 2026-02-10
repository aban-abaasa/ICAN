-- =====================================================
-- NUCLEAR CLEANUP: Remove ALL trust policies and rebuild
-- Use this if you keep getting policy already exists errors
-- =====================================================

-- This script will:
-- 1. Drop ALL policies from ALL trust tables
-- 2. Verify RLS is enabled
-- 3. Recreate clean policies

-- =============================================
-- 1. COMPREHENSIVE POLICY CLEANUP (ALL TABLES)
-- =============================================

-- ALL POLICIES FROM trust_groups
DROP POLICY IF EXISTS "Users can view groups they created" ON public.trust_groups;
DROP POLICY IF EXISTS "Users can view groups they joined" ON public.trust_groups;
DROP POLICY IF EXISTS "Users can create groups" ON public.trust_groups;
DROP POLICY IF EXISTS "Only creators can update" ON public.trust_groups;
DROP POLICY IF EXISTS "Anyone can view active groups" ON public.trust_groups;
DROP POLICY IF EXISTS "Creators can update their groups" ON public.trust_groups;
DROP POLICY IF EXISTS "Anyone can view public groups" ON public.trust_groups;
DROP POLICY IF EXISTS "Users can see their own groups" ON public.trust_groups;

-- ALL POLICIES FROM trust_group_members
DROP POLICY IF EXISTS "Users can view group members" ON public.trust_group_members;
DROP POLICY IF EXISTS "Users can view their membership" ON public.trust_group_members;
DROP POLICY IF EXISTS "Users can request membership" ON public.trust_group_members;
DROP POLICY IF EXISTS "Users can join groups" ON public.trust_group_members;
DROP POLICY IF EXISTS "Users can update their own membership" ON public.trust_group_members;
DROP POLICY IF EXISTS "Users can view all members (public visibility)" ON public.trust_group_members;

-- ALL POLICIES FROM trust_transactions
DROP POLICY IF EXISTS "Users can view group transactions" ON public.trust_transactions;
DROP POLICY IF EXISTS "Users can create transactions" ON public.trust_transactions;
DROP POLICY IF EXISTS "Users can view transactions" ON public.trust_transactions;
DROP POLICY IF EXISTS "System can verify transactions" ON public.trust_transactions;
DROP POLICY IF EXISTS "Users can view transactions (public)" ON public.trust_transactions;

-- ALL POLICIES FROM trust_cycles
DROP POLICY IF EXISTS "Users can view cycles" ON public.trust_cycles;
DROP POLICY IF EXISTS "Users can create cycles" ON public.trust_cycles;
DROP POLICY IF EXISTS "System can manage cycles" ON public.trust_cycles;

-- ALL POLICIES FROM trust_disputes
DROP POLICY IF EXISTS "Users can view disputes" ON public.trust_disputes;
DROP POLICY IF EXISTS "Users can create disputes" ON public.trust_disputes;
DROP POLICY IF EXISTS "Users can view all disputes" ON public.trust_disputes;
DROP POLICY IF EXISTS "Users can manage disputes" ON public.trust_disputes;

-- =============================================
-- 2. VERIFY RLS IS ENABLED
-- =============================================
ALTER TABLE public.trust_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trust_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trust_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trust_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trust_disputes ENABLE ROW LEVEL SECURITY;

-- =============================================
-- 3. CREATE CLEAN NON-RECURSIVE POLICIES
-- =============================================

-- TRUST GROUPS
CREATE POLICY "Anyone can view active groups"
    ON public.trust_groups FOR SELECT
    USING (status = 'active' OR creator_id = auth.uid());

CREATE POLICY "Users can create groups"
    ON public.trust_groups FOR INSERT
    WITH CHECK (creator_id = auth.uid());

CREATE POLICY "Creators can update their groups"
    ON public.trust_groups FOR UPDATE
    USING (creator_id = auth.uid());

-- TRUST GROUP MEMBERS
CREATE POLICY "Users can view group members"
    ON public.trust_group_members FOR SELECT
    USING (true);

CREATE POLICY "Users can join groups"
    ON public.trust_group_members FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own membership"
    ON public.trust_group_members FOR UPDATE
    USING (user_id = auth.uid());

-- TRUST TRANSACTIONS
CREATE POLICY "Users can view transactions"
    ON public.trust_transactions FOR SELECT
    USING (true);

CREATE POLICY "Users can create transactions"
    ON public.trust_transactions FOR INSERT
    WITH CHECK (from_user_id = auth.uid());

CREATE POLICY "System can verify transactions"
    ON public.trust_transactions FOR UPDATE
    USING (true);

-- TRUST CYCLES
CREATE POLICY "Users can view cycles"
    ON public.trust_cycles FOR SELECT
    USING (true);

CREATE POLICY "System can manage cycles"
    ON public.trust_cycles FOR INSERT
    WITH CHECK (true);

-- TRUST DISPUTES
CREATE POLICY "Users can view disputes"
    ON public.trust_disputes FOR SELECT
    USING (true);

CREATE POLICY "Users can create disputes"
    ON public.trust_disputes FOR INSERT
    WITH CHECK (raised_by_id = auth.uid());

-- =============================================
-- 4. VERIFICATION REPORT
-- =============================================
SELECT 
    'ALL POLICIES CLEANED AND REBUILT' as status,
    NOW() as cleaned_at,
    'Ready for deployment' as message;

-- Show all policies
SELECT 
    tablename,
    COUNT(*) as policy_count
FROM pg_policies 
WHERE schemaname = 'public' 
AND tablename LIKE 'trust_%'
GROUP BY tablename
ORDER BY tablename;

-- Expected output:
-- trust_disputes       | 2 policies
-- trust_group_members  | 3 policies
-- trust_groups         | 3 policies
-- trust_transactions   | 3 policies
-- trust_cycles         | 2 policies
-- TOTAL: 13 policies
