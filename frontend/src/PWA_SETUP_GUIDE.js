/**
 * PWA Setup Guide - IcanEra Local-First Architecture
 * 
 * This file shows how to integrate the offline-first PWA system into your app
 */

// ============================================
// 1. APP.JSX INTEGRATION
// ============================================

import React, { useEffect, useState } from 'react';
import { offlineManager } from './lib/offlineManager';
import OfflineIndicator from './components/OfflineIndicator';
import useOfflineSync from './hooks/useOfflineSync';

export function App() {
  const { isOnline, sync } = useOfflineSync();
  const [authToken, setAuthToken] = useState(null);

  // Initialize PWA and offline support
  useEffect(() => {
    const init = async () => {
      // Get auth token from your auth system
      const token = localStorage.getItem('auth_token');
      setAuthToken(token);

      // Auto-sync when app loads if online
      if (navigator.onLine && token) {
        setTimeout(() => {
          sync(token);
        }, 2000);
      }
    };

    init();
  }, [sync]);

  // Store auth token when user logs in
  useEffect(() => {
    window.addEventListener('storage', (event) => {
      if (event.key === 'auth_token') {
        setAuthToken(event.newValue);
      }
    });
  }, []);

  return (
    <div className="app">
      {/* Your app content */}
      <YourAppContent />

      {/* Offline indicator - always at bottom right */}
      <OfflineIndicator />
    </div>
  );
}

// ============================================
// 2. TRANSACTION RECORDING EXAMPLE
// ============================================

import TransactionRecorder from './components/TransactionRecorder';

export function TransactionForm() {
  const recorder = TransactionRecorder({
    onSuccess: (transaction) => {
      console.log('Transaction recorded:', transaction);
      // Refresh UI, show success message, etc.
    },
    onError: (error) => {
      console.error('Transaction error:', error);
      // Show error message
    }
  });

  const handleSubmit = async (e) => {
    e.preventDefault();

    const transactionData = {
      type: 'expense', // or 'income'
      amount: 1000,
      category: 'supplies',
      description: 'Office supplies',
      date: new Date(),
      walletId: 'wallet_123'
      // ... other fields
    };

    await recorder.handleRecordTransaction(transactionData);
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Your form fields */}
      <button type="submit" disabled={recorder.loading}>
        {recorder.loading ? 'Recording...' : 'Record Transaction'}
      </button>

      {recorder.feedback}
    </form>
  );
}

// ============================================
// 3. MANUAL SYNC TRIGGER
// ============================================

export function SyncButton() {
  const { sync, isOnline, syncStatus, pendingCount } = useOfflineSync();
  const [token, setToken] = useState(localStorage.getItem('auth_token'));

  const handleSync = async () => {
    if (token) {
      await sync(token);
    }
  };

  if (!isOnline || pendingCount === 0) {
    return null;
  }

  return (
    <button
      onClick={handleSync}
      disabled={syncStatus === 'syncing'}
      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
    >
      {syncStatus === 'syncing' ? (
        <>
          <Loader className="inline mr-2 animate-spin" size={16} />
          Syncing...
        </>
      ) : (
        `Sync ${pendingCount} pending`
      )}
    </button>
  );
}

// ============================================
// 4. OFFLINE DATA PERSISTENCE
// ============================================

import { offlineManager } from './lib/offlineManager';

export async function saveOfflineData(key, value) {
  // Persist data that should be available offline
  await offlineManager.setOfflineData(key, value);
}

export async function getOfflineData(key) {
  // Retrieve offline data
  return await offlineManager.getOfflineData(key);
}

// ============================================
// 5. MONITORING OFFLINE OPERATIONS
// ============================================

export function OfflineMonitor() {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    const unsubscribe = offlineManager.subscribe((event) => {
      console.log('[Monitor]', event);
      setEvents((prev) => [event, ...prev].slice(0, 20)); // Keep last 20 events
    });

    return () => unsubscribe();
  }, []);

  return (
    <div className="p-4 bg-gray-100 rounded">
      <h3>Offline Events (Last 20)</h3>
      <ul className="text-xs font-mono">
        {events.map((event, i) => (
          <li key={i} className="py-1">
            [{new Date(event.timestamp || Date.now()).toLocaleTimeString()}] {event.type}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default App;
