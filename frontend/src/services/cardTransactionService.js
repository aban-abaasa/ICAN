import { getSupabaseClient } from '../lib/supabase/client';

/**
 * 💳 Card Transaction Service
 * Stores Flutterwave card payments in Supabase
 */

class CardTransactionService {
  constructor() {
    this.supabase = null;
    this.userId = null;
  }

  async initialize() {
    this.supabase = getSupabaseClient();
    
    if (!this.supabase) {
      console.error('❌ Supabase client not initialized');
      return false;
    }

    try {
      const { data: { user }, error } = await this.supabase.auth.getUser();
      if (error || !user) {
        console.warn('⚠️ User not authenticated');
        return false;
      }
      this.userId = user.id;
      console.log('✅ Card Transaction Service initialized');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize:', error);
      return false;
    }
  }

  /**
   * Save card payment transaction
   */
  async saveCardPayment(params) {
    if (!this.userId) {
      console.warn('⚠️ User not authenticated');
      return { success: false, error: 'User not authenticated' };
    }

    try {
      const {
        amount,
        currency,
        flutterwaveTransactionId,
        reference,
        paymentMethod,
        customerEmail,
        customerName,
        status = 'PENDING',
        verificationStatus = 'UNVERIFIED'
      } = params;

      const { data, error } = await this.supabase
        .from('ican_transactions')
        .insert([
          {
            user_id: this.userId,
            transaction_type: 'card_payment',
            amount: parseFloat(amount),
            currency: currency,
            description: `Card payment via ${paymentMethod} - ${customerName}`,
            status: status,
            metadata: {
              flutterwaveTransactionId,
              reference,
              paymentMethod,
              customerEmail,
              customerName,
              verificationStatus,
              timestamp: new Date().toISOString()
            }
          }
        ])
        .select();

      if (error) {
        console.error('❌ Failed to save card payment:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Card payment saved:', data[0]);
      return { success: true, data: data[0] };
    } catch (error) {
      console.error('❌ Error saving card payment:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update card payment status after verification
   */
  async updatePaymentStatus(params) {
    if (!this.userId) {
      return { success: false, error: 'User not authenticated' };
    }

    try {
      const { reference, status, verificationStatus } = params;

      const { data, error } = await this.supabase
        .from('ican_transactions')
        .update({
          status: status,
          metadata: {
            verificationStatus: verificationStatus,
            verifiedAt: new Date().toISOString()
          }
        })
        .match({
          user_id: this.userId,
          'metadata->reference': reference
        })
        .select();

      if (error) {
        console.error('❌ Failed to update payment status:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Payment status updated:', data);
      return { success: true, data: data };
    } catch (error) {
      console.error('❌ Error updating payment:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get card payment history
   */
  async getCardPayments(options = {}) {
    if (!this.userId) {
      return [];
    }

    try {
      const { limit = 50, offset = 0 } = options;

      let query = this.supabase
        .from('ican_transactions')
        .select('*')
        .eq('user_id', this.userId)
        .eq('transaction_type', 'card_payment')
        .order('created_at', { ascending: false });

      if (limit) query = query.limit(limit);
      if (offset) query = query.range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) {
        console.error('❌ Failed to fetch card payments:', error);
        return [];
      }

      console.log(`✅ Fetched ${data.length} card payments`);
      return data || [];
    } catch (error) {
      console.error('❌ Error fetching card payments:', error);
      return [];
    }
  }
}

export const cardTransactionService = new CardTransactionService();
