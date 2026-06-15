## 🔔 CMMS User Notification System

### What's New?

When an admin adds a user to CMMS, the system now:

✅ **Creates a notification record** in the database
✅ **Shows a bell icon** in the header with unread count
✅ **Displays real-time notifications** as users log in
✅ **Logs all notification events** for audit trail

---

## 📋 Database Setup

### 1. Run SQL Script

Execute [CMMS_NOTIFICATIONS_TABLE.sql](CMMS_NOTIFICATIONS_TABLE.sql) in Supabase SQL Editor to create:

- `cmms_notifications` table - Stores all notifications
- `cmms_notification_audit` table - Audit trail of notifications
- `cmms_unread_notifications` view - Query all unread notifications
- Triggers & RLS policies - Secure access

### 2. Tables Created

```
cmms_notifications:
├── id (UUID, primary key)
├── cmms_user_id (FK to cmms_users)
├── cmms_company_id (FK to cmms_company_profiles)
├── notification_type (varchar)
├── title (varchar)
├── message (text)
├── icon (varchar)
├── is_read (boolean)
├── read_at (timestamp)
├── created_at (timestamp)
└── updated_at (timestamp)
```

---

## 🎯 Admin Workflow

When admin adds a user:

```
Admin clicks "Add User to CMMS"
        ↓
User is inserted into cmms_users
        ↓
Role assigned to cmms_user_roles
        ↓
📬 NOTIFICATION CREATED:
   ├── Title: "✅ You've been added to CMMS!"
   ├── Message: "Welcome! You are now a [ROLE]"
   ├── Type: "user_added_to_cmms"
   └── Icon: "🎉"
        ↓
Success message shown to admin:
"✅ User added to CMMS successfully!
📬 Notification sent to user@email.com
They will see "Coordinator" role when they log in."
```

---

## 🔔 User Notification Panel

### Location
Top-right corner of CMMS dashboard header, next to role badge

### Features
- **Bell Icon** - Shows unread notification count
- **Click to expand** - Full list of notifications
- **Mark as read** - Individual notifications can be marked read
- **Delete** - Remove notifications
- **Real-time updates** - Supabase real-time subscriptions
- **Time stamps** - "Just now", "5m ago", etc.

### Notification Types
- `user_added_to_cmms` - User added to system
- `role_assigned` - Role assigned
- `task_assigned` - Work order assigned
- `task_completed` - Task completed
- `approval_needed` - Approval requested
- etc.

---

## 💻 Code Components

### Files Added/Modified

1. **NotificationsPanel.jsx** (New)
   - Bell icon with unread badge
   - Expandable notification list
   - Real-time subscriptions
   - Mark as read/delete actions

2. **CMSSModule.jsx** (Modified)
   - Added NotificationsPanel import
   - Added bell icon to header
   - Added notification creation in handleAddUser()
   - Logs notification status

3. **CMMS_NOTIFICATIONS_TABLE.sql** (New)
   - Complete database schema
   - Triggers for audit logging
   - RLS policies for security
   - Indexes for performance

---

## 🚀 Next Steps

### 1. Deploy SQL Script
```
→ Go to Supabase Dashboard
→ SQL Editor
→ Create New Query
→ Paste CMMS_NOTIFICATIONS_TABLE.sql
→ Run
```

### 2. Test the System

**As Admin:**
1. Navigate to Users & Roles tab
2. Add a new user
3. Select role
4. Click "Add User to CMMS"
5. ✅ See success message: "📬 Notification sent to user@email.com"

**As Added User:**
1. Log in to CMMS
2. Look for bell icon in header (top-right)
3. ✅ Should show "1" unread notification
4. Click bell to see notification:
   ```
   🎉 You've been added to CMMS!
   Welcome to the company! Your admin has added you as a 
   Coordinator. You can now access the CMMS dashboard and 
   manage maintenance tasks.
   ```

---

## 📊 Notification Triggers

The system can be extended to create notifications for:

- ✅ User added to CMMS (implemented)
- User role changed
- Work order assigned
- Approval request (requisition needs approval)
- Task completed
- Low inventory alert
- Maintenance due
- System announcements

---

## 🔒 Security

### Row-Level Security (RLS) Policies

- Users can only see **their own notifications**
- Admins can create notifications
- Users can update their own notifications (mark read)
- All changes logged in audit table

### Audit Trail

Every notification action is logged:
```
cmms_notification_audit:
├── notification_id
├── action (created, read, deleted)
└── created_at
```

---

## 🛠️ Troubleshooting

### Notifications not appearing?

1. Check browser console (F12) for errors
2. Verify Supabase connection
3. Confirm `cmms_notifications` table exists
4. Check RLS policies are enabled
5. Verify user's company_id is set

### Bell icon not showing?

1. Confirm userCompanyId is set
2. Check NotificationsPanel component loaded
3. Verify user has permission to read notifications

### Real-time updates not working?

1. Check Supabase real-time enabled
2. Verify subscription in browser (check console logs)
3. Restart browser tab

---

## 📝 Example Notification Creation

```javascript
// When admin adds user:
const { error } = await supabase
  .from('cmms_notifications')
  .insert([
    {
      cmms_user_id: userId,
      cmms_company_id: userCompanyId,
      notification_type: 'user_added_to_cmms',
      title: '✅ You\'ve been added to CMMS!',
      message: `Welcome! You are now a ${role} at ${companyName}`,
      icon: '🎉',
      is_read: false,
      created_at: new Date().toISOString()
    }
  ]);
```

---

## 🎯 Current Implementation Status

✅ Database schema created
✅ Notification table with RLS policies
✅ NotificationsPanel component built
✅ Integration with user add workflow
✅ Real-time subscription implemented
✅ Audit logging configured
✅ Bell icon with unread badge
✅ Mark as read functionality
✅ Delete notification functionality

---

For questions or issues, check the console logs marked with:
- 📬 = Notification event
- ✅ = Success
- ❌ = Error
- ⚠️ = Warning
