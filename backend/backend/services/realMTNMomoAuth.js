/**
 * REAL MTN MOMO API AUTHENTICATION FLOW
 * Complete Technical Understanding
 * 
 * This is NOT Basic Auth foolishness
 * This is the REAL MTN API authentication mechanism
 */

const axios = require('axios');

/**
 * ============================================================
 * STEP 1: UNDERSTAND THE MTN MOMO API CREDENTIALS
 * ============================================================
 * 
 * You have THREE pieces of information:
 * 
 * 1. API_User (from database):        550e8400-e29b-41d4-a716-446655440000
 * 2. API_Key (from database):         0c83153ce97f40c68622c16a2d69d69e
 * 3. Subscription_Key (primary key):  8b59afc46b7a43b0a32856e709af1de3
 * 
 * WHAT EACH IS FOR:
 * ─────────────────────────────────────────────────────────
 * API_User + API_Key:     Used to AUTHENTICATE and get a Bearer Token
 *                         (sent via axios auth field, not manually encoded)
 * 
 * Subscription_Key:       Used to IDENTIFY your subscription/app
 *                         (sent as Ocp-Apim-Subscription-Key header)
 * 
 * Bearer Token:           Used for ACTUAL API CALLS after authentication
 *                         (returned from /token/ endpoint, valid ~3600 seconds)
 * 
 * X-Reference-Id:         Used for TRACKING each request uniquely (UUID)
 */

/**
 * ============================================================
 * STEP 2: THE REAL MTN API FLOW
 * ============================================================
 * 
 * FLOW DIAGRAM:
 * ═════════════════════════════════════════════════════════
 * 
 *  YOUR APP                                    MTN MOMO API
 *  ────────                                    ─────────────
 * 
 *  [1] POST /token/
 *      Headers:
 *      - Ocp-Apim-Subscription-Key: 8b59afc46b7a43b0a32856e709af1de3
 *      - X-Reference-Id: [UUID]
 *      Auth: (API_User, API_Key)
 *                          ──────────────────────>
 *                          
 *                          [MTN validates your credentials]
 *                          [Returns Bearer Token]
 *                          
 *      access_token: eyJ0eXAiOiJKV1QiLCJhbGc...
 *      expires_in: 3600
 *                          <──────────────────────
 *
 *  [2] POST /collection/v1_0/requesttopay
 *      Headers:
 *      - Authorization: Bearer [token from step 1]
 *      - Ocp-Apim-Subscription-Key: 8b59afc46b7a43b0a32856e709af1de3
 *      - X-Reference-Id: [DIFFERENT UUID]
 *      Body: { amount, payer, ... }
 *                          ──────────────────────>
 *                          
 *                          [MTN processes the request]
 *                          [Returns result]
 *                          
 *      Status: 202 Accepted
 *                          <──────────────────────
 *
 *  [3] GET /collection/v1_0/requesttopay/[reference-id]
 *      Headers:
 *      - Authorization: Bearer [same token]
 *      - Ocp-Apim-Subscription-Key: 8b59afc46b7a43b0a32856e709af1de3
 *      - X-Reference-Id: [ANOTHER UUID]
 *                          ──────────────────────>
 *                          
 *                          [MTN returns transaction status]
 *                          
 *      Status: SUCCESSFUL / FAILED / PENDING
 *                          <──────────────────────
 */

/**
 * ============================================================
 * STEP 3: REAL CODE - GET BEARER TOKEN
 * ============================================================
 */

class RealMTNMomoAuth {
  constructor() {
    // These are REAL credentials from your database
    this.apiUser = process.env.MOMO_API_USER_DB;      // 550e8400-e29b-41d4-a716-446655440000
    this.apiKey = process.env.MOMO_API_KEY_DB;        // 0c83153ce97f40c68622c16a2d69d69e
    this.subscriptionKey = process.env.MOMO_SUBSCRIPTION_KEY;  // 8b59afc46b7a43b0a32856e709af1de3
    
    this.baseUrl = 'https://sandbox.momodeveloper.mtn.com';
    this.tokenCache = {};
  }

  /**
   * STEP 1: Get Bearer Token from MTN API
   * 
   * This is the REAL authentication:
   * - axios automatically encodes apiUser:apiKey into base64 for the Authorization header
   * - BUT the token endpoint validates these credentials properly
   * - Returns a JWT Bearer token valid for ~3600 seconds
   */
  async getBearerToken(productType = 'collection') {
    try {
      console.log(`\n🔐 STEP 1: Getting Bearer Token for ${productType}...`);
      
      // Check if we have cached token that's still valid
      if (this.tokenCache[productType]) {
        const { token, expiresAt } = this.tokenCache[productType];
        if (new Date() < expiresAt) {
          console.log(`✅ Using cached token (valid until ${expiresAt.toLocaleTimeString()})`);
          return token;
        }
      }

      console.log(`📍 Endpoint: ${this.baseUrl}/${productType}/token/`);
      console.log(`📍 Method: POST`);
      console.log(`📍 Headers:`);
      console.log(`   - Ocp-Apim-Subscription-Key: ${this.subscriptionKey}`);
      console.log(`   - X-Reference-Id: [UUID]`);
      console.log(`📍 Auth: (username: ${this.apiUser}, password: [hidden])`);

      const { v4: uuidv4 } = require('uuid');

      // REAL REQUEST - axios handles auth encoding automatically
      const response = await axios.post(
        `${this.baseUrl}/${productType}/token/`,
        {}, // Empty body - just requesting token
        {
          headers: {
            'Ocp-Apim-Subscription-Key': this.subscriptionKey,
            'X-Reference-Id': uuidv4(),
            'Content-Type': 'application/json'
          },
          // THIS is where the magic happens:
          // axios takes these credentials and encodes them for HTTP Basic Auth
          // Then MTN API validates them
          auth: {
            username: this.apiUser,
            password: this.apiKey
          },
          timeout: 10000
        }
      );

      const { access_token, expires_in, token_type } = response.data;

      console.log(`\n✅ SUCCESS - Bearer Token Received!`);
      console.log(`   Token Type: ${token_type}`);
      console.log(`   Expires In: ${expires_in} seconds (${Math.round(expires_in / 60)} minutes)`);
      console.log(`   Token (first 50 chars): ${access_token.substring(0, 50)}...`);

      // Cache the token
      const expiresAt = new Date(Date.now() + (expires_in * 1000) - 60000); // 1 min buffer
      this.tokenCache[productType] = {
        token: access_token,
        expiresAt,
        type: token_type
      };

      return access_token;
    } catch (error) {
      console.error(`\n❌ FAILED to get Bearer Token`);
      console.error(`   Status: ${error.response?.status}`);
      console.error(`   Error: ${error.response?.data?.error || error.message}`);
      console.error(`   Details: ${JSON.stringify(error.response?.data, null, 2)}`);
      throw error;
    }
  }

  /**
   * STEP 2: Use Bearer Token to Request Money
   * 
   * Now that we have the token, we use it for actual API calls
   */
  async requestMoney(phoneNumber, amount) {
    try {
      console.log(`\n💰 STEP 2: Requesting Money...`);
      
      // Get valid token (from cache or new)
      const token = await this.getBearerToken('collection');

      const { v4: uuidv4 } = require('uuid');
      const transactionId = uuidv4();

      const payload = {
        amount: String(amount),
        currency: 'UGX',
        externalId: `REQ-${Date.now()}`,
        payer: {
          partyIdType: 'MSISDN',
          partyId: phoneNumber
        },
        payerMessage: 'ICAN Investment Payment',
        payeeNote: 'Payment received'
      };

      console.log(`\n📍 Endpoint: ${this.baseUrl}/collection/v1_0/requesttopay`);
      console.log(`📍 Method: POST`);
      console.log(`📍 Headers:`);
      console.log(`   - Authorization: Bearer ${token.substring(0, 30)}...`);
      console.log(`   - Ocp-Apim-Subscription-Key: ${this.subscriptionKey}`);
      console.log(`   - X-Reference-Id: ${transactionId}`);
      console.log(`📍 Body:`, JSON.stringify(payload, null, 2));

      const response = await axios.post(
        `${this.baseUrl}/collection/v1_0/requesttopay`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Ocp-Apim-Subscription-Key': this.subscriptionKey,
            'X-Reference-Id': transactionId,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      console.log(`\n✅ SUCCESS - Request Sent!`);
      console.log(`   Status: ${response.status} (${response.statusText})`);
      console.log(`   Response:`, JSON.stringify(response.data, null, 2));

      return {
        success: true,
        transactionId,
        referenceId: response.data.referenceId || transactionId,
        status: response.status,
        message: response.data
      };
    } catch (error) {
      console.error(`\n❌ FAILED to request money`);
      console.error(`   Status: ${error.response?.status}`);
      console.error(`   Error: ${error.response?.data?.error || error.message}`);
      console.error(`   Details: ${JSON.stringify(error.response?.data, null, 2)}`);
      throw error;
    }
  }

  /**
   * STEP 3: Check Transaction Status
   * 
   * Use the same Bearer token to check status
   */
  async checkStatus(referenceId) {
    try {
      console.log(`\n📊 STEP 3: Checking Transaction Status...`);
      
      const token = await this.getBearerToken('collection');
      const { v4: uuidv4 } = require('uuid');

      console.log(`\n📍 Endpoint: ${this.baseUrl}/collection/v1_0/requesttopay/${referenceId}`);
      console.log(`📍 Method: GET`);
      console.log(`📍 Headers:`);
      console.log(`   - Authorization: Bearer ${token.substring(0, 30)}...`);
      console.log(`   - Ocp-Apim-Subscription-Key: ${this.subscriptionKey}`);
      console.log(`   - X-Reference-Id: ${uuidv4()}`);

      const response = await axios.get(
        `${this.baseUrl}/collection/v1_0/requesttopay/${referenceId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Ocp-Apim-Subscription-Key': this.subscriptionKey,
            'X-Reference-Id': uuidv4(),
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      console.log(`\n✅ SUCCESS - Status Retrieved!`);
      console.log(`   Status: ${response.status} (${response.statusText})`);
      console.log(`   Response:`, JSON.stringify(response.data, null, 2));

      return response.data;
    } catch (error) {
      console.error(`\n❌ FAILED to check status`);
      console.error(`   Status: ${error.response?.status}`);
      console.error(`   Error: ${error.response?.data?.error || error.message}`);
      console.error(`   Details: ${JSON.stringify(error.response?.data, null, 2)}`);
      throw error;
    }
  }
}

/**
 * ============================================================
 * TESTING THE REAL API
 * ============================================================
 */

async function runRealTest() {
  try {
    const auth = new RealMTNMomoAuth();

    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║        REAL MTN MOMO API AUTHENTICATION & WORKFLOW         ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('CREDENTIALS:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`API User:        ${auth.apiUser}`);
    console.log(`API Key:         ${auth.apiKey}`);
    console.log(`Subscription:    ${auth.subscriptionKey}`);
    console.log(`Base URL:        ${auth.baseUrl}`);

    // Step 1: Get token
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const token = await auth.getBearerToken('collection');

    // Step 2: Request money
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const result = await auth.requestMoney('256701234567', 50000);

    // Step 3: Check status
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Waiting 2 seconds before checking status...');
    await new Promise(r => setTimeout(r, 2000));
    
    if (result.referenceId) {
      await auth.checkStatus(result.referenceId);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ WORKFLOW COMPLETE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } catch (error) {
    console.error('\n❌ WORKFLOW FAILED');
    console.error(error.message);
  }
}

// Export for use
module.exports = RealMTNMomoAuth;

// Run if executed directly
if (require.main === module) {
  require('dotenv').config();
  runRealTest().catch(console.error);
}
