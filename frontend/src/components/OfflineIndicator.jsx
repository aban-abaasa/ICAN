import React from 'react';
import { WifiOff, Wifi, Loader, CheckCircle, AlertCircle } from 'lucide-react';
import useOfflineSync from '../hooks/useOfflineSync';

/**
 * OfflineIndicator - Shows network status and sync progress
 * 
 * Displays:
 * - Online/offline status
 * - Pending transaction count
 * - Sync progress indicator
 * - Sync action buttons
 */

export function OfflineIndicator() {
  const { isOnline, pendingCount, syncStatus, syncMessage } = useOfflineSync();

  if (isOnline && syncStatus === 'idle' && pendingCount === 0) {
    return null; // Don't show when everything is good
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div
        className={`rounded-lg shadow-lg p-3 flex items-center gap-3 max-w-md backdrop-blur-sm ${
          isOnline
            ? syncStatus === 'syncing'
              ? 'bg-blue-50 border border-blue-200'
              : syncStatus === 'success'
              ? 'bg-green-50 border border-green-200'
              : syncStatus === 'error'
              ? 'bg-red-50 border border-red-200'
              : 'bg-gray-50 border border-gray-200'
            : 'bg-yellow-50 border border-yellow-200'
        }`}
      >
        {/* Status Icon */}
        <div className="flex-shrink-0">
          {!isOnline ? (
            <WifiOff className="text-yellow-600" size={20} />
          ) : syncStatus === 'syncing' ? (
            <Loader className="text-blue-600 animate-spin" size={20} />
          ) : syncStatus === 'success' ? (
            <CheckCircle className="text-green-600" size={20} />
          ) : syncStatus === 'error' ? (
            <AlertCircle className="text-red-600" size={20} />
          ) : (
            <Wifi className="text-green-600" size={20} />
          )}
        </div>

        {/* Text Content */}
        <div className="flex-1 min-w-0">
          <p
            className={`text-sm font-medium ${
              !isOnline
                ? 'text-yellow-900'
                : syncStatus === 'syncing'
                ? 'text-blue-900'
                : syncStatus === 'success'
                ? 'text-green-900'
                : syncStatus === 'error'
                ? 'text-red-900'
                : 'text-gray-900'
            }`}
          >
            {!isOnline ? (
              <>
                <span>Offline Mode</span>
                {pendingCount > 0 && (
                  <span className="ml-2 text-xs bg-yellow-200 px-2 py-1 rounded">
                    {pendingCount} pending
                  </span>
                )}
              </>
            ) : syncStatus === 'syncing' ? (
              'Syncing transactions...'
            ) : syncStatus === 'success' ? (
              syncMessage
            ) : syncStatus === 'error' ? (
              syncMessage || 'Sync error'
            ) : pendingCount > 0 ? (
              `${pendingCount} transaction${pendingCount !== 1 ? 's' : ''} pending sync`
            ) : (
              'Online'
            )}
          </p>
        </div>

        {/* Pending Badge */}
        {pendingCount > 0 && (
          <div className="flex-shrink-0">
            <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-red-500 text-white text-xs font-bold">
              {pendingCount > 9 ? '9+' : pendingCount}
            </span>
          </div>
        )}
      </div>

      {/* Offline Mode Explanation */}
      {!isOnline && (
        <div className="mt-2 text-xs text-yellow-600 bg-white rounded p-2 border border-yellow-200 max-w-md">
          <p className="font-semibold mb-1">Working Offline</p>
          <ul className="list-disc list-inside space-y-1">
            <li>All transactions are saved locally</li>
            <li>Sync automatically when online</li>
            <li>Works for 24 hours offline</li>
          </ul>
        </div>
      )}
    </div>
  );
}

export default OfflineIndicator;
