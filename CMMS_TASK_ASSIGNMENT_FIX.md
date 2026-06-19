# CMMS Task Assignment Fix - Supervisor Cannot Assign Tasks

## Problem Summary

**Issue:** A user with SUPERVISOR role cannot assign tasks in CMMS, even though supervisors should have permission to assign tasks.

**Error Message:** "Only admin, coordinator, or supervisor can assign jobs"

**Affected User:** User shows as "SUPERVISOR" in the UI but gets permission denied when trying to assign tasks.

## Root Cause Analysis

### The Issue
The `fn_assign_job()` function checks if the user's role is in the list: `('admin', 'coordinator', 'supervisor')`. However, the role stored in the database might have:

1. **Different capitalization** (e.g., "SUPERVISOR", "Supervisor", "supervisor")
2. **Extra whitespace** (e.g., " supervisor ", "supervisor ")
3. **Inconsistent formatting** from different data entry points

### Why It Happens
```sql
-- Current function does this:
SELECT cu.id, LOWER(COALESCE(cu.role, 'member'))
INTO v_assigner_id, v_assigner_role
FROM public.cmms_users cu
WHERE ...

-- But if the database has "SUPERVISOR" (uppercase)
-- It gets normalized to "supervisor" (lowercase) - CORRECT ✅

-- If the database has " SUPERVISOR " (with spaces)
-- It gets normalized to " supervisor " (lowercase with spaces) - WRONG ❌
-- The check fails because " supervisor " != "supervisor"
```

## The Solution

### Step 1: Normalize Existing Data
Clean up all existing roles in the database:

```sql
-- Trim whitespace and normalize case
UPDATE public.cmms_users
SET role = LOWER(TRIM(role))
WHERE role IS NOT NULL
  AND is_active = TRUE;
```

### Step 2: Enhanced Function
Update `fn_assign_job()` to be more robust:

```sql
-- Better role extraction with TRIM
SELECT 
  cu.id, 
  cu.role,
  LOWER(TRIM(COALESCE(cu.role, 'member')))
INTO 
  v_assigner_id, 
  v_assigner_raw_role,
  v_assigner_role
FROM public.cmms_users cu
WHERE cu.cmms_company_id = p_company_id
  AND LOWER(TRIM(cu.email)) = LOWER(TRIM(v_auth_email))  -- Also trim email!
  AND cu.is_active = TRUE;
```

### Step 3: Better Debugging
Added debug logging to see exactly what's happening:

```sql
RAISE NOTICE '🔍 DEBUG: User % has raw role: "%" (normalized: "%")', 
  v_auth_email, v_assigner_raw_role, v_assigner_role;
```

## How to Apply the Fix

### Quick Fix (Recommended)
Run this single SQL script:
```bash
backend/FIX_SUPERVISOR_TASK_ASSIGNMENT.sql
```

This script will:
1. ✅ Show current role values
2. ✅ Normalize all roles (trim + lowercase)
3. ✅ Update the `fn_assign_job()` function
4. ✅ Show verification results

### Manual Steps (If Needed)

#### 1. Check Current Roles
```sql
SELECT email, role, LOWER(TRIM(role)) as normalized
FROM public.cmms_users
WHERE is_active = TRUE;
```

#### 2. Fix Specific User
```sql
UPDATE public.cmms_users
SET role = 'supervisor'
WHERE LOWER(TRIM(email)) = LOWER('user@example.com')
  AND is_active = TRUE;
```

#### 3. Verify Fix
```sql
SELECT 
  email,
  role,
  CASE 
    WHEN LOWER(TRIM(role)) IN ('admin', 'coordinator', 'supervisor') 
    THEN '✅ CAN ASSIGN' 
    ELSE '❌ CANNOT ASSIGN' 
  END as status
FROM public.cmms_users
WHERE is_active = TRUE;
```

## Role Hierarchy

| Role | Can Assign Tasks | Can Approve | Other Permissions |
|------|------------------|-------------|-------------------|
| **admin** | ✅ Yes | ✅ Yes | Full company access |
| **coordinator** | ✅ Yes | ✅ Yes | Manage departments |
| **supervisor** | ✅ Yes | ⚠️ Limited | Team management |
| **member** | ❌ No | ❌ No | View and complete tasks |

## Testing the Fix

After applying the fix:

### 1. Verify Database
```sql
SELECT email, role 
FROM cmms_users 
WHERE email = 'your-email@example.com';
```
Should show: `supervisor` (lowercase, no spaces)

### 2. Test Task Assignment
1. Login to CMMS as supervisor
2. Go to Tasks tab
3. Click "Assign" button
4. Fill in task details
5. Click "Assign Job"
6. Should succeed ✅

### 3. Check Debug Logs
In Supabase Dashboard → Database → Logs, look for:
```
🔍 DEBUG: User email@example.com has raw role: "supervisor" (normalized: "supervisor")
✅ Permission granted: supervisor can assign jobs
✅ Job assigned successfully: Task Title
```

## Common Issues & Solutions

### Issue 1: Still Getting Error After Fix
**Cause:** Browser cache or stale session

**Solution:**
1. Clear browser cache
2. Log out and log back in
3. Hard refresh (Ctrl+Shift+R)

### Issue 2: Role Shows Correctly But Still Fails
**Cause:** Multiple cmms_users records for same email

**Solution:**
```sql
-- Check for duplicates
SELECT email, COUNT(*), array_agg(id) as user_ids
FROM cmms_users
WHERE email = 'user@example.com'
GROUP BY email
HAVING COUNT(*) > 1;

-- Keep only the active one with correct role
```

### Issue 3: Function Not Updated
**Cause:** Function wasn't recreated properly

**Solution:**
```sql
-- Drop and recreate
DROP FUNCTION IF EXISTS public.fn_assign_job CASCADE;
-- Then run the CREATE FUNCTION from the fix script
```

## Prevention

### For Future Users
When adding new users to CMMS, ensure roles are set correctly:

```sql
-- Good: Normalized role
INSERT INTO cmms_users (email, role, ...)
VALUES ('user@example.com', 'supervisor', ...);

-- Bad: Inconsistent format
INSERT INTO cmms_users (email, role, ...)
VALUES ('user@example.com', 'SUPERVISOR  ', ...);  -- ❌ uppercase + spaces
```

### Add Validation Trigger
```sql
CREATE OR REPLACE FUNCTION normalize_cmms_user_role()
RETURNS TRIGGER AS $$
BEGIN
  -- Auto-normalize role on insert/update
  NEW.role := LOWER(TRIM(COALESCE(NEW.role, 'member')));
  
  -- Validate role is in allowed list
  IF NEW.role NOT IN ('admin', 'coordinator', 'supervisor', 'member') THEN
    NEW.role := 'member';  -- Default to member for invalid roles
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ensure_normalized_role
BEFORE INSERT OR UPDATE ON cmms_users
FOR EACH ROW
EXECUTE FUNCTION normalize_cmms_user_role();
```

## Summary

✅ **Problem:** Supervisor role couldn't assign tasks due to whitespace/case issues  
✅ **Fix:** Normalize all roles + improve function robustness  
✅ **Prevention:** Add trigger to auto-normalize roles  
✅ **Testing:** Verify with debug logs and actual task assignment  

## Next Steps

1. ✅ Run `FIX_SUPERVISOR_TASK_ASSIGNMENT.sql` in Supabase
2. ✅ Verify all users have normalized roles
3. ✅ Test task assignment as supervisor
4. ✅ (Optional) Add normalization trigger for future-proofing

---

**Status:** ✅ Fix Ready  
**Priority:** HIGH - Blocks core CMMS functionality  
**Impact:** All supervisor users can now assign tasks
