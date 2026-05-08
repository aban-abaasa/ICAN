import { useEffect, useState, useCallback } from 'react';
import { offlineManager } from '../lib/offlineManager';

/**
 * useOfflineSync - React hook for managing offline state and transactions
 * 
 * Usage:
 * const { isOnline, pending, sync, recordTransaction, status } = useOfflineSync();
 */

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingTransactions, setPendingTransactions] = useState([]);
  const [syncStatus, setSyncStatus] = useState('idle'); // idle, syncing, success, error
  const [syncMessage, setSyncMessage] = useState('');

  // Load pending transactions on mount
  useEffect(() => {
    const loadPending = async () => {
      try {
        const pending = await offlineManager.getPendingTransactions();
        setPendingTransactions(pending);
      } catch (error) {
        console.error('[useOfflineSync] Error loading pending:', error);
      }
    };

    loadPending();

    // Subscribe to offline manager events
    const unsubscribe = offlineManager.subscribe((event) => {
      handleOfflineManagerEvent(event);
    });

    return () => unsubscribe();
  }, []);

  const handleOfflineManagerEvent = (event) => {
    switch (event.type) {
      case 'online':
        setIsOnline(true);
        break;
      case 'offline':
        setIsOnline(false);
        break;
      case 'transaction-recorded':
        // Update pending list
        break;
      case 'transaction-queued':
        setPendingTransactions((prev) => [...prev, event.transaction]);
        break;
      case 'sync-started':
        setSyncStatus('syncing');
        setSyncMessage('Syncing transactions...');
        break;
      case 'sync-complete':
        setSyncStatus('success');
        setSyncMessage(
          `Synced ${event.synced}/${event.total} transactions${
            event.failed > 0 ? ` (${event.failed} failed)` : ''
          }`
        );
        setPendingTransactions([]);
        setTimeout(() => setSyncStatus('idle'), 3000);
        break;
      case 'sync-error':
        setSyncStatus('error');
        setSyncMessage(`Sync error: ${event.error}`);
        setTimeout(() => setSyncStatus('idle'), 5000);
        break;
      default:
        break;
    }
  };

  // Record a transaction
  const recordTransaction = useCallback(
    async (transaction) => {
      try {
        const recorded = await offlineManager.recordTransaction(transaction);
        return recorded;
      } catch (error) {
        console.error('[useOfflineSync] Error recording transaction:', error);
        throw error;
      }
    },
    []
  );

  // Queue a transaction for sync
  const queueTransaction = useCallback(
    async (transaction, targetApi = '/api/transactions') => {
      try {
        const queued = await offlineManager.queueTransaction(transaction, targetApi);
        return queued;
      } catch (error) {
        console.error('[useOfflineSync] Error queuing transaction:', error);
        throw error;
      }
    },
    []
  );

  // Manual sync trigger
  const sync = useCallback(
    async (authToken) => {
      if (!authToken) {
        setSyncMessage('No authentication token');
        return;
      }

      try {
        await offlineManager.syncTransactions(authToken);
      } catch (error) {
        console.error('[useOfflineSync] Error during sync:', error);
        setSyncStatus('error');
        setSyncMessage(error.message);
      }
    },
    []
  );

  // Get offline manager status
  const getStatus = useCallback(() => {
    return offlineManager.getStatus();
  }, []);

  return {
    isOnline,
    pendingTransactions,
    pendingCount: pendingTransactions.length,
    syncStatus,
    syncMessage,
    recordTransaction,
    queueTransaction,
    sync,
    getStatus
  };
}

export default useOfflineSync;
