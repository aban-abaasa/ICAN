-- ============================================
-- CMMS - CLEAN UP DUPLICATE DATA
-- ============================================

-- Option 1: DELETE ALL TEST DATA (Nuclear Option - Fresh Start)
-- WARNING: This will delete everything!
DELETE FROM cmms_user_roles;
DELETE FROM cmms_users;
DELETE FROM cmms_company_profiles;

-- Option 2: CHECK WHAT DATA EXISTS
SELECT 'Company Profiles' as table_name, COUNT(*) as count FROM cmms_company_profiles
UNION ALL
SELECT 'CMMS Users', COUNT(*) FROM cmms_users
UNION ALL
SELECT 'CMMS User Roles', COUNT(*) FROM cmms_user_roles;

-- Show all existing companies
SELECT id, company_name, email, company_registration FROM cmms_company_profiles;

-- Show all existing users
SELECT id, email, user_name, cmms_company_id FROM cmms_users;
