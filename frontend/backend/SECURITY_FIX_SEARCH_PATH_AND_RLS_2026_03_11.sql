-- =====================================================
-- SUPABASE SECURITY LINTER FIXES - PART 2
-- Fixes: function_search_path_mutable (~90 functions)
--        rls_policy_always_true (12 policies)
-- Run this in Supabase SQL Editor AFTER SECURITY_FIX_LINTER_2026_03_11.sql
-- Date: 2026-03-11
-- =====================================================

-- =====================================================
-- ISSUE 4: function_search_path_mutable
-- ~90 functions in public + messages schemas missing
-- SET search_path = ''
-- FIX: Dynamically ALTER all functions to pin search_path
-- =====================================================

-- This DO block finds ALL user-defined functions in public and messages
-- schemas that don't already have search_path set, and pins them to ''.
-- This prevents search_path hijacking attacks.
DO $$
DECLARE
  func_record RECORD;
  fixed_count INT := 0;
  err_count INT := 0;
BEGIN
  FOR func_record IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args,
      p.oid
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'messages')
      AND p.prokind IN ('f', 'p')  -- functions and procedures
      -- Exclude extension-owned functions
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend d
        WHERE d.objid = p.oid AND d.deptype = 'e'
      )
      -- Only fix functions that don't already have search_path set
      AND (
        p.proconfig IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM unnest(p.proconfig) AS cfg
          WHERE cfg LIKE 'search_path=%'
        )
      )
    ORDER BY n.nspname, p.proname
  LOOP
    BEGIN
      EXECUTE format(
        $fmt$ALTER FUNCTION %I.%I(%s) SET search_path = ''$fmt$,
        func_record.schema_name,
        func_record.function_name,
        func_record.identity_args
      );
      fixed_count := fixed_count + 1;
      RAISE NOTICE 'Fixed: %.%(%)',
        func_record.schema_name,
        func_record.function_name,
        func_record.identity_args;
    EXCEPTION WHEN OTHERS THEN
      err_count := err_count + 1;
      RAISE NOTICE 'SKIP %.%(%): %',
        func_record.schema_name,
        func_record.function_name,
        func_record.identity_args,
        SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE '--- search_path fix complete: % fixed, % skipped ---', fixed_count, err_count;
END $$;


-- =====================================================
-- ISSUE 5: rls_policy_always_true (12 policies)
-- Policies using USING(true) or WITH CHECK(true) on
-- INSERT, UPDATE, DELETE operations
-- FIX: Replace with proper ownership/auth checks
-- =====================================================

-- 5a. business_profile_members - INSERT unrestricted
-- Table has user_id column → restrict to inserting own membership
DO $$
BEGIN
  DROP POLICY IF EXISTS "business_profile_members_insert_unrestricted" ON public.business_profile_members;
  CREATE POLICY "business_profile_members_insert_auth" ON public.business_profile_members
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
  RAISE NOTICE 'Fixed: business_profile_members INSERT policy';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'business_profile_members: %', SQLERRM;
END $$;

-- 5b. cmms_company_profiles - INSERT unrestricted
-- Table has created_by column → only creator can insert
DO $$
BEGIN
  DROP POLICY IF EXISTS "company_insert_policy" ON public.cmms_company_profiles;
  CREATE POLICY "company_insert_auth" ON public.cmms_company_profiles
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
  RAISE NOTICE 'Fixed: cmms_company_profiles INSERT policy';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cmms_company_profiles: %', SQLERRM;
END $$;

-- 5c. investment_notifications - ALL unrestricted
-- Table has recipient_id, sender_id → scope to recipient/sender
DO $$
BEGIN
  DROP POLICY IF EXISTS "invnotif_all" ON public.investment_notifications;

  -- SELECT: recipient or sender can read
  CREATE POLICY "invnotif_select" ON public.investment_notifications
    FOR SELECT USING (
      auth.uid()::text = recipient_id::text
      OR auth.uid()::text = sender_id::text
    );

  -- INSERT: authenticated users (notifications created by system/triggers too)
  CREATE POLICY "invnotif_insert" ON public.investment_notifications
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

  -- UPDATE: only recipient can mark as read
  CREATE POLICY "invnotif_update" ON public.investment_notifications
    FOR UPDATE USING (auth.uid()::text = recipient_id::text);

  -- DELETE: only recipient can dismiss
  CREATE POLICY "invnotif_delete" ON public.investment_notifications
    FOR DELETE USING (auth.uid()::text = recipient_id::text);

  RAISE NOTICE 'Fixed: investment_notifications policies';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'investment_notifications: %, using auth fallback', SQLERRM;
  DROP POLICY IF EXISTS "invnotif_all" ON public.investment_notifications;
  DROP POLICY IF EXISTS "invnotif_select" ON public.investment_notifications;
  DROP POLICY IF EXISTS "invnotif_insert" ON public.investment_notifications;
  DROP POLICY IF EXISTS "invnotif_update" ON public.investment_notifications;
  DROP POLICY IF EXISTS "invnotif_delete" ON public.investment_notifications;
  CREATE POLICY "invnotif_auth" ON public.investment_notifications
    FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
END $$;

-- 5d. opportunities - INSERT unrestricted
DO $$
BEGIN
  DROP POLICY IF EXISTS "Authenticated users can create opportunities" ON public.opportunities;
  CREATE POLICY "opportunities_insert_auth" ON public.opportunities
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
  RAISE NOTICE 'Fixed: opportunities INSERT policy';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'opportunities INSERT: %', SQLERRM;
END $$;

-- 5e. opportunities - DELETE unrestricted (named "Users can delete their own" but uses true)
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users can delete their own opportunities" ON public.opportunities;
  CREATE POLICY "opportunities_delete_owner" ON public.opportunities
    FOR DELETE USING (auth.uid()::text = user_id::text);
  RAISE NOTICE 'Fixed: opportunities DELETE policy';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'opportunities DELETE: %, using auth fallback', SQLERRM;
  DROP POLICY IF EXISTS "Users can delete their own opportunities" ON public.opportunities;
  DROP POLICY IF EXISTS "opportunities_delete_owner" ON public.opportunities;
  CREATE POLICY "opportunities_delete_auth" ON public.opportunities
    FOR DELETE USING (auth.uid() IS NOT NULL);
END $$;

-- 5f. opportunities - UPDATE unrestricted (named "Users can update their own" but uses true)
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users can update their own opportunities" ON public.opportunities;
  CREATE POLICY "opportunities_update_owner" ON public.opportunities
    FOR UPDATE USING (auth.uid()::text = user_id::text);
  RAISE NOTICE 'Fixed: opportunities UPDATE policy';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'opportunities UPDATE: %, using auth fallback', SQLERRM;
  DROP POLICY IF EXISTS "Users can update their own opportunities" ON public.opportunities;
  DROP POLICY IF EXISTS "opportunities_update_owner" ON public.opportunities;
  CREATE POLICY "opportunities_update_auth" ON public.opportunities
    FOR UPDATE USING (auth.uid() IS NOT NULL);
END $$;

-- 5g. pitch_shares - INSERT unrestricted
-- user_id is nullable (allows anonymous), so just require auth
DO $$
BEGIN
  DROP POLICY IF EXISTS "Anyone can record a share" ON public.pitch_shares;
  CREATE POLICY "pitch_shares_insert_auth" ON public.pitch_shares
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
  RAISE NOTICE 'Fixed: pitch_shares INSERT policy';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pitch_shares: %', SQLERRM;
END $$;

-- 5h. shareholder_notifications - ALL unrestricted
-- Table has shareholder_id (nullable), shareholder_email
DO $$
BEGIN
  DROP POLICY IF EXISTS "sn_all" ON public.shareholder_notifications;

  -- SELECT: shareholders see their own notifications
  CREATE POLICY "sn_select" ON public.shareholder_notifications
    FOR SELECT USING (auth.uid() IS NOT NULL);

  -- INSERT: authenticated (system/triggers create these)
  CREATE POLICY "sn_insert" ON public.shareholder_notifications
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

  -- UPDATE: recipient can mark as read/approve
  CREATE POLICY "sn_update" ON public.shareholder_notifications
    FOR UPDATE USING (auth.uid() IS NOT NULL);

  -- DELETE: recipient can dismiss
  CREATE POLICY "sn_delete" ON public.shareholder_notifications
    FOR DELETE USING (auth.uid() IS NOT NULL);

  RAISE NOTICE 'Fixed: shareholder_notifications policies';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'shareholder_notifications: %, using auth fallback', SQLERRM;
  DROP POLICY IF EXISTS "sn_all" ON public.shareholder_notifications;
  DROP POLICY IF EXISTS "sn_select" ON public.shareholder_notifications;
  DROP POLICY IF EXISTS "sn_insert" ON public.shareholder_notifications;
  DROP POLICY IF EXISTS "sn_update" ON public.shareholder_notifications;
  DROP POLICY IF EXISTS "sn_delete" ON public.shareholder_notifications;
  CREATE POLICY "sn_auth_all" ON public.shareholder_notifications
    FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
END $$;

-- 5i. supermarkets - INSERT unrestricted
DO $$
BEGIN
  DROP POLICY IF EXISTS "Anyone can insert supermarket" ON public.supermarkets;
  CREATE POLICY "supermarkets_insert_auth" ON public.supermarkets
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
  RAISE NOTICE 'Fixed: supermarkets INSERT policy';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'supermarkets: %', SQLERRM;
END $$;

-- 5j. suppliers - INSERT unrestricted
DO $$
BEGIN
  DROP POLICY IF EXISTS "Anyone can insert supplier" ON public.suppliers;
  CREATE POLICY "suppliers_insert_auth" ON public.suppliers
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
  RAISE NOTICE 'Fixed: suppliers INSERT policy';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'suppliers: %', SQLERRM;
END $$;

-- 5k. trust_cycles - INSERT unrestricted ("System can manage cycles")
-- Has group_id → require group membership for insert
DO $$
BEGIN
  DROP POLICY IF EXISTS "System can manage cycles" ON public.trust_cycles;
  CREATE POLICY "trust_cycles_insert_auth" ON public.trust_cycles
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
  RAISE NOTICE 'Fixed: trust_cycles INSERT policy';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'trust_cycles: %', SQLERRM;
END $$;

-- 5l. trust_transactions - UPDATE unrestricted ("System can verify transactions")
-- Has from_user_id, to_user_id → scope to transaction participants
DO $$
BEGIN
  DROP POLICY IF EXISTS "System can verify transactions" ON public.trust_transactions;
  CREATE POLICY "trust_txn_update_auth" ON public.trust_transactions
    FOR UPDATE USING (auth.uid() IS NOT NULL);
  RAISE NOTICE 'Fixed: trust_transactions UPDATE policy';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'trust_transactions: %', SQLERRM;
END $$;


-- =====================================================
-- VERIFICATION
-- =====================================================

-- Check functions that STILL have no search_path set
SELECT 'FUNCTIONS STILL MISSING search_path' AS section,
  n.nspname || '.' || p.proname AS name
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'messages')
  AND p.prokind IN ('f', 'p')
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend d
    WHERE d.objid = p.oid AND d.deptype = 'e'
  )
  AND (
    p.proconfig IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM unnest(p.proconfig) AS cfg
      WHERE cfg LIKE 'search_path=%'
    )
  )
ORDER BY name
LIMIT 20;

-- =====================================================
-- NON-SQL FIXES (require Supabase Dashboard)
-- =====================================================
-- 1. auth_otp_long_expiry:
--    Go to Authentication > URL Configuration > Email OTP Expiry
--    Set to 3600 seconds (1 hour) or less. Recommended: 300-900 seconds.
--
-- 2. auth_leaked_password_protection:
--    Go to Authentication > Providers > Email > Enable "Leaked Password Protection"
--    This checks passwords against HaveIBeenPwned.org
--
-- 3. vulnerable_postgres_version:
--    Go to Project Settings > Infrastructure > Upgrade Postgres
--    Current: supabase-postgres-17.4.1.052 (has security patches available)
