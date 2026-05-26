/**
 * Transaction Cleanup Service
 * Provides safe data deletion and cleanup operations for the ICAN app
 * All operations respect RLS - users can only delete their own data
 */

import { getSupabaseClient } from '../lib/supabase/client';
import { offlineAuthManager } from '../lib/offlineAuthManager';

const supabase = getSupabaseClient();

/**
 * Get cleanup statistics before deletion
 * Shows user what will be deleted
 */
export const getCleanupStats = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    console.log('[CleanupService] 📊 Getting cleanup statistics...');

    // Total transactions
    const { data: allTx, count: totalCount } = await supabase
      .from('ican_transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id);

    // By transaction type
    const { data: byType } = await supabase
      .from('ican_transactions')
      .select('transaction_type')
      .eq('user_id', user.id);

    const typeStats = {};
    byType?.forEach(tx => {
      typeStats[tx.transaction_type] = (typeStats[tx.transaction_type] || 0) + 1;
    });

    // By age
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const { count: last7Days } = await supabase
      .from('ican_transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .gte('created_at', sevenDaysAgo.toISOString());

    const { count: last30Days } = await supabase
      .from('ican_transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .gte('created_at', thirtyDaysAgo.toISOString());

    const { count: last90Days } = await supabase
      .from('ican_transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .gte('created_at', ninetyDaysAgo.toISOString());

    const olderThan90Days = totalCount - last90Days;

    const stats = {
      total: totalCount,
      byType: typeStats,
      byAge: {
        last7Days,
        last30Days,
        last90Days,
        olderThan90Days
      }
    };

    console.log('[CleanupService] ✅ Stats retrieved:', stats);
    return stats;
  } catch (error) {
    console.error('[CleanupService] ❌ Error getting stats:', error);
    throw error;
  }
};

/**
 * Delete all transactions for current user
 * ⚠️ CAUTION: Permanent deletion
 */
export const deleteAllTransactions = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    console.log('[CleanupService] 🗑️ Deleting ALL transactions for user:', user.id);

    // Clear offline queue first
    await offlineAuthManager.init();
    const pendingActions = await offlineAuthManager.getPendingActions();
    for (const action of pendingActions) {
      await offlineAuthManager.removeAction(action.id);
    }

    // Delete from Supabase
    const { data, error, count } = await supabase
      .from('ican_transactions')
      .delete()
      .eq('user_id', user.id)
      .select();

    if (error) throw error;

    console.log(`[CleanupService] ✅ Deleted ${count} transactions`);
    return { success: true, deletedCount: count };
  } catch (error) {
    console.error('[CleanupService] ❌ Error deleting transactions:', error);
    throw error;
  }
};

/**
 * Delete transactions older than X days
 */
export const deleteOldTransactions = async (daysOld = 90) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    console.log(`[CleanupService] 🗑️ Deleting transactions older than ${daysOld} days (before ${cutoffDate.toISOString()})`);

    const { data, error, count } = await supabase
      .from('ican_transactions')
      .delete()
      .eq('user_id', user.id)
      .lt('created_at', cutoffDate.toISOString())
      .select();

    if (error) throw error;

    console.log(`[CleanupService] ✅ Deleted ${count} old transactions`);
    return { success: true, deletedCount: count };
  } catch (error) {
    console.error('[CleanupService] ❌ Error deleting old transactions:', error);
    throw error;
  }
};

/**
 * Delete transactions by type
 */
export const deleteTransactionsByType = async (type) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    console.log(`[CleanupService] 🗑️ Deleting all ${type} transactions`);

    const { data, error, count } = await supabase
      .from('ican_transactions')
      .delete()
      .eq('user_id', user.id)
      .eq('transaction_type', type)
      .select();

    if (error) throw error;

    console.log(`[CleanupService] ✅ Deleted ${count} ${type} transactions`);
    return { success: true, deletedCount: count };
  } catch (error) {
    console.error('[CleanupService] ❌ Error deleting transactions by type:', error);
    throw error;
  }
};

/**
 * Delete transactions by date range
 */
export const deleteTransactionsByDateRange = async (startDate, endDate) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    console.log(`[CleanupService] 🗑️ Deleting transactions between ${startDate} and ${endDate}`);

    const { data, error, count } = await supabase
      .from('ican_transactions')
      .delete()
      .eq('user_id', user.id)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .select();

    if (error) throw error;

    console.log(`[CleanupService] ✅ Deleted ${count} transactions in date range`);
    return { success: true, deletedCount: count };
  } catch (error) {
    console.error('[CleanupService] ❌ Error deleting by date range:', error);
    throw error;
  }
};

/**
 * Delete low-confidence AI transactions
 */
export const deleteLowConfidenceTransactions = async (confidenceThreshold = 0.5) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    console.log(`[CleanupService] 🗑️ Deleting transactions with confidence < ${confidenceThreshold}`);

    // Get transactions to delete
    const { data: toDelete } = await supabase
      .from('ican_transactions')
      .select('id')
      .eq('user_id', user.id)
      .lt('confidence', confidenceThreshold);

    if (!toDelete || toDelete.length === 0) {
      console.log('[CleanupService] No low-confidence transactions found');
      return { success: true, deletedCount: 0 };
    }

    // Delete each one
    const ids = toDelete.map(t => t.id);
    const { error, count } = await supabase
      .from('ican_transactions')
      .delete()
      .in('id', ids);

    if (error) throw error;

    console.log(`[CleanupService] ✅ Deleted ${count} low-confidence transactions`);
    return { success: true, deletedCount: count };
  } catch (error) {
    console.error('[CleanupService] ❌ Error deleting low-confidence transactions:', error);
    throw error;
  }
};

/**
 * Delete offline-synced test transactions
 */
export const deleteOfflineSyncTransactions = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    console.log('[CleanupService] 🗑️ Deleting offline-synced transactions');

    // Get transactions with offline sync metadata
    const { data: toDelete } = await supabase
      .from('ican_transactions')
      .select('id')
      .eq('user_id', user.id)
      .or("metadata->>synced_from_offline.eq.true,metadata->>source.eq.offline_sync");

    if (!toDelete || toDelete.length === 0) {
      console.log('[CleanupService] No offline-synced transactions found');
      return { success: true, deletedCount: 0 };
    }

    const ids = toDelete.map(t => t.id);
    const { error, count } = await supabase
      .from('ican_transactions')
      .delete()
      .in('id', ids);

    if (error) throw error;

    console.log(`[CleanupService] ✅ Deleted ${count} offline-synced transactions`);
    return { success: true, deletedCount: count };
  } catch (error) {
    console.error('[CleanupService] ❌ Error deleting offline-synced transactions:', error);
    throw error;
  }
};

/**
 * Delete transactions by category
 */
export const deleteTransactionsByCategory = async (category) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    console.log(`[CleanupService] 🗑️ Deleting ${category} category transactions`);

    // Get transactions in category
    const { data: toDelete } = await supabase
      .from('ican_transactions')
      .select('id')
      .eq('user_id', user.id)
      .or(`metadata->>category.eq.${category},category.eq.${category}`);

    if (!toDelete || toDelete.length === 0) {
      console.log(`[CleanupService] No ${category} transactions found`);
      return { success: true, deletedCount: 0 };
    }

    const ids = toDelete.map(t => t.id);
    const { error, count } = await supabase
      .from('ican_transactions')
      .delete()
      .in('id', ids);

    if (error) throw error;

    console.log(`[CleanupService] ✅ Deleted ${count} ${category} transactions`);
    return { success: true, deletedCount: count };
  } catch (error) {
    console.error('[CleanupService] ❌ Error deleting by category:', error);
    throw error;
  }
};

/**
 * Export cleanup operations for use in reports
 */
export const reportCleanupOperations = {
  deleteAll: deleteAllTransactions,
  deleteOld: deleteOldTransactions,
  deleteByType: deleteTransactionsByType,
  deleteByDateRange: deleteTransactionsByDateRange,
  deleteLowConfidence: deleteLowConfidenceTransactions,
  deleteOfflineSync: deleteOfflineSyncTransactions,
  deleteByCategory: deleteTransactionsByCategory,
  getStats: getCleanupStats
};

export default {
  getCleanupStats,
  deleteAllTransactions,
  deleteOldTransactions,
  deleteTransactionsByType,
  deleteTransactionsByDateRange,
  deleteLowConfidenceTransactions,
  deleteOfflineSyncTransactions,
  deleteTransactionsByCategory,
  reportCleanupOperations
};
