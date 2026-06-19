# SAFE CMMS Task Assignment Fix - Production Deployment

## ⚠️ SAFETY FIRST - Multi-Company Environment

This system has **multiple companies**, each with their own admins and users.  
All fixes are designed to be **safe, targeted, and reversible**.

## Problem

**Specific supervisor users** cannot assign tasks due to role formatting issues (whitespace, capitalization).

## Safe Solution Strategy

### ✅ What We Will Do
1. Update the assignment function to handle role variations
2. Fix only specific users who report the issue
3. Optionally add prevention for future users

### ❌ What We Will NOT Do
- Bulk update all users across all companies
- Change existing company structures
- Affect users who are not having issues
- Modify admin roles in any company

## Safe Deployment Plan

### Phase 1: Function Update (SAFE - No data changes)

**File:** `SAFE_UPDATE_ASSIGN_FUNCTION.sql`

**What it does:**
- Updates the `fn_assign_job()` function to handle role variations better
- Adds TRIM() and LOWER() when checking roles
- Better error messages for debugging

**Safety:**
- ✅ Does NOT modify any user data
- ✅ Does NOT change company data
- ✅ Only improves the function logic
- ✅ Safe to run immediately

**How to run:**
```sql
-- In Supabase SQL Editor
-- Copy and paste SAFE_UPDATE_ASSIGN_FUNCTION.sql
-- Run it once
```

**Expected result:**
```
✅ FUNCTION UPDATED SUCCESSFULLY
Changes made:
  ✅ Added TRIM() to email comparison
  ✅ Added TRIM() to role normalization
  ✅ Better error messages
```

---

### Phase 2: Fix Specific Users (SAFE - Targeted only)

**File:** `SAFE_FIX_SPECIFIC_USER_ROLE.sql`

**What it does:**
- Checks ONE specific user's role
- Updates ONLY that user in their specific company
- Requires you to fill in email and company_id

**Safety:**
- ✅ Must specify exact email and company_id
- ✅ Only affects ONE user at a time
- ✅ Will not run without manual configuration
- ✅ Shows before/after comparison

**How to run:**
```sql
-- Step 1: Open SAFE_FIX_SPECIFIC_USER_ROLE.sql

-- Step 2: Run the diagnostic section to see the user's current state
SELECT 
  cu.email,
  cu.role,
  cc.company_name,
  cu.cmms_company_id
FROM public.cmms_users cu
LEFT JOIN public.cmms_companies cc ON cu.cmms_company_id = cc.id
WHERE LOWER(cu.email) = LOWER('user@example.com');  -- Change to actual email

-- Step 3: Copy the company_id from results

-- Step 4: Edit and run the UPDATE section with correct values:
DO $$
DECLARE
  v_target_email TEXT := 'user@example.com';  -- ⚠️ CHANGE THIS
  v_company_id UUID := 'uuid-from-step-3';    -- ⚠️ CHANGE THIS
  v_new_role TEXT := 'supervisor';
BEGIN
  UPDATE public.cmms_users
  SET role = v_new_role
  WHERE LOWER(TRIM(email)) = LOWER(TRIM(v_target_email))
    AND cmms_company_id = v_company_id;
END $$;

-- Step 5: Verify the fix
SELECT email, role FROM cmms_users 
WHERE email = 'user@example.com';
```

**When to use:**
- Only when a specific user reports they cannot assign tasks
- After confirming their role should allow task assignment
- When you have their exact email and company

---

### Phase 3: Prevention (OPTIONAL - Future users only)

**File:** `OPTIONAL_ROLE_NORMALIZATION_TRIGGER.sql`

**What it does:**
- Auto-normalizes roles for NEW users
- Trims whitespace and lowercases roles
- Only affects future INSERT/UPDATE operations

**Safety:**
- ✅ Does NOT touch existing users
- ✅ Only affects new users going forward
- ✅ Can be removed anytime
- ✅ Each company operates independently

**When to install:**
- If you want to prevent future role issues
- When you're confident the function update works
- Optional - system works fine without this

**How to run:**
```sql
-- In Supabase SQL Editor
-- Copy and paste OPTIONAL_ROLE_NORMALIZATION_TRIGGER.sql
-- Run it once
```

**How to remove (if needed):**
```sql
DROP TRIGGER IF EXISTS ensure_normalized_cmms_user_role ON public.cmms_users;
DROP FUNCTION IF EXISTS public.normalize_cmms_user_role();
```

---

## Testing Procedure

### Test 1: Verify Function Update
```sql
-- Check function exists
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_name = 'fn_assign_job';
-- Should return 1 row
```

### Test 2: Test with Problematic User
1. Login as the user who reported the issue
2. Go to CMMS → Tasks
3. Try to assign a task
4. Should work ✅

### Test 3: Verify Other Users Not Affected
1. Login as different users in different companies
2. Verify their existing permissions still work
3. Admins can still assign tasks
4. Members still cannot assign tasks

---

## Rollback Plan

### If Function Update Causes Issues
```sql
-- Restore original function from backup
-- Contact database admin for previous version
```

### If User Role Fix Causes Issues
```sql
-- Revert specific user's role
UPDATE cmms_users
SET role = 'previous_role'  -- Use original value
WHERE email = 'user@example.com'
  AND cmms_company_id = 'company-uuid';
```

### If Trigger Causes Issues
```sql
-- Simply remove the trigger
DROP TRIGGER IF EXISTS ensure_normalized_cmms_user_role ON cmms_users;
DROP FUNCTION IF EXISTS normalize_cmms_user_role();
-- Existing data remains unchanged
```

---

## Common Scenarios

### Scenario 1: One User Can't Assign Tasks

**Symptoms:** User shows as "SUPERVISOR" but gets permission error

**Solution:**
1. Run Phase 1 (function update) - affects everyone, safe
2. Run Phase 2 (fix specific user) - only that user
3. Test

**Time:** 5 minutes

---

### Scenario 2: Multiple Users in Same Company

**Symptoms:** Several users in one company have issue

**Solution:**
1. Run Phase 1 (function update) once
2. Run Phase 2 for each affected user (one at a time)
3. After fixing all, optionally run Phase 3 (prevention)

**Time:** 2 minutes per user

---

### Scenario 3: Preventing Future Issues

**Symptoms:** Want to avoid this happening again

**Solution:**
1. Run Phase 1 (function update)
2. Run Phase 3 (optional trigger)
3. Document role assignment process

**Time:** 5 minutes

---

## What Each File Does

| File | Safe? | Changes Data? | Required? |
|------|-------|---------------|-----------|
| `SAFE_UPDATE_ASSIGN_FUNCTION.sql` | ✅ Yes | ❌ No | ✅ Yes |
| `SAFE_FIX_SPECIFIC_USER_ROLE.sql` | ✅ Yes | ⚠️ One user only | ⚠️ As needed |
| `OPTIONAL_ROLE_NORMALIZATION_TRIGGER.sql` | ✅ Yes | ❌ No (future only) | ❌ Optional |

---

## Safety Checklist

Before running any script:

- [ ] Read the entire script first
- [ ] Understand what it will change
- [ ] Have a backup or know how to rollback
- [ ] Test in development first (if possible)
- [ ] Run during low-traffic time
- [ ] Have database admin contact available

During deployment:

- [ ] Run Phase 1 first (function update)
- [ ] Test with one problematic user
- [ ] If successful, fix other users as needed
- [ ] Monitor for any errors
- [ ] Verify other companies not affected

After deployment:

- [ ] Test task assignment works for fixed users
- [ ] Verify other users still have correct permissions
- [ ] Check all companies still function normally
- [ ] Document who was fixed and when

---

## Comparison with Old Scripts (DO NOT USE)

| Old Files (UNSAFE) | Why Unsafe | New Files (SAFE) |
|-------------------|------------|------------------|
| `FIX_CMMS_ROLE_ASSIGNMENT_ERROR.sql` | Bulk updates ALL users | `SAFE_FIX_SPECIFIC_USER_ROLE.sql` |
| `QUICK_FIX_CMMS_ROLE.sql` | Updates hardcoded user | `SAFE_FIX_SPECIFIC_USER_ROLE.sql` |
| `FIX_SUPERVISOR_TASK_ASSIGNMENT.sql` | Normalizes all roles | `SAFE_UPDATE_ASSIGN_FUNCTION.sql` |
| `CMMS_ROLE_NORMALIZATION_TRIGGER.sql` | Changes existing data | `OPTIONAL_ROLE_NORMALIZATION_TRIGGER.sql` |

**⚠️ DELETE THE OLD UNSAFE FILES** - Use only the new SAFE versions

---

## Support & Troubleshooting

### Issue: User still can't assign tasks after function update

**Check 1:** Verify user's actual role in database
```sql
SELECT email, role, company_name
FROM cmms_users cu
JOIN cmms_companies cc ON cu.cmms_company_id = cc.id
WHERE email = 'user@example.com';
```

**Check 2:** Check for whitespace or case issues
```sql
SELECT 
  email,
  role,
  LENGTH(role) as length,
  LENGTH(TRIM(role)) as trimmed_length
FROM cmms_users
WHERE email = 'user@example.com';
```

**Solution:** Run Phase 2 (specific user fix)

---

### Issue: Wrong user's role was changed

**Cause:** Incorrect email or company_id in Phase 2

**Solution:**
```sql
-- Revert the change
UPDATE cmms_users
SET role = 'original_role'
WHERE email = 'user@example.com'
  AND cmms_company_id = 'company-uuid';
```

---

### Issue: Function not working after update

**Check:** Verify function exists
```sql
\df+ fn_assign_job
```

**Solution:** Re-run Phase 1 script

---

## Timeline

- **Phase 1 (Function Update):** 2 minutes
- **Phase 2 (Per User Fix):** 2 minutes each
- **Phase 3 (Optional Trigger):** 1 minute
- **Total for typical case:** 5-10 minutes

---

## Success Criteria

✅ Supervisor users can assign tasks  
✅ Other companies unaffected  
✅ Admin permissions unchanged  
✅ No bulk data modifications  
✅ Reversible changes  

---

**Remember:** These fixes are **safe**, **targeted**, and **reversible**. Each company remains independent. Only affected users are changed.
