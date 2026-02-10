-- =====================================================
-- DELETE ALL APPROVAL & NOTIFICATION TABLES
-- =====================================================
-- WARNING: This will DELETE ALL DATA in these tables!
-- Only run if you want a completely fresh start
-- =====================================================

-- Step 1: Drop notification tables
DROP TABLE IF EXISTS investment_notifications CASCADE;
DROP TABLE IF EXISTS shareholder_notifications CASCADE;
DROP TABLE IF EXISTS business_profile_notifications CASCADE;

-- Step 2: Drop approval tables
DROP TABLE IF EXISTS investment_approvals CASCADE;
DROP TABLE IF EXISTS shareholder_approvals CASCADE;
DROP TABLE IF EXISTS agreement_approvals CASCADE;

-- Step 3: Drop agreement table (if exists)
DROP TABLE IF EXISTS investment_agreements CASCADE;

-- Step 4: Drop any other related tables
DROP TABLE IF EXISTS approval_status CASCADE;
DROP TABLE IF EXISTS notification_logs CASCADE;
DROP TABLE IF EXISTS investor_notifications CASCADE;

-- =====================================================
-- VERIFY ALL ARE DELETED
-- =====================================================

-- Check if any approval/notification tables remain
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND (
    table_name LIKE '%notification%'
    OR table_name LIKE '%approval%'
    OR table_name LIKE '%agreement%'
  );

-- Should return empty result (no tables found)

-- =====================================================
-- VERIFY DATA IS GONE
-- =====================================================

-- These queries should show errors (tables don't exist):
-- SELECT COUNT(*) FROM shareholder_notifications;
-- SELECT COUNT(*) FROM investment_notifications;
-- SELECT COUNT(*) FROM investment_approvals;

-- =====================================================
-- CLEAN SLATE COMPLETE!
-- =====================================================

-- All approval and notification tables are now DELETED
-- Next: Run COMPREHENSIVE_SCHEMA_FIX.sql to create fresh tables
