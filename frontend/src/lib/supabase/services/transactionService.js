import { supabase } from '../client.js';

/**
 * Transaction Service - Financial transactions for ICAN Capital Engine
 * Prepares transaction data for blockchain integration
 */

export const TransactionService = {
  /**
   * Create a new transaction record
   */
  async createTransaction(transactionData) {
    try {
      const { data, error } = await supabase
        .from('ican_transactions')
        .insert({
          ...transactionData,
          status: 'pending',
          blockchain_status: 'not_synced',
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Error creating transaction:', error);
      return { data: null, error };
    }
  },

  /**
   * Get transactions by user ID
   */
  async getUserTransactions(userId) {
    try {
      const { data, error } = await supabase
        .from('ican_transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Error fetching transactions:', error);
      return { data: null, error };
    }
  },

  /**
   * Get transactions pending blockchain sync
   */
  async getPendingBlockchainSync() {
    try {
      const { data, error } = await supabase
        .from('ican_transactions')
        .select('*')
        .eq('blockchain_status', 'not_synced')
        .order('created_at', { ascending: true });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Error fetching pending sync transactions:', error);
      return { data: null, error };
    }
  },

  /**
   * Update transaction blockchain status
   */
  async updateBlockchainStatus(transactionId, blockchainData) {
    try {
      const { data, error } = await supabase
        .from('ican_transactions')
        .update({
          blockchain_status: 'synced',
          blockchain_tx_hash: blockchainData.txHash,
          blockchain_block_number: blockchainData.blockNumber,
          blockchain_synced_at: new Date().toISOString()
        })
        .eq('id', transactionId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Error updating blockchain status:', error);
      return { data: null, error };
    }
  }
};

export default TransactionService;
