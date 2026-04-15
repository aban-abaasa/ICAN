import { getSupabaseClient } from '../lib/supabase/client';

/**
 * Wallet Transaction Service
 * Handles storing and retrieving wallet transactions in Supabase
 * Supports: Send, Receive, Top-Up operations
 */

class WalletTransactionService {
  constructor() {
    this.supabase = null;
    this.userId = null;
  }

  /**
   * Initialize the service with user ID
   */
  async initialize() {
    this.supabase = getSupabaseClient();
    
    if (!this.supabase) {
      console.error('❌ Supabase client not initialized');
      return false;
    }

    try {
      const { data: { user }, error } = await this.supabase.auth.getUser();
      console.log('🔐 Auth check - Error:', error?.message, 'User:', user?.id);
      
      if (error || !user) {
        console.warn('⚠️ User not authenticated');
        console.warn('   Error:', error?.message);
        console.warn('   User:', user);
        return false;
      }
      this.userId = user.id;
      console.log('✅ Wallet Transaction Service initialized');
      console.log('   User ID:', this.userId);
      console.log('   User Email:', user.email);
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize wallet service:', error.message);
      return false;
    }
  }

  /**
   * 💰 Save a Top-Up transaction
   * @param {Object} params - Transaction parameters
   * @param {number} params.amount - Amount being added
   * @param {string} params.currency - Currency code (GHS, USD, etc)
   * @param {string} params.phoneNumber - Phone number used for transaction
   * @param {string} params.paymentMethod - Payment method (MOMO, Card, etc)
   * @param {string} params.transactionId - MOMO transaction ID
   * @param {string} params.memoKey - Which MOMO key was used (PRIMARY, SECONDARY)
   * @param {string} params.mode - Transaction mode (MOCK or LIVE)
   * @returns {Promise<Object>} - Database response
   */
  async saveTopUp(params) {
    if (!this.userId) {
      console.warn('⚠️ User not authenticated, cannot save transaction');
      return { success: false, error: 'User not authenticated' };
    }

    try {
      const { amount, currency, phoneNumber, paymentMethod, transactionId, memoKey, mode } = params;

      const { data, error } = await this.supabase
        .from('ican_transactions')
        .insert([
          {
            user_id: this.userId,
            transaction_type: 'top_up',
            amount: parseFloat(amount),
            currency: currency,
            description: `Top-up via ${paymentMethod} (${phoneNumber})`,
            status: 'completed',
            metadata: {
              phoneNumber,
              paymentMethod,
              momoTransactionId: transactionId,
              activeKey: memoKey,
              mode: mode,
              timestamp: new Date().toISOString()
            }
          }
        ])
        .select();

      if (error) {
        console.error('❌ Failed to save top-up transaction:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Top-up transaction saved to Supabase:', data[0]);
      return { success: true, data: data[0] };
    } catch (error) {
      console.error('❌ Error saving top-up:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 📤 Save a Send/Transfer transaction
   * @param {Object} params - Transaction parameters
   * @param {number} params.amount - Amount being sent
   * @param {string} params.currency - Currency code
   * @param {string} params.recipientPhone - Recipient phone number
   * @param {string} params.paymentMethod - Payment method
   * @param {string} params.transactionId - MOMO transaction ID
   * @param {string} params.memoKey - MOMO key used
   * @param {string} params.mode - Transaction mode
   * @param {string} params.description - Transfer description
   * @returns {Promise<Object>} - Database response
   */
  async saveSend(params) {
    if (!this.userId) {
      console.warn('⚠️ User not authenticated, cannot save transaction');
      return { success: false, error: 'User not authenticated' };
    }

    try {
      const { amount, currency, recipientPhone, paymentMethod, transactionId, memoKey, mode, description } = params;

      const { data, error } = await this.supabase
        .from('ican_transactions')
        .insert([
          {
            user_id: this.userId,
            transaction_type: 'transfer',
            amount: -parseFloat(amount), // Negative for outgoing
            currency: currency,
            description: description || `Transfer to ${recipientPhone} via ${paymentMethod}`,
            status: 'completed',
            metadata: {
              recipientPhone,
              paymentMethod,
              transactionType: 'send',
              momoTransactionId: transactionId,
              activeKey: memoKey,
              mode: mode,
              timestamp: new Date().toISOString()
            }
          }
        ])
        .select();

      if (error) {
        console.error('❌ Failed to save send transaction:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Send transaction saved to Supabase:', data[0]);
      return { success: true, data: data[0] };
    } catch (error) {
      console.error('❌ Error saving send:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 📥 Save a Receive/Incoming transaction
   * @param {Object} params - Transaction parameters
   * @param {number} params.amount - Amount received
   * @param {string} params.currency - Currency code
   * @param {string} params.senderPhone - Sender phone number
   * @param {string} params.paymentMethod - Payment method
   * @param {string} params.transactionId - MOMO transaction ID
   * @param {string} params.mode - Transaction mode
   * @param {string} params.description - Receive description
   * @returns {Promise<Object>} - Database response
   */
  async saveReceive(params) {
    if (!this.userId) {
      console.warn('⚠️ User not authenticated, cannot save transaction');
      return { success: false, error: 'User not authenticated' };
    }

    try {
      const { amount, currency, senderPhone, paymentMethod, transactionId, mode, description } = params;

      const { data, error } = await this.supabase
        .from('ican_transactions')
        .insert([
          {
            user_id: this.userId,
            transaction_type: 'transfer',
            amount: parseFloat(amount), // Positive for incoming
            currency: currency,
            description: description || `Received from ${senderPhone} via ${paymentMethod}`,
            status: 'completed',
            metadata: {
              senderPhone,
              paymentMethod,
              transactionType: 'receive',
              momoTransactionId: transactionId,
              mode: mode,
              timestamp: new Date().toISOString()
            }
          }
        ])
        .select();

      if (error) {
        console.error('❌ Failed to save receive transaction:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Receive transaction saved to Supabase:', data[0]);
      return { success: true, data: data[0] };
    } catch (error) {
      console.error('❌ Error saving receive:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 📊 Get all wallet transactions for current user
   * @param {Object} options - Query options
   * @param {number} options.limit - Number of records (default: 50)
   * @param {number} options.offset - Pagination offset (default: 0)
   * @returns {Promise<Array>} - List of transactions
   */
  async getTransactions(options = {}) {
    if (!this.userId) {
      console.warn('⚠️ User not authenticated, cannot fetch transactions');
      return [];
    }

    try {
      const {
        limit = 50,
        offset = 0,
        currency,
        includeArchived = false,
        archivedOnly = false,
        day = null
      } = options;

      let query = this.supabase
        .from('ican_transactions')
        .select('*')
        .eq('user_id', this.userId)
        .order('created_at', { ascending: false });

      if (currency) {
        query = query.eq('currency', currency);
      }

      const selectedDay = day ? new Date(day) : new Date();
      if (!Number.isNaN(selectedDay.getTime())) {
        const dayStart = new Date(selectedDay);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(selectedDay);
        dayEnd.setHours(23, 59, 59, 999);

        if (archivedOnly) {
          query = query.lt('created_at', dayStart.toISOString());
        } else if (!includeArchived) {
          query = query
            .gte('created_at', dayStart.toISOString())
            .lte('created_at', dayEnd.toISOString());
        }
      }

      if (limit) query = query.limit(limit);
      if (offset) query = query.range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) {
        console.error('❌ Failed to fetch transactions:', error);
        return [];
      }

      console.log(`✅ Fetched ${data.length} transactions from Supabase`);
      return data || [];
    } catch (error) {
      console.error('❌ Error fetching transactions:', error);
      return [];
    }
  }

  /**
   * 💵 Get wallet balance from user_wallets table
   * @returns {Promise<Object>} - Balance by currency
   */
  async getWalletBalance() {
    if (!this.userId) {
      console.warn('⚠️ User not authenticated, cannot get balance');
      console.warn('   Current userId:', this.userId);
      return {};
    }

    try {
      console.log('🔍 Fetching wallet balance for user:', this.userId);
      
      // Fetch all wallets for this user from user_wallets table
      const { data, error } = await this.supabase
        .from('user_wallets')
        .select('balance, currency, status, account_type')
        .eq('user_id', this.userId);

      console.log('📊 Query results:');
      console.log('   Error:', error ? error.message : 'None');
      console.log('   Data received:', data);
      console.log('   Data length:', data?.length || 0);

      if (error) {
        console.error('❌ Failed to fetch user wallets:', error.message);
        return {};
      }

      if (!data || data.length === 0) {
        console.warn('⚠️ No wallets found for user - might be RLS or no data');
        return {};
      }

      // Build balance object by currency
      const balances = {};
      data.forEach(wallet => {
        console.log(`   Processing wallet: ${wallet.currency} (status: ${wallet.status}, balance: ${wallet.balance})`);
        if (wallet.currency && wallet.balance !== null && wallet.balance !== undefined) {
          balances[wallet.currency] = parseFloat(wallet.balance);
        }
      });

      console.log('✅ Final balances:', balances);
      console.log('   UGX Balance:', balances['UGX'] || 'Not found');
      console.log('   ICAN Balance:', balances['ICAN'] || 'Not found');
      return balances;
    } catch (error) {
      console.error('❌ Error fetching wallet balance:', error.message);
      console.error('   Stack:', error.stack);
      return {};
    }
  }

  /**
   * 📈 Get transaction summary for a period
   * @param {Object} options - Query options
   * @param {number} options.days - Number of days to look back (default: 30)
   * @returns {Promise<Object>} - Summary statistics
   */
  async getTransactionSummary(options = {}) {
    if (!this.userId) {
      console.warn('⚠️ User not authenticated, cannot get summary');
      return null;
    }

    try {
      const { days = 30 } = options;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data, error } = await this.supabase
        .from('ican_transactions')
        .select('*')
        .eq('user_id', this.userId)
        .eq('status', 'completed')
        .gte('created_at', startDate.toISOString());

      if (error) {
        console.error('❌ Failed to fetch transaction summary:', error);
        return null;
      }

      // Calculate summary
      let totalIncoming = 0;
      let totalOutgoing = 0;
      const transactionsByType = {};

      data?.forEach(transaction => {
        if (transaction.amount > 0) {
          totalIncoming += transaction.amount;
        } else {
          totalOutgoing += Math.abs(transaction.amount);
        }

        if (!transactionsByType[transaction.transaction_type]) {
          transactionsByType[transaction.transaction_type] = 0;
        }
        transactionsByType[transaction.transaction_type]++;
      });

      const summary = {
        period: `Last ${days} days`,
        totalTransactions: data?.length || 0,
        totalIncoming,
        totalOutgoing,
        netChange: totalIncoming - totalOutgoing,
        transactionsByType
      };

      console.log('✅ Transaction summary:', summary);
      return summary;
    } catch (error) {
      console.error('❌ Error getting summary:', error);
      return null;
    }
  }

  /**
   * 🗑️ Delete a transaction (soft delete via status)
   * @param {string} transactionId - Transaction ID to delete
   * @returns {Promise<Object>} - Result
   */
  async deleteTransaction(transactionId) {
    if (!this.userId) {
      console.warn('⚠️ User not authenticated, cannot delete transaction');
      return { success: false, error: 'User not authenticated' };
    }

    try {
      const { error } = await this.supabase
        .from('ican_transactions')
        .update({ status: 'cancelled' })
        .eq('id', transactionId)
        .eq('user_id', this.userId);

      if (error) {
        console.error('❌ Failed to delete transaction:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Transaction marked as cancelled');
      return { success: true };
    } catch (error) {
      console.error('❌ Error deleting transaction:', error);
      return { success: false, error: error.message };
    }
  }
}

// Export as singleton
export const walletTransactionService = new WalletTransactionService();
