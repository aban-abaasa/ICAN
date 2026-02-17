-- =====================================================
-- COMPLETE DELETE: ALL APPROVAL & NOTIFICATION TABLES
-- =====================================================
-- This deletes the ENTIRE TABLES (not just data)
-- =====================================================

-- Drop ALL notification/approval tables
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
-- VERIFY ALL TABLES ARE DELETED
-- =====================================================

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND (
    table_name LIKE '%notification%'
    OR table_name LIKE '%approval%'
    OR table_name LIKE '%agreement%'
    OR table_name LIKE '%shareholder%'
    OR table_name LIKE '%blockchain%'
  );

-- Should return EMPTY (no tables)

-- Count remaining tables
SELECT COUNT(*) as remaining_tables
FROM information_schema.tables
WHERE table_schema = 'public'
  AND (
    table_name LIKE '%notification%'
    OR table_name LIKE '%approval%'
    OR table_name LIKE '%agreement%'
  );

-- =====================================================
-- COMPLETE CLEAN SLATE!
-- =====================================================
-- All tables are now DELETED
-- Next: Run COMPREHENSIVE_SCHEMA_FIX.sql to recreate
