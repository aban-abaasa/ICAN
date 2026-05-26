import React, { useState, useEffect } from 'react';
import {
  Trash2,
  AlertTriangle,
  CheckCircle,
  Loader,
  BarChart3,
  Calendar,
  Tag,
  Filter,
  X
} from 'lucide-react';
import {
  getCleanupStats,
  deleteAllTransactions,
  deleteOldTransactions,
  deleteTransactionsByType,
  deleteTransactionsByDateRange,
  deleteLowConfidenceTransactions,
  deleteOfflineSyncTransactions,
  deleteTransactionsByCategory
} from '../services/transactionCleanupService';

/**
 * Data Cleanup Modal for Reports
 * Allows users to safely delete transaction data
 */
export const DataCleanupModal = ({ isOpen, onClose, onCleanupComplete }) => {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [cleanupType, setCleanupType] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Load stats on open
  useEffect(() => {
    if (isOpen) {
      loadStats();
    }
  }, [isOpen]);

  const loadStats = async () => {
    try {
      setLoading(true);
      const data = await getCleanupStats();
      setStats(data);
      setError(null);
    } catch (err) {
      console.error('Error loading stats:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCleanup = async (type) => {
    if (!confirm(`⚠️ This will permanently delete transactions. Continue?`)) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      let cleanupResult;

      switch (type) {
        case 'all':
          cleanupResult = await deleteAllTransactions();
          break;
        case 'old':
          cleanupResult = await deleteOldTransactions(90);
          break;
        case 'offline':
          cleanupResult = await deleteOfflineSyncTransactions();
          break;
        default:
          throw new Error('Unknown cleanup type');
      }

      setResult(cleanupResult);
      setCleanupType(type);

      // Reload stats
      setTimeout(() => {
        loadStats();
        if (onCleanupComplete) {
          onCleanupComplete(cleanupResult);
        }
      }, 1000);
    } catch (err) {
      console.error('Cleanup error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-2xl max-w-md w-full mx-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Trash2 className="w-6 h-6 text-red-500" />
            <h2 className="text-xl font-bold">Data Cleanup</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Loading state */}
        {loading && !result ? (
          <div className="flex flex-col items-center justify-center py-8">
            <Loader className="w-8 h-8 text-blue-500 animate-spin mb-2" />
            <p className="text-gray-600">Processing...</p>
          </div>
        ) : result ? (
          // Success state
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <p className="font-semibold text-green-800">Cleanup Complete!</p>
              </div>
              <p className="text-green-700">
                ✅ Deleted {result.deletedCount} transactions
              </p>
            </div>

            {stats && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  📊 Remaining: <span className="font-semibold">{stats.total}</span> transactions
                </p>
              </div>
            )}

            <button
              onClick={() => {
                setResult(null);
                setCleanupType(null);
              }}
              className="w-full bg-gray-600 hover:bg-gray-700 text-white py-2 px-4 rounded-lg transition"
            >
              Back to Options
            </button>
          </div>
        ) : error ? (
          // Error state
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <p className="font-semibold text-red-800">Error</p>
              </div>
              <p className="text-red-700 text-sm">{error}</p>
            </div>

            <button
              onClick={loadStats}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg transition"
            >
              Try Again
            </button>
          </div>
        ) : (
          // Main state
          <div className="space-y-4">
            {/* Stats Summary */}
            {stats && (
              <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-semibold text-gray-700">
                    Total Transactions: <span className="text-blue-600">{stats.total}</span>
                  </span>
                </div>

                {/* By Type */}
                {Object.entries(stats.byType || {}).length > 0 && (
                  <div className="text-sm space-y-1">
                    <p className="font-semibold text-gray-600">By Type:</p>
                    {Object.entries(stats.byType).map(([type, count]) => (
                      <p key={type} className="text-gray-600 ml-2">
                        • {type}: {count}
                      </p>
                    ))}
                  </div>
                )}

                {/* By Age */}
                {stats.byAge && (
                  <div className="text-sm space-y-1 border-t pt-2">
                    <p className="font-semibold text-gray-600">By Age:</p>
                    <p className="text-gray-600 ml-2">
                      • Last 7 days: {stats.byAge.last7Days || 0}
                    </p>
                    <p className="text-gray-600 ml-2">
                      • Last 30 days: {stats.byAge.last30Days || 0}
                    </p>
                    <p className="text-gray-600 ml-2">
                      • Last 90 days: {stats.byAge.last90Days || 0}
                    </p>
                    <p className="text-orange-600 ml-2 font-semibold">
                      • Older than 90 days: {stats.byAge.olderThan90Days || 0}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Warning */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <p className="text-sm text-yellow-800">
                ⚠️ <span className="font-semibold">Warning:</span> Deletions are permanent
              </p>
            </div>

            {/* Cleanup Options */}
            {stats && stats.total > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-gray-700">Select cleanup option:</p>

                {stats.byAge?.olderThan90Days > 0 && (
                  <button
                    onClick={() => handleCleanup('old')}
                    className="w-full flex items-center gap-2 bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 p-3 rounded-lg transition"
                  >
                    <Calendar className="w-4 h-4" />
                    <span className="text-sm font-semibold">
                      Delete Old Data ({stats.byAge.olderThan90Days})
                    </span>
                  </button>
                )}

                <button
                  onClick={() => handleCleanup('offline')}
                  className="w-full flex items-center gap-2 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 p-3 rounded-lg transition"
                >
                  <Filter className="w-4 h-4" />
                  <span className="text-sm font-semibold">
                    Clean Offline Sync Data
                  </span>
                </button>

                <button
                  onClick={() => handleCleanup('all')}
                  className="w-full flex items-center gap-2 bg-red-50 hover:bg-red-100 border border-red-300 text-red-700 p-3 rounded-lg transition"
                >
                  <AlertTriangle className="w-4 h-4" />
                  <span className="text-sm font-semibold">
                    Delete ALL Transactions
                  </span>
                </button>
              </div>
            )}

            {stats?.total === 0 && (
              <div className="text-center py-6">
                <p className="text-gray-600">✅ No transactions to clean up</p>
              </div>
            )}

            {/* Close Button */}
            <button
              onClick={onClose}
              className="w-full bg-gray-200 hover:bg-gray-300 text-gray-800 py-2 px-4 rounded-lg transition"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default DataCleanupModal;
