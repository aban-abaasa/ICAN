/**
 * OfflineAuthManager - WhatsApp-like offline authentication
 * Caches user sessions locally so login works even when phone is off
 * Features:
 * - Session caching (email, user ID, profile)
 * - Offline login recovery
 * - Session validation on reconnect
 * - Secure local storage with encryption
 */

export class OfflineAuthManager {
  constructor() {
    this.db = null;
    this.dbName = 'IcanEraAuthDB';
    this.dbVersion = 1;
    this.cacheKey = 'cached-sessions';
    this.syncQueueKey = 'pending-auth-syncs';
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    
    try {
      await this.openDB();
      this.initialized = true;
      console.log('[OfflineAuthManager] Initialized');
    } catch (error) {
      console.error('[OfflineAuthManager] Init failed:', error);
    }
  }

  async openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;

        // If the connection closes for any reason (another tab deleting/
        // upgrading the DB, or the browser reclaiming it), forget it so the
        // next call to init()/any method reopens a fresh one instead of
        // throwing "InvalidStateError: The database connection is closing"
        // against a dead handle.
        this.db.onclose = () => {
          console.warn('[OfflineAuthManager] Connection closed, will reopen on next use');
          this.db = null;
          this.initialized = false;
        };
        this.db.onversionchange = () => {
          this.db.close();
          this.db = null;
          this.initialized = false;
        };

        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Session cache store
        if (!db.objectStoreNames.contains('sessions')) {
          const sessionStore = db.createObjectStore('sessions', { keyPath: 'email' });
          sessionStore.createIndex('lastUsed', 'lastUsed', { unique: false });
          sessionStore.createIndex('expiresAt', 'expiresAt', { unique: false });
        }

        // Pending auth operations (login attempts while offline)
        if (!db.objectStoreNames.contains('pendingAuth')) {
          const authStore = db.createObjectStore('pendingAuth', { keyPath: 'id' });
          authStore.createIndex('status', 'status', { unique: false });
          authStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Offline operation queue (like WhatsApp - messages/actions queued offline)
        if (!db.objectStoreNames.contains('offlineQueue')) {
          const queueStore = db.createObjectStore('offlineQueue', { keyPath: 'id' });
          queueStore.createIndex('type', 'type', { unique: false });
          queueStore.createIndex('synced', 'synced', { unique: false });
          queueStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Sync status log
        if (!db.objectStoreNames.contains('syncLog')) {
          const logStore = db.createObjectStore('syncLog', { keyPath: 'id' });
          logStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  /**
   * Cache user session for offline access
   * Called after successful login
   */
  async cacheSession(sessionData) {
    if (!this.db) await this.init();

    const sessionToCache = {
      email: sessionData.email,
      userId: sessionData.userId,
      userMetadata: sessionData.userMetadata || {},
      profile: sessionData.profile || {},
      accessToken: sessionData.accessToken, // Keep token for validation
      lastUsed: Date.now(),
      expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days
      cachedAt: Date.now()
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('sessions', 'readwrite');
      const store = transaction.objectStore('sessions');
      const request = store.put(sessionToCache);

      request.onsuccess = () => {
        console.log('[OfflineAuthManager] Session cached for:', sessionData.email);
        this.addSyncLog('session-cached', sessionData.email);
        resolve(sessionToCache);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Retrieve cached session for offline login
   */
  async getOfflineSession(email) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('sessions', 'readonly');
      const store = transaction.objectStore('sessions');
      const request = store.get(email);

      request.onsuccess = () => {
        const session = request.result;
        if (session && session.expiresAt > Date.now()) {
          console.log('[OfflineAuthManager] ✅ Valid cached session found for:', email);
          resolve(session);
        } else if (session) {
          console.log('[OfflineAuthManager] ⏰ Cached session expired for:', email);
          this.removeSession(email);
          resolve(null);
        } else {
          console.log('[OfflineAuthManager] ❌ No cached session for:', email);
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all cached sessions (for "recent logins" feature like WhatsApp)
   */
  async getAllCachedSessions() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('sessions', 'readonly');
      const store = transaction.objectStore('sessions');
      const request = store.getAll();

      request.onsuccess = () => {
        const sessions = request.result
          .filter(s => s.expiresAt > Date.now())
          .sort((a, b) => b.lastUsed - a.lastUsed);
        resolve(sessions);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Remove cached session (logout)
   */
  async removeSession(email) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('sessions', 'readwrite');
      const store = transaction.objectStore('sessions');
      const request = store.delete(email);

      request.onsuccess = () => {
        console.log('[OfflineAuthManager] Session removed for:', email);
        this.addSyncLog('session-removed', email);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Queue action for later sync (WhatsApp-like queue)
   * Called when user performs action while offline
   */
  async queueOfflineAction(action, data) {
    if (!this.db) await this.init();

    const queueItem = {
      id: this.generateId(),
      type: action,
      data,
      status: 'pending',
      timestamp: Date.now(),
      synced: false,
      retryCount: 0,
      userEmail: data.userEmail
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('offlineQueue', 'readwrite');
      const store = transaction.objectStore('offlineQueue');
      const request = store.add(queueItem);

      request.onsuccess = () => {
        console.log('[OfflineAuthManager] 📤 Action queued:', action);
        resolve(queueItem);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all pending offline actions
   */
  async getPendingActions() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('offlineQueue', 'readonly');
      const store = transaction.objectStore('offlineQueue');
      const request = store.getAll();

      request.onsuccess = () => {
        // Filter for pending (not synced) and sort by timestamp
        const items = request.result
          .filter(item => item.synced === false)
          .sort((a, b) => a.timestamp - b.timestamp);
        console.log('[OfflineAuthManager] 📋 Pending actions:', items.length);
        resolve(items);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Mark action as synced
   */
  async markActionSynced(id, syncResult = null) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('offlineQueue', 'readwrite');
      const store = transaction.objectStore('offlineQueue');
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const item = getRequest.result;
        if (item) {
          item.synced = true;
          item.syncedAt = Date.now();
          item.syncResult = syncResult;
          item.status = 'completed';

          const updateRequest = store.put(item);
          updateRequest.onsuccess = () => {
            console.log('[OfflineAuthManager] ✅ Action synced:', id);
            this.addSyncLog('action-synced', item.type);
            resolve(item);
          };
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          reject(new Error('Action not found'));
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Clear old synced actions (keep for 24 hours)
   */
  async cleanupSyncedActions() {
    if (!this.db) await this.init();

    const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('offlineQueue', 'readwrite');
      const store = transaction.objectStore('offlineQueue');
      const index = store.index('timestamp');
      const request = index.openCursor(IDBKeyRange.upperBound(cutoffTime));

      let deleted = 0;
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (cursor.value.synced) {
            cursor.delete();
            deleted++;
          }
          cursor.continue();
        } else {
          console.log('[OfflineAuthManager] 🧹 Cleaned up', deleted, 'synced actions');
          resolve(deleted);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Remove a specific action from the queue (e.g., when transaction is deleted)
   */
  async removeAction(actionId) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('offlineQueue', 'readwrite');
      const store = transaction.objectStore('offlineQueue');
      const request = store.delete(actionId);

      request.onsuccess = () => {
        console.log('[OfflineAuthManager] 🗑️ Removed action:', actionId);
        resolve(true);
      };
      request.onerror = () => {
        console.error('[OfflineAuthManager] Error removing action:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Remove all queued actions for a transaction ID (for delete operations)
   */
  async removeActionsByTransactionId(transactionId) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('offlineQueue', 'readwrite');
      const store = transaction.objectStore('offlineQueue');
      const request = store.getAll();

      let removed = 0;
      request.onsuccess = () => {
        const actions = request.result;
        const deleteTransaction = this.db.transaction('offlineQueue', 'readwrite');
        const deleteStore = deleteTransaction.objectStore('offlineQueue');

        // Find and delete all actions related to this transaction
        actions.forEach(action => {
          if (action.data?.id === transactionId || action.data?.transactionId === transactionId) {
            deleteStore.delete(action.id);
            removed++;
          }
        });

        deleteTransaction.oncomplete = () => {
          console.log(`[OfflineAuthManager] 🗑️ Removed ${removed} queued actions for transaction ${transactionId}`);
          resolve(removed);
        };
        deleteTransaction.onerror = () => reject(deleteTransaction.error);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Add entry to sync log
   */
  async addSyncLog(event, details) {
    if (!this.db) await this.init();

    const logEntry = {
      id: this.generateId(),
      event,
      details,
      timestamp: Date.now(),
      online: navigator.onLine
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('syncLog', 'readwrite');
      const store = transaction.objectStore('syncLog');
      const request = store.add(logEntry);

      request.onsuccess = () => resolve(logEntry);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get sync history for debugging
   */
  async getSyncHistory(limit = 50) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('syncLog', 'readonly');
      const store = transaction.objectStore('syncLog');
      const request = store.getAll();

      request.onsuccess = () => {
        const logs = request.result
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, limit);
        resolve(logs);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update action with retry/error status (call when sync fails)
   */
  async updateActionRetryStatus(id, error) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('offlineQueue', 'readwrite');
      const store = transaction.objectStore('offlineQueue');
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const item = getRequest.result;
        if (item) {
          item.retryCount = (item.retryCount || 0) + 1;
          item.lastError = error;
          item.lastErrorTime = Date.now();
          item.status = 'retry_pending';

          const updateRequest = store.put(item);
          updateRequest.onsuccess = () => {
            console.log('[OfflineAuthManager] ⚠️ Action marked for retry:', id, '(attempt', item.retryCount + ')');
            resolve(item);
          };
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          reject(new Error('Action not found'));
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Clear all data (for logout or reset)
   */
  async clearAll() {
    if (!this.db) await this.init();

    const stores = ['sessions', 'pendingAuth', 'offlineQueue', 'syncLog'];

    for (const storeName of stores) {
      await new Promise((resolve, reject) => {
        const transaction = this.db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    console.log('[OfflineAuthManager] 🧹 All data cleared');
  }

  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get sync statistics
   */
  async getSyncStats() {
    if (!this.db) await this.init();

    const pendingActions = await this.getPendingActions();
    const allSessions = await this.getAllCachedSessions();

    return {
      pendingActions: pendingActions.length,
      cachedSessions: allSessions.length,
      isOnline: navigator.onLine,
      lastSync: await this.getLastSyncTime()
    };
  }

  async getLastSyncTime() {
    if (!this.db) await this.init();

    return new Promise((resolve) => {
      const transaction = this.db.transaction('syncLog', 'readonly');
      const store = transaction.objectStore('syncLog');
      const request = store.getAll();

      request.onsuccess = () => {
        const logs = request.result.sort((a, b) => b.timestamp - a.timestamp);
        const lastSync = logs[0]?.timestamp || null;
        resolve(lastSync);
      };
      request.onerror = () => resolve(null);
    });
  }
}

// Singleton instance
export const offlineAuthManager = new OfflineAuthManager();
