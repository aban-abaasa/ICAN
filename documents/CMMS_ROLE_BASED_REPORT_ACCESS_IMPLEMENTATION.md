## CMMS Role-Based Report Access Control Implementation Guide

**Date:** May 28, 2026
**Status:** Complete
**Priority:** High (Security & Compliance)

---

## 📋 Overview

This document explains how to implement role-based access control for CMMS reports, ensuring that:
- ✅ **Regular Users** can only view their own submitted reports
- ✅ **Supervisors & Coordinators** can view their department reports only
- ✅ **Admins** maintain full access to all reports

---

## 🎯 Access Control Matrix

### Before Implementation ❌
```
Any member who submits reports:
├─ Can see ALL company reports
├─ Cannot distinguish who can see what
└─ Security risk: Personal reports visible to everyone
```

### After Implementation ✅
```
Admin:
├─ View: ALL company reports
├─ Edit: All reports
├─ Delete: All reports
└─ Visibility: Full access

Coordinator/Supervisor:
├─ View: Department reports + their own
├─ Edit: Own reports only
├─ Delete: Own reports only
└─ Visibility: Department-scoped

Regular User (Technician/Finance):
├─ View: Own reports only
├─ Edit: Own reports only
├─ Delete: Own reports only
└─ Visibility: Personal-scoped
```

---

## 📊 User Role Permissions

| Role | View All | View Department | View Own | Edit Own | Edit All | Delete Own | Delete All |
|------|----------|-----------------|----------|----------|----------|-----------|-----------|
| Admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Coordinator | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| Supervisor | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| Technician | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ |
| Finance | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ |
| Member | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ |

---

## 🔧 Implementation Steps

### Step 1: Deploy Database Changes

**File:** `backend/CMMS_ROLE_BASED_REPORT_ACCESS.sql`

**Steps:**
1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Navigate to **SQL Editor**
3. Click **New Query**
4. Copy entire content from `CMMS_ROLE_BASED_REPORT_ACCESS.sql`
5. Paste into SQL editor
6. Click **Run** (play icon)
7. Verify success: Should see message "CMMS Role-Based Report Access Control System Deployed Successfully"

**What gets deployed:**
- ✅ New columns: `visibility_level`, `is_personal_view`
- ✅ 5 RLS Policies for SELECT, INSERT, UPDATE, DELETE operations
- ✅ 4 New Functions:
  - `fn_get_filtered_reports()` - Returns only accessible reports
  - `fn_create_filtered_report()` - Creates with auto visibility setting
  - `fn_check_report_access()` - Validates user has access
  - `fn_get_department_report_stats()` - Department-level analytics

### Step 2: Add Frontend Service

**File:** `frontend/src/services/cmmsReportAccessService.js`

**Already Created:** ✅ Ready to import and use

**Key Functions:**
```javascript
// Get reports user can access
getFilteredReports(companyId)

// Create report with proper visibility
createFilteredReport(companyId, reportData)

// Check if user can edit/delete
checkReportAccess(reportId, companyId)

// Update report status
updateReportStatus(reportId, newStatus, notes)

// Get department statistics
getDepartmentReportStats(companyId, departmentId)
```

### Step 3: Update Report Component

**Update `frontend/src/components/CMSSModule.jsx`:**

Find the Report Submission section and replace with:

```javascript
import {
  getFilteredReports,
  createFilteredReport,
  checkReportAccess,
  updateReportStatus,
  getUserReportAccessLevel
} from '../services/cmmsReportAccessService';

// In ReportingSection component:

const [reports, setReports] = useState([]);
const [userAccessLevel, setUserAccessLevel] = useState(null);
const [isLoading, setIsLoading] = useState(false);

// Load reports on mount
useEffect(() => {
  loadReports();
  loadUserAccessLevel();
}, [cmmsCompanyId]);

const loadReports = async () => {
  setIsLoading(true);
  try {
    const result = await getFilteredReports(cmmsCompanyId);
    if (result.success) {
      setReports(result.data);
    }
  } catch (error) {
    console.error('Error loading reports:', error);
  } finally {
    setIsLoading(false);
  }
};

const loadUserAccessLevel = () => {
  const level = getUserReportAccessLevel(userRole);
  setUserAccessLevel(level);
};

// Handle report submission
const handleSubmitReport = async (formData) => {
  try {
    const result = await createFilteredReport(cmmsCompanyId, {
      reportTitle: formData.title,
      reportCategory: formData.category,
      severity: formData.severity,
      reportBody: formData.body,
      departmentId: userDepartmentId,
      visibilityLevel: 'department' // Auto-set based on role
    });

    if (result.success) {
      alert('✅ Report submitted successfully!');
      loadReports(); // Refresh list
      resetForm();
    } else {
      alert('❌ Error: ' + result.error);
    }
  } catch (error) {
    alert('❌ Error: ' + error.message);
  }
};

// Render reports with access control
const renderReports = () => {
  return reports.map(report => {
    const canEdit = report.is_own_report || userRole === 'admin';
    const canDelete = canEdit;

    return (
      <div key={report.id} className="report-card">
        <div className="report-header">
          <h4>{report.report_title}</h4>
          <span className={`access-badge ${report.access_level}`}>
            {report.access_level === 'admin_full_access' && '👤 Admin Access'}
            {report.access_level === 'department_access' && '👥 Department'}
            {report.access_level === 'personal_access' && '🔒 Personal'}
          </span>
        </div>
        
        <div className="report-meta">
          <p><strong>Category:</strong> {report.report_category}</p>
          <p><strong>Severity:</strong> {report.severity}</p>
          <p><strong>Status:</strong> {report.status}</p>
          <p><strong>Reporter:</strong> {report.reporter_name}</p>
        </div>

        <div className="report-body">
          {report.report_body}
        </div>

        <div className="report-actions">
          {canEdit && (
            <button 
              onClick={() => openEditModal(report)}
              className="btn-edit"
            >
              Edit
            </button>
          )}
          {canDelete && (
            <button 
              onClick={() => handleDeleteReport(report.id)}
              className="btn-delete"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    );
  });
};
```

### Step 4: Test Access Control

#### Test Case 1: Regular User Submitting Report
```
1. Login as Technician
2. Go to Reports Tab
3. Submit report "Machine needs maintenance"
4. Should see: ✅ Report created with "Personal" visibility
5. Other technicians: ❌ Cannot see this report
6. Supervisor: ✅ Can see (if in same department)
7. Admin: ✅ Can see all reports
```

#### Test Case 2: Supervisor Viewing Department Reports
```
1. Login as Supervisor
2. Go to Reports Tab
3. Should see:
   - ✅ All department reports
   - ✅ Their own reports
   - ✅ Team member reports (same department)
   - ❌ Reports from other departments
4. Can edit: ✅ Own reports only
5. Can delete: ✅ Own reports only
```

#### Test Case 3: Admin Viewing All Reports
```
1. Login as Admin
2. Go to Reports Tab
3. Should see: ✅ ALL company reports from all departments
4. Can edit: ✅ All reports
5. Can delete: ✅ All reports
6. See stats: ✅ Total, open, critical, high severity counts
```

#### Test Case 4: Permission Denial
```
1. Login as Technician
2. Technician submits report (becomes reporter)
3. Another Technician tries to access same report
4. Should see: ❌ Access Denied message
5. URL edit (report ID manipulation): ❌ RLS policy prevents access
```

---

## 🔐 SQL Security Features

### Row-Level Security (RLS) Policies

All policies check:
1. User is authenticated
2. User belongs to the company
3. User meets role requirements for action
4. No direct SQL injection possible (parameterized queries)

### Policy Enforcement:
```sql
-- Users can only see reports they have access to
SELECT POLICY:
- Own reports (all roles)
- Department reports (supervisor/coordinator/admin)
- All reports (admin only)

-- Only reporters and admins can edit
UPDATE POLICY:
- reporter_id = current_user_id OR role = 'admin'

-- Only reporters and admins can delete
DELETE POLICY:
- reporter_id = current_user_id OR role = 'admin'
```

---

## 📱 Frontend Components

### Access Level Indicator

```javascript
const AccessLevelBadge = ({ accessLevel }) => {
  const badges = {
    admin_full_access: { label: 'Admin', color: 'red' },
    department_access: { label: 'Department', color: 'blue' },
    personal_access: { label: 'Personal', color: 'gray' }
  };

  const badge = badges[accessLevel];
  return (
    <span className={`badge badge-${badge.color}`}>
      {badge.label}
    </span>
  );
};
```

### Report Filter UI

```javascript
const ReportFilters = ({ reports, onFilter }) => {
  const [filterBy, setFilterBy] = useState('all');

  const filtered = {
    'all': reports,
    'own': reports.filter(r => r.is_own_report),
    'department': reports.filter(r => r.access_level === 'department_access'),
    'open': reports.filter(r => r.status === 'open'),
    'critical': reports.filter(r => r.severity === 'critical')
  };

  return (
    <div className="filters">
      <button onClick={() => setFilterBy('all')}>All Reports</button>
      <button onClick={() => setFilterBy('own')}>My Reports</button>
      <button onClick={() => setFilterBy('department')}>Department</button>
      <button onClick={() => setFilterBy('open')}>Open Issues</button>
      <button onClick={() => setFilterBy('critical')}>Critical</button>
    </div>
  );
};
```

---

## ⚠️ Important Notes

### 1. Department Assignment
- Users must have `department_id` set in `cmms_users` table
- Department reports only visible if both user and report in same department
- Admins see all regardless of department

### 2. Visibility Levels
- `personal`: Only reporter can see
- `department`: Department members (supervisor+) can see
- `company`: Coordinators only (if implemented)
- `public`: Special admin-only reports (if needed)

### 3. Real-time Updates
- Reports list updates after:
  - New report submission
  - Status change
  - Manual refresh
- Consider adding Supabase real-time subscriptions for live updates:

```javascript
useEffect(() => {
  const subscription = supabase
    .from('cmms_company_reports')
    .on('*', payload => {
      console.log('Report change:', payload);
      loadReports(); // Refresh
    })
    .subscribe();

  return () => subscription.unsubscribe();
}, []);
```

### 4. Performance Optimization
- RLS policies run on every query
- For large datasets (1000+ reports), consider:
  - Pagination: Load 50 at a time
  - Filtering before query: Status, date range
  - Caching: Store in local state

```javascript
const [page, setPage] = useState(1);
const pageSize = 50;

const loadReports = async () => {
  const result = await getFilteredReports(companyId);
  const paginated = result.data.slice(
    (page - 1) * pageSize,
    page * pageSize
  );
  setReports(paginated);
};
```

---

## 🐛 Troubleshooting

### Issue: "You are not a member of this CMMS company"
**Solution:** Ensure user record exists in `cmms_users` table with:
- `cmms_company_id` = current company
- `is_active` = true
- `email` matches auth user email

### Issue: User cannot see department reports
**Solution:** Verify:
- User role is `coordinator`, `supervisor`, or `admin`
- `department_id` is set in `cmms_users`
- Report's `department_id` matches user's `department_id`

### Issue: Cannot update/delete reports
**Solution:** Check:
- User is report creator OR admin
- User role exists in database
- `reporter_cmms_user_id` is correctly set

### Issue: RLS Policy Error in Supabase
**Solution:**
1. Go to Supabase Dashboard → Auth → Users
2. Verify user is in `auth.users` table
3. Check `cmms_users` record has `LOWER(email)` matching auth email
4. Run test query:
```sql
SELECT * FROM auth.users WHERE email = 'user@example.com';
SELECT * FROM cmms_users WHERE LOWER(email) = 'user@example.com';
```

### Issue: Performance is slow with many reports
**Solution:**
1. Check query plan: Click report query in Supabase
2. Ensure indexes are created:
```sql
SELECT * FROM pg_indexes 
WHERE tablename = 'cmms_company_reports';
```
3. Add indexes if missing:
```sql
CREATE INDEX IF NOT EXISTS idx_cmms_reports_visibility 
ON public.cmms_company_reports(visibility_level, department_id, reporter_cmms_user_id);
```

---

## 🚀 Advanced Features (Optional)

### 1. Report Approval Workflow
```javascript
// Future: Require supervisor approval before publishing
const submitReportForApproval = async (reportId) => {
  await updateReportStatus(reportId, 'pending_approval');
  // Notify supervisor
};
```

### 2. Report Analytics
```javascript
// Get stats for dashboard
const stats = await getDepartmentReportStats(companyId, departmentId);
// Shows: total, open, critical counts, avg resolution time
```

### 3. Bulk Operations
```javascript
// Close all open reports in department
const closeAllOpen = async (reports) => {
  for (const report of reports.filter(r => r.status === 'open')) {
    await updateReportStatus(report.id, 'closed', 'Batch close');
  }
};
```

### 4. Export Reports
```javascript
// Export accessible reports to CSV/JSON
import { exportReports } from '../services/cmmsReportAccessService';
const csv = exportReports(reports, 'csv');
```

---

## ✅ Deployment Checklist

- [ ] Deploy SQL schema to Supabase
- [ ] Verify all functions created successfully
- [ ] Check RLS policies are enabled on table
- [ ] Create service layer file (cmmsReportAccessService.js)
- [ ] Import service in CMSSModule component
- [ ] Update report submission handler
- [ ] Update report list rendering
- [ ] Add access level badges
- [ ] Test as regular user
- [ ] Test as supervisor
- [ ] Test as admin
- [ ] Test permission denial
- [ ] Verify database indexes
- [ ] Monitor performance
- [ ] Document any customizations
- [ ] Communicate changes to users

---

## 📞 Support & Questions

For issues or questions:
1. Check troubleshooting section above
2. Review SQL error messages in Supabase
3. Check browser console for service errors
4. Verify all database tables exist
5. Confirm user roles are correctly assigned

---

## 📝 Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | May 28, 2026 | Initial implementation with 4 access levels |
| 1.1 | (Future) | Add report approval workflow |
| 1.2 | (Future) | Add real-time subscriptions |
| 1.3 | (Future) | Add advanced reporting analytics |

---

## 🎓 Architecture Diagram

```
User Login
    ↓
Get cmms_users record (role, department_id)
    ↓
Request reports via fn_get_filtered_reports()
    ↓
RLS Policy evaluates:
    ├─ Is user authenticated? ✓
    ├─ Is user in company? ✓
    └─ What can they access?
        ├─ Admin → All reports
        ├─ Supervisor/Coordinator → Department reports
        └─ Regular → Personal reports
    ↓
Returns only accessible reports
    ↓
Frontend displays with badges:
    ├─ 👤 Admin Access
    ├─ 👥 Department Access
    └─ 🔒 Personal Access
    ↓
User interacts (view/edit/delete) with access checks
```

---

**End of Documentation**
