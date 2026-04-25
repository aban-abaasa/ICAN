/**
 * CMMS Reports Integration Examples
 * Copy and adapt these examples to integrate reports into your application
 */

// ============================================================================
// EXAMPLE 1: Basic Integration in a Page Component
// ============================================================================

import React from 'react';
import CMSSReportsView from '@/components/CMMS/CMSSReportsView';
import { useAuth } from '@/lib/hooks/useAuth';

export default function ReportsPage() {
  const { user, company, profile } = useAuth();

  if (!user || !company) {
    return <div>Loading...</div>;
  }

  return (
    <div className="container mx-auto">
      <CMSSReportsView
        companyId={company.id}
        userRole={profile?.role || 'member'}
        userDepartmentId={profile?.department_id}
      />
    </div>
  );
}

// ============================================================================
// EXAMPLE 2: Reports in a Dashboard with Tabs
// ============================================================================

import React, { useState } from 'react';
import CMSSReportsView from '@/components/CMMS/CMSSReportsView';

export default function CMSSDashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const { company, profile } = useAuth();

  return (
    <div className="space-y-6">
      <div className="flex border-b">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 ${activeTab === 'overview' ? 'border-b-2 border-blue-500' : ''}`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('reports')}
          className={`px-4 py-2 ${activeTab === 'reports' ? 'border-b-2 border-blue-500' : ''}`}
        >
          Reports
        </button>
        <button
          onClick={() => setActiveTab('inventory')}
          className={`px-4 py-2 ${activeTab === 'inventory' ? 'border-b-2 border-blue-500' : ''}`}
        >
          Inventory
        </button>
      </div>

      {activeTab === 'reports' && (
        <CMSSReportsView
          companyId={company.id}
          userRole={profile?.role}
          userDepartmentId={profile?.department_id}
        />
      )}
    </div>
  );
}

// ============================================================================
// EXAMPLE 3: Reports Modal
// ============================================================================

import React, { useState } from 'react';
import CMSSReportsView from '@/components/CMMS/CMSSReportsView';

export default function ReportsModal({ companyId, isOpen, onClose, userRole, userDepartmentId }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-screen overflow-y-auto">
        <div className="flex justify-between items-center p-4 border-b">
          <h2 className="text-xl font-bold">Company Reports</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            ✕
          </button>
        </div>
        <CMSSReportsView
          companyId={companyId}
          userRole={userRole}
          userDepartmentId={userDepartmentId}
        />
      </div>
    </div>
  );
}

// Usage
function Page() {
  const [showReportsModal, setShowReportsModal] = useState(false);

  return (
    <>
      <button onClick={() => setShowReportsModal(true)}>
        View Reports
      </button>
      <ReportsModal
        isOpen={showReportsModal}
        onClose={() => setShowReportsModal(false)}
        companyId="company-id"
        userRole="admin"
      />
    </>
  );
}

// ============================================================================
// EXAMPLE 4: Reports in Sidebar with Summary
// ============================================================================

import React, { useState, useEffect } from 'react';
import { getCompanyReports } from '@/lib/supabase/services/cmmsService';

export default function ReportsSidebar({ companyId }) {
  const [reports, setReports] = useState([]);
  const [openCount, setOpenCount] = useState(0);
  const [criticalCount, setCriticalCount] = useState(0);

  useEffect(() => {
    fetchReportsSummary();
  }, [companyId]);

  const fetchReportsSummary = async () => {
    const { data } = await getCompanyReports(companyId);
    setReports(data);
    setOpenCount(data.filter(r => r.status === 'open').length);
    setCriticalCount(data.filter(r => r.severity === 'critical').length);
  };

  return (
    <aside className="bg-gray-50 p-4 rounded-lg">
      <h3 className="font-bold text-lg mb-4">Reports Summary</h3>
      
      <div className="space-y-3">
        <div className="bg-blue-50 p-3 rounded">
          <div className="text-sm text-gray-600">Total Reports</div>
          <div className="text-2xl font-bold text-blue-600">{reports.length}</div>
        </div>

        <div className="bg-orange-50 p-3 rounded">
          <div className="text-sm text-gray-600">Open Reports</div>
          <div className="text-2xl font-bold text-orange-600">{openCount}</div>
        </div>

        <div className="bg-red-50 p-3 rounded">
          <div className="text-sm text-gray-600">Critical Issues</div>
          <div className="text-2xl font-bold text-red-600">{criticalCount}</div>
        </div>
      </div>

      <button className="w-full mt-4 bg-blue-500 text-white py-2 rounded">
        View All Reports
      </button>
    </aside>
  );
}

// ============================================================================
// EXAMPLE 5: Department Reports Widget
// ============================================================================

import React, { useState, useEffect } from 'react';
import { getDepartmentReports } from '@/lib/supabase/services/cmmsService';

export default function DepartmentReportsWidget({ companyId, departmentId }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReports();
  }, [companyId, departmentId]);

  const fetchReports = async () => {
    setLoading(true);
    const { data } = await getDepartmentReports(companyId, departmentId);
    setReports(data || []);
    setLoading(false);
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow">
      <h4 className="font-bold mb-4">Department Reports</h4>
      
      {loading ? (
        <div>Loading...</div>
      ) : reports.length === 0 ? (
        <div className="text-gray-500">No reports</div>
      ) : (
        <div className="space-y-2">
          {reports.slice(0, 5).map(report => (
            <div key={report.id} className="border-l-4 border-orange-500 pl-3 py-2">
              <div className="font-medium text-sm">{report.report_title}</div>
              <div className="text-xs text-gray-500">
                {report.status.toUpperCase()} • {report.severity.toUpperCase()}
              </div>
            </div>
          ))}
          {reports.length > 5 && (
            <div className="text-sm text-blue-500 pt-2">
              +{reports.length - 5} more reports
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// EXAMPLE 6: Export Reports with Custom Handler
// ============================================================================

import React from 'react';
import { exportReport } from '@/lib/supabase/services/cmmsService';
import {
  exportReportAsWord,
  exportReportAsPDF,
  exportReportAsText
} from '@/lib/utils/reportExport';

export default function ReportExportButtons({ reportId, reportTitle }) {
  const [exporting, setExporting] = React.useState(null);

  const handleExport = async (format) => {
    try {
      setExporting(format);
      const { data: report, error } = await exportReport(reportId);
      
      if (error) throw error;

      const filename = reportTitle.replace(/[^a-z0-9]/gi, '_');

      switch (format) {
        case 'pdf':
          await exportReportAsPDF(report, filename);
          break;
        case 'docx':
          await exportReportAsWord(report, filename);
          break;
        case 'txt':
          await exportReportAsText(report, filename);
          break;
      }
    } catch (err) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="flex gap-2">
      <button
        onClick={() => handleExport('pdf')}
        disabled={exporting}
        className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
      >
        {exporting === 'pdf' ? 'Exporting...' : 'PDF'}
      </button>
      <button
        onClick={() => handleExport('docx')}
        disabled={exporting}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {exporting === 'docx' ? 'Exporting...' : 'Word'}
      </button>
      <button
        onClick={() => handleExport('txt')}
        disabled={exporting}
        className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50"
      >
        {exporting === 'txt' ? 'Exporting...' : 'Text'}
      </button>
    </div>
  );
}

// ============================================================================
// EXAMPLE 7: Reports with Filters in Custom Component
// ============================================================================

import React, { useState } from 'react';
import { getCompanyReportsFiltered } from '@/lib/supabase/services/cmmsService';

export default function AdvancedReportsFilter({ companyId }) {
  const [filters, setFilters] = useState({
    status: '',
    category: '',
  });
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    const newFilters = { ...filters, [name]: value };
    setFilters(newFilters);
    fetchReports(newFilters);
  };

  const fetchReports = async (activeFilters) => {
    setLoading(true);
    const { data } = await getCompanyReportsFiltered(companyId, activeFilters);
    setReports(data || []);
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <select
          name="status"
          value={filters.status}
          onChange={handleFilterChange}
          className="px-3 py-2 border rounded"
        >
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="in_review">In Review</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>

        <select
          name="category"
          value={filters.category}
          onChange={handleFilterChange}
          className="px-3 py-2 border rounded"
        >
          <option value="">All Categories</option>
          <option value="maintenance">Maintenance</option>
          <option value="safety">Safety</option>
          <option value="incident">Incident</option>
        </select>
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : (
        <div>Found {reports.length} reports</div>
      )}
    </div>
  );
}

// ============================================================================
// EXAMPLE 8: Reports in Navigation/Menu
// ============================================================================

import React, { useState, useEffect } from 'react';
import { getCompanyReports } from '@/lib/supabase/services/cmmsService';

export default function ReportsNavItem({ companyId }) {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    fetchUnreadCount();
  }, [companyId]);

  const fetchUnreadCount = async () => {
    const { data } = await getCompanyReports(companyId);
    const openCount = data.filter(r => r.status === 'open').length;
    setUnreadCount(openCount);
  };

  return (
    <a href="/reports" className="flex items-center gap-2 px-4 py-2 hover:bg-gray-100">
      <span>📋 Reports</span>
      {unreadCount > 0 && (
        <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full">
          {unreadCount}
        </span>
      )}
    </a>
  );
}

// ============================================================================
// EXAMPLE 9: Hooks for Reports
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { getCompanyReports, getCompanyReportsFiltered } from '@/lib/supabase/services/cmmsService';

/**
 * Custom hook for fetching company reports
 */
export function useCompanyReports(companyId) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchReports = useCallback(async () => {
    if (!companyId) return;
    
    setLoading(true);
    try {
      const { data, error } = await getCompanyReports(companyId);
      if (error) throw error;
      setReports(data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  return { reports, loading, error, refetch: fetchReports };
}

/**
 * Custom hook for filtered reports
 */
export function useFilteredReports(companyId, initialFilters = {}) {
  const [reports, setReports] = useState([]);
  const [filters, setFilters] = useState(initialFilters);
  const [loading, setLoading] = useState(false);

  const updateFilters = useCallback(async (newFilters) => {
    setFilters(newFilters);
    setLoading(true);
    try {
      const { data } = await getCompanyReportsFiltered(companyId, newFilters);
      setReports(data);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  return { reports, filters, updateFilters, loading };
}

// Usage Example
function MyComponent() {
  const { reports, loading } = useCompanyReports('company-id');
  const { reports: filtered, updateFilters } = useFilteredReports('company-id');

  return <div>{/* Use reports */}</div>;
}

// ============================================================================
// EXAMPLE 10: Context API for Reports
// ============================================================================

import React, { createContext, useContext, useState, useEffect } from 'react';
import { getCompanyReports } from '@/lib/supabase/services/cmmsService';

const ReportsContext = createContext();

export function ReportsProvider({ companyId, children }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReports();
  }, [companyId]);

  const fetchReports = async () => {
    const { data } = await getCompanyReports(companyId);
    setReports(data);
    setLoading(false);
  };

  return (
    <ReportsContext.Provider value={{ reports, loading, refetch: fetchReports }}>
      {children}
    </ReportsContext.Provider>
  );
}

export function useReports() {
  return useContext(ReportsContext);
}

// Usage
function App() {
  return (
    <ReportsProvider companyId="company-id">
      <MyComponent />
    </ReportsProvider>
  );
}

function MyComponent() {
  const { reports, loading } = useReports();
  return <div>{/* Display reports */}</div>;
}

export default {
  ReportsProvider,
  useReports,
  useCompanyReports,
  useFilteredReports,
  ReportExportButtons,
  DepartmentReportsWidget,
  ReportsSidebar,
  ReportsModal,
  CMSSDashboard,
  ReportsPage,
  AdvancedReportsFilter,
  ReportsNavItem
};
