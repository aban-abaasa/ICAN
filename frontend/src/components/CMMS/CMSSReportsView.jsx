/**
 * CMMS Reports Component
 * Displays company reports with role-based access control
 * Supports filtering, sorting, and exporting
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  getCompanyReports,
  getCompanyReportsFiltered,
  getDepartmentReports,
  exportReport
} from '@/lib/supabase/services/cmmsService';
import {
  exportReportAsWord,
  exportReportAsPDF,
  exportReportAsText
} from '@/lib/utils/reportExport';

const CMSSReportsView = ({ companyId, userRole, userDepartmentId }) => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedReport, setSelectedReport] = useState(null);
  const [filters, setFilters] = useState({
    status: '',
    category: '',
    department_id: ''
  });
  const [exportingReportId, setExportingReportId] = useState(null);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');

  // Fetch reports based on user role
  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      let result;

      // Route based on user role
      if (userRole === 'admin' || userRole === 'finance') {
        // Admins and Finance can see filtered reports
        if (filters.status || filters.category || filters.department_id) {
          result = await getCompanyReportsFiltered(companyId, filters);
        } else {
          result = await getCompanyReports(companyId);
        }
      } else if (userRole === 'coordinator' || userRole === 'supervisor') {
        // Coordinators/Supervisors can see departmental reports
        if (filters.department_id) {
          result = await getDepartmentReports(companyId, filters.department_id);
        } else if (userDepartmentId) {
          result = await getDepartmentReports(companyId, userDepartmentId);
        } else {
          result = await getCompanyReports(companyId);
        }
      } else {
        // Regular members see their own reports
        result = await getCompanyReports(companyId);
      }

      if (result.error) {
        throw result.error;
      }

      // Sort reports
      const sorted = sortReports(result.data || [], sortBy, sortOrder);
      setReports(sorted);
    } catch (err) {
      console.error('Error fetching reports:', err);
      setError(err.message || 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, [companyId, userRole, userDepartmentId, filters, sortBy, sortOrder]);

  // Fetch reports on component mount and when dependencies change
  useEffect(() => {
    if (companyId) {
      fetchReports();
    }
  }, [companyId, fetchReports]);

  // Sort reports
  const sortReports = (reportsToSort, sortField, order) => {
    return [...reportsToSort].sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      if (sortField === 'created_at' || sortField === 'updated_at') {
        aVal = new Date(aVal);
        bVal = new Date(bVal);
      }

      if (order === 'asc') {
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      } else {
        return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
      }
    });
  };

  // Handle filter changes
  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Reset filters
  const handleResetFilters = () => {
    setFilters({
      status: '',
      category: '',
      department_id: ''
    });
  };

  // Handle report export
  const handleExportReport = async (report, format) => {
    setExportingReportId(report.id);
    try {
      // Fetch full report data
      const { data: exportData, error: exportError } = await exportReport(report.id);
      
      if (exportError) {
        throw exportError;
      }

      // Generate filename
      const filename = `Report_${(report.report_title || 'Report').replace(/[^a-z0-9]/gi, '_')}`;

      // Export based on format
      if (format === 'pdf') {
        await exportReportAsPDF(exportData, filename);
      } else if (format === 'docx') {
        await exportReportAsWord(exportData, filename);
      } else if (format === 'txt') {
        await exportReportAsText(exportData, filename);
      }
    } catch (err) {
      console.error(`Error exporting report as ${format}:`, err);
      alert(`Failed to export report: ${err.message}`);
    } finally {
      setExportingReportId(null);
    }
  };

  // Get severity badge color
  const getSeverityColor = (severity) => {
    switch (severity?.toLowerCase()) {
      case 'critical':
        return 'red';
      case 'high':
        return 'orange';
      case 'medium':
        return 'yellow';
      case 'low':
        return 'green';
      default:
        return 'gray';
    }
  };

  // Get status badge color
  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'open':
        return 'blue';
      case 'in_review':
        return 'purple';
      case 'resolved':
        return 'green';
      case 'closed':
        return 'gray';
      default:
        return 'gray';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <span className="ml-2">Loading reports...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold mb-2">CMMS Reports</h1>
        <p className="text-gray-600">
          {userRole === 'admin' || userRole === 'finance'
            ? 'View all company reports'
            : userRole === 'coordinator' || userRole === 'supervisor'
            ? 'View departmental reports'
            : 'View your reports'}
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              name="status"
              value={filters.status}
              onChange={handleFilterChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500"
            >
              <option value="">All Status</option>
              <option value="open">Open</option>
              <option value="in_review">In Review</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          {/* Category Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select
              name="category"
              value={filters.category}
              onChange={handleFilterChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500"
            >
              <option value="">All Categories</option>
              <option value="general">General</option>
              <option value="maintenance">Maintenance</option>
              <option value="safety">Safety</option>
              <option value="compliance">Compliance</option>
              <option value="incident">Incident</option>
              <option value="other">Other</option>
            </select>
          </div>

          {/* Sort By */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sort By</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500"
            >
              <option value="created_at">Created Date</option>
              <option value="updated_at">Updated Date</option>
              <option value="severity">Severity</option>
              <option value="report_title">Title</option>
            </select>
          </div>

          {/* Sort Order */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Order</label>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500"
            >
              <option value="desc">Newest First</option>
              <option value="asc">Oldest First</option>
            </select>
          </div>
        </div>

        {/* Reset Button */}
        <div className="mt-4">
          <button
            onClick={handleResetFilters}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition"
          >
            Reset Filters
          </button>
        </div>
      </div>

      {/* Reports Count */}
      <div className="text-sm text-gray-600">
        Showing {reports.length} report{reports.length !== 1 ? 's' : ''}
      </div>

      {/* Reports List */}
      {reports.length === 0 ? (
        <div className="bg-white p-8 rounded-lg shadow text-center">
          <p className="text-gray-500">No reports found.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map((report) => (
            <div key={report.id} className="bg-white p-4 rounded-lg shadow hover:shadow-lg transition">
              {/* Report Header */}
              <div className="flex justify-between items-start mb-3">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900">{report.report_title || 'Untitled'}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {report.reporter_name || 'Anonymous'} · {new Date(report.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold text-white bg-${getSeverityColor(report.severity)}-500`}>
                    {report.severity?.toUpperCase() || 'MEDIUM'}
                  </span>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold text-white bg-${getStatusColor(report.status)}-500`}>
                    {report.status?.toUpperCase() || 'OPEN'}
                  </span>
                </div>
              </div>

              {/* Report Metadata */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm text-gray-600 mb-3">
                <div>
                  <span className="font-medium">Category:</span> {report.report_category || 'General'}
                </div>
                <div>
                  <span className="font-medium">Department:</span> {report.department_name || 'General'}
                </div>
                <div>
                  <span className="font-medium">Reporter:</span> {report.reporter_role || 'Member'}
                </div>
                <div>
                  <span className="font-medium">ID:</span> {report.id.substring(0, 8)}...
                </div>
              </div>

              {/* Report Body Preview */}
              <div className="text-sm text-gray-700 mb-4 line-clamp-3">
                {report.report_body || 'No details provided'}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setSelectedReport(selectedReport?.id === report.id ? null : report)}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition text-sm"
                >
                  {selectedReport?.id === report.id ? 'Hide Details' : 'View Details'}
                </button>

                {/* Export Buttons */}
                <div className="flex gap-1 ml-auto">
                  <button
                    onClick={() => handleExportReport(report, 'pdf')}
                    disabled={exportingReportId === report.id}
                    className="px-3 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition text-sm disabled:opacity-50"
                    title="Download as PDF"
                  >
                    {exportingReportId === report.id ? '...' : 'PDF'}
                  </button>
                  <button
                    onClick={() => handleExportReport(report, 'docx')}
                    disabled={exportingReportId === report.id}
                    className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-sm disabled:opacity-50"
                    title="Download as Word"
                  >
                    {exportingReportId === report.id ? '...' : 'DOCX'}
                  </button>
                  <button
                    onClick={() => handleExportReport(report, 'txt')}
                    disabled={exportingReportId === report.id}
                    className="px-3 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition text-sm disabled:opacity-50"
                    title="Download as Text"
                  >
                    {exportingReportId === report.id ? '...' : 'TXT'}
                  </button>
                </div>
              </div>

              {/* Expanded Details */}
              {selectedReport?.id === report.id && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="space-y-3">
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">Full Report</h4>
                      <p className="text-gray-700 whitespace-pre-wrap">{report.report_body || 'No details provided'}</p>
                    </div>

                    {report.resolution_notes && (
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-1">Resolution Notes</h4>
                        <p className="text-gray-700 whitespace-pre-wrap">{report.resolution_notes}</p>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="font-medium">Reporter Email:</span>
                        <p className="text-gray-600">{report.reporter_email || 'N/A'}</p>
                      </div>
                      <div>
                        <span className="font-medium">Last Updated:</span>
                        <p className="text-gray-600">{new Date(report.updated_at).toLocaleString()}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CMSSReportsView;
