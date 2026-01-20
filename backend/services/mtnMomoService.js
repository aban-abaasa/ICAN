/**
 * 📱 MTN MOMO API Service
 * Handles Mobile Money transactions for MTN networks
 * Supports: Collections (Receive Money), Disbursements (Send Money)
 * 
 * API Documentation: https://momodeveloper.mtn.com
 */

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

const config = {
  // Authentication credentials (fallback to env vars if needed)
  // Primary Key (Subscription Key): 967f8537fec84cc6829b0ee5650dc355
  // Secondary Key (API Secret Key): 51384ad5e0f6477385b26a15ca156737
  subscriptionKey: process.env.MOMO_SUBSCRIPTION_KEY || '967f8537fec84cc6829b0ee5650dc355',
  apiUser: process.env.MOMO_API_USER || 'ICAN_PRIMARY_USER',
  apiKey: process.env.MOMO_API_KEY || '51384ad5e0f6477385b26a15ca156737',
  
  // Base URL (sandbox for testing, production for live)
  baseUrl: process.env.MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com',
  environment: process.env.MOMO_ENVIRONMENT || 'sandbox',
  
  // Timeouts
  tokenTimeout: parseInt(process.env.MOMO_TOKEN_TIMEOUT) || 3600, // 1 hour
  requestTimeout: parseInt(process.env.MOMO_REQUEST_TIMEOUT) || 30000 // 30 seconds
};

class MTNMomoService {
  constructor() {
    this.config = config;
    this.supabaseConfig = null;
    this.accessToken = null;
    this.tokenExpiry = null;
    this.tokenCache = {
      collection: null,
      disbursement: null,
      expiresAt: {
        collection: null,
        disbursement: null
      }
    };
    
    console.log('🚀 MTN MOMO Service initialized');
    console.log(`   Environment: ${this.config.environment}`);
    console.log(`   Base URL: ${this.config.baseUrl}`);
    this.initializeFromSupabase();
  }

  /**
   * Load configuration from Supabase
   */
  async initializeFromSupabase() {
    try {
      const { data, error } = await supabase
        .from('mtn_momo_config')
        .select('*')
        .eq('is_active', true)
        .eq('environment', this.config.environment)
        .eq('is_primary', true)
        .single();

      if (error) {
        console.warn('⚠️  Could not load config from Supabase:', error.message);
        return;
      }

      if (data) {
        this.supabaseConfig = data;
        this.config.subscriptionKey = data.subscription_key;
        this.config.apiUser = data.api_user_id;
        this.config.apiKey = data.api_secret_key;
        this.config.baseUrl = data.base_url;
        console.log('✅ Loaded MOMO config from Supabase');
      }
    } catch (error) {
      console.error('❌ Error loading Supabase config:', error);
    }
  }

  /**
   * Validate required configuration
   */
  validateConfig() {
    const required = ['subscriptionKey', 'apiUser', 'apiKey'];
    const missing = required.filter(key => !this.config[key]);
    
    if (missing.length > 0) {
      console.warn(`⚠️  Missing MTN MOMO configuration: ${missing.join(', ')}`);
      console.warn('   Using fallback credentials');
      console.warn('   To set custom credentials, update mtn_momo_config table in Supabase');
    } else {
      console.log('✅ MOMO Configuration validated');
    }
  }

  /**
   * Log transaction to Supabase for audit trail
   */
  async logTransaction(transactionData) {
    try {
      const { data, error } = await supabase
        .from('mtn_momo_logs')
        .insert({
          product_type: transactionData.productType,
          transaction_id: transactionData.transactionId,
          reference_id: transactionData.referenceId,
          amount: transactionData.amount,
          currency: transactionData.currency,
          phone_number: transactionData.phoneNumber,
          status: transactionData.status,
          request_payload: transactionData.requestPayload,
          response_payload: transactionData.responsePayload,
          error_message: transactionData.errorMessage,
          timestamp: new Date().toISOString()
        });

      if (!error) {
        console.log(`📝 Transaction logged to Supabase`);
      } else {
        console.warn(`⚠️  Failed to log transaction: ${error.message}`);
      }
    } catch (logError) {
      console.warn(`⚠️  Error logging to Supabase: ${logError.message}`);
    }
  }

  /**
   * Get Access Token (with Supabase caching)
   * Different tokens needed for Collection vs Disbursement
   * 
   * @param {string} productType - 'collection' or 'disbursement'
   * @returns {Promise<string>} Access token
   */
  async getAccessToken(productType = 'collection') {
    try {
      const now = new Date();

      // Check memory cache first
      if (this.tokenCache[productType] && this.tokenCache.expiresAt[productType]) {
        if (now < this.tokenCache.expiresAt[productType]) {
          console.log(`♻️  Using cached ${productType} token (memory)`);
          return this.tokenCache[productType];
        }
      }

      // Check Supabase cache
      try {
        const { data: cachedToken } = await supabase
          .from('mtn_momo_tokens')
          .select('*')
          .eq('product_type', productType)
          .eq('is_active', true)
          .gt('expires_at', now.toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (cachedToken && cachedToken.access_token) {
          // Restore to memory cache
          this.tokenCache[productType] = cachedToken.access_token;
          this.tokenCache.expiresAt[productType] = new Date(cachedToken.expires_at);
          console.log(`♻️  Using cached ${productType} token (Supabase)`);
          return cachedToken.access_token;
        }
      } catch (error) {
        // No valid cached token found, will request new one
        console.log(`   No valid cached token, requesting new one...`);
      }

      console.log(`🔐 Fetching new ${productType} access token from MTN...`);

      // Create Basic Auth header
      const credentials = `${this.config.apiUser}:${this.config.apiKey}`;
      const auth = Buffer.from(credentials).toString('base64');

      // Request token from MTN
      const response = await axios.post(
        `${this.config.baseUrl}/${productType}/token/`,
        {},
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Ocp-Apim-Subscription-Key': this.config.subscriptionKey,
            'Content-Type': 'application/json'
          },
          timeout: this.config.requestTimeout
        }
      );

      const token = response.data.access_token;
      const expiresIn = response.data.expires_in || this.config.tokenTimeout;
      const expiresAt = new Date(Date.now() + (expiresIn * 1000));
      
      // Cache in memory
      this.tokenCache[productType] = token;
      this.tokenCache.expiresAt[productType] = expiresAt;

      // Save to Supabase
      try {
        await supabase.from('mtn_momo_tokens').insert({
          product_type: productType,
          access_token: token,
          expires_at: expiresAt.toISOString(),
          is_active: true,
          token_type: 'Bearer'
        });
        console.log(`✅ Token saved to Supabase cache`);
      } catch (dbError) {
        console.warn(`⚠️  Could not save token to Supabase: ${dbError.message}`);
      }

      console.log(`✅ Got new ${productType} token (expires in ${expiresIn}s)`);
      return token;

    } catch (error) {
      console.error(`❌ ${productType} Auth Error:`, {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      });
      throw new Error(`Failed to get ${productType} access token: ${error.message}`);
    }
  }

  /**
   * RECEIVE MONEY - Collections API
   * Request money FROM a customer (charge them)
   * 
   * @param {Object} params
   * @param {number} params.amount - Amount to request
   * @param {string} params.phoneNumber - Customer phone (format: 256xxxxxxxxx)
   * @param {string} params.currency - Currency code (default: UGX)
   * @param {string} params.externalId - Your transaction reference
   * @param {string} params.description - Payment description
   * @returns {Promise<Object>} Transaction result
   */
  async receiveMoney({
    amount,
    phoneNumber,
    currency = 'UGX',
    externalId = null,
    description = 'Payment from ICAN Platform'
  }) {
    let transactionId = null;
    let referenceId = null;
    let requestPayload = null;

    try {
      console.log(`\n💰 RECEIVE MONEY (Collections):`);
      console.log(`   Amount: ${amount} ${currency}`);
      console.log(`   Phone: ${phoneNumber}`);
      console.log(`   Description: ${description}`);

      // Validate inputs
      if (!amount || amount <= 0) {
        throw new Error('Invalid amount');
      }
      if (!phoneNumber) {
        throw new Error('Phone number is required');
      }

      // Generate transaction reference
      transactionId = uuidv4();
      referenceId = externalId || `REC-${Date.now()}`;

      // Get access token
      const token = await this.getAccessToken('collection');

      // Prepare payload
      requestPayload = {
        amount: String(amount),
        currency: currency,
        externalId: referenceId,
        payer: {
          partyIdType: 'MSISDN',
          partyId: phoneNumber
        },
        payerMessage: description,
        payeeNote: 'Payment to ICAN'
      };

      console.log(`📤 Sending collection request (ID: ${transactionId})...`);

      // Make API request
      const response = await axios.post(
        `${this.config.baseUrl}/collection/v1_0/requesttopay`,
        requestPayload,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Reference-Id': transactionId,
            'X-Target-Environment': this.config.environment,
            'Ocp-Apim-Subscription-Key': this.config.subscriptionKey,
            'Content-Type': 'application/json'
          },
          timeout: this.config.requestTimeout
        }
      );

      console.log(`✅ Collection request sent successfully`);
      console.log(`   Transaction ID: ${transactionId}`);
      console.log(`   Reference ID: ${referenceId}`);

      // Log successful transaction
      await this.logTransaction({
        productType: 'collection',
        transactionId,
        referenceId,
        amount,
        currency,
        phoneNumber,
        status: 'pending',
        requestPayload,
        responsePayload: { status: 'sent', message: 'USSD sent to customer' }
      });

      return {
        success: true,
        transactionId,
        referenceId,
        amount,
        currency,
        phoneNumber,
        status: 'pending',
        message: 'Collection request sent - Awaiting customer confirmation',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`❌ Collection Error:`, {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });

      // Log failed transaction
      await this.logTransaction({
        productType: 'collection',
        transactionId: transactionId || 'unknown',
        referenceId: referenceId || 'unknown',
        amount,
        currency,
        phoneNumber,
        status: 'failed',
        requestPayload,
        responsePayload: null,
        errorMessage: error.message
      });

      return {
        success: false,
        error: error.message,
        details: error.response?.data,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * SEND MONEY - Disbursements API
   * Send money TO a customer
   * 
   * @param {Object} params
   * @param {number} params.amount - Amount to send
   * @param {string} params.phoneNumber - Recipient phone (format: 256xxxxxxxxx)
   * @param {string} params.currency - Currency code (default: UGX)
   * @param {string} params.externalId - Your transaction reference
   * @param {string} params.description - Payment description
   * @returns {Promise<Object>} Transaction result
   */
  async sendMoney({
    amount,
    phoneNumber,
    currency = 'UGX',
    externalId = null,
    description = 'Payment from ICAN Platform'
  }) {
    let transactionId = null;
    let referenceId = null;
    let requestPayload = null;

    try {
      console.log(`\n📤 SEND MONEY (Disbursements):`);
      console.log(`   Amount: ${amount} ${currency}`);
      console.log(`   Phone: ${phoneNumber}`);
      console.log(`   Description: ${description}`);

      // Validate inputs
      if (!amount || amount <= 0) {
        throw new Error('Invalid amount');
      }
      if (!phoneNumber) {
        throw new Error('Phone number is required');
      }

      // Generate transaction reference
      transactionId = uuidv4();
      referenceId = externalId || `PAY-${Date.now()}`;

      // Get access token
      const token = await this.getAccessToken('disbursement');

      // Prepare payload
      requestPayload = {
        amount: String(amount),
        currency: currency,
        externalId: referenceId,
        payee: {
          partyIdType: 'MSISDN',
          partyId: phoneNumber
        },
        payerMessage: description,
        payeeNote: 'Funds from ICAN'
      };

      console.log(`📤 Sending transfer (ID: ${transactionId})...`);

      // Make API request
      const response = await axios.post(
        `${this.config.baseUrl}/disbursement/v1_0/transfer`,
        requestPayload,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Reference-Id': transactionId,
            'X-Target-Environment': this.config.environment,
            'Ocp-Apim-Subscription-Key': this.config.subscriptionKey,
            'Content-Type': 'application/json'
          },
          timeout: this.config.requestTimeout
        }
      );

      console.log(`✅ Transfer sent successfully`);
      console.log(`   Transaction ID: ${transactionId}`);
      console.log(`   Reference ID: ${referenceId}`);

      // Log successful transaction
      await this.logTransaction({
        productType: 'disbursement',
        transactionId,
        referenceId,
        amount,
        currency,
        phoneNumber,
        status: 'completed',
        requestPayload,
        responsePayload: { status: 'sent', message: 'Funds transferred' }
      });

      return {
        success: true,
        transactionId,
        referenceId,
        amount,
        currency,
        phoneNumber,
        status: 'completed',
        message: 'Funds sent successfully',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`❌ Disbursement Error:`, {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });

      // Log failed transaction
      await this.logTransaction({
        productType: 'disbursement',
        transactionId: transactionId || 'unknown',
        referenceId: referenceId || 'unknown',
        amount,
        currency,
        phoneNumber,
        status: 'failed',
        requestPayload,
        responsePayload: null,
        errorMessage: error.message
      });

      return {
        success: false,
        error: error.message,
        details: error.response?.data,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Check Transaction Status
   * Query the status of a collection or disbursement
   * 
   * @param {string} referenceId - The transaction reference ID
   * @param {string} productType - 'collection' or 'disbursement'
   * @returns {Promise<Object>} Transaction status
   */
  async getTransactionStatus(referenceId, productType = 'collection') {
    try {
      console.log(`\n🔍 Checking ${productType} status for: ${referenceId}`);

      const token = await this.getAccessToken(productType);

      const endpoint = productType === 'collection'
        ? `${this.config.baseUrl}/collection/v1_0/requesttopay/${referenceId}`
        : `${this.config.baseUrl}/disbursement/v1_0/transfer/${referenceId}`;

      const response = await axios.get(endpoint, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Target-Environment': this.config.environment,
          'Ocp-Apim-Subscription-Key': this.config.subscriptionKey
        },
        timeout: this.config.requestTimeout
      });

      console.log(`✅ Status retrieved:`, response.data.status);

      return {
        success: true,
        status: response.data.status,
        data: response.data
      };

    } catch (error) {
      console.error(`❌ Status Check Error:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Validate phone number format
   * MTN MOMO requires E.164 format (e.g., 256701234567)
   * 
   * @param {string} phoneNumber
   * @returns {boolean}
   */
  static validatePhoneNumber(phoneNumber) {
    // E.164 format: + or country code, followed by digits
    const e164Regex = /^\d{1,3}\d{1,14}$/;
    return e164Regex.test(phoneNumber.replace(/\D/g, ''));
  }

  /**
   * Format phone number to E.164
   * Handles common African formats
   * 
   * @param {string} phoneNumber
   * @param {string} countryCode - Optional country code (e.g., '256' for Uganda)
   * @returns {string} Formatted phone number
   */
  static formatPhoneNumber(phoneNumber, countryCode = '256') {
    // Remove all non-digits
    let digits = phoneNumber.replace(/\D/g, '');
    
    // If doesn't start with country code, add it
    if (!digits.startsWith(countryCode)) {
      if (digits.startsWith('0')) {
        digits = digits.substring(1);
      }
      digits = countryCode + digits;
    }
    
    return digits;
  }
}

// Export singleton instance
module.exports = new MTNMomoService();
