-- =====================================================
-- NUCLEAR DELETE: DROP ALL TABLES COMPLETELY
-- =====================================================
-- This DROPS the ENTIRE TABLES (schema + data)
-- Not just deleting data - COMPLETE removal
-- =====================================================

-- Method 1: Drop specific tables we know about
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
DROP TABLE IF EXISTS business_shareholders_for_approval CASCADE;
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
-- Method 2: Dynamic - Drop ANY table with keywords
-- =====================================================
DO $$
DECLARE
  table_record RECORD;
BEGIN
  FOR table_record IN
    SELECT table_name
    FROM information_schema.tables
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
  AND (
    table_name LIKE '%notification%'
    OR table_name LIKE '%approval%'
    OR table_name LIKE '%agreement%'
    OR table_name LIKE '%shareholder%'
    OR table_name LIKE '%blockchain%'
  );

-- Expected: remaining_tables = 0 (all deleted)

-- =====================================================
-- TABLES ARE NOW COMPLETELY DELETED!
-- =====================================================

-- ✅ All notification tables DROPPED
-- ✅ All approval tables DROPPED
-- ✅ All agreement tables DROPPED
-- ✅ Schema and data completely removed

-- Next step:
-- 1. Run COMPREHENSIVE_SCHEMA_FIX.sql
-- 2. This will recreate clean tables from scratch
