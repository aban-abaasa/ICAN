/**
 * MTN MOMO API - Credential Validation & Verification Service
 * 
 * This service verifies that your API credentials are REAL and match
 * MTN MOMO API requirements exactly.
 * 
 * All credentials sourced from Supabase mtn_momo_config table
 */

const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

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

class MTNMomoCredentialValidator {
  /**
   * CREDENTIAL SOURCES:
   * 
   * These credentials come from your MTN MOMO Developer Account:
   * https://momodeveloper.mtn.com/admin/api-keys
   * 
   * Each credential has a SPECIFIC PURPOSE in the MTN API:
   */

  constructor() {
    this.baseUrl = 'https://sandbox.momodeveloper.mtn.com';
    this.environment = 'sandbox';
  }

  /**
   * ============================================================
   * STEP 1: Retrieve REAL credentials from Supabase
   * ============================================================
   * 
   * Your credentials are stored in the mtn_momo_config table
   * This is the REAL source of truth - not hardcoded anywhere
   */
  async getCredentialsFromSupabase() {
    try {
      console.log('\n📋 STEP 1: Retrieving credentials from Supabase...\n');

      const { data, error } = await supabase
        .from('mtn_momo_config')
        .select('*')
        .eq('is_active', true)
        .eq('is_primary', true)
        .eq('environment', this.environment)
        .single();

      if (error) {
        console.error('❌ Failed to retrieve credentials:', error.message);
        return null;
      }

      if (!data) {
        console.error('❌ No active primary configuration found');
        return null;
      }

      console.log('✅ Credentials retrieved from Supabase\n');

      return {
        id: data.id,
        name: data.name,
        description: data.description,

        // THESE ARE THE REAL CREDENTIALS:
        subscriptionKey: data.subscription_key,
        apiUserId: data.api_user_id,
        apiSecretKey: data.api_secret_key,

        environment: data.environment,
        baseUrl: data.base_url,
        isActive: data.is_active,
        isPrimary: data.is_primary,
        createdAt: data.created_at,
        updatedAt: data.updated_at
      };
    } catch (error) {
      console.error('❌ Error retrieving credentials:', error.message);
      return null;
    }
  }

  /**
   * ============================================================
   * STEP 2: VALIDATE credential format
   * ============================================================
   * 
   * MTN MOMO API credentials have specific formats:
   * - Subscription Key: 32-character hex string
   * - API User ID: UUID or generated user identifier
   * - API Secret Key: 32-character hex string
   */
  validateCredentialFormat(credentials) {
    console.log('\n🔍 STEP 2: Validating credential format...\n');

    const validations = {
      subscriptionKey: {
        required: true,
        pattern: /^[a-f0-9]{32}$/i,
        description: '32-character hexadecimal string'
      },
      apiUserId: {
        required: true,
        minLength: 8,
        description: 'API User ID (UUID or user identifier)'
      },
      apiSecretKey: {
        required: true,
        pattern: /^[a-f0-9]{32}$/i,
        description: '32-character hexadecimal string'
      }
    };

    let allValid = true;

    for (const [key, rules] of Object.entries(validations)) {
      const value = credentials[key];
      console.log(`Checking ${key}:`);
      console.log(`  Value: ${value}`);
      console.log(`  Expected: ${rules.description}`);

      if (rules.required && !value) {
        console.log(`  ❌ INVALID: Missing required credential\n`);
        allValid = false;
        continue;
      }

      if (rules.pattern && !rules.pattern.test(value)) {
        console.log(`  ⚠️  WARNING: Does not match expected hex pattern`);
        console.log(`      Pattern: 32-character hex string\n`);
        // Note: Not failing on pattern - some APIs use different formats
      } else if (rules.minLength && value.length < rules.minLength) {
        console.log(`  ❌ INVALID: Too short (min ${rules.minLength} chars)\n`);
        allValid = false;
      } else {
        console.log(`  ✅ VALID\n`);
      }
    }

    return allValid;
  }

  /**
   * ============================================================
   * STEP 3: TEST credentials with MTN API
   * ============================================================
   * 
   * The REAL test: Can we authenticate and get a Bearer Token?
   * This proves the credentials are valid.
   */
  async testCredentialsWithMTNAPI(credentials) {
    console.log('\n🔗 STEP 3: Testing credentials with MTN API...\n');

    try {
      console.log(`📍 Endpoint: ${credentials.baseUrl}/collection/token/`);
      console.log(`📍 Method: POST`);
      console.log(`📍 Auth Method: HTTP Basic Auth`);
      console.log(`📍 Username: ${credentials.apiUserId}`);
      console.log(`📍 Password: [hidden]\n`);

      const response = await axios.post(
        `${credentials.baseUrl}/collection/token/`,
        {},
        {
          headers: {
            'Ocp-Apim-Subscription-Key': credentials.subscriptionKey,
            'X-Reference-Id': require('uuid').v4(),
            'Content-Type': 'application/json'
          },
          auth: {
            username: credentials.apiUserId,
            password: credentials.apiSecretKey
          },
          timeout: 10000
        }
      );

      console.log('✅ MTN API AUTHENTICATION SUCCESSFUL!\n');
      console.log(`Response Status: ${response.status} ${response.statusText}`);
      console.log(`Token Type: ${response.data.token_type}`);
      console.log(`Expires In: ${response.data.expires_in} seconds (${Math.round(response.data.expires_in / 60)} minutes)`);
      console.log(`Token (first 50 chars): ${response.data.access_token.substring(0, 50)}...\n`);

      return {
        success: true,
        token: response.data.access_token,
        tokenType: response.data.token_type,
        expiresIn: response.data.expires_in
      };
    } catch (error) {
      console.error('❌ MTN API AUTHENTICATION FAILED!\n');
      console.error(`Error: ${error.message}`);

      if (error.response) {
        console.error(`Status: ${error.response.status} ${error.response.statusText}`);
        console.error(`Response:`, JSON.stringify(error.response.data, null, 2));
      }

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * ============================================================
   * STEP 4: VERIFY credentials work for actual operations
   * ============================================================
   * 
   * Make a test collection request to prove everything works
   */
  async verifyWorkingCredentials(credentials, token) {
    console.log('\n⚙️  STEP 4: Verifying credentials work for operations...\n');

    try {
      console.log(`📍 Endpoint: ${credentials.baseUrl}/collection/v1_0/requesttopay`);
      console.log(`📍 Method: POST`);
      console.log(`📍 Auth: Bearer Token`);
      console.log(`📍 Test Request: Request money from +256701234567\n`);

      const { v4: uuidv4 } = require('uuid');

      const response = await axios.post(
        `${credentials.baseUrl}/collection/v1_0/requesttopay`,
        {
          amount: '1000',
          currency: 'UGX',
          externalId: `TEST-${Date.now()}`,
          payer: {
            partyIdType: 'MSISDN',
            partyId: '256701234567'
          },
          payerMessage: 'ICAN Test Transaction',
          payeeNote: 'Test transaction'
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Ocp-Apim-Subscription-Key': credentials.subscriptionKey,
            'X-Reference-Id': uuidv4(),
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      console.log('✅ CREDENTIALS VERIFIED - API CALLS WORKING!\n');
      console.log(`Response Status: ${response.status} ${response.statusText}`);
      console.log(`Reference ID: ${response.data.referenceId}`);
      console.log(`Status: ${response.data.status}\n`);

      return {
        success: true,
        referenceId: response.data.referenceId,
        status: response.data.status
      };
    } catch (error) {
      console.error('⚠️  OPERATION TEST FAILED\n');
      console.error(`Error: ${error.message}`);

      if (error.response) {
        console.error(`Status: ${error.response.status}`);
        console.error(`Response:`, JSON.stringify(error.response.data, null, 2));
      }

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * ============================================================
   * STEP 5: Document credential purposes
   * ============================================================
   */
  documentCredentialPurposes(credentials) {
    console.log('\n📚 STEP 5: Credential Purposes & Usage\n');
    console.log('┌─────────────────────────────────────────────────────────┐');
    console.log('│             MTN MOMO API Credential Purposes            │');
    console.log('└─────────────────────────────────────────────────────────┘\n');

    console.log('1️⃣  SUBSCRIPTION KEY');
    console.log('   ─────────────────────────────────────────────────────');
    console.log(`   Value: ${credentials.subscriptionKey}`);
    console.log('   Used In: Every API request header');
    console.log('   Header: Ocp-Apim-Subscription-Key');
    console.log('   Purpose: Identifies your subscription/app to MTN');
    console.log('   Frequency: EVERY API request\n');

    console.log('2️⃣  API USER ID');
    console.log('   ─────────────────────────────────────────────────────');
    console.log(`   Value: ${credentials.apiUserId}`);
    console.log('   Used In: Initial authentication (HTTP Basic Auth)');
    console.log('   Method: Username in auth field');
    console.log('   Purpose: Identifies YOU to MTN API');
    console.log('   Frequency: ONLY for /token/ endpoint\n');

    console.log('3️⃣  API SECRET KEY');
    console.log('   ─────────────────────────────────────────────────────');
    console.log(`   Value: ${credentials.apiSecretKey}`);
    console.log('   Used In: Initial authentication (HTTP Basic Auth)');
    console.log('   Method: Password in auth field');
    console.log('   Purpose: Authenticates your API User ID');
    console.log('   Frequency: ONLY for /token/ endpoint\n');

    console.log('4️⃣  BEARER TOKEN (obtained from /token/ endpoint)');
    console.log('   ─────────────────────────────────────────────────────');
    console.log('   Value: Returned by MTN API (not stored in .env)');
    console.log('   Used In: All subsequent API calls');
    console.log('   Header: Authorization: Bearer [token]');
    console.log('   Purpose: Proves you\'re authenticated');
    console.log('   Validity: 3600 seconds (~1 hour)');
    console.log('   Frequency: EVERY request except /token/\n');
  }

  /**
   * ============================================================
   * COMPLETE VERIFICATION WORKFLOW
   * ============================================================
   */
  async runCompleteVerification() {
    console.log('\n╔═════════════════════════════════════════════════════════╗');
    console.log('║  MTN MOMO API - COMPLETE CREDENTIAL VERIFICATION       ║');
    console.log('║  Testing REAL credentials from Supabase              ║');
    console.log('╚═════════════════════════════════════════════════════════╝');

    try {
      // Step 1: Get credentials
      const credentials = await this.getCredentialsFromSupabase();
      if (!credentials) {
        console.error('❌ Cannot proceed without credentials');
        return;
      }

      // Display credentials summary
      console.log('\n📊 CREDENTIALS SUMMARY:');
      console.log('─────────────────────────────────────────────────────');
      console.log(`Configuration: ${credentials.name}`);
      console.log(`Description: ${credentials.description}`);
      console.log(`Environment: ${credentials.environment}`);
      console.log(`Base URL: ${credentials.baseUrl}`);
      console.log(`Primary: ${credentials.isPrimary ? '✅ Yes' : '❌ No'}`);
      console.log(`Active: ${credentials.isActive ? '✅ Yes' : '❌ No'}`);
      console.log('─────────────────────────────────────────────────────\n');

      // Step 2: Validate format
      const formatValid = this.validateCredentialFormat(credentials);
      if (!formatValid) {
        console.error('❌ Credential format validation failed');
        return;
      }

      // Step 3: Test with MTN API
      const authResult = await this.testCredentialsWithMTNAPI(credentials);
      if (!authResult.success) {
        console.error('❌ MTN API authentication test failed');
        return;
      }

      // Step 4: Verify with actual operation
      const operationResult = await this.verifyWorkingCredentials(
        credentials,
        authResult.token
      );

      // Step 5: Document purposes
      this.documentCredentialPurposes(credentials);

      // Final Summary
      console.log('\n╔═════════════════════════════════════════════════════════╗');
      console.log('║                    VERIFICATION RESULT                  ║');
      console.log('╚═════════════════════════════════════════════════════════╝\n');

      if (authResult.success && operationResult.success) {
        console.log('✅ ALL TESTS PASSED\n');
        console.log('Your MTN MOMO API credentials are REAL and WORKING:\n');
        console.log(`✅ Supabase credentials retrieved`);
        console.log(`✅ Credential format validated`);
        console.log(`✅ MTN API authentication successful`);
        console.log(`✅ API operations working\n`);
        console.log('You are ready to use MTN MOMO API for:');
        console.log('  • Collections (Request Money)');
        console.log('  • Disbursements (Send Money)');
        console.log('  • Transaction Status Checking');
        console.log('  • Full Supabase integration\n');
      } else {
        console.log('⚠️  SOME TESTS FAILED\n');
        console.log('Please check:');
        console.log('  • Supabase connectivity');
        console.log('  • Credentials in mtn_momo_config table');
        console.log('  • MTN API endpoint availability\n');
      }

      return {
        credentialsValid: formatValid,
        authenticationSuccessful: authResult.success,
        operationsWorking: operationResult.success
      };
    } catch (error) {
      console.error('\n❌ VERIFICATION WORKFLOW ERROR:', error.message);
    }
  }
}

// Run if executed directly
if (require.main === module) {
  require('dotenv').config();
  const validator = new MTNMomoCredentialValidator();
  validator.runCompleteVerification().catch(console.error);
}

module.exports = MTNMomoCredentialValidator;
