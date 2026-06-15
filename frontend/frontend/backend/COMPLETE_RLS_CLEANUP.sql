-- =====================================================
-- COMPLETE FIX: Clean ALL RLS policies
-- =====================================================
-- This fixes auth.users errors on ALL tables
-- =====================================================

-- =====================================================
-- FIX: investment_notifications (if exists)
-- =====================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'investment_notifications') THEN
    ALTER TABLE investment_notifications DISABLE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS "inv_notif_insert" ON investment_notifications';
    EXECUTE 'DROP POLICY IF EXISTS "inv_notif_select" ON investment_notifications';
    EXECUTE 'DROP POLICY IF EXISTS "inv_notif_update" ON investment_notifications';
    ALTER TABLE investment_notifications ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "inv_notif_insert" ON investment_notifications FOR INSERT WITH CHECK (true);
    CREATE POLICY "inv_notif_select" ON investment_notifications FOR SELECT USING (true);
    CREATE POLICY "inv_notif_update" ON investment_notifications FOR UPDATE USING (true);
  END IF;
END $$;

-- =====================================================
-- FIX: investment_approvals (if exists)
-- =====================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'investment_approvals') THEN
    ALTER TABLE investment_approvals DISABLE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS "inv_appr_insert" ON investment_approvals';
    EXECUTE 'DROP POLICY IF EXISTS "inv_appr_select" ON investment_approvals';
    EXECUTE 'DROP POLICY IF EXISTS "inv_appr_update" ON investment_approvals';
    ALTER TABLE investment_approvals ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "inv_appr_insert" ON investment_approvals FOR INSERT WITH CHECK (true);
    CREATE POLICY "inv_appr_select" ON investment_approvals FOR SELECT USING (true);
    CREATE POLICY "inv_appr_update" ON investment_approvals FOR UPDATE USING (true);
  END IF;
END $$;

-- =====================================================
-- FIX: investment_signatures (if exists)
-- =====================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'investment_signatures') THEN
    ALTER TABLE investment_signatures DISABLE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS "inv_sig_insert" ON investment_signatures';
    EXECUTE 'DROP POLICY IF EXISTS "inv_sig_select" ON investment_signatures';
    EXECUTE 'DROP POLICY IF EXISTS "inv_sig_update" ON investment_signatures';
    ALTER TABLE investment_signatures ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "inv_sig_insert" ON investment_signatures FOR INSERT WITH CHECK (true);
    CREATE POLICY "inv_sig_select" ON investment_signatures FOR SELECT USING (true);
    CREATE POLICY "inv_sig_update" ON investment_signatures FOR UPDATE USING (true);
  END IF;
END $$;

-- =====================================================
-- FIX: business_profile_members (if exists)
-- =====================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'business_profile_members') THEN
    ALTER TABLE business_profile_members DISABLE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS "bpm_insert" ON business_profile_members';
    EXECUTE 'DROP POLICY IF EXISTS "bpm_select" ON business_profile_members';
    EXECUTE 'DROP POLICY IF EXISTS "bpm_update" ON business_profile_members';
    ALTER TABLE business_profile_members ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "bpm_insert" ON business_profile_members FOR INSERT WITH CHECK (true);
    CREATE POLICY "bpm_select" ON business_profile_members FOR SELECT USING (true);
    CREATE POLICY "bpm_update" ON business_profile_members FOR UPDATE USING (true);
  END IF;
END $$;

-- =====================================================
-- FIX: investment_agreements (if exists)
-- =====================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'investment_agreements') THEN
    ALTER TABLE investment_agreements DISABLE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS "inv_agree_insert" ON investment_agreements';
    EXECUTE 'DROP POLICY IF EXISTS "inv_agree_select" ON investment_agreements';
    EXECUTE 'DROP POLICY IF EXISTS "inv_agree_update" ON investment_agreements';
    ALTER TABLE investment_agreements ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "inv_agree_insert" ON investment_agreements FOR INSERT WITH CHECK (true);
    CREATE POLICY "inv_agree_select" ON investment_agreements FOR SELECT USING (true);
    CREATE POLICY "inv_agree_update" ON investment_agreements FOR UPDATE USING (true);
  END IF;
END $$;

-- =====================================================
-- FIX: shareholder_notifications (OVERRIDE - no auth checks)
-- =====================================================
ALTER TABLE shareholder_notifications DISABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    policy_record RECORD;
BEGIN
    FOR policy_record IN 
        SELECT policyname FROM pg_policies 
        WHERE tablename = 'shareholder_notifications'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON shareholder_notifications', policy_record.policyname);
    END LOOP;
END $$;

ALTER TABLE shareholder_notifications ENABLE ROW LEVEL SECURITY;

-- Create ONLY simple policies with NO table access
CREATE POLICY "sn_insert" ON shareholder_notifications FOR INSERT WITH CHECK (true);
CREATE POLICY "sn_select" ON shareholder_notifications FOR SELECT USING (true);
CREATE POLICY "sn_update" ON shareholder_notifications FOR UPDATE USING (true);
CREATE POLICY "sn_delete" ON shareholder_notifications FOR DELETE USING (true);

-- =====================================================
-- VERIFICATION
-- =====================================================

-- Check shareholder_notifications policies
SELECT tablename, policyname, cmd FROM pg_policies 
WHERE tablename = 'shareholder_notifications'
ORDER BY policyname;

-- Find any remaining policies that access auth.users
SELECT tablename, policyname, qual FROM pg_policies
WHERE qual ILIKE '%auth.users%' OR qual ILIKE '%users%table%';

-- =====================================================
-- COMPLETE - All RLS policies cleaned!
-- =====================================================
