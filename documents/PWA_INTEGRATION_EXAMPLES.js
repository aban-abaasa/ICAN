/**
 * PWA Transaction Recording Integration Examples
 * 
 * Shows how to integrate offline-first transaction recording
 * with existing wallet and financial transaction flows
 */

// ============================================
// EXAMPLE 1: INTEGRATING WITH WALLET SEND
// ============================================

/*
Before (Online-only):
```
// frontend/src/services/walletTransactionService.js
async saveSend(params) {
  const { data, error } = await supabase
    .from('ican_transactions')
    .insert([...])
    .select();
  
  return { success: !error, data, error };
}
```

After (Offline-first):
*/

import { offlineTransactionManager } from '@/lib/offlineTransactionManager';

async function saveSendWithOfflineSupport(params) {
  try {
    // Record with offline support
    const result = await offlineTransactionManager.recordWalletTransaction({
      id: undefined,                    // Will be auto-generated
      subType: 'send',
      amount: params.amount,
      currency: params.currency,
      phoneNumber: params.recipientPhone,
      paymentMethod: params.paymentMethod,
      transactionId: params.transactionId,
      description: params.description,
      source: 'wallet_send'
    });

    return result;
    // Returns:
    // {
    //   success: true,
    //   id: "tx_123456",
    //   status: "recorded" (online) or "queued" (offline),
    //   message: "...",
    //   transaction: {...}
    // }
  } catch (error) {
    console.error('Error recording send:', error);
    throw error;
  }
}

// ============================================
// EXAMPLE 2: INTEGRATING WITH WALLET RECEIVE
// ============================================

/*
Use case: User receives payment via QR code
*/

async function saveReceiveWithOfflineSupport(params) {
  try {
    const result = await offlineTransactionManager.recordWalletTransaction({
      subType: 'receive',
      amount: params.amount,
      currency: params.currency,
      phoneNumber: params.senderPhone,
      paymentMethod: params.paymentMethod,
      transactionId: params.transactionId,
      description: params.description,
      source: 'wallet_receive'
    });

    return result;
  } catch (error) {
    console.error('Error recording receive:', error);
    throw error;
  }
}

// ============================================
// EXAMPLE 3: INTEGRATING WITH WALLET TOPUP
// ============================================

async function saveTopUpWithOfflineSupport(params) {
  try {
    const result = await offlineTransactionManager.recordWalletTransaction({
      subType: 'topup',
      amount: params.amount,
      currency: params.currency,
      phoneNumber: params.phoneNumber,
      paymentMethod: params.paymentMethod, // 'MOMO', 'CARD', etc
      transactionId: params.transactionId,
      description: `Top-up via ${params.paymentMethod}`,
      source: 'wallet_topup'
    });

    return result;
  } catch (error) {
    console.error('Error recording topup:', error);
    throw error;
  }
}

// ============================================
// EXAMPLE 4: INTEGRATING WITH FINANCIAL TX
// ============================================

/*
Use case: User records income/expense
*/

async function createTransactionWithOfflineSupport(params) {
  try {
    const result = await offlineTransactionManager.recordFinancialTransaction({
      transactionType: params.transactionType, // 'income', 'expense', 'loan', etc
      amount: params.amount,
      currency: params.currency,
      category: params.category,
      subCategory: params.subCategory,
      description: params.description,
      transactionDate: params.transactionDate,
      source: params.source || 'manual',
      aiCategorized: params.aiCategorized,
      aiConfidence: params.aiConfidence,
      isRecurring: params.isRecurring,
      recurrencePattern: params.recurrencePattern
    });

    return result;
  } catch (error) {
    console.error('Error creating transaction:', error);
    throw error;
  }
}

// ============================================
// EXAMPLE 5: REACT COMPONENT WITH OFFLINE SUPPORT
// ============================================

import React, { useState } from 'react';
import { useOfflineSync } from '@/hooks/useOfflineSync';

export function WalletSendForm() {
  const { isOnline, recordTransaction, syncStatus } = useOfflineSync();
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const handleSend = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const result = await recordTransaction({
        type: 'wallet_transaction',
        subType: 'send',
        amount: parseFloat(amount),
        currency: 'UGX',
        phoneNumber: phone,
        paymentMethod: 'MOMO',
        description: `Send to ${phone}`
      });

      // Show status based on online/offline
      if (result.status === 'recorded') {
        setFeedback({
          type: 'success',
          message: '✅ Transaction sent and synced'
        });
      } else if (result.status === 'queued') {
        setFeedback({
          type: 'info',
          message: '⏳ Offline: Saved locally, will sync when online'
        });
      }

      // Clear form
      setAmount('');
      setPhone('');
    } catch (error) {
      setFeedback({
        type: 'error',
        message: `❌ Error: ${error.message}`
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSend} className="p-4 bg-white rounded-lg">
      <div className="space-y-4">
        {!isOnline && (
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-yellow-800">
            📡 You're offline. Transactions will be saved locally.
          </div>
        )}

        <input
          type="number"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full px-3 py-2 border rounded"
          required
        />

        <input
          type="tel"
          placeholder="Phone number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="w-full px-3 py-2 border rounded"
          required
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-purple-600 text-white py-2 rounded hover:bg-purple-700 disabled:opacity-50"
        >
          {loading ? 'Processing...' : 'Send Money'}
        </button>

        {feedback && (
          <div className={`p-3 rounded ${
            feedback.type === 'success' ? 'bg-green-50 text-green-800' :
            feedback.type === 'info' ? 'bg-blue-50 text-blue-800' :
            'bg-red-50 text-red-800'
          }`}>
            {feedback.message}
          </div>
        )}

        {syncStatus === 'syncing' && <p className="text-blue-600">⏳ Syncing...</p>}
      </div>
    </form>
  );
}

// ============================================
// EXAMPLE 6: VIEWING OFFLINE TRANSACTION HISTORY
// ============================================

import { useEffect } from 'react';

export function OfflineTransactionHistory() {
  const [transactions, setTransactions] = useState([]);
  const [stats, setStats] = useState(null);
  const { isOnline } = useOfflineSync();

  useEffect(() => {
    const loadTransactions = async () => {
      try {
        // Get all local transactions
        const allTxs = await offlineTransactionManager.getAllTransactions();
        setTransactions(allTxs);

        // Get statistics
        const stats = await offlineTransactionManager.getOfflineStats();
        setStats(stats);
      } catch (error) {
        console.error('Error loading transactions:', error);
      }
    };

    loadTransactions();

    // Reload when coming online
    const handleOnline = () => loadTransactions();
    window.addEventListener('online', handleOnline);
    
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  if (!stats) return <div>Loading...</div>;

  return (
    <div className="p-4 space-y-4">
      {/* Statistics */}
      <div className="bg-blue-50 p-4 rounded-lg">
        <h3 className="font-bold mb-2">📊 Offline Statistics</h3>
        <div className="text-sm space-y-1">
          <p>Total transactions: <strong>{stats.totalTransactions}</strong></p>
          <p>Pending sync: <strong>{stats.pendingTransactions}</strong></p>
          <p>Total amount: <strong>UGX {stats.totalAmount.toLocaleString()}</strong></p>
          <p>Last sync: <strong>{stats.lastSyncTime ? new Date(stats.lastSyncTime).toLocaleString() : 'Never'}</strong></p>
        </div>
      </div>

      {/* Status Alert */}
      {stats.pendingTransactions > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 p-3 rounded">
          {!isOnline ? (
            <p>⏳ <strong>{stats.pendingTransactions}</strong> transaction{stats.pendingTransactions > 1 ? 's' : ''} waiting to sync when you go online</p>
          ) : (
            <p>⚠️ <strong>{stats.pendingTransactions}</strong> transaction{stats.pendingTransactions > 1 ? 's' : ''} still pending sync</p>
          )}
        </div>
      )}

      {/* Transaction List */}
      <div>
        <h3 className="font-bold mb-2">💾 Stored Transactions</h3>
        <div className="space-y-2">
          {transactions.slice(0, 10).map((tx) => (
            <div key={tx.id} className={`p-3 rounded border ${tx.synced ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-medium">{tx.description || 'Transaction'}</p>
                  <p className="text-xs text-gray-600">
                    {tx.type === 'wallet_transaction' ? `${tx.subType.toUpperCase()}` : tx.transactionType.toUpperCase()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold">{tx.currency} {tx.amount}</p>
                  <p className="text-xs">{tx.synced ? '✅ Synced' : '⏳ Pending'}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================
// EXAMPLE 7: MANUAL SYNC BUTTON
// ============================================

export function SyncButton() {
  const { isOnline, syncStatus, sync } = useOfflineSync();
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    if (!isOnline) {
      alert('You are offline. Please connect to the internet.');
      return;
    }

    setSyncing(true);
    try {
      const token = localStorage.getItem('auth_token');
      await offlineTransactionManager.syncAllTransactions(token);
    } catch (error) {
      console.error('Sync error:', error);
      alert('Sync failed: ' + error.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <button
      onClick={handleSync}
      disabled={!isOnline || syncing || syncStatus === 'syncing'}
      className={`px-4 py-2 rounded font-medium ${
        isOnline
          ? 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
          : 'bg-gray-400 text-white cursor-not-allowed'
      }`}
    >
      {syncStatus === 'syncing' || syncing ? (
        '⏳ Syncing...'
      ) : isOnline ? (
        '🔄 Sync Now'
      ) : (
        '📡 Offline'
      )}
    </button>
  );
}

// ============================================
// EXAMPLE 8: BACKGROUND SYNC SETUP
// ============================================

export async function setupBackgroundSync() {
  try {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      const registration = await navigator.serviceWorker.ready;
      
      // Request background sync for transactions
      await registration.sync.register('sync-transactions');
      console.log('✅ Background sync registered');
      
      // Auto-sync every hour
      setInterval(async () => {
        try {
          const token = localStorage.getItem('auth_token');
          await offlineTransactionManager.syncAllTransactions(token);
        } catch (error) {
          console.error('Auto-sync error:', error);
        }
      }, 60 * 60 * 1000);
    }
  } catch (error) {
    console.warn('Background sync not available:', error);
  }
}

// Call in App.jsx useEffect:
// useEffect(() => {
//   setupBackgroundSync();
// }, []);

// ============================================
// EXPORT FOR USE IN COMPONENTS
// ============================================

export {
  saveSendWithOfflineSupport,
  saveReceiveWithOfflineSupport,
  saveTopUpWithOfflineSupport,
  createTransactionWithOfflineSupport,
  offlineTransactionManager
};
