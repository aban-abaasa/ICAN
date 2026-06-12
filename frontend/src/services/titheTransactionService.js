/**
 * titheTransactionService.js
 * Service layer for the new tithe transaction tracking system
 * 
 * Usage:
 * import { titheTransactionService } from './services/titheTransactionService';
 * 
 * // Record a tithe from a transaction
 * await titheTransactionService.recordTitheFromTransaction(transactionId, 'personal');
 * 
 * // Process a tithe payment
 * await titheTransactionService.processTithePayment(paymentTransactionId, 10000, 'personal');
 * 
 * // Get all transactions with tithe status
 * const transactions = await titheTransactionService.getTransactionsWithTithe('personal');
 * 
 * // Get tithe summary
 * const summary = await titheTransactionService.getTitheSummary('personal');
 */

import { supabase } from '../lib/supabaseClient';

class TitheTransactionService {
  /**
   * Record a tithe from a transaction
   * Automatically calculates 10% tithe and creates a tithe record
   * 
   * @param {string} transactionId - UUID of the source transaction
   * @param {string} titheType - 'personal', 'business', or 'combined' (default: 'personal')
   * @param {number} tithePercentage - Tithe percentage (default: 10.0)
   * @param {string} recipientName - Name of tithe recipient (default: 'Church')
   * @returns {Promise<{success: boolean, tithe_record_id: string, message: string, tithe_calculated: number}>}
   */
  async recordTitheFromTransaction(
    transactionId,
    titheType = 'personal',
    tithePercentage = 10.0,
    recipientName = 'Church'
  ) {
    try {
      const { data, error } = await supabase.rpc('fn_record_tithe_from_transaction', {
        p_transaction_id: transactionId,
        p_tithe_type: titheType,
        p_tithe_percentage: tithePercentage,
        p_recipient_name: recipientName
      });

      if (error) {
        console.error('Error recording tithe:', error);
        return {
          success: false,
          error: error.message,
          data: null
        };
      }

      console.log(`✅ Tithe recorded: ${data?.[0]?.message}`);
      return {
        success: data?.[0]?.success,
        tithe_record_id: data?.[0]?.tithe_record_id,
        message: data?.[0]?.message,
        tithe_calculated: data?.[0]?.tithe_calculated,
        data: data?.[0]
      };
    } catch (error) {
      console.error('Service error:', error);
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  /**
   * Process a tithe payment
   * Applies payment to pending tithes (oldest first, FIFO)
   * Only clears the specific tithes being paid, not all tithes
   * 
   * @param {string} paymentTransactionId - UUID of the tithe payment transaction
   * @param {number} amount - Amount being paid
   * @param {string} paymentType - 'personal', 'business', or 'combined'
   * @returns {Promise<{success: boolean, message: string, tithes_cleared: number, amount_applied: number, amount_remaining: number}>}
   */
  async processTithePayment(paymentTransactionId, amount, paymentType = 'personal') {
    try {
      const { data, error } = await supabase.rpc('fn_process_tithe_payment', {
        p_tithe_payment_transaction_id: paymentTransactionId,
        p_payment_amount: amount,
        p_payment_type: paymentType
      });

      if (error) {
        console.error('Error processing tithe payment:', error);
        return {
          success: false,
          error: error.message,
          data: null
        };
      }

      console.log(`✅ Tithe payment processed: ${data?.[0]?.message}`);
      return {
        success: data?.[0]?.success,
        message: data?.[0]?.message,
        tithes_cleared: data?.[0]?.tithes_cleared,
        amount_applied: data?.[0]?.amount_applied,
        amount_remaining: data?.[0]?.amount_remaining,
        data: data?.[0]
      };
    } catch (error) {
      console.error('Service error:', error);
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  /**
   * Update tithe summary for a user
   * Recalculates all tithe totals from individual tithe records
   * 
   * @param {string} userId - UUID of the user
   * @returns {Promise<{success: boolean, personal_total: number, business_total: number, personal_remaining: number, business_remaining: number}>}
   */
  async updateTitheSummary(userId) {
    try {
      const { data, error } = await supabase.rpc('fn_update_tithe_summary', {
        p_user_id: userId
      });

      if (error) {
        console.error('Error updating tithe summary:', error);
        return {
          success: false,
          error: error.message,
          data: null
        };
      }

      console.log('✅ Tithe summary updated');
      return {
        success: data?.[0]?.success,
        personal_total: data?.[0]?.personal_total,
        business_total: data?.[0]?.business_total,
        personal_remaining: data?.[0]?.personal_remaining,
        business_remaining: data?.[0]?.business_remaining,
        data: data?.[0]
      };
    } catch (error) {
      console.error('Service error:', error);
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  }

  /**
   * Get all transactions with their tithe status
   * Uses the v_transactions_with_tithe view for real-time data
   * 
   * @param {string} titheType - Filter by 'personal', 'business', or 'all'
   * @param {string} filter - Filter by tithe status: 'all', 'pending', 'paid', 'partial'
   * @param {number} limit - Limit number of results (default: 100)
   * @returns {Promise<Array>}
   */
  async getTransactionsWithTithe(titheType = 'personal', filter = 'all', limit = 100) {
    try {
      let query = supabase
        .from('v_transactions_with_tithe')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (titheType !== 'all') {
        query = query.eq('tithe_type', titheType);
      }

      if (filter === 'pending') {
        query = query.eq('tithe_status', 'pending');
      } else if (filter === 'paid') {
        query = query.eq('tithe_status', 'paid');
      } else if (filter === 'partial') {
        query = query.eq('tithe_status', 'partially_paid');
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching transactions:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Service error:', error);
      return [];
    }
  }

  /**
   * Get personal tithe tracking summary
   * Shows total owed, paid, remaining for personal income
   * 
   * @returns {Promise<Object>}
   */
  async getPersonalTitheSummary() {
    try {
      const { data, error } = await supabase
        .from('v_personal_tithe_tracking')
        .select('*')
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching personal tithe summary:', error);
        return null;
      }

      return data || null;
    } catch (error) {
      console.error('Service error:', error);
      return null;
    }
  }

  /**
   * Get business tithe tracking summary
   * Shows total owed, paid, remaining for business income
   * 
   * @returns {Promise<Object>}
   */
  async getBusinessTitheSummary() {
    try {
      const { data, error } = await supabase
        .from('v_business_tithe_tracking')
        .select('*')
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching business tithe summary:', error);
        return null;
      }

      return data || null;
    } catch (error) {
      console.error('Service error:', error);
      return null;
    }
  }

  /**
   * Get tithe summary (auto-detects personal/business based on titheType)
   * 
   * @param {string} titheType - 'personal' or 'business'
   * @returns {Promise<Object>}
   */
  async getTitheSummary(titheType = 'personal') {
    if (titheType === 'personal') {
      return this.getPersonalTitheSummary();
    } else {
      return this.getBusinessTitheSummary();
    }
  }

  /**
   * Get all pending tithes for a specific type
   * 
   * @param {string} titheType - 'personal' or 'business'
   * @returns {Promise<Array>}
   */
  async getPendingTithes(titheType = 'personal') {
    return this.getTransactionsWithTithe(titheType, 'pending');
  }

  /**
   * Get all paid tithes for a specific type
   * 
   * @param {string} titheType - 'personal' or 'business'
   * @returns {Promise<Array>}
   */
  async getPaidTithes(titheType = 'personal') {
    return this.getTransactionsWithTithe(titheType, 'paid');
  }

  /**
   * Get tithe details for a specific transaction
   * 
   * @param {string} transactionId - UUID of the transaction
   * @returns {Promise<Object|null>}
   */
  async getTitheForTransaction(transactionId) {
    try {
      const { data, error } = await supabase
        .from('tithe_transaction_records')
        .select('*')
        .eq('source_transaction_id', transactionId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching tithe:', error);
        return null;
      }

      return data || null;
    } catch (error) {
      console.error('Service error:', error);
      return null;
    }
  }

  /**
   * Cancel a tithe record (mark as cancelled)
   * Use this when you want to undo a tithe from a transaction
   * 
   * @param {string} titheRecordId - UUID of the tithe record
   * @param {string} reason - Reason for cancellation
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async cancelTithe(titheRecordId, reason = 'User requested cancellation') {
    try {
      const { data, error } = await supabase
        .from('tithe_transaction_records')
        .update({
          tithe_status: 'cancelled',
          notes: reason,
          updated_at: new Date().toISOString()
        })
        .eq('id', titheRecordId)
        .select();

      if (error) {
        console.error('Error cancelling tithe:', error);
        return {
          success: false,
          error: error.message
        };
      }

      console.log('✅ Tithe cancelled');
      return {
        success: true,
        message: 'Tithe cancelled successfully',
        data: data?.[0]
      };
    } catch (error) {
      console.error('Service error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Validate that a transaction won't be double-tithed
   * Returns true if safe to record tithe, false if would conflict
   * 
   * @param {string} transactionId - UUID of the transaction
   * @param {string} titheType - 'personal' or 'business'
   * @returns {Promise<boolean>}
   */
  async isSafeToRecordTithe(transactionId, titheType = 'personal') {
    try {
      const { data, error } = await supabase
        .from('tithe_transaction_records')
        .select('id')
        .eq('source_transaction_id', transactionId)
        .eq('tithe_type', titheType)
        .eq('tithe_status', 'paid')
        .single();

      // If no paid tithe exists for this combo, it's safe
      return !data;
    } catch (error) {
      // If error is "not found", it's safe
      if (error?.code === 'PGRST116') {
        return true;
      }
      console.error('Validation error:', error);
      return false;
    }
  }

  /**
   * Get detailed tithe payment history for a transaction
   * Shows all payment transactions linked to this tithe
   * 
   * @param {string} titheRecordId - UUID of the tithe record
   * @returns {Promise<Array>}
   */
  async getTithePaymentHistory(titheRecordId) {
    try {
      const { data, error } = await supabase
        .from('tithe_transaction_records')
        .select(`
          *,
          payment_transaction:payment_transaction_id (
            id,
            created_at,
            amount,
            description
          )
        `)
        .eq('id', titheRecordId)
        .single();

      if (error) {
        console.error('Error fetching payment history:', error);
        return [];
      }

      return data?.payment_transaction ? [data.payment_transaction] : [];
    } catch (error) {
      console.error('Service error:', error);
      return [];
    }
  }

  /**
   * Get statistics for tithe dashboard
   * 
   * @returns {Promise<Object>}
   */
  async getTitheStatistics() {
    try {
      // Get personal summary
      const personal = await this.getPersonalTitheSummary();
      
      // Get business summary
      const business = await this.getBusinessTitheSummary();

      return {
        personal: {
          total: personal?.personal_tithe_total || 0,
          paid: personal?.personal_tithe_paid || 0,
          remaining: personal?.personal_tithe_remaining || 0,
          pending_count: personal?.personal_pending_count || 0
        },
        business: {
          total: business?.business_tithe_total || 0,
          paid: business?.business_tithe_paid || 0,
          remaining: business?.business_tithe_remaining || 0,
          pending_count: business?.business_pending_count || 0
        },
        combined: {
          total: (personal?.personal_tithe_total || 0) + (business?.business_tithe_total || 0),
          paid: (personal?.personal_tithe_paid || 0) + (business?.business_tithe_paid || 0),
          remaining: (personal?.personal_tithe_remaining || 0) + (business?.business_tithe_remaining || 0)
        }
      };
    } catch (error) {
      console.error('Error fetching statistics:', error);
      return null;
    }
  }
}

// Export as singleton
export const titheTransactionService = new TitheTransactionService();

// Also export class for testing/extending
export default TitheTransactionService;
