import React, { useState, useCallback } from 'react';
import { Check, AlertCircle, Loader } from 'lucide-react';
import useOfflineSync from '../hooks/useOfflineSync';

/**
 * TransactionRecorder - Component for recording transactions with offline support
 * 
 * Features:
 * - Records transactions when online
 * - Queues transactions when offline
 * - Shows real-time feedback
 * - Automatic retry on sync
 */

export function TransactionRecorder({ onSuccess, onError }) {
  const { isOnline, queueTransaction, recordTransaction } = useOfflineSync();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null); // null | 'success' | 'error' | 'queued'
  const [message, setMessage] = useState('');

  const handleRecordTransaction = useCallback(
    async (transactionData) => {
      setLoading(true);
      setStatus(null);

      try {
        if (isOnline) {
          // Online: record immediately
          const recorded = await recordTransaction(transactionData);
          setStatus('success');
          setMessage('Transaction recorded successfully');
          onSuccess?.(recorded);
        } else {
          // Offline: queue for later
          const queued = await queueTransaction(transactionData);
          setStatus('queued');
          setMessage(
            'Offline: Transaction saved locally. Will sync when online.'
          );
          onSuccess?.(queued);
        }

        setTimeout(() => {
          setStatus(null);
          setMessage('');
        }, 3000);
      } catch (error) {
        console.error('[TransactionRecorder] Error:', error);
        setStatus('error');
        setMessage(error.message || 'Failed to record transaction');
        onError?.(error);

        setTimeout(() => {
          setStatus(null);
          setMessage('');
        }, 5000);
      } finally {
        setLoading(false);
      }
    },
    [isOnline, recordTransaction, queueTransaction, onSuccess, onError]
  );

  // Feedback UI
  const renderFeedback = () => {
    if (!status || !message) return null;

    const baseClass = 'flex items-center gap-2 p-3 rounded-lg text-sm font-medium';

    switch (status) {
      case 'success':
        return (
          <div className={`${baseClass} bg-green-50 text-green-800 border border-green-200`}>
            <Check size={16} />
            {message}
          </div>
        );
      case 'queued':
        return (
          <div className={`${baseClass} bg-blue-50 text-blue-800 border border-blue-200`}>
            <AlertCircle size={16} />
            {message}
          </div>
        );
      case 'error':
        return (
          <div className={`${baseClass} bg-red-50 text-red-800 border border-red-200`}>
            <AlertCircle size={16} />
            {message}
          </div>
        );
      default:
        return null;
    }
  };

  return {
    handleRecordTransaction,
    loading,
    status,
    message,
    feedback: renderFeedback(),
    isOnline
  };
}

export default TransactionRecorder;
