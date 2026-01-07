import { supabase } from '../client.js';

/**
 * Contract Service - Smart contract vetting records for ICAN
 * Stores contract analysis results for blockchain audit trail
 */

export const ContractService = {
  /**
   * Save contract analysis result
   */
  async saveContractAnalysis(analysisData) {
    try {
      const { data, error } = await supabase
        .from('ican_contract_analyses')
        .insert({
          user_id: analysisData.userId,
          contract_hash: analysisData.contractHash,
          contract_text_encrypted: analysisData.encryptedText,
          safety_score: analysisData.safetyScore,
          risk_level: analysisData.riskLevel,
          liability_flags: analysisData.liabilityFlags,
          recommendations: analysisData.recommendations,
          ai_model_version: analysisData.aiModelVersion,
          biometric_verified: analysisData.biometricVerified,
          blockchain_status: 'not_synced',
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Error saving contract analysis:', error);
      return { data: null, error };
    }
  },

  /**
   * Get user's contract analyses
   */
  async getUserContractAnalyses(userId) {
    try {
      const { data, error } = await supabase
        .from('ican_contract_analyses')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Error fetching contract analyses:', error);
      return { data: null, error };
    }
  },

  /**
   * Get contract analysis by hash (for blockchain verification)
   */
  async getByContractHash(contractHash) {
    try {
      const { data, error } = await supabase
        .from('ican_contract_analyses')
        .select('*')
        .eq('contract_hash', contractHash)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Error fetching contract by hash:', error);
      return { data: null, error };
    }
  },

  /**
   * Update blockchain sync status
   */
  async updateBlockchainStatus(analysisId, blockchainData) {
    try {
      const { data, error } = await supabase
        .from('ican_contract_analyses')
        .update({
          blockchain_status: 'synced',
          blockchain_tx_hash: blockchainData.txHash,
          blockchain_block_number: blockchainData.blockNumber,
          blockchain_synced_at: new Date().toISOString()
        })
        .eq('id', analysisId)
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

export default ContractService;
