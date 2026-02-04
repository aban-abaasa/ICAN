import { supabase } from '../config/supabase.js';

/**
 * Backend Blockchain Service
 * Server-side operations for blockchain integration
 * Uses service role key for admin operations
 */

export const BlockchainService = {
  /**
   * Get all data pending blockchain sync (admin)
   */
  async getAllPendingSync() {
    const [transactions, contracts, listings] = await Promise.all([
      supabase
        .from('ican_transactions')
        .select('*')
        .eq('blockchain_status', 'not_synced'),
      supabase
        .from('ican_contract_analyses')
        .select('*')
        .eq('blockchain_status', 'not_synced'),
      supabase
        .from('marketplace_listings')
        .select('*')
        .eq('blockchain_synced', false)
    ]);

    return {
      transactions: transactions.data || [],
      contracts: contracts.data || [],
      listings: listings.data || []
    };
  },

  /**
   * Batch update blockchain sync status
   */
  async batchUpdateSyncStatus(updates) {
    const results = [];

    for (const update of updates) {
      const { table, id, txHash, blockNumber } = update;

      let result;
      if (table === 'ican_transactions') {
        result = await supabase
          .from('ican_transactions')
          .update({
            blockchain_status: 'synced',
            blockchain_tx_hash: txHash,
            blockchain_block_number: blockNumber,
            blockchain_synced_at: new Date().toISOString()
          })
          .eq('id', id);
      } else if (table === 'ican_contract_analyses') {
        result = await supabase
          .from('ican_contract_analyses')
          .update({
            blockchain_status: 'synced',
            blockchain_tx_hash: txHash,
            blockchain_block_number: blockNumber,
            blockchain_synced_at: new Date().toISOString()
          })
          .eq('id', id);
      } else if (table === 'marketplace_listings') {
        result = await supabase
          .from('marketplace_listings')
          .update({
            blockchain_synced: true,
            blockchain_tx_hash: txHash,
            blockchain_synced_at: new Date().toISOString()
          })
          .eq('id', id);
      }

      results.push({ table, id, success: !result.error });
    }

    return results;
  },

  /**
   * Create sync log entry
   */
  async logSync(syncData) {
    const { data, error } = await supabase
      .from('blockchain_sync_log')
      .insert({
        sync_type: syncData.type,
        record_id: syncData.recordId,
        record_table: syncData.table,
        data_hash: syncData.dataHash,
        blockchain_network: syncData.network || 'ethereum',
        status: 'pending'
      })
      .select()
      .single();

    return { data, error };
  },

  /**
   * Get user's complete cross-app data for blockchain profile
   */
  async getUserCompleteProfile(userId) {
    const [profile, transactions, contracts, listings, wallets] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('ican_transactions').select('*').eq('user_id', userId),
      supabase.from('ican_contract_analyses').select('*').eq('user_id', userId),
      supabase.from('marketplace_listings').select('*').eq('user_id', userId),
      supabase.from('ican_wallets').select('*').eq('user_id', userId)
    ]);

    return {
      profile: profile.data,
      ican: {
        transactions: transactions.data || [],
        contracts: contracts.data || []
      },
      farmAgent: {
        listings: listings.data || []
      },
      wallets: wallets.data || [],
      stats: {
        totalTransactions: transactions.data?.length || 0,
        totalContracts: contracts.data?.length || 0,
        totalListings: listings.data?.length || 0,
        totalValue: transactions.data?.reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0) || 0
      }
    };
  },

  /**
   * Verify user wallet ownership
   */
  async verifyWallet(userId, walletAddress, signature) {
    // In production, verify the signature against the wallet address
    const { data, error } = await supabase
      .from('ican_wallets')
      .upsert({
        user_id: userId,
        wallet_address: walletAddress,
        is_verified: true,
        verification_signature: signature,
        verified_at: new Date().toISOString()
      })
      .select()
      .single();

    if (!error) {
      // Update profile with primary wallet
      await supabase
        .from('profiles')
        .update({
          blockchain_wallet_address: walletAddress,
          blockchain_verified: true,
          blockchain_verified_at: new Date().toISOString()
        })
        .eq('id', userId);
    }

    return { data, error };
  }
};

export default BlockchainService;
