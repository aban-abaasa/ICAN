# CMMS Attendance System - Complete Fix

## Issues Fixed

### 1. **500 Internal Server Error** on `cmms_attendance_qr_locations`
- **Cause**: RLS policies had complex logic causing internal errors
- **Fix**: Simplified RLS policies in `FIX_CMMS_ATTENDANCE_COMPLETE.sql`

### 2. **400 Bad Request** on `cmms_staff_attendance` embedded query
- **Cause**: Two problems:
  - Frontend was trying to query non-existent columns (`full_name`, `avatar_url`)
  - RLS policies weren't allowing embedded resource queries
- **Fix**: 
  - Updated frontend to fetch users separately
  - Fixed RLS policies to allow proper access

### 3. **Column mismatch**
- **Issue**: `cmms_users` table has `user_name` not `full_name`, and no `avatar_url`
- **Fix**: Frontend now maps `user_name` → `full_name` for backwards compatibility

## Files Modified

### Backend (SQL)
1. ✅ `FIX_CMMS_ATTENDANCE_COMPLETE.sql` - Updated view to use correct columns
   - Changed `full_name` → `user_name`
   - Changed `avatar_url` → `phone`
   - Fixed all RLS policies

### Frontend (JavaScript)
1. ✅ `CMSSAttendancePanel.jsx` - Changed query strategy
   - Removed embedded resource query: `staff:cmms_user_id(...)`
   - Now fetches users separately
   - Maps field names for backwards compatibility

## How to Deploy

### Step 1: Run SQL Fix
Run this in Supabase SQL Editor:
```sql
-- File: backend/FIX_CMMS_ATTENDANCE_COMPLETE.sql
```

This will:
- Fix all RLS policies
- Grant proper permissions
- Create helper view (optional)

### Step 2: Frontend Already Fixed
The frontend file `CMSSAttendancePanel.jsx` has been updated to:
- Query `cmms_staff_attendance` without embedded resources
- Fetch `cmms_users` data separately
- Map `user_name` to `full_name` for compatibility
- Handle missing `avatar_url` gracefully

## Verification

After deploying, check:

1. **No more 500 errors** on QR locations query
2. **No more 400 errors** on attendance query
3. **Staff names display correctly** in the UI
4. **Check-in/check-out works** without errors

## Database Schema Reference

### cmms_users columns (actual):
- `id` UUID
- `cmms_company_id` UUID
- `user_name` VARCHAR(255) ← Used as display name
- `email` VARCHAR(255)
- `phone` VARCHAR(20)
- `role` VARCHAR(50)
- `is_active` BOOLEAN
- `is_creator` BOOLEAN

### Frontend mapping:
```javascript
staff: {
  id: user.id,
  full_name: user.user_name,  // Mapped!
  email: user.email,
  phone: user.phone,
  avatar_url: null  // Not available
}
```

## Notes

- Avatar images won't display (column doesn't exist)
- Can add `avatar_url` column later if needed:
  ```sql
  ALTER TABLE public.cmms_users ADD COLUMN avatar_url TEXT;
  ```
