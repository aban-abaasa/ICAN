/**
 * 📱 Mobile Money (MOMO) API Service
 * Handles all mobile money transactions for wallet top-ups and transfers
 */

class MOmoService {
  constructor() {
    this.apiKey = import.meta.env.VITE_MOMO_API_KEY || '967f8537fec84cc6829b0ee5650dc355';
    this.primaryKey = import.meta.env.VITE_MOMO_PRIMARY_KEY || '967f8537fec84cc6829b0ee5650dc355';
    this.secondaryKey = import.meta.env.VITE_MOMO_SECONDARY_KEY || '51384ad5e0f6477385b26a15ca156737';
    this.currentKey = this.primaryKey; // Active key tracker
    this.apiUrl = import.meta.env.VITE_MOMO_API_URL || 'https://api.momo.provider.com';
    this.useMockMode = import.meta.env.VITE_MOMO_USE_MOCK === 'true';
    this.timeout = import.meta.env.VITE_MOMO_TIMEOUT || 30000;
    this.keyRotationAttempts = 0;
    this.maxKeyRotations = 2;
    
    // Log initialization
    if (this.useMockMode) {
      console.log('🧪 MOMO Service initialized in MOCK MODE (Development)');
      console.log('   Transactions will be simulated without calling real API');
    } else {
      console.log(`🚀 MOMO Service initialized (Production) - API: ${this.apiUrl}`);
    }
    
    this.updateBaseHeaders();
  }

  /**
   * Update authorization headers with current key
   */
  updateBaseHeaders() {
    this.baseHeaders = {
      'X-Reference-Id': this.generateReferenceId(),
      'X-Target-Environment': 'production',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.currentKey}`
    };
  }

  /**
   * Rotate to secondary key for failover
   */
  rotateToSecondaryKey() {
    if (this.currentKey !== this.secondaryKey && this.keyRotationAttempts < this.maxKeyRotations) {
      console.log('🔄 Rotating to Secondary MOMO Key: 51384ad5e0f6477385b26a15ca156737');
      this.currentKey = this.secondaryKey;
      this.updateBaseHeaders();
      this.keyRotationAttempts++;
      return true;
    }
    return false;
  }

  /**
   * Reset to primary key
   */
  resetToPrimaryKey() {
    if (this.currentKey !== this.primaryKey) {
      console.log('↩️ Resetting to Primary MOMO Key: 967f8537fec84cc6829b0ee5650dc355');
      this.currentKey = this.primaryKey;
      this.keyRotationAttempts = 0;
      this.updateBaseHeaders();
    }
  }

  /**
   * Get current active key (for logging/debugging)
   */
  getCurrentKey() {
    return this.currentKey === this.primaryKey ? 'PRIMARY' : 'SECONDARY';
  }

  /**
   * Generate unique reference ID for each transaction
   */
  generateReferenceId() {
    return `ICAN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 💰 Process Top-Up Transaction
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
      console.log(`🚀 Processing MOMO Top-Up with ${this.getCurrentKey()} Key (${mode} Mode):`, { 
        amount, 
        currency, 
        phoneNumber: this.formatPhoneNumber(phoneNumber) 
      });

      // Mock mode - skip real API call
      if (this.useMockMode) {
        console.log('🧪 Mock Mode: Simulating successful transaction');
        await new Promise(resolve => setTimeout(resolve, 800));
        
        this.resetToPrimaryKey();
        return {
          success: true,
          transactionId: this.generateReferenceId(),
          amount: amount,
          currency: currency,
          status: 'COMPLETED',
          timestamp: new Date().toISOString(),
          activeKey: 'PRIMARY (Mock)',
          mode: 'MOCK',
          message: `✅ [MOCK MODE] Successfully added ${amount} ${currency} to your ICAN Wallet`
        };
      }

      const payload = {
        amount: amount.toString(),
        currency: currency,
        externalId: this.generateReferenceId(),
        payer: {
          partyIdType: 'MSISDN',
          partyId: this.formatPhoneNumber(phoneNumber)
        },
        payerMessage: description || 'ICAN Wallet Top-Up',
        payeeNote: 'Top-up successful',
        apiKey: this.currentKey
      };

      try {
        const response = await this.makeRequest('/transfer', 'POST', payload);
        
        this.resetToPrimaryKey(); // Reset for next transaction
        
        return {
          success: true,
          transactionId: response.transactionId || this.generateReferenceId(),
          amount: amount,
          currency: currency,
          status: 'COMPLETED',
          timestamp: new Date().toISOString(),
          activeKey: this.getCurrentKey(),
          mode: 'LIVE',
          message: `Successfully added ${amount} ${currency} to your ICAN Wallet via MOMO (${this.getCurrentKey()})`
        };
      } catch (error) {
        // Attempt failover to secondary key
        if (this.rotateToSecondaryKey()) {
          console.log('⚠️ Primary key failed, retrying with Secondary Key...');
          payload.apiKey = this.currentKey;
          
          try {
            const response = await this.makeRequest('/transfer', 'POST', payload);
            this.resetToPrimaryKey();

            return {
              success: true,
              transactionId: response.transactionId || this.generateReferenceId(),
              amount: amount,
              currency: currency,
              status: 'COMPLETED',
              timestamp: new Date().toISOString(),
              activeKey: 'SECONDARY (Failover)',
              mode: 'LIVE',
              message: `Successfully added ${amount} ${currency} to your ICAN Wallet via MOMO (Secondary Key - Failover)`
            };
          } catch (secondaryError) {
            throw new Error(`Both PRIMARY and SECONDARY keys failed. Last error: ${secondaryError.message}`);
          }
        }
        throw error;
      }
    } catch (error) {
      console.error('❌ MOMO Top-Up failed:', error);
      this.resetToPrimaryKey();
      return {
        success: false,
        error: error.message,
        status: 'FAILED',
        activeKey: this.getCurrentKey(),
        mode: this.useMockMode ? 'MOCK' : 'LIVE',
        message: error.message.includes('Both PRIMARY and SECONDARY') 
          ? 'Both payment keys failed. Please check your internet connection or contact support.'
          : error.message.includes('ERR_NAME_NOT_RESOLVED')
          ? '⚠️ Cannot connect to MOMO API. Set VITE_MOMO_USE_MOCK=true in .env to use mock mode for development.'
          : 'Failed to process mobile money top-up. Please try again.'
      };
    }
  }

  /**
   * 📤 Process Money Transfer via MOMO
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
      console.log(`🚀 Processing MOMO Transfer with ${this.getCurrentKey()} Key:`, { amount, currency, recipientPhone });

      // Mock mode - skip real API call
      if (this.useMockMode) {
        console.log('🧪 Mock Mode: Simulating successful transfer');
        await new Promise(resolve => setTimeout(resolve, 800));
        
        this.resetToPrimaryKey();
        return {
          success: true,
          transactionId: this.generateReferenceId(),
          amount: amount,
          currency: currency,
          recipient: recipientPhone,
          status: 'COMPLETED',
          timestamp: new Date().toISOString(),
          activeKey: 'PRIMARY (Mock)',
          mode: 'MOCK',
          message: `✅ [MOCK MODE] Successfully transferred ${amount} ${currency} to ${recipientPhone}`
        };
      }

      const payload = {
        amount: amount.toString(),
        currency: currency,
        externalId: this.generateReferenceId(),
        payee: {
          partyIdType: 'MSISDN',
          partyId: this.formatPhoneNumber(recipientPhone)
        },
        payerMessage: description || 'Payment from ICAN',
        payeeNote: 'Payment received',
        apiKey: this.currentKey
      };

      try {
        const response = await this.makeRequest('/transfer', 'POST', payload);
        this.resetToPrimaryKey();

        return {
          success: true,
          transactionId: response.transactionId || this.generateReferenceId(),
          amount: amount,
          currency: currency,
          recipient: recipientPhone,
          status: 'COMPLETED',
          timestamp: new Date().toISOString(),
          activeKey: this.getCurrentKey(),
          mode: 'LIVE',
          message: `Successfully transferred ${amount} ${currency} to ${recipientPhone}`
        };
      } catch (error) {
        // Attempt failover to secondary key
        if (this.rotateToSecondaryKey()) {
          console.log('⚠️ Primary key failed, retrying Transfer with Secondary Key...');
          payload.apiKey = this.currentKey;
          
          try {
            const response = await this.makeRequest('/transfer', 'POST', payload);
            this.resetToPrimaryKey();

            return {
              success: true,
              transactionId: response.transactionId || this.generateReferenceId(),
              amount: amount,
              currency: currency,
              recipient: recipientPhone,
              status: 'COMPLETED',
              timestamp: new Date().toISOString(),
              activeKey: 'SECONDARY (Failover)',
              mode: 'LIVE',
              message: `Successfully transferred ${amount} ${currency} to ${recipientPhone} (Secondary Key)`
            };
          } catch (secondaryError) {
            throw new Error(`Both PRIMARY and SECONDARY keys failed. Last error: ${secondaryError.message}`);
          }
        }
        throw error;
      }
    } catch (error) {
      console.error('❌ MOMO Transfer failed:', error);
      this.resetToPrimaryKey();
      return {
        success: false,
        error: error.message,
        status: 'FAILED',
        activeKey: this.getCurrentKey(),
        mode: this.useMockMode ? 'MOCK' : 'LIVE',
        message: error.message.includes('Both PRIMARY and SECONDARY')
          ? 'Both payment keys failed. Please check your internet connection or contact support.'
          : error.message.includes('ERR_NAME_NOT_RESOLVED')
          ? '⚠️ Cannot connect to MOMO API. Set VITE_MOMO_USE_MOCK=true in .env to use mock mode for development.'
          : 'Failed to process transfer. Please try again.'
      };
    }
  }

  /**
   * 🔍 Check Transaction Status
   * @param {string} transactionId - Transaction ID to check
   * @returns {Promise<Object>} Transaction status
   */
  async checkTransactionStatus(transactionId) {
    try {
      const response = await this.makeRequest(`/transfer/${transactionId}`, 'GET');
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
   * 🔗 Get Account Balance
   * @param {string} accountId - Account identifier
   * @returns {Promise<Object>} Account balance
   */
  async getAccountBalance(accountId) {
    try {
      const response = await this.makeRequest(`/account/${accountId}/balance`, 'GET');
      return {
        accountId: accountId,
        balance: response.balance,
        currency: response.currency,
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
   * 💾 Create Payment Link/QR Code
   * @param {Object} params - Payment link parameters
   * @returns {Promise<Object>} Payment link details
   */
  async createPaymentLink(params) {
    const { amount, currency, description } = params;

    try {
      const referenceId = this.generateReferenceId();
      const payload = {
        amount: amount.toString(),
        currency: currency,
        externalId: referenceId,
        description: description || 'ICAN Payment',
        callbackUrl: `${window.location.origin}/api/momo/callback`
      };

      const response = await this.makeRequest('/payment-link', 'POST', payload);

      return {
        success: true,
        linkId: referenceId,
        paymentUrl: response.paymentUrl || `https://momo.ican.app/pay/${referenceId}`,
        qrCode: response.qrCode,
        expiresIn: 3600, // 1 hour
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
   * 🔐 Validate Phone Number Format
   * @param {string} phoneNumber - Phone number to validate
   * @returns {string} Formatted phone number
   */
  formatPhoneNumber(phoneNumber) {
    // Remove any non-digit characters
    const cleaned = phoneNumber.replace(/\D/g, '');
    
    // Add country code if missing (assuming Uganda +256 as default)
    if (cleaned.length === 10 && cleaned.startsWith('7')) {
      return `256${cleaned}`;
    }
    if (cleaned.length === 9) {
      return `256${cleaned}`;
    }
    
    return cleaned;
  }

  /**
   * 🌐 Make HTTP Request to MOMO API
   * @param {string} endpoint - API endpoint
   * @param {string} method - HTTP method
   * @param {Object} data - Request payload
   * @returns {Promise<Object>} API response
   */
  async makeRequest(endpoint, method = 'GET', data = null) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const options = {
        method: method,
        headers: this.baseHeaders,
        signal: controller.signal
      };

      if (data) {
        options.body = JSON.stringify(data);
      }

      const response = await fetch(`${this.apiUrl}${endpoint}`, options);
      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout - please check your connection');
      }
      throw error;
    }
  }

  /**
   * 🧪 Test API Connection
   * @returns {Promise<Object>} Connection test result
   */
  async testConnection() {
    try {
      const response = await this.makeRequest('/health', 'GET');
      return {
        status: 'SUCCESS',
        connected: true,
        message: 'MOMO API connection is healthy',
        apiVersion: response.version
      };
    } catch (error) {
      console.error('❌ Connection test failed:', error);
      return {
        status: 'FAILED',
        connected: false,
        message: 'Unable to connect to MOMO API',
        error: error.message
      };
    }
  }
}

// Export singleton instance
export default new MOmoService();
