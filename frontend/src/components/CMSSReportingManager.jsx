/**
 * CMMS Report Component with Role-Based Access Control
 * Complete example showing how to integrate the access control system
 */

import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Trash2,
  Edit2,
  Plus,
  Filter,
  Download
} from 'lucide-react';

// Import the service
import cmmsReportService from '../services/cmmsReportAccessService';

const CMSSReportingManager = ({ 
  cmmsCompanyId, 
  userRole, 
  userDepartmentId,
  currentUserId,
  userName
}) => {
  // ============================================================
  // STATE MANAGEMENT
  // ============================================================
  
  const [reports, setReports] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterSeverity, setFilterSeverity] = useState('all');
  const [userAccessLevel, setUserAccessLevel] = useState(null);
  const [stats, setStats] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    reportTitle: '',
    reportCategory: 'general',
    severity: 'medium',
    reportBody: '',
    visibilityLevel: 'department'
  });

  // Edit mode
  const [editingReport, setEditingReport] = useState(null);

  // ============================================================
  // INITIALIZATION
  // ============================================================

  useEffect(() => {
    initializeReporting();
  }, [cmmsCompanyId]);

  const initializeReporting = async () => {
    // Set user access level
    const accessLevel = cmmsReportService.getUserReportAccessLevel(userRole);
    setUserAccessLevel(accessLevel);

    // Load reports
    await loadReports();

    // Load department stats if supervisor/coordinator
    if (userRole === 'supervisor' || userRole === 'coordinator') {
      await loadDepartmentStats();
    }
  };

  // ============================================================
  // DATA LOADING
  // ============================================================

  const loadReports = async () => {
    setIsLoading(true);
    try {
      const result = await cmmsReportService.getFilteredReports(cmmsCompanyId);
      
      if (result.success) {
        const sorted = cmmsReportService.sortReports(result.data, 'created_at', 'desc');
        setReports(sorted);
      } else {
        alert('Error loading reports: ' + result.error);
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to load reports');
    } finally {
      setIsLoading(false);
    }
  };

  const loadDepartmentStats = async () => {
    try {
      const result = await cmmsReportService.getDepartmentReportStats(
        cmmsCompanyId,
        userDepartmentId
      );
      
      if (result.success) {
        setStats(result.data);
      }
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  // ============================================================
  // REPORT OPERATIONS
  // ============================================================

  const handleSubmitReport = async (e) => {
    e.preventDefault();

    if (!formData.reportTitle.trim()) {
      alert('Report title is required');
      return;
    }

    if (!formData.reportBody.trim()) {
      alert('Report description is required');
      return;
    }

    setIsLoading(true);
    try {
      const result = await cmmsReportService.createFilteredReport(
        cmmsCompanyId,
        {
          ...formData,
          departmentId: userDepartmentId
        }
      );

      if (result.success) {
        alert('✅ Report submitted successfully!');
        setFormData({
          reportTitle: '',
          reportCategory: 'general',
          severity: 'medium',
          reportBody: '',
          visibilityLevel: 'department'
        });
        setShowForm(false);
        await loadReports();
      } else {
        alert('❌ Error: ' + result.error);
      }
    } catch (error) {
      alert('❌ Error: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateReportStatus = async (reportId, newStatus) => {
    try {
      const result = await cmmsReportService.updateReportStatus(
        reportId,
        newStatus,
        newStatus === 'resolved' ? 'Report resolved' : ''
      );

      if (result.success) {
        alert(`✅ Status updated to ${newStatus}`);
        await loadReports();
      } else {
        alert('❌ Error: ' + result.error);
      }
    } catch (error) {
      alert('❌ Error: ' + error.message);
    }
  };

  const handleDeleteReport = async (reportId) => {
    if (!window.confirm('Are you sure you want to delete this report?')) {
      return;
    }

    try {
      const result = await cmmsReportService.deleteReport(reportId, cmmsCompanyId);

      if (result.success) {
        alert('✅ Report deleted');
        await loadReports();
      } else {
        alert('❌ Error: ' + result.error);
      }
    } catch (error) {
      alert('❌ Error: ' + error.message);
    }
  };

  const handleExportReports = (format) => {
    const result = cmmsReportService.exportReports(getFilteredReports(), format);
    
    if (result.success) {
      const element = document.createElement('a');
      element.setAttribute(
        'href',
        'data:text/plain;charset=utf-8,' + encodeURIComponent(result.data)
      );
      element.setAttribute('download', result.filename);
      element.style.display = 'none';
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
    } else {
      alert('Export error: ' + result.error);
    }
  };

  // ============================================================
  // FILTERING & SORTING
  // ============================================================

  const getFilteredReports = () => {
    let filtered = [...reports];

    // Filter by status
    if (filterStatus !== 'all') {
      filtered = cmmsReportService.filterReportsByStatus(filtered, filterStatus);
    }

    // Filter by severity
    if (filterSeverity !== 'all') {
      filtered = cmmsReportService.filterReportsBySeverity(filtered, filterSeverity);
    }

    return filtered;
  };

  const canUserEditReport = (report) => {
    return report.is_own_report || userRole === 'admin';
  };

  // ============================================================
  // RENDER: ACCESS LEVEL BADGE
  // ============================================================

  const AccessLevelBadge = ({ accessLevel }) => {
    const styles = {
      admin_full_access: 'bg-red-100 text-red-800',
      department_access: 'bg-blue-100 text-blue-800',
      personal_access: 'bg-gray-100 text-gray-800'
    };

    const labels = {
      admin_full_access: '👤 Admin Access',
      department_access: '👥 Department Access',
      personal_access: '🔒 Personal'
    };

    return (
      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${styles[accessLevel]}`}>
        {labels[accessLevel]}
      </span>
    );
  };

  // ============================================================
  // RENDER: HEADER
  // ============================================================

  const renderHeader = () => (
    <div className="bg-white p-6 rounded-lg shadow mb-6">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Company Reports</h2>
          <p className="text-gray-600 mt-1">
            Your access level: <strong>{userAccessLevel?.displayName}</strong>
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2"
        >
          <Plus size={20} />
          Submit Report
        </button>
      </div>

      {/* Stats for supervisors */}
      {stats && (
        <div className="grid grid-cols-4 gap-4 mt-4">
          <div className="bg-blue-50 p-4 rounded">
            <p className="text-gray-600 text-sm">Total Reports</p>
            <p className="text-2xl font-bold text-blue-600">{stats.total_reports}</p>
          </div>
          <div className="bg-yellow-50 p-4 rounded">
            <p className="text-gray-600 text-sm">Open</p>
            <p className="text-2xl font-bold text-yellow-600">{stats.open_reports}</p>
          </div>
          <div className="bg-red-50 p-4 rounded">
            <p className="text-gray-600 text-sm">Critical</p>
            <p className="text-2xl font-bold text-red-600">{stats.critical_reports}</p>
          </div>
          <div className="bg-purple-50 p-4 rounded">
            <p className="text-gray-600 text-sm">High Severity</p>
            <p className="text-2xl font-bold text-purple-600">{stats.high_severity}</p>
          </div>
        </div>
      )}
    </div>
  );

  // ============================================================
  // RENDER: FORM
  // ============================================================

  const renderForm = () => {
    if (!showForm) return null;

    return (
      <div className="bg-white p-6 rounded-lg shadow mb-6 border-l-4 border-blue-600">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Submit New Report</h3>
        
        <form onSubmit={handleSubmitReport}>
          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* Title */}
            <div className="col-span-2">
              <label className="block text-gray-700 font-semibold mb-2">
                Report Title *
              </label>
              <input
                type="text"
                value={formData.reportTitle}
                onChange={(e) => setFormData({ ...formData, reportTitle: e.target.value })}
                placeholder="Brief title of the issue"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {/* Category */}
            <div>
              <label className="block text-gray-700 font-semibold mb-2">
                Category
              </label>
              <select
                value={formData.reportCategory}
                onChange={(e) => setFormData({ ...formData, reportCategory: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="general">General</option>
                <option value="maintenance">Maintenance</option>
                <option value="safety">Safety</option>
                <option value="equipment">Equipment</option>
                <option value="other">Other</option>
              </select>
            </div>

            {/* Severity */}
            <div>
              <label className="block text-gray-700 font-semibold mb-2">
                Severity Level
              </label>
              <select
                value={formData.severity}
                onChange={(e) => setFormData({ ...formData, severity: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          {/* Description */}
          <div className="mb-4">
            <label className="block text-gray-700 font-semibold mb-2">
              Description *
            </label>
            <textarea
              value={formData.reportBody}
              onChange={(e) => setFormData({ ...formData, reportBody: e.target.value })}
              placeholder="Detailed description of the issue"
              rows="5"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          {/* Visibility (for coordinators/supervisors) */}
          {(userRole === 'admin' || userRole === 'coordinator' || userRole === 'supervisor') && (
            <div className="mb-4">
              <label className="block text-gray-700 font-semibold mb-2">
                Visibility Level
              </label>
              <select
                value={formData.visibilityLevel}
                onChange={(e) => setFormData({ ...formData, visibilityLevel: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="personal">Personal (Only me)</option>
                <option value="department">Department (Department members)</option>
                {userRole === 'admin' && <option value="company">Company (All members)</option>}
              </select>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={isLoading}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg disabled:opacity-50"
            >
              {isLoading ? 'Submitting...' : 'Submit Report'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="bg-gray-300 hover:bg-gray-400 text-gray-900 px-6 py-2 rounded-lg"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    );
  };

  // ============================================================
  // RENDER: FILTERS
  // ============================================================

  const renderFilters = () => (
    <div className="bg-white p-4 rounded-lg shadow mb-6 flex gap-4">
      <div className="flex items-center gap-2">
        <Filter size={20} className="text-gray-600" />
        <label className="text-gray-700 font-semibold">Status:</label>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg"
        >
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="in_review">In Review</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-gray-700 font-semibold">Severity:</label>
        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg"
        >
          <option value="all">All Severities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </div>

      <button
        onClick={() => handleExportReports('csv')}
        className="ml-auto flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg"
      >
        <Download size={18} />
        Export CSV
      </button>
    </div>
  );

  // ============================================================
  // RENDER: REPORTS LIST
  // ============================================================

  const renderReportsList = () => {
    const filtered = getFilteredReports();

    if (isLoading) {
      return (
        <div className="bg-white p-8 rounded-lg shadow text-center">
          <p className="text-gray-600">Loading reports...</p>
        </div>
      );
    }

    if (filtered.length === 0) {
      return (
        <div className="bg-white p-8 rounded-lg shadow text-center">
          <p className="text-gray-600">No reports found</p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {filtered.map(report => (
          <div
            key={report.id}
            className="bg-white p-6 rounded-lg shadow hover:shadow-lg transition"
          >
            {/* Header */}
            <div className="flex justify-between items-start mb-4">
              <div className="flex-1">
                <h3 className="text-lg font-bold text-gray-900">
                  {report.report_title}
                </h3>
                <p className="text-gray-600 text-sm mt-1">
                  Submitted by <strong>{report.reporter_name}</strong> on{' '}
                  {new Date(report.created_at).toLocaleDateString()}
                </p>
              </div>

              <div className="flex gap-2">
                <AccessLevelBadge accessLevel={report.access_level} />
                <span
                  className={`px-3 py-1 rounded-full text-xs font-semibold ${
                    report.severity === 'critical'
                      ? 'bg-red-100 text-red-800'
                      : report.severity === 'high'
                      ? 'bg-orange-100 text-orange-800'
                      : report.severity === 'medium'
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-green-100 text-green-800'
                  }`}
                >
                  {report.severity.toUpperCase()}
                </span>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-semibold ${
                    report.status === 'open'
                      ? 'bg-blue-100 text-blue-800'
                      : report.status === 'in_review'
                      ? 'bg-purple-100 text-purple-800'
                      : report.status === 'resolved'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {report.status.toUpperCase()}
                </span>
              </div>
            </div>

            {/* Body */}
            <p className="text-gray-700 mb-4">{report.report_body}</p>

            {/* Meta */}
            <div className="grid grid-cols-2 gap-4 mb-4 text-sm text-gray-600">
              <div>
                <strong>Category:</strong> {report.report_category}
              </div>
              <div>
                <strong>Reporter Role:</strong> {report.reporter_role}
              </div>
            </div>

            {/* Actions */}
            {canUserEditReport(report) && (
              <div className="flex gap-2 pt-4 border-t">
                <select
                  value={report.status}
                  onChange={(e) => handleUpdateReportStatus(report.id, e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="open">Mark as Open</option>
                  <option value="in_review">Mark as In Review</option>
                  <option value="resolved">Mark as Resolved</option>
                  <option value="closed">Mark as Closed</option>
                </select>

                <button
                  onClick={() => handleDeleteReport(report.id)}
                  className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg flex items-center gap-2"
                >
                  <Trash2 size={16} />
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  // ============================================================
  // RENDER: MAIN COMPONENT
  // ============================================================

  return (
    <div className="p-6">
      {renderHeader()}
      {renderForm()}
      {renderFilters()}
      {renderReportsList()}
    </div>
  );
};

export default CMSSReportingManager;
