/**
 * 📱 Mobile Money (MOMO) API Service
 * Handles all mobile money transactions for wallet top-ups and transfers
 * ✅ Uses MTN MOMO API + Supabase for secure transaction management
 */

import { getSupabaseClient } from '../lib/supabase/client';
import { payWithFlutterwave, generateTxRef } from './flutterwaveClient';

class MOmoService {
  constructor() {
    // Supabase client for transaction recording
    this.supabase = null;
    
    // MTN MOMO API Configuration
    this.momoApiUrl = import.meta.env.VITE_MOMO_API_URL || 'https://api.sandbox.momodeveloper.mtn.com';
    this.momoApiKey = import.meta.env.VITE_MOMO_PRIMARY_KEY;
    this.momoApiKeySecondary = import.meta.env.VITE_MOMO_SECONDARY_KEY;
    
    this.useMockMode = import.meta.env.VITE_MOMO_USE_MOCK === 'true';
    this.timeout = import.meta.env.VITE_MOMO_TIMEOUT || 30000;
    
    // Log initialization
    if (this.useMockMode) {
      console.log('🧪 MOMO Service initialized in MOCK MODE (Development)');
      console.log('   Transactions will be simulated without calling real API');
    } else {
      console.log('🚀 MOMO Service initialized (Production)');
      console.log(`   📡 MTN MOMO API: ${this.momoApiUrl}`);
      console.log('   💾 Recording transactions in Supabase');
    }
  }

  /**
   * Generate unique reference ID for each transaction
   */
  generateReferenceId() {
    return `ICAN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 💰 Process Top-Up via Flutterwave (card, mobile money, bank account)
   * Replaces the previous direct MTN MOMO request-payment call — Flutterwave
   * Checkout handles MTN and Airtel Uganda mobile money, cards, and bank
   * accounts through one integration, verified server-side before the
   * transaction is recorded.
   * @param {Object} params - Transaction parameters
   * @param {string} params.amount - Amount to top up
   * @param {string} params.currency - Currency code (UGX, KES, USD, etc.)
   * @param {string} params.phoneNumber - Customer phone number
   * @param {string} params.description - Transaction description
   * @returns {Promise<Object>} Transaction result
   */
  async processTopUp(params) {
    const { amount, currency, phoneNumber, description } = params;

    try {
      // Validate inputs
      if (!amount || !currency || !phoneNumber) {
        throw new Error('Missing required fields: amount, currency, phoneNumber');
      }

      const mode = this.useMockMode ? 'MOCK' : 'LIVE';
      const finalCurrency = currency.toUpperCase();

      console.log(`🚀 Processing Flutterwave Top-Up (${mode} Mode):`, {
        amount,
        currency: finalCurrency,
        phoneNumber
      });

      // Mock mode - skip real payment
      if (this.useMockMode) {
        console.log('🧪 Mock Mode: Simulating successful transaction');
        await new Promise(resolve => setTimeout(resolve, 800));

        return {
          success: true,
          transactionId: this.generateReferenceId(),
          amount: amount,
          currency: currency,
          status: 'COMPLETED',
          timestamp: new Date().toISOString(),
          mode: 'MOCK',
          message: `✅ [MOCK MODE] Successfully added ${amount} ${currency} to your ICAN Wallet`
        };
      }

      this.supabase = getSupabaseClient();
      if (!this.supabase) {
        throw new Error('Supabase client not initialized');
      }

      const { data: { user } } = await this.supabase.auth.getUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      const txRef = generateTxRef('ICAN-TOPUP');
      const payment = await payWithFlutterwave({
        amount: parseFloat(amount),
        currency: finalCurrency,
        customerEmail: user.email,
        customerName: user.user_metadata?.full_name,
        customerPhone: phoneNumber,
        title: 'ICAN Wallet Top-Up',
        description: description || 'ICAN Wallet Top-Up',
        txRef,
      });

      if (payment.status === 'cancelled') {
        return {
          success: false,
          status: 'CANCELLED',
          message: 'Payment cancelled'
        };
      }
      if (payment.status !== 'successful' || !payment.transaction_id) {
        throw new Error('Payment was not successful');
      }

      const { data, error } = await this.supabase.functions.invoke('verify-flutterwave-topup', {
        body: {
          transaction_id: payment.transaction_id,
          tx_ref: txRef,
          amount: parseFloat(amount),
          currency: finalCurrency,
          phone_number: phoneNumber,
          description: description || 'ICAN Wallet Top-Up via Flutterwave',
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Payment verification failed');

      return {
        success: true,
        transactionId: data.transactionId || payment.transaction_id,
        amount: amount,
        currency: finalCurrency,
        status: 'COMPLETED',
        timestamp: new Date().toISOString(),
        mode: 'LIVE',
        message: `✅ Successfully added ${amount} ${finalCurrency} to your ICAN Wallet via Flutterwave`
      };
    } catch (error) {
      console.error('❌ Flutterwave Top-Up failed:', error);
      return {
        success: false,
        error: error.message,
        status: 'FAILED',
        mode: this.useMockMode ? 'MOCK' : 'LIVE',
        message: error.message.includes('Network')
          ? '⚠️ Network error. Check your internet connection and try again.'
          : 'Failed to process top-up. Please try again.'
      };
    }
  }

  /**
   * 📤 Process Money Transfer via MOMO (Supabase)
   * @param {Object} params - Transfer parameters
   * @param {string} params.amount - Amount to send
   * @param {string} params.currency - Currency code
   * @param {string} params.recipientPhone - Recipient phone number
   * @param {string} params.description - Transfer description
   * @returns {Promise<Object>} Transfer result
   */
  async processTransfer(params) {
    const { amount, currency, recipientPhone, description } = params;

    try {
      // Validate inputs
      if (!amount || !currency || !recipientPhone) {
        throw new Error('Missing required fields: amount, currency, recipientPhone');
      }

      // Force EUR in sandbox mode
      const finalCurrency = this.useMockMode ? 'EUR' : currency.toUpperCase();
      console.log('🚀 Processing MOMO Transfer:', { amount, currency: finalCurrency, recipientPhone });

      // Mock mode - skip real API call
      if (this.useMockMode) {
        console.log('🧪 Mock Mode: Simulating successful transfer');
        await new Promise(resolve => setTimeout(resolve, 800));
        
        return {
          success: true,
          transactionId: this.generateReferenceId(),
          amount: amount,
          currency: currency,
          recipient: recipientPhone,
          status: 'COMPLETED',
          timestamp: new Date().toISOString(),
          mode: 'MOCK',
          message: `✅ [MOCK MODE] Successfully transferred ${amount} ${currency} to ${recipientPhone}`
        };
      }

      // Use Supabase directly to record transfer
      this.supabase = getSupabaseClient();
      if (!this.supabase) {
        throw new Error('Supabase client not initialized');
      }

      // Call MTN MOMO API for transfer
      const transactionId = this.generateReferenceId();
      const momoResponse = await this.callMOMOAPI('transfer', {
        amount: amount,
        currency: finalCurrency,
        externalId: transactionId,
        payee: {
          partyIdType: 'MSISDN',
          partyId: recipientPhone
        },
        payerMessage: description || 'Payment from ICAN',
        payeeNote: 'Payment received'
      });

      if (!momoResponse.success) {
        throw new Error(momoResponse.error || 'Failed to process MOMO transfer');
      }

      // Record transfer to Supabase
      this.supabase = getSupabaseClient();
      if (!this.supabase) {
        throw new Error('Supabase client not initialized');
      }

      const { data: { user } } = await this.supabase.auth.getUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      const { error } = await this.supabase
        .from('wallet_transactions')
        .insert([
          {
            user_id: user.id,
            type: 'transfer',
            provider: 'mtn_momo',
            amount: parseFloat(amount),
            currency: finalCurrency,
            reference_id: transactionId,
            transaction_id: momoResponse.transactionId || transactionId,
            phone_number: recipientPhone,
            description: description || 'Payment from ICAN',
            status: 'completed',
            metadata: {
              mode: 'LIVE',
              provider: 'MTN MOMO',
              momoResponse: momoResponse
            }
          }
        ]);

      if (error) {
        console.error('Transfer recording error:', error);
      }

      return {
        success: true,
        transactionId: momoResponse.transactionId || transactionId,
        amount: amount,
        currency: currency,
        recipient: recipientPhone,
        status: 'COMPLETED',
        timestamp: new Date().toISOString(),
        mode: 'LIVE',
        message: `✅ Successfully transferred ${amount} ${currency} to ${recipientPhone}`
      };
    } catch (error) {
      console.error('❌ MOMO Transfer failed:', error);
      return {
        success: false,
        error: error.message,
        status: 'FAILED',
        mode: this.useMockMode ? 'MOCK' : 'LIVE',
        message: 'Failed to process transfer. Please try again.'
      };
    }
  }

  /**
   * 🔍 Check Transaction Status via Supabase
   * @param {string} transactionId - Transaction ID to check
   * @returns {Promise<Object>} Transaction status
   */
  async checkTransactionStatus(transactionId) {
    try {
      // Mock mode
      if (this.useMockMode) {
        return {
          transactionId: transactionId,
          status: 'COMPLETED',
          message: '[MOCK] Transaction completed successfully'
        };
      }

      this.supabase = getSupabaseClient();
      if (!this.supabase) {
        throw new Error('Supabase client not initialized');
      }

      const { data, error } = await this.supabase
        .from('wallet_transactions')
        .select('*')
        .eq('transaction_id', transactionId)
        .single();

      if (error) {
        throw new Error(`Transaction not found: ${error.message}`);
      }

      return {
        transactionId: transactionId,
        status: data.status || 'UNKNOWN',
        amount: data.amount,
        currency: data.currency,
        timestamp: data.created_at,
        message: `Transaction status: ${data.status}`
      };
    } catch (error) {
      console.error('❌ Status check failed:', error);
      return {
        transactionId: transactionId,
        status: 'ERROR',
        message: 'Unable to retrieve transaction status'
      };
    }
  }

  /**
   * 🔗 Get Account Balance via Supabase
   * @param {string} accountId - Account identifier
   * @returns {Promise<Object>} Account balance
   */
  async getAccountBalance(accountId) {
    try {
      // Mock mode
      if (this.useMockMode) {
        return {
          accountId: accountId,
          balance: 50000,
          currency: 'UGX',
          status: 'SUCCESS'
        };
      }

      this.supabase = getSupabaseClient();
      if (!this.supabase) {
        throw new Error('Supabase client not initialized');
      }

      // Get account from user_accounts table
      const { data, error } = await this.supabase
        .from('user_accounts')
        .select('current_balance, currency')
        .eq('account_id', accountId)
        .single();

      if (error) {
        throw new Error(`Account not found: ${error.message}`);
      }

      return {
        accountId: accountId,
        balance: data.current_balance || 0,
        currency: data.currency || 'UGX',
        status: 'SUCCESS'
      };
    } catch (error) {
      console.error('❌ Balance check failed:', error);
      return {
        balance: 0,
        status: 'ERROR',
        message: 'Unable to retrieve account balance'
      };
    }
  }

  /**
   * 💾 Create Payment Link/QR Code via Supabase
   * @param {Object} params - Payment link parameters
   * @returns {Promise<Object>} Payment link details
   */
  async createPaymentLink(params) {
    const { amount, currency, description } = params;

    try {
      // Mock mode
      if (this.useMockMode) {
        return {
          success: true,
          linkId: this.generateReferenceId(),
          paymentUrl: `${window.location.origin}/pay/${this.generateReferenceId()}`,
          expiresIn: 3600,
          message: '[MOCK] Payment link created successfully'
        };
      }

      this.supabase = getSupabaseClient();
      if (!this.supabase) {
        throw new Error('Supabase client not initialized');
      }

      const linkId = this.generateReferenceId();
      const paymentUrl = `${window.location.origin}/pay/${linkId}`;

      // Save payment link to Supabase
      const { data, error } = await this.supabase
        .from('payment_links')
        .insert([
          {
            link_id: linkId,
            amount: parseFloat(amount),
            currency: currency.toUpperCase(),
            description: description || 'ICAN Payment',
            payment_url: paymentUrl,
            status: 'ACTIVE',
            expires_at: new Date(Date.now() + 3600000).toISOString(),
            created_at: new Date().toISOString()
          }
        ])
        .select();

      if (error) {
        throw new Error(`Failed to create payment link: ${error.message}`);
      }

      console.log('✅ Payment link created in Supabase:', data);

      return {
        success: true,
        linkId: linkId,
        paymentUrl: paymentUrl,
        expiresIn: 3600,
        message: 'Payment link created successfully'
      };
    } catch (error) {
      console.error('❌ Payment link creation failed:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to create payment link'
      };
    }
  }

  /**
   * 🧪 Test Supabase Connection
   * @returns {Promise<Object>} Connection test result
   */
  async testConnection() {
    try {
      this.supabase = getSupabaseClient();
      if (!this.supabase) {
        throw new Error('Supabase client not initialized');
      }

      // Test connection by trying to fetch from a table
      const { data, error } = await this.supabase
        .from('wallet_transactions')
        .select('count()', { count: 'exact', head: true })
        .limit(0);

      if (error) {
        throw error;
      }

      return {
        status: 'SUCCESS',
        connected: true,
        message: 'Supabase MOMO service connection is healthy',
        mode: 'LIVE'
      };
    } catch (error) {
      console.error('❌ Supabase connection test failed:', error);
      return {
        status: 'FAILED',
        connected: false,
        message: 'Unable to connect to Supabase MOMO service',
        error: error.message
      };
    }
  }

  /**
   * 🔗 Call MTN MOMO API via Supabase Edge Function
   * Handles: Collections, Disbursements, Remittances (cross-border), Status checks
   * This avoids CORS issues by calling from server-side
   * @param {string} endpoint - API endpoint (request-payment, transfer, collections, remittance, status)
   * @param {Object} data - Request payload
   * @returns {Promise<Object>} API response
   */
  async callMOMOAPI(endpoint, data) {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
      
      // Map endpoint to Supabase Edge Function
      let functionName = 'momo-request-payment'
      
      if (endpoint === 'request-payment' || endpoint === 'requestpayment') {
        functionName = 'momo-request-payment'
      } else if (endpoint === 'transfer' || endpoint === 'disbursement') {
        functionName = 'momo-transfer'
      } else if (endpoint === 'collections' || endpoint === 'requesttopay') {
        functionName = 'momo-collections'
      } else if (endpoint === 'remittance' || endpoint === 'cross-border') {
        functionName = 'momo-remittance'
      } else if (endpoint === 'status' || endpoint === 'transaction-status') {
        functionName = 'momo-transaction-status'
      }
      
      const url = `${supabaseUrl}/functions/v1/${functionName}`
      
      console.log(`📡 Calling Supabase Edge Function: ${functionName}`, data);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`
        },
        body: JSON.stringify(data)
      })

      const responseData = await response.json()

      if (!response.ok) {
        throw new Error(responseData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      console.log(`✅ ${functionName} Response:`, responseData);
      
      return {
        success: true,
        transactionId: responseData.transactionId || data.externalId,
        ...responseData
      };
    } catch (error) {
      console.error('❌ Supabase Edge Function Error:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to process MOMO transaction'
      };
    }
  }

  /**
   * ✅ Get MTN MOMO Transaction Status
   * @param {string} transactionId - Transaction ID
   * @returns {Promise<Object>} Transaction status
   */
  async getMOMOTransactionStatus(transactionId) {
    try {
      const url = `${this.momoApiUrl}/v1_0/requeststatus/${transactionId}`;
      
      console.log(`📡 Checking MOMO Transaction Status: ${transactionId}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Ocp-Apim-Subscription-Key': this.momoApiKey
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const responseData = await response.json();
      
      console.log('✅ Transaction Status:', responseData);
      
      return responseData;
    } catch (error) {
      console.error('❌ Error checking transaction status:', error);
      return {
        status: 'UNKNOWN',
        error: error.message
      };
    }
  }

  /**
   * 🌍 Process Cross-Border Remittance via MTN MOMO Remittances
   * Send money to diaspora recipients in other countries
   * @param {Object} params - Remittance parameters
   * @param {string} params.amount - Amount to send
   * @param {string} params.currency - Currency code (UGX, KES, USD, etc.)
   * @param {Object} params.recipient - Recipient details { firstName, lastName, phone }
   * @param {string} params.recipientCountry - Recipient country code (UG, KE, TZ, etc.)
   * @param {string} params.senderName - Sender name
   * @param {string} params.description - Remittance description
   * @returns {Promise<Object>} Remittance result
   */
  async processRemittance(params) {
    const { amount, currency, recipient, recipientCountry, senderName, description } = params;

    try {
      // Validate inputs
      if (!amount || !currency || !recipient || !recipientCountry) {
        throw new Error('Missing required fields: amount, currency, recipient, recipientCountry');
      }

      const mode = this.useMockMode ? 'MOCK' : 'LIVE';
      const finalCurrency = this.useMockMode ? 'EUR' : currency.toUpperCase();
      
      console.log(`🌍 Processing Cross-Border Remittance (${mode} Mode):`, { 
        amount, 
        currency: finalCurrency, 
        recipientCountry,
        recipient
      });

      // Mock mode
      if (this.useMockMode) {
        console.log('🧪 Mock Mode: Simulating successful remittance');
        await new Promise(resolve => setTimeout(resolve, 800));
        
        return {
          success: true,
          transactionId: this.generateReferenceId(),
          amount: amount,
          currency: currency,
          recipientCountry: recipientCountry,
          recipient: recipient.firstName || recipient.name,
          status: 'COMPLETED',
          timestamp: new Date().toISOString(),
          mode: 'MOCK',
          remittanceType: 'cross-border',
          message: `✅ [MOCK MODE] Successfully sent ${amount} ${currency} to ${recipientCountry}`
        };
      }

      // Call MTN MOMO Remittances API via Edge Function
      const transactionId = this.generateReferenceId();
      const momoResponse = await this.callMOMOAPI('remittance', {
        amount: amount,
        currency: finalCurrency,
        externalId: transactionId,
        recipient: {
          firstName: recipient.firstName || recipient.name || 'Recipient',
          lastName: recipient.lastName || '',
          phone: recipient.phone || recipient.phoneNumber
        },
        recipientCountry: recipientCountry.toUpperCase(),
        senderName: senderName,
        description: description || `Remittance to ${recipientCountry}`
      });

      if (!momoResponse.success) {
        throw new Error(momoResponse.error || 'Failed to process remittance');
      }

      // Record remittance to Supabase
      this.supabase = getSupabaseClient();
      if (!this.supabase) {
        throw new Error('Supabase client not initialized');
      }

      const { data: { user } } = await this.supabase.auth.getUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      const { error } = await this.supabase
        .from('wallet_transactions')
        .insert([
          {
            user_id: user.id,
            type: 'remittance',
            provider: 'mtn_momo',
            amount: parseFloat(amount),
            currency: finalCurrency,
            reference_id: transactionId,
            transaction_id: momoResponse.transactionId || transactionId,
            phone_number: recipient.phone || recipient.phoneNumber,
            description: description || `Cross-border remittance to ${recipientCountry}`,
            status: 'completed',
            metadata: {
              mode: 'LIVE',
              provider: 'MTN MOMO Remittances',
              recipientCountry: recipientCountry,
              recipientName: recipient.firstName,
              remittanceType: 'cross-border',
              momoResponse: momoResponse
            }
          }
        ]);

      if (error) {
        console.error('Remittance recording error:', error);
      }

      return {
        success: true,
        transactionId: momoResponse.transactionId || transactionId,
        amount: amount,
        currency: finalCurrency,
        recipientCountry: recipientCountry,
        recipient: recipient.firstName,
        status: 'COMPLETED',
        timestamp: new Date().toISOString(),
        mode: 'LIVE',
        remittanceType: 'cross-border',
        message: `✅ Successfully sent ${amount} ${finalCurrency} to ${recipient.firstName} in ${recipientCountry}`
      };
    } catch (error) {
      console.error('❌ Remittance failed:', error);
      return {
        success: false,
        error: error.message,
        status: 'FAILED',
        mode: this.useMockMode ? 'MOCK' : 'LIVE',
        message: error.message.includes('Network')
          ? '⚠️ Network error. Check your internet connection and try again.'
          : error.message
      };
    }
  }
}

// Export singleton instance
export default new MOmoService();
