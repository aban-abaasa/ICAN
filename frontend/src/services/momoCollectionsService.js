/**
 * ðŸ¦ MOMO Collections Service
 * Handles fee collections and charges on mobile services
 * 
 * Collections:
 * Primary Key: YOUR_SUBSCRIPTION_KEY_HERE
 * Secondary Key: YOUR_SECONDARY_KEY_HERE
 * 
 * Disbursements:
 * Primary Key: YOUR_DISBURSEMENT_KEY_HERE
 * Secondary Key: 847aa902f16748a2bd6a84070c8b9f80
 * 
 * Purpose: Collect fees and charges on mobile services
 */

class MOmoCollectionsService {
  constructor() {
    // Collections API Configuration
    this.primaryKey = 'YOUR_SUBSCRIPTION_KEY_HERE';
    this.secondaryKey = 'YOUR_SECONDARY_KEY_HERE';
    this.currentKey = this.primaryKey;
    
    // Disbursements API Configuration
    this.disbursementPrimaryKey = 'YOUR_DISBURSEMENT_KEY_HERE';
    this.disbursementSecondaryKey = '847aa902f16748a2bd6a84070c8b9f80';
    this.disbursementCurrentKey = this.disbursementPrimaryKey;
    
    this.apiUrl = import.meta.env.VITE_MOMO_API_URL || 'https://api.momo.provider.com';
    
    // Mock mode for development
    this.useMockMode = import.meta.env.VITE_MOMO_USE_MOCK === 'true';
    
    const mode = this.useMockMode ? 'ðŸ§ª MOCK' : 'ðŸŸ¢ LIVE';
    console.log(`âœ… MOMO Collections Service Initialized (${mode})`);
    console.log(`   Collections - Primary Key: ${this.primaryKey.substring(0, 8)}...`);
    console.log(`   Collections - Secondary Key: ${this.secondaryKey.substring(0, 8)}...`);
    console.log(`   Disbursements - Primary Key: ${this.disbursementPrimaryKey.substring(0, 8)}...`);
    console.log(`   Disbursements - Secondary Key: ${this.disbursementSecondaryKey.substring(0, 8)}...`);
  }

  /**
   * Get current active key
   */
  getCurrentKey() {
    return this.currentKey === this.primaryKey ? 'PRIMARY' : 'SECONDARY';
  }

  /**
   * Rotate to secondary key (on failure)
   */
  rotateToSecondaryKey() {
    if (this.currentKey === this.primaryKey) {
      this.currentKey = this.secondaryKey;
      console.log('ðŸ”„ Rotating to Secondary Collections Key: ' + this.secondaryKey);
      return true;
    }
    return false;
  }

  /**
   * Reset to primary key
   */
  resetToPrimaryKey() {
    this.currentKey = this.primaryKey;
  }

  /**
   * Generate unique reference ID
   */
  generateReferenceId() {
    return `COL-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  }

  /**
   * Format phone number to international format
   */
  formatPhoneNumber(phone) {
    if (!phone) return '';
    // Remove all non-digits
    const cleaned = phone.replace(/\D/g, '');
    // Add country code if not present (assume +256 for Uganda)
    if (cleaned.length === 10) return `+256${cleaned.substring(1)}`;
    if (!cleaned.startsWith('+')) return `+${cleaned}`;
    return `+${cleaned}`;
  }

  /**
   * Make API request
   */
  async makeRequest(endpoint, method = 'POST', payload = {}) {
    try {
      const url = `${this.apiUrl}${endpoint}`;
      
      console.log(`ðŸ“¡ Collections API Request [${this.getCurrentKey()}]:`);
      console.log(`   URL: ${url}`);
      console.log(`   Method: ${method}`);
      console.log(`   Payload:`, payload);

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.currentKey}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log('âœ… Collections API Response:', data);
      return data;
    } catch (error) {
      console.error(`âŒ Collections API Error [${this.getCurrentKey()}]:`, error.message);
      throw error;
    }
  }

  /**
   * ðŸ’° Collect Fee/Charge
   * @param {Object} params - Collection parameters
   * @param {number} params.amount - Amount to collect
   * @param {string} params.currency - Currency code
   * @param {string} params.phoneNumber - Customer phone number
   * @param {string} params.feeType - Type of fee (subscription, transaction_fee, service_charge, etc)
   * @param {string} params.description - Fee description
   * @returns {Promise<Object>} - Collection result
   */
  async collectFee(params) {
    const { amount, currency, phoneNumber, feeType = 'service_charge', description } = params;

    try {
      const mode = this.useMockMode ? 'MOCK' : 'LIVE';
      console.log(`ðŸ’³ Collecting Fee with ${this.getCurrentKey()} Key (${mode} Mode):`, {
        amount,
        currency,
        phoneNumber: this.formatPhoneNumber(phoneNumber),
        feeType
      });

      // Mock mode - skip real API call
      if (this.useMockMode) {
        console.log('ðŸ§ª Mock Mode: Simulating successful fee collection');
        await new Promise(resolve => setTimeout(resolve, 800));

        this.resetToPrimaryKey();
        return {
          success: true,
          transactionId: this.generateReferenceId(),
          amount: amount,
          currency: currency,
          feeType: feeType,
          status: 'COMPLETED',
          timestamp: new Date().toISOString(),
          activeKey: 'PRIMARY (Mock)',
          mode: 'MOCK',
          message: `âœ… [MOCK MODE] Successfully collected ${amount} ${currency} fee (${feeType})`
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
        feeType: feeType,
        description: description || `${feeType} fee collection`,
        apiKey: this.currentKey
      };

      try {
        const response = await this.makeRequest('/collections/charge', 'POST', payload);

        this.resetToPrimaryKey();

        return {
          success: true,
          transactionId: response.transactionId || this.generateReferenceId(),
          amount: amount,
          currency: currency,
          feeType: feeType,
          status: 'COMPLETED',
          timestamp: new Date().toISOString(),
          activeKey: this.getCurrentKey(),
          mode: 'LIVE',
          message: `Successfully collected ${amount} ${currency} fee (${feeType})`
        };
      } catch (error) {
        // Attempt failover to secondary key
        if (this.rotateToSecondaryKey()) {
          console.log('âš ï¸ Primary key failed, retrying with Secondary Key...');
          payload.apiKey = this.currentKey;

          try {
            const response = await this.makeRequest('/collections/charge', 'POST', payload);
            this.resetToPrimaryKey();

            return {
              success: true,
              transactionId: response.transactionId || this.generateReferenceId(),
              amount: amount,
              currency: currency,
              feeType: feeType,
              status: 'COMPLETED',
              timestamp: new Date().toISOString(),
              activeKey: 'SECONDARY (Failover)',
              mode: 'LIVE',
              message: `Successfully collected fee (Secondary Key - Failover)`
            };
          } catch (secondaryError) {
            throw new Error(`Both PRIMARY and SECONDARY keys failed. Last error: ${secondaryError.message}`);
          }
        }
        throw error;
      }
    } catch (error) {
      console.error('âŒ Fee Collection failed:', error);
      this.resetToPrimaryKey();
      return {
        success: false,
        error: error.message,
        status: 'FAILED',
        activeKey: this.getCurrentKey(),
        mode: this.useMockMode ? 'MOCK' : 'LIVE',
        message: error.message.includes('Both PRIMARY and SECONDARY')
          ? 'Both collection keys failed. Please check your internet connection or contact support.'
          : error.message.includes('ERR_NAME_NOT_RESOLVED')
          ? 'âš ï¸ Cannot connect to Collections API. Set VITE_MOMO_USE_MOCK=true in .env to use mock mode for development.'
          : 'Failed to process fee collection. Please try again.'
      };
    }
  }

  /**
   * ðŸ“Š Get Collection Status
   * @param {string} transactionId - Transaction ID to check
   * @returns {Promise<Object>} - Status information
   */
  async getCollectionStatus(transactionId) {
    try {
      console.log(`ðŸ” Checking collection status for: ${transactionId}`);

      if (this.useMockMode) {
        console.log('ðŸ§ª Mock Mode: Returning simulated status');
        return {
          transactionId: transactionId,
          status: 'COMPLETED',
          mode: 'MOCK'
        };
      }

      const response = await this.makeRequest(`/collections/${transactionId}`, 'GET');
      return response;
    } catch (error) {
      console.error('âŒ Failed to get collection status:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * ðŸ”„ Reverse Collection (Refund)
   * @param {string} originalTransactionId - Original transaction ID to reverse
   * @param {string} reason - Reason for reversal
   * @returns {Promise<Object>} - Reversal result
   */
  async reverseCollection(originalTransactionId, reason = 'Customer request') {
    try {
      const mode = this.useMockMode ? 'MOCK' : 'LIVE';
      console.log(`â®ï¸ Reversing collection with ${this.getCurrentKey()} Key (${mode} Mode):`, {
        originalTransactionId,
        reason
      });

      if (this.useMockMode) {
        console.log('ðŸ§ª Mock Mode: Simulating successful reversal');
        await new Promise(resolve => setTimeout(resolve, 800));

        this.resetToPrimaryKey();
        return {
          success: true,
          reverseTransactionId: this.generateReferenceId(),
          originalTransactionId: originalTransactionId,
          status: 'REVERSED',
          timestamp: new Date().toISOString(),
          mode: 'MOCK',
          message: `âœ… [MOCK MODE] Successfully reversed collection`
        };
      }

      const payload = {
        originalTransactionId: originalTransactionId,
        reason: reason,
        apiKey: this.currentKey
      };

      const response = await this.makeRequest('/collections/reverse', 'POST', payload);
      this.resetToPrimaryKey();

      return {
        success: true,
        reverseTransactionId: response.transactionId || this.generateReferenceId(),
        originalTransactionId: originalTransactionId,
        status: 'REVERSED',
        timestamp: new Date().toISOString(),
        mode: 'LIVE',
        message: 'Collection successfully reversed'
      };
    } catch (error) {
      console.error('âŒ Reversal failed:', error);
      this.resetToPrimaryKey();
      return {
        success: false,
        error: error.message,
        status: 'FAILED',
        message: 'Failed to reverse collection. Please try again.'
      };
    }
  }
}

// Export as singleton
export const momoCollectionsService = new MOmoCollectionsService();
export default momoCollectionsService;
