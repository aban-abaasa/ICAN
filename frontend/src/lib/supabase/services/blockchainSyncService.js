import { supabase } from '../client.js';

/**
 * Blockchain Sync Service - Unified data layer for blockchain integration
 * Aggregates data from both FARM-AGENT and ICAN for blockchain preparation
 */

export const BlockchainSyncService = {
  /**
   * Get all data ready for blockchain sync
   * Combines FARM-AGENT marketplace data with ICAN financial data
   */
  async getAllPendingSyncData() {
    try {
      // Get pending ICAN transactions
      const { data: transactions, error: txError } = await supabase
        .from('ican_transactions')
        .select('*')
        .eq('blockchain_status', 'not_synced');

      // Get pending contract analyses
      const { data: contracts, error: contractError } = await supabase
        .from('ican_contract_analyses')
        .select('*')
        .eq('blockchain_status', 'not_synced');

      // Get marketplace listings (from FARM-AGENT)
      const { data: listings, error: listingError } = await supabase
        .from('marketplace_listings')
        .select('id, user_id, title, listing_type, price, status, created_at')
        .eq('blockchain_synced', false);

      if (txError || contractError || listingError) {
        throw new Error('Error fetching pending sync data');
      }

      return {
        data: {
          transactions: transactions || [],
          contracts: contracts || [],
          listings: listings || []
        },
        error: null
      };
    } catch (error) {
      console.error('Error fetching pending sync data:', error);
      return { data: null, error };
    }
  },

  /**
   * Create a blockchain sync record
   */
  async createSyncRecord(syncData) {
    try {
      const { data, error } = await supabase
        .from('blockchain_sync_log')
        .insert({
          sync_type: syncData.type,
          record_id: syncData.recordId,
          record_table: syncData.table,
          data_hash: syncData.dataHash,
          blockchain_network: syncData.network || 'ethereum',
          status: 'pending',
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Error creating sync record:', error);
      return { data: null, error };
    }
  },

  /**
   * Update sync record with blockchain confirmation
   */
  async confirmSync(syncId, blockchainData) {
    try {
      const { data, error } = await supabase
        .from('blockchain_sync_log')
        .update({
          status: 'confirmed',
          tx_hash: blockchainData.txHash,
          block_number: blockchainData.blockNumber,
          gas_used: blockchainData.gasUsed,
          confirmed_at: new Date().toISOString()
        })
        .eq('id', syncId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Error confirming sync:', error);
      return { data: null, error };
    }
  },

  /**
   * Get sync history
   */
  async getSyncHistory(limit = 100) {
    try {
      const { data, error } = await supabase
        .from('blockchain_sync_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Error fetching sync history:', error);
      return { data: null, error };
    }
  },

  /**
   * Get cross-app user activity for blockchain identity
   */
  async getUserBlockchainProfile(userId) {
    try {
      // Get user profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, email, first_name, last_name, is_verified, created_at')
        .eq('id', userId)
        .single();

      // Get ICAN transactions count
      const { count: txCount } = await supabase
        .from('ican_transactions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      // Get FARM-AGENT marketplace listings count
      const { count: listingCount } = await supabase
        .from('marketplace_listings')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      // Get contract analyses count
      const { count: contractCount } = await supabase
        .from('ican_contract_analyses')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      return {
        data: {
          profile,
          activity: {
            totalTransactions: txCount || 0,
            totalListings: listingCount || 0,
            totalContractAnalyses: contractCount || 0
          },
          blockchainReady: profile?.is_verified || false
        },
        error: null
      };
    } catch (error) {
      console.error('Error fetching blockchain profile:', error);
      return { data: null, error };
    }
  }
};

export default BlockchainSyncService;
