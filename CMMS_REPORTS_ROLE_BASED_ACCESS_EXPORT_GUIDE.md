# CMMS Reports - Role-Based Access & Export Implementation Guide

## Overview

This implementation provides:
- ✅ **Role-based access control** for CMMS reports
- ✅ **Report export** to PDF and DOCX formats
- ✅ **Departmental filtering** for coordinators/supervisors
- ✅ **Batch export** for multiple reports

---

## Role-Based Access Control

### Access Levels

| Role | Can View | Can Export |
|------|----------|-----------|
| **Admin** | All company reports | ✅ Yes |
| **Finance** | All company reports | ✅ Yes |
| **Coordinator/Supervisor** | Their department + own reports | ✅ Yes |
| **Member** | Only their own reports | ✅ Yes |

### Backend Functions (SQL)

1. **RLP Policy**: `cmms_company_reports_select_policy`
   - Enforces row-level security based on user role

2. **RPC Functions**:
   - `fn_get_company_reports(p_company_id)` - Get reports with role filtering
   - `fn_get_company_reports_filtered(p_company_id, p_department_id, p_status, p_category)` - Advanced filtering
   - `fn_get_department_reports(p_company_id, p_department_id)` - Department-specific reports
   - `fn_export_report(p_report_id)` - Fetch report data for export
   - `fn_get_departments_by_company(p_company_id)` - Get all departments

### Deployment Steps

1. **Run SQL files in Supabase (in order)**:
   ```sql
   -- First: Fix RLS policies
   -- Upload: backend/FIX_CMMS_REPORTS_RLS_POLICIES.sql
   
   -- Second: Create missing RPC functions
   -- Upload: backend/CREATE_MISSING_CMMS_RPC_FUNCTIONS.sql
   ```

2. **Install npm packages**:
   ```bash
   cd ICAN
   npm install
   # or
   npm install jspdf docx file-saver
   ```

---

## Frontend Implementation

### Service Functions

All functions are in `frontend/src/lib/supabase/services/cmmsService.js`:

```javascript
// Fetch reports
getCompanyReports(companyId)
getCompanyReportsFiltered(companyId, filters)
getDepartmentReports(companyId, departmentId)

// Export functions
exportReport(reportId) // Fetch report for export
exportReportToPDF(report) // Export single report to PDF
exportReportToDOCX(report) // Export single report to DOCX
exportReportsToPDF(reports, title) // Export multiple reports to PDF
exportReportsToDOCX(reports, title) // Export multiple reports to DOCX
```

### UI Components

Location: `frontend/src/components/CMMS/ReportExportButtons.jsx`

#### 1. Single Report Export
```jsx
import { ReportExportButtons } from '@/components/CMMS/ReportExportButtons';

export function ReportDetailsView({ report }) {
  return (
    <div>
      <h1>{report.title}</h1>
      <p>{report.body}</p>
      
      {/* Add export buttons */}
      <ReportExportButtons report={report} />
    </div>
  );
}
```

#### 2. Batch Export (Multiple Reports)
```jsx
import { BatchReportExportButtons } from '@/components/CMMS/ReportExportButtons';

export function ReportsListView({ reports }) {
  return (
    <div>
      {/* Show export buttons for all reports */}
      <BatchReportExportButtons 
        reports={reports} 
        isLoading={false} 
      />
      
      {/* List reports */}
      {reports.map(report => (
        <div key={report.id}>{report.title}</div>
      ))}
    </div>
  );
}
```

#### 3. Export Menu (Dropdown)
```jsx
import { ReportExportMenu } from '@/components/CMMS/ReportExportButtons';

export function ReportActionMenu({ report, isOpen, onClose }) {
  if (!isOpen) return null;
  
  return (
    <ReportExportMenu 
      report={report} 
      onClose={onClose} 
    />
  );
}
```

---

## Integration with Existing Code

### Update CMSSModule.jsx

Add export buttons to report display:

```jsx
// In your report details/list view
import { ReportExportButtons, BatchReportExportButtons } from '@/components/CMMS/ReportExportButtons';

// For single report
<ReportExportButtons report={selectedReport} />

// For multiple reports
<BatchReportExportButtons reports={filteredReports} />
```

### Update cmmsService calls

Use the role-based functions:

```javascript
// Fetch reports - automatically filtered by role
const { data: reports } = await cmmsService.getCompanyReports(companyId);

// Fetch department reports (for coordinators)
const { data: deptReports } = await cmmsService.getDepartmentReports(
  companyId, 
  departmentId
);

// Export a report
const { data: reportForExport } = await cmmsService.exportReport(reportId);
const { success } = await cmmsService.exportReportToPDF(reportForExport);
```

---

## Export Features

### PDF Export
- Professional formatting with colors and fonts
- Metadata table with report details
- Multi-page support with automatic page breaks
- Page numbers and footers
- Filename: `Report_[ID]_[DATE].pdf`

### Word (DOCX) Export
- Professional document structure
- Metadata table with shading
- Proper heading hierarchy
- Multiple reports combined in single document
- Filename: `Report_[ID]_[DATE].docx`

### Batch Export
- Combine multiple reports in one file
- Title page with report count
- Professional formatting across all reports
- Filename: `Reports_[DATE].pdf` or `.docx`

---

## Error Handling

### Common Issues

1. **"Function not found" error**
   - ✅ Run `CREATE_MISSING_CMMS_RPC_FUNCTIONS.sql`

2. **"Permission denied" error**
   - ✅ Run `FIX_CMMS_REPORTS_RLS_POLICIES.sql`

3. **"npm packages not found"**
   - ✅ Run: `npm install jspdf docx file-saver`

4. **Export button not working**
   - ✅ Check report has `id` and `body` fields
   - ✅ Verify user has access to report

### Debug Mode

Enable console logging:
```javascript
// In cmmsService.js exports
console.log('Fetching reports for company:', companyId);
console.log('Exporting report:', report.id);
```

---

## Testing Workflow

1. **Test Role-Based Access**:
   ```javascript
   // Login as different roles and fetch reports
   // Admin/Finance: should see all reports
   // Coordinator: should see department + own reports
   // Member: should see only own reports
   ```

2. **Test Export Functions**:
   ```javascript
   // Single report export
   const report = { id: '123', title: 'Test', body: 'Test body' };
   await cmmsService.exportReportToPDF(report);
   
   // Batch export
   const reports = [...];
   await cmmsService.exportReportsToDOCX(reports, 'My Reports');
   ```

3. **Test File Downloads**:
   - Check browser downloads folder
   - Verify PDF/DOCX files open correctly
   - Check formatting and content

---

## Performance Considerations

- **Report fetching**: Optimized with RPC functions (faster than direct table query)
- **Export generation**: Done client-side (no server load)
- **Batch exports**: Limited to 100+ reports per file (adjust in code if needed)
- **Caching**: Reports are cached once fetched

---

## Security Features

✅ **Row-Level Security (RLS)**
- All report access goes through RLS policies
- Users can only access reports they should see

✅ **Role-Based Authorization**
- Server validates user role before allowing access
- Export functions verify user company membership

✅ **Data Export Control**
- Only authenticated users can export
- Export data matches their access level

---

## Future Enhancements

- [ ] Email reports directly
- [ ] Schedule automatic exports
- [ ] Custom templates for exports
- [ ] Signature fields in exported documents
- [ ] Multi-language export support
- [ ] Excel export format
- [ ] Report signing/approval workflow

---

## Support & Troubleshooting

If export buttons don't appear:
1. ✅ Verify components are imported correctly
2. ✅ Check browser console for errors
3. ✅ Run npm install again
4. ✅ Clear browser cache

If reports not showing:
1. ✅ Run `FIX_CMMS_REPORTS_RLS_POLICIES.sql`
2. ✅ Run `CREATE_MISSING_CMMS_RPC_FUNCTIONS.sql`
3. ✅ Check user role assignment in cmms_users table
4. ✅ Verify company membership

---

## Files Created/Modified

### New Files
- `backend/FIX_CMMS_REPORTS_RLS_POLICIES.sql` - Fixed RLS policies
- `backend/CREATE_MISSING_CMMS_RPC_FUNCTIONS.sql` - Missing RPC functions
- `frontend/src/lib/export/reportExport.js` - Export module
- `frontend/src/components/CMMS/ReportExportButtons.jsx` - UI components

### Modified Files
- `frontend/src/lib/supabase/services/cmmsService.js` - Added export functions
- `package.json` - Added dependencies (jspdf, docx, file-saver)

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Run SQL files in Supabase (in order)
# - FIX_CMMS_REPORTS_RLS_POLICIES.sql
# - CREATE_MISSING_CMMS_RPC_FUNCTIONS.sql

# 3. Import components in your UI
import { ReportExportButtons } from '@/components/CMMS/ReportExportButtons';

# 4. Use the component
<ReportExportButtons report={report} />

# 5. Test by downloading a report
```

---

**Status**: ✅ Complete and Ready for Production
