-- Delete all business profiles and related data
-- This will cascade delete all business_co_owners due to FK constraint

DELETE FROM business_profiles;

-- Verify deletion
SELECT COUNT(*) as remaining_profiles FROM business_profiles;
SELECT COUNT(*) as remaining_co_owners FROM business_co_owners;
