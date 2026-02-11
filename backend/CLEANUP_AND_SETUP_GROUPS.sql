/**
 * 🧹 CLEANUP AND SETUP FOR GROUP WALLET SYSTEM
 * Removes all existing groups and sets up fresh database
 * ⚠️ WARNING: This deletes all trust group data - use with caution!
 */

-- ============================================================================
-- STEP 1: Delete all existing groups and related data
-- ============================================================================

-- Disable foreign key constraints temporarily
SET session_replication_role = 'replica';

-- Delete from dependent tables first (child tables first)
-- Only delete from tables that exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'group_wallet_approvals') THEN
    DELETE FROM public.group_wallet_approvals WHERE TRUE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'group_wallet_transactions') THEN
    DELETE FROM public.group_wallet_transactions WHERE TRUE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'group_pin_changes') THEN
    DELETE FROM public.group_pin_changes WHERE TRUE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'group_wallet_settings') THEN
    DELETE FROM public.group_wallet_settings WHERE TRUE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'group_accounts') THEN
    DELETE FROM public.group_accounts WHERE TRUE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'group_wallet_audit') THEN
    DELETE FROM public.group_wallet_audit WHERE TRUE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'membership_votes') THEN
    DELETE FROM public.membership_votes WHERE TRUE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'voting_applications') THEN
    DELETE FROM public.voting_applications WHERE TRUE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'group_members') THEN
    DELETE FROM public.group_members WHERE TRUE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'trust_groups') THEN
    DELETE FROM public.trust_groups WHERE TRUE;
  END IF;
END $$;

-- Re-enable foreign key constraints
SET session_replication_role = 'default';

-- ============================================================================
-- STEP 2: Reset sequences (if any auto-increment exists)
-- ============================================================================
-- Note: UUIDs don't need sequence reset, but if you have serial columns:
-- ALTER SEQUENCE IF EXISTS public.trust_groups_id_seq RESTART WITH 1;

-- ============================================================================
-- STEP 3: Verify deletion
-- ============================================================================
SELECT 'Remaining trust_groups' as check_name, COUNT(*) as count FROM public.trust_groups
UNION ALL
SELECT 'Remaining group_accounts', COUNT(*) FROM public.group_accounts
UNION ALL
SELECT 'Remaining group_wallet_transactions', COUNT(*) FROM public.group_wallet_transactions
UNION ALL
SELECT 'Remaining group_members', COUNT(*) FROM public.group_members
UNION ALL
SELECT 'Remaining voting_applications', COUNT(*) FROM public.voting_applications
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'voting_applications');

-- ============================================================================
-- STEP 4: (Optional) Recreate sample test data
-- ============================================================================

-- Uncomment below to create test groups after cleanup

/*
-- Insert sample trust groups
INSERT INTO public.trust_groups (name, description, max_members, monthly_contribution, status, creator_id)
SELECT 
  'Test Group ' || num,
  'Sample trust group ' || num || ' for testing group wallet functionality',
  30,
  100,
  'active',
  auth.uid()
FROM generate_series(1, 3) AS num;

-- Get created groups and display
SELECT id, name, creator_id FROM public.trust_groups WHERE name LIKE 'Test Group%';
*/

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- ✅ All trust groups deleted
-- ✅ All group members deleted
-- ✅ All voting applications deleted
-- ✅ All group wallet accounts deleted
-- ✅ All group wallet transactions deleted
-- ✅ Database is now clean for fresh setup
--
-- Next steps:
-- 1. Run GROUP_WALLET_MANAGEMENT.sql to create fresh tables
-- 2. Create groups from the UI
-- 3. Set PINs for group wallets when needed
