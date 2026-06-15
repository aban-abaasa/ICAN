-- =====================================================
-- NUCLEAR DELETE: Drop VIEWS and TABLES
-- =====================================================
-- Drop VIEWS first, then TABLES
-- =====================================================

-- Step 1: Drop VIEWS first
DROP VIEW IF EXISTS business_shareholders_for_approval CASCADE;

-- Step 2: Drop specific TABLES we know about
DROP TABLE IF EXISTS investment_notifications CASCADE;
DROP TABLE IF EXISTS shareholder_notifications CASCADE;
DROP TABLE IF EXISTS business_profile_notifications CASCADE;
DROP TABLE IF EXISTS community_notifications CASCADE;
DROP TABLE IF EXISTS investment_approvals CASCADE;
DROP TABLE IF EXISTS shareholder_approvals CASCADE;
DROP TABLE IF EXISTS agreement_approvals CASCADE;
DROP TABLE IF EXISTS blockchain_approvals CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS transaction_approval_requests CASCADE;
DROP TABLE IF EXISTS member_approvals CASCADE;
DROP TABLE IF EXISTS agreement_activity_log CASCADE;
DROP TABLE IF EXISTS cmms_notifications CASCADE;
DROP TABLE IF EXISTS cmms_notification_audit CASCADE;
DROP TABLE IF EXISTS investor_notifications CASCADE;
DROP TABLE IF EXISTS approval_status CASCADE;
DROP TABLE IF EXISTS notification_logs CASCADE;
DROP TABLE IF EXISTS investment_agreements CASCADE;
DROP TABLE IF EXISTS agreement_signatories CASCADE;
DROP TABLE IF EXISTS agreement_templates CASCADE;

-- =====================================================
-- Step 3: Dynamic - Drop ANY remaining VIEWs
-- =====================================================
DO $$
DECLARE
  view_record RECORD;
BEGIN
  FOR view_record IN
    SELECT table_name
    FROM information_schema.views
    WHERE table_schema = 'public'
      AND (
        table_name LIKE '%notification%'
        OR table_name LIKE '%approval%'
        OR table_name LIKE '%agreement%'
        OR table_name LIKE '%shareholder%'
        OR table_name LIKE '%blockchain%'
        OR table_name LIKE '%transaction%'
      )
  LOOP
    EXECUTE 'DROP VIEW IF EXISTS ' || view_record.table_name || ' CASCADE';
    RAISE NOTICE 'Dropped view: %', view_record.table_name;
  END LOOP;
END $$;

-- =====================================================
-- Step 4: Dynamic - Drop ANY remaining TABLES
-- =====================================================
DO $$
DECLARE
  table_record RECORD;
BEGIN
  FOR table_record IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND (
        table_name LIKE '%notification%'
        OR table_name LIKE '%approval%'
        OR table_name LIKE '%agreement%'
        OR table_name LIKE '%shareholder%'
        OR table_name LIKE '%blockchain%'
        OR table_name LIKE '%transaction%'
      )
  LOOP
    EXECUTE 'DROP TABLE IF EXISTS ' || table_record.table_name || ' CASCADE';
    RAISE NOTICE 'Dropped table: %', table_record.table_name;
  END LOOP;
END $$;

-- =====================================================
-- VERIFY: Check if ANY remain
-- =====================================================

SELECT 
  COUNT(*) as remaining_tables,
  string_agg(table_name, ', ') as tables
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND (
    table_name LIKE '%notification%'
    OR table_name LIKE '%approval%'
    OR table_name LIKE '%agreement%'
    OR table_name LIKE '%shareholder%'
    OR table_name LIKE '%blockchain%'
  );

-- Expected: remaining_tables = 0 (all deleted)

SELECT 
  COUNT(*) as remaining_views,
  string_agg(table_name, ', ') as views
FROM information_schema.views
WHERE table_schema = 'public'
  AND (
    table_name LIKE '%notification%'
    OR table_name LIKE '%approval%'
    OR table_name LIKE '%agreement%'
    OR table_name LIKE '%shareholder%'
    OR table_name LIKE '%blockchain%'
  );

-- Expected: remaining_views = 0 (all deleted)

-- =====================================================
-- COMPLETE DELETION!
-- =====================================================

-- ✅ All notification VIEWS DROPPED
-- ✅ All approval VIEWS DROPPED
-- ✅ All notification TABLES DROPPED
-- ✅ All approval TABLES DROPPED
-- ✅ Schema and data completely removed

-- Next step:
-- Run COMPREHENSIVE_SCHEMA_FIX.sql to recreate clean tables
