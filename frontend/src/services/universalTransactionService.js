/**
 * 🔐 UNIVERSAL TRANSACTION SERVICE
 * 
 * Single service for processing ANY transaction type with PIN verification
 * Works with UnifiedApprovalModal for consistent UX across all operations
 */

import { getSupabaseClient } from '../lib/supabase/client';

// Hash PIN using the same method as walletAccountService
const hashPIN = (pin) => {
  let hash = 0;
  const string = `pin-${pin}-salt-ican-hash`;
  
  for (let i = 0; i < string.length; i++) {
    const char = string.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  return btoa(`hash-${Math.abs(hash)}-${pin.length}`);
};

class UniversalTransactionService {
  /**
   * Process any transaction with PIN verification
   * @param {Object} params
   * @param {string} params.transactionType - 'send', 'receive', 'withdraw', 'deposit', 'cashIn', 'cashOut', 'topup'
   * @param {string} params.userId - User making the transaction
   * @param {string} params.agentId - Agent involved (nullable for P2P/topup)
   * @param {string} params.pin - 4-digit PIN
   * @param {string} params.currency - Currency code (e.g., 'UGX')
   * @param {number} params.amount - Transaction amount
   * @param {Object} params.metadata - Additional data (recipient_id, sender_id, commission_rate, etc.)
   * @returns {Promise<Object>} Success/failure with balances and transaction ID
   */
  async processTransaction({
    transactionType,
    userId,
    agentId = null,
    pin,
    currency,
    amount,
    metadata = {}
  }) {
    try {
      if (!transactionType || !userId || !pin || !currency || !amount) {
        throw new Error('Missing required transaction parameters');
      }

      if (pin.length !== 4) {
        throw new Error('PIN must be 4 digits');
      }

      // Hash PIN before sending to backend
      const hashedPin = hashPIN(pin);

      // Call universal PIN verification function
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.rpc('process_transaction_with_pin', {
        p_transaction_type: transactionType,
        p_user_id: userId,
        p_agent_id: agentId,
        p_pin_attempt: hashedPin,  // ✅ Send hashed PIN
        p_currency: currency,
        p_amount: amount,
        p_metadata: metadata
      });

      if (error) throw error;

      if (!data || !data[0]) {
        throw new Error('No response from transaction processor');
      }

      const result = data[0];

      return {
        success: result.success,
        message: result.message,
        transactionId: result.transaction_id,
        userBalance: result.user_balance,
        agentBalance: result.agent_balance,
        recipientBalance: result.recipient_balance
      };
    } catch (error) {
      console.error('Transaction processing error:', error);
      return {
        success: false,
        message: error.message || 'Transaction failed',
        transactionId: null,
        userBalance: 0,
        agentBalance: 0,
        recipientBalance: 0
      };
    }
  }

  /**
   * Request transaction approval (creates pending record)
   * @param {Object} params
   * @returns {Promise<Object>} Request ID and status
   */
  async requestApproval({
    transactionType,
    userId,
    agentId = null,
    currency,
    amount,
    metadata = {}
  }) {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.rpc('request_transaction_approval', {
        p_transaction_type: transactionType,
        p_user_id: userId,
        p_agent_id: agentId,
        p_currency: currency,
        p_amount: amount,
        p_metadata: metadata
      });

      if (error) throw error;

      return {
        success: true,
        requestId: data[0].request_id,
        status: data[0].status
      };
    } catch (error) {
      console.error('Request approval error:', error);
      return {
        success: false,
        message: error.message,
        requestId: null
      };
    }
  }

  /**
   * Approve transaction from pending request
   * @param {string} requestId - UUID of the request
   * @param {string} pin - 4-digit PIN
   * @returns {Promise<Object>} Success/failure with transaction ID
   */
  async approveRequest(requestId, pin) {
    try {
      if (!requestId || !pin) {
        throw new Error('Missing request ID or PIN');
      }

      const supabase = getSupabaseClient();
      const { data, error } = await supabase.rpc('approve_transaction_request', {
        p_request_id: requestId,
        p_pin_attempt: pin
      });

      if (error) throw error;

      const result = data[0];

      return {
        success: result.success,
        message: result.message,
        transactionId: result.transaction_id
      };
    } catch (error) {
      console.error('Request approval error:', error);
      return {
        success: false,
        message: error.message,
        transactionId: null
      };
    }
  }

  /**
   * Reject a pending transaction request
   * @param {string} requestId - UUID of the request
   * @returns {Promise<Object>} Success/failure
   */
  async rejectRequest(requestId) {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.rpc('reject_transaction_request', {
        p_request_id: requestId
      });

      if (error) throw error;

      return {
        success: data[0].success,
        message: data[0].message
      };
    } catch (error) {
      console.error('Request rejection error:', error);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Convenience method - Send money to another user
   */
  async sendMoney({ userId, recipientId, currency, amount, pin, description = '' }) {
    return this.processTransaction({
      transactionType: 'send',
      userId,
      currency,
      amount,
      pin,
      metadata: {
        recipient_id: recipientId,
        description
      }
    });
  }

  /**
   * Convenience method - Receive money from another user
   */
  async receiveMoney({ userId, senderId, currency, amount, pin }) {
    return this.processTransaction({
      transactionType: 'receive',
      userId,
      currency,
      amount,
      pin,
      metadata: {
        sender_id: senderId
      }
    });
  }

  /**
   * Convenience method - Withdraw via agent
   */
  async withdraw({ userId, agentId, currency, amount, pin, description = '' }) {
    return this.processTransaction({
      transactionType: 'withdraw',
      userId,
      agentId,
      currency,
      amount,
      pin,
      metadata: { description }
    });
  }

  /**
   * Convenience method - Deposit via agent
   */
  async deposit({ userId, agentId, currency, amount, pin, description = '' }) {
    return this.processTransaction({
      transactionType: 'deposit',
      userId,
      agentId,
      currency,
      amount,
      pin,
      metadata: { description }
    });
  }

  /**
   * Convenience method - Cash-in via agent
   */
  async cashIn({ userId, agentId, currency, amount, pin, description = '' }) {
    return this.processTransaction({
      transactionType: 'cashIn',
      userId,
      agentId,
      currency,
      amount,
      pin,
      metadata: { description }
    });
  }

  /**
   * Convenience method - Cash-out via agent with commission
   */
  async cashOut({ userId, agentId, currency, amount, pin, commissionRate = 2.5, description = '' }) {
    return this.processTransaction({
      transactionType: 'cashOut',
      userId,
      agentId,
      currency,
      amount,
      pin,
      metadata: {
        commission_rate: commissionRate,
        description
      }
    });
  }

  /**
   * Convenience method - Top-up credit
   */
  async topUp({ userId, currency, amount, pin, description = '' }) {
    return this.processTransaction({
      transactionType: 'topup',
      userId,
      currency,
      amount,
      pin,
      metadata: { description }
    });
  }
}

// Export singleton instance
export default new UniversalTransactionService();
