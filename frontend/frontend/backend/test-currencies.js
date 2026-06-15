/**
 * 🧪 MTN MOMO API Currency Test
 * Test different currencies to see which ones are supported
 */

const axios = require('axios');
require('dotenv').config();

const SUBSCRIPTION_KEY = process.env.MOMO_SUBSCRIPTION_KEY;
const API_USER = process.env.MOMO_API_USER_ID;
const API_SECRET = process.env.MOMO_API_SECRET_KEY;
const BASE_URL = process.env.MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';

// First get a token
async function getToken() {
  try {
    const credentials = `${API_USER}:${API_SECRET}`;
    const auth = Buffer.from(credentials).toString('base64');

    const response = await axios.post(
      `${BASE_URL}/collection/token/`,
      {},
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    console.log('✅ Got token:', response.data.access_token.substring(0, 20) + '...');
    return response.data.access_token;
  } catch (error) {
    console.error('❌ Failed to get token:', error.response?.data || error.message);
    throw error;
  }
}

// Test currencies
async function testCurrencies(token) {
  const currencies = ['UGX', 'KES', 'GHS', 'TZS', 'RWF', 'EUR', 'USD', 'GBP'];
  
  console.log('\n🧪 Testing currencies...\n');

  for (const currency of currencies) {
    try {
      const payload = {
        amount: '1000',
        currency: currency,
        externalId: `TEST-${currency}-${Date.now()}`,
        payer: {
          partyIdType: 'MSISDN',
          partyId: '256701234567'
        },
        payerMessage: 'Test',
        payeeNote: 'Test'
      };

      const response = await axios.post(
        `${BASE_URL}/collection/v1_0/requesttopay`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Reference-Id': `TEST-${currency}-${Date.now()}`,
            'X-Target-Environment': 'sandbox',
            'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      console.log(`✅ ${currency}: SUPPORTED`);
    } catch (error) {
      const errorMsg = error.response?.data?.message || error.message;
      console.log(`❌ ${currency}: NOT SUPPORTED - ${errorMsg}`);
    }

    // Wait a bit between requests
    await new Promise(r => setTimeout(r, 500));
  }
}

async function run() {
  console.log('===== MTN MOMO CURRENCY TEST =====\n');
  console.log('Subscription Key:', SUBSCRIPTION_KEY.substring(0, 10) + '...');
  console.log('API User:', API_USER.substring(0, 10) + '...');
  console.log('Base URL:', BASE_URL);
  console.log('');

  try {
    const token = await getToken();
    await testCurrencies(token);
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

run();
