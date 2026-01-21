/**
 * 🏪 Agent Cash-In Handler
 * Manages user withdrawals through agents
 * 
 * Flow:
 * 1. User selects agent and enters amount
 * 2. User's wallet is debited
 * 3. Agent's float is credited
 * 4. Transaction is recorded
 */

import { getSupabaseClient } from '../lib/supabase/client';

class AgentCashInHandler {
  constructor() {
    this.supabase = null;
  }

  /**
   * Process cash-in transaction (user withdrawal through agent)
   * @param {Object} params - Transaction parameters
   * @param {string} params.userId - User ID
   * @param {number} params.agentId - Agent ID
   * @param {string} params.currency - Currency (USD, UGX, KES)
   * @param {number} params.amount - Amount to withdraw
   * @returns {Promise<Object>} Success/error response
   */
  async processCashIn(params) {
    const { userId, agentId, currency, amount } = params;

    try {
      this.supabase = getSupabaseClient();

      // Validate inputs
      if (!userId || !agentId || !currency || !amount) {
        return {
          success: false,
          error: 'Missing required parameters'
        };
      }

      if (amount <= 0) {
        return {
          success: false,
          error: 'Amount must be greater than 0'
        };
      }

      // Step 1: Deduct from user's wallet using backend function
      console.log('🏧 Step 1: Deducting from user wallet...');
      const { data: deductedWallet, error: deductError } = await this.supabase
        .rpc('process_user_cash_out', {
          p_user_id: userId,
          p_curr: currency,
          p_amount: amount
        });

      if (deductError) {
        console.error('❌ Failed to deduct from wallet:', deductError);
        return {
          success: false,
          error: `Wallet deduction failed: ${deductError.message}`
        };
      }

      const userWallet = deductedWallet && deductedWallet.length > 0 ? deductedWallet[0] : null;
      
      if (!userWallet || parseFloat(userWallet.balance) < 0) {
        return {
          success: false,
          error: 'Insufficient wallet balance'
        };
      }

      console.log('✅ User wallet debited:', {
        newBalance: userWallet.balance,
        currency: userWallet.currency
      });

      // Step 2: Add to agent's float using backend function
      console.log('🏧 Step 2: Adding to agent float...');
      const { data: updatedFloat, error: floatError } = await this.supabase
        .rpc('process_agent_float_increase', {
          p_agent_id: agentId,
          p_curr: currency,
          p_amount: amount
        });

      if (floatError) {
        console.error('❌ Failed to update agent float:', floatError);
        // Try to refund the user
        await this.supabase
          .rpc('update_recipient_wallet_balance', {
            p_user_id: userId,
            p_curr: currency,
            p_amount: amount
          });
        
        return {
          success: false,
          error: `Agent float update failed: ${floatError.message}. Wallet refunded.`
        };
      }

      const agentFloat = updatedFloat && updatedFloat.length > 0 ? updatedFloat[0] : null;

      console.log('✅ Agent float credited:', {
        agentId: agentFloat?.agent_id,
        newBalance: agentFloat?.current_balance,
        currency: agentFloat?.currency
      });

      // Step 3: Record transaction
      console.log('🏧 Step 3: Recording transaction...');
      const transactionId = `CASH-IN-${Date.now()}-${agentId}`;
      
      const { data: txData, error: txError } = await this.supabase
        .rpc('record_cash_in_transaction', {
          p_user_id: userId,
          p_agent_id: agentId,
          p_curr: currency,
          p_amount: amount,
          p_transaction_id: transactionId
        });

      if (txError) {
        console.warn('⚠️ Transaction recording failed:', txError);
        // Don't fail the entire operation if transaction recording fails
      } else {
        console.log('✅ Transaction recorded:', transactionId);
      }

      return {
        success: true,
        transactionId: transactionId,
        userWallet: userWallet,
        agentFloat: agentFloat,
        message: `✅ Successfully withdrew ${amount} ${currency} through agent ${agentId}`
      };

    } catch (error) {
      console.error('❌ Cash-in process failed:', error);
      return {
        success: false,
        error: error.message || 'An error occurred during cash-in process'
      };
    }
  }

  /**
   * Get agent float (current balance)
   * @param {number} agentId - Agent ID
   * @param {string} currency - Currency
   * @returns {Promise<Object>} Float data
   */
  async getAgentFloat(agentId, currency) {
    try {
      this.supabase = getSupabaseClient();

      const { data, error } = await this.supabase
        .from('agent_floats')
        .select('*')
        .eq('agent_id', agentId)
        .eq('currency', currency)
        .maybeSingle();

      if (error) {
        console.error('Error fetching agent float:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error in getAgentFloat:', error);
      return null;
    }
  }

  /**
   * Get all agent floats
   * @param {number} agentId - Agent ID
   * @returns {Promise<Array>} Array of floats for all currencies
   */
  async getAllAgentFloats(agentId) {
    try {
      this.supabase = getSupabaseClient();

      const { data, error } = await this.supabase
        .from('agent_floats')
        .select('*')
        .eq('agent_id', agentId);

      if (error) {
        console.error('Error fetching agent floats:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getAllAgentFloats:', error);
      return [];
    }
  }
}

export default new AgentCashInHandler();
