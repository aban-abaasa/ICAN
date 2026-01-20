/**
 * 📱 Mobile Money (MOMO) API Service
 * Handles all mobile money transactions for wallet top-ups and transfers
 * ✅ Routes ALL API calls through backend proxy for security & CORS compliance
 */

class MOmoService {
  constructor() {
    // Backend proxy URL (not direct MOMO API)
    this.backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000/api';
    this.useMockMode = import.meta.env.VITE_MOMO_USE_MOCK === 'true';
    this.timeout = import.meta.env.VITE_MOMO_TIMEOUT || 30000;
    
    // Log initialization
    if (this.useMockMode) {
      console.log('🧪 MOMO Service initialized in MOCK MODE (Development)');
      console.log('   Transactions will be simulated without calling real API');
    } else {
      console.log(`🚀 MOMO Service initialized (Production) - Using backend proxy: ${this.backendUrl}`);
      console.log('   ✅ All MOMO API calls routed through backend for security');
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
      console.log(`🚀 Processing MOMO Top-Up (${mode} Mode):`, { 
        amount, 
        currency, 
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

      // Call backend proxy endpoint
      const response = await this.callBackendAPI('/momo/request-payment', {
        amount,
        currency,
        phoneNumber,
        description: description || 'ICAN Wallet Top-Up'
      });

      if (!response.success) {
        throw new Error(response.error || 'Transaction failed');
      }

      return {
        success: true,
        transactionId: response.transactionId,
        amount: amount,
        currency: currency,
        status: response.status || 'COMPLETED',
        timestamp: new Date().toISOString(),
        mode: 'LIVE',
        message: `✅ Successfully added ${amount} ${currency} to your ICAN Wallet via MOMO`
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
   * 📤 Process Money Transfer via MOMO (Backend Proxy)
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

      console.log('🚀 Processing MOMO Transfer:', { amount, currency, recipientPhone });

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

      // Call backend proxy endpoint
      const response = await this.callBackendAPI('/momo/send-payment', {
        amount,
        currency,
        recipientPhone,
        description: description || 'Payment from ICAN'
      });

      if (!response.success) {
        throw new Error(response.error || 'Transfer failed');
      }

      return {
        success: true,
        transactionId: response.transactionId,
        amount: amount,
        currency: currency,
        recipient: recipientPhone,
        status: response.status || 'COMPLETED',
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
   * 🔍 Check Transaction Status via Backend
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

      const response = await this.callBackendAPI('/momo/check-status', { 
        transactionId 
      });

      return {
        transactionId: transactionId,
        status: response.status || 'UNKNOWN',
        amount: response.amount,
        currency: response.currency,
        timestamp: response.timestamp,
        message: `Transaction status: ${response.status}`
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
   * 🔗 Get Account Balance via Backend
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

      const response = await this.callBackendAPI('/momo/get-balance', { 
        accountId 
      });

      return {
        accountId: accountId,
        balance: response.balance || 0,
        currency: response.currency || 'UGX',
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
   * 💾 Create Payment Link/QR Code via Backend
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

      const response = await this.callBackendAPI('/momo/create-payment-link', {
        amount: amount.toString(),
        currency,
        description: description || 'ICAN Payment'
      });

      return {
        success: true,
        linkId: response.linkId,
        paymentUrl: response.paymentUrl,
        qrCode: response.qrCode,
        expiresIn: response.expiresIn || 3600,
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
   * 🔗 Call Backend API via Proxy
   * All MOMO API calls route through this backend endpoint for security and CORS compliance
   * @param {string} endpoint - The backend endpoint (e.g., '/momo/request-payment')
   * @param {Object} data - Request payload
   * @returns {Promise<Object>} API response
   */
  async callBackendAPI(endpoint, data) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const url = `${this.backendUrl}${endpoint}`;
      
      console.log(`📡 Backend API Request: ${url}`);
      console.log('   Payload:', data);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let error = `HTTP ${response.status}: ${response.statusText}`;
        let errorData = null;
        try {
          errorData = await response.json();
          error = errorData.message || error;
          // Log the full error details
          console.error('📋 Full Error Response:', errorData);
        } catch (e) {
          // Couldn't parse error response
        }
        throw new Error(error);
      }

      const responseData = await response.json();
      console.log('✅ Backend API Response:', responseData);
      return responseData;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout - please check your connection');
      }
      console.error('❌ Backend API Error:', error);
      throw error;
    }
  }

  /**
   * 🧪 Test Backend Connection
   * @returns {Promise<Object>} Connection test result
   */
  async testConnection() {
    try {
      const response = await this.callBackendAPI('/momo/health', {});
      return {
        status: 'SUCCESS',
        connected: true,
        message: 'Backend MOMO API connection is healthy',
        apiVersion: response.version
      };
    } catch (error) {
      console.error('❌ Backend connection test failed:', error);
      return {
        status: 'FAILED',
        connected: false,
        message: 'Unable to connect to backend MOMO API',
        error: error.message
      };
    }
  }
}

// Export singleton instance
export default new MOmoService();
