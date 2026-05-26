/**
 * Data Cleanup Integration for Reports
 * Allows users to delete transaction data during report generation
 * Usage in reports:
 *   - Get cleanup stats before displaying report
 *   - Add cleanup button to report UI
 *   - Execute cleanup with user confirmation
 */

import {
  getCleanupStats,
  deleteAllTransactions,
  deleteOldTransactions,
  deleteTransactionsByType,
  deleteTransactionsByDateRange,
  deleteLowConfidenceTransactions,
  deleteOfflineSyncTransactions,
  deleteTransactionsByCategory,
} from './transactionCleanupService';

/**
 * Pre-report cleanup check
 * Call this before generating reports to show user cleanup options
 */
export const checkPreReportCleanup = async () => {
  try {
    console.log('[ReportCleanup] 📋 Checking for cleanup opportunities...');
    
    const stats = await getCleanupStats();
    if (!stats) return null;

    const opportunities = [];

    // Suggest deletion of old data
    if (stats.byAge?.olderThan90Days > 0) {
      opportunities.push({
        id: 'old-data',
        title: `Delete Old Transactions (${stats.byAge.olderThan90Days})`,
        description: `Remove ${stats.byAge.olderThan90Days} transactions older than 90 days`,
        action: () => deleteOldTransactions(90),
        severity: 'low'
      });
    }

    // Suggest deletion of offline sync test data
    // (Would need to query to get count, so optional)
    opportunities.push({
      id: 'offline-sync',
      title: 'Clean Up Offline Sync Data',
      description: 'Remove test transactions from offline sync feature',
      action: deleteOfflineSyncTransactions,
      severity: 'low'
    });

    console.log('[ReportCleanup] ✅ Cleanup opportunities found:', opportunities.length);
    return { stats, opportunities };
  } catch (error) {
    console.error('[ReportCleanup] ❌ Error checking cleanup:', error);
    return null;
  }
};

/**
 * Execute cleanup operation with confirmation
 */
export const executeCleanup = async (cleanupType, params = null) => {
  try {
    let result;

    switch (cleanupType) {
      case 'all':
        result = await deleteAllTransactions();
        break;
      case 'old':
        result = await deleteOldTransactions(params?.days || 90);
        break;
      case 'type':
        result = await deleteTransactionsByType(params?.type);
        break;
      case 'date-range':
        result = await deleteTransactionsByDateRange(params?.startDate, params?.endDate);
        break;
      case 'low-confidence':
        result = await deleteLowConfidenceTransactions(params?.threshold || 0.5);
        break;
      case 'offline-sync':
        result = await deleteOfflineSyncTransactions();
        break;
      case 'category':
        result = await deleteTransactionsByCategory(params?.category);
        break;
      default:
        throw new Error(`Unknown cleanup type: ${cleanupType}`);
    }

    console.log('[ReportCleanup] ✅ Cleanup executed:', result);
    return result;
  } catch (error) {
    console.error('[ReportCleanup] ❌ Error executing cleanup:', error);
    throw error;
  }
};

/**
 * Generate cleanup report
 * Shows before/after state of data
 */
export const generateCleanupReport = async (cleanupType, params = null) => {
  try {
    // Get stats before
    const statsBefore = await getCleanupStats();
    console.log('[ReportCleanup] 📊 Stats before cleanup:', statsBefore);

    // Execute cleanup
    const result = await executeCleanup(cleanupType, params);
    
    // Get stats after
    const statsAfter = await getCleanupStats();
    console.log('[ReportCleanup] 📊 Stats after cleanup:', statsAfter);

    // Generate report
    const report = {
      cleanupType,
      timestamp: new Date().toISOString(),
      deleted: result.deletedCount,
      statsBefore,
      statsAfter,
      summary: {
        previousTotal: statsBefore?.total || 0,
        newTotal: statsAfter?.total || 0,
        deletedCount: result.deletedCount,
        reductionPercentage: statsBefore?.total 
          ? Math.round((result.deletedCount / statsBefore.total) * 100)
          : 0
      }
    };

    console.log('[ReportCleanup] ✅ Cleanup report generated:', report);
    return report;
  } catch (error) {
    console.error('[ReportCleanup] ❌ Error generating cleanup report:', error);
    throw error;
  }
};

/**
 * Cleanup summary for report display
 */
export const getCleanupSummary = async () => {
  try {
    const stats = await getCleanupStats();
    if (!stats) return null;

    return {
      totalTransactions: stats.total,
      breakdown: {
        byType: stats.byType,
        old: stats.byAge?.olderThan90Days || 0
      },
      canClean: stats.total > 0
    };
  } catch (error) {
    console.error('[ReportCleanup] ❌ Error getting summary:', error);
    return null;
  }
};

export default {
  checkPreReportCleanup,
  executeCleanup,
  generateCleanupReport,
  getCleanupSummary
};
