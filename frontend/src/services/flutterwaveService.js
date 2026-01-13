/**
 * 💳 Flutterwave Payment Service
 * Handles Credit Card, Debit Card, and Visa payments
 * 
 * Workflow:
 * 1. Frontend: Initiate payment modal
 * 2. Backend: Verify transaction with Flutterwave API
 * 3. Database: Store payment record in Supabase
 * 4. Webhook: Async confirmation from Flutterwave
 */

class FlutterwaveService {
  constructor() {
    this.publicKey = import.meta.env.VITE_FLUTTERWAVE_PUBLIC_KEY;
    this.apiUrl = 'https://api.flutterwave.com/v3';
    this.backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
    this.useMockMode = import.meta.env.VITE_FLUTTERWAVE_USE_MOCK === 'true';

    if (!this.publicKey && !this.useMockMode) {
      console.warn('⚠️ Flutterwave Public Key not configured. Set VITE_FLUTTERWAVE_PUBLIC_KEY or enable mock mode.');
    }

    const mode = this.useMockMode ? '🧪 MOCK' : '🟢 LIVE';
    console.log(`✅ Flutterwave Service Initialized (${mode})`);
  }

  /**
   * Generate unique reference ID for payment
   */
  generateReference() {
    return `FLW-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  }

  /**
   * Initialize payment modal (requires Flutterwave SDK in index.html)
   * @param {Object} config - Payment configuration
   * @returns {Function} - Handler function
   */
  initiatePayment(config) {
    return new Promise((resolve, reject) => {
      if (!window.FlutterwaveCheckout) {
        console.error('❌ Flutterwave SDK not loaded');
        reject(new Error('Flutterwave SDK not loaded. Add script to index.html'));
        return;
      }

      const reference = this.generateReference();
      const amount = parseFloat(config.amount);
      const currency = config.currency || 'UGX';
      const customerEmail = config.customerEmail || 'customer@ican.io';
      const customerName = config.customerName || 'ICAN Customer';
      const customerPhone = config.customerPhone || '';

      const paymentConfig = {
        public_key: this.publicKey,
        tx_ref: reference,
        amount: amount,
        currency: currency,
        payment_options: 'card,ussd,bank_transfer,barter,bank_account,credit,debit',
        customer: {
          email: customerEmail,
          phone_number: customerPhone,
          name: customerName
        },
        customizations: {
          title: 'ICAN Wallet',
          description: config.description || 'Payment for ICAN services',
          logo: 'https://ican.io/logo.png'
        }
      };

      console.log('💳 Initiating Flutterwave Payment:', {
        reference,
        amount,
        currency,
        customer: paymentConfig.customer
      });

      // Handle payment response
      const handleResponse = async (response) => {
        console.log('📤 Flutterwave Response:', response);

        if (response.status === 'successful') {
          console.log('✅ Payment successful! Verifying with backend...');
          
          try {
            // Redirect to backend verification
            const verifyUrl = `${this.backendUrl}/api/payments/verify?transaction_id=${response.transaction_id}&reference=${reference}`;
            window.location.href = verifyUrl;
          } catch (error) {
            console.error('❌ Verification failed:', error);
            reject(error);
          }
        } else if (response.status === 'cancelled') {
          console.log('⚠️ Payment cancelled by user');
          resolve({
            success: false,
            status: 'CANCELLED',
            message: 'Payment cancelled',
            reference: reference
          });
        } else {
          console.error('❌ Payment failed:', response);
          resolve({
            success: false,
            status: 'FAILED',
            message: response.message || 'Payment failed',
            reference: reference
          });
        }
      };

      // For mock mode
      if (this.useMockMode) {
        console.log('🧪 Mock Mode: Simulating Flutterwave payment');
        setTimeout(() => {
          handleResponse({
            status: 'successful',
            transaction_id: `MOCK-${Date.now()}`,
            txRef: reference
          });
        }, 2000);
        return;
      }

      // Initiate actual Flutterwave payment
      window.FlutterwaveCheckout(paymentConfig);
    });
  }

  /**
   * Process card payment (full flow)
   * @param {Object} params - Payment parameters
   * @param {number} params.amount - Amount to charge
   * @param {string} params.currency - Currency code
   * @param {string} params.customerEmail - Customer email
   * @param {string} params.customerName - Customer name
   * @param {string} params.customerPhone - Customer phone
   * @param {string} params.description - Payment description
   * @param {string} params.orderId - Order/Transaction ID in your system
   * @returns {Promise<Object>} - Payment result
   */
  async processCardPayment(params) {
    const {
      amount,
      currency = 'UGX',
      customerEmail,
      customerName,
      customerPhone,
      description,
      orderId
    } = params;

    try {
      const mode = this.useMockMode ? 'MOCK' : 'LIVE';
      console.log(`💳 Processing Card Payment (${mode} Mode):`, {
        amount,
        currency,
        customer: customerName,
        email: customerEmail
      });

      // Mock mode
      if (this.useMockMode) {
        console.log('🧪 Mock Mode: Simulating card payment');
        await new Promise(resolve => setTimeout(resolve, 1000));

        return {
          success: true,
          transactionId: `MOCK-CARD-${Date.now()}`,
          reference: this.generateReference(),
          amount: amount,
          currency: currency,
          status: 'COMPLETED',
          paymentMethod: 'card',
          timestamp: new Date().toISOString(),
          mode: 'MOCK',
          message: `✅ [MOCK MODE] Card payment of ${amount} ${currency} successful`
        };
      }

      // Initiate payment
      return await this.initiatePayment({
        amount,
        currency,
        customerEmail,
        customerName,
        customerPhone,
        description: description || `Payment for order ${orderId || 'N/A'}`,
        orderId
      });
    } catch (error) {
      console.error('❌ Card payment failed:', error);
      return {
        success: false,
        error: error.message,
        status: 'FAILED',
        message: 'Failed to process card payment. Please try again.'
      };
    }
  }

  /**
   * Verify payment on backend
   * (Called from backend after Flutterwave confirmation)
   * @param {string} transactionId - Flutterwave transaction ID
   * @returns {Promise<Object>} - Verification result
   */
  async verifyPayment(transactionId) {
    try {
      console.log('🔍 Verifying payment with backend:', transactionId);

      const response = await fetch(
        `${this.backendUrl}/api/payments/verify?transaction_id=${transactionId}`
      );

      if (!response.ok) {
        throw new Error(`Verification failed: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('✅ Payment verified:', data);
      return data;
    } catch (error) {
      console.error('❌ Verification error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get payment status
   * @param {string} reference - Flutterwave transaction reference
   * @returns {Promise<Object>} - Payment status
   */
  async getPaymentStatus(reference) {
    try {
      if (this.useMockMode) {
        return {
          reference: reference,
          status: 'successful',
          mode: 'MOCK'
        };
      }

      // In production, call your backend to check payment status
      const response = await fetch(
        `${this.backendUrl}/api/payments/status/${reference}`
      );

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('❌ Failed to get payment status:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Initialize Flutterwave SDK
   * Add to your index.html: <script src="https://checkout.flutterwave.com/v3.js"></script>
   */
  static async initializeSDK() {
    return new Promise((resolve) => {
      if (window.FlutterwaveCheckout) {
        console.log('✅ Flutterwave SDK already loaded');
        resolve(true);
      } else {
        console.log('📥 Loading Flutterwave SDK...');
        const script = document.createElement('script');
        script.src = 'https://checkout.flutterwave.com/v3.js';
        script.async = true;
        script.onload = () => {
          console.log('✅ Flutterwave SDK loaded successfully');
          resolve(true);
        };
        script.onerror = () => {
          console.error('❌ Failed to load Flutterwave SDK');
          resolve(false);
        };
        document.head.appendChild(script);
      }
    });
  }
}

// Export as singleton
export const flutterwaveService = new FlutterwaveService();
export default flutterwaveService;
