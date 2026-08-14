# CMMS Staff Attendance & Visitor Management System
## Complete Implementation Guide

---

## 📋 Overview

A complete **QR code-based staff attendance and visitor management** system for CMMS that includes:

✅ **Staff Attendance Check-In/Out** with QR code scanning  
✅ **Visitor Management** with registration and tracking  
✅ **Location-based Validation** (must check in at company location)  
✅ **Admin Review Panel** to flag suspicious records  
✅ **Attendance Audit Trail** for admin edits and modifications  
✅ **Gmail Confirmation Flow** (staff verify visitor email)  
✅ **Security Controls** Admin can edit/dispute attendance records  

---

## 🗄️ Database Schema Created

**File**: `CMMS_STAFF_ATTENDANCE_VISITOR_MANAGEMENT.sql`

### Tables Created:

#### 1. **cmms_staff_attendance**
- Tracks staff check-in/out times
- Stores location validation status
- Supports QR code tokens
- Records admin edits with timestamps

#### 2. **cmms_visitor_checkin**
- Visitor registration (name, email, phone)
- Check-in/out tracking
- Host staff member association
- Flagging system for suspicious records

#### 3. **cmms_attendance_audit**
- Complete audit trail of all admin edits
- Records who changed what and when
- Supports change reasons

### RPC Functions:

```sql
-- Staff Check-In
staff_check_in(p_cmms_user_id, p_cmms_company_id, p_location, p_latitude, p_longitude)

-- Staff Check-Out
staff_check_out(p_attendance_id, p_location, p_latitude, p_longitude)

-- Visitor Check-In
visitor_check_in(p_cmms_company_id, p_visitor_name, p_visitor_email, p_visitor_phone, 
                 p_check_in_location, p_latitude, p_longitude, p_host_email, p_purpose)

-- Visitor Check-Out
visitor_check_out(p_visitor_id, p_location)

-- Admin Edit Attendance
admin_edit_attendance(p_attendance_id, p_check_in_time, p_check_out_time, p_location, 
                     p_notes, p_edit_reason)

-- Flag Suspicious Visitor
flag_visitor_record(p_visitor_id, p_reason)

-- Get Attendance Records
get_attendance_records(p_cmms_company_id, p_start_date, p_end_date, p_user_id)

-- Get Visitor Records
get_visitor_records(p_cmms_company_id, p_start_date, p_end_date, p_status)
```

---

## 🎨 Frontend Components Created

### 1. **CMSSAttendancePanel.jsx**
Location: `frontend/src/components/CMSSAttendancePanel.jsx`

**Features:**
- **My Attendance Tab**: View today's check-in/out status
- **All Staff Attendance Tab** (Admin only): View all staff attendance with date/user filtering
- **QR Scanner Tab** (Admin only): Generate and manage QR codes for check-in locations
- **Location Validation**: Compares scanned location with company location
- **Real-time Status**: Shows if currently checked in or checked out

**Key Functions:**
```javascript
- handleCheckIn()      // Check in at location
- handleCheckOut()     // Check out from location
- startQRScanner()     // Scan location QR code
- loadMyAttendance()   // Load today's attendance
- loadAllAttendance()  // Admin: load all staff records
```

### 2. **CMSSVisitorManagementPanel.jsx**
Location: `frontend/src/components/CMSSVisitorManagementPanel.jsx`

**Features:**
- **Visitor Check-In Form**: 
  - Name, email, phone (required/optional)
  - Location scanned via QR code
  - Host staff member selection (email scanned via QR)
  - Purpose of visit
  
- **Visitor Records Tab**:
  - View all visitors by date
  - Filter by status (checked in, checked out, flagged)
  - Quick check-out button
  
- **Review Suspicious Visitors Tab** (Admin only):
  - Flag visitors with reasons
  - Add admin notes
  - Location validation status

**Key Functions:**
```javascript
- handleVisitorCheckIn()   // Register new visitor
- handleVisitorCheckOut()  // Check out visitor
- handleFlagVisitor()      // Flag for review
- startQRScanner(mode)     // Scan location or email
- loadVisitorRecords()     // Load visitor records
```

---

## 📱 How It Works

### **Staff Check-In Flow**

1. Staff member opens CMMS → **Attendance** tab
2. Clicks **Check In** or scans a location QR code placed at entry points
3. System validates location matches company location
4. Records check-in time with GPS coordinates (if available)
5. Staff can view their attendance status anytime

### **Staff Check-Out Flow**

1. Staff member goes to Attendance tab
2. Clicks **Check Out**
3. System records check-out time
4. Can view hours worked for the day

### **Visitor Check-In Flow**

1. **Visitor** (no app access needed):
   - Scans QR code at entrance
   - Fills form: name, email, phone, purpose
   - Selects or scans their host's email (staff member)

2. **Staff (Host)**:
   - Receives notification that visitor arrived
   - Confirms visitor in app (optional)
   - Visitor registration complete

3. **Admin**:
   - Can review all visitors
   - Can flag suspicious records
   - Can edit visitor details if needed

### **Location Validation**

- Company location stored in `cmms_company_profiles.location`
- Each check-in compares scanned location with company location
- If match: ✅ **Location validated**
- If no match: ⚠️ **Location flagged for review**

### **Admin Edit Attendance**

Only CMMS admins can:
- Edit check-in/out times (with reason)
- Change recorded location
- Add/modify notes
- All changes logged in audit trail

### **Fraud Detection**

Admins can flag visitors if:
- Location mismatch
- Unrecognized visitor
- Security concern
- False credentials

---

## 🚀 Deployment Steps

### **Step 1: Deploy Database Schema**

```sql
-- Run in Supabase SQL Editor
-- File: CMMS_STAFF_ATTENDANCE_VISITOR_MANAGEMENT.sql

-- Copy entire file contents and execute
-- This creates:
-- - 3 new tables
-- - 1 audit table
-- - 8 RPC functions
-- - Indexes for performance
```

If the browser reports `POST /rest/v1/rpc/visitor_check_in 404`, the SQL has
not been applied to that Supabase project yet (or PostgREST has not refreshed
its schema). Run the complete file in the SQL Editor. Its final
`NOTIFY pgrst, 'reload schema';` makes the new RPC endpoints available
immediately. Do not try to fix this with a frontend URL change.

After it succeeds, verify the deployment in the SQL Editor:

```sql
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'visitor_check_in',
    'create_cmms_attendance_qr_location',
    'resolve_cmms_attendance_qr',
    'staff_check_in_with_qr'
  )
ORDER BY routine_name;
```

### **Step 2: Update Role Configuration**

The tool options in `CMMSRoleConfiguration.jsx` are already updated with:
- `attendance` - Staff attendance QR check-in
- `visitor-mgmt` - Visitor management

Admins can now assign these tools to custom roles.

### **Step 3: Verify Component Integration**

The components are already integrated in `CMSSModule.jsx`:
```javascript
import CMSSAttendancePanel from './CMSSAttendancePanel.jsx';
import CMSSVisitorManagementPanel from './CMSSVisitorManagementPanel.jsx';
```

The tabs appear automatically when:
- User has `attendance` or `visitor-mgmt` tool access
- Admin assigns roles with these permissions

### **Step 4: Test the System**

**For Staff:**
1. Go to CMMS Dashboard
2. Select **Attendance** tab
3. Click "Scan QR Code" 
4. Enter location (e.g., "Front Desk")
5. Click "Check In"

**For Admin:**
1. Go to CMMS Dashboard
2. View **All Staff Attendance**
3. Filter by date/user
4. See location validation status

**For Visitors:**
1. Scan QR code at entrance
2. Fill visitor form
3. Select host staff member
4. Submit

---

## 🔒 Security Features

### **Location Validation**
- Compares check-in location against company location
- Prevents false check-ins from remote locations
- GPS coordinates stored (optional but recommended)

### **Admin Audit Trail**
- Every edit by admin is logged
- Records: who, what, when, why
- Cannot delete records (only edit with reason)

### **Role-Based Access**
- Only assigned staff can see their own attendance
- Only admins can view all records and make edits
- Visitor records only visible to relevant staff

### **Visitor Flagging**
- Admins can flag suspicious visitors
- Requires reason and admin notes
- Tracked in system for security review

---

## 📊 Data Access

### **Attendance Reports**
Staff can see:
- Their check-in/out times today
- Location recorded
- Hours worked

Admins can see:
- All staff attendance with date range filter
- Location validation status
- Edit history
- Department-level or company-wide

### **Visitor Reports**
Admins can:
- View all visitors by date
- Filter by status (checked in, out, flagged)
- See host information
- View purpose of visit

---

## 🔧 Configuration Options

### **Company Location**
Set in **Company Configuration** tab:
```
Location: "Front Desk" or "123 Main St" or any text
```
This is matched against check-in location for validation.

### **QR Code Placement**
Create QR codes containing:
- Location name: `"Front Desk"` or `"Room 101"`
- Staff email: `"staff@company.com"`
- Visitor purpose: `"Meeting"`, `"Delivery"`, etc.

Use any QR code generator (online or in-app).

### **Notifications** (Future)
Can integrate with:
- Email notifications when visitor arrives
- SMS alerts for admins on location mismatches
- Push notifications for staff reminders

---

## 📝 Example QR Code Values

**Location QR:**
```
Front Desk
```

**Staff Email QR:**
```
john.doe@company.com
```

**Purpose QR:**
```
Meeting with management
```

Generate these using any QR code tool and place at check-in locations.

---

## 🐛 Troubleshooting

### **Location Not Validating**
- Ensure company location is set in company config
- Check spelling/case sensitivity
- Company location: `"Front Desk"` vs entered: `"front desk"` ← case-insensitive match

### **Camera Not Working**
- Browser needs camera permission
- Check browser console for errors
- Ensure HTTPS connection (required for camera API)

### **Attendance Not Showing**
- Verify staff member is active in CMMS users
- Check role has `attendance` tool access
- Verify company is selected correctly

### **QR Scan Failing**
- Ensure QR code is clear and not damaged
- Good lighting required
- Hold camera steady for 2-3 seconds
- Try different angles

---

## 📱 Mobile Optimization

The system is fully mobile-responsive:
- Camera scanner works on phones/tablets
- Touch-friendly buttons and forms
- Responsive tables and layouts
- GPS location works on mobile devices

Test on:
- iOS Safari
- Android Chrome
- Mobile Firefox

---

## 🎯 Next Steps

1. ✅ Deploy SQL schema
2. ✅ Test attendance check-in/out
3. ✅ Generate QR codes for locations
4. ✅ Train staff on system
5. ✅ Configure custom roles with attendance/visitor tools
6. ✅ Monitor attendance records for accuracy
7. ⏳ Add email notifications (optional integration)
8. ⏳ Generate attendance reports (optional dashboard)

---

## 📞 Support

For issues:
1. Check admin notes in attendance records
2. Review audit trail for changes
3. Verify location settings
4. Check browser console for errors
5. Ensure all staff have active CMMS user accounts

---

**System Ready for Deployment! 🚀**

All components are integrated and ready to use. Deploy the SQL schema to Supabase and the system will be immediately available to CMMS users with proper role assignments.
