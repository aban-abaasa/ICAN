/**
 * Offline Transaction Manager
 * Bridges transaction recording with PWA offline-first architecture
 * 
 * Handles:
 * - Recording wallet transactions (send/receive/topup)
 * - Recording financial transactions (income/expense/etc)
 * - Queuing for sync when offline
 * - Auto-sync when online
 * - Conflict resolution
 * - Data validation
 */

import { offlineManager } from './offlineManager';

class OfflineTransactionManager {
  constructor() {
    this.db = null;
    this.syncRetryConfig = {
      maxRetries: 3,
      baseDelay: 1000,        // 1 second
      maxDelay: 30000,        // 30 seconds
      backoffMultiplier: 2
    };
  }

  async initialize() {
    this.db = await offlineManager.db;
  }

  // ============================================
  // TRANSACTION RECORDING
  // ============================================

  /**
   * Record a wallet transaction (send/receive/topup)
   */
  async recordWalletTransaction(params) {
    try {
      const transaction = {
        id: params.id || this.generateId(),
        type: 'wallet_transaction',
        subType: params.subType, // 'send', 'receive', 'topup'
        amount: parseFloat(params.amount),
        currency: params.currency,
        phoneNumber: params.phoneNumber,
        paymentMethod: params.paymentMethod,
        transactionId: params.transactionId,
        description: params.description,
        timestamp: Date.now(),
        synced: false,
        retryCount: 0,
        metadata: {
          source: params.source || 'pwa',
          deviceInfo: this.getDeviceInfo(),
          networkStatus: navigator.onLine ? 'online' : 'offline',
          appVersion: params.appVersion || '1.0.0'
        }
      };

      if (navigator.onLine) {
        // Online: record immediately and try to sync
        return await this.recordAndSyncTransaction(transaction);
      } else {
        // Offline: queue for later
        return await this.queueTransactionOffline(transaction);
      }
    } catch (error) {
      console.error('[OfflineTransactionManager] Error recording wallet transaction:', error);
      throw error;
    }
  }

  /**
   * Record a financial transaction (income/expense/loan/transfer/etc)
   */
  async recordFinancialTransaction(params) {
    try {
      const transaction = {
        id: params.id || this.generateId(),
        type: 'financial_transaction',
        transactionType: params.transactionType, // income, expense, loan, transfer, tithe, investment
        amount: parseFloat(params.amount),
        currency: params.currency,
        category: params.category,
        subCategory: params.subCategory,
        description: params.description,
        transactionDate: params.transactionDate || new Date().toISOString().split('T')[0],
        source: params.source || 'manual',
        timestamp: Date.now(),
        synced: false,
        retryCount: 0,
        metadata: {
          aiCategorized: params.aiCategorized || false,
          aiConfidence: params.aiConfidence || null,
          isRecurring: params.isRecurring || false,
          recurrencePattern: params.recurrencePattern || null,
          deviceInfo: this.getDeviceInfo(),
          networkStatus: navigator.onLine ? 'online' : 'offline',
          appVersion: params.appVersion || '1.0.0'
        }
      };

      if (navigator.onLine) {
        return await this.recordAndSyncTransaction(transaction);
      } else {
        return await this.queueTransactionOffline(transaction);
      }
    } catch (error) {
      console.error('[OfflineTransactionManager] Error recording financial transaction:', error);
      throw error;
    }
  }

  /**
   * Record and immediately sync transaction (online mode)
   */
  async recordAndSyncTransaction(transaction) {
    try {
      // Save locally first
      await offlineManager.recordTransaction(transaction);

      // Attempt sync
      const authToken = await this.getAuthToken();
      if (authToken) {
        await this.syncSingleTransaction(transaction, authToken);
      }

      return {
        success: true,
        id: transaction.id,
        status: 'recorded',
        message: 'Transaction recorded and synced',
        transaction
      };
    } catch (error) {
      console.error('[OfflineTransactionManager] Error in recordAndSync:', error);
      // Fall back to offline queue if sync fails
      await this.queueTransactionOffline(transaction);
      return {
        success: true,
        id: transaction.id,
        status: 'queued',
        message: 'Transaction recorded offline. Will sync when online.',
        transaction
      };
    }
  }

  /**
   * Queue transaction for offline storage
   */
  async queueTransactionOffline(transaction) {
    try {
      await offlineManager.queueTransaction(transaction, `/api/transactions`);
      return {
        success: true,
        id: transaction.id,
        status: 'queued',
        message: 'Transaction saved locally. Will sync when online.',
        transaction
      };
    } catch (error) {
      console.error('[OfflineTransactionManager] Error queuing transaction:', error);
      throw error;
    }
  }

  // ============================================
  // SYNC OPERATIONS
  // ============================================

  /**
   * Sync a single transaction with retry logic
   */
  async syncSingleTransaction(transaction, authToken, retryCount = 0) {
    try {
      const response = await fetch('/api/transactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(transaction)
      });

      if (response.ok) {
        await offlineManager.markTransactionSynced(transaction.id);
        console.log('[OfflineTransactionManager] Transaction synced:', transaction.id);
        return { success: true, response };
      } else if (response.status >= 400 && response.status < 500) {
        // Client error - don't retry
        console.warn('[OfflineTransactionManager] Client error syncing transaction:', transaction.id, response.status);
        return { success: false, error: 'client_error' };
      } else {
        // Server error - retry
        throw new Error(`Server error: ${response.status}`);
      }
    } catch (error) {
      if (retryCount < this.syncRetryConfig.maxRetries) {
        const delay = Math.min(
          this.syncRetryConfig.baseDelay * Math.pow(this.syncRetryConfig.backoffMultiplier, retryCount),
          this.syncRetryConfig.maxDelay
        );
        
        console.log(`[OfflineTransactionManager] Retrying transaction ${transaction.id} in ${delay}ms`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.syncSingleTransaction(transaction, authToken, retryCount + 1);
      } else {
        console.error('[OfflineTransactionManager] Max retries reached for transaction:', transaction.id);
        return { success: false, error: 'max_retries_exceeded' };
      }
    }
  }

  /**
   * Sync all pending transactions
   */
  async syncAllTransactions(authToken) {
    try {
      const pending = await offlineManager.getPendingTransactions();
      
      if (pending.length === 0) {
        return { success: true, synced: 0, failed: 0, total: 0 };
      }

      console.log('[OfflineTransactionManager] Syncing', pending.length, 'transactions');

      let synced = 0;
      let failed = 0;
      const errors = [];

      for (const item of pending) {
        const result = await this.syncSingleTransaction(item, authToken);
        if (result.success) {
          synced++;
        } else {
          failed++;
          errors.push({ id: item.id, error: result.error });
        }
      }

      return {
        success: failed === 0,
        synced,
        failed,
        total: pending.length,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      console.error('[OfflineTransactionManager] Error syncing transactions:', error);
      throw error;
    }
  }

  // ============================================
  // OFFLINE DATA ACCESS
  // ============================================

  /**
   * Get all transactions from local storage
   */
  async getAllTransactions() {
    try {
      return await offlineManager.getAllTransactions();
    } catch (error) {
      console.error('[OfflineTransactionManager] Error getting transactions:', error);
      return [];
    }
  }

  /**
   * Get only pending (unsynced) transactions
   */
  async getPendingTransactions() {
    try {
      return await offlineManager.getPendingTransactions();
    } catch (error) {
      console.error('[OfflineTransactionManager] Error getting pending transactions:', error);
      return [];
    }
  }

  /**
   * Get transactions by type (wallet or financial)
   */
  async getTransactionsByType(type) {
    try {
      const all = await this.getAllTransactions();
      return all.filter(tx => tx.type === type);
    } catch (error) {
      console.error('[OfflineTransactionManager] Error filtering transactions:', error);
      return [];
    }
  }

  /**
   * Get transactions from date range
   */
  async getTransactionsByDateRange(startDate, endDate) {
    try {
      const all = await this.getAllTransactions();
      const start = new Date(startDate).getTime();
      const end = new Date(endDate).getTime();
      
      return all.filter(tx => tx.timestamp >= start && tx.timestamp <= end);
    } catch (error) {
      console.error('[OfflineTransactionManager] Error filtering by date:', error);
      return [];
    }
  }

  /**
   * Get transaction by ID
   */
  async getTransaction(id) {
    try {
      const all = await this.getAllTransactions();
      return all.find(tx => tx.id === id);
    } catch (error) {
      console.error('[OfflineTransactionManager] Error getting transaction:', error);
      return null;
    }
  }

  // ============================================
  // STATISTICS
  // ============================================

  /**
   * Get offline statistics
   */
  async getOfflineStats() {
    try {
      const all = await this.getAllTransactions();
      const pending = await this.getPendingTransactions();
      const walletTxs = all.filter(tx => tx.type === 'wallet_transaction');
      const financialTxs = all.filter(tx => tx.type === 'financial_transaction');

      return {
        totalTransactions: all.length,
        pendingTransactions: pending.length,
        walletTransactions: walletTxs.length,
        financialTransactions: financialTxs.length,
        totalAmount: all.reduce((sum, tx) => sum + (tx.amount || 0), 0),
        lastSyncTime: await this.getLastSyncTime()
      };
    } catch (error) {
      console.error('[OfflineTransactionManager] Error getting stats:', error);
      return null;
    }
  }

  /**
   * Get last sync time
   */
  async getLastSyncTime() {
    try {
      return await offlineManager.getOfflineData('lastSyncTime');
    } catch (error) {
      return null;
    }
  }

  /**
   * Set last sync time
   */
  async setLastSyncTime() {
    try {
      const now = new Date().toISOString();
      await offlineManager.setOfflineData('lastSyncTime', now);
      return now;
    } catch (error) {
      console.error('[OfflineTransactionManager] Error setting sync time:', error);
    }
  }

  // ============================================
  // UTILITIES
  // ============================================

  generateId() {
    return 'tx_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  async getAuthToken() {
    // Get from localStorage, sessionStorage, or from auth context
    const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
    return token;
  }

  getDeviceInfo() {
    return {
      userAgent: navigator.userAgent,
      language: navigator.language,
      onLine: navigator.onLine,
      platform: navigator.platform,
      memory: navigator.deviceMemory || 'unknown',
      cores: navigator.hardwareConcurrency || 'unknown'
    };
  }

  getStatus() {
    return {
      isOnline: navigator.onLine,
      dbReady: this.db !== null,
      managerReady: this.db !== null
    };
  }
}

// Singleton instance
export const offlineTransactionManager = new OfflineTransactionManager();

export default offlineTransactionManager;
