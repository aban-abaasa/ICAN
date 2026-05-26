import { getSupabaseClient } from '../lib/supabase/client';
import { offlineAuthManager } from '../lib/offlineAuthManager';

// Get Supabase client (already initialized properly)
const getClient = () => getSupabaseClient();

/**
 * Save transaction to Supabase
 * @param {Object} transaction - Transaction object with amount, type, category, etc.
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Response from Supabase
 */
export const saveTransaction = async (transaction, userId) => {
  try {
    const { data, error } = await getClient()
      .from('ican_transactions')
      .insert([
        {
          user_id: userId,
          amount: transaction.amount,
          transaction_type: transaction.type,
          category: transaction.category,
          sub_category: transaction.subCategory,
          description: transaction.description,
          location: transaction.location,
          payment_method: transaction.paymentMethod,
          time_context: transaction.timeContext,
          is_loan: transaction.isLoan || false,
          confidence: transaction.confidence || 0,
          loan_details: transaction.loanDetails || null,
          transaction_date: transaction.date || new Date().toISOString(),
          created_at: new Date().toISOString(),
          tags: transaction.tags || [],
          ai_insights: transaction.aiInsights || null,
          reporting_data: transaction.reportingData || null,
          original_text: transaction.originalText || transaction.description
        }
      ]);

    if (error) {
      console.error('Error saving transaction to Supabase:', error);
      return { success: false, error };
    }

    console.log('✅ Transaction saved to Supabase:', data);
    return { success: true, data };
  } catch (err) {
    console.error('Exception saving transaction:', err);
    return { success: false, error: err };
  }
};

/**
 * Get all transactions for a user from Supabase
 * @param {string} userId - User ID
 * @returns {Promise<Array>} - Array of transactions
 */
export const getTransactions = async (userId) => {
  try {
    const { data, error } = await getClient()
      .from('ican_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching transactions:', error);
      return [];
    }

    console.log(`📊 Loaded ${data.length} transactions from Supabase`);
    return data;
  } catch (err) {
    console.error('Exception fetching transactions:', err);
    return [];
  }
};

/**
 * Get transactions by date range
 * @param {string} userId - User ID
 * @param {string} startDate - Start date (ISO format)
 * @param {string} endDate - End date (ISO format)
 * @returns {Promise<Array>} - Array of transactions
 */
export const getTransactionsByDateRange = async (userId, startDate, endDate) => {
  try {
    const { data, error } = await getClient()
      .from('ican_transactions')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('transaction_date', { ascending: false });

    if (error) {
      console.error('Error fetching transactions by date range:', error);
      return [];
    }

    return data;
  } catch (err) {
    console.error('Exception fetching transactions by date range:', err);
    return [];
  }
};

/**
 * Get transactions by type (income, expense, loan)
 * @param {string} userId - User ID
 * @param {string} type - Transaction type
 * @returns {Promise<Array>} - Array of transactions
 */
export const getTransactionsByType = async (userId, type) => {
  try {
    const { data, error } = await getClient()
      .from('ican_transactions')
      .select('*')
      .eq('user_id', userId)
      .eq('transaction_type', type)
      .order('created_at', { ascending: false });

    if (error) {
      console.error(`Error fetching ${type} transactions:`, error);
      return [];
    }

    return data;
  } catch (err) {
    console.error(`Exception fetching ${type} transactions:`, err);
    return [];
  }
};

/**
 * Get transactions by category
 * @param {string} userId - User ID
 * @param {string} category - Transaction category
 * @returns {Promise<Array>} - Array of transactions
 */
export const getTransactionsByCategory = async (userId, category) => {
  try {
    const { data, error } = await getClient()
      .from('ican_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error(`Error fetching ${category} transactions:`, error);
      return [];
    }

    return data;
  } catch (err) {
    console.error(`Exception fetching ${category} transactions:`, err);
    return [];
  }
};

/**
 * Get large transactions (above threshold)
 * @param {string} userId - User ID
 * @param {number} threshold - Minimum amount (default: 1,000,000)
 * @returns {Promise<Array>} - Array of large transactions
 */
export const getLargeTransactions = async (userId, threshold = 1000000) => {
  try {
    const { data, error } = await getClient()
      .from('ican_transactions')
      .select('*')
      .eq('user_id', userId)
      .gte('amount', threshold)
      .order('amount', { ascending: false });

    if (error) {
      console.error('Error fetching large transactions:', error);
      return [];
    }

    console.log(`💰 Found ${data.length} large transactions (>UGX ${threshold.toLocaleString()})`);
    return data;
  } catch (err) {
    console.error('Exception fetching large transactions:', err);
    return [];
  }
};

/**
 * Update a transaction
 * @param {number} transactionId - Transaction ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} - Response from Supabase
 */
export const updateTransaction = async (transactionId, updates) => {
  try {
    const { data, error } = await getClient()
      .from('ican_transactions')
      .update(updates)
      .eq('id', transactionId);

    if (error) {
      console.error('Error updating transaction:', error);
      return { success: false, error };
    }

    console.log('✅ Transaction updated:', data);
    return { success: true, data };
  } catch (err) {
    console.error('Exception updating transaction:', err);
    return { success: false, error: err };
  }
};

/**
 * Delete a transaction
 * @param {number} transactionId - Transaction ID
 * @returns {Promise<Object>} - Response from Supabase
 */
export const deleteTransaction = async (transactionId) => {
  try {
    console.log(`🗑️ [supabaseTransactions] Deleting transaction ID: ${transactionId}`);
    
    // Get current user to verify ownership
    const client = getClient();
    const { data: { user } } = await client.auth.getUser();
    
    if (!user) {
      console.error('❌ No authenticated user found');
      return { success: false, error: new Error('Not authenticated') };
    }
    
    const userId = user.id;
    console.log(`👤 [supabaseTransactions] Auth user ID: ${userId}`);
    
    // Remove from offline queue first (prevent re-syncing deleted transactions)
    try {
      const removed = await offlineAuthManager.removeActionsByTransactionId(transactionId);
      console.log(`✅ [supabaseTransactions] Cleared ${removed} queued actions`);
    } catch (queueError) {
      console.warn('[supabaseTransactions] Could not remove from offline queue:', queueError);
    }
    
    // Verify transaction exists and get its user_id
    const { data: existingData, error: checkError } = await client
      .from('ican_transactions')
      .select('id, user_id')
      .eq('id', transactionId)
      .single();

    if (checkError || !existingData) {
      console.error('❌ [supabaseTransactions] Transaction not found:', checkError);
      return { success: false, error: new Error('Transaction not found') };
    }
    
    console.log(`📋 [supabaseTransactions] Transaction found - ID: ${existingData.id}, Owner: ${existingData.user_id}`);
    
    // Verify ownership
    if (existingData.user_id !== userId) {
      console.error(`❌ [supabaseTransactions] User mismatch - Transaction owner: ${existingData.user_id}, Current user: ${userId}`);
      return { success: false, error: new Error('You do not own this transaction') };
    }
    
    // Delete from Supabase using RLS
    // Don't use .eq('user_id', ...) in delete - let RLS handle it
    const { error: deleteError } = await client
      .from('ican_transactions')
      .delete()
      .eq('id', transactionId);

    if (deleteError) {
      console.error('❌ [supabaseTransactions] Supabase delete error:', deleteError);
      return { success: false, error: deleteError };
    }

    console.log(`✅ [supabaseTransactions] Delete executed without error`);

    // Verify deletion succeeded by trying to fetch it again
    const { data: postDeleteCheck, error: postDeleteError } = await client
      .from('ican_transactions')
      .select('id')
      .eq('id', transactionId)
      .single();

    // After deletion:
    // - If record still exists: postDeleteCheck will have data (deletion FAILED)
    // - If record deleted: postDeleteError will be PGRST116 "no rows" (deletion SUCCEEDED)
    
    if (postDeleteCheck) {
      console.error('❌ [supabaseTransactions] Record still exists after delete:', postDeleteCheck);
      console.error('⚠️ [supabaseTransactions] Possible RLS policy issue or transaction belongs to different user');
      return { success: false, error: new Error('Record still exists after delete - RLS or permission issue') };
    }

    // PGRST116 = "no rows found" = expected success state
    if (postDeleteError?.code === 'PGRST116') {
      console.log(`✅ [supabaseTransactions] Deletion verified - record no longer exists (PGRST116)`);
      return { success: true, deleted: true };
    }

    // Any other error is unexpected
    if (postDeleteError) {
      console.error('❌ [supabaseTransactions] Unexpected verification error:', postDeleteError);
      return { success: false, error: postDeleteError };
    }

    console.log(`✅ [supabaseTransactions] Transaction deleted successfully`);
    return { success: true, deleted: true };
  } catch (err) {
    console.error('❌ [supabaseTransactions] Exception deleting transaction:', err);
    return { success: false, error: err };
  }
};

/**
 * Get transaction statistics for a user
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Transaction statistics
 */
export const getTransactionStats = async (userId) => {
  try {
    const { data, error } = await getClient()
      .from('ican_transactions')
      .select('transaction_type, amount')

    if (error) {
      console.error('Error fetching transaction stats:', error);
      return {};
    }

    const stats = {
      totalTransactions: data.length,
      totalIncome: data
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + (t.amount || 0), 0),
      totalExpenses: data
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0),
      totalLoans: data
        .filter(t => t.type === 'loan')
        .reduce((sum, t) => sum + (t.amount || 0), 0),
      largestTransaction: Math.max(...data.map(t => Math.abs(t.amount || 0)))
    };

    return stats;
  } catch (err) {
    console.error('Exception fetching transaction stats:', err);
    return {};
  }
};

/**
 * Sync local transactions to Supabase
 * @param {Array} localTransactions - Array of local transactions
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Sync results
 */
export const syncTransactionsToSupabase = async (localTransactions, userId) => {
  try {
    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const transaction of localTransactions) {
      const result = await saveTransaction(transaction, userId);
      if (result.success) {
        successCount++;
      } else {
        errorCount++;
        errors.push({ transaction: transaction.description, error: result.error });
      }
    }

    console.log(`📤 Sync complete: ${successCount} saved, ${errorCount} failed`);
    return {
      success: errorCount === 0,
      successCount,
      errorCount,
      errors
    };
  } catch (err) {
    console.error('Exception during sync:', err);
    return { success: false, error: err };
  }
};
