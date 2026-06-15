-- ============================================================
-- CMMS DEPLOYMENT GUIDE - QUICK SETUP
-- ============================================================
-- Follow these steps in order in Supabase SQL Editor
-- ============================================================

-- STEP 1: Deploy Base RLS Bypass for Admin Functions
-- File: CMMS_FIX_RLS_BYPASS_FOR_FUNCTIONS.sql
-- This enables CREATE/UPDATE/DELETE to work without RLS blocking

-- STEP 2: Deploy READ Functions
-- File: CMMS_READ_FUNCTIONS.sql
-- This enables LIST/FETCH to work without RLS blocking

-- ============================================================
-- AFTER DEPLOYMENT: Test These Steps
-- ============================================================

-- Test 1: Check functions exist
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_name LIKE 'fn_%'
AND routine_schema = 'public'
ORDER BY routine_name;

-- Expected Result: Should show 9+ functions including:
-- fn_create_cmms_company
-- fn_create_cmms_department
-- fn_update_cmms_department
-- fn_delete_cmms_department
-- fn_get_departments_by_company
-- fn_get_company_users_list
-- fn_get_all_roles
-- fn_get_inventory_by_company
-- fn_get_company_stats

-- ============================================================
-- USAGE FLOW (What will happen in app)
-- ============================================================
-- 1. User creates company → createCompanyProfile() 
--    ✅ DOES NOT auto-create departments
--
-- 2. User sees "Register Department" form
--    ✅ Manual entry
--
-- 3. User enters department name + details
--    → Calls createCmmsDepartment()
--    → RPC calls fn_create_cmms_department()
--    ✅ Function bypasses RLS and creates
--
-- 4. User clicks "View Departments"
--    → Calls getCmmsDepartments()
--    → RPC calls fn_get_departments_by_company()
--    ✅ Function bypasses RLS and returns list
--
-- 5. User can edit/update departments
--    → Calls updateCmmsDepartment()
--    → RPC calls fn_update_cmms_department()
--    ✅ Function bypasses RLS and updates
--
-- 6. User can delete departments
--    → Calls deleteCmmsDepartment()
--    → RPC calls fn_delete_cmms_department()
--    ✅ Function bypasses RLS and soft-deletes

-- ============================================================
-- KEY POINTS
-- ============================================================
-- ✅ No auto-creation
-- ✅ Manual control
-- ✅ Smooth editing
-- ✅ All changes saved
-- ✅ RLS protects data while functions manage operations
