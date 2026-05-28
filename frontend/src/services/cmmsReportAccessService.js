/**
 * CMMS Report Access Control Service
 * Handles role-based report filtering and access management
 * 
 * Access Levels:
 * - Admin: Full access to all company reports
 * - Coordinator/Supervisor: Department-level access only
 * - Regular Users: Can only see their own reports
 */

import { supabase } from '../lib/supabase/client';

// ============================================================
// 1. GET FILTERED REPORTS (Based on user role)
// ============================================================

export const getFilteredReports = async (companyId) => {
  try {
    const { data, error } = await supabase
      .rpc('fn_get_filtered_reports', {
        p_company_id: companyId
      });

    if (error) {
      console.error('Error fetching filtered reports:', error);
      return {
        success: false,
        error: error.message,
        data: null
      };
    }

    return {
      success: true,
      data: data || [],
      stats: {
        totalReports: data?.length || 0,
        ownReports: data?.filter(r => r.is_own_report)?.length || 0,
        departmentReports: data?.filter(r => r.access_level === 'department_access')?.length || 0
      }
    };
  } catch (error) {
    console.error('Service error:', error);
    return {
      success: false,
      error: error.message,
      data: null
    };
  }
};

// ============================================================
// 2. CREATE REPORT WITH VISIBILITY CONTROL
// ============================================================

export const createFilteredReport = async (companyId, reportData) => {
  try {
    const {
      reportTitle,
      reportCategory = 'general',
      severity = 'medium',
      reportBody = '',
      departmentId = null,
      visibilityLevel = 'department'
    } = reportData;

    const { data, error } = await supabase
      .rpc('fn_create_filtered_report', {
        p_company_id: companyId,
        p_report_title: reportTitle,
        p_report_category: reportCategory,
        p_severity: severity,
        p_report_body: reportBody,
        p_department_id: departmentId,
        p_visibility_level: visibilityLevel
      });

    if (error) {
      console.error('Error creating report:', error);
      return {
        success: false,
        error: error.message,
        data: null
      };
    }

    return {
      success: true,
      data: data,
      message: `Report created with ${visibilityLevel} visibility`
    };
  } catch (error) {
    console.error('Service error:', error);
    return {
      success: false,
      error: error.message,
      data: null
    };
  }
};

// ============================================================
// 3. CHECK REPORT ACCESS (Helper function)
// ============================================================

export const checkReportAccess = async (reportId, companyId) => {
  try {
    const { data, error } = await supabase
      .rpc('fn_check_report_access', {
        p_report_id: reportId,
        p_company_id: companyId
      });

    if (error) {
      console.error('Error checking access:', error);
      return {
        hasAccess: false,
        canEdit: false,
        canDelete: false,
        accessLevel: 'no_access'
      };
    }

    return data?.[0] || {
      hasAccess: false,
      canEdit: false,
      canDelete: false,
      accessLevel: 'no_access'
    };
  } catch (error) {
    console.error('Service error:', error);
    return {
      hasAccess: false,
      canEdit: false,
      canDelete: false,
      accessLevel: 'no_access'
    };
  }
};

// ============================================================
// 4. UPDATE REPORT STATUS (Only by reporter or admin)
// ============================================================

export const updateReportStatus = async (reportId, newStatus, resolutionNotes = '') => {
  try {
    // First check access
    const access = await checkReportAccess(reportId, companyId);
    if (!access.canEdit) {
      return {
        success: false,
        error: 'You do not have permission to edit this report',
        data: null
      };
    }

    const updateData = {
      status: newStatus,
      updated_at: new Date().toISOString()
    };

    if (resolutionNotes) {
      updateData.resolution_notes = resolutionNotes;
      updateData.resolved_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('cmms_company_reports')
      .update(updateData)
      .eq('id', reportId)
      .select()
      .single();

    if (error) {
      console.error('Error updating report:', error);
      return {
        success: false,
        error: error.message,
        data: null
      };
    }

    return {
      success: true,
      data: data,
      message: `Report status updated to ${newStatus}`
    };
  } catch (error) {
    console.error('Service error:', error);
    return {
      success: false,
      error: error.message,
      data: null
    };
  }
};

// ============================================================
// 5. DELETE REPORT (Only by reporter or admin)
// ============================================================

export const deleteReport = async (reportId, companyId) => {
  try {
    // First check access
    const access = await checkReportAccess(reportId, companyId);
    if (!access.canDelete) {
      return {
        success: false,
        error: 'You do not have permission to delete this report',
        data: null
      };
    }

    const { error } = await supabase
      .from('cmms_company_reports')
      .delete()
      .eq('id', reportId);

    if (error) {
      console.error('Error deleting report:', error);
      return {
        success: false,
        error: error.message,
        data: null
      };
    }

    return {
      success: true,
      message: 'Report deleted successfully'
    };
  } catch (error) {
    console.error('Service error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// ============================================================
// 6. GET DEPARTMENT REPORT STATISTICS (For Supervisors)
// ============================================================

export const getDepartmentReportStats = async (companyId, departmentId) => {
  try {
    const { data, error } = await supabase
      .rpc('fn_get_department_report_stats', {
        p_company_id: companyId,
        p_department_id: departmentId
      });

    if (error) {
      console.error('Error fetching stats:', error);
      return {
        success: false,
        error: error.message,
        data: null
      };
    }

    return {
      success: true,
      data: data?.[0] || {
        total_reports: 0,
        open_reports: 0,
        critical_reports: 0,
        high_severity: 0,
        average_resolution_time: null
      }
    };
  } catch (error) {
    console.error('Service error:', error);
    return {
      success: false,
      error: error.message,
      data: null
    };
  }
};

// ============================================================
// 7. FILTER REPORTS BY STATUS
// ============================================================

export const filterReportsByStatus = async (reports, status) => {
  if (!reports) return [];
  return reports.filter(r => r.status === status);
};

// ============================================================
// 8. FILTER REPORTS BY SEVERITY
// ============================================================

export const filterReportsBySeverity = async (reports, severity) => {
  if (!reports) return [];
  const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
  return reports.filter(r => severityOrder[r.severity] >= severityOrder[severity]);
};

// ============================================================
// 9. SORT REPORTS
// ============================================================

export const sortReports = (reports, sortBy = 'created_at', order = 'desc') => {
  if (!reports) return [];
  const sorted = [...reports];
  
  sorted.sort((a, b) => {
    let aVal = a[sortBy];
    let bVal = b[sortBy];

    if (sortBy === 'created_at' || sortBy === 'updated_at') {
      aVal = new Date(aVal).getTime();
      bVal = new Date(bVal).getTime();
    }

    if (order === 'desc') {
      return bVal > aVal ? 1 : -1;
    } else {
      return aVal > bVal ? 1 : -1;
    }
  });

  return sorted;
};

// ============================================================
// 10. GROUP REPORTS BY CATEGORY
// ============================================================

export const groupReportsByCategory = (reports) => {
  if (!reports) return {};
  
  return reports.reduce((acc, report) => {
    const category = report.report_category || 'uncategorized';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(report);
    return acc;
  }, {});
};

// ============================================================
// 11. GET USER ACCESS LEVEL
// ============================================================

export const getUserReportAccessLevel = (userRole) => {
  const levelMap = {
    admin: {
      level: 'admin_full_access',
      canViewAll: true,
      canViewDepartment: true,
      canViewOwn: true,
      displayName: 'Admin - Full Access'
    },
    coordinator: {
      level: 'department_access',
      canViewAll: false,
      canViewDepartment: true,
      canViewOwn: true,
      displayName: 'Coordinator - Department Access'
    },
    supervisor: {
      level: 'department_access',
      canViewAll: false,
      canViewDepartment: true,
      canViewOwn: true,
      displayName: 'Supervisor - Department Access'
    },
    technician: {
      level: 'personal_access',
      canViewAll: false,
      canViewDepartment: false,
      canViewOwn: true,
      displayName: 'Technician - Personal Reports Only'
    },
    finance: {
      level: 'personal_access',
      canViewAll: false,
      canViewDepartment: false,
      canViewOwn: true,
      displayName: 'Finance - Personal Reports Only'
    }
  };

  return levelMap[userRole] || {
    level: 'personal_access',
    canViewAll: false,
    canViewDepartment: false,
    canViewOwn: true,
    displayName: 'Personal Reports Only'
  };
};

// ============================================================
// 12. EXPORT REPORTS (with access filtering)
// ============================================================

export const exportReports = (reports, format = 'csv') => {
  if (!reports || reports.length === 0) {
    return {
      success: false,
      error: 'No reports to export'
    };
  }

  try {
    if (format === 'csv') {
      const headers = [
        'Title',
        'Category',
        'Severity',
        'Status',
        'Reporter',
        'Department',
        'Created Date',
        'Access Level'
      ];
      
      const rows = reports.map(r => [
        r.report_title,
        r.report_category,
        r.severity,
        r.status,
        r.reporter_name,
        r.department_id || 'N/A',
        new Date(r.created_at).toLocaleDateString(),
        r.access_level
      ]);

      const csv = [headers, ...rows]
        .map(row => row.map(cell => `"${cell}"`).join(','))
        .join('\n');

      return {
        success: true,
        data: csv,
        filename: `reports-${new Date().toISOString().split('T')[0]}.csv`
      };
    }

    if (format === 'json') {
      return {
        success: true,
        data: JSON.stringify(reports, null, 2),
        filename: `reports-${new Date().toISOString().split('T')[0]}.json`
      };
    }

    return {
      success: false,
      error: 'Unsupported export format'
    };
  } catch (error) {
    console.error('Export error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

export default {
  getFilteredReports,
  createFilteredReport,
  checkReportAccess,
  updateReportStatus,
  deleteReport,
  getDepartmentReportStats,
  filterReportsByStatus,
  filterReportsBySeverity,
  sortReports,
  groupReportsByCategory,
  getUserReportAccessLevel,
  exportReports
};
