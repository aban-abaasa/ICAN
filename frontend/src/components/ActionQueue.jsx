/**
 * ActionQueue - Shows pending actions waiting to be synced
 * Like WhatsApp showing message status (pending, sent, delivered)
 */

import React, { useState, useEffect } from 'react';
import { offlineAuthManager } from '../lib/offlineAuthManager';

const ActionQueue = () => {
  const [pendingActions, setPendingActions] = useState([]);
  const [showQueue, setShowQueue] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  useEffect(() => {
    const updateQueue = async () => {
      try {
        const actions = await offlineAuthManager.getPendingActions();
        setPendingActions(actions);
      } catch (error) {
        console.error('Failed to load pending actions:', error);
      }
    };

    updateQueue();
    const interval = setInterval(() => {
      updateQueue();
      setLastRefresh(Date.now());
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const getActionIcon = (type) => {
    const icons = {
      'transaction': '💸',
      'expense': '💰',
      'income': '📈',
      'transfer': '🔄',
      'profile-update': '👤',
      'inventory': '📦',
      'message': '💬'
    };
    return icons[type] || '📝';
  };

  const getActionLabel = (type) => {
    const labels = {
      'transaction': 'Transaction',
      'expense': 'Expense',
      'income': 'Income',
      'transfer': 'Transfer',
      'profile-update': 'Profile Update',
      'inventory': 'Inventory',
      'message': 'Message'
    };
    return labels[type] || type;
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  };

  if (pendingActions.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-20 right-4 z-50">
      <div
        className="rounded-lg shadow-lg p-3 bg-slate-900 border border-slate-700 cursor-pointer hover:border-slate-600 transition min-w-[280px]"
        onClick={() => setShowQueue(!showQueue)}
      >
        <div className="flex items-center gap-2">
          <div className="text-orange-500 text-lg">📤</div>
          <div>
            <div className="text-sm font-semibold text-white">
              {pendingActions.length} Pending
            </div>
            <div className="text-xs text-gray-400">
              Waiting to sync
            </div>
          </div>
        </div>

        {/* Queue details */}
        {showQueue && (
          <div className="mt-3 pt-3 border-t border-slate-700 space-y-2 max-h-[300px] overflow-y-auto">
            {pendingActions.slice(0, 5).map((action, idx) => (
              <div key={action.id} className={`p-2 rounded text-xs border ${
                action.status === 'retry_pending' 
                  ? 'bg-orange-900 border-orange-700' 
                  : 'bg-slate-800 border-slate-700'
              }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 flex-1">
                    <span className="text-lg">{getActionIcon(action.type)}</span>
                    <div className="flex-1">
                      <div className="font-medium text-gray-200">
                        {getActionLabel(action.type)}
                      </div>
                      <div className="text-gray-400 mt-1">
                        {action.data?.description || action.data?.amount || 'No details'}
                      </div>
                      <div className="text-gray-500 mt-1">
                        {formatTime(action.timestamp)}
                      </div>
                      {action.lastError && (
                        <div className="text-orange-300 mt-1 text-xs">
                          {action.lastError}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    {action.retryCount > 0 && (
                      <div className="text-xs bg-orange-900 text-orange-300 px-2 py-1 rounded">
                        Retry {action.retryCount}
                      </div>
                    )}
                    {action.status === 'retry_pending' && (
                      <div className="text-xs bg-orange-900 text-orange-300 px-2 py-1 rounded animate-pulse">
                        Retrying...
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {pendingActions.length > 5 && (
              <div className="text-xs text-gray-500 text-center py-2">
                +{pendingActions.length - 5} more pending...
              </div>
            )}

            {/* Info */}
            <div className="text-xs text-gray-400 mt-3 p-2 bg-slate-800 rounded border border-slate-700">
              💡 These actions will automatically sync when you're online.
            </div>

            {/* Sync status */}
            {!navigator.onLine && (
              <div className="text-xs text-orange-400 mt-2 p-2 bg-orange-900 rounded border border-orange-700">
                📴 You're offline. Sync will begin when connection is restored.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ActionQueue;
