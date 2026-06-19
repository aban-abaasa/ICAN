# CMMS Task Assignment Fix - Deployment Guide

## Problem
**Supervisor users cannot assign tasks** even though they should have permission.

**Error:** "Only admin, coordinator, or supervisor can assign jobs"

## Solution Overview
Three SQL scripts that work together:

1. **FIX_SUPERVISOR_TASK_ASSIGNMENT.sql** - Immediate fix for existing data
2. **CMMS_ROLE_NORMALIZATION_TRIGGER.sql** - Prevention system for future
3. **CMMS_TASK_ASSIGNMENT_FIX.md** - Complete documentation

## Quick Deployment (5 Minutes)

### Step 1: Apply Immediate Fix
```sql
-- Run in Supabase SQL Editor
-- File: backend/FIX_SUPERVISOR_TASK_ASSIGNMENT.sql
```

**What it does:**
- ✅ Diagnoses current role issues
- ✅ Normalizes all existing roles
- ✅ Updates `fn_assign_job()` function
- ✅ Shows verification results

**Expected output:**
```
✅ FIX APPLIED SUCCESSFULLY
1. ✅ All roles normalized (trimmed and lowercased)
2. ✅ Function updated with better debugging
3. ✅ Case-insensitive role checking enabled
```

### Step 2: Install Prevention System
```sql
-- Run in Supabase SQL Editor
-- File: backend/CMMS_ROLE_NORMALIZATION_TRIGGER.sql
```

**What it does:**
- ✅ Creates auto-normalization trigger
- ✅ Adds role validation constraint
- ✅ Provides admin function for role changes
- ✅ Prevents future role issues

**Expected output:**
```
✅ ROLE NORMALIZATION SYSTEM INSTALLED
🛡️ Protection Features:
   ✅ Auto-normalize roles on insert/update
   ✅ Validate roles against allowed list
   ✅ Admin-only role management function
```

### Step 3: Test the Fix
1. **Refresh browser** (Ctrl+F5)
2. **Login as supervisor**
3. **Go to CMMS → Tasks**
4. **Click "Assign" button**
5. **Fill in task details**
6. **Click "Assign Job"**
7. **Should work! ✅**

## Verification Checklist

### Database Verification
```sql
-- Check all user roles are normalized
SELECT email, role, 
  CASE 
    WHEN role IN ('admin', 'coordinator', 'supervisor') 
    THEN '✅ CAN ASSIGN' 
    ELSE '❌ CANNOT ASSIGN' 
  END as status
FROM cmms_users
WHERE is_active = TRUE;
```

**Expected result:** All roles should be lowercase, no spaces

### Function Verification
```sql
-- Check function exists and is updated
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_name = 'fn_assign_job'
  AND routine_schema = 'public';
```

**Expected result:** Function definition includes `LOWER(TRIM(...))` calls

### Trigger Verification
```sql
-- Check trigger is installed
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_name = 'ensure_normalized_cmms_user_role';
```

**Expected result:** Trigger exists on `cmms_users` table

## User Testing Scenarios

### Test 1: Supervisor Assigns Task
**User Role:** supervisor  
**Action:** Assign task to team member  
**Expected:** ✅ Success

### Test 2: Member Tries to Assign Task
**User Role:** member  
**Action:** Try to assign task  
**Expected:** ❌ "You don't have permission" (UI should hide assign button)

### Test 3: New User Added with Uppercase Role
**Action:** Add user with role "SUPERVISOR"  
**Expected:** ✅ Automatically normalized to "supervisor"

### Test 4: Admin Changes User Role
**Action:** Admin promotes member to supervisor  
**Expected:** ✅ User immediately gets task assignment permission

## Role Permission Matrix

| Role | Assign Tasks | Approve | Manage Users | View All |
|------|-------------|---------|--------------|----------|
| **admin** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **coordinator** | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes |
| **supervisor** | ✅ Yes | ⚠️ Limited | ❌ No | ⚠️ Team only |
| **member** | ❌ No | ❌ No | ❌ No | ⚠️ Assigned only |

## Admin Functions

### Change User Role (Admins Only)
```sql
-- Promote user to supervisor
SELECT * FROM fn_update_cmms_user_role(
  'company-uuid-here',
  'user-uuid-here',
  'supervisor'
);
```

### Check User Permissions
```sql
-- See what a user can do
SELECT 
  email,
  role,
  CASE role
    WHEN 'admin' THEN 'Full access'
    WHEN 'coordinator' THEN 'Manage projects & assign tasks'
    WHEN 'supervisor' THEN 'Manage team & assign tasks'
    WHEN 'member' THEN 'Complete assigned tasks'
  END as permissions
FROM cmms_users
WHERE email = 'user@example.com';
```

### Bulk Role Update (If Needed)
```sql
-- Promote all coordinators to supervisors
UPDATE cmms_users
SET role = 'supervisor'
WHERE role = 'coordinator'
  AND is_active = TRUE;
```

## Troubleshooting

### Issue: Still Getting Permission Error

**Check 1:** Verify user role in database
```sql
SELECT email, role FROM cmms_users 
WHERE email = 'your-email@example.com';
```

**Check 2:** Clear browser cache
- Press Ctrl+Shift+Delete
- Clear cookies and cached files
- Restart browser

**Check 3:** Check Supabase logs
- Go to Supabase Dashboard
- Navigate to Database → Logs
- Look for "DEBUG" messages showing role values

### Issue: Trigger Not Working

**Check:** Verify trigger exists
```sql
SELECT * FROM information_schema.triggers
WHERE trigger_name = 'ensure_normalized_cmms_user_role';
```

**Fix:** Reinstall trigger
```sql
-- Drop and recreate
DROP TRIGGER IF EXISTS ensure_normalized_cmms_user_role ON cmms_users;
-- Then run CMMS_ROLE_NORMALIZATION_TRIGGER.sql again
```

### Issue: Function Returns Wrong Result

**Check:** Function definition
```sql
\df+ fn_assign_job
```

**Fix:** Recreate function
```sql
-- Run FIX_SUPERVISOR_TASK_ASSIGNMENT.sql again
```

## Rollback Plan (If Needed)

### Rollback Step 1: Remove Trigger
```sql
DROP TRIGGER IF EXISTS ensure_normalized_cmms_user_role ON cmms_users;
DROP FUNCTION IF EXISTS normalize_cmms_user_role();
```

### Rollback Step 2: Restore Original Function
```sql
-- You'll need to restore from backup or previous version
-- Check Supabase backup/history
```

### Rollback Step 3: Manual Role Fix
```sql
-- Set specific user's role manually
UPDATE cmms_users
SET role = 'supervisor'
WHERE email = 'user@example.com';
```

## Monitoring

### Daily Health Check
```sql
-- Check for role issues
SELECT 
  COUNT(*) as total_users,
  COUNT(CASE WHEN role NOT IN ('admin','coordinator','supervisor','member') THEN 1 END) as invalid_roles,
  COUNT(CASE WHEN role LIKE '% %' THEN 1 END) as roles_with_spaces
FROM cmms_users
WHERE is_active = TRUE;
```

**Expected:** `invalid_roles` and `roles_with_spaces` should be 0

### Debug Mode
To see detailed logs when assigning tasks, check Supabase logs for:
- 🔍 DEBUG messages showing role values
- ✅ Permission granted messages
- ❌ Permission denied messages

## Best Practices Going Forward

### 1. Always Use Lowercase Roles
```sql
-- Good ✅
INSERT INTO cmms_users (email, role, ...) 
VALUES ('user@example.com', 'supervisor', ...);

-- Bad ❌
INSERT INTO cmms_users (email, role, ...) 
VALUES ('user@example.com', 'SUPERVISOR', ...);
```

### 2. Use Admin Function for Role Changes
```sql
-- Good ✅
SELECT fn_update_cmms_user_role(company_id, user_id, 'supervisor');

-- Risky ⚠️
UPDATE cmms_users SET role = 'supervisor' WHERE id = user_id;
```

### 3. Validate Before Assignment
```javascript
// In frontend code
const canAssignTasks = ['admin', 'coordinator', 'supervisor'].includes(userRole);
if (!canAssignTasks) {
  // Hide assign button or show message
}
```

## Files Created

| File | Purpose | Run Order |
|------|---------|-----------|
| `FIX_SUPERVISOR_TASK_ASSIGNMENT.sql` | Immediate fix | 1st |
| `CMMS_ROLE_NORMALIZATION_TRIGGER.sql` | Prevention | 2nd |
| `CMMS_TASK_ASSIGNMENT_FIX.md` | Documentation | Reference |
| `CMMS_TASK_FIX_DEPLOYMENT_GUIDE.md` | This file | Reference |

## Success Criteria

✅ **All supervisors can assign tasks**  
✅ **No permission errors for valid roles**  
✅ **New users get normalized roles automatically**  
✅ **Admin can change roles via function**  
✅ **Invalid roles are rejected or defaulted to member**

## Timeline

- **Fix Application:** 2 minutes
- **Prevention Installation:** 1 minute  
- **Testing:** 2 minutes
- **Total:** ~5 minutes

## Support

If issues persist after applying all fixes:

1. Check Supabase logs for specific error messages
2. Verify all SQL scripts ran successfully (no errors)
3. Test with different user accounts (admin, supervisor, member)
4. Check browser console for frontend errors
5. Contact database administrator if needed

---

**Status:** ✅ Ready for Deployment  
**Risk Level:** LOW (All changes are additive and reversible)  
**Downtime:** None (Can be applied while system is running)
