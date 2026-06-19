-- ============================================================
-- SAFE FIX: Specific User Role Update
-- ============================================================
-- WARNING: Only run this for SPECIFIC users who need fixing
-- DO NOT run bulk updates on production with multiple companies
-- ============================================================

-- ============================================================
-- STEP 1: DIAGNOSTIC - Check specific user's current state
-- ============================================================

-- Replace with the actual user email who is having the issue
DO $$
DECLARE
  v_target_email TEXT := 'icanera@gmail.com';  -- ⚠️ CHANGE THIS TO ACTUAL USER EMAIL
BEGIN
  RAISE NOTICE '=== CHECKING USER: % ===', v_target_email;
END $$;

-- Check this specific user's role in all companies they belong to
SELECT 
  cu.id as user_id,
  cu.email,
  cu.name,
  cu.role,
  cu.cmms_company_id,
  cc.company_name,
  cu.is_active,
  LENGTH(cu.role) as role_length,
  CASE 
    WHEN cu.role IS NULL THEN '❌ Role is NULL'
    WHEN LENGTH(TRIM(cu.role)) != LENGTH(cu.role) THEN '⚠️ Has whitespace'
    WHEN LOWER(cu.role) != cu.role THEN '⚠️ Has uppercase'
    WHEN LOWER(TRIM(cu.role)) IN ('admin', 'coordinator', 'supervisor') THEN '✅ Can assign tasks'
    ELSE '❌ Cannot assign tasks'
  END as status
FROM public.cmms_users cu
LEFT JOIN public.cmms_companies cc ON cu.cmms_company_id = cc.id
WHERE LOWER(cu.email) = LOWER('icanera@gmail.com')  -- ⚠️ CHANGE THIS
ORDER BY cu.created_at DESC;

-- ============================================================
-- STEP 2: SAFE FIX - Only for specific user in specific company
-- ============================================================

-- ⚠️ IMPORTANT: Fill in these values before running!
-- Get company_id from the query above
DO $$
DECLARE
  v_target_email TEXT := 'icanera@gmail.com';  -- ⚠️ CHANGE THIS
  v_company_id UUID := NULL;  -- ⚠️ CHANGE THIS - Get from query above
  v_new_role TEXT := 'supervisor';  -- Keep as lowercase
  v_rows_affected INT;
BEGIN
  -- Safety check
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'You must set v_company_id before running this fix!';
  END IF;

  -- Update only this specific user in this specific company
  UPDATE public.cmms_users
  SET role = v_new_role,
      updated_at = NOW()
  WHERE LOWER(TRIM(email)) = LOWER(TRIM(v_target_email))
    AND cmms_company_id = v_company_id
    AND is_active = TRUE;
  
  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
  
  IF v_rows_affected > 0 THEN
    RAISE NOTICE '✅ Updated % row(s) for user % in company %', 
      v_rows_affected, v_target_email, v_company_id;
  ELSE
    RAISE NOTICE '⚠️ No rows updated. Check email and company_id.';
  END IF;
END $$;

-- ============================================================
-- STEP 3: VERIFY THE FIX
-- ============================================================

-- Check the user again after fix
SELECT 
  cu.id,
  cu.email,
  cu.name,
  cu.role,
  cc.company_name,
  CASE 
    WHEN LOWER(TRIM(cu.role)) IN ('admin', 'coordinator', 'supervisor') 
    THEN '✅ CAN NOW ASSIGN TASKS'
    ELSE '❌ STILL CANNOT ASSIGN TASKS'
  END as status
FROM public.cmms_users cu
LEFT JOIN public.cmms_companies cc ON cu.cmms_company_id = cc.id
WHERE LOWER(cu.email) = LOWER('icanera@gmail.com')  -- ⚠️ CHANGE THIS
  AND cu.is_active = TRUE;

-- ============================================================
-- ALTERNATIVE: Interactive Fix (Safer)
-- ============================================================
-- Use this if you want to manually specify each value

/*
-- Example: Fix specific user in specific company
UPDATE public.cmms_users
SET role = 'supervisor'
WHERE email = 'user@example.com'  -- ⚠️ Exact email
  AND cmms_company_id = '12345678-1234-1234-1234-123456789abc'  -- ⚠️ Exact company UUID
  AND is_active = TRUE;

-- Verify
SELECT email, role, company_name 
FROM cmms_users cu
JOIN cmms_companies cc ON cu.cmms_company_id = cc.id
WHERE email = 'user@example.com';
*/

-- ============================================================
-- IMPORTANT NOTES
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '⚠️ IMPORTANT SAFETY NOTES';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE '1. This script only updates ONE user at a time';
  RAISE NOTICE '2. You must specify email and company_id';
  RAISE NOTICE '3. Does NOT affect other users or companies';
  RAISE NOTICE '4. Does NOT modify the function or create triggers';
  RAISE NOTICE '5. Safe to run in production';
  RAISE NOTICE '';
  RAISE NOTICE 'To fix another user, change the email and company_id';
  RAISE NOTICE 'and run the UPDATE block again.';
  RAISE NOTICE '';
END $$;
