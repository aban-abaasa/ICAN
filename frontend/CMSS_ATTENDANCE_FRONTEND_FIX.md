# CMSS Attendance Frontend Fix

## Issue
Two errors occurring:
1. **500 Internal Server Error** on `cmms_attendance_qr_locations`
2. **400 Bad Request** on `cmms_staff_attendance` with embedded resource

## Solution

### Step 1: Run the SQL fix
Run `backend/FIX_CMMS_ATTENDANCE_COMPLETE.sql` in Supabase SQL Editor

### Step 2: Update frontend query (if embedded query still fails)

Replace the query in `CMSSAttendancePanel.jsx` (around line 26-35):

**Current (problematic):**
```javascript
const [recordsRes, qrRes] = await Promise.all([
  supabase
    .from('cmms_staff_attendance')
    .select(`
      *,
      staff:cmms_user_id (id, full_name, email, avatar_url)
    `)
    .eq('cmms_company_id', companyProfile.id)
    .gte('check_in_time', `${selectedDate}T00:00:00`)
    .lte('check_in_time', `${selectedDate}T23:59:59`)
    .order('check_in_time', { ascending: false }),
  
  canManage ? supabase
    .from('cmms_attendance_qr_locations')
    .select('*')
    .eq('cmms_company_id', companyProfile.id)
    .order('created_at', { ascending: false }) : { data: [], error: null }
]);
```

**Option A: Use the view (recommended):**
```javascript
const [recordsRes, qrRes] = await Promise.all([
  supabase
    .from('cmms_staff_attendance_with_user')
    .select('*')
    .eq('cmms_company_id', companyProfile.id)
    .gte('check_in_time', `${selectedDate}T00:00:00`)
    .lte('check_in_time', `${selectedDate}T23:59:59`)
    .order('check_in_time', { ascending: false }),
  
  canManage ? supabase
    .from('cmms_attendance_qr_locations')
    .select('*')
    .eq('cmms_company_id', companyProfile.id)
    .order('created_at', { ascending: false }) : { data: [], error: null }
]);
```

Then update the rendering code to use the flattened fields:
- `record.staff.full_name` → `record.staff_full_name`
- `record.staff.email` → `record.staff_email`
- `record.staff.avatar_url` → `record.staff_avatar_url`

**Option B: Fetch separately:**
```javascript
const [recordsRes, qrRes] = await Promise.all([
  supabase
    .from('cmms_staff_attendance')
    .select('*')
    .eq('cmms_company_id', companyProfile.id)
    .gte('check_in_time', `${selectedDate}T00:00:00`)
    .lte('check_in_time', `${selectedDate}T23:59:59`)
    .order('check_in_time', { ascending: false }),
  
  canManage ? supabase
    .from('cmms_attendance_qr_locations')
    .select('*')
    .eq('cmms_company_id', companyProfile.id)
    .order('created_at', { ascending: false }) : { data: [], error: null }
]);

// Fetch user details separately
if (recordsRes.data) {
  const userIds = [...new Set(recordsRes.data.map(r => r.cmms_user_id))];
  const { data: usersData } = await supabase
    .from('cmms_users')
    .select('id, full_name, email, avatar_url')
    .in('id', userIds);
  
  const usersMap = {};
  usersData?.forEach(u => usersMap[u.id] = u);
  
  // Attach user data to records
  recordsRes.data = recordsRes.data.map(record => ({
    ...record,
    staff: usersMap[record.cmms_user_id]
  }));
}
```

## Debugging

Check browser console for detailed error messages:
```javascript
console.log('Records error:', recordsRes.error);
console.log('QR error:', qrRes.error);
```

If you see "JWT expired" or "not authenticated", the user session needs to be refreshed.
