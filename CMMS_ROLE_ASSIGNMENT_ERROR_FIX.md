# CMMS Role Assignment Error - Fix Documentation

## Problem Description

**Error Message:** 
```
ican-era.vercel.app says
Error: Only admin, coordinator, or supervisor can assign jobs
```

**Location:** CMMS Tasks section → Assign Job interface

**Root Cause:** 
The user attempting to assign jobs does not have the required role in the `cmms_users` table. The system requires users to have one of these roles to assign jobs:
- `admin`
- `coordinator`
- `supervisor`

## Technical Details

### The Permission Check
The error originates from the `fn_assign_job()` function in `CMMS_REPORT_MESSAGING_SYSTEM.sql`:

```sql
-- Get user's role from cmms_users table
SELECT cu.id, LOWER(COALESCE(cu.role, 'member'))
INTO v_assigner_id, v_assigner_role
FROM public.cmms_users cu
WHERE cu.cmms_company_id = p_company_id
  AND LOWER(cu.email) = LOWER(v_auth_email)
  AND cu.is_active = TRUE
LIMIT 1;

-- Check if user has permission
IF v_assigner_role NOT IN ('admin', 'coordinator', 'supervisor') THEN
  RAISE EXCEPTION 'Only admin, coordinator, or supervisor can assign jobs';
END IF;
```

### Database Schema
The `cmms_users` table structure:
```sql
CREATE TABLE public.cmms_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID REFERENCES public.cmms_companies(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'member',  -- This is the key field
  department_id UUID,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Solution

### Quick Fix (Recommended)

Run the `QUICK_FIX_CMMS_ROLE.sql` script to immediately grant supervisor permissions:

```sql
UPDATE public.cmms_users
SET role = 'supervisor'
WHERE LOWER(email) = LOWER('icanera@gmail.com')
  AND is_active = TRUE;
```

### Steps to Apply the Fix

1. **Open Supabase SQL Editor**
   - Go to your Supabase project dashboard
   - Navigate to SQL Editor

2. **Run the Quick Fix**
   - Copy the contents of `backend/QUICK_FIX_CMMS_ROLE.sql`
   - Paste into SQL Editor
   - Click "Run"

3. **Verify the Fix**
   - Check the query results to confirm the role was updated
   - Refresh your browser
   - Try assigning a job again in the CMMS interface

### Comprehensive Fix

For a more thorough diagnostic and fix with multiple options, use `FIX_CMMS_ROLE_ASSIGNMENT_ERROR.sql`:

**Features:**
- ✅ Diagnostic queries to check all user roles
- ✅ Multiple fix options (single user, all users, company owners, etc.)
- ✅ Improved function with better error messages
- ✅ Verification queries

**Options Available:**
- **Option A:** Grant supervisor role to a specific user by email
- **Option B:** Grant admin role to company creators/owners
- **Option C:** Grant coordinator role to all active users
- **Option D:** Comprehensive role assignment based on profiles

## Role Types Explained

| Role | Permissions | Use Case |
|------|------------|----------|
| **admin** | Full control, can assign jobs | Company administrators |
| **coordinator** | Can assign and manage jobs | Project coordinators |
| **supervisor** | Can assign jobs to team | Department supervisors |
| **member** | Cannot assign jobs | Regular team members |

## Prevention

To prevent this error in the future:

1. **Set Default Role for New Users**
   ```sql
   ALTER TABLE public.cmms_users 
   ALTER COLUMN role SET DEFAULT 'supervisor';
   ```

2. **Automatic Role Assignment**
   Create a trigger to auto-assign roles based on company membership:
   ```sql
   CREATE OR REPLACE FUNCTION assign_default_cmms_role()
   RETURNS TRIGGER AS $$
   BEGIN
     -- First user in company becomes admin
     IF NOT EXISTS (
       SELECT 1 FROM cmms_users 
       WHERE cmms_company_id = NEW.cmms_company_id 
       AND id != NEW.id
     ) THEN
       NEW.role := 'admin';
     ELSE
       NEW.role := 'supervisor';
     END IF;
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql;

   CREATE TRIGGER set_cmms_user_role
   BEFORE INSERT ON cmms_users
   FOR EACH ROW
   EXECUTE FUNCTION assign_default_cmms_role();
   ```

3. **UI-Based Role Management**
   Add an admin interface to manage user roles without SQL:
   - Settings → CMMS Users → Edit Role

## Testing the Fix

After applying the fix, test these scenarios:

1. ✅ **Assign a job to yourself**
2. ✅ **Assign a job to another user**
3. ✅ **Set job priority and due date**
4. ✅ **Verify notification is sent**

## Troubleshooting

### Still Getting the Error?

1. **Check your email address**
   ```sql
   SELECT email, role FROM cmms_users 
   WHERE LOWER(email) = LOWER('your-email@example.com');
   ```

2. **Verify you're logged in**
   - Check authentication status
   - Clear browser cache and cookies
   - Log out and log back in

3. **Check company membership**
   ```sql
   SELECT cu.*, cc.company_name 
   FROM cmms_users cu
   JOIN cmms_companies cc ON cu.cmms_company_id = cc.id
   WHERE LOWER(cu.email) = LOWER('your-email@example.com');
   ```

4. **Enable debug logging**
   The improved function includes RAISE NOTICE statements for debugging

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "Not a member of this CMMS company" | User not in cmms_users table | Add user to company |
| "Not authenticated" | No auth session | Log in again |
| Role is NULL | Database default not set | Run QUICK_FIX script |
| Case sensitivity | Role stored as "SUPERVISOR" | Function handles this with LOWER() |

## Files Created

1. **QUICK_FIX_CMMS_ROLE.sql** - Immediate fix for single user
2. **FIX_CMMS_ROLE_ASSIGNMENT_ERROR.sql** - Comprehensive diagnostic and fix
3. **CMMS_ROLE_ASSIGNMENT_ERROR_FIX.md** - This documentation

## Summary

The error occurs because the system checks user roles before allowing job assignments. The quick fix updates the user's role in the `cmms_users` table to `supervisor`, granting the necessary permissions. Apply the fix using Supabase SQL Editor and refresh your browser to resolve the issue.

## Next Steps

After fixing the role issue:
1. ✅ Test job assignment functionality
2. ✅ Review and assign appropriate roles to other team members
3. ✅ Consider implementing automatic role assignment
4. ✅ Document your organization's role hierarchy
5. ✅ Set up role management in the admin interface

---

**Date:** June 18, 2026  
**Status:** ✅ Fix Ready to Deploy  
**Priority:** HIGH - Blocks job assignment functionality
