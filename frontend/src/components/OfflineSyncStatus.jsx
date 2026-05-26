/**
 * OfflineSyncStatus - WhatsApp-like sync status indicator
 * Shows sync progress, queued actions, and connection status
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

const OfflineSyncStatus = () => {
  const { isOfflineMode, syncStatus, syncManager, queueAction, getSyncStatus } = useAuth();
  const [stats, setStats] = useState({
    pendingActions: 0,
    cachedSessions: 0,
    isOnline: navigator.onLine
  });
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    const updateStats = async () => {
      const status = await getSyncStatus();
      setStats(status);
    };

    updateStats();
    const interval = setInterval(updateStats, 2000);

    return () => clearInterval(interval);
  }, [getSyncStatus]);

  // WhatsApp-like status messages
  const getStatusMessage = () => {
    if (syncStatus?.status === 'syncing') {
      return '🔄 Syncing...';
    } else if (syncStatus?.status === 'synced') {
      return '✅ Synced';
    } else if (syncStatus?.status === 'sync-error') {
      return '⚠️ Sync failed';
    } else if (!navigator.onLine) {
      return '📴 Offline';
    }
    return '🌐 Online';
  };

  const getStatusColor = () => {
    if (syncStatus?.status === 'syncing') return 'text-blue-500';
    if (syncStatus?.status === 'synced') return 'text-green-500';
    if (syncStatus?.status === 'sync-error') return 'text-orange-500';
    if (!navigator.onLine) return 'text-red-500';
    return 'text-gray-500';
  };

  if (!isOfflineMode && navigator.onLine && stats.pendingActions === 0) {
    return null; // Don't show if everything is normal and online
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div
        className="rounded-lg shadow-lg p-3 bg-slate-900 border border-slate-700 cursor-pointer hover:border-slate-600 transition"
        onClick={() => setShowDetails(!showDetails)}
      >
        <div className="flex items-center gap-2">
          <div className={`text-lg ${getStatusColor()}`}>
            {getStatusMessage()}
          </div>
          {stats.pendingActions > 0 && (
            <div className="bg-orange-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
              {stats.pendingActions > 99 ? '99+' : stats.pendingActions}
            </div>
          )}
        </div>

        {/* Detailed status popup */}
        {showDetails && (
          <div className="absolute bottom-full mb-2 right-0 bg-slate-800 border border-slate-700 rounded-lg p-4 text-sm text-gray-300 min-w-[250px]">
            <div className="space-y-2">
              <div className="font-semibold text-white border-b border-slate-700 pb-2">
                Sync Status
              </div>

              {/* Status */}
              <div className="flex justify-between">
                <span>Status:</span>
                <span className={getStatusColor()}>{getStatusMessage()}</span>
              </div>

              {/* Connection */}
              <div className="flex justify-between">
                <span>Connection:</span>
                <span className={navigator.onLine ? 'text-green-400' : 'text-red-400'}>
                  {navigator.onLine ? 'Online 🌐' : 'Offline 📴'}
                </span>
              </div>

              {/* Pending actions */}
              {stats.pendingActions > 0 && (
                <div className="flex justify-between">
                  <span>Queued Actions:</span>
                  <span className="text-orange-400">{stats.pendingActions}</span>
                </div>
              )}

              {/* Cached sessions */}
              {stats.cachedSessions > 0 && (
                <div className="flex justify-between">
                  <span>Cached Sessions:</span>
                  <span className="text-blue-400">{stats.cachedSessions}</span>
                </div>
              )}

              {/* Last sync time */}
              {stats.lastSync && (
                <div className="flex justify-between text-xs mt-2">
                  <span>Last Sync:</span>
                  <span>{new Date(stats.lastSync).toLocaleTimeString()}</span>
                </div>
              )}

              {/* Sync message */}
              {syncStatus?.message && (
                <div className="mt-3 p-2 bg-slate-700 rounded text-gray-300 text-xs border-l-2 border-blue-500">
                  {syncStatus.message}
                </div>
              )}

              {/* Manual sync button */}
              {navigator.onLine && stats.pendingActions > 0 && syncStatus?.status !== 'syncing' && (
                <button
                  onClick={() => {
                    // Trigger manual sync through the sync manager
                    window.dispatchEvent(new CustomEvent('manual-sync'));
                  }}
                  className="mt-3 w-full bg-blue-600 hover:bg-blue-700 text-white text-xs py-2 rounded transition"
                >
                  🔄 Sync Now
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OfflineSyncStatus;
