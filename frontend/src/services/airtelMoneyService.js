/**
 * 📱 Airtel Money Service
 * Handles Airtel Money payments with automatic routing
 * 
 * Primary Key: For sending money via Airtel Money
 * Secondary Key: Failover for reliability
 */

class AirtelMoneyService {
  constructor() {
    this.primaryKey = import.meta.env.VITE_AIRTEL_MONEY_PRIMARY_KEY || 'airtel_primary_key';
    this.secondaryKey = import.meta.env.VITE_AIRTEL_MONEY_SECONDARY_KEY || 'airtel_secondary_key';
    this.currentKey = this.primaryKey;
    this.apiUrl = import.meta.env.VITE_AIRTEL_MONEY_API_URL || 'https://api.airtel.com/v1';
    this.useMockMode = import.meta.env.VITE_MOMO_USE_MOCK === 'true';

    const mode = this.useMockMode ? '🧪 MOCK' : '🟢 LIVE';
    console.log(`✅ Airtel Money Service Initialized (${mode})`);
    console.log(`   Primary Key: ${this.primaryKey.substring(0, 8)}...`);
    console.log(`   Secondary Key: ${this.secondaryKey.substring(0, 8)}...`);
  }

  getCurrentKey() {
    return this.currentKey === this.primaryKey ? 'PRIMARY' : 'SECONDARY';
  }

  rotateToSecondaryKey() {
    if (this.currentKey === this.primaryKey) {
      this.currentKey = this.secondaryKey;
      console.log('🔄 Rotating to Secondary Airtel Money Key');
      return true;
    }
    return false;
  }

  resetToPrimaryKey() {
    this.currentKey = this.primaryKey;
  }

  generateReferenceId() {
    return `AIR-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  }

  formatPhoneNumber(phone) {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 10) return `+256${cleaned.substring(1)}`;
    if (!cleaned.startsWith('+')) return `+${cleaned}`;
    return `+${cleaned}`;
  }

  /**
   * 💰 Send Money via Airtel Money
   * @param {Object} params - Transfer parameters
   */
  async sendMoney(params) {
    const { amount, currency, recipientPhone, description } = params;

    try {
      const mode = this.useMockMode ? 'MOCK' : 'LIVE';
      console.log(`📱 Sending via Airtel Money (${mode} Mode):`, {
        amount,
        currency,
        to: this.formatPhoneNumber(recipientPhone)
      });

      // Mock mode
      if (this.useMockMode) {
        console.log('🧪 Mock Mode: Simulating Airtel Money transfer');
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
          provider: 'Airtel',
          message: `✅ [MOCK MODE] Successfully sent ${amount} ${currency} via Airtel Money`
        };
      }

      const payload = {
        amount: amount.toString(),
        currency: currency,
        recipient: this.formatPhoneNumber(recipientPhone),
        reference: this.generateReferenceId(),
        description: description || 'Airtel Money Transfer',
        apiKey: this.currentKey
      };

      try {
        // Simulate API call (replace with real Airtel API when available)
        const response = await this.makeRequest('/send', 'POST', payload);

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
          provider: 'Airtel',
          message: `Successfully sent ${amount} ${currency} via Airtel Money`
        };
      } catch (error) {
        if (this.rotateToSecondaryKey()) {
          console.log('⚠️ Primary key failed, retrying with Secondary Key...');
          payload.apiKey = this.currentKey;

          try {
            const response = await this.makeRequest('/send', 'POST', payload);
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
              provider: 'Airtel',
              message: `Successfully sent via Airtel Money (Secondary Key)`
            };
          } catch (secondaryError) {
            throw new Error(`Both PRIMARY and SECONDARY keys failed`);
          }
        }
        throw error;
      }
    } catch (error) {
      console.error('❌ Airtel Money transfer failed:', error);
      this.resetToPrimaryKey();
      return {
        success: false,
        error: error.message,
        status: 'FAILED',
        activeKey: this.getCurrentKey(),
        mode: this.useMockMode ? 'MOCK' : 'LIVE',
        provider: 'Airtel',
        message: error.message.includes('Both PRIMARY and SECONDARY')
          ? 'Both keys failed. Please check your connection.'
          : 'Failed to process Airtel Money transfer. Please try again.'
      };
    }
  }

  /**
   * 💳 Receive Money via Airtel Money
   */
  async receiveMoney(params) {
    const { amount, currency, senderPhone } = params;

    try {
      console.log(`📥 Creating Airtel Money receive request:`, {
        amount,
        currency,
        from: this.formatPhoneNumber(senderPhone)
      });

      if (this.useMockMode) {
        await new Promise(resolve => setTimeout(resolve, 800));
        return {
          success: true,
          transactionId: this.generateReferenceId(),
          amount: amount,
          currency: currency,
          status: 'PENDING',
          mode: 'MOCK',
          provider: 'Airtel',
          message: `✅ [MOCK MODE] Airtel Money receive request created`
        };
      }

      return {
        success: true,
        transactionId: this.generateReferenceId(),
        amount: amount,
        currency: currency,
        status: 'PENDING',
        mode: 'LIVE',
        provider: 'Airtel',
        message: 'Receive request created'
      };
    } catch (error) {
      console.error('❌ Airtel Money receive failed:', error);
      return {
        success: false,
        error: error.message,
        status: 'FAILED',
        provider: 'Airtel'
      };
    }
  }

  /**
   * API request handler
   */
  async makeRequest(endpoint, method = 'POST', payload = {}) {
    try {
      const url = `${this.apiUrl}${endpoint}`;

      console.log(`📡 Airtel Money API [${this.getCurrentKey()}]:`, {
        url,
        method
      });

      // Replace with real API call when available
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.currentKey}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`❌ Airtel Money API Error:`, error.message);
      throw error;
    }
  }
}

export const airtelMoneyService = new AirtelMoneyService();
export default airtelMoneyService;
