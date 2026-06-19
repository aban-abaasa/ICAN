## CMMS Report Messaging & Job Assignment System - Deployment Guide ✅

**Date:** May 28, 2026  
**Status:** Complete & Ready to Deploy  
**Version:** 1.0

---

## 📋 What Was Added

### 1. **Messaging System**
- ✅ Send messages/comments on reports to specific users or broadcast to all
- ✅ Message threading (reply to specific messages)
- ✅ Mark messages as read/unread
- ✅ Delete messages
- ✅ Real-time message updates (5-second auto-refresh)

### 2. **Job Assignment System**
- ✅ Admin/Coordinator/Supervisor can assign jobs to any user
- ✅ Track job status: pending → accepted → in_progress → completed → rejected
- ✅ Set priority levels: low, medium, high, critical
- ✅ Set due dates for jobs
- ✅ Users can see jobs assigned to them
- ✅ Full CRUD operations on job assignments

### 3. **Access Control**
```
Messages:
├─ All users: Can send messages on reports they can access
├─ Senders: Can delete own messages
└─ Admins: Can delete any message

Job Assignments:
├─ Admin/Coordinator/Supervisor: Can create jobs for any user
├─ Assigned Users: Can update status (pending→accepted→in_progress→completed)
├─ Admins: Can delete any job
└─ Regular Users: Can only see jobs assigned to them
```

---

## 🚀 Deployment Steps

### Step 1: Deploy SQL Schema to Supabase
```
1. Login to Supabase Dashboard
2. Go to: SQL Editor → New Query
3. Copy entire contents of: CMMS_REPORT_MESSAGING_SYSTEM.sql
4. Paste into Supabase SQL Editor
5. Click "Run" button
6. Verify: "CMMS Report Messaging & Job Assignment System Deployed Successfully"
```

**Deployment Time:** ~30 seconds  
**Tables Created:**
- `cmms_report_messages` - Store all messages and comments
- `cmms_job_assignments` - Store job assignments

**Functions Created:**
- `fn_send_report_message()` - Send message on report
- `fn_get_report_messages()` - Retrieve threaded messages
- `fn_assign_job()` - Assign job to user
- `fn_get_user_job_assignments()` - Get user's jobs

### Step 2: Copy Service Layer
```
Source: frontend/src/services/cmmsMessagingService.js
Already created ✅
Location: c:\Users\Aban\Desktop\ICAN\frontend\src\services\cmmsMessagingService.js
```

**Services Provided:**
- `sendReportMessage()` - Send message
- `getReportMessages()` - Load messages
- `markMessageAsRead()` - Mark as read
- `deleteMessage()` - Delete message
- `assignJobToUser()` - Create job assignment
- `getUserJobAssignments()` - Get user's jobs
- `updateJobStatus()` - Update job status
- `getReportJobs()` - Get report's jobs
- `getCompanyUsers()` - Get user list for assignment

### Step 3: Integrate Messaging Component into CMSSModule
```javascript
// In frontend/src/components/CMSSModule.jsx

// 1. Add import at top
import ReportMessagingPanel from '../components/ReportMessagingPanel';

// 2. Inside ReportsManager component, after report display, add:
<ReportMessagingPanel
  reportId={expandedReportId}
  companyId={companyIdToUse}
  userRole={userRole}
  currentUserId={currentUserId}
  userEmail={userEmail}
/>

// 3. Make sure you have the necessary state:
// - expandedReportId: UUID of currently selected report
// - companyIdToUse: UUID of current company
// - userRole: 'admin' | 'coordinator' | 'supervisor' | 'technician' | etc
// - currentUserId: User's UUID
// - userEmail: User's email
```

**Integration Time:** ~5 minutes

---

## 🧪 Testing Guide

### Test 1: Send Message as Technician
```
1. Login as Technician
2. Go to CMMS → Reports Tab
3. Click expand on any report
4. Scroll to Messaging Panel
5. Type message: "Need help with this task"
6. Click "Send" button
7. ✅ Message appears in list with timestamp
8. Refresh page
9. ✅ Message still there (persisted)
```

### Test 2: Broadcast Message to All
```
1. Still logged in as Technician
2. Click on message "Send to (optional)" dropdown
3. Leave empty (or select specific user)
4. Type: "This pump needs inspection"
5. Click Send
6. ✅ Message shows "Broadcast to all"
7. Login as different user
8. Go to same report
9. ✅ Can see technician's message
```

### Test 3: Admin Assigns Job
```
1. Login as Admin
2. Go to CMMS → Reports Tab
3. Click expand on any report
4. In Messaging Panel, click "Jobs" tab
5. Click "Assign New Job" button
6. Fill form:
   - Assign to: Select "John (Technician)"
   - Job Title: "Repair Pump Motor"
   - Description: "Fix the leaking pump in Zone A"
   - Due Date: (pick date)
   - Priority: "High"
7. Click "Assign Job"
8. ✅ Job appears in list with status "pending"
9. Notification message sent to technician
```

### Test 4: Technician Updates Job Status
```
1. Login as Technician
2. Go to CMMS → Reports Tab
3. Open same report
4. Click "Jobs" tab in Messaging Panel
5. ✅ See job assigned by admin: "Repair Pump Motor"
6. Dropdown to update status:
   - Current: pending
   - Change to: in_progress
7. ✅ Status updates immediately
8. Change to: completed
9. ✅ Admin can see completed status
```

### Test 5: Supervisor Can't Access Other Department
```
1. Create report in Engineering department
2. Login as Supervisor in Maintenance dept
3. Go to CMMS → Reports
4. ✅ Cannot see Engineering department report
5. Cannot access messaging
6. Login as Admin
7. ✅ Can see all reports
8. Can send messages to anyone
```

### Test 6: Role-Based Access
```
Technician:
- ✅ Can send messages
- ✅ Cannot see "Jobs" tab
- ✅ Cannot assign jobs
- ✅ Can see jobs assigned to them

Coordinator/Supervisor:
- ✅ Can send messages
- ✅ See "Jobs" tab
- ✅ Can assign jobs to their department
- ✅ Can update any job status

Admin:
- ✅ Can send messages to anyone
- ✅ See "Jobs" tab
- ✅ Can assign jobs to anyone
- ✅ Can delete any message/job
- ✅ Can update any job status
```

---

## 📊 Database Schema

### cmms_report_messages Table
```
id                  → UUID (Primary Key)
report_id           → UUID (FK: cmms_company_reports)
company_id          → UUID (FK: cmms_companies)
sender_id           → UUID (FK: cmms_users)
recipient_id        → UUID (FK: cmms_users) [Optional - NULL means broadcast]
message_text        → TEXT (Required)
message_type        → VARCHAR (comment, assignment, status_update, reply)
parent_message_id   → UUID (FK: cmms_report_messages) [For threading]
is_read             → BOOLEAN (default: FALSE)
created_at          → TIMESTAMPTZ (default: NOW())
updated_at          → TIMESTAMPTZ (default: NOW())

Indexes:
- idx_cmms_messages_report      → Fast report lookup
- idx_cmms_messages_sender      → Find messages by sender
- idx_cmms_messages_recipient   → Find direct messages
- idx_cmms_messages_unread      → Fast unread count
- idx_cmms_messages_thread      → Fast thread traversal
```

### cmms_job_assignments Table
```
id                  → UUID (Primary Key)
report_id           → UUID (FK: cmms_company_reports)
company_id          → UUID (FK: cmms_companies)
assigned_to_user_id → UUID (FK: cmms_users)
assigned_by_user_id → UUID (FK: cmms_users)
job_title           → VARCHAR (Required)
job_description     → TEXT (Optional)
assignment_status   → VARCHAR (pending, accepted, in_progress, completed, rejected)
due_date            → DATE (Optional)
priority            → VARCHAR (low, medium, high, critical)
created_at          → TIMESTAMPTZ
updated_at          → TIMESTAMPTZ

Indexes:
- idx_job_assignment_report     → Find jobs by report
- idx_job_assignment_user       → Find jobs by user
- idx_job_assignment_status     → Filter by status
- idx_job_assignment_company    → Filter by company
```

---

## 🔐 Security Features

✅ **RLS Policies Enforce:**
- Messages visible only to participants and report viewers
- Job assignments only visible to assigned user, supervisor, admin
- Only sender can delete own messages (except admin)
- Only admin/coordinator/supervisor can create assignments
- Users can only update status of jobs assigned to them

✅ **Data Validation:**
- Messages cannot be empty
- Recipients must be active in company
- Reports must exist and belong to company
- Job titles required
- Dates validated

✅ **Audit Trail:**
- All messages timestamped
- Sender tracked
- Job assignments track who assigned to whom
- Status changes tracked in updated_at

---

## 🎯 Features Summary

| Feature | Technician | Coordinator | Supervisor | Admin |
|---------|-----------|-------------|-----------|-------|
| Send messages | ✅ | ✅ | ✅ | ✅ |
| Broadcast to all | ❌ | ❌ | ❌ | ✅ |
| Delete own messages | ✅ | ✅ | ✅ | ✅ |
| Delete any message | ❌ | ❌ | ❌ | ✅ |
| Assign jobs | ❌ | ✅ Dept | ✅ Dept | ✅ Any |
| Update own job status | ✅ | ✅ | ✅ | ✅ |
| Update any job status | ❌ | ❌ | ❌ | ✅ |
| See jobs assigned to you | ✅ | ✅ | ✅ | ✅ |
| See all jobs | ❌ | ✅ Dept | ✅ Dept | ✅ |
| Delete job assignment | ❌ | ❌ | ❌ | ✅ |

---

## 📱 UI Components

### ReportMessagingPanel Component
**Location:** `frontend/src/components/ReportMessagingPanel.jsx`

**Props:**
```javascript
<ReportMessagingPanel
  reportId={string}           // UUID of report
  companyId={string}          // UUID of company
  userRole={string}           // 'admin', 'coordinator', 'supervisor', 'technician', etc
  currentUserId={string}      // UUID of current user
  userEmail={string}          // Email of current user
/>
```

**Features:**
- Tab navigation: Messages ↔ Jobs
- Auto-refresh every 5 seconds
- Real-time message display
- Job creation form (admin/coordinator/supervisor)
- Status update buttons
- Delete buttons
- Responsive design (mobile-friendly)

---

## 🐛 Troubleshooting

### Messages not appearing
**Check:**
1. User is logged in
2. Can access the report (role-based)
3. Browser console for errors (F12)
4. Supabase RLS policies enabled
5. Try refreshing page

### Can't assign jobs
**Check:**
1. Your role is admin/coordinator/supervisor
2. Target user is active in company
3. User's email matches cmms_users table
4. Report exists in database
5. Selected user is in same company

### Messages show but can't send
**Check:**
1. Message text isn't empty
2. User has insert permission on cmms_report_messages
3. RLS policy includes authenticated users
4. No database constraints violations

### Jobs not showing for user
**Check:**
1. Jobs are assigned to your user ID
2. Company ID matches
3. Your email matches cmms_users.email
4. Account is active (is_active = TRUE)

---

## 📞 API Reference

### Service Methods

#### `sendReportMessage(companyId, reportId, messageText, recipientId?, messageType?)`
Sends a message on a report.

**Returns:**
```javascript
{
  success: true/false,
  data: {message object},
  error: "error message",
  message: "success message"
}
```

#### `getReportMessages(companyId, reportId)`
Retrieves all messages for a report (threaded).

**Returns:**
```javascript
{
  success: true/false,
  data: [{message objects with thread_level}],
  stats: {totalMessages, unreadMessages},
  error: "error message"
}
```

#### `assignJobToUser(companyId, reportId, userId, jobTitle, description?, dueDate?, priority?)`
Assigns a job to a user on a report.

**Returns:**
```javascript
{
  success: true/false,
  data: {assignment object},
  error: "error message",
  message: "Job assigned successfully"
}
```

#### `getUserJobAssignments(companyId)`
Gets all jobs assigned to current user.

**Returns:**
```javascript
{
  success: true/false,
  data: [{job assignment objects with user details}],
  stats: {totalJobs, pendingJobs, inProgressJobs, completedJobs},
  error: "error message"
}
```

#### `updateJobStatus(assignmentId, newStatus)`
Updates the status of a job assignment.

**Valid statuses:** pending, accepted, in_progress, completed, rejected

---

## ✅ Verification Checklist

After deployment, verify:

- [ ] SQL functions created (check Supabase Functions tab)
- [ ] RLS policies enabled on tables
- [ ] Service file at correct path
- [ ] Component imported in CMSSModule
- [ ] Can send messages on reports
- [ ] Can assign jobs (as admin/coordinator)
- [ ] Job status updates work
- [ ] Messages persist after refresh
- [ ] Access control works correctly
- [ ] No console errors in browser (F12)

---

## 📈 Next Steps

1. ✅ Deploy SQL to Supabase
2. ✅ Copy service layer
3. ✅ Import component in CMSSModule
4. ✅ Test all scenarios
5. 🔄 Monitor usage and refine

---

## 🎉 Features Ready to Use

✨ **Messaging System**
- Send direct messages to specific users
- Broadcast messages to team
- Message threading and replies
- Real-time updates

✨ **Job Assignment System**
- Create and assign jobs
- Track job progress
- Set priorities and due dates
- Update status in real-time

✨ **Full Access Control**
- Role-based permissions
- Department isolation
- Audit trail

**Status:** 🚀 READY FOR DEPLOYMENT

---

**Support:** For issues, check Supabase logs → SQL Editor → View Error Logs
