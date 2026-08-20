# URGENT: Fix Staff Attendance Panel

## Current Issue
Staff Attendance panel stuck on "Loading attendance data..." 

## Quick Fix (2 steps)

### STEP 1: Run SQL in Supabase (REQUIRED)
1. Open Supabase SQL Editor
2. Copy and paste ALL of `backend/FIX_CMMS_ATTENDANCE_COMPLETE.sql`
3. Click **RUN**
4. Wait for "Success" message

### STEP 2: Refresh Browser
1. Clear browser cache (Ctrl+Shift+R or Cmd+Shift+R)
2. Reload the ICAN app
3. Go to CMMS → Staff Attendance

## What This Fixes
- ✅ 500 Internal Server Error on QR locations
- ✅ 400 Bad Request on attendance records
- ✅ RLS policies blocking data access
- ✅ Missing/incorrect column names

## If Still Not Working

### Check Browser Console
1. Open DevTools (F12)
2. Go to Console tab
3. Look for errors starting with:
   - "Attendance records error:"
   - "QR codes error:"
   - "Users fetch error:"

### Common Errors & Solutions

**Error: "relation does not exist"**
- Tables not created yet
- Run `CMMS_STAFF_ATTENDANCE_VISITOR_MANAGEMENT.sql` first

**Error: "permission denied for table"**
- RLS policies too restrictive
- The FIX_CMMS_ATTENDANCE_COMPLETE.sql should fix this

**Error: "JWT expired" or "not authenticated"**
- User session expired
- Log out and log back in

**Error: "column does not exist"**
- Mismatch between code and database
- Make sure you ran the COMPLETE fix SQL

## Verification Steps

After running the SQL:

1. **Check Tables Exist:**
   ```sql
   SELECT * FROM public.cmms_staff_attendance LIMIT 1;
   SELECT * FROM public.cmms_attendance_qr_locations LIMIT 1;
   SELECT * FROM public.cmms_users LIMIT 1;
   ```

2. **Check RLS Policies:**
   ```sql
   SELECT tablename, policyname FROM pg_policies 
   WHERE tablename IN ('cmms_staff_attendance', 'cmms_attendance_qr_locations', 'cmms_users');
   ```

3. **Check Permissions:**
   ```sql
   SELECT grantee, privilege_type FROM information_schema.role_table_grants 
   WHERE table_name IN ('cmms_staff_attendance', 'cmms_attendance_qr_locations', 'cmms_users')
   AND grantee = 'authenticated';
   ```

## Emergency Workaround

If SQL fix doesn't work, temporarily disable RLS:

```sql
-- ⚠️ TEMPORARY ONLY - DO NOT USE IN PRODUCTION
ALTER TABLE public.cmms_staff_attendance DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_attendance_qr_locations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_users DISABLE ROW LEVEL SECURITY;
```

This will let you see if data exists, but removes security!

## Need More Help?

Send screenshot of:
1. Browser console errors
2. Supabase SQL Editor after running the fix
3. The exact error message

---

**TL;DR:** Run `FIX_CMMS_ATTENDANCE_COMPLETE.sql` in Supabase, then refresh browser.
