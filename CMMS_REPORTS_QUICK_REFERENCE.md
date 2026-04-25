# CMMS Reports - Quick Reference Guide

## Quick Start (5 Minutes)

### 1. Install Packages
```bash
npm install docx jspdf jszip
```

### 2. Deploy SQL
Copy and run `backend/FIX_CMMS_REPORTS_RLS_POLICIES.sql` in Supabase SQL Editor

### 3. Add Component to Page
```jsx
import CMSSReportsView from '@/components/CMMS/CMSSReportsView';

export default function ReportsPage() {
  const { companyId, userRole, userDepartmentId } = useYourAuthHook();

  return (
    <CMSSReportsView
      companyId={companyId}
      userRole={userRole}
      userDepartmentId={userDepartmentId}
    />
  );
}
```

---

## Common Tasks

### Fetch Reports for Current User
```javascript
import { getCompanyReports } from '@/lib/supabase/services/cmmsService';

const { data, error } = await getCompanyReports(companyId);
```

### Fetch Reports with Filters
```javascript
import { getCompanyReportsFiltered } from '@/lib/supabase/services/cmmsService';

const { data, error } = await getCompanyReportsFiltered(companyId, {
  status: 'open',
  category: 'maintenance',
  department_id: null // admin/finance only
});
```

### Export Report to PDF
```javascript
import { exportReport } from '@/lib/supabase/services/cmmsService';
import { exportReportAsPDF } from '@/lib/utils/reportExport';

const { data: report, error } = await exportReport(reportId);
if (!error) {
  await exportReportAsPDF(report, 'my-report');
}
```

### Export to Word
```javascript
import { exportReportAsWord } from '@/lib/utils/reportExport';

await exportReportAsWord(report, 'my-report');
// Downloads as: my-report.docx
```

### Export Multiple Reports
```javascript
import { exportMultipleReports } from '@/lib/utils/reportExport';

await exportMultipleReports(reportsArray, 'pdf', 'all-reports');
// Downloads as: all-reports.zip with individual PDFs
```

---

## User Roles & Permissions

### Role: Admin
```
Can See:     All company reports
Can Filter:  By department, status, category
Can Export:  All reports
Can Edit:    All reports
```

### Role: Finance
```
Can See:     All company reports
Can Filter:  By department, status, category
Can Export:  All reports
Can Edit:    Limited (status, notes)
```

### Role: Coordinator/Supervisor
```
Can See:     Department reports + own reports
Can Filter:  Own department only
Can Export:  Visible reports
Can Edit:    Own reports
```

### Role: Member
```
Can See:     Own reports only
Can Filter:  N/A
Can Export:  Own reports
Can Edit:    Own reports
```

---

## Report Status Workflow

```
open
 └─ in_review (assign to someone)
     └─ resolved (mark as resolved)
         └─ closed (archive)
```

---

## Report Severity Levels

| Level | Color | Priority |
|-------|-------|----------|
| Critical | Red | Immediate action |
| High | Orange | Urgent |
| Medium | Yellow | Soon |
| Low | Green | As available |

---

## API Quick Reference

### Service Functions (Frontend)

```javascript
// Get reports based on user role
getCompanyReports(companyId)

// Get reports with advanced filters
getCompanyReportsFiltered(companyId, { status, category, department_id })

// Get specific department reports
getDepartmentReports(companyId, departmentId)

// Get single report for export
exportReport(reportId)
```

### RPC Functions (Backend)

```sql
-- Main function - role-based access
SELECT * FROM fn_get_company_reports('company-id');

-- Filtered queries
SELECT * FROM fn_get_company_reports_filtered(
  'company-id', 'dept-id', 'open', 'maintenance'
);

-- Department specific
SELECT * FROM fn_get_department_reports('company-id', 'dept-id');

-- Export format
SELECT * FROM fn_export_report('report-id');
```

---

## Export Utilities

```javascript
// Export to Word (.docx)
exportReportAsWord(report, filename)

// Export to PDF (.pdf)
exportReportAsPDF(report, filename)

// Export to Plain Text (.txt)
exportReportAsText(report, filename)

// Batch export to ZIP
exportMultipleReports(reports, format, zipname)

// Format text for manual export
formatReportText(report)
```

---

## Component Props

```jsx
<CMSSReportsView
  companyId="uuid"           // Required: Company ID
  userRole="admin"           // Required: User role
  userDepartmentId="uuid"    // Optional: Department ID for coordinators
/>
```

---

## Database Schema

### cmms_company_reports Table

```sql
CREATE TABLE cmms_company_reports (
  id UUID,                    -- Primary key
  cmms_company_id UUID,       -- Company reference
  department_id UUID,         -- Department reference
  report_title TEXT,          -- Report title
  report_category VARCHAR,    -- Category
  severity VARCHAR,           -- low/medium/high/critical
  report_body TEXT,           -- Full report content
  reporter_cmms_user_id UUID, -- Author ID
  reporter_name VARCHAR,      -- Author name
  reporter_email VARCHAR,     -- Author email
  reporter_role VARCHAR,      -- Author role
  status VARCHAR,             -- open/in_review/resolved/closed
  resolution_notes TEXT,      -- Resolution details
  resolved_at TIMESTAMPTZ,    -- Resolution date
  created_at TIMESTAMPTZ,     -- Creation date
  updated_at TIMESTAMPTZ      -- Last update date
);
```

---

## Error Messages & Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| "permission denied for table" | RLS not enabled/wrong policy | Run SQL script to fix |
| "Your role is not allowed" | Role not in allowed list | Update user role in DB |
| "You are not a member" | User not in cmms_users | Add user to company |
| "Not authenticated" | No auth token | Check Supabase auth |
| "Report not found" | Invalid report ID or access denied | Verify ID and permissions |

---

## File Reference

| File | Purpose |
|------|---------|
| FIX_CMMS_REPORTS_RLS_POLICIES.sql | Database schema & RLS |
| cmmsService.js | Supabase service calls |
| reportExport.js | Export utility functions |
| CMSSReportsView.jsx | React component |
| CMMS_REPORTS_IMPLEMENTATION_GUIDE.md | Detailed documentation |
| CMMS_REPORTS_SUMMARY.md | Complete overview |

---

## Testing Queries

### Check User Access
```sql
SELECT role, department_id, is_active 
FROM cmms_users 
WHERE email = 'user@example.com' 
  AND cmms_company_id = 'company-id';
```

### Check Reports in Company
```sql
SELECT id, report_title, status, severity, department_id
FROM cmms_company_reports 
WHERE cmms_company_id = 'company-id'
ORDER BY created_at DESC;
```

### Test RLS Policy
```sql
SET jwt.claims.sub = 'auth-user-id';
SELECT id, report_title 
FROM cmms_company_reports 
WHERE cmms_company_id = 'company-id';
```

---

## Performance Tips

1. **Use Filtered Queries** - More specific queries = faster results
2. **Limit Results** - Use pagination for large datasets
3. **Index Queries** - Database has indexes on frequently queried columns
4. **Cache Results** - Store in React state/context to avoid re-fetching
5. **Async Loading** - Show loading indicators while fetching

---

## Deployment Checklist

- [ ] SQL schema deployed to production
- [ ] NPM packages installed
- [ ] Component integrated into routing
- [ ] Props passed correctly
- [ ] Environment variables set
- [ ] Error handling tested
- [ ] Access control verified for each role
- [ ] Export functionality tested
- [ ] Performance tested with large datasets
- [ ] Mobile responsiveness verified

---

## Common Issues & Quick Fixes

### Reports Not Loading
1. Check network tab for RPC errors
2. Verify user is in cmms_users table
3. Verify user's company matches company_id parameter
4. Check browser console for errors

### Export Button Not Working
1. Install packages: `npm install docx jspdf jszip`
2. Check report data is fetching
3. Verify report object has all required fields
4. Check browser console for errors

### Access Denied for Coordinator
1. Verify user role = 'coordinator'
2. Check department_id is set
3. Verify reports have matching department_id
4. Test with admin account first

### Filtering Not Working
1. Ensure you're using `getCompanyReportsFiltered()`
2. Verify filter values are correct
3. Check that reports match filter criteria
4. Try without filters first

---

## Support Links

- Supabase Docs: https://supabase.com/docs
- React Hooks: https://react.dev/reference/react/hooks
- RLS Policy Docs: https://supabase.com/docs/guides/auth/row-level-security
- jsPDF: https://github.com/parallax/jsPDF
- docx: https://github.com/dolanmiu/docx

---

## Next Steps

1. ✅ Run setup script: `bash setup-cmms-reports.sh`
2. ✅ Deploy SQL to production
3. ✅ Add component to your app
4. ✅ Test all user roles
5. ✅ Test export functionality
6. ✅ Deploy to staging
7. ✅ Final acceptance testing
8. ✅ Deploy to production

---

**Ready to go? Start with the implementation guide!** 🚀
