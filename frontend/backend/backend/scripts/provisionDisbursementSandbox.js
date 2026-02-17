const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

/**
 * MTN MoMo Sandbox Provisioning Script for DISBURSEMENTS
 * This script automates the creation of an API User and API Key for Disbursements.
 * REQUIRED: Your MOMO_DISBURSEMENT_SUBSCRIPTION_KEY must be in your .env file.
 */
async function provisionDisbursement() {
  const subKey = process.env.MOMO_DISBURSEMENT_SUBSCRIPTION_KEY;
  const userId = uuidv4();

  console.log("======================================================================");
  console.log("🚀 MTN MOMO DISBURSEMENT SANDBOX PROVISIONING");
  console.log("======================================================================");
  console.log(`📍 Using Disbursement Sub Key: ${subKey.substring(0, 5)}...${subKey.substring(subKey.length - 5)}`);
  console.log(`📍 Generated X-Reference-Id (User ID): ${userId}`);
  console.log("======================================================================");

  try {
    // Step 1: Create API User for Disbursements
    // Endpoint: /v1_0/apiuser
    console.log("📝 Step 1: Creating API User for Disbursements in Sandbox...");
    
    await axios.post('https://sandbox.momodeveloper.mtn.com/v1_0/apiuser', 
      { providerCallbackHost: "webhook.site" }, 
      {
        headers: {
          'X-Reference-Id': userId,
          'Ocp-Apim-Subscription-Key': subKey,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`✅ Step 1 Success: API User created for Disbursements.`);

    // Step 2: Generate API Key for Disbursements
    // Endpoint: /v1_0/apiuser/{userId}/apikey
    console.log("📝 Step 2: Generating API Secret Key for Disbursements...");
    
    const response = await axios.post(`https://sandbox.momodeveloper.mtn.com/v1_0/apiuser/${userId}/apikey`, {}, {
      headers: {
        'Ocp-Apim-Subscription-Key': subKey
      }
    });

    const apiKey = response.data.apiKey;

    console.log("======================================================================");
    console.log("🎉 DISBURSEMENT PROVISIONING COMPLETE!");
    console.log("======================================================================");
    console.log("Add these two values to your .env file immediately:");
    console.log("");
    console.log(`MOMO_DISBURSEMENT_API_USER=${userId}`);
    console.log(`MOMO_DISBURSEMENT_API_KEY=${apiKey}`);
    console.log("");
    console.log("======================================================================");
    console.log("💡 Next step: Use these to get a Bearer Token for disbursement transactions.");

  } catch (error) {
    console.error("❌ DISBURSEMENT PROVISIONING FAILED");
    
    if (error.response) {
      console.error(`  Status Code: ${error.response.status}`);
      console.error(`  Server Message: ${JSON.stringify(error.response.data)}`);
      
      if (error.response.status === 401) {
        console.log("\n--- DEBUGGING TIPS FOR 401 ERROR ---");
        console.log("1. Ensure you are using the PRIMARY KEY from the 'Disbursements' product.");
        console.log("2. Check that your subscription status is 'Active' in the portal.");
        console.log("3. Ensure there are no leading/trailing spaces in your .env file.");
        console.log("------------------------------------\n");
      }
    } else {
      console.error(`  Error Type: ${error.message}`);
    }
  }
}

provisionDisbursement();
