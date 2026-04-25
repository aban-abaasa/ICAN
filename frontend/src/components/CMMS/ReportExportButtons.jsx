/**
 * CMMS Report Export Buttons Component
 * Provides UI for downloading reports as PDF or DOCX
 * ENHANCED: Strong fonts for visibility across all modes
 */

import React, { useState } from 'react';
import cmmsService from '@/lib/supabase/services/cmmsService';
import { buttonStylesStrengthened } from '@/styles/cmmsTypography';

/**
 * Export button component for single report
 * Usage in report details view
 */
export const ReportExportButtons = ({ report }) => {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  const handleExportPDF = async () => {
    try {
      setExporting(true);
      setError(null);

      // Fetch full report data if needed
      let reportData = report;
      if (!report.body) {
        const { data: fullReport, error: fetchError } = await cmmsService.exportReport(report.id);
        if (fetchError) throw fetchError;
        reportData = fullReport;
      }

      // Export to PDF
      const { success, error: exportError } = await cmmsService.exportReportToPDF(reportData);
      if (!success) throw exportError;

      console.log('✅ Report exported to PDF successfully');
    } catch (err) {
      console.error('❌ Error exporting PDF:', err);
      setError(err?.message || 'Failed to export PDF');
    } finally {
      setExporting(false);
    }
  };

  const handleExportDOCX = async () => {
    try {
      setExporting(true);
      setError(null);

      // Fetch full report data if needed
      let reportData = report;
      if (!report.body) {
        const { data: fullReport, error: fetchError } = await cmmsService.exportReport(report.id);
        if (fetchError) throw fetchError;
        reportData = fullReport;
      }

      // Export to DOCX
      const { success, error: exportError } = await cmmsService.exportReportToDOCX(reportData);
      if (!success) throw exportError;

      console.log('✅ Report exported to DOCX successfully');
    } catch (err) {
      console.error('❌ Error exporting DOCX:', err);
      setError(err?.message || 'Failed to export Word document');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex gap-2 items-center">
      <button
        onClick={handleExportPDF}
        disabled={exporting}
        className="px-4 py-2 bg-red-600 text-white font-bold rounded hover:bg-red-700 shadow-md hover:shadow-lg disabled:bg-gray-400 disabled:text-gray-600 text-sm transition-all"
        title="Download as PDF"
      >
        {exporting ? 'Exporting...' : '📄 Export PDF'}
      </button>

      <button
        onClick={handleExportDOCX}
        disabled={exporting}
        className="px-4 py-2 bg-blue-600 text-white font-bold rounded hover:bg-blue-700 shadow-md hover:shadow-lg disabled:bg-gray-400 disabled:text-gray-600 text-sm transition-all"
        title="Download as Word Document"
      >
        {exporting ? 'Exporting...' : '📝 Export Word'}
      </button>

      {error && (
        <span className="text-red-700 text-sm ml-2 font-bold bg-red-100 px-3 py-1 rounded">
          ⚠️ {error}
        </span>
      )}
    </div>
  );
};

/**
 * Batch export buttons for multiple reports
 * Usage in reports list view
 * ENHANCED: Strong fonts for visibility
 */
export const BatchReportExportButtons = ({ reports = [], isLoading = false }) => {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  if (!reports || reports.length === 0) {
    return null;
  }

  const handleExportAllPDF = async () => {
    try {
      setExporting(true);
      setError(null);

      const { success, error: exportError } = await cmmsService.exportReportsToPDF(
        reports,
        'Maintenance Reports - Batch Export'
      );

      if (!success) throw exportError;
      console.log(`✅ ${reports.length} reports exported to PDF successfully`);
    } catch (err) {
      console.error('❌ Error exporting batch PDF:', err);
      setError(err?.message || 'Failed to export PDF');
    } finally {
      setExporting(false);
    }
  };

  const handleExportAllDOCX = async () => {
    try {
      setExporting(true);
      setError(null);

      const { success, error: exportError } = await cmmsService.exportReportsToDOCX(
        reports,
        'Maintenance Reports - Batch Export'
      );

      if (!success) throw exportError;
      console.log(`✅ ${reports.length} reports exported to DOCX successfully`);
    } catch (err) {
      console.error('❌ Error exporting batch DOCX:', err);
      setError(err?.message || 'Failed to export Word document');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex gap-3 items-center p-4 bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900 dark:to-blue-800 border-l-4 border-blue-600 rounded-lg shadow-md">
      <span className="text-sm font-bold text-gray-900 dark:text-white">
        📊 Export {reports.length} reports:
      </span>

      <button
        onClick={handleExportAllPDF}
        disabled={exporting || isLoading}
        className="px-4 py-2 bg-red-600 text-white font-bold rounded hover:bg-red-700 shadow-md hover:shadow-lg disabled:bg-gray-400 disabled:text-gray-600 text-sm transition-all"
        title="Download all as PDF"
      >
        {exporting ? 'Exporting...' : '📄 PDF'}
      </button>

      <button
        onClick={handleExportAllDOCX}
        disabled={exporting || isLoading}
        className="px-4 py-2 bg-blue-600 text-white font-bold rounded hover:bg-blue-700 shadow-md hover:shadow-lg disabled:bg-gray-400 disabled:text-gray-600 text-sm transition-all"
        title="Download all as Word Document"
      >
        {exporting ? 'Exporting...' : '📝 WORD'}
      </button>

      {error && (
        <span className="text-red-700 text-sm ml-auto font-bold bg-red-100 px-3 py-1 rounded">
          ⚠️ {error}
        </span>
      )}
    </div>
  );
};

/**
 * Report action menu with export options
 * Usage in dropdown menu
 * ENHANCED: Strong fonts for visibility
 */
export const ReportExportMenu = ({ report, onClose }) => {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  const handleExport = async (format) => {
    try {
      setExporting(true);
      setError(null);

      // Fetch full report data if needed
      let reportData = report;
      if (!report.body) {
        const { data: fullReport, error: fetchError } = await cmmsService.exportReport(report.id);
        if (fetchError) throw fetchError;
        reportData = fullReport;
      }

      // Export based on format
      if (format === 'pdf') {
        const { success, error: exportError } = await cmmsService.exportReportToPDF(reportData);
        if (!success) throw exportError;
      } else if (format === 'docx') {
        const { success, error: exportError } = await cmmsService.exportReportToDOCX(reportData);
        if (!success) throw exportError;
      }

      console.log(`✅ Report exported to ${format.toUpperCase()} successfully`);
      onClose?.();
    } catch (err) {
      console.error(`❌ Error exporting ${format}:`, err);
      setError(err?.message || `Failed to export ${format.toUpperCase()}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-2">
      <button
        onClick={() => handleExport('pdf')}
        disabled={exporting}
        className="w-full px-4 py-3 text-left hover:bg-red-50 dark:hover:bg-red-900 text-gray-900 dark:text-white text-sm font-bold rounded flex items-center gap-2 disabled:text-gray-400 transition-colors"
      >
        📄 Export as PDF
      </button>

      <button
        onClick={() => handleExport('docx')}
        disabled={exporting}
        className="w-full px-4 py-3 text-left hover:bg-blue-50 dark:hover:bg-blue-900 text-gray-900 dark:text-white text-sm font-bold rounded flex items-center gap-2 disabled:text-gray-400 transition-colors"
      >
        📝 Export as Word
      </button>

      {error && (
        <div className="px-4 py-2 text-red-700 dark:text-red-300 text-sm font-bold border-t border-gray-200 dark:border-gray-700 mt-2 pt-2 bg-red-50 dark:bg-red-900/20 rounded">
          ⚠️ {error}
        </div>
      )}

      {exporting && (
        <div className="px-4 py-2 text-gray-900 dark:text-gray-300 text-sm font-bold border-t border-gray-200 dark:border-gray-700 mt-2 pt-2">
          ⏳ Exporting...
        </div>
      )}
    </div>
  );
};

export default {
  ReportExportButtons,
  BatchReportExportButtons,
  ReportExportMenu
};
