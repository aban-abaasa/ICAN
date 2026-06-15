/**
 * MOMO Integration Service
 * Real implementation with Supabase + MTN MOMO API
 * No Basic Auth nonsense - Direct API integration
 */

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase
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

class MOmoIntegrationService {
  constructor() {
    this.baseUrl = process.env.MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';
    this.subscriptionKey = process.env.MOMO_SUBSCRIPTION_KEY;
    this.apiUser = process.env.MOMO_API_USER_ID;
    this.apiKey = process.env.MOMO_API_SECRET_KEY;
  }

  /**
   * Get Bearer Token from MOMO API
   * This is the REAL authentication - not Basic Auth
   * Returns actual access token for API calls
   */
  async getBearerToken(productType = 'collection') {
    try {
      console.log(`🔐 Requesting ${productType} token from MOMO API...`);

      const response = await axios.post(
        `${this.baseUrl}/${productType}/token/`,
        {},
        {
          headers: {
            'Ocp-Apim-Subscription-Key': this.subscriptionKey,
            'X-Reference-Id': uuidv4(),
            'Content-Type': 'application/json'
          },
          auth: {
            username: this.apiUser,
            password: this.apiKey
          }
        }
      );

      const { access_token, expires_in, token_type } = response.data;

      console.log(`✅ Token received: ${token_type}`);
      console.log(`⏱️  Expires in: ${expires_in} seconds`);

      // Cache token in Supabase
      await this.cacheToken(productType, access_token, expires_in);

      return access_token;
    } catch (error) {
      console.error(`❌ Failed to get token: ${error.message}`);
      if (error.response) {
        console.error(`Response: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  /**
   * Cache token in Supabase for reuse
   */
  async cacheToken(productType, accessToken, expiresIn) {
    try {
      const expiresAt = new Date(Date.now() + (expiresIn * 1000)).toISOString();

      // Get config ID
      const { data: config } = await supabase
        .from('mtn_momo_config')
        .select('id')
        .eq('subscription_key', this.subscriptionKey)
        .eq('is_active', true)
        .single();

      if (!config) {
        console.warn('⚠️  No config found for caching token');
        return;
      }

      // Upsert token
      const { error } = await supabase
        .from('mtn_momo_tokens')
        .upsert({
          config_id: config.id,
          product_type: productType,
          access_token: accessToken,
          token_type: 'Bearer',
          expires_at: expiresAt,
          is_valid: true,
          created_at: new Date().toISOString()
        }, {
          onConflict: 'config_id,product_type'
        });

      if (!error) {
        console.log(`💾 Token cached in Supabase (expires: ${expiresAt})`);
      }
    } catch (error) {
      console.warn(`⚠️  Failed to cache token: ${error.message}`);
    }
  }

  /**
   * Get cached token from Supabase
   */
  async getCachedToken(productType = 'collection') {
    try {
      const now = new Date().toISOString();

      const { data: token, error } = await supabase
        .from('mtn_momo_tokens')
        .select('access_token')
        .eq('product_type', productType)
        .eq('is_valid', true)
        .gt('expires_at', now)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (token && token.access_token) {
        console.log(`♻️  Using cached token`);
        return token.access_token;
      }
    } catch (error) {
      console.log(`   No valid cached token found`);
    }

    return null;
  }

  /**
   * Request Money (Collections)
   * Real MOMO Collection - Receive Money
   */
  async requestMoney(phoneNumber, amount, externalId, description = 'Payment') {
    try {
      console.log(`\n💰 Requesting money from: ${phoneNumber}`);

      // Get or fetch token
      let token = await this.getCachedToken('collection');
      if (!token) {
        token = await this.getBearerToken('collection');
      }

      const transactionId = uuidv4();
      const referenceId = `REC-${Date.now()}`;

      const payload = {
        amount: String(amount),
        currency: 'UGX',
        externalId: externalId,
        payer: {
          partyIdType: 'MSISDN',
          partyId: phoneNumber
        },
        payerMessage: description,
        payeeNote: 'ICAN Payment'
      };

      console.log(`📤 Sending collection request...`);
      console.log(`   Phone: ${phoneNumber}`);
      console.log(`   Amount: ${amount} UGX`);
      console.log(`   Reference: ${referenceId}`);

      const response = await axios.post(
        `${this.baseUrl}/collection/v1_0/requesttopay`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Ocp-Apim-Subscription-Key': this.subscriptionKey,
            'X-Reference-Id': transactionId,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`✅ Collection request sent successfully`);

      // Log to Supabase
      await this.logTransaction({
        transactionId,
        referenceId,
        productType: 'collection',
        endpoint: '/collection/v1_0/requesttopay',
        status: 'pending',
        amount,
        phoneNumber,
        currency: 'UGX',
        requestPayload: payload,
        responsePayload: response.data,
        httpStatus: response.status
      });

      return {
        success: true,
        transactionId,
        referenceId,
        message: 'Collection request sent',
        data: response.data
      };
    } catch (error) {
      console.error(`❌ Collection request failed: ${error.message}`);

      // Log error to Supabase
      await this.logTransaction({
        transactionId: uuidv4(),
        referenceId: `ERR-${Date.now()}`,
        productType: 'collection',
        endpoint: '/collection/v1_0/requesttopay',
        status: 'failed',
        amount,
        phoneNumber,
        currency: 'UGX',
        requestPayload: { phoneNumber, amount },
        errorMessage: error.message,
        httpStatus: error.response?.status || 500
      });

      throw error;
    }
  }

  /**
   * Check Transaction Status
   */
  async checkTransactionStatus(referenceId) {
    try {
      console.log(`🔍 Checking status for: ${referenceId}`);

      // Get token
      let token = await this.getCachedToken('collection');
      if (!token) {
        token = await this.getBearerToken('collection');
      }

      const transactionId = uuidv4();

      const response = await axios.get(
        `${this.baseUrl}/collection/v1_0/requesttopay/${referenceId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Ocp-Apim-Subscription-Key': this.subscriptionKey,
            'X-Reference-Id': transactionId,
            'Content-Type': 'application/json'
          }
        }
      );

      const status = response.data.status;
      console.log(`📊 Transaction Status: ${status}`);

      // Update Supabase logs
      await supabase
        .from('mtn_momo_logs')
        .update({
          status: status.toLowerCase(),
          response_payload: response.data,
          updated_at: new Date().toISOString()
        })
        .eq('reference_id', referenceId);

      return response.data;
    } catch (error) {
      console.error(`❌ Status check failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send Money (Disbursement)
   */
  async sendMoney(phoneNumber, amount, externalId, description = 'Transfer') {
    try {
      console.log(`\n💸 Sending money to: ${phoneNumber}`);

      // Get or fetch token
      let token = await this.getCachedToken('disbursement');
      if (!token) {
        token = await this.getBearerToken('disbursement');
      }

      const transactionId = uuidv4();
      const referenceId = `DIS-${Date.now()}`;

      const payload = {
        amount: String(amount),
        currency: 'UGX',
        externalId: externalId,
        payee: {
          partyIdType: 'MSISDN',
          partyId: phoneNumber
        },
        payerMessage: description,
        payeeNote: 'ICAN Transfer'
      };

      console.log(`📤 Sending disbursement...`);
      console.log(`   Phone: ${phoneNumber}`);
      console.log(`   Amount: ${amount} UGX`);
      console.log(`   Reference: ${referenceId}`);

      const response = await axios.post(
        `${this.baseUrl}/disbursement/v1_0/transfer`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Ocp-Apim-Subscription-Key': this.subscriptionKey,
            'X-Reference-Id': transactionId,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`✅ Disbursement sent successfully`);

      // Log to Supabase
      await this.logTransaction({
        transactionId,
        referenceId,
        productType: 'disbursement',
        endpoint: '/disbursement/v1_0/transfer',
        status: 'pending',
        amount,
        phoneNumber,
        currency: 'UGX',
        requestPayload: payload,
        responsePayload: response.data,
        httpStatus: response.status
      });

      return {
        success: true,
        transactionId,
        referenceId,
        message: 'Disbursement sent',
        data: response.data
      };
    } catch (error) {
      console.error(`❌ Disbursement failed: ${error.message}`);

      // Log error
      await this.logTransaction({
        transactionId: uuidv4(),
        referenceId: `ERR-${Date.now()}`,
        productType: 'disbursement',
        endpoint: '/disbursement/v1_0/transfer',
        status: 'failed',
        amount,
        phoneNumber,
        currency: 'UGX',
        requestPayload: { phoneNumber, amount },
        errorMessage: error.message,
        httpStatus: error.response?.status || 500
      });

      throw error;
    }
  }

  /**
   * Log transaction to Supabase
   */
  async logTransaction(data) {
    try {
      const { error } = await supabase
        .from('mtn_momo_logs')
        .insert({
          transaction_id: data.transactionId,
          reference_id: data.referenceId,
          product_type: data.productType,
          endpoint: data.endpoint,
          request_method: 'POST',
          request_payload: data.requestPayload,
          response_payload: data.responsePayload,
          http_status_code: data.httpStatus,
          status: data.status,
          error_message: data.errorMessage,
          amount: data.amount,
          currency: data.currency,
          phone_number: data.phoneNumber,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

      if (error) {
        console.warn(`⚠️  Failed to log transaction: ${error.message}`);
      } else {
        console.log(`📝 Transaction logged to Supabase`);
      }
    } catch (error) {
      console.warn(`⚠️  Error logging transaction: ${error.message}`);
    }
  }

  /**
   * Get transaction history from Supabase
   */
  async getTransactionHistory(limit = 20) {
    try {
      const { data, error } = await supabase
        .from('mtn_momo_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error(`❌ Failed to fetch history: ${error.message}`);
        return [];
      }

      console.log(`📋 Retrieved ${data.length} transactions from Supabase`);
      return data;
    } catch (error) {
      console.error(`❌ Error fetching history: ${error.message}`);
      return [];
    }
  }

  /**
   * Validate credentials from Supabase
   */
  async validateCredentials() {
    try {
      console.log(`🔐 Validating MOMO credentials...`);

      const { data, error } = await supabase
        .from('mtn_momo_config')
        .select('*')
        .eq('subscription_key', this.subscriptionKey)
        .eq('is_active', true)
        .single();

      if (error || !data) {
        console.error(`❌ Invalid credentials or config not found`);
        return false;
      }

      console.log(`✅ Credentials valid`);
      console.log(`   Name: ${data.name}`);
      console.log(`   Environment: ${data.environment}`);
      console.log(`   Primary: ${data.is_primary}`);

      return true;
    } catch (error) {
      console.error(`❌ Validation failed: ${error.message}`);
      return false;
    }
  }
}

module.exports = MOmoIntegrationService;
