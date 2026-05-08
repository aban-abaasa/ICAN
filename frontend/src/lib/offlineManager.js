/**
 * OfflineManager - Handles local-first transaction management
 * Features:
 * - Queue transactions when offline
 * - Auto-sync when online
 * - IndexedDB persistence
 * - Conflict resolution
 * - Network state detection
 */

export class OfflineManager {
  constructor() {
    this.db = null;
    this.isOnline = navigator.onLine;
    this.listeners = new Set();
    this.syncInProgress = false;
    this.dbName = 'IcanEraLocalDB';
    this.dbVersion = 1;
    
    this.init();
  }

  async init() {
    try {
      // Register service worker
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/'
        });
        console.log('[OfflineManager] Service Worker registered:', registration);
      }

      // Open IndexedDB
      await this.openDB();

      // Listen to online/offline events
      window.addEventListener('online', () => this.handleOnline());
      window.addEventListener('offline', () => this.handleOffline());

      // Listen to service worker messages
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
          this.handleSWMessage(event.data);
        });
      }

      console.log('[OfflineManager] Initialization complete');
    } catch (error) {
      console.error('[OfflineManager] Initialization error:', error);
    }
  }

  // ============================================
  // DATABASE OPERATIONS
  // ============================================

  async openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        console.log('[OfflineManager] Database opened');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Transactions store
        if (!db.objectStoreNames.contains('transactions')) {
          const txStore = db.createObjectStore('transactions', { keyPath: 'id' });
          txStore.createIndex('status', 'status', { unique: false });
          txStore.createIndex('timestamp', 'timestamp', { unique: false });
          txStore.createIndex('synced', 'synced', { unique: false });
        }

        // Pending queue
        if (!db.objectStoreNames.contains('pending')) {
          const pendingStore = db.createObjectStore('pending', { keyPath: 'id' });
          pendingStore.createIndex('synced', 'synced', { unique: false });
          pendingStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Offline metadata
        if (!db.objectStoreNames.contains('offlineData')) {
          db.createObjectStore('offlineData', { keyPath: 'key' });
        }

        // Sync log
        if (!db.objectStoreNames.contains('syncLog')) {
          const logStore = db.createObjectStore('syncLog', { keyPath: 'id' });
          logStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  // ============================================
  // TRANSACTION MANAGEMENT
  // ============================================

  async recordTransaction(transaction) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const tx = {
      id: transaction.id || this.generateId(),
      ...transaction,
      timestamp: transaction.timestamp || Date.now(),
      synced: false,
      localOnly: true,
      retryCount: 0
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('transactions', 'readwrite');
      const store = transaction.objectStore('transactions');
      const request = store.add(tx);

      request.onsuccess = () => {
        console.log('[OfflineManager] Transaction recorded:', tx.id);
        this.notifyListeners({
          type: 'transaction-recorded',
          transaction: tx
        });
        resolve(tx);
      };

      request.onerror = () => reject(request.error);
    });
  }

  async queueTransaction(transaction, targetApi = '/api/transactions') {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const queuedTx = {
      id: this.generateId(),
      originalId: transaction.id,
      data: transaction,
      targetApi,
      timestamp: Date.now(),
      synced: false,
      retryCount: 0
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('pending', 'readwrite');
      const store = tx.objectStore('pending');
      const request = store.add(queuedTx);

      request.onsuccess = () => {
        console.log('[OfflineManager] Transaction queued:', queuedTx.id);
        
        // Request background sync
        this.requestBackgroundSync('sync-transactions');

        this.notifyListeners({
          type: 'transaction-queued',
          transaction: queuedTx
        });
        resolve(queuedTx);
      };

      request.onerror = () => reject(request.error);
    });
  }

  async getPendingTransactions() {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('pending', 'readonly');
      const store = tx.objectStore('pending');
      const index = store.index('synced');
      const range = IDBKeyRange.only(false);
      const request = index.getAll(range);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllTransactions() {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('transactions', 'readonly');
      const store = tx.objectStore('transactions');
      const request = store.getAll();

      request.onsuccess = () => {
        // Sort by timestamp descending
        const transactions = request.result.sort((a, b) => b.timestamp - a.timestamp);
        resolve(transactions);
      };

      request.onerror = () => reject(request.error);
    });
  }

  async markTransactionSynced(transactionId) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('pending', 'readwrite');
      const store = tx.objectStore('pending');
      const request = store.get(transactionId);

      request.onsuccess = () => {
        const data = request.result;
        if (data) {
          data.synced = true;
          data.syncedAt = Date.now();
          const updateRequest = store.put(data);
          updateRequest.onsuccess = () => {
            console.log('[OfflineManager] Transaction marked synced:', transactionId);
            resolve();
          };
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          resolve();
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  // ============================================
  // SYNC OPERATIONS
  // ============================================

  async syncTransactions(authToken) {
    if (this.syncInProgress || !this.isOnline) {
      console.log('[OfflineManager] Sync skipped - in progress or offline');
      return;
    }

    this.syncInProgress = true;
    this.notifyListeners({ type: 'sync-started' });

    try {
      const pending = await this.getPendingTransactions();
      console.log('[OfflineManager] Syncing', pending.length, 'transactions');

      let synced = 0;
      let failed = 0;

      for (const item of pending) {
        try {
          const response = await fetch(item.targetApi, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(item.data)
          });

          if (response.ok) {
            await this.markTransactionSynced(item.id);
            synced++;
          } else {
            failed++;
            console.warn('[OfflineManager] Sync failed for:', item.id, response.status);
          }
        } catch (error) {
          failed++;
          console.error('[OfflineManager] Sync error:', error);
        }
      }

      console.log('[OfflineManager] Sync complete:', synced, 'synced,', failed, 'failed');

      this.notifyListeners({
        type: 'sync-complete',
        synced,
        failed,
        total: pending.length
      });
    } catch (error) {
      console.error('[OfflineManager] Sync error:', error);
      this.notifyListeners({
        type: 'sync-error',
        error: error.message
      });
    } finally {
      this.syncInProgress = false;
    }
  }

  async requestBackgroundSync(tag = 'sync-transactions') {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.sync.register(tag);
        console.log('[OfflineManager] Background sync registered:', tag);
      } catch (error) {
        console.warn('[OfflineManager] Background sync not available:', error);
      }
    }
  }

  async forceSyncNow(authToken) {
    await this.syncTransactions(authToken);
  }

  // ============================================
  // NETWORK STATE
  // ============================================

  async handleOnline() {
    console.log('[OfflineManager] Online');
    this.isOnline = true;
    this.notifyListeners({ type: 'online' });

    // Auto-sync when coming online
    const token = await this.getAuthTokenFromStorage();
    if (token) {
      await this.syncTransactions(token);
    }
  }

  handleOffline() {
    console.log('[OfflineManager] Offline');
    this.isOnline = false;
    this.notifyListeners({ type: 'offline' });
  }

  // ============================================
  // SERVICE WORKER COMMUNICATION
  // ============================================

  handleSWMessage(message) {
    console.log('[OfflineManager] SW Message:', message);

    if (message.type === 'sync-complete') {
      this.notifyListeners({
        type: 'background-sync-complete',
        message: message.message
      });
    }

    if (message.type === 'full-sync-complete') {
      this.notifyListeners({
        type: 'background-full-sync-complete',
        message: message.message
      });
    }
  }

  // ============================================
  // OFFLINE METADATA
  // ============================================

  async setOfflineData(key, value) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('offlineData', 'readwrite');
      const store = tx.objectStore('offlineData');
      const request = store.put({ key, value, timestamp: Date.now() });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getOfflineData(key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('offlineData', 'readonly');
      const store = tx.objectStore('offlineData');
      const request = store.get(key);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.value : null);
      };

      request.onerror = () => reject(request.error);
    });
  }

  // ============================================
  // LISTENER MANAGEMENT
  // ============================================

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyListeners(event) {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error('[OfflineManager] Listener error:', error);
      }
    });
  }

  // ============================================
  // UTILITIES
  // ============================================

  generateId() {
    return 'tx_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  async getAuthTokenFromStorage() {
    // Get from localStorage or sessionStorage
    return localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
  }

  getStatus() {
    return {
      isOnline: this.isOnline,
      syncInProgress: this.syncInProgress,
      dbReady: this.db !== null
    };
  }
}

// Singleton instance
export const offlineManager = new OfflineManager();

export default offlineManager;
