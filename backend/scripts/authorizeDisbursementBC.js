const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

/**
 * MTN MOMO Disbursement BC (Business/Commercial) Authorization Script
 * Authorizes the disbursement account for commercial use
 * REQUIRED: MOMO_DISBURSEMENT_API_USER and MOMO_DISBURSEMENT_API_KEY must be in .env
 */
async function authorizeDisbursementBC() {
  const subscriptionKey = process.env.MOMO_DISBURSEMENT_SUBSCRIPTION_KEY;
  const apiUser = process.env.MOMO_DISBURSEMENT_API_USER;
  const apiKey = process.env.MOMO_DISBURSEMENT_API_KEY;
  const referenceId = uuidv4();

  console.log("======================================================================");
  console.log("🔐 MTN MOMO DISBURSEMENT BC AUTHORIZATION");
  console.log("======================================================================");
  console.log(`📍 API User: ${apiUser ? apiUser.substring(0, 10) + '...' : 'MISSING'}`);
  console.log(`📍 Subscription Key: ${subscriptionKey ? subscriptionKey.substring(0, 10) + '...' : 'MISSING'}`);
  console.log(`📍 Reference ID: ${referenceId}`);
  console.log("======================================================================");

  // Validate required credentials
  if (!subscriptionKey || !apiUser || !apiKey) {
    console.error("❌ MISSING REQUIRED CREDENTIALS");
    console.error("   Ensure these are set in your .env file:");
    console.error("   - MOMO_DISBURSEMENT_SUBSCRIPTION_KEY");
    console.error("   - MOMO_DISBURSEMENT_API_USER");
    console.error("   - MOMO_DISBURSEMENT_API_KEY");
    process.exit(1);
  }

  try {
    // Step 1: BC Authorize the disbursement account
    console.log("📝 Step 1: Authorizing Business/Commercial (BC) account...");
    
    // Create Basic Auth header
    const credentials = `${apiUser}:${apiKey}`;
    const auth = Buffer.from(credentials).toString('base64');

    const response = await axios.get(
      'https://sandbox.momodeveloper.mtn.com/disbursement/v1_0/bc-authorize',
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Ocp-Apim-Subscription-Key': subscriptionKey,
          'X-Reference-Id': referenceId,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`✅ Step 1 Success: BC Authorization completed.`);
    console.log(`   Status: ${response.status}`);
    console.log(`   Response:`, JSON.stringify(response.data, null, 2));

    console.log("======================================================================");
    console.log("🎉 BC AUTHORIZATION COMPLETE!");
    console.log("======================================================================");
    console.log("Your disbursement account is now authorized for commercial transactions.");
    console.log("You can now use the disbursement API to send money to customer phones.");
    console.log("");
    console.log("Next steps:");
    console.log("1. Test send-payment API endpoint: POST /api/momo/send-payment");
    console.log("2. Monitor disbursement logs in Supabase: mtn_momo_logs table");
    console.log("3. Check transaction status: GET /api/momo/transaction-status/:referenceId");
    console.log("======================================================================");

  } catch (error) {
    console.error("❌ BC AUTHORIZATION FAILED");
    
    if (error.response) {
      console.error(`  Status Code: ${error.response.status}`);
      console.error(`  Status Text: ${error.response.statusText}`);
      console.error(`  Server Message:`, JSON.stringify(error.response.data, null, 2));
      
      if (error.response.status === 401) {
        console.log("\n--- DEBUGGING TIPS FOR 401 ERROR ---");
        console.log("1. Verify that your disbursement credentials are correct");
        console.log("2. Check that MOMO_DISBURSEMENT_API_USER and MOMO_DISBURSEMENT_API_KEY match");
        console.log("3. Ensure MOMO_DISBURSEMENT_SUBSCRIPTION_KEY is from the Disbursements product");
        console.log("4. Verify credentials don't have leading/trailing spaces");
        console.log("------------------------------------\n");
      }

      if (error.response.status === 403) {
        console.log("\n--- DEBUGGING TIPS FOR 403 ERROR ---");
        console.log("1. Your account may not have disbursement permissions");
        console.log("2. Contact MTN MOMO support to enable disbursements");
        console.log("3. Check your account status in MTN MOMO Developer Portal");
        console.log("------------------------------------\n");
      }
    } else {
      console.error(`  Error Type: ${error.message}`);
    }

    process.exit(1);
  }
}

authorizeDisbursementBC();
