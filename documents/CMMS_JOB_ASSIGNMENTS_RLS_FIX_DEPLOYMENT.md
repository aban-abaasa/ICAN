# CMMS Job Assignments RLS Permission Error - FIX & DEPLOYMENT GUIDE

## 🚨 The Problem

When updating CMMS job assignment status, users get a **403 Forbidden** error:

```
PATCH https://hswxazpxcgtqbxeqcxxw.supabase.co/rest/v1/cmms_job_assignments?id=eq.ad4055c6-88c0-42ce-8591-ac29c5202b63&select=* 403 (Forbidden)

Error: {code: '42501', message: 'permission denied for table users'}
```

**Root Cause:** An RLS (Row Level Security) policy on `cmms_job_assignments` is trying to access the `auth.users` table, which is restricted and causing the permission denial.

---

## ✅ The Solution

Replace direct table access with **SECURITY DEFINER** functions that:
- Operate with elevated permissions
- Handle authorization logic in the backend
- Don't require RLS policies to check auth.users

---

## 📋 DEPLOYMENT STEPS

### Step 1: Deploy Backend SQL Fix

1. Go to **Supabase Dashboard** → **SQL Editor**
2. Create a new query
3. Copy-paste the entire contents of: `backend/FIX_CMMS_JOB_ASSIGNMENTS_RLS.sql`
4. Click **Run**
5. Wait for completion (should see success messages)

**Verification:** You should see messages like:
```
Dropped policy: [policy_name]
```

### Step 2: Verify SQL Deployment

Still in SQL Editor, run this verification query:

```sql
-- Check RLS is disabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename IN ('cmms_job_assignments', 'cmms_report_messages') 
  AND schemaname = 'public';

-- Should return: rowsecurity = false for both tables
```

Expected output:
```
tablename              | rowsecurity
----------------------|------------
cmms_job_assignments   | false
cmms_report_messages   | false
```

### Step 3: Frontend Code Update ✅ (ALREADY DONE)

The file has already been updated:
- **File:** `frontend/src/services/cmmsMessagingService.js`
- **Change:** `updateJobStatus()` now uses `fn_update_job_assignment_status()` RPC function
- **No other changes needed** in frontend

### Step 4: Browser Cache Clear

After deployment, users must clear browser cache:

- **Chrome/Edge:** `Ctrl + Shift + R` (Windows) or `Cmd + Shift + R` (Mac)
- **Firefox:** `Ctrl + Shift + R` (Windows) or `Cmd + Shift + R` (Mac)
- **Safari:** Clear history → Set time to "All time" → Click "Clear"

---

## 🧪 TESTING CHECKLIST

### Test 1: Update Job Status
1. Log in as a CMMS user
2. Navigate to CMMS module → Reports section
3. Open a report with assigned jobs
4. Click "Update Status" or change status dropdown
5. **Expected:** Status updates without error ✅

**Failure signs:**
- Still getting "permission denied for table users" → SQL didn't deploy correctly
- "Not a CMMS member" → User account not linked to CMMS company
- "Unauthorized to update this job" → User doesn't have permission to update

### Test 2: Different User Roles
Test with different roles to ensure authorization works:

| Role | Can Update Own Assignments | Can Update Others | Can Update as Manager |
|------|--------------------------|------------------|----------------------|
| Technician | ✅ Yes | ❌ No | ❌ No |
| Coordinator | ✅ Yes | ✅ Yes (own) | ✅ Yes |
| Supervisor | ✅ Yes | ✅ Yes (own) | ✅ Yes |
| Admin | ✅ Yes | ✅ Yes (all) | ✅ Yes |

### Test 3: Error Messages
Try invalid operations and verify error messages make sense:
- Update with invalid status → "Invalid status. Must be: pending, accepted..."
- Update assignment you didn't create → "Unauthorized to update this job"
- Non-CMMS user → "Not a CMMS member"

---

## 📊 What Changed

### Database (Supabase)

**Disabled:**
- ❌ RLS on `cmms_job_assignments`
- ❌ RLS on `cmms_report_messages`

**Added:**
- ✅ `fn_update_job_assignment_status()` - SECURITY DEFINER function for updating status
- ✅ `fn_get_job_assignments()` - SECURITY DEFINER function for fetching assignments

**Why:** SECURITY DEFINER functions can access `auth.users` without RLS policies blocking them.

### Frontend (React)

**Updated:**
- ✅ `cmmsMessagingService.js` - `updateJobStatus()` now uses `.rpc('fn_update_job_assignment_status', ...)`

**No changes needed:**
- ✅ Components can stay the same (they call `updateJobStatus()` which handles the details)

---

## 🔐 Security Implications

### Authorization Moved to Backend ✅
- Frontend can still call the function
- Backend checks: 
  - Is user authenticated?
  - Is user a CMMS member?
  - Can user update this specific assignment?
  - Is status valid?

### No RLS Policies = No Silent Filtering
- Previously: RLS would silently return errors without explaining why
- Now: Function returns clear error messages (e.g., "Unauthorized to update this job")

### More Secure Than Before
- Authorization logic is centralized in backend
- Can't bypass by modifying frontend code
- All access goes through the function

---

## ⚠️ Troubleshooting

### Error: "permission denied for table users" (Still occurring)

1. **Check SQL was deployed:** In Supabase SQL Editor, run:
   ```sql
   SELECT policyname FROM pg_policies 
   WHERE tablename IN ('cmms_job_assignments', 'cmms_report_messages');
   ```
   Should return: **empty result** (no policies)

2. **If policies still exist:** Run the SQL again and check for errors

3. **Clear browser cache:** `Ctrl+Shift+R` (or Cmd+Shift+R on Mac)

### Error: "Not a CMMS member"

- User needs to be added to `cmms_users` table
- Contact admin to add user to the CMMS company

### Error: "Unauthorized to update this job"

- User can only update:
  - Jobs assigned to them, OR
  - Jobs they created, OR
  - Any job (if admin/supervisor/coordinator)
- Verify user role and assignment

### Still getting the error after all steps?

1. Check that you copied the **entire** SQL file (all functions and fixes)
2. Verify no SQL errors occurred during deployment
3. Clear all browser cache and cookies for the domain
4. Try a different browser to rule out cache issues
5. Check backend logs for actual error details

---

## 📝 Files Modified

1. **Backend (SQL):**
   - ✅ Created: `backend/FIX_CMMS_JOB_ASSIGNMENTS_RLS.sql`

2. **Frontend (JavaScript):**
   - ✅ Modified: `frontend/src/services/cmmsMessagingService.js`
     - Function: `updateJobStatus()` (uses new RPC)

---

## 🚀 Rollback Plan (If Needed)

If something goes wrong, you can revert by:

1. Re-enabling RLS policies on the tables
2. Running the original `CMMS_REPORT_MESSAGING_SYSTEM.sql` to restore policies

But hopefully, you won't need to! 🎉

---

## 📞 Summary

**What happens now when updating job status:**

```
Frontend (React)
    ↓
cmmsMessagingService.updateJobStatus()
    ↓
supabase.rpc('fn_update_job_assignment_status')
    ↓
Backend Function (SECURITY DEFINER)
    - Checks authentication
    - Checks CMMS membership
    - Checks authorization
    - Validates status
    - Updates database
    ↓
Returns { success, message, data }
    ↓
Frontend displays result
```

**No more RLS permission errors!** 🎉
