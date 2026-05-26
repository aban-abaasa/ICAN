/**
 * SyncManager - WhatsApp-like auto-sync functionality
 * Automatically syncs all queued actions when back online
 * Features:
 * - Auto-detect online/offline
 * - Queue retry with exponential backoff
 * - Priority-based syncing
 * - Conflict resolution
 * - Real-time sync status callbacks
 */

import { offlineAuthManager } from './offlineAuthManager';
import { getSupabaseClient } from './supabase/client';

export class SyncManager {
  constructor() {
    this.isSyncing = false;
    this.syncListeners = new Set();
    this.retryIntervals = [1000, 3000, 5000, 10000]; // Progressive backoff
    this.maxRetries = 4;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    console.log('[SyncManager] Initializing...');

    // Listen for online/offline events
    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());

    // Listen for service worker messages about sync
    if ('serviceWorker' in navigator && 'controller' in navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data.type === 'SYNC_COMPLETE') {
          this.handleSyncComplete(event.data);
        }
      });
    }

    // Request background sync permission
    this.requestBackgroundSyncPermission();

    // Initial sync check
    if (navigator.onLine) {
      await this.performSync();
    }

    this.initialized = true;
    console.log('[SyncManager] Initialized');
  }

  /**
   * Request background sync permission
   */
  async requestBackgroundSyncPermission() {
    if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      if (registration.sync) {
        console.log('[SyncManager] Background Sync API supported');
      }
    } catch (error) {
      console.warn('[SyncManager] Background Sync not available:', error.message);
    }
  }

  /**
   * Register sync listener for UI updates
   */
  onSyncStateChange(callback) {
    this.syncListeners.add(callback);
    return () => this.syncListeners.delete(callback);
  }

  /**
   * Notify all listeners of sync state change
   */
  notifySyncStateChange(state) {
    this.syncListeners.forEach(listener => {
      try {
        listener(state);
      } catch (error) {
        console.error('Error in sync listener:', error);
      }
    });
  }

  /**
   * Handle online event - start syncing
   */
  async handleOnline() {
    console.log('[SyncManager] 🌐 Device back online');
    this.notifySyncStateChange({
      status: 'syncing',
      message: 'Syncing queued actions...',
      isOnline: true
    });

    // Brief delay to ensure stable connection
    await new Promise(resolve => setTimeout(resolve, 1000));

    await this.performSync();
  }

  /**
   * Handle offline event
   */
  handleOffline() {
    console.log('[SyncManager] 📴 Device offline');
    this.notifySyncStateChange({
      status: 'offline',
      message: 'App working offline. Changes will sync when online.',
      isOnline: false
    });
  }

  /**
   * Perform full sync cycle
   */
  async performSync() {
    if (this.isSyncing || !navigator.onLine) {
      console.log('[SyncManager] Sync skipped - already syncing or offline');
      return;
    }

    this.isSyncing = true;
    const startTime = Date.now();

    try {
      console.log('[SyncManager] 🔄 Starting sync cycle...');

      // Get pending actions
      const pendingActions = await offlineAuthManager.getPendingActions();
      console.log('[SyncManager] Found', pendingActions.length, 'pending actions');

      if (pendingActions.length === 0) {
        console.log('[SyncManager] ✅ No actions to sync');
        this.notifySyncStateChange({
          status: 'synced',
          message: 'All changes synced',
          isOnline: true,
          syncedCount: 0
        });
        return;
      }

      let syncedCount = 0;
      let failedCount = 0;
      const failures = [];

      // Sync each action
      for (const action of pendingActions) {
        try {
          const success = await this.syncAction(action);
          if (success) {
            await offlineAuthManager.markActionSynced(action.id, { success: true });
            syncedCount++;
            console.log(`[SyncManager] ✅ Synced action: ${action.type}`);
          } else {
            failedCount++;
            failures.push(action);
            await offlineAuthManager.updateActionRetryStatus(action.id, 'Sync failed - will retry');
          }
        } catch (error) {
          console.error(`[SyncManager] ❌ Failed to sync action:`, error);
          failedCount++;
          failures.push(action);
          await offlineAuthManager.updateActionRetryStatus(action.id, error.message);
        }
      }

      // Cleanup old synced actions
      await offlineAuthManager.cleanupSyncedActions();

      const syncTime = Date.now() - startTime;

      if (failedCount === 0) {
        console.log('[SyncManager] ✅ Sync complete -', syncedCount, 'actions synced in', syncTime, 'ms');
        this.notifySyncStateChange({
          status: 'synced',
          message: `Synced ${syncedCount} action${syncedCount !== 1 ? 's' : ''}`,
          isOnline: true,
          syncedCount,
          timestamp: Date.now()
        });
      } else {
        console.warn('[SyncManager] ⚠️ Sync completed with errors -', syncedCount, 'synced,', failedCount, 'failed');
        this.notifySyncStateChange({
          status: 'sync-error',
          message: `Synced ${syncedCount} action${syncedCount !== 1 ? 's' : ''}, ${failedCount} failed. Will retry.`,
          isOnline: true,
          syncedCount,
          failedCount,
          timestamp: Date.now()
        });

        // Retry failed actions
        await this.retryFailedActions(failures);
      }
    } catch (error) {
      console.error('[SyncManager] Sync cycle error:', error);
      this.notifySyncStateChange({
        status: 'sync-error',
        message: 'Sync failed: ' + error.message,
        isOnline: true
      });
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Sync a single action to Supabase
   */
  async syncAction(action) {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        console.warn('[SyncManager] Supabase not available');
        return false;
      }

      // Route action to appropriate handler
      switch (action.type) {
        case 'transaction':
          return await this.syncTransaction(action, supabase);
        case 'expense':
          return await this.syncExpense(action, supabase);
        case 'income':
          return await this.syncIncome(action, supabase);
        case 'transfer':
          return await this.syncTransfer(action, supabase);
        case 'profile-update':
          return await this.syncProfileUpdate(action, supabase);
        case 'inventory':
          return await this.syncInventory(action, supabase);
        default:
          console.warn('[SyncManager] Unknown action type:', action.type);
          return false;
      }
    } catch (error) {
      console.error('[SyncManager] Error syncing action:', error);
      return false;
    }
  }

  /**
   * Sync transaction - Transform queued data to Supabase schema
   */
  async syncTransaction(action, supabase) {
    try {
      const txData = action.data;
      
      // Get current authenticated user to validate ownership
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const currentUserId = authUser?.id;
      
      console.log('[SyncManager] 🔍 Sync details:');
      console.log('  - Queued userId:', txData.userId);
      console.log('  - Current auth userId:', currentUserId);
      
      if (!currentUserId) {
        console.error('[SyncManager] ❌ No authenticated user - cannot sync');
        return false;
      }

      // Use current authenticated user ID (not queued one) for RLS compliance
      const userIdToUse = currentUserId;
      
      // Transform field names to match Supabase schema
      const syncData = {
        user_id: userIdToUse,  // Use auth.uid() for RLS policy compliance
        amount: parseFloat(txData.amount) || 0,
        transaction_type: txData.type || txData.transaction_type || 'expense',
        description: txData.description || 'Transaction',
        currency: txData.currency || 'UGX',
        status: 'completed',
        created_at: txData.date || txData.created_at || new Date().toISOString(),
        metadata: {
          category: txData.category || 'other',
          source: txData.source || 'offline_sync',
          record_category: txData.record_category || 'personal',
          accounting_type: txData.accounting_type || null,
          reporting_bucket: txData.reporting_bucket || null,
          product_name: txData.product_name || null,
          product_action: txData.product_action || null,
          ledger_side: txData.ledger_side || null,
          raw_entry_text: txData.raw_entry_text || null,
          entry_mode: txData.entry_mode || null,
          synced_from_offline: true,
          sync_timestamp: new Date().toISOString()
        }
      };

      console.log('[SyncManager] 📤 Syncing with data:', syncData);

      const { data, error } = await supabase
        .from('ican_transactions')
        .insert([syncData])
        .select()
        .single();

      if (error) {
        console.error('[SyncManager] ❌ Sync error:', error.message);
        console.error('[SyncManager] Full error details:', error);
        return false;
      }

      console.log('[SyncManager] ✅ Transaction synced:', data?.id);
      return true;
    } catch (error) {
      console.error('[SyncManager] ❌ Sync exception:', error.message);
      console.error('[SyncManager] Stack:', error);
      return false;
    }
  }

  /**
   * Sync expense - delegate to transaction sync
   */
  async syncExpense(action, supabase) {
    // Expense is just a transaction with type 'expense'
    const expenseAction = {
      ...action,
      data: {
        ...action.data,
        type: 'expense'
      }
    };
    return this.syncTransaction(expenseAction, supabase);
  }

  /**
   * Sync income - delegate to transaction sync
   */
  async syncIncome(action, supabase) {
    // Income is just a transaction with type 'income'
    const incomeAction = {
      ...action,
      data: {
        ...action.data,
        type: 'income'
      }
    };
    return this.syncTransaction(incomeAction, supabase);
  }

  /**
   * Sync transfer - delegate to transaction sync
   */
  async syncTransfer(action, supabase) {
    // Transfer is just a transaction with type 'transfer'
    const transferAction = {
      ...action,
      data: {
        ...action.data,
        type: 'transfer'
      }
    };
    return this.syncTransaction(transferAction, supabase);
  }

  /**
   * Sync profile update
   */
  async syncProfileUpdate(action, supabase) {
    const { data, error } = await supabase
      .from('profiles')
      .upsert({
        id: action.data.userId,
        ...action.data.updates,
        updated_at: new Date().toISOString()
      });

    if (error) {
      console.error('[SyncManager] Profile sync error:', error);
      return false;
    }

    return true;
  }

  /**
   * Sync inventory
   */
  async syncInventory(action, supabase) {
    const { data, error } = await supabase
      .from('cmms_inventory_items')
      .upsert({
        ...action.data,
        synced_at: new Date().toISOString()
      });

    if (error) {
      console.error('[SyncManager] Inventory sync error:', error);
      return false;
    }

    return true;
  }

  /**
   * Retry failed actions with exponential backoff
   */
  async retryFailedActions(failures) {
    console.log('[SyncManager] 🔄 Retrying', failures.length, 'failed actions...');

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const delay = this.retryIntervals[attempt];
      console.log(`[SyncManager] Retry attempt ${attempt + 1}/${this.maxRetries} after ${delay}ms`);

      await new Promise(resolve => setTimeout(resolve, delay));

      let successCount = 0;
      const stillFailing = [];

      for (const action of failures) {
        try {
          const success = await this.syncAction(action);
          if (success) {
            await offlineAuthManager.markActionSynced(action.id, { success: true, retryAttempt: attempt + 1 });
            successCount++;
          } else {
            stillFailing.push(action);
          }
        } catch (error) {
          stillFailing.push(action);
        }
      }

      console.log(`[SyncManager] Retry ${attempt + 1} succeeded for ${successCount} actions`);

      if (stillFailing.length === 0) {
        console.log('[SyncManager] ✅ All retries succeeded');
        return;
      }

      failures = stillFailing;
    }

    console.warn('[SyncManager] ⚠️ Some actions failed after all retries', failures.length);
    this.notifySyncStateChange({
      status: 'sync-error',
      message: `${failures.length} action${failures.length !== 1 ? 's' : ''} couldn't be synced. Will try again later.`,
      isOnline: true,
      failedActions: failures
    });
  }

  /**
   * Handle sync complete event from service worker
   */
  handleSyncComplete(data) {
    console.log('[SyncManager] Sync completed via service worker:', data);
    this.notifySyncStateChange({
      status: 'synced',
      message: 'Background sync completed',
      isOnline: true,
      timestamp: Date.now()
    });
  }

  /**
   * Get current sync status
   */
  async getSyncStatus() {
    const stats = await offlineAuthManager.getSyncStats();
    return {
      ...stats,
      isSyncing: this.isSyncing,
      syncReady: navigator.onLine && !this.isSyncing
    };
  }

  /**
   * Manual sync trigger
   */
  async manualSync() {
    console.log('[SyncManager] Manual sync triggered');
    if (!navigator.onLine) {
      console.warn('[SyncManager] Cannot sync while offline');
      return false;
    }
    await this.performSync();
    return true;
  }
}

// Singleton instance
export const syncManager = new SyncManager();
