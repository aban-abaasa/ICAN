# CMMS Reports Implementation Guide

## Overview
This implementation provides role-based report access and PDF/Word export functionality for CMMS reports.

### Features
- **Role-Based Access Control**
  - **Admin/Finance**: View all company reports
  - **Coordinator/Supervisor**: View departmental reports + own reports
  - **Members**: View own reports only

- **Report Filtering**
  - Filter by Status (open, in_review, resolved, closed)
  - Filter by Category (general, maintenance, safety, compliance, incident, other)
  - Filter by Department (for admin/finance)

- **Export Formats**
  - PDF (.pdf)
  - Word (.docx)
  - Plain Text (.txt)

- **Sorting Options**
  - Created Date (newest/oldest)
  - Updated Date
  - Severity Level
  - Report Title

## Installation

### 1. Install Required NPM Packages

```bash
npm install docx jspdf jszip
```

**Package Details:**
- `docx` - For generating Word documents (.docx)
- `jspdf` - For generating PDF documents
- `jszip` - For creating ZIP archives of multiple exports

### 2. Deploy SQL Schema

Run the SQL fix file in your Supabase project:

```sql
-- Copy contents of: FIX_CMMS_REPORTS_RLS_POLICIES.sql
-- Navigate to SQL Editor in Supabase Dashboard
-- Execute the entire script
```

This creates/updates:
- Updated RLS SELECT policy with role-based access
- `fn_get_company_reports()` - Main report fetching with role filtering
- `fn_get_company_reports_filtered()` - Filtered report fetching
- `fn_get_department_reports()` - Department-specific reports
- `fn_export_report()` - Report export preparation

### 3. Update Frontend Services

The file `frontend/src/lib/supabase/services/cmmsService.js` has been updated with:
- `getCompanyReports(companyId)` - Fetch reports with role-based access
- `getCompanyReportsFiltered(companyId, filters)` - Fetch with filters
- `getDepartmentReports(companyId, departmentId)` - Department reports
- `exportReport(reportId)` - Get report data for export

### 4. Add Export Utility

The file `frontend/src/lib/utils/reportExport.js` provides:
- `exportReportAsWord(report, filename)` - Export to DOCX
- `exportReportAsPDF(report, filename)` - Export to PDF
- `exportReportAsText(report, filename)` - Export to TXT
- `exportMultipleReports(reports, format, zipFilename)` - Batch export

## Component Usage

### Import the Component

```jsx
import CMSSReportsView from '@/components/CMMS/CMSSReportsView';
```

### Basic Implementation

```jsx
function ReportsPage() {
  const { companyId, userRole, userDepartmentId } = useAuth();

  return (
    <CMSSReportsView
      companyId={companyId}
      userRole={userRole}
      userDepartmentId={userDepartmentId}
    />
  );
}
```

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `companyId` | UUID | Yes | The CMMS company ID |
| `userRole` | string | Yes | User's role: 'admin', 'finance', 'coordinator', 'supervisor', 'member' |
| `userDepartmentId` | UUID | No | User's department ID (required for coordinator/supervisor) |

## Database Schema

### RLS Policy Logic

```
SELECT Access Rules:
├─ ADMIN or FINANCE: All reports
├─ COORDINATOR or SUPERVISOR: 
│  ├─ Reports from their department
│  └─ Their own reports
└─ MEMBER: Only their own reports

INSERT/UPDATE Access Rules:
├─ Any authenticated user can create/update reports for their company
└─ Users can modify their own reports
```

### Table: cmms_company_reports

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `cmms_company_id` | UUID | Company reference |
| `department_id` | UUID | Department reference (optional) |
| `report_title` | TEXT | Report title |
| `report_category` | VARCHAR | Category of report |
| `severity` | VARCHAR | Low, Medium, High, Critical |
| `report_body` | TEXT | Full report content |
| `reporter_cmms_user_id` | UUID | Author reference |
| `reporter_name` | VARCHAR | Author name |
| `reporter_email` | VARCHAR | Author email |
| `reporter_role` | VARCHAR | Author's role |
| `status` | VARCHAR | Open, In Review, Resolved, Closed |
| `resolution_notes` | TEXT | Resolution details |
| `resolved_at` | TIMESTAMPTZ | Resolution timestamp |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

## API Endpoints

### RPC Functions

#### fn_get_company_reports(p_company_id UUID)
Fetches reports based on user's role and department.

```javascript
const { data, error } = await supabase.rpc('fn_get_company_reports', {
  p_company_id: companyId
});
```

#### fn_get_company_reports_filtered(p_company_id, p_department_id, p_status, p_category)
Fetches filtered reports.

```javascript
const { data, error } = await supabase.rpc('fn_get_company_reports_filtered', {
  p_company_id: companyId,
  p_department_id: departmentId,
  p_status: 'open',
  p_category: 'maintenance'
});
```

#### fn_get_department_reports(p_company_id, p_department_id)
Fetches all reports for a specific department.

```javascript
const { data, error } = await supabase.rpc('fn_get_department_reports', {
  p_company_id: companyId,
  p_department_id: departmentId
});
```

#### fn_export_report(p_report_id UUID)
Formats report data for export (PDF, Word, etc.).

```javascript
const { data, error } = await supabase.rpc('fn_export_report', {
  p_report_id: reportId
});
```

## Troubleshooting

### Permission Denied Errors

**Error**: `permission denied for table cmms_company_reports`

**Solution**: 
1. Verify RLS policies are enabled: `ALTER TABLE public.cmms_company_reports ENABLE ROW LEVEL SECURITY;`
2. Check that user exists in `cmms_users` table with correct company ID
3. Verify email match between `auth.users` and `cmms_users`
4. Check `is_active` flag is TRUE

### RPC Function Returns No Results

**Error**: Function runs but returns empty array

**Solution**:
1. Verify user has correct role in `cmms_users.role`
2. For coordinators/supervisors, check `cmms_users.department_id` is set
3. Verify report exists in correct company (for admins)
4. Check report belongs to user's department (for coordinators)

### Export Not Working

**Error**: PDF/Word export fails

**Solution**:
1. Install required packages: `npm install docx jspdf jszip`
2. Check browser console for errors
3. Ensure report data is being fetched correctly
4. Verify `jsPDF` and `docx` are properly imported

## Security Considerations

1. **Row Level Security (RLS)**: All data access is controlled via RLS policies
2. **Role-Based Access**: Different roles see different reports
3. **Department Isolation**: Coordinators/supervisors can only see their department
4. **Audit Trail**: All report access is logged via created_at/updated_at
5. **Service Definer Functions**: RPC functions use SECURITY DEFINER for safe operations

## Performance Optimization

1. **Indexes**: Query performance optimized with indexes on:
   - `cmms_company_id`
   - `created_at`
   - `status`
   - `report_category`

2. **Caching**: Component uses React hooks to minimize re-fetches

3. **Pagination**: Consider implementing pagination for large datasets

## Future Enhancements

1. **Advanced Filtering**
   - Date range filters
   - Full-text search
   - Multiple department selection

2. **Bulk Operations**
   - Bulk status updates
   - Bulk export to CSV/Excel
   - Batch email notifications

3. **Analytics**
   - Report statistics dashboard
   - Severity trends
   - Resolution time metrics

4. **Notifications**
   - Email notifications on report creation
   - Status change notifications
   - Department report summaries

5. **Comments/Collaboration**
   - Add comments to reports
   - Mention team members
   - Activity timeline

## Support

For issues or questions:
1. Check the Troubleshooting section
2. Review the component props and API endpoints
3. Verify database schema matches the SQL file
4. Check browser console for detailed error messages
