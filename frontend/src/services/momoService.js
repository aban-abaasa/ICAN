/**
 * 📱 Mobile Money (MOMO) API Service
 * Handles all mobile money transactions for wallet top-ups and transfers
 * ✅ Uses MTN MOMO API + Supabase for secure transaction management
 */

import { getSupabaseClient } from '../lib/supabase/client';

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
   * 💰 Process Top-Up Transaction via Backend Proxy
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
      // Force EUR in sandbox mode
      const finalCurrency = this.useMockMode ? 'EUR' : currency.toUpperCase();
      
      console.log(`🚀 Processing MOMO Top-Up (${mode} Mode):`, { 
        amount, 
        currency: finalCurrency, 
        phoneNumber
      });

      // Mock mode - skip real API call
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

      // Call MTN MOMO API for real transaction
      const transactionId = this.generateReferenceId();
      const momoResponse = await this.callMOMOAPI('request-payment', {
        amount: amount,
        currency: finalCurrency,
        externalId: transactionId,
        payer: {
          partyIdType: 'MSISDN',
          partyId: phoneNumber
        },
        payerMessage: 'ICAN Wallet Top-Up',
        payeeNote: description || 'Wallet top-up'
      });

      if (!momoResponse.success) {
        throw new Error(momoResponse.error || 'Failed to process MOMO request');
      }

      // Record transaction to Supabase
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
            type: 'topup',
            provider: 'mtn_momo',
            amount: parseFloat(amount),
            currency: finalCurrency,
            reference_id: transactionId,
            transaction_id: momoResponse.transactionId || transactionId,
            phone_number: phoneNumber,
            description: description || 'ICAN Wallet Top-Up via MOMO',
            status: 'completed',
            metadata: {
              mode: 'LIVE',
              provider: 'MTN MOMO',
              momoResponse: momoResponse
            }
          }
        ]);

      if (error) {
        console.error('Transaction recording error:', error);
      }

      return {
        success: true,
        transactionId: momoResponse.transactionId || transactionId,
        amount: amount,
        currency: finalCurrency,
        status: 'COMPLETED',
        timestamp: new Date().toISOString(),
        mode: 'LIVE',
        message: `✅ Successfully added ${amount} ${finalCurrency} to your ICAN Wallet via MOMO`
      };
    } catch (error) {
      console.error('❌ MOMO Top-Up failed:', error);
      return {
        success: false,
        error: error.message,
        status: 'FAILED',
        mode: this.useMockMode ? 'MOCK' : 'LIVE',
        message: error.message.includes('Network')
          ? '⚠️ Network error. Check your internet connection and try again.'
          : error.message.includes('401') || error.message.includes('403')
          ? '⚠️ Authentication failed. Check API credentials.'
          : 'Failed to process mobile money top-up. Please try again.'
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
   * 🔗 Call MTN MOMO API Endpoint
   * @param {string} endpoint - API endpoint (request-payment, send-money, etc.)
   * @param {Object} data - Request payload
   * @returns {Promise<Object>} API response
   */
  async callMOMOAPI(endpoint, data) {
    try {
      const url = `${this.momoApiUrl}/v1_0/${endpoint}`;
      
      console.log(`📡 MTN MOMO API Request: ${endpoint}`, data);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Reference-Id': data.externalId || this.generateReferenceId(),
          'Ocp-Apim-Subscription-Key': this.momoApiKey
        },
        body: JSON.stringify(data),
        timeout: this.timeout
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`HTTP ${response.status}: ${errorData.message || response.statusText}`);
      }

      const responseData = await response.json();
      
      console.log('✅ MTN MOMO API Response:', responseData);
      
      return {
        success: true,
        transactionId: responseData.transactionId || data.externalId,
        ...responseData
      };
    } catch (error) {
      console.error('❌ MTN MOMO API Error:', error);
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
        },
        timeout: this.timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const responseData = await response.json();
      
      console.log('✅ Transaction Status:', responseData);
      
      return {
        success: true,
        status: responseData.status,
        ...responseData
      };
    } catch (error) {
      console.error('❌ Status check failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Export singleton instance
export default new MOmoService();
