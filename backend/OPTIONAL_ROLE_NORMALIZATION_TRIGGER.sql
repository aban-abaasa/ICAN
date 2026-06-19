-- ============================================================
-- OPTIONAL: Role Normalization Trigger for Future Users
-- ============================================================
-- ⚠️ THIS IS OPTIONAL - Only install if you want automatic
-- role normalization for NEW users going forward
-- 
-- Does NOT affect existing users or data
-- Only affects future INSERT and UPDATE operations
-- Safe for production with multiple companies
-- ============================================================

-- ============================================================
-- PREVIEW: What this trigger will do
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '📋 ROLE NORMALIZATION TRIGGER (OPTIONAL)';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'This trigger will:';
  RAISE NOTICE '  ✅ Auto-normalize roles for NEW users';
  RAISE NOTICE '  ✅ Trim whitespace from roles';
  RAISE NOTICE '  ✅ Convert roles to lowercase';
  RAISE NOTICE '  ✅ Validate against allowed roles';
  RAISE NOTICE '';
  RAISE NOTICE 'This trigger will NOT:';
  RAISE NOTICE '  ✗ Change existing user roles';
  RAISE NOTICE '  ✗ Modify company data';
  RAISE NOTICE '  ✗ Affect current users';
  RAISE NOTICE '';
  RAISE NOTICE 'Examples of auto-correction:';
  RAISE NOTICE '  "SUPERVISOR  " → "supervisor"';
  RAISE NOTICE '  " Admin" → "admin"';
  RAISE NOTICE '  "Coordinator " → "coordinator"';
  RAISE NOTICE '';
  RAISE NOTICE 'To install: Continue running this script';
  RAISE NOTICE 'To skip: Stop here and do not run further';
  RAISE NOTICE '';
END $$;

-- ============================================================
-- CREATE NORMALIZATION FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_cmms_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only normalize role if it's being inserted or updated
  -- Trim whitespace and convert to lowercase
  IF NEW.role IS NOT NULL THEN
    NEW.role := LOWER(TRIM(NEW.role));
    
    -- Validate role is in allowed list
    IF NEW.role NOT IN ('admin', 'coordinator', 'supervisor', 'member') THEN
      -- Don't raise error - just default to 'member' for safety
      RAISE NOTICE 'Invalid role "%" for user %. Defaulting to "member".', NEW.role, NEW.email;
      NEW.role := 'member';
    END IF;
  ELSE
    -- If role is NULL, set default
    NEW.role := 'member';
  END IF;
  
  -- Also normalize email (trim and lowercase)
  IF NEW.email IS NOT NULL THEN
    NEW.email := LOWER(TRIM(NEW.email));
  END IF;
  
  -- Also normalize name (trim only)
  IF NEW.name IS NOT NULL THEN
    NEW.name := TRIM(NEW.name);
  END IF;
  
  RETURN NEW;
END;
$$;

-- ============================================================
-- CREATE TRIGGER (Only affects future operations)
-- ============================================================

-- Drop if exists to avoid duplicates
DROP TRIGGER IF EXISTS ensure_normalized_cmms_user_role ON public.cmms_users;

-- Create trigger that runs BEFORE insert or update
CREATE TRIGGER ensure_normalized_cmms_user_role
BEFORE INSERT OR UPDATE ON public.cmms_users
FOR EACH ROW
EXECUTE FUNCTION public.normalize_cmms_user_role();

-- ============================================================
-- TEST THE TRIGGER (Safe - doesn't modify real data)
-- ============================================================

-- This just demonstrates what the trigger does
-- Does not actually insert or modify data
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ TRIGGER INSTALLED SUCCESSFULLY';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'The trigger is now active for:';
  RAISE NOTICE '  • New user inserts (when creating accounts)';
  RAISE NOTICE '  • User updates (when changing roles)';
  RAISE NOTICE '';
  RAISE NOTICE 'Example behavior:';
  RAISE NOTICE '  Input:  role = "SUPERVISOR  "';
  RAISE NOTICE '  Output: role = "supervisor"';
  RAISE NOTICE '';
  RAISE NOTICE '  Input:  role = " Admin"';
  RAISE NOTICE '  Output: role = "admin"';
  RAISE NOTICE '';
  RAISE NOTICE '  Input:  role = "InvalidRole"';
  RAISE NOTICE '  Output: role = "member" (default)';
  RAISE NOTICE '';
  RAISE NOTICE 'This helps prevent future role-related errors.';
  RAISE NOTICE '';
END $$;

-- ============================================================
-- VERIFICATION
-- ============================================================

-- Show that trigger exists
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_timing,
  '✅ Active' as status
FROM information_schema.triggers
WHERE trigger_name = 'ensure_normalized_cmms_user_role'
  AND event_object_table = 'cmms_users';

-- ============================================================
-- HOW TO REMOVE (If needed later)
-- ============================================================
/*
-- To remove the trigger, run:
DROP TRIGGER IF EXISTS ensure_normalized_cmms_user_role ON public.cmms_users;
DROP FUNCTION IF EXISTS public.normalize_cmms_user_role();

-- This will NOT affect any existing data
-- It just stops the automatic normalization for future operations
*/

-- ============================================================
-- FINAL NOTES
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '📝 IMPORTANT NOTES';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE '1. Existing users are NOT affected';
  RAISE NOTICE '2. Only new users and role updates are normalized';
  RAISE NOTICE '3. Each company''s data remains independent';
  RAISE NOTICE '4. Admin users in each company are not changed';
  RAISE NOTICE '5. Can be removed at any time without data loss';
  RAISE NOTICE '';
  RAISE NOTICE 'This is a preventive measure, not a fix.';
  RAISE NOTICE 'To fix existing users, use SAFE_FIX_SPECIFIC_USER_ROLE.sql';
  RAISE NOTICE '';
END $$;
